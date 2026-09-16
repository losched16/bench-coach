-- ============================================================================
-- 068 — The last five unreviewed rows, and the taxonomy gaps
-- ============================================================================
--
-- Two jobs that share a transaction because they share a risk: both change what
-- the prescription engine is allowed to offer, and the only thing that must not
-- happen is a problem_taxonomy entry ending up with nothing behind it.
--
-- PART ONE — the five REVIEW_REQUIRED rows get a resource_kind
--
-- Phase 1 left five rows unclassified rather than guess, and resource_kind NULL
-- has meant "unreviewed but still usable" ever since. Two of the five were
-- unresolved because they shared a video with another drill and might have been
-- that drill under a different name. That premise is now disproven: the Hip Lead
-- video backs NINETEEN distinct rows — Wall Ball, Long Toss, High Five, the
-- Heel-Toe drill — and the Warm-Up Catch video backs TEN, including High Tee.
-- They are compilations. Sharing one carries no information about identity, so
-- the argument for merging those rows never had anything under it.
--
--   One-Knee Receiving      → practice_unit   five receiving drills at one
--                                             station, the same shape as the
--                                             MLB-Style Framing Circuit, which
--                                             is already a practice_unit
--   Warm-Up Catch           → practice_unit   a staged pre-practice routine,
--                                             not a single station
--   The Best Youth Infield  → activity        one team drill, one video of its
--                                             own, singular by name and setup
--   Stay Back               → activity        one station: varied-speed front
--                                             toss, three rounds of twelve
--   Hip Lead Drill          → activity        its own setup, and the only
--                                             reason to doubt it was the video
--
-- practice_unit is still schedulable, but /api/prescribe excludes it. Both
-- promoted rows were checked against that narrower pool: every problem they map
-- to keeps other prescribable drills, so this starves nothing.
--
-- PART TWO — taxonomy gaps
--
-- 35 curated drills mapped to no problem. Fourteen are source collections and
-- teaching content that a coach is never offered, so a mapping on them would
-- inflate coverage without improving it; those stay unmapped on purpose. Twenty
-- get 26 mappings. One — Freeze at Extension — is left unmapped and flagged,
-- because the nearest problem in the taxonomy is about the front arm locking
-- EARLY and this drill trains the finish; mapping it could prescribe it to
-- exactly the hitter it would hurt.
--
-- One mapping is removed: "How to Get a T-Baller to Catch a Ball" is a Catching
-- row attached to plate-confidence, a Hitting problem about standing in against
-- live pitching. plate-confidence keeps "Turn and Take It" afterwards, so it
-- does not go to zero.
--
-- Starved problems: 0 before, 0 after, in both the schedulable pool and the
-- narrower prescribe pool. Nothing is deleted except that one wrong mapping.
--
-- Generated in part by scripts/build-taxonomy-gap-review.ts --sql, from
-- scripts/fixtures/taxonomy-gap-decisions.tsv.
-- ============================================================================

BEGIN;

-- ── PART ONE ────────────────────────────────────────────────────────────────

UPDATE public.drill_resources SET resource_kind = 'practice_unit', updated_at = now()
 WHERE id IN (
   '478cb186-6370-494d-b94a-47136344ccd8',  -- One-Knee Receiving — Advanced Framing Setup
   'd6a3170b-ec74-4e4f-96df-64fba2aed225'   -- Warm-Up Catch
 ) AND resource_kind IS DISTINCT FROM 'practice_unit';

UPDATE public.drill_resources SET resource_kind = 'activity', updated_at = now()
 WHERE id IN (
   'adf1d78d-fbe5-417c-a2d0-5860e555b356',  -- The Best Youth Infield Drill
   '6c655fff-6181-4b7b-b22b-e1401e2e1f27',  -- Stay Back — Beat the Changeup
   'e5d28c39-30b0-48fd-9534-8a43cd8154db'   -- Hip Lead Drill
 ) AND resource_kind IS DISTINCT FROM 'activity';

