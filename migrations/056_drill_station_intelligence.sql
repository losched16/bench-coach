-- ============================================================================
-- 056 — Drill & Station Intelligence, phase 1
-- ============================================================================
--
-- WHAT THIS IS FOR
--
-- The library already knows what a drill teaches. It does not know whether the
-- drill can be RUN: how many players it needs, how many coaches, whether three
-- of them can go at once as stations, whether it keeps eleven-year-olds moving
-- or leaves nine of them standing in a line.
--
-- Every column here exists to answer one of those, and every one is nullable.
-- 206 curated rows have none of this yet, and a drill with unknown logistics
-- must stay eligible — the retrieval rule this codebase already runs on is
-- "absence is not a constraint", and a NOT NULL default would quietly convert
-- silence into a claim.
--
-- WHAT THE BRIEF ASKED FOR AND THIS DOES NOT ADD
--
--   review_status   — `status` already carries approved/pending_review/retired
--   source_quality  — `source` already records where a drill came from
--
-- Adding either would create a second answer to a question the table already
-- answers, and the two would drift. Where an existing column has the semantics,
-- the existing column wins.
--
-- WHAT ALREADY EXISTS AND IS DELIBERATELY REUSED
--
--   difficulty_level    beginner / intermediate / advanced  (the ability axis)
--   min_age, max_age    the age axis — kept HARD, and independent of ability
--   progression_level   1..4, foundational first
--   requires_partner    a two-person minimum, predating min_players
--   space_required      small / medium / full field
--   indoor_outdoor      indoor / outdoor / both
--   equipment_needed    text[]
--   est_duration_minutes
--   competition_level   rec / travel / both — see 5 below
--
-- Additive and idempotent. Existing rows keep working with every new column
-- NULL, which is the state all 206 of them start in.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Activity families
--
-- "Basic Ground Balls", "Protect the Castle" and "Protect the Castle + Throw"
-- are three activities teaching one thing at three points on a progression.
-- Today the scheduler can only tell they are different because their names and
-- videos differ, which makes a genuine progression look like variety and two
-- cuts of the same film look like a progression.
--
-- A family is the canonical concept. The variation_type on each drill says
-- where in the family it sits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drill_activity_families (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  primary_skill TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.drill_activity_families IS
  'Canonical activity concepts. Several drill_resources rows may be variations of one family.';

ALTER TABLE public.drill_activity_families ENABLE ROW LEVEL SECURITY;

-- Reference data, same shape as drill_resources: readable by anyone, written
-- only by the service role. Wrapped so this also applies to a plain Postgres
-- used by the bootstrap test, where Supabase's roles do not exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drill_activity_families'
      AND policyname = 'Activity families are publicly readable'
  ) THEN
    CREATE POLICY "Activity families are publicly readable"
      ON public.drill_activity_families FOR SELECT TO public USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drill_activity_families'
      AND policyname = 'Service role can manage activity families'
  ) THEN
    CREATE POLICY "Service role can manage activity families"
      ON public.drill_activity_families FOR ALL TO public
      USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.drill_activity_families TO %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT INSERT, UPDATE, DELETE ON public.drill_activity_families TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The new columns on drill_resources
-- ---------------------------------------------------------------------------
ALTER TABLE public.drill_resources
  -- Family membership. Nullable: most of the library will never be classified,
  -- and the redundancy fallback on names and video ids still covers those.
  ADD COLUMN IF NOT EXISTS activity_family_id UUID
    REFERENCES public.drill_activity_families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variation_type TEXT,

  -- How the activity is organised on the field.
  ADD COLUMN IF NOT EXISTS activity_format TEXT,
  -- Where it belongs in the arc of a practice. An array because a competitive
  -- ground-ball game is genuinely both repetition and competition.
  ADD COLUMN IF NOT EXISTS practice_roles TEXT[],

  -- Feasibility. min_* are HARD when both the requirement and the count are
  -- known; ideal_group_size is soft and only shapes station composition.
  ADD COLUMN IF NOT EXISTS min_players INT,
  ADD COLUMN IF NOT EXISTS max_players INT,
  ADD COLUMN IF NOT EXISTS ideal_group_size INT,
  ADD COLUMN IF NOT EXISTS min_coaches INT,
  ADD COLUMN IF NOT EXISTS station_friendly BOOLEAN,

  -- Engagement. The question these answer is "how many kids are standing
  -- still", which is the difference between a practice parents come back to
  -- and one they do not.
  ADD COLUMN IF NOT EXISTS rep_density TEXT,
  ADD COLUMN IF NOT EXISTS idle_time_risk TEXT,
  ADD COLUMN IF NOT EXISTS engagement_level TEXT,
  ADD COLUMN IF NOT EXISTS competition_style TEXT,
  ADD COLUMN IF NOT EXISTS instruction_complexity TEXT,

  -- Load. Practice composition, NOT medical workload — this exists so a plan
  -- does not stack four high-throwing blocks when equally relevant
  -- alternatives are available. It is not pitch-count science.
  ADD COLUMN IF NOT EXISTS throwing_load TEXT,
  ADD COLUMN IF NOT EXISTS physical_intensity TEXT,

  -- Whether one group can hold a wide range of abilities at once, which is the
  -- normal condition of a rec team and the thing that makes or breaks a station.
  ADD COLUMN IF NOT EXISTS mixed_skill_friendly BOOLEAN,

  -- The progression story in the coach's words. Prose, because "make it easier
  -- by moving the castle closer" is not an enum.
  ADD COLUMN IF NOT EXISTS regression_notes TEXT,
  ADD COLUMN IF NOT EXISTS progression_notes TEXT,
  ADD COLUMN IF NOT EXISTS advanced_progression_notes TEXT;

