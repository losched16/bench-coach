-- ============================================================================
-- Migration 042: what actually happened in a pitching outing
-- ============================================================================
-- A scouted appearance recorded exactly two things about a pitcher:
-- pitches_thrown and innings_pitched. Everything else a box score prints about
-- an outing — hits, runs, earned runs, walks issued, strikeouts thrown,
-- batters faced — was read off the screenshot and thrown away.
--
-- Note that the existing batting_line does NOT cover this. Its "bb" and "k"
-- are that player's own at-bats. A pitcher's strikeouts were not stored
-- anywhere at all.
--
-- Pitch count is still the most important number here, because it is what
-- drives the availability board. But a coach preparing for a team wants to
-- know whether the kid who threw 62 pitches walked seven or struck out nine,
-- and until now the app could not answer that even though the answer was
-- sitting in the image it had already read.
--
-- Mirrors batting_line deliberately: a JSONB blob rather than columns, so a
-- source that prints an extra stat can carry it without a migration, and a
-- source that prints fewer simply omits keys.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE opponent_appearances
  -- Keys, all optional, all as printed:
  --   ip   innings pitched (2.1 means two and one third)
  --   h    hits allowed          r    runs allowed
  --   er   earned runs           bb   walks issued
  --   k    strikeouts thrown     hr   home runs allowed
  --   hbp  hit batters           bf   batters faced
  --   strikes / balls            pitches (mirrors pitches_thrown)
  ADD COLUMN IF NOT EXISTS pitching_line JSONB;

-- The board and the analysis both filter to appearances that pitched. Cheap
-- index for the common "did this kid throw" question.
CREATE INDEX IF NOT EXISTS idx_opponent_appearances_pitched
  ON opponent_appearances (opponent_player_id)
  WHERE pitches_thrown IS NOT NULL AND pitches_thrown > 0;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'opponent_appearances'
  AND column_name IN ('batting_line', 'pitching_line', 'pitches_thrown', 'innings_pitched')
ORDER BY column_name;

-- Outings already logged, and how many of them have a line behind them.
-- Existing rows keep their pitch count and innings; only new parses fill the
-- rest, so a low number here right after applying is expected.
SELECT
  count(*) FILTER (WHERE pitches_thrown > 0)                          AS outings,
  count(*) FILTER (WHERE pitches_thrown > 0 AND pitching_line IS NOT NULL) AS with_line
FROM opponent_appearances;
