-- ============================================================================
-- Migration 085: Development Programs
-- ============================================================================
-- A Development Program is a time-bound, scheduled, executable plan for ONE
-- player: weeks of sessions, each with ordered drills, that a parent can open
-- on the day and run.
--
-- HOW IT RELATES TO WHAT ALREADY EXISTS (nothing is replaced)
--
--   Playbooks              teach a skill; untouched.
--   Development plans      (player_pathway_progress) are the long-lived
--     (pathways)           "which stage is he on". A program REFERENCES them
--                          (program_skills.progress_id) and logs its sessions
--                          into them as 'session_logged' events. It never
--                          advances a stage — a coach does that.
--   drill_resources        the drill library. Program drills point at it by id
--                          (program_session_drills.drill_id). No drill is
--                          copied or duplicated here.
--   player_metrics         the one place a measurement lives. Program
--                          assessments are written THERE (with program_id and
--                          a checkpoint label) so Player Reports and the
--                          metrics page see them. There is no assessments
--                          table, on purpose.
--
-- DRAFT vs SAVED
--
-- An AI-generated program is a DRAFT (development_program_drafts, one JSON
-- document) until a coach with 'decide' approves it. Only then does
-- bc_save_development_program() materialise normalised rows, in one
-- transaction, idempotently (one program per draft). Nothing the model wrote
-- is a coaching record before that.
--
-- COMPLETED HISTORY IS IMMUTABLE
--
-- Once a session is completed its schedule, content and drills cannot be
-- edited (trigger below). Un-completing is its own function.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drafts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.development_program_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  thread_id        UUID REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved', 'discarded')),
  -- Optimistic concurrency: an edit names the version it started from.
  version          INT  NOT NULL DEFAULT 1,
  payload          JSONB NOT NULL,
  saved_program_id UUID,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dp_drafts_player ON public.development_program_drafts (player_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dp_drafts_thread ON public.development_program_drafts (thread_id) WHERE thread_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Programs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.development_programs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  summary          TEXT,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  version          INT  NOT NULL DEFAULT 1,
  -- The program only exists because a person approved it.
  approval_state   TEXT NOT NULL DEFAULT 'approved' CHECK (approval_state = 'approved'),
  approved_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ONE program per draft. This is the idempotency key for saving.
  source_draft_id  UUID UNIQUE,
  -- What the generator knew and decided, kept small: brief, assumptions,
  -- throwing gate, progression rules, weekly load, curation flags, evidence
  -- labels. NOT the player's history.
  source           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dp_dates_ordered CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_dev_programs_player ON public.development_programs (player_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_dev_programs_team ON public.development_programs (team_id, status);

CREATE TABLE IF NOT EXISTS public.program_phases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id               UUID NOT NULL REFERENCES public.development_programs(id) ON DELETE CASCADE,
  phase_order              INT  NOT NULL,
  phase_key                TEXT NOT NULL,
  name                     TEXT NOT NULL,
  start_date               DATE NOT NULL,
  end_date                 DATE NOT NULL,
  goals                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills                   TEXT[] NOT NULL DEFAULT '{}',
  progression_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty               TEXT,
  UNIQUE (program_id, phase_order)
);

CREATE TABLE IF NOT EXISTS public.program_skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    UUID NOT NULL REFERENCES public.development_programs(id) ON DELETE CASCADE,
  skill         TEXT NOT NULL,
  label         TEXT NOT NULL,
  -- 1 = most training time. Never removes a goal.
  priority      INT  NOT NULL CHECK (priority >= 1),
  rationale     TEXT,
  baseline      TEXT,
  target        TEXT,
  current_stage TEXT,
  -- The existing development plan this skill continues, if any.
  progress_id   UUID REFERENCES public.player_pathway_progress(id) ON DELETE SET NULL,
  UNIQUE (program_id, skill)
);

