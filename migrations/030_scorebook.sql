-- ============================================================================
-- Migration 030: The scorebook
-- ============================================================================
-- Game Day could record notes, pitch counts and who was on the field. It could
-- not record what actually happened — who got the hit, who drove in the run,
-- how the out was made. That is the book, and it is the thing a coach is
-- holding when someone asks "did he score on that?".
--
-- ONE ORDERED STREAM, WITH SNAPSHOTS
--
-- Every event — a plate appearance, a stolen base, a passed ball — is one row
-- with a sequence number, carrying the bases and outs AFTER it happened.
--
-- Storing the after-state rather than deriving it is deliberate, and it is the
-- same call migration 028 made for re-entries:
--
--   Undo is deleting the highest seq. A coach who taps the wrong button
--   between pitches gets it back in one tap, with nothing to replay.
--
--   The state of the game is the last row. Nothing is recomputed under time
--   pressure at a fence, and a change to the scoring rules next month cannot
--   silently rewrite a game played last week.
--
--   Overrides survive. When the coach drags a runner somewhere the defaults
--   did not put him, the snapshot holds what he decided — not what the table
--   would have said.
--
-- PITCH COUNTS ARE NOT FORKED
--
-- Pitches logged here are written through to game_pitch_counts, which stays
-- the single source of truth that the pitch panel, the dugout assistant and
-- the availability check all read. A second count that disagreed with the
-- first would be worse than no scorebook at all.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which dugout we're in
-- ----------------------------------------------------------------------------
-- Home or away decides whether the top of the inning is our offence or our
-- pitching, which the book needs before the first pitch.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS is_home BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set the first time an event is recorded, so the game screen can tell a
  -- scored game from one that was only watched.
  ADD COLUMN IF NOT EXISTS scorebook_started_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. The book
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,

  -- Position in the game. Undo takes the highest, and the unique constraint
  -- means two taps racing each other cannot both land.
  seq             INT NOT NULL,

  -- 'pa'   — a plate appearance ended
  -- 'base' — runners moved without one: steal, passed ball, pickoff
  kind            TEXT NOT NULL DEFAULT 'pa' CHECK (kind IN ('pa', 'base')),

  inning          INT  NOT NULL CHECK (inning > 0),
  half            TEXT NOT NULL CHECK (half IN ('top', 'bottom')),
  -- Derived from half + games.is_home at write time, and stored, because the
  -- book must still read correctly if someone fixes is_home afterwards.
  we_batting      BOOLEAN NOT NULL,

  -- '1B', 'K', 'GO', 'SB', 'WP' … see lib/scorebook.ts, which is authoritative.
  result          TEXT NOT NULL,
  -- How it reads in the book: '6-3', 'F8', 'E5'.
  scoring         TEXT,

  -- Our batter. NULL when the other side is hitting — they are on nobody's
  -- roster and never will be.
  batter_team_player_id UUID REFERENCES team_players(id) ON DELETE SET NULL,
  -- Their batter, by lineup slot, with a name if the coach bothered.
  opponent_slot   INT,
  opponent_name   TEXT,

  -- Our pitcher, when we are in the field. This is what makes a pitching line
  -- possible, and it is the join to game_pitch_counts.
  pitcher_player_id UUID REFERENCES players(id) ON DELETE SET NULL,

  -- The count this plate appearance took. Balls + strikes do not have to sum
  -- to pitches: fouls are pitches that are sometimes neither.
  balls           INT NOT NULL DEFAULT 0,
  strikes         INT NOT NULL DEFAULT 0,
  pitches         INT NOT NULL DEFAULT 0,

  rbi             INT NOT NULL DEFAULT 0,

  -- The snapshot. See the header — this is the point of the table.
  outs_before     INT NOT NULL DEFAULT 0 CHECK (outs_before BETWEEN 0 AND 3),
  outs_after      INT NOT NULL DEFAULT 0 CHECK (outs_after  BETWEEN 0 AND 3),
  -- { "first": {id,name,earned} | null, "second": …, "third": … }
  bases_before    JSONB NOT NULL DEFAULT '{}'::jsonb,
  bases_after     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ id, name, earned }] — who crossed the plate on this event. Runs belong
  -- to the runner, not the batter, which is why they are carried here.
  runs_scored     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Set when the coach moved a runner somewhere the defaults did not, so the
  -- book can show its own workings if the numbers are ever questioned.
  adjusted        BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_game_events_game_seq
  ON game_events(game_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_batter
  ON game_events(batter_team_player_id)
  WHERE batter_team_player_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. RLS — same shape as everything else hanging off a game
-- ----------------------------------------------------------------------------
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game events') THEN
    CREATE POLICY "Coaches manage own game events" ON game_events FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- The book, in order
--   SELECT seq, inning, half, we_batting, result, scoring,
--          COALESCE(p.name, e.opponent_name, 'slot ' || e.opponent_slot) AS batter,
--          balls || '-' || strikes AS count, pitches, rbi, outs_after,
--          jsonb_array_length(runs_scored) AS runs
--   FROM game_events e
--   LEFT JOIN team_players tp ON tp.id = e.batter_team_player_id
--   LEFT JOIN players p ON p.id = tp.player_id
--   WHERE e.game_id = '<game id>'
--   ORDER BY seq;
--
--   -- Does it reconcile? Runs here should equal the score on the game.
--   SELECT half, SUM(jsonb_array_length(runs_scored)) AS runs
--   FROM game_events WHERE game_id = '<game id>' GROUP BY half;
