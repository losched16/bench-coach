-- ============================================================================
-- Migration 072: player pathway progress — which stage is Charlie actually on
-- ============================================================================
-- 069 built the curriculum and said, in its own header:
--
--     A pathway RECOMMENDS. It never schedules, and it stores no player state.
--
-- That was the right line to hold while the sequence was being curated. It is
-- also exactly the gap this migration closes, and the two are not in conflict:
-- the pathway tables still store no player state. Player state lives here,
-- pointing AT the curriculum, and the curriculum remains ignorant of it.
--
-- WHY THIS IS NOT prescriptions.development_plan
--
-- That column holds a disposable three-week AI intervention around one problem
-- ("Charlie's throwing accuracy is off — give me three weeks"). It is a
-- tactical document, regenerated whenever the priority changes, and it is
-- correct at that job.
--
-- This is the opposite shape: long-lived, coach-driven, against a curated
-- sequence that outlives any one intervention. "Charlie is on stage 4 of Speed
-- & Agility" is a fact about a season, not a document. The two coexist and
-- neither replaces the other.
--
-- WHY TWO TABLES AND NOT THREE
--
-- A session a coach logged is a thing that happened to this player on this
-- pathway, which is the definition of an event. Splitting "sessions" out would
-- put the answer to "how did he get to stage 4" in two places and force every
-- read to merge them. "6 sessions completed" is a count of session_logged
-- events; "3 sessions at this stage" is the same count filtered by stage_key.
--
-- plan_session_log was considered and rejected: its prescription_id is NOT NULL
-- and CASCADEs from prescriptions, so reusing it means either fabricating a
-- prescription per enrollment or breaking its ownership model.
--
-- Additive and idempotent. Zero rows are modified in any existing table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enrollment — one row per player, team and pathway
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_pathway_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  player_id            UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Denormalised on purpose. Every RLS policy below is a single function call
  -- against this column; resolving the team through team_players inside a
  -- policy would add a join to every row read, and players can sit on more
  -- than one team with different staff.
  team_id              UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  pathway_id           UUID NOT NULL
                       REFERENCES public.development_pathways(id) ON DELETE RESTRICT,

  -- The version the coach enrolled against, copied at enrollment and never
  -- updated. If the canonical pathway becomes v2 and renumbers its stages, this
  -- row still says which sequence the player was actually taught, which is what
  -- makes the history readable afterwards rather than silently reinterpreted.
  pathway_version      INT NOT NULL,

  -- THE STAGE POINTER IS A KEY, NOT AN ID.
  --
  -- 069 makes (pathway_id, stage_key) unique and describes stage_key as stable
  -- across renumbering — the same reasoning plan_session_log uses for
  -- session_key. A stage ROW can be dropped and recreated by a content
  -- migration, which changes its id; 'first-step-explosion' survives that, and
  -- survives a stage being inserted ahead of it.
  current_stage_key    TEXT NOT NULL,
  -- Display and ordering only. A cache of the stage's number at the time it was
  -- set, refreshed on read from the canonical stage. Never the source of truth,
  -- and never what advancement is computed from.
  current_stage_number INT,

  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'paused', 'completed')),

  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When the CURRENT stage began. "How long have they been there" (§4 of the
  -- brief) is now - stage_started_at, and it resets on advance and on regress.
  stage_started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,

  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- completed_at is set exactly when status says it is. Without this a
  -- "completed" row with no date is representable, and the history page then
  -- has to guess.
  CONSTRAINT player_pathway_progress_completed_coherent
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

