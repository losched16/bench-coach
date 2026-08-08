-- ============================================================================
-- Migration 023: The plan that comes out of a priority
-- ============================================================================
-- A priority names the one thing to fix and hands over three or four drills.
-- What it never said is what a parent actually does on Tuesday: how long, how
-- many, in what order, and what "better" looks like by Saturday. That gap is
-- where the loop leaks — the coach agrees with the read, has the drills, and
-- still doesn't know how to spend twenty minutes in a driveway.
--
-- For a team priority the answer is a practice plan, which already exists.
-- For a player it is a personal development plan, and this is where it lives:
-- on the priority, not in a separate table, because it is only ever about one
-- priority and it dies when that priority closes.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE prescriptions
  -- { markdown, generated_at, weeks } — markdown is the rendered plan, weeks
  -- is how long it was written for so a regeneration can match it.
  ADD COLUMN IF NOT EXISTS development_plan JSONB;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT id, focus_area,
--          development_plan->>'generated_at' AS plan_written,
--          length(development_plan->>'markdown') AS plan_chars
--   FROM prescriptions
--   WHERE status = 'active'
--   ORDER BY created_at DESC;
