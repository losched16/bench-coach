-- ============================================================================
-- Migration 018: One game, one record
-- ============================================================================
-- Three features touch the same Saturday morning and none of them share a row.
--
--   Lineup Builder writes game_lineups (team_id, game_date, opponent) — a
--     string you typed.
--   Game Day writes games (team_id, game_date, opponent) — the same string,
--     typed again, twenty minutes later, at the field.
--   Log an Entry writes games AGAIN on Sunday when you upload the box score.
--
-- So building a lineup, tracking the game live, and logging its box score
-- produced up to three unrelated records for one event, joined by nothing but
-- a hand-typed opponent name. The stats page counts the game twice; the
-- lineup you built is nowhere near the game you played.
--
-- game_id is the join. It's nullable because lineups made before this exist
-- and are still worth keeping, and because a coach can legitimately draft a
-- lineup for a game they haven't created yet.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE game_lineups
  ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES games(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_lineups_game ON game_lineups(game_id);

-- Backfill: match an existing lineup to a game on the same team, same date,
-- same opponent. Case- and whitespace-insensitive because both sides were
-- typed by hand. Deliberately conservative — only matches where exactly one
-- game qualifies, because attaching a lineup to the wrong game is worse than
-- leaving it unattached.
UPDATE game_lineups l
SET game_id = g.id
FROM games g
WHERE l.game_id IS NULL
  AND g.team_id = l.team_id
  AND g.game_date = l.game_date
  AND lower(btrim(coalesce(g.opponent, ''))) = lower(btrim(coalesce(l.opponent, '')))
  AND (
    SELECT count(*) FROM games g2
    WHERE g2.team_id = l.team_id
      AND g2.game_date = l.game_date
      AND lower(btrim(coalesce(g2.opponent, ''))) = lower(btrim(coalesce(l.opponent, '')))
  ) = 1;

-- Finding the game a new entry belongs to is now a hot path — Log an Entry
-- checks it on every box score upload to avoid creating a duplicate.
CREATE INDEX IF NOT EXISTS idx_games_team_date_opponent
  ON games(team_id, game_date, lower(btrim(coalesce(opponent, ''))));

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
-- Lineups now attached to a real game:
--   SELECT count(*) FILTER (WHERE game_id IS NOT NULL) AS linked,
--          count(*) FILTER (WHERE game_id IS NULL)     AS unlinked
--   FROM game_lineups;
--
-- Duplicate games already in the data (same team, date and opponent). This
-- migration stops new ones; existing pairs are yours to merge or ignore:
--   SELECT team_id, game_date, opponent, count(*), array_agg(id)
--   FROM games GROUP BY 1,2,3 HAVING count(*) > 1 ORDER BY game_date DESC;
