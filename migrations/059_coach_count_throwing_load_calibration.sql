-- ============================================================================
-- 059 — Targeted coach-count and throwing-load calibration
-- ============================================================================
--
-- 056 added min_coaches and throwing_load. 058 filled them for 42 drills. Live
-- validation then produced two honest negative results, both recorded in
-- docs/drill-station-intelligence.md, and both saying the same thing:
--
--   "The coach count changed nothing in the live practices."
--   "The light-throwing practice was right for the wrong reason."
--
-- Neither was a code defect. Both were missing data, and this migration is the
-- data. It touches 22 drills and only two columns.
--
-- WHY THESE 22 AND NOT THE OTHER 163
--
-- The criterion is the one the doc itself named: calibrate the drills where
-- the signal would actually change a decision. Every row below is a Throwing,
-- Arm Care, Infield or Team Defense drill — the set a "game tomorrow, keep it
-- light" practice actually picks from. Calibrating hitting drills would raise
-- a completion percentage and change no outcome.
--
-- Every value was read off the drill's own description and equipment list.
-- No model, no inference from the name.
--
-- WHAT min_coaches ACTUALLY MEANS, BECAUSE IT IS NOT OBVIOUS
--
-- It is not "how many adults should attend". It is how many adults THIS
-- activity consumes, and the retrieval and station code read it three ways:
--
--   0  self-running — a tee, a wall, a partner. Free in a rotation.
--   1  coach-dependent — occupies one adult. Hard-gates only at zero coaches,
--      which never happens, so in practice this is a staffing signal.
--   2  needs two adults. HARD-GATES the drill away from a solo coach.
--
-- NULL is read as 0 everywhere. That default is why the gate was dead: 163
-- uncalibrated drills all looked self-running, so the planner believed one
-- coach could staff three simultaneous coach-fed stations. The fix is mostly
-- not "find drills needing two coaches" — it is marking the ones that occupy
-- an adult at all.
--
-- THE ONE min_coaches = 2 IN HERE
--
-- Machine-Fed Relay Sequences needs someone running the machine AND someone
-- coaching the relay. It is the first drill in the library that a solo coach
-- cannot be given, so it was checked against the standing rule that no problem
-- may drop to zero prescribable drills: its only mapping is 'cutoffs-relays',
-- which keeps 3 solo-coach alternatives. Verified before writing this, not
-- assumed.
--
-- WHY throwing_load IS NOT SET FROM CATEGORY
--
-- A Throwing drill is not automatically high load. Kneel-Down Throw is fifteen
-- feet on both knees; Long Toss is maximum distance with pulldowns. Reading
-- "Throwing" as "high" would make the game-tomorrow constraint reject the
-- warm-up along with the arm-shredder, and a coach who saw that once would
-- stop trusting the constraint. Load here is volume and intensity of THROWS,
-- read per drill:
--
--   none    no ball leaves a hand (bands, stretches)
--   low     short, controlled, or instructional throws
--   medium  full-effort throws at normal distance, or high-rep short ones
--   high    maximum distance or maximum effort — what you skip before a game
--
-- Keyed on id, not drill_name: the library contains duplicate names (two rows
-- called "Soft Toss From the Side"), and a name-keyed UPDATE would silently
-- write to both.
-- ============================================================================

BEGIN;