-- ── PART TWO ────────────────────────────────────────────────────────────────

-- How to Get a T-Baller to Catch a Ball is a Catching row mapped to a Hitting problem about
-- standing in against live pitching. Nothing about catching addresses it.
-- plate-confidence keeps "Turn and Take It", so it does not go to zero.
DELETE FROM public.drill_problem_map
 WHERE drill_id = '5c529012-7999-489d-90cb-4ccbeab94846' AND problem_slug = 'plate-confidence';

-- Base Running Circuit → slow-first-step  (high)
-- The circuit's first station is an explosive three-step start on an unpredictable signal.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('ecf4c61b-0b8b-49bd-bbe5-697d42991d79', 'slow-first-step', 100, true)
ON CONFLICT DO NOTHING;

-- Base Running Circuit → bad-base-turns  (high)
-- Cutting the inside corner of the base is one of the circuit's scored success markers.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('ecf4c61b-0b8b-49bd-bbe5-697d42991d79', 'bad-base-turns', 100, true)
ON CONFLICT DO NOTHING;

-- Bunting with Lacrosse Stick → cant-bunt  (high)
-- A bunting station whose whole feedback loop is whether the bunt was placed.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('a648dcab-45b3-4c81-9ed4-f29eaea4323e', 'cant-bunt', 100, true)
ON CONFLICT DO NOTHING;

-- Fly Ball Drill with Cones → backpedaling-flyballs  (high)
-- The cone gives the fielder somewhere to turn and run to, which is the direct alternative to backpedalling.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('29276b7a-fd04-45ff-825d-1d715d384908', 'backpedaling-flyballs', 100, true)
ON CONFLICT DO NOTHING;

-- Youth Infield Drill (Practice Anywhere) → poor-fielding-footwork  (high)
-- Posture and footwork are the drill's stated subject and its success markers.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('6f1ef230-3f1a-4bcd-a969-87be5cdc65ed', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- Youth Infield Drill (Practice Anywhere) → slow-transfer  (high)
-- Every rep ends with a glove-to-hand exchange in front of the chest, scored as a marker.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('6f1ef230-3f1a-4bcd-a969-87be5cdc65ed', 'slow-transfer', 100, true)
ON CONFLICT DO NOTHING;

