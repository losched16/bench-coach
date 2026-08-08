-- ============================================================================
-- Migration 033: Conversations about one opponent
-- ============================================================================
-- CoachAI already loads scouting data, but only when it GUESSES the
-- conversation is about an opponent — it looks for a team name in the message,
-- or for phrasing like "who can they pitch". That guess is fine in the middle
-- of a general conversation and useless when the coach has deliberately opened
-- Springfield and wants to talk about Springfield. "What about their two-hole?"
-- names nobody, so the guess misses, and the answer arrives with no data behind
-- it.
--
-- Scoping the thread removes the guess. A conversation opened from an
-- opponent's page is ABOUT that opponent, every message, without being told
-- again.
--
-- Same column shape as player_id from migration 021, and for the same reason:
-- the scope belongs on the thread, so returning to it a week later still has
-- it.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Scouting rows are selected by coach_id and always were. Scoping a chat to an
-- opponent reads the coach's OWN logged notes about a team they played — it
-- does not reach another account's data, and there is no path here that pools
-- observations across users.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS opponent_team_id UUID
    REFERENCES opponent_teams(id) ON DELETE CASCADE;

-- Partial: most threads are not about an opponent, and the index only needs to
-- serve the ones that are.
CREATE INDEX IF NOT EXISTS idx_chat_threads_opponent
  ON chat_threads(opponent_team_id) WHERE opponent_team_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT t.id, t.title, ot.name AS about, t.last_message_at
--   FROM chat_threads t
--   JOIN opponent_teams ot ON ot.id = t.opponent_team_id
--   ORDER BY t.last_message_at DESC NULLS LAST;
