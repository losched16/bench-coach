-- ============================================================================
-- Migration 019: Measurements — the only objective evidence in the loop
-- ============================================================================
-- Everything the engine reasons from today is soft. Box scores are scored by a
-- volunteer with a phone; coach notes are subjective by design and weighted
-- accordingly. A measurement is neither. Exit velo 42 -> 48 across three weeks
-- is the cleanest possible proof a priority moved, and "it didn't move" is
-- just as clean.
--
-- player_metrics already existed and nothing ever wrote to it. It also carried
--   CHECK (metric IN ('exit_velo','throw_velo','home_to_first','sixty'))
-- which makes coach-defined categories impossible. That constraint goes.
--
-- Two shapes, because they are genuinely different:
--   measurement — a number with a unit (exit velo, pop time, home to first)
--   challenge   — X out of Y (hit the net 7 of 10). Stored as a percentage in
--                 `value` so one chart handles both, with the raw counts kept.
--
-- Direction is per-type and load-bearing: home-to-first improving means the
-- number goes DOWN, and every trend read is backwards without it.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Metric types
-- ----------------------------------------------------------------------------
-- coach_id NULL means a system preset available to everyone. A coach's own row
-- shadows nothing — they simply get more choices.
CREATE TABLE IF NOT EXISTS metric_types (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id         UUID REFERENCES coaches(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  label            TEXT NOT NULL,
  unit             TEXT,
  shape            TEXT NOT NULL DEFAULT 'measurement'
                   CHECK (shape IN ('measurement', 'challenge')),
  -- 'higher' = bigger is better (exit velo). 'lower' = smaller is better
  -- (home to first, pop time). Without this every trend reads backwards.
  direction        TEXT NOT NULL DEFAULT 'higher'
                   CHECK (direction IN ('higher', 'lower')),
  -- Suggested denominator for challenges, e.g. 10 throws
  default_attempts INT,
  hint             TEXT,
  sort_order       INT DEFAULT 100,
  archived         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coach_id, slug)
);

ALTER TABLE metric_types ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read metric types') THEN
    CREATE POLICY "Anyone can read metric types" ON metric_types FOR SELECT
      USING (coach_id IS NULL OR coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own metric types') THEN
    CREATE POLICY "Coaches can manage own metric types" ON metric_types FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Presets. One tap to start; "add your own" covers everything else.
INSERT INTO metric_types (coach_id, slug, label, unit, shape, direction, default_attempts, hint, sort_order) VALUES
  (NULL, 'exit_velo',     'Exit velocity',    'mph', 'measurement', 'higher', NULL, 'Off a tee is the most repeatable — same tee height, same ball.', 10),
  (NULL, 'throw_velo',    'Throwing velocity','mph', 'measurement', 'higher', NULL, 'From a crow hop at a consistent distance.', 20),
  (NULL, 'pitch_velo',    'Pitching velocity','mph', 'measurement', 'higher', NULL, 'Off the mound, warmed up. Never chase this in a game.', 30),
  (NULL, 'home_to_first', 'Home to first',    'sec', 'measurement', 'lower',  NULL, 'From contact to the bag. Lower is better.', 40),
  (NULL, 'sixty',         '60 yard dash',     'sec', 'measurement', 'lower',  NULL, 'Lower is better.', 50),
  (NULL, 'pop_time',      'Pop time',         'sec', 'measurement', 'lower',  NULL, 'Catcher: glove to the bag. Lower is better.', 60),
  (NULL, 'throw_accuracy','Throwing accuracy', NULL, 'challenge',   'higher', 10,   'Throws hitting the target out of the attempts.', 70),
  (NULL, 'strike_pct',    'Strikes thrown',    NULL, 'challenge',   'higher', 20,   'Strikes out of total pitches in a bullpen.', 80)
ON CONFLICT (coach_id, slug) DO UPDATE
  SET label = EXCLUDED.label,
      unit = EXCLUDED.unit,
      shape = EXCLUDED.shape,
      direction = EXCLUDED.direction,
      default_attempts = EXCLUDED.default_attempts,
      hint = EXCLUDED.hint,
      sort_order = EXCLUDED.sort_order;

-- ----------------------------------------------------------------------------
-- 2. Readings
-- ----------------------------------------------------------------------------
-- Drop the hardcoded vocabulary. Whatever its generated name, it is the only
-- CHECK on player_metrics.metric.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'player_metrics'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%metric%exit_velo%'
  LOOP
    EXECUTE format('ALTER TABLE player_metrics DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE player_metrics
  ADD COLUMN IF NOT EXISTS metric_type_id UUID REFERENCES metric_types(id) ON DELETE SET NULL,
  -- Challenge detail. `value` still carries the percentage so one chart and
  -- one trend function serve both shapes.
  ADD COLUMN IF NOT EXISTS attempts  INT,
  ADD COLUMN IF NOT EXISTS successes INT,
  -- Several readings on one day is the normal case — you take ten swings.
  -- They are separate rows; aggregation (best and average) happens on read.
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Attach existing rows (if any) to their preset type.
UPDATE player_metrics pm
SET metric_type_id = mt.id
FROM metric_types mt
WHERE pm.metric_type_id IS NULL
  AND mt.coach_id IS NULL
  AND mt.slug = pm.metric;

CREATE INDEX IF NOT EXISTS idx_player_metrics_player_date
  ON player_metrics(player_id, measured_on DESC);
CREATE INDEX IF NOT EXISTS idx_player_metrics_type
  ON player_metrics(metric_type_id);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT label, shape, direction, unit FROM metric_types
--   WHERE coach_id IS NULL ORDER BY sort_order;
--
--   SELECT p.name, mt.label, pm.measured_on, pm.value, pm.unit
--   FROM player_metrics pm
--   JOIN players p ON p.id = pm.player_id
--   LEFT JOIN metric_types mt ON mt.id = pm.metric_type_id
--   ORDER BY pm.measured_on DESC LIMIT 20;
