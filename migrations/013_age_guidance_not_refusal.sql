-- ============================================================================
-- Migration 013: Age notes become coaching guidance, not a refusal
-- ============================================================================
-- Migration 011 seeded these notes to support a "do not coach this at this
-- age" path that returned reassurance instead of a plan. That was wrong in
-- practice: a coach or parent who asks for a fix wants a fix. An extreme
-- uppercut at 7 is a real problem that compounds, and answering "leave it
-- alone" sends them to find a worse drill somewhere else.
--
-- The developmental knowledge is still correct and still valuable — it just
-- belongs in HOW we prescribe, not WHETHER we do. At 7 you fix an uppercut
-- with tee height and contact point, not by cueing "swing level" (which
-- creates choppers). Same problem, age-appropriate method.
--
-- The columns keep their original names so this migration is safe to run at
-- any time and the app works with or without it. Read them as:
--   do_not_coach_flag -> "this problem is age-sensitive"
--   do_not_coach_note -> "how to work on it at a younger age"
--
-- Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

UPDATE problem_taxonomy SET
  do_not_coach_note = 'At 6-8 one-handed catching is usually hand strength, not habit, and two-hand cues at this stage often teach stabbing at the ball. Build it through volume rather than form correction: lots of easy catches they succeed at, glove-side-only reps, and short-hop games that make securing the ball the fun part. It tightens up as their hands get stronger — but keep the reps coming, it does not fix itself from neglect.'
WHERE slug = 'one-hand-catching';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'Whiffs at 6-7 are the developmental stage, so the lever is swing volume, not mechanical instruction. Tee work and close front toss where they get 40-50 swings and make contact often builds the pattern faster than any cue. Avoid stance and hand-path corrections at this age — they fragment a swing the player is still assembling. If contact is not improving after several weeks of volume, look at pitch height and tee position before touching mechanics.'
WHERE slug = 'inconsistent-contact';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'Before about 9-10, running a separate two-strike mode splits attention and usually makes both swings worse. Work the underlying skill instead: swinging at strikes and taking balls, as one decision rather than two approaches. Strike-zone games where they call pitches from the on-deck circle build the recognition that a two-strike approach later depends on.'
WHERE slug = 'two-strike-approach';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'A slightly uphill swing path is correct and should not be flattened — "swing level" cues at this age reliably produce choppers. What IS worth fixing is the extreme version: back shoulder collapsing, head pulling off, everything popped up. Attack that through tee height and contact point rather than verbal cues about swing plane — set the tee at the top of the zone and let the ball position teach the path. High tee work plus contact-point drills change this faster than any instruction about the swing itself.'
WHERE slug = 'uppercutting';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'A lower arm slot at 6-8 usually reflects arm strength rather than mechanics, and forcing "over the top" at this age can create arm pain. Raise it indirectly: catch-play volume for strength, and drills from one knee that make a higher slot the path of least resistance. Do not cue arm position directly — build the strength and the slot follows. Revisit explicit mechanics at 9+.'
WHERE slug = 'low-arm-slot';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'If the league does not permit leads or steals yet, the transferable work is what actually makes stealing easy later: first-step quickness, reading the ball off the bat, and aggressive turns at the bag. Train those now rather than pickoff reads and lead footwork, which have nowhere to be used and will need re-teaching when the rules change anyway.'
WHERE slug = 'base-stealing';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'Adding a second pitch before about 10U splits limited practice reps and usually costs fastball command, which is the thing that actually gets outs at this age. Put the work into repeating the delivery and throwing strikes. If the player wants an off-speed feel, a grip change thrown with identical fastball arm speed is far safer than teaching a distinct pitch — no wrist manipulation, no slowing the arm.'
WHERE slug = 'no-changeup';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'Almost nobody throws real off-speed at this age, so what looks like a pitch-recognition problem is usually timing or tracking. Work general timing with varied front-toss speeds from the same arm slot, and vision work like calling pitch location from the on-deck circle. Save actual pitch identification for when they are seeing pitches that need identifying.'
WHERE slug = 'cant-hit-offspeed';

UPDATE problem_taxonomy SET
  do_not_coach_note = 'Before 8-9U sliding is rarely needed and often not permitted, so it is not usually the highest-value thing to spend a practice on. When you do teach it, one session on wet grass in long pants covers the mechanics safely — feet-first, hands up, no last-second decisions. Until then, base-running speed and tight turns are the better use of the same time.'
WHERE slug = 'cant-slide';

-- Review:
--   SELECT slug, age_relevance, left(do_not_coach_note, 70) FROM problem_taxonomy
--   WHERE do_not_coach_flag ORDER BY slug;
