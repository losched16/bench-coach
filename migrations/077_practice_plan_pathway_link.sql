-- ============================================================================
-- Migration 077: link a saved practice to the development-plan stage it served
-- ============================================================================
-- A coach can build a practice from a Development Plan stage, but the saved
-- practice kept no record of that — the link lived only in analytics — so
-- nothing on the practice side could record the work against the players'
-- plans. Two things close it:
--
--   1. practice_plans.pathway_slug / pathway_stage_number — which pathway and
--      stage the practice was built for. Nullable, no backfill: a practice
--      built without a plan, and every practice saved before this, stays null
--      and shows no "record on plans" control.
--
--   2. One recorded session per practice per player plan. The practice page
--      records a practice against the players on that stage with one press;
--      pressing again must not count the same practice twice in a child's
--      history. The route answers "already recorded" first, but this index is
--      the guarantee — two tabs or a replayed request cannot get past it.
--      Sessions recorded by hand (no practice id) are untouched by it.
--
-- Nothing here writes to a player's record. Recording happens only when a
-- coach presses the button, through POST /api/player-pathways/[id]/events.
--
-- Additive and idempotent. Existing RLS on both tables is unchanged.
-- ============================================================================

ALTER TABLE public.practice_plans
  ADD COLUMN IF NOT EXISTS pathway_slug TEXT,
  ADD COLUMN IF NOT EXISTS pathway_stage_number INT;

DO $$ BEGIN
  ALTER TABLE public.practice_plans
    ADD CONSTRAINT practice_plans_pathway_link_sane CHECK (
      (pathway_slug IS NULL AND pathway_stage_number IS NULL)
      OR (pathway_slug IS NOT NULL AND length(pathway_slug) BETWEEN 1 AND 200
          AND (pathway_stage_number IS NULL OR pathway_stage_number BETWEEN 1 AND 100))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_player_pathway_session_per_practice
  ON public.player_pathway_events (progress_id, (detail->>'practice_plan_id'))
  WHERE event_type = 'session_logged' AND detail ? 'practice_plan_id';
