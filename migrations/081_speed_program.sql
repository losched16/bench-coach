-- ============================================================================
-- Migration 081: Speed, Agility & Explosiveness program (session layer)
-- ============================================================================
-- A reusable program a coach assigns to a player: one template, three levels
-- (Foundation / Development / Advanced), three session types, four weeks.
--
-- It sits ON TOP of the existing speed pathway (069-074). It does not replace
-- it and it writes nothing to it: no player_metrics, no pathway progress, no
-- practice plans. Additive and idempotent. Zero rows change in any existing
-- table.
--
-- THE SNAPSHOT RULE
--   speed_program_assignments.plan holds the full template (all three levels)
--   exactly as it stood when the coach assigned it. Template edits in code never
--   reach an existing assignment, so a player's sessions are always read against
--   the plan they were actually given. Coach modifications are events, applied
--   on top at read time; the snapshot itself never changes (trigger below).
--
-- HISTORY IS APPEND-ONLY
--   sessions, assessments and events are never updated or deleted by anyone,
--   service role included. A correction is a new row. The one exception is a
--   cascade from deleting the player or team, which is a privacy deletion.
--
-- NOT STORED: any verdict. Scores are the coach's 0-2 observations; assessment
-- comparisons are computed from stored numbers and conditions at read time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Assignment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.speed_program_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Denormalised: every policy is one function call on this column.
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  template_key     TEXT NOT NULL,
  template_version INT  NOT NULL,
  level            TEXT NOT NULL CHECK (level IN ('foundation', 'development', 'advanced')),
  space            TEXT NOT NULL CHECK (space IN ('indoor_small', 'outdoor_open')),
  days_per_week    INT  NOT NULL CHECK (days_per_week BETWEEN 1 AND 3),
  current_week     INT  NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 4),
  unlocks          TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  intake           JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan             JSONB NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT speed_program_completed_coherent CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT speed_program_plan_is_object CHECK (jsonb_typeof(plan) = 'object')
);

-- One live program per player, team and template. A finished one does not block
-- a new run later in the season.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_speed_program_live
  ON public.speed_program_assignments (player_id, team_id, template_key)
  WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_speed_program_player ON public.speed_program_assignments (player_id, team_id, status);
CREATE INDEX IF NOT EXISTS idx_speed_program_team ON public.speed_program_assignments (team_id, status);

CREATE OR REPLACE FUNCTION public.bc_speed_program_assignment_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.player_id IS DISTINCT FROM OLD.player_id
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.template_version IS DISTINCT FROM OLD.template_version THEN
    RAISE EXCEPTION 'speed_program_assignments: the plan snapshot, player, team and template are fixed once assigned';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_speed_program_assignment_guard ON public.speed_program_assignments;
CREATE TRIGGER trg_speed_program_assignment_guard
  BEFORE UPDATE ON public.speed_program_assignments
  FOR EACH ROW EXECUTE FUNCTION public.bc_speed_program_assignment_guard();

