-- ============================================================================
-- Migration 044: let an event exist without a person attached
-- ============================================================================
-- user_events was built for the dashboard, where every event belongs to a
-- signed-in coach, so user_id is NOT NULL and references auth.users.
--
-- The marketing pages break that assumption completely. Someone lands on the
-- 8U practice plan from a Google search, prints it, and leaves — no account,
-- no session, nobody to attach the row to. That visit is the single most
-- interesting thing happening on the site right now and we currently cannot
-- count it.
--
-- So user_id becomes nullable, and NULL carries a specific meaning: an
-- anonymous visitor on a public page. Those rows are written only by
-- /api/track/seo, which accepts a fixed list of event names and stores no
-- identifier of any kind.
--
-- Existing rows are untouched and every dashboard event still arrives with a
-- user_id, so nothing that reads this table today changes behaviour.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE user_events
  ALTER COLUMN user_id DROP NOT NULL;

-- Anonymous events are queried on their own — "how many prints last week" is
-- never asked alongside dashboard activity — so they get their own index
-- rather than widening one that serves a different question.
CREATE INDEX IF NOT EXISTS idx_user_events_seo
  ON user_events (event_name, created_at DESC)
  WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_events' AND column_name = 'user_id';
-- Expect: user_id | YES

-- Nothing anonymous is recorded yet. This starts filling the first time
-- somebody prints a practice plan from a marketing page.
SELECT
  count(*) FILTER (WHERE user_id IS NULL) AS anonymous_events,
  count(*) FILTER (WHERE user_id IS NOT NULL) AS coach_events
FROM user_events;