-- Protect the Castle → poor-fielding-footwork  (high)
-- Lateral movement to get the body in front is the scoring condition of the game.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('9fea10f7-efb9-4006-bce8-7a6109bb7fbe', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- Protect the Castle → fielding-flat-footed  (high)
-- Staying low between rolls is an explicit success marker; the castle produces the crouch on its own.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('9fea10f7-efb9-4006-bce8-7a6109bb7fbe', 'fielding-flat-footed', 100, true)
ON CONFLICT DO NOTHING;

-- Protect the Castle + Throw → poor-fielding-footwork  (high)
-- Same fielding requirement as the base version, with the play completed.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('6b13a4df-dc75-417f-89db-578fe99bdf44', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- Protect the Castle + Throw → inaccurate-throws  (high)
-- A throw that misses the target scores against the fielder exactly like a ball through the castle.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('6b13a4df-dc75-417f-89db-578fe99bdf44', 'inaccurate-throws', 100, true)
ON CONFLICT DO NOTHING;

-- Cross-Shuffle Drill → poor-fielding-footwork  (high)
-- The lateral shuffle without crossing the feet is the drill's first success marker.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('0833de14-902c-408a-a3a9-a8c4df28c4f1', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- The Flamingo Drill → fielding-flat-footed  (high)
-- The one-leg hold makes a tall, heel-weighted posture physically impossible to hold.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('4c68b693-a617-4827-a732-653c2a64a27d', 'fielding-flat-footed', 100, true)
ON CONFLICT DO NOTHING;

-- Figure Eight Infield Drill → poor-fielding-footwork  (high)
-- Continuous direction changes around two cones, with every ball fielded on the move.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('c345c3a1-bda3-43f7-b6f3-16e77432ab83', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- Figure Eight Infield Drill → fielding-flat-footed  (high)
-- Staying low through the whole pattern is the marker the drill exists to build.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('c345c3a1-bda3-43f7-b6f3-16e77432ab83', 'fielding-flat-footed', 100, true)
ON CONFLICT DO NOTHING;

-- The Best Youth Infield Drill → poor-fielding-footwork  (medium)
-- A high-rep ground-ball circuit; footwork is what the single coached cue is spent on. Lower confidence because the row is a volume drill rather than a corrective one.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('adf1d78d-fbe5-417c-a2d0-5860e555b356', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- The Cone Drill → poor-fielding-footwork  (high)
-- The cone exists to break the straight-line approach and force an angle.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('6517d249-a27d-41af-a86e-72bb8187c28b', 'poor-fielding-footwork', 100, true)
ON CONFLICT DO NOTHING;

-- PVC Posture Drill → loses-posture  (high)
-- The pipe across the shoulders is a posture mirror; the whole drill is shoulder angle by pitch height.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('5abc9df7-d4ad-40d3-b95e-2eb275e82710', 'loses-posture', 100, true)
ON CONFLICT DO NOTHING;

-- Load to Launch Drill → lunging  (high)
-- The held launch position exists to show that the hands stay back when the front foot lands.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('31af2888-b541-479e-8a0f-78bcb528ea17', 'lunging', 100, true)
ON CONFLICT DO NOTHING;

-- Baby Steps - Hip Load → lunging  (high)
-- Staged specifically so the weight loads into the back hip instead of drifting forward with the stride.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('0997fc64-a8e8-44b1-995c-3aa1e0291a99', 'lunging', 100, true)
ON CONFLICT DO NOTHING;

-- Two Balls Toss Drill → late-timing  (medium)
-- Trains seeing rather than pre-deciding, which is the root of guess-hitting. Medium because the drill deliberately makes contact later before it makes it better.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('1f64a6c2-11bd-40d4-a45d-ae028f83db91', 'late-timing', 100, true)
ON CONFLICT DO NOTHING;

-- Ripken Soft Toss Drill → casting  (high)
-- The no-stride setup removes every excuse but bat path, which is what casting is.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('4cd55f36-4ac8-447a-9633-936c9b1f6c22', 'casting', 100, true)
ON CONFLICT DO NOTHING;

-- Ripken Soft Toss Drill → lunging  (high)
-- The wide already-strided stance makes drifting forward physically impossible.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('4cd55f36-4ac8-447a-9633-936c9b1f6c22', 'lunging', 100, true)
ON CONFLICT DO NOTHING;

-- Sunflower Seed Soft Toss → pulling-head  (high)
-- A seed is small enough that only a still head connects with it; head position is the graded marker.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('fac499f5-7d4b-49b2-a924-55c97a96eeef', 'pulling-head', 100, true)
ON CONFLICT DO NOTHING;

-- Fun Baseball Throwing Drill → inaccurate-throws  (high)
-- Scored purely on whether the throw hit a target.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('663dc298-e5f2-4ea8-9d6d-6812e652cf28', 'inaccurate-throws', 100, true)
ON CONFLICT DO NOTHING;

-- Simple Throwing Progressions → throwing-mechanics  (high)
-- Three named mechanical steps — grip, glove, step — practised in sets.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('4e1975e2-eb6b-49a8-9d29-0b9d0afd2f68', 'throwing-mechanics', 100, true)
ON CONFLICT DO NOTHING;

-- Second Baseman Flip/Throw Combo → slow-transfer  (high)
-- The underhand flip is the fastest way to get rid of the ball at short range and is half the drill.
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)
VALUES ('2ac95ee1-db4f-4ab1-b2ec-569a5419b6ef', 'slow-transfer', 100, true)
ON CONFLICT DO NOTHING;

COMMIT;
