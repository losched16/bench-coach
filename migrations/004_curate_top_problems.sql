-- ============================================================================
-- Migration 004: Curated prescriptions — wave 1 (12 high-traffic problems)
-- ============================================================================
-- Hand-curated by reviewing the real drill library. For each problem, 2-3
-- on-target drills sequenced foundational -> advanced, with verified reps,
-- frequency, progression, and a measurable success marker.
-- Run AFTER 001-003. Idempotent.
-- ============================================================================

-- 1. Per-drill dosage + success markers + progression
UPDATE drill_resources SET progression_level = 1, reps_guidance = '2 sets of 8 — freeze 2 sec on the stride before swinging', frequency_guidance = '3x/week or 5 min daily', success_markers = ARRAY['Lands in a balanced stride and can hold it still before swinging.'] WHERE id = 'f35c8a06-d0e9-4a8b-ac8a-efffb204f026'; -- Stride Pause to Stride Swing Drill
UPDATE drill_resources SET progression_level = 2, reps_guidance = '3 rounds of 10', frequency_guidance = '2-3x/week', success_markers = ARRAY['Lets the ball travel into the zone and squares it up on a line.'] WHERE id = '18e0cf1e-7f9b-4e51-9125-db81b04811a3'; -- Soft Toss From the Side
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 rounds of 8-10', frequency_guidance = '2-3x/week', success_markers = ARRAY['Drives line drives up the middle against game-speed tosses, on time.'] WHERE id = '54cf8f72-be57-478b-8a6d-bb084cadbddf'; -- Front Toss Drill
UPDATE drill_resources SET progression_level = 2, reps_guidance = '2 sets of 8 with a light bat', frequency_guidance = '2-3x/week', success_markers = ARRAY['Drives through the ball palm-up with a short, direct path.'] WHERE id = '0ddcfd4a-2520-4d3a-ae98-b647bf07c49b'; -- One-Hand Tee Drill (Top Hand)
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 sets of 8', frequency_guidance = '2x/week', success_markers = ARRAY['Front elbow stays tucked — no flare-out at the start of the swing.'] WHERE id = 'ac27e607-b52e-4865-8240-5a9b7795a410'; -- The Swing Rail / Stay Inside the Ball Drill
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 sets of 8', frequency_guidance = '2x/week', success_markers = ARRAY['Swings without hitting the fence and drives the ball the other way.'] WHERE id = '55afb864-a8b0-496c-9b08-3e6805c7902d'; -- Inside-Out Swing Drill (Fence Drill)
UPDATE drill_resources SET progression_level = 1, reps_guidance = '2 sets of 10 setups', frequency_guidance = 'daily, 3 min', success_markers = ARRAY['Sets up athletic and balanced every time without a reminder.'] WHERE id = '252404f0-38c3-481f-a18b-f7ce0262903f'; -- Stance & Athletic Position Drill
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 rounds of 10', frequency_guidance = '2-3x/week', success_markers = ARRAY['Tracks the tiny ball all the way to contact and makes consistent contact.'] WHERE id = 'ee6aa905-1e2c-4f96-8eff-4dc22fc01d4f'; -- Mini Wiffle Ball & Skinny Bat Drill
UPDATE drill_resources SET progression_level = 2, reps_guidance = '3 sets of 10', frequency_guidance = '2-3x/week', success_markers = ARRAY['Makes contact out in front and drives line drives, not weak grounders.'] WHERE id = '9300e679-69a7-4757-b74d-172103654860'; -- Tee Work — Ball Out In Front
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 sets of 8', frequency_guidance = '2x/week', success_markers = ARRAY['Stays centered over the back side without drifting forward.'] WHERE id = '40eebd5c-d2ab-4245-92bc-5cf73e68ba87'; -- Back Knee Down - Stay Centered
UPDATE drill_resources SET progression_level = 1, reps_guidance = '3 sets of 10', frequency_guidance = '2-3x/week', success_markers = ARRAY['Hits firm line drives back up the middle, not pop-ups or choppers.'] WHERE id = '6a2c9dc7-f08c-47fd-9a08-f9e117f466cb'; -- Tee Work
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 sets of 8', frequency_guidance = '2x/week', success_markers = ARRAY['Stays in the legs and drives low pitches on a line, not under them.'] WHERE id = 'e597ce36-5625-42f2-a378-30052499bb18'; -- Low Tee
UPDATE drill_resources SET progression_level = 3, reps_guidance = '3 sets of 8', frequency_guidance = '2x/week', success_markers = ARRAY['Ball flies straight back off the bat (level path) on most swings.'] WHERE id = '7a2a344c-b2d7-4bf6-b0a2-e1dec8d835ab'; -- Line Drive Pro / Visual Feedback Swing Drill
UPDATE drill_resources SET progression_level = 1, reps_guidance = '2 sets of 10 throws through the progression', frequency_guidance = 'every throwing day', success_markers = ARRAY['Shows a 4-seam grip, steps to the target, and follows through every throw.'] WHERE id = '28d76619-82c7-4b4f-aaa8-16464ba10b1b'; -- Throwing Progression for Youth Players
UPDATE drill_resources SET progression_level = 2, reps_guidance = '2 sets of 10 throws', frequency_guidance = '2-3x/week', success_markers = ARRAY['No "scarecrow" — the ball comes up out of the glove in a smooth arm circle.'] WHERE id = 'e9b7c3c8-ce7b-44d9-9311-cacf9354400d'; -- How to Throw a Baseball — Complete Beginner Mechanics
UPDATE drill_resources SET progression_level = 3, reps_guidance = '2 sets of 12 throws', frequency_guidance = '2x/week', success_markers = ARRAY['Throws with a clean arm circle and finishes over the front side, no arm pain.'] WHERE id = '1a1767cc-35ca-47f3-ad7d-5a920add6597'; -- How to Throw the RIGHT WAY
UPDATE drill_resources SET progression_level = 2, reps_guidance = '2 sets of 10 throws', frequency_guidance = '2-3x/week', success_markers = ARRAY['Points the back-foot "ankle eye" and lands stepping right at the target.'] WHERE id = '0200c065-9f6f-4a76-bd9a-22e46141a6ce'; -- The Ankle Eye Drill — Footwork Foundation
UPDATE drill_resources SET progression_level = 3, reps_guidance = 'Pick 2 drills, 10 throws each', frequency_guidance = '2x/week', success_markers = ARRAY['Hits a partner''s chest on most throws from 30+ feet.'] WHERE id = '455f390b-dd25-4389-a65d-9485f7b6fa53'; -- 10 Best Baseball Throwing Drills for Kids
UPDATE drill_resources SET progression_level = 1, reps_guidance = '15 ground balls', frequency_guidance = '2-3x/week', success_markers = ARRAY['Fields with butt down, glove out front, and watches it into the glove.'] WHERE id = 'f0c8b459-6bb1-499b-8fae-3969e7917846'; -- 3 Simple Fielding Drills for Youth Players
UPDATE drill_resources SET progression_level = 2, reps_guidance = '2 sets of 10 ground balls', frequency_guidance = '2x/week', success_markers = ARRAY['Shuffles to get in front of the ball and fields through it moving forward.'] WHERE id = '781605ce-10f5-400c-b7e2-6243915b5da2'; -- Four Cones Ground Ball Drill
UPDATE drill_resources SET progression_level = 1, reps_guidance = '2 sets of 10 catches (soft/tennis ball)', frequency_guidance = 'daily, 5 min', success_markers = ARRAY['Keeps eyes on the ball and catches with two hands without flinching.'] WHERE id = '5c529012-7999-489d-90cb-4ccbeab94846'; -- How to Get a T-Baller to Catch a Ball
UPDATE drill_resources SET progression_level = 2, reps_guidance = '2 sets of 10 catches', frequency_guidance = '2-3x/week', success_markers = ARRAY['Uses "fingers up" above the waist, "fingers down" below — catches cleanly.'] WHERE id = '09b8ebeb-a43d-40db-b1ae-eaa44e48f82c'; -- EASY Baseball Catch Drill — First Catch Fundamentals
UPDATE drill_resources SET progression_level = 1, reps_guidance = '5-8 reps, hold 2-3 sec each', frequency_guidance = 'every pitching day', success_markers = ARRAY['Holds the leg lift balanced for 2 seconds without wobbling or falling forward.'] WHERE id = 'a54d536f-e4f0-4dd5-91d2-d007bd274250'; -- Balance Point Drill — Leg Lift & Pause
UPDATE drill_resources SET progression_level = 2, reps_guidance = '8-10 reps, stop at each checkpoint', frequency_guidance = '2-3x/week', success_markers = ARRAY['Stops balanced at each checkpoint instead of rushing through the motion.'] WHERE id = '253fee8d-d86f-497b-83db-44e622fb0a2d'; -- 4-Part Windup Drill — Breaking Down the Delivery
UPDATE drill_resources SET progression_level = 3, reps_guidance = '8-10 reps', frequency_guidance = '2x/week', success_markers = ARRAY['Builds momentum smoothly and stays on time — not rushed or out of sync.'] WHERE id = 'cf56cda8-d397-4ed7-873b-560b78d6473e'; -- The Swing Shuffle Drill — Momentum & Rhythm

