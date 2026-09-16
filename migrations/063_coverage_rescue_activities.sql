-- ============================================================================
-- 063 — Three activities, so three problems can still be answered
-- ============================================================================
--
-- WHY THESE THREE AND NOT ANY OTHERS
--
-- Phase 1 classified 46 curated rows as source collections or teaching content
-- and stopped offering them as drills. Measured against problem_taxonomy, that
-- leaves three problems with nothing a coach can actually be handed:
--
--   fear-fly-balls      1 mapped row,  a compilation of three outfield drills
--   no-changeup         3 mapped rows, all three are grip explanations
--   plate-confidence    3 mapped rows, a compilation, a parent-facing video,
--                       and a CATCHING video mis-mapped to a hitting problem
--
-- The standing rule for this library is that no problem reaches zero
-- prescribable drills — a coach asking for help and being told nothing is the
-- worst outcome available, and it is worse than a mediocre answer. So the
-- demotions are gated behind this file.
--
-- The library was searched for an existing activity to map first, per problem,
-- and there is genuinely nothing:
--
--   * Fly Balls holds seven rows. The runnable ones teach angles, drop steps,
--     communication and do-or-die throws. None of them addresses a player who
--     flinches, and mapping "Fly Ball Drill with Cones" to "fear of fly balls"
--     would be curating badly to make a number go green.
--   * Pitching holds three changeup rows and all three explain grips. There is
--     no changeup drill with a rep structure anywhere in the library.
--   * Hitting holds nothing at all about being afraid of the ball.
--
-- WHAT THESE ARE
--
-- Written for BenchCoach, not transcribed. Each one is a standard approach any
-- youth coach would recognise — progressive exposure, catch play, rehearsing
-- the turn — described in this library's own words, with its own cues and its
-- own failure modes. source = 'benchcoach_original', same as Protect the
-- Castle, and no video is claimed because none was used.
--
-- Metadata is asserted only where it is known. Nothing here carries a
-- youtube_* value, a timestamp, or a calibration figure nobody measured.
--
-- Idempotent: fixed UUIDs, ON CONFLICT DO NOTHING. Adds rows, changes none.
-- ============================================================================

INSERT INTO public.drill_resources (
  id, drill_name, skill_category, primary_skill, secondary_skill,
  description, ai_coaching_notes, safety_notes, success_markers,
  reps_guidance, regression_notes, progression_notes,
  mechanic_focus, common_flaws_fixed, tags,
  age_range, min_age, max_age, difficulty_level, progression_level,
  competition_level, equipment_needed, indoor_outdoor, space_required,
  requires_partner, est_duration_minutes,
  activity_format, practice_roles, min_players, max_players,
  ideal_group_size, min_coaches, station_friendly,
  rep_density, idle_time_risk, engagement_level, competition_style,
  instruction_complexity, throwing_load, physical_intensity,
  mixed_skill_friendly, resource_kind, status, source, created_by_coach_id
) VALUES