CREATE TABLE IF NOT EXISTS public.program_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            UUID NOT NULL REFERENCES public.development_programs(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id               UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Stable within a program ('w3d2', and 'w3d2i' for the independent routine).
  session_key           TEXT NOT NULL,
  week                  INT  NOT NULL,
  scheduled_date        DATE NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('coached','independent','strength','throwing','assessment','team','recovery','rest')),
  supervision           TEXT NOT NULL CHECK (supervision IN ('independent','parent','coach')),
  title                 TEXT NOT NULL,
  focus                 TEXT[] NOT NULL DEFAULT '{}',
  est_minutes           INT  NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','completed','skipped')),
  checkpoint            TEXT CHECK (checkpoint IN ('baseline','midpoint','final')),
  -- Planned measurements for a checkpoint session: [{metricSlug,label,protocol,...}]
  assessments           JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_throwing_gate BOOLEAN NOT NULL DEFAULT FALSE,
  coach_note            TEXT,
  filming_note          TEXT,
  equipment             TEXT[] NOT NULL DEFAULT '{}',
  origin                TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai','coach')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_program_sessions_date ON public.program_sessions (program_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_program_sessions_player_date ON public.program_sessions (player_id, scheduled_date);

CREATE TABLE IF NOT EXISTS public.program_session_drills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES public.program_sessions(id) ON DELETE CASCADE,
  position       INT  NOT NULL,
  block_index    INT  NOT NULL,
  block_kind     TEXT NOT NULL CHECK (block_kind IN ('warmup','skill','strength','throwing','assessment','cooldown')),
  block_title    TEXT NOT NULL,
  block_minutes  INT  NOT NULL,
  skill          TEXT,
  -- The library drill. NULL only for built-in program exercises (exercise_key).
  drill_id       UUID REFERENCES public.drill_resources(id) ON DELETE SET NULL,
  exercise_key   TEXT,
  name           TEXT NOT NULL,
  minutes        INT  NOT NULL,
  sets           INT,
  reps           TEXT,
  rest           TEXT,
  intensity      TEXT NOT NULL DEFAULT 'moderate' CHECK (intensity IN ('easy','moderate','fast','game_speed')),
  instructions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  cues           JSONB NOT NULL DEFAULT '[]'::jsonb,
  success        JSONB NOT NULL DEFAULT '[]'::jsonb,
  modification   TEXT,
  equipment      JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (session_id, position)
);