-- ---------------------------------------------------------------------------
-- 2. Sessions (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.speed_program_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES public.speed_program_assignments(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  week            INT  NOT NULL CHECK (week BETWEEN 1 AND 4),
  session_key     TEXT NOT NULL CHECK (session_key IN ('A', 'B', 'C')),
  status          TEXT NOT NULL CHECK (status IN ('completed', 'skipped')),
  skip_reason     TEXT CHECK (skip_reason IN ('game', 'practice', 'sick', 'travel', 'weather', 'space', 'other')),
  occurred_on     DATE NOT NULL,
  -- [{ exercise, sets_done, reps_done, skipped, note }]
  performed       JSONB NOT NULL DEFAULT '[]'::jsonb,
  effort          TEXT CHECK (effort IN ('easy', 'just_right', 'hard')),
  fatigue         TEXT CHECK (fatigue IN ('none', 'some', 'high')),
  -- Observed quality, 0-2. NULL means "not observed", never "zero".
  landing         INT CHECK (landing  BETWEEN 0 AND 2),
  braking         INT CHECK (braking  BETWEEN 0 AND 2),
  reaction        INT CHECK (reaction BETWEEN 0 AND 2),
  first_step_cue  TEXT,
  pain_flag       BOOLEAN NOT NULL DEFAULT FALSE,
  pain_note       TEXT,
  adjustments_note TEXT,
  coach_notes     TEXT,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT speed_sessions_skip_coherent CHECK (
    (status = 'skipped' AND skip_reason IS NOT NULL AND landing IS NULL AND braking IS NULL AND reaction IS NULL)
    OR (status = 'completed' AND skip_reason IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_speed_sessions_assignment ON public.speed_program_sessions (assignment_id, occurred_on, created_at);
CREATE INDEX IF NOT EXISTS idx_speed_sessions_player ON public.speed_program_sessions (player_id, team_id);

-- ---------------------------------------------------------------------------
-- 3. Assessments (append-only): baseline and retest, with the conditions
-- ---------------------------------------------------------------------------
-- Why not player_metrics: a time is only comparable under the same conditions
-- (surface, timing method, start cue, distance). player_metrics has nowhere to
-- keep them, so writing there would let two incomparable numbers sit side by
-- side as if they were. The metric slugs are the same as 073's.
CREATE TABLE IF NOT EXISTS public.speed_program_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES public.speed_program_assignments(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('baseline', 'retest')),
  method          TEXT NOT NULL CHECK (method IN ('timed', 'rubric')),
  metric_slug     TEXT CHECK (metric_slug IN ('sprint_10y', 'home_to_first')),
  value           NUMERIC CHECK (value > 0),
  unit            TEXT CHECK (unit = 's'),
  rubric          JSONB,
  conditions      JSONB,
  occurred_on     DATE NOT NULL,
  note            TEXT,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT speed_assess_shape CHECK (
    (method = 'timed'  AND metric_slug IS NOT NULL AND value IS NOT NULL AND unit = 's' AND conditions IS NOT NULL AND rubric IS NULL)
    OR
    (method = 'rubric' AND metric_slug IS NULL AND value IS NULL AND rubric IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_speed_assess_assignment ON public.speed_program_assessments (assignment_id, occurred_on, created_at);

-- ---------------------------------------------------------------------------
-- 4. Events (append-only): enrolment, coach adjustments, advances, pauses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.speed_program_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES public.speed_program_assignments(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('enrolled', 'adjustment', 'schedule', 'space', 'advance', 'pause', 'resume', 'complete')),
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- An override of the safety check carries a written reason, in the database
  -- and not only in the form.
  CONSTRAINT speed_events_override_has_reason CHECK (
    event_type <> 'advance'
    OR COALESCE(detail->>'override', 'false') <> 'true'
    OR length(btrim(COALESCE(reason, ''))) >= 10
  )
);
CREATE INDEX IF NOT EXISTS idx_speed_events_assignment ON public.speed_program_events (assignment_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Scope is derived from the assignment, never trusted from the writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bc_speed_program_child_scope()
RETURNS TRIGGER AS $$
BEGIN
  SELECT a.team_id, a.player_id INTO NEW.team_id, NEW.player_id
  FROM public.speed_program_assignments a WHERE a.id = NEW.assignment_id;
  IF NEW.team_id IS NULL THEN
    RAISE EXCEPTION 'speed program assignment % does not exist', NEW.assignment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.bc_speed_program_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only: record a new row instead of editing', TG_TABLE_NAME;
  END IF;
  -- A direct DELETE is refused. A cascade from deleting the player or team runs
  -- one trigger level deeper and is allowed (a privacy deletion).
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION '% is append-only: rows are retained', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['speed_program_sessions', 'speed_program_assessments', 'speed_program_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_scope ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_scope BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bc_speed_program_child_scope()', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bc_speed_program_append_only()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Exercise -> canonical drill mapping
-- ---------------------------------------------------------------------------
-- The pathway's exercises are mapped to existing library drills; nothing is
-- invented. match: exact | close | partial | none. A 'none' row means the
-- library has no drill yet and a draft awaits review (docs/speed-program).
-- drill_id is resolved by name below; it stays NULL if the drill is absent.
CREATE TABLE IF NOT EXISTS public.speed_program_exercise_drills (
  template_key  TEXT NOT NULL,
  exercise_key  TEXT NOT NULL,
  drill_name    TEXT,
  drill_id      UUID,
  match         TEXT NOT NULL CHECK (match IN ('exact', 'close', 'partial', 'none')),
  note          TEXT,
  PRIMARY KEY (template_key, exercise_key),
  CONSTRAINT speed_map_none_has_no_drill CHECK ((match = 'none') = (drill_name IS NULL))
);

INSERT INTO public.speed_program_exercise_drills (template_key, exercise_key, drill_name, match, note)
SELECT 'speed-agility-explosiveness', v.k, v.n, v.m, NULLIF(v.note, '')
FROM (VALUES
  ('warmup', 'Baseball Dynamic Stretches for Youth Players', 'partial', 'The library routine covers the dynamic stretching; the march, skips, gentle shuffle, backward turn-and-go and two gradual starts are in A-March and A-Skip.'),
  ('wall_drive', 'Wall Drive — Straight Body, Punch the Knee', 'exact', ''),
  ('falling_start', 'Falling Start — Fall, Then Go', 'exact', ''),
  ('accel_10', 'Ten-Yard Acceleration — Push, Push, Push', 'exact', ''),
  ('cone_reaction_chase', 'Tennis Ball Drop — See It, Go', 'close', 'Chase Start — Five-Yard Race is the competitive version.'),
  ('shuffle_stop', 'Snap Down — Get Under Control Fast', 'partial', 'Library drill teaches the controlled stop; the lateral shuffle into it is the exercise here.'),
  ('shuffle_plant_accel', 'Shuffle to Sprint — Open the Hips and Go', 'close', ''),
  ('half_circle_cut', 'Plant and Go — The 45-Degree Cut', 'partial', 'Closest library drill. The half-circle arc around three cones has no library drill yet; a draft is in docs/speed-program.'),
  ('react_roll_field', 'Four Cones Ground Ball Drill', 'partial', 'Same lateral move into a fielding position; the partner-rolled tennis ball is the reaction cue.'),
  ('pogo_jumps', 'Pogo Jumps — Quick, Quiet Contacts', 'exact', ''),
  ('broad_jump_freeze', 'Broad Jump — Jump and Stick It', 'exact', ''),
  ('skater_step_stick', NULL, 'none', 'No library drill covers a lateral single-leg landing. A draft is in docs/speed-program for review.'),
  ('infield_react_throw', 'Three-Ball Slow Roller Drill', 'partial', 'Charging under control and throwing on the move; the library drill is the closest match.'),
  ('broad_to_accel', 'Broad Jump — Jump and Stick It', 'partial', 'Library drill covers the jump and stick; the follow-on acceleration is a progression.')
) AS v(k, n, m, note)
ON CONFLICT (template_key, exercise_key) DO UPDATE
  SET drill_name = EXCLUDED.drill_name, match = EXCLUDED.match, note = EXCLUDED.note;

DO $$
BEGIN
  IF to_regclass('public.drill_resources') IS NOT NULL THEN
    UPDATE public.speed_program_exercise_drills m
       SET drill_id = (SELECT d.id FROM public.drill_resources d WHERE d.drill_name = m.drill_name ORDER BY d.id LIMIT 1)
     WHERE m.drill_name IS NOT NULL AND m.drill_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. RLS (role words only: bc_rank returns -1 for capability words)
-- ---------------------------------------------------------------------------
--   viewer       read
--   contributor  record what happened (a session, an assessment)
--   admin        decide what happens next (assign, adjust, advance)
-- No UPDATE or DELETE policy on the append-only tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['speed_program_assignments', 'speed_program_sessions', 'speed_program_assessments', 'speed_program_events', 'speed_program_exercise_drills'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT; rec RECORD;
BEGIN
  IF to_regprocedure('public.bc_team_at_least(uuid, text)') IS NULL THEN
    RAISE NOTICE 'bc_team_at_least absent: skipping speed program policies (plain Postgres).';
    RETURN;
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('speed_program_assignments', 'read',   'SELECT', 'viewer'),
      ('speed_program_assignments', 'ins',    'INSERT', 'admin'),
      ('speed_program_assignments', 'upd',    'UPDATE', 'admin'),
      ('speed_program_sessions',    'read',   'SELECT', 'viewer'),
      ('speed_program_sessions',    'ins',    'INSERT', 'contributor'),
      ('speed_program_assessments', 'read',   'SELECT', 'viewer'),
      ('speed_program_assessments', 'ins',    'INSERT', 'contributor'),
      ('speed_program_events',      'read',   'SELECT', 'viewer'),
      ('speed_program_events',      'ins',    'INSERT', 'admin')
    ) AS x(tbl, tag, cmd, min_role)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=rec.tbl AND policyname='bc_'||rec.tag||'_'||rec.tbl) THEN
      IF rec.cmd = 'SELECT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO public USING (public.bc_team_at_least(team_id, %L))', 'bc_'||rec.tag||'_'||rec.tbl, rec.tbl, rec.min_role);
      ELSIF rec.cmd = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO public WITH CHECK (public.bc_team_at_least(team_id, %L))', 'bc_'||rec.tag||'_'||rec.tbl, rec.tbl, rec.min_role);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO public USING (public.bc_team_at_least(team_id, %L)) WITH CHECK (public.bc_team_at_least(team_id, %L))', 'bc_'||rec.tag||'_'||rec.tbl, rec.tbl, rec.min_role, rec.min_role);
      END IF;
    END IF;
  END LOOP;

  -- The mapping is curriculum, not player data: any signed-in user may read it.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='speed_program_exercise_drills' AND policyname='bc_read_speed_program_exercise_drills') THEN
    CREATE POLICY bc_read_speed_program_exercise_drills ON public.speed_program_exercise_drills
      FOR SELECT TO public USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Grants: nothing to anon
-- ---------------------------------------------------------------------------
-- Supabase grants ALL on every new public table to anon, authenticated and
-- service_role by default. Start from nothing and grant only what is needed,
-- so the grants themselves say the tables are append-only and not for anon.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['speed_program_assignments', 'speed_program_sessions', 'speed_program_assessments', 'speed_program_events', 'speed_program_exercise_drills'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('REVOKE ALL ON public.%I FROM service_role', t); END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE ON public.speed_program_assignments TO authenticated;
    GRANT SELECT, INSERT ON public.speed_program_sessions, public.speed_program_assessments, public.speed_program_events TO authenticated;
    GRANT SELECT ON public.speed_program_exercise_drills TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.speed_program_assignments TO service_role;
    GRANT SELECT, INSERT ON public.speed_program_sessions, public.speed_program_assessments, public.speed_program_events TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.speed_program_exercise_drills TO service_role;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'speed_program%') AS new_tables,
  (SELECT count(*) FROM public.speed_program_exercise_drills)                                                    AS mapped_exercises,
  (SELECT count(*) FROM public.speed_program_exercise_drills WHERE match <> 'none' AND drill_id IS NULL)         AS mapped_but_unresolved;
