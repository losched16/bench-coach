-- ============================================================================
-- 058 — Drill calibration, phase 1
-- ============================================================================
--
-- 056 added the columns. This puts real values in about forty of them, and
-- deliberately in only about forty.
--
-- WHY NOT ALL 206
--
-- Every value here was read off the drill's own description, equipment list and
-- existing metadata. There is no model in this loop and no inference beyond
-- "this record says a partner kneels and tosses, so it needs two people". At
-- forty rows that is a person's afternoon and the values are defensible one at
-- a time. At 206 it would become pattern-matching on drill names, and the
-- result would be a library that LOOKS calibrated and quietly is not — which is
-- strictly worse than the honest NULLs it replaced, because retrieval treats a
-- stated value as a claim and an absent one as silence.
--
-- So: forty calibrated rows, 166 untouched and still fully eligible. The point
-- of this migration is to prove the mechanism against real data, not to raise a
-- completion percentage.
--
-- WHAT IS DELIBERATELY LEFT NULL
--
-- max_players is NULL on every row. Nothing in the library states an upper
-- bound, and a ceiling invented here would start silently excluding drills from
-- big teams — the exact failure mode this phase exists to prevent. Where a
-- drill is genuinely capped, that belongs in the record, not in a guess.
--
-- ideal_group_size is NULL for whole-team activities, because "the ideal group
-- for a cutoff drill" is not a number, it is the team.
--
-- COVERAGE THIS SET DELIBERATELY CARRIES (§19)
--
--   8U beginner        Tee Work, Four Cones, Wall Ball, Protect the Castle
--   8U advanced        Protect the Castle + Throw  (8–11, Advanced)
--   9U beginner        3 Great Drills for Teaching Fly Balls (7–12, Beginner)
--   9U developing      Outfield Drop Step, Quick Hands Quick Feet
--   9U advanced        Two Balls Toss Drill (9–12, Advanced)
--   10U developing     Figure Eight, Calm Rundowns
--   10U advanced       Two Balls Toss Drill, Pop-Up Slide (11–14 — see below)
--   12U beginner       Little League Cuts & Relays (8–12), Line Relay (8–13)
--   12U advanced       In-Swing Off-Speed, Daily Backhand Series
--
-- The one gap worth naming: before this migration the library's youngest
-- Advanced drill was min_age 9, so "advanced at 8U" was unrepresentable in the
-- DATA even though the code has always treated the two axes independently.
-- Protect the Castle + Throw is the first row that breaks it, and it is an
-- original activity rather than a re-labelling of somebody else's drill — the
-- alternative would have been editing ages or difficulty on existing rows to
-- manufacture the case, which is exactly the kind of invented certainty §21
-- rules out.
--
-- Idempotent. Re-running changes nothing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Activity families
--
-- Only where rows are genuinely variations of ONE concept. A family is not a
-- topic tag: "throwing accuracy games" would sweep three different games into
-- one family, and the scheduler would then be entitled to treat two of them as
-- the same activity. Where grouping is doubtful, no family — the name and video
-- fallbacks still work, and coverage beats a false grouping.
-- ---------------------------------------------------------------------------
INSERT INTO public.drill_activity_families (slug, name, description, primary_skill) VALUES
  ('protect-the-castle', 'Protect the Castle',
   'A fielder defends an object behind them while ground balls are rolled to either side. Original BenchCoach activity.',
   'ground-ball fielding'),
  ('ground-ball-fundamentals', 'Ground Ball Fundamentals',
   'Teaching the fielding position and a clean approach to a rolled or hit ground ball.',
   'ground-ball fielding'),
  ('tee-work', 'Tee Work',
   'Swings off a stationary tee, varied by ball height and hand.',
   'hitting'),
  ('soft-toss', 'Soft Toss',
   'A partner tosses into the hitting zone from the side or front.',
   'hitting'),
  ('solo-throwing-reps', 'Solo Throwing Reps',
   'Throw-catch-throw rhythm built against a wall or rebounder, with no partner needed.',
   'throwing'),
  ('rundowns', 'Rundowns',
   'Trapping a runner between bases and finishing the play in as few throws as possible.',
   'team defense'),
  ('cuts-and-relays', 'Cuts and Relays',
   'Getting the ball from the outfield to the right base through a cutoff man.',
   'team defense'),
  ('sliding', 'Sliding',
   'Bent-leg sliding technique and its game-speed variations.',
   'baserunning'),
  ('outfield-fly-ball-reads', 'Outfield Fly Ball Reads',
   'First step, route and catch on a ball hit over an outfielder.',
   'fly-ball fielding')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Protect the Castle (§20)