-- One completion per session. A second tap corrects it.
CREATE TABLE IF NOT EXISTS public.program_session_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL UNIQUE REFERENCES public.program_sessions(id) ON DELETE CASCADE,
  program_id      UUID NOT NULL REFERENCES public.development_programs(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  completed_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actual_minutes  INT,
  -- [{ "position": 3, "done": true, "rating": "easy|right|hard" }]
  drills_done     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { "<skill>": "easy|right|hard" }
  ratings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  pain_reported   BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  -- A parent helper may record that it happened; a head coach confirms it.
  coach_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_program_completions_program ON public.program_session_completions (program_id, completed_on DESC);

CREATE TABLE IF NOT EXISTS public.program_revisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES public.development_programs(id) ON DELETE CASCADE,
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  from_version     INT NOT NULL,
  to_version       INT,
  summary          TEXT NOT NULL,
  proposed_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','rejected')),
  proposed_by      TEXT NOT NULL DEFAULT 'ai' CHECK (proposed_by IN ('ai','coach')),
  decided_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rev_decided_coherent CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_program_revisions_program ON public.program_revisions (program_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Assessments are player_metrics rows — extend, don't duplicate
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_metrics
  ADD COLUMN IF NOT EXISTS program_id         UUID REFERENCES public.development_programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_session_id UUID REFERENCES public.program_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkpoint         TEXT CHECK (checkpoint IN ('baseline','midpoint','final','session')),
  ADD COLUMN IF NOT EXISTS conditions         TEXT;
CREATE INDEX IF NOT EXISTS idx_player_metrics_program ON public.player_metrics (program_id) WHERE program_id IS NOT NULL;

-- System metric presets the program's assessments need. Same pattern as 073:
-- coach_id is NULL, so ON CONFLICT cannot be the guard.
INSERT INTO public.metric_types (coach_id, slug, label, unit, shape, direction, default_attempts, hint, sort_order)
SELECT v.coach_id, v.slug, v.label, v.unit, v.shape, v.direction, v.default_attempts, v.hint, v.sort_order
FROM (VALUES
  (NULL::uuid, 'sprint_5y',               '5 yard acceleration',               'sec', 'measurement', 'lower',  NULL::int, 'Standing start, best of two. Same surface and shoes.', 41),
  (NULL::uuid, 'first_step_pct',          'Correct first step',                NULL,  'challenge',   'higher', 10,        'Reaction starts with a clean first push, out of 10.', 42),
  (NULL::uuid, 'first_step_outfield_pct', 'Outfield first step, right direction', NULL,'challenge',   'higher', 10,        'Fly balls where the first move was correct, out of 10.', 43),
  (NULL::uuid, 'fly_ball_catch_pct',      'Fly balls caught',                  NULL,  'challenge',   'higher', 10,        'Same thrower, distance and mix each time.', 44),
  (NULL::uuid, 'clean_fielding_pct',      'Grounders fielded cleanly',         NULL,  'challenge',   'higher', 10,        'Same speed and distance each time.', 45),
  (NULL::uuid, 'contact_quality_pct',     'Solid contact',                     NULL,  'challenge',   'higher', 10,        'Solid, centred contact out of 10 tee swings.', 46),
  (NULL::uuid, 'balance_hold_sec',        'Single-leg balance hold',           'sec', 'measurement', 'higher', NULL::int, 'Weaker leg, eyes open, stop at 30 seconds.', 47)
) AS v(coach_id, slug, label, unit, shape, direction, default_attempts, hint, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.metric_types m WHERE m.coach_id IS NULL AND m.slug = v.slug);

-- ---------------------------------------------------------------------------
-- 4. Completed history is immutable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bc_program_session_frozen()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'A completed program session cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'completed' AND NEW.status = 'completed'
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'A completed program session cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_program_session_frozen ON public.program_sessions;
CREATE TRIGGER trg_program_session_frozen
  BEFORE UPDATE OR DELETE ON public.program_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bc_program_session_frozen();

CREATE OR REPLACE FUNCTION public.bc_program_drill_frozen()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT; v_id UUID;
BEGIN
  v_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.session_id ELSE OLD.session_id END;
  SELECT status INTO v_status FROM public.program_sessions WHERE id = v_id;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'The drills of a completed program session cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_program_drill_frozen ON public.program_session_drills;
CREATE TRIGGER trg_program_drill_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.program_session_drills
  FOR EACH ROW EXECUTE FUNCTION public.bc_program_drill_frozen();

-- ---------------------------------------------------------------------------
-- 5. Save a draft — one transaction, idempotent
-- ---------------------------------------------------------------------------
-- p_payload (built by lib/programs/store.ts from the validated draft):
--   { program: {title, summary, start_date, end_date, source},
--     phases:   [{phase_order, phase_key, name, start_date, end_date, goals, skills[], progression_requirements, difficulty}],
--     skills:   [{skill, label, priority, rationale, baseline, target, current_stage, progress_id}],
--     sessions: [{session_key, week, scheduled_date, kind, supervision, title, focus[], est_minutes, checkpoint,
--                 assessments, requires_throwing_gate, coach_note, filming_note, equipment[], origin,
--                 drills: [{position, block_index, block_kind, block_title, block_minutes, skill, drill_id,
--                           exercise_key, name, minutes, sets, reps, rest, intensity, instructions, cues,
--                           success, modification, equipment}]}] }
--
-- Called with the service role only; the route has already authorised the
-- caller for 'decide' on the draft's team.
CREATE OR REPLACE FUNCTION public.bc_save_development_program(
  p_draft_id UUID,
  p_actor    UUID,
  p_payload  JSONB
)
RETURNS TABLE (ok BOOLEAN, reason TEXT, program_id UUID, already_saved BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d        public.development_program_drafts%ROWTYPE;
  v_prog   UUID;
  s        JSONB;
  v_sess   UUID;
BEGIN
  SELECT * INTO d FROM public.development_program_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'draft_not_found', NULL::UUID, FALSE; RETURN;
  END IF;

  -- Idempotent: a second approval returns the program the first one made.
  IF d.status = 'saved' AND d.saved_program_id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, 'already_saved', d.saved_program_id, TRUE; RETURN;
  END IF;
  IF d.status <> 'draft' THEN
    RETURN QUERY SELECT FALSE, 'draft_not_open', NULL::UUID, FALSE; RETURN;
  END IF;

  INSERT INTO public.development_programs
    (team_id, player_id, title, summary, start_date, end_date, approved_by, source_draft_id, source, created_by)
  VALUES
    (d.team_id, d.player_id,
     p_payload->'program'->>'title', p_payload->'program'->>'summary',
     (p_payload->'program'->>'start_date')::date, (p_payload->'program'->>'end_date')::date,
     p_actor, d.id, COALESCE(p_payload->'program'->'source', '{}'::jsonb), p_actor)
  RETURNING id INTO v_prog;

  INSERT INTO public.program_phases
    (program_id, phase_order, phase_key, name, start_date, end_date, goals, skills, progression_requirements, difficulty)
  SELECT v_prog, x.phase_order, x.phase_key, x.name, x.start_date, x.end_date,
         COALESCE(x.goals, '[]'::jsonb),
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(x.skills)), '{}'),
         COALESCE(x.progression_requirements, '[]'::jsonb), x.difficulty
  FROM jsonb_to_recordset(p_payload->'phases') AS x(
    phase_order INT, phase_key TEXT, name TEXT, start_date DATE, end_date DATE,
    goals JSONB, skills JSONB, progression_requirements JSONB, difficulty TEXT);

  -- progress_id must belong to THIS player and team, or it is dropped: a
  -- program cannot be pointed at somebody else's development plan.
  INSERT INTO public.program_skills
    (program_id, skill, label, priority, rationale, baseline, target, current_stage, progress_id)
  SELECT v_prog, x.skill, x.label, x.priority, x.rationale, x.baseline, x.target, x.current_stage,
         (SELECT p.id FROM public.player_pathway_progress p
           WHERE p.id = x.progress_id AND p.player_id = d.player_id AND p.team_id = d.team_id)
  FROM jsonb_to_recordset(p_payload->'skills') AS x(
    skill TEXT, label TEXT, priority INT, rationale TEXT, baseline TEXT, target TEXT, current_stage TEXT, progress_id UUID);

  FOR s IN SELECT * FROM jsonb_array_elements(p_payload->'sessions') LOOP
    INSERT INTO public.program_sessions
      (program_id, player_id, team_id, session_key, week, scheduled_date, kind, supervision, title, focus, est_minutes,
       checkpoint, assessments, requires_throwing_gate, coach_note, filming_note, equipment, origin)
    VALUES
      (v_prog, d.player_id, d.team_id, s->>'session_key', (s->>'week')::int, (s->>'scheduled_date')::date,
       s->>'kind', s->>'supervision', s->>'title',
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'focus')), '{}'),
       COALESCE((s->>'est_minutes')::int, 0), NULLIF(s->>'checkpoint', ''),
       COALESCE(s->'assessments', '[]'::jsonb), COALESCE((s->>'requires_throwing_gate')::boolean, FALSE),
       s->>'coach_note', s->>'filming_note',
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'equipment')), '{}'),
       COALESCE(s->>'origin', 'ai'))
    RETURNING id INTO v_sess;

    INSERT INTO public.program_session_drills
      (session_id, position, block_index, block_kind, block_title, block_minutes, skill, drill_id, exercise_key, name,
       minutes, sets, reps, rest, intensity, instructions, cues, success, modification, equipment)
    SELECT v_sess, x.position, x.block_index, x.block_kind, x.block_title, x.block_minutes, x.skill, x.drill_id,
           x.exercise_key, x.name, x.minutes, x.sets, x.reps, x.rest, COALESCE(x.intensity, 'moderate'),
           COALESCE(x.instructions, '[]'::jsonb), COALESCE(x.cues, '[]'::jsonb), COALESCE(x.success, '[]'::jsonb),
           x.modification, COALESCE(x.equipment, '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(s->'drills', '[]'::jsonb)) AS x(
      position INT, block_index INT, block_kind TEXT, block_title TEXT, block_minutes INT, skill TEXT, drill_id UUID,
      exercise_key TEXT, name TEXT, minutes INT, sets INT, reps TEXT, rest TEXT, intensity TEXT,
      instructions JSONB, cues JSONB, success JSONB, modification TEXT, equipment JSONB);
  END LOOP;

  UPDATE public.development_program_drafts
     SET status = 'saved', saved_program_id = v_prog, updated_at = NOW()
   WHERE id = d.id;

  RETURN QUERY SELECT TRUE, 'saved', v_prog, FALSE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Complete / un-complete a session
