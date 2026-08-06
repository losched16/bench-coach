-- ============================================================================
-- Migration 012: Activity log — the capture half of the development loop
-- ============================================================================
-- Platform Scope v2, Build 1 (plus the tables Builds 2–4 depend on).
--
-- The loop this serves:
--   game data + observations in → diagnosis → one priority → drills →
--   success criteria → check back next week → did it move?
--
-- `entries` is the unified activity log: everything the user records is an
-- entry, whatever its type. `prescriptions` is the most important table in
-- the spec — without a persisted prescription there is no return visit, no
-- reassessment, and no compounding value.
--
-- Adherence deliberately has NO separate table: a `home_session` entry
-- carrying a prescription_id IS the check-in. One log, queried two ways.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Prescriptions — created first; entries references it
-- ----------------------------------------------------------------------------
-- An active prescription holds its priority for a minimum 3-week window.
-- Youth data is noisy (8–12 at-bats a weekend, volunteer scorekeeping, a
-- tired 8-year-old in the 8am game); a system that recomputes the priority
-- weekly oscillates and the user stops believing it. min_hold_until enforces
-- that. Real improvement at this age takes 4–6 weeks.
CREATE TABLE IF NOT EXISTS prescriptions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id         UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  scope            TEXT NOT NULL DEFAULT 'player' CHECK (scope IN ('player', 'team')),
  player_id        UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id          UUID REFERENCES teams(id) ON DELETE CASCADE,
  problem_id       TEXT REFERENCES problem_taxonomy(slug) ON DELETE SET NULL,
  source_entry_id  UUID,                       -- FK added after entries exists
  -- who diagnosed it. 'instructor' prescriptions are exempt from AI override
  -- during min_hold_until: a paid instructor watched the player in person.
  origin           TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'instructor', 'user')),
  summary          TEXT,
  priority         TEXT,                       -- the ONE thing. Not a list.
  success_criteria TEXT,                       -- stated in advance, checked later
  drill_ids        UUID[] DEFAULT '{}',
  sessions         JSONB,                      -- the "this week" block
  issued_at        TIMESTAMPTZ DEFAULT NOW(),
  review_due_at    TIMESTAMPTZ,                -- defaults to issued_at + 21 days
  min_hold_until   TIMESTAMPTZ,                -- priority locked until this date
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'resolved', 'stalled', 'abandoned')),
  outcome_note     TEXT,
  resolved_at      TIMESTAMPTZ,
  superseded_by    UUID REFERENCES prescriptions(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT prescriptions_scope_target CHECK (
    (scope = 'player' AND player_id IS NOT NULL) OR
    (scope = 'team'   AND team_id   IS NOT NULL)
  )
);

-- Default the review window to 3 weeks out when not supplied
CREATE OR REPLACE FUNCTION prescriptions_set_review_window()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.review_due_at IS NULL THEN
    NEW.review_due_at := COALESCE(NEW.issued_at, NOW()) + INTERVAL '21 days';
  END IF;
  IF NEW.min_hold_until IS NULL THEN
    NEW.min_hold_until := COALESCE(NEW.issued_at, NOW()) + INTERVAL '21 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prescriptions_review_window ON prescriptions;
CREATE TRIGGER trg_prescriptions_review_window
  BEFORE INSERT ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION prescriptions_set_review_window();