--
-- Original to BenchCoach — supplied by the product owner, not scraped, not
-- attributed to a channel, and with no youtube_video_id because there is no
-- video. `source` says so plainly so nothing downstream can mistake it for
-- curated third-party content.
--
-- The two rows are one family at two points on it, which is the case the family
-- column was added to represent: they must BOTH be able to appear in a library,
-- and must never both appear in one practice as if they were variety.
-- ---------------------------------------------------------------------------
INSERT INTO public.drill_resources (
  drill_name, description, skill_category, primary_skill, secondary_skill,
  age_range, min_age, max_age, difficulty_level, progression_level,
  indoor_outdoor, space_required, requires_partner, equipment_needed,
  est_duration_minutes, competition_level, status, source,
  activity_family_id, variation_type, activity_format, practice_roles,
  min_players, ideal_group_size, min_coaches, station_friendly,
  rep_density, idle_time_risk, engagement_level, competition_style,
  instruction_complexity, throwing_load, physical_intensity, mixed_skill_friendly,
  regression_notes, progression_notes, advanced_progression_notes
)
SELECT
  'Protect the Castle',
  'A fielder stands in front of an object — a cone, a bucket, a helmet — that is their castle. The coach rolls ground balls to either side and the fielder moves laterally to field the ball before it reaches the castle. Scoring is obvious to a six-year-old and the fielding position takes care of itself, because a player defending something naturally gets low and stays in front of the ball.',
  'Fielding (Infield)', 'ground-ball fielding', 'lateral movement',
  '6-10', 6, 10, 'Beginner', 2,
  'Both', 'Small', false,
  ARRAY['glove', 'baseballs', 'cone or bucket for the castle'],
  8, 'both', 'approved', 'benchcoach_original',
  f.id, 'base', 'station', ARRAY['repetition', 'competition'],
  1, 4, 1, true,
  'high', 'low', 'high', 'game',
  'low', 'none', 'medium', true,
  'Narrow the castle and roll the ball slower and more directly at the fielder. A player who cannot yet move laterally still gets the fielding position, which is the part that matters first.',
  'Widen the castle, roll harder, and alternate sides without telling them which. Add a second fielder and make it a two-player castle so they have to communicate.',
  'Add the throw — see "Protect the Castle + Throw", which is the same activity with an accurate throw to a target after the ball is fielded.'
FROM public.drill_activity_families f
WHERE f.slug = 'protect-the-castle'
  AND NOT EXISTS (SELECT 1 FROM public.drill_resources WHERE drill_name = 'Protect the Castle');

