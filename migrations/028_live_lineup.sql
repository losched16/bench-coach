-- ============================================================================
-- Migration 028: The lineup, live
-- ============================================================================
-- Game Day tracked notes and pitch counts and nothing about who was actually
-- on the field. So the lineup builder produced a plan, and the game screen had
-- no idea it existed — a coach set a lineup, then managed the real one in their
-- head or on paper.
--
-- Two tables, and the split matters.
--
--   game_participation — one row per player per game: did they start, what
--   batting slot, are they in right now, how many times have they been
--   removed and re-entered. This is the state substitution rules are judged
--   against, and it has to be a running total rather than something derived
--   at read time, because "has RJ used his re-entry" must not depend on
--   replaying a log correctly.
--
--   game_position_log — one row per player per inning per position. This is
--   the history: who played where, when. Innings-played counts come from
--   here, and so does the fielding record the analysis reads.
--
-- Substitution rules are per GAME, not per team. The same team plays a rec
-- league game under continuous batting order on Tuesday and a tournament
-- under starter re-entry on Saturday.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which rules this game is being played under
-- ----------------------------------------------------------------------------
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS sub_rules TEXT NOT NULL DEFAULT 'starter_reentry'
    CHECK (sub_rules IN ('starter_reentry', 'continuous_free', 'no_reentry')),
  -- Set once the coach commits the starting lineup, so the screen knows
  -- whether it is still being built or is now the record of a game.
  ADD COLUMN IF NOT EXISTS lineup_locked_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Who is in, and what they have spent
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_participation (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,

  -- On the card before the first pitch. Only starters get a re-entry.
  is_starter      BOOLEAN NOT NULL DEFAULT FALSE,
  -- 1-based. A starter re-entering must return to the same slot, so this is
  -- the thing that makes that rule checkable.
  batting_slot    INT,
  is_in           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Running totals rather than derived. Whether a kid can go back in is not
  -- something to recompute from a log under time pressure at a fence.
  times_removed   INT NOT NULL DEFAULT 0,
  reentries       INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, team_player_id)
);

CREATE OR REPLACE FUNCTION game_participation_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_participation_touch ON game_participation;
CREATE TRIGGER trg_game_participation_touch
  BEFORE UPDATE ON game_participation
  FOR EACH ROW EXECUTE FUNCTION game_participation_touch();

-- ----------------------------------------------------------------------------
-- 3. Who played where, inning by inning
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_position_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,
  inning          INT NOT NULL CHECK (inning > 0),
  -- NULL means on the bench that inning, which is worth recording: it is how
  -- "everyone played three innings" gets checked after the fact.
  position        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- One position per player per inning. A player cannot be at two spots at
  -- once, and a double-tap should correct rather than duplicate.
  UNIQUE (game_id, team_player_id, inning)
);

CREATE INDEX IF NOT EXISTS idx_game_position_log_game
  ON game_position_log(game_id, inning);

-- ----------------------------------------------------------------------------
-- RLS — same shape as everything else that hangs off a game
-- ----------------------------------------------------------------------------
ALTER TABLE game_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_position_log  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game participation') THEN
    CREATE POLICY "Coaches manage own game participation" ON game_participation FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own position log') THEN
    CREATE POLICY "Coaches manage own position log" ON game_position_log FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT p.name, gp.is_starter, gp.batting_slot, gp.is_in,
--          gp.times_removed, gp.reentries
--   FROM game_participation gp
--   JOIN team_players tp ON tp.id = gp.team_player_id
--   JOIN players p ON p.id = tp.player_id
--   WHERE gp.game_id = '<game id>'
--   ORDER BY gp.batting_slot NULLS LAST;
--
--   SELECT inning, position, p.name
--   FROM game_position_log l
--   JOIN team_players tp ON tp.id = l.team_player_id
--   JOIN players p ON p.id = tp.player_id
--   WHERE l.game_id = '<game id>' ORDER BY inning, position;