-- ---------------------------------------------------------------------------
-- fear-fly-balls
-- ---------------------------------------------------------------------------
(
  '3013e235-fd0a-5e1a-82a8-94bd2384f9d4',
  'Fly Ball Confidence Ladder',
  'Fielding (Fly Balls)',
  'fly-ball tracking',
  'catching under a ball',
  'The fielder stands fifteen feet from the coach with a bucket of soft-core balls between them. The coach tosses underhand so the ball peaks about ten feet up and comes down into the glove. Catch it, toss it back, go again. Every three clean catches the fielder takes one step back; a drop or a flinch moves them one step forward, not back to the start. The distance is the whole drill. A player who flinches under a fly ball is not short of technique — they are short of reps that ended well, and the ladder is how those get built without anyone being asked to be brave.',
  'Cue "thumbs together, watch it into the glove". The flinch to watch for is the head turning away in the last foot, and it happens before the hands do anything wrong — correcting the hands will not fix it. Move closer until the head stays still, then start climbing again. Never move a player back because the rest of the group moved back; the ladder is per player and that is the point of it.',
  'Soft-core or tennis balls only until the player is catching cleanly at thirty feet. Putting a real baseball on a fearful player undoes the whole progression, and one bad one costs more ground than ten good ones gain.',
  ARRAY['Eyes stay on the ball all the way into the glove',
        'Catches above the head rather than trapping it at the chest',
        'Takes a step back without being asked to'],
  '8-10 minutes; three clean catches buys one step back',
  'Sit the fielder on a bucket so they cannot back away, and toss from eight feet. Almost every player catches from there, and one clean catch is the thing worth building on.',
  'Swap the soft ball for a baseball at the SAME distance before adding any more distance — change one variable at a time. Then move the coach back to forty feet with a fungo, so the ball arrives off a bat rather than out of a hand.',
  ARRAY['tracking a ball in the air','two-hand catching','catching above the head'],
  ARRAY['fear of fly balls','turning the head away','catching at the chest','backing away from the ball'],
  ARRAY['outfield','fly balls','confidence','beginner','warmup'],
  '6-11', 6, 11, 'Beginner', 1, 'both',
  ARRAY['glove','soft-core or tennis balls'],
  'Both', 'Small', true, 8,
  'partner', ARRAY['warmup','teach','isolate','repetition'],
  1, NULL, 4, 1, true,
  'high', 'low', 'medium', 'none', 'low', 'none', 'low',
  true, 'activity', 'approved', 'benchcoach_original', NULL
),

-- ---------------------------------------------------------------------------
-- no-changeup
-- ---------------------------------------------------------------------------
(
  'fbbf59c6-6024-5692-9db9-6a0257139f65',
  'Changeup Catch Play',
  'Pitching',
  'changeup',
  'arm speed consistency',
  'Ordinary partner catch at about forty-five feet, with one change: once the arm is warm, every third throw is a changeup. Same arm speed, same target, same finish — the grip takes the speed off, not the arm. Fifteen to twenty of them, then back to normal catch. No mound, no radar, no hitter. A changeup only becomes a pitch when it stops being an event, and throwing it in the middle of something a pitcher already does every single day is how it stops being one.',
  'Cue "same arm, slower ball". The thing to watch is the arm slowing down, and it is visible from the side rather than from behind — stand at the pitcher''s throwing shoulder, not behind them. If the catch partner can tell a changeup is coming from the arm action, so can a hitter. Keep the target the same as the fastball: a changeup aimed lower is a changeup that arrives in the dirt.',
  'A changeup is a grip change, not a wrist twist. Nothing in this drill asks a young arm to turn over, which is why it is the second pitch to teach and a breaking ball is not.',
  ARRAY['Arm speed looks the same as the fastball from the side',
        'Throws it for a strike more often than not',
        'Reaches for the grip without being told to'],
  '15-20 changeups mixed into normal catch, every third throw',
  'Hold the grip and play ordinary catch at thirty feet without trying to take anything off at all. The hand has to get used to the ball sitting deeper before the pitch can be thrown with any intent.',
  'Move it onto the mound at sixty percent for a short bullpen, two fastballs to one changeup. Then throw it to a hitter who has been TOLD it is coming, and only after that to one who has not.',
  ARRAY['changeup grip','arm speed consistency','release out front'],
  ARRAY['no changeup','slowing the arm down','only throws fastballs','tipping the pitch'],
  ARRAY['pitching','changeup','offspeed','catch play','warmup'],
  '9-14', 9, 14, 'Intermediate', 2, 'both',
  ARRAY['baseballs','gloves'],
  'Both', 'Medium', true, 10,
  'partner', ARRAY['warmup','teach','repetition'],
  2, NULL, 2, 0, true,
  'medium', 'low', 'medium', 'none', 'low', 'medium', 'low',
  true, 'activity', 'approved', 'benchcoach_original', NULL
),