-- ----------------------------------------------------------------------------
-- 2. Entries — the unified activity log
-- ----------------------------------------------------------------------------
-- No entry type requires screenshots: the loop must run in the off-season and
-- on practice-only weeks, or it dies between tournaments.
CREATE TABLE IF NOT EXISTS entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id         UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  player_id        UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id          UUID REFERENCES teams(id) ON DELETE CASCADE,
  entry_type       TEXT NOT NULL DEFAULT 'game'
                   CHECK (entry_type IN ('game', 'practice', 'home_session', 'lesson', 'scrimmage')),
  occurred_on      DATE NOT NULL,
  title            TEXT,
  image_urls       TEXT[] DEFAULT '{}',
  raw_parse        JSONB,
  parse_status     TEXT NOT NULL DEFAULT 'none'
                   CHECK (parse_status IN ('none', 'pending', 'parsed', 'failed', 'needs_review')),
  parse_confidence NUMERIC,
  -- set when this entry works an active prescription. A home_session entry
  -- carrying a prescription_id IS the adherence signal — no parallel table.
  prescription_id  UUID REFERENCES prescriptions(id) ON DELETE SET NULL,
  instructor_name  TEXT,                       -- lesson entries
  duration_min     INT,
  -- link back to the normalized game row when a game entry was parsed into
  -- games / player_game_stats, so Stats and the log stay in sync
  game_id          UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Now that entries exists, close the prescriptions.source_entry_id FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prescriptions_source_entry_id_fkey'
  ) THEN
    ALTER TABLE prescriptions
      ADD CONSTRAINT prescriptions_source_entry_id_fkey
      FOREIGN KEY (source_entry_id) REFERENCES entries(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Observations — what the human saw
-- ----------------------------------------------------------------------------
-- Observations outrank the box score in the diagnosis engine. Where notes and
-- stats conflict, trust what the human saw and say why.
CREATE TABLE IF NOT EXISTS observations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id    UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  player_id   UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  entry_id    UUID REFERENCES entries(id) ON DELETE CASCADE,
  -- which prompt produced this note, so the engine can weight them
  -- (e.g. 'unseen' = what the box score wouldn't show, 'context' = tired/hurt)
  prompt_key  TEXT,
  body        TEXT NOT NULL,
  observed_on DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Player metrics — optional, never gate advice on presence
-- ----------------------------------------------------------------------------
-- Surface as trend only (minimum 3 readings). Never celebrate a single-session
-- jump — youth numbers are noisy. Never coach to the number at 8U.
CREATE TABLE IF NOT EXISTS player_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id    UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  player_id   UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  metric      TEXT NOT NULL
              CHECK (metric IN ('exit_velo', 'throw_velo', 'home_to_first', 'sixty')),
  value       NUMERIC NOT NULL,
  unit        TEXT,
  measured_on DATE NOT NULL,
  source      TEXT,
  note        TEXT,
  entry_id    UUID REFERENCES entries(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. Roster name mappings — confirm the mapping once, and it persists
-- ----------------------------------------------------------------------------
-- Box-score name strings ("C. Smith") map to a roster player. The coach
-- confirms once; later imports reuse it instead of re-asking every weekend.
CREATE TABLE IF NOT EXISTS roster_name_mappings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  source_name     TEXT NOT NULL,               -- as printed in the box score
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, source_name)
);

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE prescriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries               ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_metrics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_name_mappings  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own prescriptions') THEN
    CREATE POLICY "Coaches can manage own prescriptions" ON prescriptions FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own entries') THEN
    CREATE POLICY "Coaches can manage own entries" ON entries FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own observations') THEN
    CREATE POLICY "Coaches can manage own observations" ON observations FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own player metrics') THEN
    CREATE POLICY "Coaches can manage own player metrics" ON player_metrics FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own roster mappings') THEN
    CREATE POLICY "Coaches can manage own roster mappings" ON roster_name_mappings FOR ALL
      USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_entries_coach_id        ON entries(coach_id);
CREATE INDEX IF NOT EXISTS idx_entries_player_id       ON entries(player_id);
CREATE INDEX IF NOT EXISTS idx_entries_team_id         ON entries(team_id);
CREATE INDEX IF NOT EXISTS idx_entries_occurred_on     ON entries(occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_entries_prescription    ON entries(prescription_id);
CREATE INDEX IF NOT EXISTS idx_observations_entry_id   ON observations(entry_id);
CREATE INDEX IF NOT EXISTS idx_observations_player_id  ON observations(player_id);
CREATE INDEX IF NOT EXISTS idx_observations_team_id    ON observations(team_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_coach     ON prescriptions(coach_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_player    ON prescriptions(player_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_team      ON prescriptions(team_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status    ON prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_prescriptions_review    ON prescriptions(review_due_at);
CREATE INDEX IF NOT EXISTS idx_player_metrics_player   ON player_metrics(player_id);
CREATE INDEX IF NOT EXISTS idx_roster_mappings_team    ON roster_name_mappings(team_id);

-- ----------------------------------------------------------------------------
-- 8. Review queries
-- ----------------------------------------------------------------------------
-- Entries logged, by type:
--   SELECT entry_type, count(*) FROM entries GROUP BY entry_type;
-- Active prescriptions due for check-in:
--   SELECT id, priority, review_due_at FROM prescriptions
--   WHERE status = 'active' AND review_due_at <= NOW();
-- Adherence for a prescription (home sessions logged against it):
--   SELECT count(*) FROM entries
--   WHERE prescription_id = '<id>' AND entry_type = 'home_session';