INSERT INTO public.drill_resources (
  drill_name, description, skill_category, primary_skill, secondary_skill,
  age_range, min_age, max_age, difficulty_level, progression_level,
  indoor_outdoor, space_required, requires_partner, equipment_needed,
  est_duration_minutes, competition_level, status, source,
  activity_family_id, variation_type, activity_format, practice_roles,
  min_players, ideal_group_size, min_coaches, station_friendly,
  rep_density, idle_time_risk, engagement_level, competition_style,
  instruction_complexity, throwing_load, physical_intensity, mixed_skill_friendly,
  regression_notes, progression_notes
)
SELECT
  'Protect the Castle + Throw',
  'Protect the Castle with the play finished. After fielding the ball the player must make an accurate throw to a target — a base, a coach, a net — before the rep counts. The castle keeps them in front of the ball; the throw stops them fielding it and standing up admiring it. Missing the target is a run, same as letting one through.',
  'Fielding (Infield)', 'ground-ball fielding', 'throwing accuracy',
  '8-11', 8, 11, 'Advanced', 3,
  'Both', 'Medium', false,
  ARRAY['glove', 'baseballs', 'cone or bucket for the castle', 'target or base'],
  10, 'both', 'approved', 'benchcoach_original',
  f.id, 'progression', 'station', ARRAY['progress', 'game_application', 'competition'],
  1, 4, 1, true,
  'high', 'low', 'high', 'game',
  'medium', 'medium', 'high', true,
  'Drop the throw and run the base version until the fielding is automatic. A player thinking about the throw stops moving their feet.',
  'Shrink the target, move it further away, or require the throw inside a count. Alternate the target between two bases so the fielder has to decide where the play is.'
FROM public.drill_activity_families f
WHERE f.slug = 'protect-the-castle'
  AND NOT EXISTS (SELECT 1 FROM public.drill_resources WHERE drill_name = 'Protect the Castle + Throw');

