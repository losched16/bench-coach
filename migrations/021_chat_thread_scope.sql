-- ============================================================================
-- Migration 021: Who a conversation is about
-- ============================================================================
-- Chat has always been team-scoped, while "What to Work On" has a player
-- picker. That gap is why the two surfaces couldn't merge: a question about
-- Charlie's swing was being answered from an average of the whole roster.
--
-- The scope belongs on the thread, not the message. A conversation titled
-- "Charlie's swing power" is about Charlie for its whole life, and reopening
-- it on Thursday should put you back in that context without re-picking.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- Safe to run whether or not 020 has been applied.
-- ============================================================================

ALTER TABLE chat_threads
  -- NULL means the whole team, which is the honest default: most questions a
  -- coach asks are not about one kid.
  ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_threads_player
  ON chat_threads(player_id) WHERE player_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Messages that are more than text
-- ----------------------------------------------------------------------------
-- A committed priority gets written into the conversation it came out of, so
-- the thread reads as the whole story: the question, the answer, and the
-- decision. That message needs to carry the prescription id so the UI can link
-- to it, which is what this column is for.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS meta JSONB;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT t.title, p.name AS about, t.last_message_at
--   FROM chat_threads t
--   LEFT JOIN players p ON p.id = t.player_id
--   ORDER BY t.last_message_at DESC NULLS LAST LIMIT 20;