-- ---------------------------------------------------------------------------
-- Writes the completion, flips the session's status and replaces this
-- session's measurements — all or nothing, so completion state cannot
-- disagree with itself. Also logs a 'session_logged' event on each linked
-- development plan (once per session) so pathway session counts reflect work
-- done through a program. It never advances a stage.
--
-- p_readings: [{metric_type_id, metric, value, unit, attempts, successes, checkpoint, conditions}]
CREATE OR REPLACE FUNCTION public.bc_complete_program_session(
  p_session    UUID,
  p_actor      UUID,
  p_confirmed  BOOLEAN,
  p_on         DATE,
  p_minutes    INT,
  p_drills     JSONB,
  p_ratings    JSONB,
  p_pain       BOOLEAN,
  p_notes      TEXT,
  p_readings   JSONB
)
RETURNS TABLE (ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ps   public.program_sessions%ROWTYPE;
  v_coach UUID;
  r    JSONB;
  v_prog_skill RECORD;
BEGIN
  SELECT * INTO ps FROM public.program_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'session_not_found'; RETURN; END IF;
  IF ps.kind = 'rest' THEN RETURN QUERY SELECT FALSE, 'rest_day'; RETURN; END IF;

  INSERT INTO public.program_session_completions
    (session_id, program_id, player_id, team_id, completed_on, completed_by, actual_minutes,
     drills_done, ratings, pain_reported, notes, coach_confirmed, confirmed_by)
  VALUES
    (ps.id, ps.program_id, ps.player_id, ps.team_id, COALESCE(p_on, CURRENT_DATE), p_actor, p_minutes,
     COALESCE(p_drills, '[]'::jsonb), COALESCE(p_ratings, '{}'::jsonb), COALESCE(p_pain, FALSE), p_notes,
     COALESCE(p_confirmed, FALSE), CASE WHEN p_confirmed THEN p_actor END)
  ON CONFLICT (session_id) DO UPDATE SET
    completed_on = EXCLUDED.completed_on, completed_by = EXCLUDED.completed_by, actual_minutes = EXCLUDED.actual_minutes,
    drills_done = EXCLUDED.drills_done, ratings = EXCLUDED.ratings, pain_reported = EXCLUDED.pain_reported,
    notes = EXCLUDED.notes, coach_confirmed = EXCLUDED.coach_confirmed, confirmed_by = EXCLUDED.confirmed_by;

  IF ps.status <> 'completed' THEN
    UPDATE public.program_sessions SET status = 'completed' WHERE id = ps.id;
  END IF;

  -- Measurements recorded at this session replace any earlier ones from it.
  IF p_readings IS NOT NULL AND jsonb_typeof(p_readings) = 'array' THEN
    SELECT c.id INTO v_coach FROM public.teams t JOIN public.coaches c ON c.id = t.coach_id WHERE t.id = ps.team_id;
    DELETE FROM public.player_metrics WHERE program_session_id = ps.id;
    FOR r IN SELECT * FROM jsonb_array_elements(p_readings) LOOP
      INSERT INTO public.player_metrics
        (coach_id, player_id, team_id, metric, value, unit, measured_on, source, note,
         metric_type_id, attempts, successes, program_id, program_session_id, checkpoint, conditions)
      VALUES
        (v_coach, ps.player_id, ps.team_id, r->>'metric', (r->>'value')::numeric, r->>'unit',
         COALESCE(p_on, CURRENT_DATE), 'program', r->>'note',
         NULLIF(r->>'metric_type_id', '')::uuid, NULLIF(r->>'attempts', '')::int, NULLIF(r->>'successes', '')::int,
         ps.program_id, ps.id, COALESCE(NULLIF(r->>'checkpoint', ''), 'session'), r->>'conditions');
    END LOOP;
  END IF;

  -- Development-plan session counts. Once per (plan, program session).
  FOR v_prog_skill IN
    SELECT DISTINCT sk.progress_id
    FROM public.program_skills sk
    WHERE sk.program_id = ps.program_id AND sk.progress_id IS NOT NULL AND sk.skill = ANY (ps.focus)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.player_pathway_events e
      WHERE e.progress_id = v_prog_skill.progress_id AND e.event_type = 'session_logged'
        AND e.detail->>'program_session_id' = ps.id::text
    ) THEN
      INSERT INTO public.player_pathway_events (progress_id, team_id, event_type, detail, actor_user_id, occurred_on)
      VALUES (v_prog_skill.progress_id, ps.team_id, 'session_logged',
              jsonb_build_object('minutes', p_minutes, 'program_session_id', ps.id, 'program_id', ps.program_id),
              p_actor, COALESCE(p_on, CURRENT_DATE));
    END IF;
  END LOOP;

  RETURN QUERY SELECT TRUE, 'completed';
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_uncomplete_program_session(p_session UUID)
RETURNS TABLE (ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.program_sessions WHERE id = p_session) THEN
    RETURN QUERY SELECT FALSE, 'session_not_found'; RETURN;
  END IF;
  DELETE FROM public.player_metrics WHERE program_session_id = p_session;
  DELETE FROM public.player_pathway_events WHERE event_type = 'session_logged' AND detail->>'program_session_id' = p_session::text;
  DELETE FROM public.program_session_completions WHERE session_id = p_session;
  UPDATE public.program_sessions SET status = 'planned' WHERE id = p_session;
  RETURN QUERY SELECT TRUE, 'reopened';
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Apply an approved revision to FUTURE planned sessions only
-- ---------------------------------------------------------------------------
-- p_patch: [{session_key, est_minutes, requires_throwing_gate, drills:[...same shape as save]}]
-- Completed sessions are skipped (and the trigger would refuse them anyway).
CREATE OR REPLACE FUNCTION public.bc_apply_program_revision(p_revision UUID, p_actor UUID, p_patch JSONB)
RETURNS TABLE (ok BOOLEAN, reason TEXT, new_version INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rv public.program_revisions%ROWTYPE;
  prog public.development_programs%ROWTYPE;
  s JSONB; v_sess UUID; v_status TEXT; v_new INT;
BEGIN
  SELECT * INTO rv FROM public.program_revisions WHERE id = p_revision FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'revision_not_found', NULL::INT; RETURN; END IF;
  IF rv.status <> 'proposed' THEN RETURN QUERY SELECT FALSE, 'already_decided', rv.to_version; RETURN; END IF;
  SELECT * INTO prog FROM public.development_programs WHERE id = rv.program_id FOR UPDATE;
  IF prog.version <> rv.from_version THEN RETURN QUERY SELECT FALSE, 'program_changed_since_proposal', prog.version; RETURN; END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_patch, '[]'::jsonb)) LOOP
    SELECT id, status INTO v_sess, v_status FROM public.program_sessions
     WHERE program_id = prog.id AND session_key = s->>'session_key';
    CONTINUE WHEN v_sess IS NULL OR v_status <> 'planned';
    DELETE FROM public.program_session_drills WHERE session_id = v_sess;
    INSERT INTO public.program_session_drills
      (session_id, position, block_index, block_kind, block_title, block_minutes, skill, drill_id, exercise_key, name,
       minutes, sets, reps, rest, intensity, instructions, cues, success, modification, equipment)
    SELECT v_sess, x.position, x.block_index, x.block_kind, x.block_title, x.block_minutes, x.skill, x.drill_id,
           x.exercise_key, x.name, x.minutes, x.sets, x.reps, x.rest, COALESCE(x.intensity, 'moderate'),
           COALESCE(x.instructions, '[]'::jsonb), COALESCE(x.cues, '[]'::jsonb), COALESCE(x.success, '[]'::jsonb),
           x.modification, COALESCE(x.equipment, '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(s->'drills', '[]'::jsonb)) AS x(
      position INT, block_index INT, block_kind TEXT, block_title TEXT, block_minutes INT, skill TEXT, drill_id UUID,
      exercise_key TEXT, name TEXT, minutes INT, sets INT, reps TEXT, rest TEXT, intensity TEXT,
      instructions JSONB, cues JSONB, success JSONB, modification TEXT, equipment JSONB);
    UPDATE public.program_sessions
       SET est_minutes = COALESCE((s->>'est_minutes')::int, est_minutes),
           requires_throwing_gate = COALESCE((s->>'requires_throwing_gate')::boolean, requires_throwing_gate),
           origin = 'coach'
     WHERE id = v_sess;
  END LOOP;

  v_new := prog.version + 1;
  UPDATE public.development_programs SET version = v_new, updated_at = NOW() WHERE id = prog.id;
  UPDATE public.program_revisions SET status = 'applied', to_version = v_new, decided_by = p_actor, decided_at = NOW() WHERE id = rv.id;
  RETURN QUERY SELECT TRUE, 'applied', v_new;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS — a child's training record
