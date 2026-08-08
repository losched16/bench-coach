-- ============================================================================
-- Migration 031: Half-innings, opponent pitchers, and per-game eligibility
-- ============================================================================
-- Three things, and the first one is the cause of most of the clunkiness.
--
-- 1. THE GAME HAD NO HALF
--
-- games tracked current_inning and nothing else, so "the top of the third" and
-- "the bottom of the third" were the same place. That is why a coach had to
-- bump the inning to change pitchers: the only way to say "we're in the field
-- now" was to move to a different inning, which then lied about the inning.
--
-- current_half makes the cursor complete. It is the SHARED cursor — the pitch
-- panel, the lineup panel and the scorebook all read and write it, so whichever
-- one the coach touches moves the others. The scorebook keeps it automatically
-- when it is being used, and the manual control keeps it when it is not.
-- Nothing requires the scorebook.
--
-- 2. PITCH COUNTS WERE OURS ONLY
--
-- A coach tracking the other team's pitcher had nowhere to put those pitches.
-- Same table, because they are the same act and the same buttons; a second
-- table would have meant a second counter that drifts.
--
-- 3. ELIGIBILITY WAS ALREADY GLOBAL, BUT INVISIBLE AND UNCHANGEABLE
--
-- position_eligibility is keyed by team_player_id, so it always was a team
-- setting — it just lived inside the lineup builder, which made it feel like
-- something you redo every game. What was actually missing is the opposite:
-- a way to depart from it for ONE game, when you're trying a kid somewhere new
-- without promising he can play there from now on.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. This one needs 030 first
-- ----------------------------------------------------------------------------
-- The pitch-count backfill below reads games.is_home, which 030 adds. Failing
-- here with a sentence beats failing forty lines down with "column is_home
-- does not exist".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'is_home'
  ) THEN
    RAISE EXCEPTION 'Run 030_scorebook.sql before this one — it adds games.is_home, which this migration reads.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Which half of the inning we're in
-- ----------------------------------------------------------------------------
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS current_half TEXT NOT NULL DEFAULT 'top'
    CHECK (current_half IN ('top', 'bottom'));

-- ----------------------------------------------------------------------------
-- 2. Pitch counts get a half, and can belong to the other team
-- ----------------------------------------------------------------------------
ALTER TABLE game_pitch_counts
  ADD COLUMN IF NOT EXISTS half TEXT NOT NULL DEFAULT 'top'
    CHECK (half IN ('top', 'bottom')),
  -- Their pitcher. Nobody rosters the other team, so the name is the identity.
  ADD COLUMN IF NOT EXISTS is_opponent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opponent_pitcher_name TEXT;

-- Our pitcher rows need a player; theirs never have one. Dropping the NOT NULL
-- is what lets both live in the same table, and the CHECK keeps a row from
-- being neither.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_pitch_counts'
      AND column_name = 'player_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE game_pitch_counts ALTER COLUMN player_id DROP NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_pitch_counts_has_a_pitcher'
  ) THEN
    ALTER TABLE game_pitch_counts ADD CONSTRAINT game_pitch_counts_has_a_pitcher
      CHECK (player_id IS NOT NULL OR opponent_pitcher_name IS NOT NULL);
  END IF;
END $$;

-- Existing rows are all ours, and ours are thrown in the half we're in the
-- field: the bottom when we're home, the top when we're away. Away games are
-- already correct at the 'top' default, so only home games need moving.
UPDATE game_pitch_counts pc
SET half = 'bottom'
FROM games g
WHERE g.id = pc.game_id
  AND pc.is_opponent = FALSE
  AND pc.half = 'top'
  AND COALESCE(g.is_home, TRUE) = TRUE;

CREATE INDEX IF NOT EXISTS idx_game_pitch_counts_lookup
  ON game_pitch_counts(game_id, inning, half);

-- ----------------------------------------------------------------------------
-- 3. Eligibility, just for tonight
-- ----------------------------------------------------------------------------
-- A row here OVERRIDES position_eligibility for one game and one game only.
-- No row means "use the team setting", which is why this is a sparse table and
-- not a copy of the whole grid per game — a per-game snapshot would silently
-- freeze a kid's eligibility at whatever it was the night you made it.
CREATE TABLE IF NOT EXISTS game_position_eligibility (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,
  position        TEXT NOT NULL,
  eligible        BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, team_player_id, position)
);

CREATE INDEX IF NOT EXISTS idx_game_position_eligibility_game
  ON game_position_eligibility(game_id);

-- Set once the coach has looked at the eligibility grid for this game, so the
-- review is offered rather than nagged.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS eligibility_reviewed_at TIMESTAMPTZ;

ALTER TABLE game_position_eligibility ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game eligibility') THEN
    CREATE POLICY "Coaches manage own game eligibility" ON game_position_eligibility FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- Pitch counts, both teams, by half
--   SELECT inning, half, is_opponent,
--          COALESCE(p.name, opponent_pitcher_name) AS pitcher, pitch_count
--   FROM game_pitch_counts pc
--   LEFT JOIN players p ON p.id = pc.player_id
--   WHERE pc.game_id = '<game id>'
--   ORDER BY inning, half DESC, pitcher;
--
--   -- Where a game departs from the team's eligibility
--   SELECT pl.name, ge.position, ge.eligible AS tonight
--   FROM game_position_eligibility ge
--   JOIN team_players tp ON tp.id = ge.team_player_id
--   JOIN players pl ON pl.id = tp.player_id
--   WHERE ge.game_id = '<game id>';