WITH calibration(id, drill_name, min_coaches, throwing_load) AS (VALUES
  -- ── high: maximum distance or effort. The drills a game-tomorrow practice
  --    should visibly decline to schedule. ────────────────────────────────
  ('2b5adf22-f8b1-4cfe-87e9-fe7ec1a1957e'::uuid, 'Long Toss Progression — Building Arm Strength Safely', 1, 'high'),
  ('3f2af696-fe22-4fb6-936f-fefe7d86681a'::uuid, 'Long Toss',                                            1, 'high'),
  ('73f5fef2-af64-4577-998d-da854cebb0cf'::uuid, 'Crow Hop — Arm Strength and Outfield Throwing',        0, 'high'),
  ('012241e0-c2ce-4a32-b037-39f90bd35437'::uuid, 'Extreme Catch — Progressive Distance Arm Builder',     0, 'high'),
  -- Machine + relay: two adults. The first hard coach gate in the library.
  ('62b2ed36-03da-4e9d-a424-1d94620fde7d'::uuid, 'Machine-Fed Relay Sequences at Game Speed',            2, 'high'),

  -- ── medium: full-effort throws at normal distance, or high-rep short ones ─
  ('455f390b-dd25-4389-a65d-9485f7b6fa53'::uuid, '10 Best Baseball Throwing Drills for Kids',            1, 'medium'),
  ('02521925-f738-4f32-a8e5-cc2951732244'::uuid, '10 Best Baseball Throwing Drills for Kids — Full Progression', 1, 'medium'),
  ('28d76619-82c7-4b4f-aaa8-16464ba10b1b'::uuid, 'Throwing Progression for Youth Players',               1, 'medium'),
  ('69d859e5-5214-4b2d-b42f-07fcc56ff519'::uuid, 'Throwing Progression for Youth Players — Knee, Hip, Full', 1, 'medium'),
  -- Short throws, but continuous — the volume is in the rep count, not the arc.
  ('e40632d7-5ffb-42e9-9652-bd9a49e68ff5'::uuid, 'Quick Hands Drill',                                    0, 'medium'),

  -- ── low: short, controlled or instructional throwing ────────────────────
  ('a663b235-d115-4a52-a9d4-b33ba37e0e2a'::uuid, 'Foul Line Throw — First Throw Introduction for Beginners', 1, 'low'),
  ('6759598d-9bfc-47b2-91f1-31c77fc97cb5'::uuid, 'Kneel-Down Throw — Isolating Upper Body and Wrist Snap', 0, 'low'),
  ('ce798b52-883f-4cf3-a6b8-311ef084a1be'::uuid, 'Funnel Drill — Correct Arm Path Out of the Glove',      0, 'low'),
  ('0200c065-9f6f-4a76-bd9a-22e46141a6ce'::uuid, 'The Ankle Eye Drill — Footwork Foundation',             0, 'low'),
  -- The record says the COACH asks for the high five before each throw. That
  -- is an adult standing in the drill, not a cue a player gives themselves.
  ('e4309ffb-fa02-4c6d-ac87-a6580e8c5bff'::uuid, 'High Five Drill — Elbow Up Arm Path Correction',        1, 'low'),
  ('e9b7c3c8-ce7b-44d9-9311-cacf9354400d'::uuid, 'How to Throw a Baseball — Complete Beginner Mechanics', 1, 'low'),
  ('09b8ebeb-a43d-40db-b1ae-eaa44e48f82c'::uuid, 'EASY Baseball Catch Drill — First Catch Fundamentals',  1, 'low'),
  ('f94e6efc-9146-469b-bee2-c46466d882aa'::uuid, 'Catch Drill',                                           0, 'low'),
  ('d6a3170b-ec74-4e4f-96df-64fba2aed225'::uuid, 'Warm-Up Catch',                                         0, 'low'),
  ('dfa91c84-6ce8-4d03-9c5d-4252adc5fe3d'::uuid, 'Complete Pitching and Throwing Warm-Up Routine',        1, 'low'),

  -- ── none: no ball leaves a hand. What a game-tomorrow practice CAN have. ─
  ('9d95c228-0f42-487d-bfa0-164df2646c50'::uuid, '9-Exercise J-Band Strength Routine',                    0, 'none'),
  ('977c1fd1-12b0-42c6-8b8b-e3a90303e385'::uuid, 'Baseball Arm Stretches and Pre-Throwing Warm-Up',       0, 'none')
)
UPDATE public.drill_resources d SET
  min_coaches   = c.min_coaches,
  throwing_load = c.throwing_load,
  updated_at    = NOW()
FROM calibration c
WHERE d.id = c.id
  -- The name is carried through the VALUES list so this migration reads as a
  -- record of WHICH drills were calibrated, and so a drill renamed or replaced
  -- since this was written fails the join loudly instead of writing a value
  -- onto whatever now holds that id.
  AND d.drill_name = c.drill_name;

COMMIT;

-- Verification (run after applying):
--
--   SELECT throwing_load, count(*) FROM drill_resources
--    WHERE status='approved' GROUP BY throwing_load ORDER BY 1;
--
--   SELECT count(*) FROM drill_resources
--    WHERE status='approved' AND min_coaches > 1;      -- expect 1, was 0