-- A player may follow Speed & Agility, Build the Swing and Infield Fundamentals
-- at once — the brief is explicit that one active pathway is not enough. What
-- they may not do is hold two LIVE enrollments in the SAME pathway on the same
-- team, which would make "which stage is he on" ambiguous.
--
-- Partial, so a completed enrollment does not block starting the pathway again
-- a season later. Recycling a pathway is a real coaching decision (stage 10 of
-- the speed pathway says so out loud) and the history of the first run stays.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_pathway_live
  ON public.player_pathway_progress (player_id, team_id, pathway_id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_player_pathway_progress_player
  ON public.player_pathway_progress (player_id, team_id, status);
CREATE INDEX IF NOT EXISTS idx_player_pathway_progress_team
  ON public.player_pathway_progress (team_id, status);

COMMENT ON TABLE public.player_pathway_progress IS
  'Which canonical pathway stage a player is on. Points at development_pathways; that layer stays player-agnostic.';
COMMENT ON COLUMN public.player_pathway_progress.current_stage_key IS
  'Stable stage identity. Survives renumbering; current_stage_number is a display cache.';

-- ---------------------------------------------------------------------------
-- 2. History — append-only, and the only way advancement is recorded
-- ---------------------------------------------------------------------------
-- current_stage = 4 cannot answer how the player got there, who decided, or
-- what they had actually demonstrated at the time. This can.
CREATE TABLE IF NOT EXISTS public.player_pathway_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_id     UUID NOT NULL
                  REFERENCES public.player_pathway_progress(id) ON DELETE CASCADE,

  -- Denormalised so RLS never has to join back to the parent row. The trigger
  -- below keeps it honest rather than trusting the writer.
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'enrolled',
                    'session_logged',     -- a coach recorded that work happened
                    'mastery_recorded',   -- observations against the stage's signals
                    'advanced',
                    'regressed',
                    'completed',
                    'paused',
                    'resumed'
                  )),

  -- Where the player was when this happened. Snapshotted, not joined, so the
  -- timeline still reads correctly after a pathway is renumbered.
  stage_key       TEXT,
  stage_number    INT,
  -- Set on advanced / regressed only. Together these make the movement legible
  -- without diffing adjacent rows.
  from_stage_key  TEXT,
  to_stage_key    TEXT,

  -- Shape depends on event_type and is deliberately not a column each:
  --   session_logged   { minutes, drill_ids: [] }
  --   mastery_recorded { signals: [] }   the signal TEXT, not its index
  --
  -- WHY THE SIGNAL TEXT AND NOT AN INDEX. An index into the stage's
  -- mastery_signals array stops meaning what it meant the moment that array is
  -- reordered or edited, and a history that silently changes meaning is the
  -- exact failure the versioning requirement exists to prevent. Storing the
  -- words records what the coach actually read and ticked.
  --
  -- Nothing here mutates the canonical stage. An observation is about a player.
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,

  note            TEXT,

  -- WHO decided. An advancement with no actor is not auditable, and the whole
  -- point of this layer is that a human made the call.
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  occurred_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A move has to say where it went. Enforced rather than documented because
  -- the timeline renders from these two columns.
  CONSTRAINT player_pathway_events_move_has_target
    CHECK (event_type NOT IN ('advanced', 'regressed')
           OR (from_stage_key IS NOT NULL AND to_stage_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_player_pathway_events_progress
  ON public.player_pathway_events (progress_id, occurred_on DESC, created_at DESC);
-- "3 sessions at this stage" reads this one.
CREATE INDEX IF NOT EXISTS idx_player_pathway_events_stage
  ON public.player_pathway_events (progress_id, event_type, stage_key);

COMMENT ON TABLE public.player_pathway_events IS
  'Append-only history of a player enrollment, sessions included. Never updated in place.';

-- ---------------------------------------------------------------------------
-- 3. team_id on an event must match its enrollment
-- ---------------------------------------------------------------------------
-- The denormalised column is what RLS reads. If a writer could set it freely,
-- it would be a way to file an event under a team the caller happens to be on
-- while pointing at another team's enrollment — so it is derived, not trusted.
CREATE OR REPLACE FUNCTION public.bc_player_pathway_event_team()
RETURNS TRIGGER AS $$
BEGIN
  SELECT p.team_id INTO NEW.team_id
  FROM public.player_pathway_progress p
  WHERE p.id = NEW.progress_id;

  IF NEW.team_id IS NULL THEN
    RAISE EXCEPTION 'player_pathway_events.progress_id % does not exist', NEW.progress_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_player_pathway_event_team ON public.player_pathway_events;
CREATE TRIGGER trg_player_pathway_event_team
  BEFORE INSERT OR UPDATE OF progress_id ON public.player_pathway_events
  FOR EACH ROW EXECUTE FUNCTION public.bc_player_pathway_event_team();

-- updated_at, matching the convention used by bc_touch_player_report.
CREATE OR REPLACE FUNCTION public.bc_touch_player_pathway_progress()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_touch_player_pathway_progress ON public.player_pathway_progress;
CREATE TRIGGER trg_touch_player_pathway_progress
  BEFORE UPDATE ON public.player_pathway_progress
  FOR EACH ROW EXECUTE FUNCTION public.bc_touch_player_pathway_progress();

-- ---------------------------------------------------------------------------
-- 4. RLS — this is player data, so it is nothing like the pathway tables
-- ---------------------------------------------------------------------------
-- 069's tables are publicly readable because a curriculum is not private. These
-- two are the opposite: a row here says a named child is working on something.
--
-- THE ROLE WORDS BELOW ARE THE REAL ONES.
--
-- bc_rank() understands owner | admin | contributor | viewer and returns -1 for
-- anything else. 105 existing policy clauses in this schema pass 'record' or
-- 'decide' — which are lib/authz.ts CAPABILITY names, not roles — so those
-- clauses reduce to `rank >= -1`, which is true for every caller including an
-- unauthenticated one. That is a real pre-existing defect, reported in the
-- Phase 2H closeout, and it is NOT reproduced here.
--
-- The split mirrors lib/authz.ts deliberately, because the app writes through
-- both enforcement points and they must not disagree:
--
--   viewer       may read progress and history
--   contributor  may record what HAPPENED — a session, an observation
--   admin        may decide what happens NEXT — enroll, advance, regress,
--                complete, pause
--
-- Advancement is a decision about a child's development, which authz.ts already
-- places with the head coach. A parent helper keeping the book does not move a
-- kid through a curriculum.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.player_pathway_progress ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.player_pathway_events   ENABLE ROW LEVEL SECURITY';
END $$;

-- Guarded so this file also applies on a plain Postgres, where auth.uid() and
-- the bc_* helpers do not exist — the migration tests run there.
DO $$
BEGIN
  IF to_regprocedure('public.bc_team_at_least(uuid, text)') IS NULL THEN
    RAISE NOTICE 'bc_team_at_least absent — skipping player pathway policies (plain Postgres).';
    RETURN;
  END IF;

  -- progress
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_progress' AND policyname='bc_read_player_pathway_progress') THEN
    CREATE POLICY bc_read_player_pathway_progress ON public.player_pathway_progress
      FOR SELECT TO public USING (public.bc_team_at_least(team_id, 'viewer'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_progress' AND policyname='bc_ins_player_pathway_progress') THEN
    CREATE POLICY bc_ins_player_pathway_progress ON public.player_pathway_progress
      FOR INSERT TO public WITH CHECK (public.bc_team_at_least(team_id, 'admin'));
  END IF;

  -- USING and WITH CHECK both, so a row cannot be updated INTO a team the
  -- caller does not administer.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_progress' AND policyname='bc_upd_player_pathway_progress') THEN
    CREATE POLICY bc_upd_player_pathway_progress ON public.player_pathway_progress
      FOR UPDATE TO public
      USING (public.bc_team_at_least(team_id, 'admin'))
      WITH CHECK (public.bc_team_at_least(team_id, 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_progress' AND policyname='bc_del_player_pathway_progress') THEN
    CREATE POLICY bc_del_player_pathway_progress ON public.player_pathway_progress
      FOR DELETE TO public USING (public.bc_team_at_least(team_id, 'admin'));
  END IF;

  -- events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_events' AND policyname='bc_read_player_pathway_events') THEN
    CREATE POLICY bc_read_player_pathway_events ON public.player_pathway_events
      FOR SELECT TO public USING (public.bc_team_at_least(team_id, 'viewer'));
  END IF;

  -- A contributor may append. The trigger has already replaced team_id with
  -- the enrollment's own, so this cannot be aimed at another team.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_events' AND policyname='bc_ins_player_pathway_events') THEN
    CREATE POLICY bc_ins_player_pathway_events ON public.player_pathway_events
      FOR INSERT TO public WITH CHECK (public.bc_team_at_least(team_id, 'contributor'));
  END IF;

  -- No UPDATE policy at all. History is append-only; a correction is a new
  -- event, not a rewritten one. Deleting stays with the head coach.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='player_pathway_events' AND policyname='bc_del_player_pathway_events') THEN
    CREATE POLICY bc_del_player_pathway_events ON public.player_pathway_events
      FOR DELETE TO public USING (public.bc_team_at_least(team_id, 'admin'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- No grant to anon. There is no signed-out view of a child's development, and
-- no public URL — the brief's §19, and the reason this differs from every
-- pathway table in 069.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['player_pathway_progress', 'player_pathway_events'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE 'player_pathway%')        AS new_tables,
  (SELECT count(*) FROM public.player_pathway_progress)                        AS enrollments,
  (SELECT count(*) FROM public.player_pathway_events)                          AS events,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename LIKE 'player_pathway%')           AS policies,
  -- Untouched by this migration. Named so a diff is visible rather than assumed.
  (SELECT count(*) FROM public.development_pathways)                           AS pathways_untouched,
  (SELECT count(*) FROM public.drill_resources)                                AS drills_untouched,
  (SELECT count(*) FROM public.player_metrics)                                 AS metrics_untouched;