-- ---------------------------------------------------------------------------
-- plate-confidence
-- ---------------------------------------------------------------------------
(
  'e6299ad6-888e-5507-a5a5-57cdf5359996',
  'Turn and Take It',
  'Hitting',
  'plate confidence',
  'getting hit safely',
  'The hitter stands in with a helmet on. The coach kneels behind an L-screen about twenty feet away with a bucket of soft-core balls and says "turn" before throwing one at the hitter''s back hip. The hitter turns the front shoulder in, tucks the chin, drops the hands and takes it on the back. Ten of those. Then ten pitches over the plate, mixed in unannounced, so the hitter has to read which is which. Fear at the plate is almost always fear of being hit, and a hitter who has been hit twenty times with a soft ball and found out it is survivable stops guessing about it.',
  'Cue "turn in, never away" and "chin to the chest". The instinct being replaced is turning the FRONT of the body toward the ball, which exposes the face and the hands — a hitter doing that is more at risk, not less, and it is the one thing worth stopping the drill for. If they bail on the pitches over the plate, go back to announced reps: that means the fear is still ahead of the practice, and more unannounced reps will only confirm it.',
  'SOFT-CORE BALLS ONLY, helmet on, and nothing thrown above the shoulders. Never run this with a real baseball. Stop immediately if a player is distressed — a frightened player getting more reps is not learning, and this drill exists to remove fear rather than to prove a point about it.',
  ARRAY['Turns the front shoulder in rather than away',
        'Takes it on the back or the rear, never on the hands',
        'Stays in the box on the pitches over the plate'],
  '10 announced turns, then 10 mixed unannounced',
  'No throw at all. The coach says "turn" and the hitter rehearses it on an empty box, ten times, until the shoulder goes the right way without thinking. Then add the ball.',
  'Front toss with a soft ball, unannounced, mixed in with strikes that are there to be hit — so the hitter is deciding between swinging and turning rather than only ever turning.',
  ARRAY['getting hit safely','staying in the box','reading the pitch'],
  ARRAY['fear at the plate','bailing out','stepping in the bucket','fear of the ball'],
  ARRAY['hitting','confidence','safety','beginner','teach'],
  '7-12', 7, 12, 'Beginner', 1, 'both',
  ARRAY['soft-core balls','batting helmet','L-screen','bat'],
  'Both', 'Small', true, 8,
  'small_group', ARRAY['teach','isolate'],
  1, NULL, 3, 1, true,
  'medium', 'medium', 'medium', 'none', 'low', 'none', 'low',
  true, 'activity', 'approved', 'benchcoach_original', NULL
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The mappings these exist for.
--
-- curated = true: each one was chosen for this problem deliberately, which is
-- what separates it from the text-match fallback. sort_order 1 puts it ahead
-- of the rows it is rescuing, so a coach gets the runnable answer first even
-- before the collections are demoted.
-- ---------------------------------------------------------------------------
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES
  ('3013e235-fd0a-5e1a-82a8-94bd2384f9d4', 'fear-fly-balls',   1, true),
  ('fbbf59c6-6024-5692-9db9-6a0257139f65', 'no-changeup',      1, true),
  ('e6299ad6-888e-5507-a5a5-57cdf5359996', 'plate-confidence', 1, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Each of the three problems must now hold at least one SCHEDULABLE drill,
-- counting only rows that may be offered as something to run:
--
--   SELECT m.problem_slug,
--          count(*) FILTER (WHERE d.resource_kind IS NULL
--                              OR d.resource_kind IN ('activity','practice_unit')) AS schedulable
--   FROM drill_problem_map m JOIN drill_resources d ON d.id = m.drill_id
--   WHERE m.problem_slug IN ('fear-fly-balls','no-changeup','plate-confidence')
--   GROUP BY 1;
--
-- Expect 2, 4 and 2 — the new activity plus whatever is not yet demoted.
-- After Phase 2A.2 demotes the rest, expect 1, 1 and 1. Never 0.