-- ---------------------------------------------------------------------------
-- 3. Calibrating the existing library
--
-- Matched on drill_name because that is what a person reading this migration
-- can check, and because ids differ between any two databases this has to run
-- against. Where a name has duplicate rows — "Soft Toss From the Side" has two
-- — both are updated, which is correct: they are the same activity, and after
-- this they will finally be DETECTABLE as the same activity, because they land
-- in one family at one variation_type and the scheduler's redundancy check
-- reads that directly instead of guessing from names.
--
-- COALESCE on nothing here: these columns are all NULL before this runs, so the
-- assignment is unconditional and re-running is a no-op.
-- ---------------------------------------------------------------------------
WITH calibration(
  drill_name, family_slug, variation_type, activity_format, practice_roles,
  min_players, ideal_group_size, min_coaches, station_friendly,
  rep_density, idle_time_risk, engagement_level, competition_style,
  instruction_complexity, throwing_load, physical_intensity, mixed_skill_friendly
) AS (VALUES
  -- ---- Hitting (7) -------------------------------------------------------
  ('Tee Work', 'tee-work', 'base', 'station', ARRAY['teach','repetition'],
   1, 3, 0, true, 'high', 'low', 'medium', 'none', 'low', 'none', 'low', true),
  ('Soft Toss From the Side', 'soft-toss', 'base', 'partner', ARRAY['repetition'],
   2, 3, 0, true, 'high', 'low', 'medium', 'none', 'low', 'none', 'low', true),
  -- An adult runs the L-screen, so this one costs a coach where tee work does not.
  ('Front Toss', NULL, NULL, 'small_group', ARRAY['repetition','progress'],
   2, 4, 1, true, 'medium', 'medium', 'medium', 'none', 'low', 'none', 'low', true),
  ('High Tee Drill', 'tee-work', 'progression', 'station', ARRAY['isolate','repetition'],
   1, 3, 0, true, 'high', 'low', 'medium', 'none', 'low', 'none', 'low', true),
  -- Bat and a fence. Nothing to chase, nobody to wait for — high reps, low fun.
  ('Inside-Out Swing Drill (Fence Drill)', NULL, NULL, 'individual', ARRAY['isolate','teach'],
   1, 4, 0, true, 'high', 'low', 'low', 'none', 'low', 'none', 'low', true),
  ('One-Hand Tee Drill (Top Hand)', 'tee-work', 'regression', 'station', ARRAY['isolate','repetition'],
   1, 3, 0, true, 'high', 'low', 'low', 'none', 'medium', 'none', 'low', true),
  -- 12–16, recognising off-speed mid-swing. Not a drill a mixed group runs together.
  ('In-Swing Off-Speed Adjustment', NULL, NULL, 'small_group', ARRAY['decision','game_application'],
   2, 4, 1, true, 'medium', 'medium', 'medium', 'none', 'high', 'none', 'low', false),

  -- ---- Throwing / receiving (6) ------------------------------------------
  -- The two rows that make a solo-coach practice possible: both run themselves.
  ('Wall Ball', 'solo-throwing-reps', 'base', 'individual', ARRAY['warmup','repetition'],
   1, 2, 0, true, 'high', 'low', 'medium', 'none', 'low', 'medium', 'low', true),
  ('Selfies Solo Rebounder — Build Reps Without a Partner', 'solo-throwing-reps', 'base', 'individual', ARRAY['repetition'],
   1, 2, 0, true, 'high', 'low', 'medium', 'none', 'low', 'medium', 'low', true),
  ('Partner Catch', NULL, NULL, 'partner', ARRAY['warmup','repetition'],
   2, 2, 0, true, 'high', 'low', 'low', 'none', 'low', 'medium', 'low', true),
  ('Bullseye Challenge — Throwing Accuracy Competition', NULL, NULL, 'station', ARRAY['competition','repetition'],
   2, 4, 0, true, 'high', 'low', 'high', 'scored', 'low', 'medium', 'low', true),
  -- Long throws at distance. High throwing load is a composition signal here,
  -- not a medical one — it exists so a plan does not stack four of these.
  ('Crow Hop Drill', NULL, NULL, 'partner', ARRAY['teach','repetition'],
   2, 2, 0, true, 'medium', 'low', 'medium', 'none', 'medium', 'high', 'medium', true),
  ('Quick Hands Quick Feet — Fast Transfer Drill', NULL, NULL, 'partner', ARRAY['isolate','repetition'],
   2, 2, 0, true, 'high', 'low', 'medium', 'none', 'low', 'medium', 'medium', true),

  -- ---- Infield (7) -------------------------------------------------------
  ('3 Simple Fielding Drills for Youth Players', 'ground-ball-fundamentals', 'base', 'small_group', ARRAY['teach','isolate'],
   2, 4, 1, true, 'medium', 'medium', 'medium', 'none', 'low', 'low', 'low', true),
  ('Four Cones Ground Ball Drill', 'ground-ball-fundamentals', 'space_variant', 'station', ARRAY['teach','repetition'],
   2, 4, 1, true, 'medium', 'medium', 'medium', 'none', 'low', 'low', 'medium', true),
  -- Balancing on one leg to feel the posture: the same concept with the movement
  -- taken away, which is what regression means.
  ('The Flamingo Drill', 'ground-ball-fundamentals', 'regression', 'station', ARRAY['isolate','teach'],
   1, 4, 0, true, 'medium', 'low', 'low', 'none', 'low', 'none', 'low', true),
  ('The Hands Routine — Infield Fielding Drill', NULL, NULL, 'individual', ARRAY['warmup','repetition'],
   1, 3, 0, true, 'high', 'low', 'medium', 'none', 'medium', 'low', 'low', true),
  ('Figure Eight Infield Drill', NULL, NULL, 'station', ARRAY['repetition','progress'],
   1, 4, 0, true, 'high', 'low', 'medium', 'none', 'medium', 'none', 'high', true),
  ('Three-Ball Slow Roller Drill', NULL, NULL, 'small_group', ARRAY['progress','game_application'],
   2, 3, 1, true, 'high', 'medium', 'high', 'none', 'medium', 'high', 'high', false),
  ('Daily Backhand Series', NULL, NULL, 'individual', ARRAY['isolate','repetition'],
   1, 3, 0, true, 'high', 'low', 'medium', 'none', 'high', 'low', 'medium', false),

  -- ---- Outfield (4) ------------------------------------------------------
  ('3 Great Drills for Teaching Fly Balls', 'outfield-fly-ball-reads', 'base', 'small_group', ARRAY['teach','repetition'],
   2, 5, 1, true, 'medium', 'medium', 'medium', 'none', 'low', 'low', 'medium', true),
  ('Call It Early — Outfield Communication Basics', NULL, NULL, 'small_group', ARRAY['teach','team_execution'],
   3, 4, 1, true, 'low', 'medium', 'medium', 'none', 'low', 'low', 'medium', true),
  ('Outfield Drop Step Drill', 'outfield-fly-ball-reads', 'progression', 'small_group', ARRAY['isolate','repetition'],
   2, 5, 1, true, 'medium', 'medium', 'medium', 'none', 'medium', 'low', 'high', true),
  -- Fungo, full field, a target at the plate. Not something to run beside two
  -- other stations, and saying so is the whole value of station_friendly.
  ('Do-or-Die Charge & Throw', NULL, NULL, 'small_group', ARRAY['progress','game_application'],
   3, 4, 1, false, 'medium', 'medium', 'high', 'none', 'medium', 'high', 'high', false),

  -- ---- Baserunning (4) ---------------------------------------------------
  ('Bent-Leg Slide Basics — The Right Way to Slide', 'sliding', 'base', 'small_group', ARRAY['teach'],
   1, 6, 1, true, 'low', 'medium', 'medium', 'none', 'medium', 'none', 'medium', true),
  -- A whole-team walk-through of a checklist. Honestly high idle time; it is
  -- still worth running, and a plan that stacks two of these is the problem.
  ('5-Point Baserunning Checklist Drill', NULL, NULL, 'full_team', ARRAY['teach','team_execution'],
   4, NULL, 1, false, 'low', 'high', 'low', 'none', 'medium', 'none', 'low', true),
  ('Steal Breaks — Reading the Pitcher & First Move', NULL, NULL, 'small_group', ARRAY['teach','decision'],
   2, 6, 1, true, 'medium', 'medium', 'medium', 'none', 'medium', 'none', 'high', true),
  ('Pop-Up Slide — Slide and Advance', 'sliding', 'progression', 'small_group', ARRAY['progress'],
   1, 6, 1, true, 'medium', 'medium', 'medium', 'none', 'medium', 'none', 'high', false),

  -- ---- Pitching / catching (4) -------------------------------------------
  ('Balance Point Drill — Leg Lift & Pause', NULL, NULL, 'individual', ARRAY['isolate','teach'],
   1, 4, 0, true, 'medium', 'low', 'low', 'none', 'low', 'none', 'low', true),
  -- The record says "no ball needed", so the throwing load is genuinely none.
  ('Towel Drill — Arm Speed & Release Point', NULL, NULL, 'partner', ARRAY['isolate','repetition'],
   2, 4, 0, true, 'high', 'low', 'medium', 'none', 'medium', 'none', 'low', true),
  ('Youth Receiving Foundations — Quiet Glove & Soft Hands', NULL, NULL, 'partner', ARRAY['teach','repetition'],
   2, 2, 1, true, 'high', 'low', 'medium', 'none', 'medium', 'low', 'low', true),
  ('Blocking the Right Way — Technique to Reaction Reps', NULL, NULL, 'partner', ARRAY['teach','progress'],
   2, 2, 1, true, 'high', 'low', 'medium', 'none', 'medium', 'low', 'high', true),

  -- ---- Team defense / IQ (5) ---------------------------------------------
  ('Line Relay Race — Catch, Turn, Throw', 'cuts-and-relays', 'base', 'small_group', ARRAY['competition','repetition'],
   6, 4, 1, true, 'high', 'low', 'high', 'team_vs_team', 'low', 'high', 'medium', true),
  ('Two-Base Pickle Drill', 'rundowns', 'base', 'small_group', ARRAY['teach','game_application'],
   3, 3, 0, true, 'medium', 'medium', 'high', 'none', 'low', 'medium', 'high', true),
  ('Little League Cuts & Relays System', 'cuts-and-relays', 'progression', 'full_team', ARRAY['team_execution'],
   7, NULL, 1, false, 'low', 'high', 'medium', 'none', 'high', 'medium', 'medium', true),
  ('Calm Rundowns — Push Back, Follow Your Throw', 'rundowns', 'progression', 'small_group', ARRAY['progress','game_application'],
   3, 4, 1, true, 'medium', 'medium', 'high', 'none', 'medium', 'medium', 'high', true),
  ('Cutoff Responsibilities by Situation', 'cuts-and-relays', 'advanced', 'full_team', ARRAY['team_execution','decision'],
   7, NULL, 1, false, 'low', 'high', 'medium', 'none', 'high', 'medium', 'medium', false),

  -- ---- Fun / competitive (5) ---------------------------------------------
  -- Balls spread over the whole field. Genuinely not a station, and the highest
  -- engagement in the set — this is the one coaches finish practice with.
  ('Clean Up Crew — Fun Fielding-to-Throw Game', NULL, NULL, 'full_team', ARRAY['finish','competition'],
   3, NULL, 1, false, 'high', 'low', 'high', 'game', 'low', 'high', 'high', true),
  ('Throwing Accuracy Race — Competitive Catch Under Pressure', NULL, NULL, 'station', ARRAY['competition','repetition'],
   4, 4, 0, true, 'high', 'low', 'high', 'head_to_head', 'low', 'high', 'medium', true),
  ('Fun Fielding Drill for Young Players', NULL, NULL, 'station', ARRAY['repetition','competition'],
   2, 4, 1, true, 'high', 'low', 'high', 'scored', 'low', 'low', 'medium', true),
  ('Competitive Team Bunting Game', NULL, NULL, 'game', ARRAY['competition','game_application'],
   6, NULL, 1, false, 'medium', 'medium', 'high', 'team_vs_team', 'medium', 'low', 'medium', false),
  -- Same family as soft toss, a different point on it. Both must survive into
  -- one library; neither should appear twice in one practice.
  ('Two Balls Toss Drill', 'soft-toss', 'advanced', 'partner', ARRAY['progress','decision'],
   2, 3, 0, true, 'high', 'low', 'high', 'none', 'medium', 'none', 'low', false)
)
UPDATE public.drill_resources d SET
  activity_family_id     = f.id,
  variation_type         = c.variation_type,
  activity_format        = c.activity_format,
  practice_roles         = c.practice_roles,
  min_players            = c.min_players,
  ideal_group_size       = c.ideal_group_size,
  min_coaches            = c.min_coaches,
  station_friendly       = c.station_friendly,
  rep_density            = c.rep_density,
  idle_time_risk         = c.idle_time_risk,
  engagement_level       = c.engagement_level,
  competition_style      = c.competition_style,
  instruction_complexity = c.instruction_complexity,
  throwing_load          = c.throwing_load,
  physical_intensity     = c.physical_intensity,
  mixed_skill_friendly   = c.mixed_skill_friendly,
  updated_at             = NOW()
FROM calibration c
LEFT JOIN public.drill_activity_families f ON f.slug = c.family_slug
WHERE d.drill_name = c.drill_name;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect roughly 44 calibrated rows (42 names, one of which has two rows in
-- production, plus the two originals) out of 208, and every family used:
--
--   SELECT count(*) FILTER (WHERE station_friendly IS NOT NULL) AS calibrated,
--          count(*) FILTER (WHERE activity_family_id IS NOT NULL) AS in_a_family,
--          count(*) AS total
--   FROM drill_resources;
--
--   SELECT f.slug, count(d.id)
--   FROM drill_activity_families f
--   LEFT JOIN drill_resources d ON d.activity_family_id = f.id
--   GROUP BY 1 ORDER BY 2 DESC;
--
-- Nothing should be excluded by this migration. The count of drills a 10-player
-- rec team can be offered must not fall:
--
--   SELECT count(*) FROM drill_resources
--   WHERE min_players IS NULL OR min_players <= 10;
