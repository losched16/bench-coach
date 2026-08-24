-- ============================================================================
-- Migration 043: scout your own team too
-- ============================================================================
-- The scouting module only ever held teams a coach was looking AT. But the
-- same box scores get published for their own games, and a coach who logs
-- those has something no opponent report can give them: both sides of the
-- comparison. "Their #22 throws 75% strikes" is useful. "Their #22 throws 75%
-- strikes and our lineup strikes out twice a game" is a plan.
--
-- So a tracked team can now be marked as the coach's own. It is the same row
-- shape and the same capture flow — nothing about logging a box score changes
-- — but everything downstream can tell the difference and say "you" instead of
-- "them".
--
-- linked_team_id ties it to the real roster in `teams`, which is what lets the
-- app match a scouted line to a player the coach already has ratings and
-- history for, rather than treating their own kid as a stranger.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE opponent_teams
  -- The coach's own side. Everything reads the same way; only the language
  -- and the comparison change.
  ADD COLUMN IF NOT EXISTS is_own_team BOOLEAN NOT NULL DEFAULT FALSE,
  -- The roster this corresponds to, when it is one of theirs.
  ADD COLUMN IF NOT EXISTS linked_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- One own-team record per coach per linked roster. Without this a coach who
-- types their own team name slightly differently ends up scouting themselves
-- twice and the comparison silently splits in half.
CREATE UNIQUE INDEX IF NOT EXISTS idx_opponent_teams_one_own
  ON opponent_teams (coach_id, linked_team_id)
  WHERE is_own_team = TRUE AND linked_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opponent_teams_own
  ON opponent_teams (coach_id) WHERE is_own_team = TRUE;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'opponent_teams'
  AND column_name IN ('is_own_team', 'linked_team_id')
ORDER BY column_name;

-- Nothing is marked as your own yet — that happens the first time you choose
-- "my team" on the capture screen.
SELECT
  count(*) FILTER (WHERE is_own_team)     AS own_team_records,
  count(*) FILTER (WHERE NOT is_own_team) AS teams_being_scouted
FROM opponent_teams;