-- ---------------------------------------------------------------------------
-- 3. Constrained vocabularies
--
-- NOT VALID is deliberate on none of these: every existing row is NULL, so
-- there is nothing to validate against and the checks are cheap. Each allows
-- NULL, because unknown is a real and common answer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('variation_type',         ARRAY['base','regression','progression','advanced','game','competitive','equipment_variant','space_variant']),
      ('activity_format',        ARRAY['individual','partner','small_group','station','full_team','game']),
      ('rep_density',            ARRAY['low','medium','high']),
      ('idle_time_risk',         ARRAY['low','medium','high']),
      ('engagement_level',       ARRAY['low','medium','high']),
      ('competition_style',      ARRAY['none','scored','head_to_head','team_vs_team','game']),
      ('instruction_complexity', ARRAY['low','medium','high']),
      ('throwing_load',          ARRAY['none','low','medium','high']),
      ('physical_intensity',     ARRAY['low','medium','high'])
    ) AS t(col, allowed)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.drill_resources'::regclass
        AND conname = 'drill_resources_' || spec.col || '_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.drill_resources ADD CONSTRAINT %I CHECK (%I IS NULL OR %I = ANY (%L))',
        'drill_resources_' || spec.col || '_check', spec.col, spec.col, spec.allowed
      );
    END IF;
  END LOOP;
END $$;

-- Counts must be sane. A min_players of 0 or a max below the min is a data
-- entry error, and catching it here is cheaper than debugging an empty
-- candidate pool later.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.drill_resources'::regclass
                   AND conname = 'drill_resources_player_counts_check') THEN
    ALTER TABLE public.drill_resources ADD CONSTRAINT drill_resources_player_counts_check
      CHECK (
        (min_players      IS NULL OR min_players      >= 1) AND
        (max_players      IS NULL OR max_players      >= 1) AND
        (ideal_group_size IS NULL OR ideal_group_size >= 1) AND
        (min_coaches      IS NULL OR min_coaches      >= 0) AND
        (min_players IS NULL OR max_players IS NULL OR max_players >= min_players)
      );
  END IF;
END $$;

-- practice_roles is free-form at the column level but should only hold known
-- values. A CHECK over an array needs a subquery-free expression, so this uses
-- containment against the allowed set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.drill_resources'::regclass
                   AND conname = 'drill_resources_practice_roles_check') THEN
    ALTER TABLE public.drill_resources ADD CONSTRAINT drill_resources_practice_roles_check
      CHECK (
        practice_roles IS NULL OR
        practice_roles <@ ARRAY[
          'warmup','teach','isolate','repetition','progress','decision',
          'competition','game_application','team_execution','assessment','finish'
        ]::TEXT[]
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Indexes
--
-- Only where a query will actually use them. Retrieval loads the whole library
-- into memory and ranks it there, so most of these columns are never a WHERE
-- clause — the two that are worth indexing are the family join and the station
-- lookup, which the scheduler asks for by itself.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_drill_resources_family
  ON public.drill_resources (activity_family_id)
  WHERE activity_family_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drill_resources_station
  ON public.drill_resources (station_friendly)
  WHERE station_friendly IS TRUE;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Every existing row must be untouched and every new column NULL:
--
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE activity_family_id IS NOT NULL) AS with_family,
--          count(*) FILTER (WHERE station_friendly IS NOT NULL)   AS with_station,
--          count(*) FILTER (WHERE min_players IS NOT NULL)        AS with_min_players
--   FROM drill_resources;
--
-- Immediately after this migration, expect total = 206 and the rest 0.
-- Calibration data arrives in 057.