-- 2. Curated, sequenced drill->problem mappings
-- late-timing
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('f35c8a06-d0e9-4a8b-ac8a-efffb204f026', 'late-timing', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('18e0cf1e-7f9b-4e51-9125-db81b04811a3', 'late-timing', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('54cf8f72-be57-478b-8a6d-bb084cadbddf', 'late-timing', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- casting
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('0ddcfd4a-2520-4d3a-ae98-b647bf07c49b', 'casting', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('ac27e607-b52e-4865-8240-5a9b7795a410', 'casting', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('55afb864-a8b0-496c-9b08-3e6805c7902d', 'casting', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- stepping-in-bucket
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('252404f0-38c3-481f-a18b-f7ce0262903f', 'stepping-in-bucket', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('f35c8a06-d0e9-4a8b-ac8a-efffb204f026', 'stepping-in-bucket', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- pulling-head
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('18e0cf1e-7f9b-4e51-9125-db81b04811a3', 'pulling-head', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('ee6aa905-1e2c-4f96-8eff-4dc22fc01d4f', 'pulling-head', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('54cf8f72-be57-478b-8a6d-bb084cadbddf', 'pulling-head', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- rolling-over
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('9300e679-69a7-4757-b74d-172103654860', 'rolling-over', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('0ddcfd4a-2520-4d3a-ae98-b647bf07c49b', 'rolling-over', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('55afb864-a8b0-496c-9b08-3e6805c7902d', 'rolling-over', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- lunging
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('252404f0-38c3-481f-a18b-f7ce0262903f', 'lunging', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('f35c8a06-d0e9-4a8b-ac8a-efffb204f026', 'lunging', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('40eebd5c-d2ab-4245-92bc-5cf73e68ba87', 'lunging', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- uppercutting
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('6a2c9dc7-f08c-47fd-9a08-f9e117f466cb', 'uppercutting', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('e597ce36-5625-42f2-a378-30052499bb18', 'uppercutting', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('7a2a344c-b2d7-4bf6-b0a2-e1dec8d835ab', 'uppercutting', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- throwing-mechanics
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('28d76619-82c7-4b4f-aaa8-16464ba10b1b', 'throwing-mechanics', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('e9b7c3c8-ce7b-44d9-9311-cacf9354400d', 'throwing-mechanics', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('1a1767cc-35ca-47f3-ad7d-5a920add6597', 'throwing-mechanics', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- inaccurate-throws
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('28d76619-82c7-4b4f-aaa8-16464ba10b1b', 'inaccurate-throws', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('0200c065-9f6f-4a76-bd9a-22e46141a6ce', 'inaccurate-throws', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('455f390b-dd25-4389-a65d-9485f7b6fa53', 'inaccurate-throws', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- fielding-flat-footed
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('f0c8b459-6bb1-499b-8fae-3969e7917846', 'fielding-flat-footed', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('781605ce-10f5-400c-b7e2-6243915b5da2', 'fielding-flat-footed', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- fear-of-ball
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('5c529012-7999-489d-90cb-4ccbeab94846', 'fear-of-ball', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('09b8ebeb-a43d-40db-b1ae-eaa44e48f82c', 'fear-of-ball', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('f0c8b459-6bb1-499b-8fae-3969e7917846', 'fear-of-ball', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
-- rushing-delivery
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('a54d536f-e4f0-4dd5-91d2-d007bd274250', 'rushing-delivery', 1, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('253fee8d-d86f-497b-83db-44e622fb0a2d', 'rushing-delivery', 2, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES ('cf56cda8-d397-4ed7-873b-560b78d6473e', 'rushing-delivery', 3, TRUE)
  ON CONFLICT (drill_id, problem_slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, curated = TRUE;
