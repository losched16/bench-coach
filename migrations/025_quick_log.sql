-- ============================================================================
-- Migration 025: One "Ran it today" per priority per day
-- ============================================================================
-- The one-tap logger had no guard against a double tap. It disabled only while
-- the request was in flight, so a quick second thumb — or tapping, navigating
-- back, and tapping again — wrote two sessions for one day.
--
-- That corrupts the single number the whole loop reasons from. Adherence
-- decides whether "it didn't move" means CHANGE THE DRILL or SHRINK THE ASK,
-- and those are opposite advice. Two stray taps turn a real 4-of-6 week into
-- 8-of-6, which flips the verdict.
--
-- The fix has to distinguish the one-tap logger from the full Log an Entry
-- form, because logging two genuine sessions in one day is legitimate — a
-- morning and an evening in the cage is a real thing. A blanket unique
-- constraint would block that. So only quick logs are deduplicated.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS quick_log BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforced in the database as well as the route. The API returns the existing
-- row rather than inserting, but two requests racing each other would both
-- pass that check — this is what actually makes it impossible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_one_quick_log_per_day
  ON entries (prescription_id, occurred_on)
  WHERE quick_log = TRUE AND prescription_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Clean up anything already doubled
-- ----------------------------------------------------------------------------
-- Existing quick-tap entries predate the flag, so they are identified the way
-- the button wrote them: a home session with the title it always sets and no
-- notes attached. Only exact same-day duplicates are removed, oldest kept.
WITH quick AS (
  SELECT e.id, e.prescription_id, e.occurred_on,
         ROW_NUMBER() OVER (
           PARTITION BY e.prescription_id, e.occurred_on
           ORDER BY e.created_at
         ) AS rn
  FROM entries e
  WHERE e.entry_type = 'home_session'
    AND e.prescription_id IS NOT NULL
    AND e.title = 'Worked the priority'
    AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entry_id = e.id)
)
DELETE FROM entries WHERE id IN (SELECT id FROM quick WHERE rn > 1);

-- Mark the survivors so the new index covers them too.
UPDATE entries
SET quick_log = TRUE
WHERE entry_type = 'home_session'
  AND prescription_id IS NOT NULL
  AND title = 'Worked the priority'
  AND quick_log = FALSE;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   Should return no rows:
--   SELECT prescription_id, occurred_on, count(*)
--   FROM entries WHERE quick_log
--   GROUP BY 1, 2 HAVING count(*) > 1;
