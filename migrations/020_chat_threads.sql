-- ============================================================================
-- Migration 020: Real conversations — many chats per team, not one
-- ============================================================================
-- chat_threads has always allowed several rows per team and has always had a
-- title column. Nothing ever wrote a second row: every code path did
--   .eq('team_id', teamId).limit(1).single()
-- and "New Chat" deleted the messages in that one thread. Asking about
-- outfield drills meant destroying the pitching conversation from Tuesday.
--
-- What's missing is only what a list needs: an ordering key that reflects
-- activity rather than creation, and a way to hide a thread without losing it.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE chat_threads
  -- Sorting by created_at puts a thread you replied to this morning below one
  -- you opened last month and abandoned. Activity is what a coach scans for.
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing threads: seed from their newest message, falling back to creation.
UPDATE chat_threads t
SET last_message_at = COALESCE(
  (SELECT MAX(created_at) FROM chat_messages m WHERE m.thread_id = t.id),
  t.created_at
)
WHERE t.last_message_at IS NULL;

-- ----------------------------------------------------------------------------
-- Keep it current
-- ----------------------------------------------------------------------------
-- In the database rather than the API route: messages get written from the
-- chat POST today, but anything that inserts one later gets this for free, and
-- a thread that sorts wrong is a thread the coach thinks they lost.
CREATE OR REPLACE FUNCTION touch_chat_thread()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_threads
  SET last_message_at = NEW.created_at
  WHERE id = NEW.thread_id
    AND (last_message_at IS NULL OR last_message_at < NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_chat_thread ON chat_messages;
CREATE TRIGGER trg_touch_chat_thread
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION touch_chat_thread();

-- ----------------------------------------------------------------------------
-- The list query
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chat_threads_team_activity
  ON chat_threads(team_id, last_message_at DESC NULLS LAST)
  WHERE archived = FALSE;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT t.id, t.title, t.last_message_at,
--          (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id) AS messages
--   FROM chat_threads t
--   WHERE t.archived = FALSE
--   ORDER BY t.last_message_at DESC NULLS LAST;
