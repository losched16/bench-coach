-- ============================================================================
-- Migration 075: a coach can write a note against a stage
-- ============================================================================
-- Phase 2H shipped a development plan that behaved like a gated curriculum:
-- the current stage's drills and nothing else. The product decision since is
-- that it should behave like a course — show the whole thing, let a coach read
-- ahead, and let them write down what they are seeing as they go.
--
-- The writing-down part is the only bit that needs schema, and it needs one
-- value, not a table. player_pathway_events already holds everything that
-- happens on a plan, already carries `note` and `stage_key` columns, and is
-- already append-only with an actor. A note is a thing that happened.
--
-- WHY NOT A NEW TABLE
--
-- A separate player_pathway_notes would duplicate progress_id, team_id,
-- stage_key, actor_user_id, occurred_on and the RLS that guards them, and then
-- the plan's history would live in two places and every read would have to
-- merge them. 072's header argued exactly this about sessions; a note is the
-- same shape of thing.
--
-- WHY NOT player_notes
--
-- That table is general notes about a player on a team, with no idea that
-- pathways exist. A note reading "the pogo rhythm fell apart today" belongs to
-- stage 4 of a specific plan, and filing it on the player loses the only
-- context that makes it findable later.
--
-- Additive. The constraint is widened, never narrowed, so every row that was
-- valid before is still valid and this cannot fail on existing data.
-- ============================================================================

ALTER TABLE public.player_pathway_events
  DROP CONSTRAINT IF EXISTS player_pathway_events_event_type_check;

ALTER TABLE public.player_pathway_events
  ADD CONSTRAINT player_pathway_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'enrolled',
    'session_logged',
    'mastery_recorded',
    -- New. A coach's observation, tied to the stage they were looking at.
    -- Written by 'record', like a session, because it is a record of what
    -- happened and not a decision about what happens next.
    'note',
    'advanced',
    'regressed',
    'completed',
    'paused',
    'resumed'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 'note' to be accepted and an invented type still to be rejected. The
-- second half matters as much as the first: a widened constraint that stopped
-- constraining would be worse than the gate it replaced.
SELECT
  pg_get_constraintdef(oid) LIKE '%''note''%'      AS accepts_note,
  pg_get_constraintdef(oid) LIKE '%''enrolled''%'  AS still_accepts_enrolled,
  pg_get_constraintdef(oid) LIKE '%''resumed''%'   AS still_accepts_resumed
FROM pg_constraint
WHERE conrelid = 'public.player_pathway_events'::regclass
  AND conname = 'player_pathway_events_event_type_check';
