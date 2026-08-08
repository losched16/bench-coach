-- ============================================================================
-- Migration 032: Their lineup
-- ============================================================================
-- The scorebook could record what the other team's #4 hitter did, but it had
-- nowhere to learn that #4 is a name. So a coach retyped it every time that
-- slot came up, six or seven times a game.
--
-- This is the other team's batting order for ONE game: slot, name, number,
-- position. Entered by hand, or read off a photo of a GameChanger lineup, a
-- SportsEngine screen, or the opposing coach's handwritten book.
--
-- SCOPE, DELIBERATELY
--
-- These rows hang off a game, which hangs off a team, which hangs off one
-- coach. They are never pooled across accounts and never joined to anyone
-- else's data — what you logged is yours, and it stays inside your own
-- workspace. Nothing here is a scouting database on other people's children.
--
-- The columns are also, on purpose, only the observable facts you would read
-- off a lineup card: who batted where, wearing what number, playing where.
-- There is no field for an assessment of an opposing player, because this is
-- not the place for one.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS game_opponent_lineup (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id      UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,

  -- 1-based batting order. This is the join the scorebook uses: their #4 comes
  -- up, and the book already knows the name.
  slot         INT NOT NULL CHECK (slot > 0),
  name         TEXT,
  jersey       TEXT,
  -- Where they started on defence, if the card showed it. Useful for the book
  -- ("F8" wants to know who is in centre) and for nothing else.
  position     TEXT,
  -- Their pitcher, so the pitch counter can offer the name instead of asking.
  is_pitcher   BOOLEAN NOT NULL DEFAULT FALSE,

  -- 'manual' or 'import'. An imported row was read off a picture by a model,
  -- and a coach reviewing later deserves to know which is which.
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),

  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),

  -- One name per slot per game. Re-importing corrects rather than duplicates.
  UNIQUE (game_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_game_opponent_lineup_game
  ON game_opponent_lineup(game_id, slot);

CREATE OR REPLACE FUNCTION game_opponent_lineup_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_opponent_lineup_touch ON game_opponent_lineup;
CREATE TRIGGER trg_game_opponent_lineup_touch
  BEFORE UPDATE ON game_opponent_lineup
  FOR EACH ROW EXECUTE FUNCTION game_opponent_lineup_touch();

ALTER TABLE game_opponent_lineup ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own opponent lineup') THEN
    CREATE POLICY "Coaches manage own opponent lineup" ON game_opponent_lineup FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT slot, jersey, name, position, is_pitcher, source
--   FROM game_opponent_lineup
--   WHERE game_id = '<game id>'
--   ORDER BY slot;
