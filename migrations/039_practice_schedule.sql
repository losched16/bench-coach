-- ============================================================================
-- Migration 039: a practice plan happens on a day
-- ============================================================================
-- practice_plans has no date. It has created_at, which is when the plan was
-- GENERATED — usually Sunday night for a practice on Tuesday, and sometimes
-- three weeks before it gets used, and sometimes never used at all.
--
-- Two consequences, both of which make the product weaker than the plans it
-- writes:
--
--   * There is no "this week". The practice page is a reverse-chronological
--     list of everything ever generated, so the plan a coach needs on Tuesday
--     is wherever it happens to have landed.
--
--   * Nothing can ask for a recap. Migration 038 created the columns that make
--     recaps feed the next plan, but a recap only happens if the coach
--     remembers to navigate to /dashboard/recap unprompted, which is a thing
--     approximately nobody does. Without a date there is no moment at which
--     the app can say "practice was yesterday — how did it go?"
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE practice_plans
  -- The day this plan is FOR. Nullable, because every plan that already exists
  -- has no answer and guessing one from created_at would invent a schedule the
  -- coach never set.
  ADD COLUMN IF NOT EXISTS scheduled_for DATE,

  -- Set when the coach has said "don't ask me about this one" — a practice
  -- that was rained off, or one they simply do not want to write up. Distinct
  -- from having recapped it, which is recorded by a practice_sessions row.
  --
  -- Without this, a prompt for a practice that never happened has no way to go
  -- away, and a nag you cannot dismiss trains people to ignore the surface it
  -- appears on.
  ADD COLUMN IF NOT EXISTS recap_dismissed_at TIMESTAMPTZ;

-- The practice page asks two questions: what is coming up, and what happened
-- that nobody has written up yet. Both are ordered by this.
CREATE INDEX IF NOT EXISTS idx_practice_plans_team_scheduled
  ON practice_plans (team_id, scheduled_for DESC NULLS LAST);

-- Finding the plan a recap belongs to, and finding plans with no recap.
CREATE INDEX IF NOT EXISTS idx_practice_sessions_plan
  ON practice_sessions (practice_plan_id);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 2 rows.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'practice_plans'
  AND column_name IN ('scheduled_for', 'recap_dismissed_at')
ORDER BY column_name;

-- How much of the back catalogue is undated. All of it, the first time — these
-- are the plans that will keep sorting by created_at until someone gives them
-- a day, which is correct: the app should not invent a practice date.
SELECT
  count(*)                                          AS plans,
  count(*) FILTER (WHERE scheduled_for IS NOT NULL) AS dated,
  count(*) FILTER (WHERE scheduled_for IS NULL)     AS undated
FROM practice_plans;

-- Practices that happened and were never written up. After a few weeks this is
-- the number that says whether the recap loop is actually running.
SELECT count(*) AS awaiting_recap
FROM practice_plans p
WHERE p.scheduled_for IS NOT NULL
  AND p.scheduled_for < CURRENT_DATE
  AND p.recap_dismissed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM practice_sessions s WHERE s.practice_plan_id = p.id
  );
