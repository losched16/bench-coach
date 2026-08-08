-- ============================================================================
-- Migration 027: Lineup rules a coach sets once
-- ============================================================================
-- The fielding solver optimised for fit and fairness and had no way to be
-- told a rule. Three things a real coach needs before they will trust a
-- generated lineup:
--
--   "RJ only plays short."            → locked_position
--   "Lucas can play anywhere but 1B." → excluded_positions
--   "Everyone plays at least one."    → min_innings (per player, or team-wide)
--
-- These live on team_players rather than on a lineup, because they are true
-- of the player all season. A coach who has to re-enter them every game will
-- enter them once and then stop using the builder.
--
-- min/max innings is also where league rules live. 8U travel typically
-- requires every rostered kid to field an inning; a pitcher on a count gets a
-- max. Both are per player so an exception doesn't force a rule change.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE team_players
  -- NULL means unlocked, which is the normal case. A locked player takes no
  -- other position and the position prefers them.
  ADD COLUMN IF NOT EXISTS locked_position TEXT,
  -- Cheaper to say than listing the eight they CAN play.
  ADD COLUMN IF NOT EXISTS excluded_positions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_innings INT,
  ADD COLUMN IF NOT EXISTS max_innings INT;

-- Team-wide defaults. min_innings_all is the "everyone plays at least one
-- inning" rule expressed once instead of on twelve rows.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS min_innings_all INT,
  -- Which way the solver leans by default. Seasons already carry league_type,
  -- but a coach running a rec team in a competitive tournament needs to
  -- override it for the day, so the lineup keeps its own copy.
  ADD COLUMN IF NOT EXISTS default_strategy TEXT
    CHECK (default_strategy IS NULL OR default_strategy IN ('development', 'competitive'));

-- Seed the default from the season's league type where it is already known,
-- so travel teams open on the set-lineup behaviour without being asked.
UPDATE teams t
SET default_strategy = CASE s.league_type
    WHEN 'travel' THEN 'competitive'
    WHEN 'rec'    THEN 'development'
    ELSE NULL
  END
FROM seasons s
WHERE s.id = t.season_id
  AND t.default_strategy IS NULL
  AND s.league_type IN ('travel', 'rec');

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT p.name, tp.locked_position, tp.excluded_positions,
--          tp.min_innings, tp.max_innings
--   FROM team_players tp JOIN players p ON p.id = tp.player_id
--   WHERE tp.locked_position IS NOT NULL
--      OR array_length(tp.excluded_positions, 1) > 0
--      OR tp.min_innings IS NOT NULL
--      OR tp.max_innings IS NOT NULL;
--
--   SELECT name, default_strategy, min_innings_all FROM teams;