-- ---------------------------------------------------------------------------
-- Same split as 072: viewer reads; contributor records what happened; admin
-- decides what happens next. The app writes through the service role after its
-- own authorisation, so these policies are the database refusing everyone else.
-- No grant to anon: there is no signed-out view of a child's program.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['development_program_drafts','development_programs','program_phases','program_skills',
                           'program_sessions','program_session_drills','program_session_completions','program_revisions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.bc_team_at_least(uuid, text)') IS NULL THEN
    RAISE NOTICE 'bc_team_at_least absent — skipping program policies (plain Postgres).';
    RETURN;
  END IF;

  -- Tables carrying team_id directly.
  FOREACH t IN ARRAY ARRAY['development_program_drafts','development_programs','program_sessions','program_session_completions','program_revisions']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='bc_read_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO public USING (public.bc_team_at_least(team_id, %L))', 'bc_read_'||t, t, 'viewer');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='bc_write_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (public.bc_team_at_least(team_id, %L)) WITH CHECK (public.bc_team_at_least(team_id, %L))',
                     'bc_write_'||t, t, CASE WHEN t = 'program_session_completions' THEN 'contributor' ELSE 'admin' END,
                     CASE WHEN t = 'program_session_completions' THEN 'contributor' ELSE 'admin' END);
    END IF;
  END LOOP;

  -- Child tables resolve their team through the program or session.
  FOREACH t IN ARRAY ARRAY['program_phases','program_skills']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='bc_read_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO public USING (EXISTS (SELECT 1 FROM public.development_programs p WHERE p.id = program_id AND public.bc_team_at_least(p.team_id, %L)))', 'bc_read_'||t, t, 'viewer');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='program_session_drills' AND policyname='bc_read_program_session_drills') THEN
    CREATE POLICY bc_read_program_session_drills ON public.program_session_drills FOR SELECT TO public
      USING (EXISTS (SELECT 1 FROM public.program_sessions s WHERE s.id = session_id AND public.bc_team_at_least(s.team_id, 'viewer')));
  END IF;
END $$;

-- Only the service role writes through the functions; nobody else may call them.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'bc_save_development_program(uuid,uuid,jsonb)',
    'bc_complete_program_session(uuid,uuid,boolean,date,integer,jsonb,jsonb,boolean,text,jsonb)',
    'bc_uncomplete_program_session(uuid)',
    'bc_apply_program_revision(uuid,uuid,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH f IN ARRAY ARRAY['development_program_drafts','development_programs','program_phases','program_skills','program_sessions','program_session_drills','program_session_completions','program_revisions']
    LOOP EXECUTE format('GRANT SELECT ON public.%I TO authenticated', f); END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND (table_name LIKE 'program_%' OR table_name LIKE 'development_program%');
--   -- Expect 8 rows.
--   SELECT slug FROM metric_types WHERE coach_id IS NULL AND slug IN
--     ('sprint_5y','first_step_pct','first_step_outfield_pct','fly_ball_catch_pct','clean_fielding_pct','contact_quality_pct','balance_hold_sec');
--   -- Expect 7 rows.
