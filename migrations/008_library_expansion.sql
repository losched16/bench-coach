-- ============================================================================
-- Migration 008: Drill-library expansion (first Cowork batch)
-- ============================================================================
-- Adds 13 new problems, 43 new drills (all video ids verified live), and 47
-- drill_problem_map rows. ADDITIVE ONLY: no updates, no deletes, no DDL.
-- Existing rows are never touched. Safe to re-run:
--   * problems:  ON CONFLICT (slug) DO NOTHING
--   * drills:    guarded by WHERE NOT EXISTS on youtube_video_id (the dedupe key)
--   * mappings:  ON CONFLICT (drill_id, problem_slug) DO NOTHING
-- Mapping rows resolve drill_id by youtube_video_id at insert time; four rows
-- intentionally reference EXISTING library drills (framing, blocking, fly-ball
-- communication, how-to-bunt) to anchor the new curated sequences.
-- Introduces one new skill_category value: 'Team Defense' (cutoffs/relays, rundowns).
-- Paste into the Supabase SQL editor and run. Verification queries at the bottom.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. problem_taxonomy (13 rows)
-- ---------------------------------------------------------------------------

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('catcher-receiving', 'Stabs / pulls pitches out of the zone (receiving & framing)', 'Catching', 'Catcher stabs at pitches or carries them out of the zone instead of quietly receiving and framing strikes.', ARRAY['poor receiving', 'stabbing at pitches', 'stabbing pitches', 'carrying pitches out of the zone', 'pulling pitches out of the zone', 'loses strikes for the pitcher', 'bad framing', 'poor framing', 'framing', 'receiving', 'hard hands behind the plate', 'noisy glove', 'can''t stick pitches']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('catcher-blocking', 'Won''t block balls in the dirt', 'Catching', 'Turns the glove or bails to the side instead of dropping to block pitches in the dirt.', ARRAY['can''t block', 'won''t block', 'poor blocking', 'balls in the dirt get past', 'picks instead of blocks', 'turns head on balls in the dirt', 'bails on balls in the dirt', 'too many passed balls', 'wild pitches get by', 'blocking']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('cant-slide', 'Can''t slide / slides late or wrong', 'Baserunning', 'Doesn''t know how to slide; slides late, headfirst into bases, or with injury-prone form.', ARRAY['can''t slide', 'doesn''t slide', 'afraid to slide', 'slides late', 'slides headfirst', 'bad sliding form', 'doesn''t know how to slide', 'jams fingers sliding', 'no pop-up slide', 'sliding']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('base-stealing', 'Poor jumps / can''t steal bases', 'Baserunning', 'Gets bad jumps, doesn''t read the pitcher, and can''t take extra bases on steals.', ARRAY['can''t steal bases', 'bad jumps', 'slow jump on steals', 'gets picked off', 'no secondary lead', 'doesn''t read the pitcher', 'late steal break', 'poor crossover step on steals', 'delayed steal', 'frozen on steal attempts', 'base stealing', 'stealing bases']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('cutoffs-relays', 'Misses the cutoff man / poor relays', 'Team Defense', 'Outfield throws sail past the cutoff man; relays are slow, off-line, or go to the wrong base.', ARRAY['misses the cutoff man', 'missing cutoffs', 'airmails the cutoff', 'doesn''t hit the cutoff', 'poor relays', 'slow relay throws', 'doesn''t line up on relays', 'throws to the wrong base', 'no cutoff man', 'cutoffs', 'relays', 'cuts and relays']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('rundowns', 'Panics in rundowns', 'Team Defense', 'Rundowns turn chaotic — too many throws, the runner escapes, nobody covers a base.', ARRAY['panics in rundowns', 'bad rundowns', 'pickle chaos', 'too many throws in rundowns', 'runner escapes rundowns', 'doesn''t follow the throw', 'rundown', 'pickle', 'rundown defense']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('first-base-footwork', 'Fumbles footwork around first base', 'Fielding (Infield)', 'First baseman can''t find the bag, stretches too early, or can''t handle off-line throws and short hops.', ARRAY['first base footwork', 'can''t find the bag', 'stretches too early', 'pulls foot off the bag', 'can''t pick throws at first', 'poor scoops at first', 'first baseman fundamentals', 'misses off-line throws at first', 'playing first base']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('outfield-communication', 'No call / collides on fly balls', 'Fielding (Fly Balls)', 'Fielders don''t call the ball — collisions, dropped balls, or everyone deferring to each other.', ARRAY['doesn''t call the ball', 'no communication in the outfield', 'outfielders collide', 'collisions on fly balls', 'two players let it drop', 'nobody calls it', 'poor priority on fly balls', 'doesn''t call off the infielder', 'outfield communication', 'priority calls']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('no-changeup', 'Doesn''t have a changeup / one speed only', 'Pitching', 'Throws only fastballs; no safe off-speed pitch to change hitters'' timing.', ARRAY['no changeup', 'doesn''t have a changeup', 'needs an offspeed pitch', 'one speed pitcher', 'only throws fastballs', 'changeup grip', 'change up', 'no second pitch', 'wants to throw a curveball too young', 'pitch grips']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('cant-hit-offspeed', 'Fooled by off-speed / poor pitch recognition', 'Hitting', 'Out on the front foot against changeups and slower pitches; can''t recognize speed changes out of the hand.', ARRAY['can''t hit offspeed', 'can''t hit the changeup', 'fooled by slow pitches', 'out in front of offspeed', 'poor pitch recognition', 'can''t recognize spin', 'struggles against slow pitchers', 'way out in front', 'off balance against slow stuff', 'pitch recognition']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('no-situational-hitting', 'No situational hitting / can''t move runners', 'Hitting', 'Same approach every at-bat; can''t move runners over, hit behind them, or drive in a run with an out.', ARRAY['can''t move runners', 'no situational hitting', 'doesn''t hit behind the runner', 'can''t go opposite field', 'pull happy', 'no sac fly', 'doesn''t advance runners', 'no approach with runners on', 'no productive outs', 'situational hitting']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('cant-bunt', 'Can''t get a bunt down', 'Bunting', 'Pops bunts up, misses entirely, or can''t place them — no reliable sacrifice bunt.', ARRAY['can''t bunt', 'can''t get a bunt down', 'pops up bunts', 'bad bunt technique', 'afraid to bunt', 'can''t place bunts', 'sacrifice bunt', 'bunting for a hit', 'stabs at the bunt', 'bunting']::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES ('arm-fatigue', 'Arm fatigue / no arm-care routine', 'Arm Care', 'Arm gets tired or sore across the season; no band work or recovery routine to build durability.', ARRAY['arm gets tired', 'arm fatigue', 'sore arm after pitching', 'no arm care routine', 'needs j-bands', 'j-band routine', 'weak rotator cuff', 'no recovery routine', 'dead arm', 'arm conditioning', 'arm durability']::text[])
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. drill_resources (43 rows) — each guarded by its youtube_video_id
-- ---------------------------------------------------------------------------

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Youth Receiving Foundations — Quiet Glove & Soft Hands',
  'First receiving progression for young catchers: glove presentation, soft hands, and catching the ball with slight momentum toward the strike zone. Fixes stabbing and hard hands behind the plate.',
  'https://www.youtube.com/watch?v=JDRg2nvAwqU',
  'JDRg2nvAwqU',
  'https://img.youtube.com/vi/JDRg2nvAwqU/hqdefault.jpg',
  'Catching Made Simple (Coach Bougie)',
  'Catching',
  'Receiving',
  'Framing',
  ARRAY['catcher', 'receiving', 'framing', 'soft hands']::text[],
  '8-12',
  8,
  12,
  'Beginner',
  2,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['catcher''s mitt', 'tennis balls or soft baseballs', 'catcher''s gear']::text[],
  ARRAY['glove presentation', 'soft hands', 'glove path']::text[],
  ARRAY['stabbing at pitches', 'hard hands behind the plate', 'poor receiving']::text[],
  'Use tennis balls or soft training balls for bare-hand/receiving-only work; full gear whenever catching live throws.',
  'Start bare-glove with tennis balls from short distance. Cue ''catch the ball moving toward the zone, not away.'' Watch for the elbow locking out — a slightly bent elbow keeps hands soft.',
  '3 rounds of 10 catches (glove-side, middle, arm-side)',
  '2-3x/week',
  ARRAY['Glove is quiet after the catch instead of drifting', 'Catches low pitches without turning the glove over', 'Ball stops moving toward the zone edge, not out of it']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'JDRg2nvAwqU');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'MLB-Style Receiving & Framing Circuit',
  'Five MLB-style receiving drills scalable to any age: beating the ball to the spot, sticking pitches, and working the edges of the zone. The middle step once basic soft hands are in place.',
  'https://www.youtube.com/watch?v=Z1erh6UVR_w',
  'Z1erh6UVR_w',
  'https://img.youtube.com/vi/Z1erh6UVR_w/hqdefault.jpg',
  'YouGoProBaseball',
  'Catching',
  'Receiving',
  'Framing',
  ARRAY['catcher', 'receiving', 'framing', 'strike zone']::text[],
  '9-14',
  9,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['catcher''s mitt', 'baseballs', 'catcher''s gear']::text[],
  ARRAY['beat the ball to the spot', 'sticking pitches', 'working zone edges']::text[],
  ARRAY['carrying pitches out of the zone', 'loses strikes for the pitcher', 'poor framing']::text[],
  NULL,
  'Run as a 5-station circuit. Cue ''beat it to the spot'' — glove arrives where the pitch will be before the ball does. Freeze each catch for a one-count to build the stick habit.',
  '5 drills x 8-10 receives each',
  '2x/week',
  ARRAY['Borderline pitches are caught and held in the zone', 'Glove beats the ball to the spot on edges', 'Umpire-view video shows the ball ''stuck'' rather than dragged']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'Z1erh6UVR_w');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'One-Knee Receiving — Advanced Framing Setup',
  'Modern one-knee-down receiving: five drills to master framing from the stance MLB catchers use, at higher pitch speeds. For experienced catchers ready for the progression ceiling.',
  'https://www.youtube.com/watch?v=yJxiRn88Ms0',
  'yJxiRn88Ms0',
  'https://img.youtube.com/vi/yJxiRn88Ms0/hqdefault.jpg',
  'YouGoProBaseball',
  'Catching',
  'Receiving',
  'Framing',
  ARRAY['catcher', 'one knee', 'receiving', 'framing', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['catcher''s mitt', 'baseballs', 'catcher''s gear', 'pitching machine (optional)']::text[],
  ARRAY['one-knee setup', 'glove path', 'receiving low pitches']::text[],
  ARRAY['carrying pitches out of the zone', 'poor receiving', 'loses strikes for the pitcher']::text[],
  NULL,
  'Only introduce after two-knee receiving is consistent. Check the free leg still allows a block or throw. Increase pitch speed gradually — machine work is ideal for high-rep edges.',
  '4 sets of 10 receives per setup (RH low, LH low, edges)',
  '2x/week in-season',
  ARRAY['Low strike is presented without dropping the glove head', 'Can still block and throw from one knee', 'Holds the bottom-zone strike at game velocity']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'yJxiRn88Ms0');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Blocking the Right Way — Technique to Reaction Reps',
  'Correct blocking technique — knees replace the feet, chin tucks, chest angles the ball back toward the plate — built from stationary blocks into reaction reps to either side.',
  'https://www.youtube.com/watch?v=eQCF2jZiU5M',
  'eQCF2jZiU5M',
  'https://img.youtube.com/vi/eQCF2jZiU5M/hqdefault.jpg',
  'YouGoProBaseball',
  'Catching',
  'Blocking',
  'Receiving',
  ARRAY['catcher', 'blocking', 'balls in the dirt']::text[],
  '9-14',
  9,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['catcher''s gear', 'soft training balls', 'baseballs']::text[],
  ARRAY['knee drop', 'chin tuck', 'chest angle', 'lateral blocks']::text[],
  ARRAY['balls in the dirt get past', 'picks instead of blocks', 'poor blocking']::text[],
  'Full catcher''s gear required for every blocking rep. Use soft training balls when learning; progress to baseballs only once form is consistent.',
  'Start with placed balls (no throw) to groove the shape, then rolled balls, then short-hop throws. Cue ''round your shoulders, chin down, deaden it in front.'' Left/right blocks push off the opposite foot.',
  '3 sets of 8 blocks (middle, glove-side, arm-side)',
  '2x/week',
  ARRAY['Ball dies within a 6-foot circle in front of the plate', 'Chin stays tucked — no flinch', 'Body beats the ball to the spot on lateral blocks']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'eQCF2jZiU5M');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Game-Speed Reaction Blocking',
  'A game-speed blocking drill with unpredictable balls in the dirt — the catcher must read and react rather than pre-set. For catchers who already own solid blocking mechanics.',
  'https://www.youtube.com/watch?v=n8OCrOmbTBU',
  'n8OCrOmbTBU',
  'https://img.youtube.com/vi/n8OCrOmbTBU/hqdefault.jpg',
  'Catching IQ',
  'Catching',
  'Blocking',
  'Receiving',
  ARRAY['catcher', 'blocking', 'reaction', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['catcher''s gear', 'baseballs', 'pitching machine (optional)']::text[],
  ARRAY['read and react', 'lateral quickness', 'recovery to throw']::text[],
  ARRAY['balls in the dirt get past', 'bails on balls in the dirt', 'too many passed balls']::text[],
  'Full catcher''s gear required. Game-speed dirt balls only for catchers with established blocking form.',
  'Mix locations randomly and don''t telegraph. Score each rep: blocked-in-front = 2, blocked-away = 1, past = 0; track weekly. Add a runner-on-third scenario so recovery-to-throw matters.',
  '3 rounds of 10 random blocks, scored',
  '1-2x/week in-season',
  ARRAY['8+ of 10 random balls kept in front', 'Recovers to throwing position within one second', 'No flinch or head-turn at game velocity']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'n8OCrOmbTBU');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Catcher Throw-Down Footwork to Second',
  'Catcher footwork patterns for throwing to second at game speed — replace, jab-step, and transfer mechanics that shorten pop time and control the running game.',
  'https://www.youtube.com/watch?v=RmlsQPV4OGs',
  'RmlsQPV4OGs',
  'https://img.youtube.com/vi/RmlsQPV4OGs/hqdefault.jpg',
  'Pro Speed Baseball',
  'Catching',
  'Throwing footwork',
  'Transfer',
  ARRAY['catcher', 'pop time', 'footwork', 'throw down', 'advanced']::text[],
  '12-14',
  12,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['catcher''s gear', 'baseballs', 'stopwatch']::text[],
  ARRAY['replace footwork', 'quick transfer', 'direction to second']::text[],
  ARRAY['slow transfer', 'slow release', 'extra steps before throw']::text[],
  'Arm-care warm-up before throw-downs; cap volume at ~20 full-intensity throws per session for youth arms.',
  'Time every rep glove-to-glove. Cue ''feet start the throw'' — the exchange happens while the feet replace. Start dry (no ball), then from a partner''s toss, then live machine pitches.',
  '3 sets of 6 throw-downs, timed',
  '2x/week',
  ARRAY['Pop time trends down week over week', 'Transfer happens during footwork, not after', 'Throws arrive on the bag-side of second consistently']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'RmlsQPV4OGs');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Bent-Leg Slide Basics — The Right Way to Slide',
  'Intro to correct bent-leg sliding: when to start the slide, tucking one leg into the figure-4, keeping hands up, and avoiding the habits that cause injuries.',
  'https://www.youtube.com/watch?v=h_mEnVPL6Qg',
  'h_mEnVPL6Qg',
  'https://img.youtube.com/vi/h_mEnVPL6Qg/hqdefault.jpg',
  'BSBL BLVD',
  'Baserunning',
  'Sliding',
  'Base awareness',
  ARRAY['sliding', 'bent-leg slide', 'figure four', 'safety']::text[],
  '7-12',
  7,
  12,
  'Beginner',
  1,
  'Outdoor',
  'Small',
  FALSE,
  ARRAY['grass area or sliding mat', 'loose base']::text[],
  ARRAY['figure-4 leg tuck', 'slide start distance', 'hands up']::text[],
  ARRAY['can''t slide', 'slides headfirst', 'bad sliding form', 'afraid to slide']::text[],
  'No headfirst slides for beginners. Slide on grass, wet grass, or a mat before ever sliding on dirt; remove cleats for first sessions.',
  'Teach on grass in socks or on a sliding mat first — never on dirt day one. Cue ''sit into it, hands to the sky.'' Start from a walk, then jog, then run. Mark a start line about two body lengths from the base.',
  '10-15 slides per session, building speed gradually',
  '1-2x/week until confident',
  ARRAY['Slides on the seat/hip, not the knees', 'Hands stay up through the slide', 'Starts the slide at the marked distance without hesitation']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'h_mEnVPL6Qg');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Sliding Practice Stations',
  'Station-based sliding reps for teams: high-repetition bent-leg slides in a controlled setting to build comfort and consistency once players know the basic form.',
  'https://www.youtube.com/watch?v=e_q6AWdgabQ',
  'e_q6AWdgabQ',
  'https://img.youtube.com/vi/e_q6AWdgabQ/hqdefault.jpg',
  'ZONED Sports Academy',
  'Baserunning',
  'Sliding',
  'Base awareness',
  ARRAY['sliding', 'stations', 'team practice']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Medium',
  FALSE,
  ARRAY['sliding mat or grass area', 'loose bases']::text[],
  ARRAY['repetition under control', 'slide timing', 'consistent form']::text[],
  ARRAY['slides late', 'bad sliding form', 'doesn''t know how to slide']::text[],
  'Use mats or grass for volume work; check the sliding lane is clear of equipment between reps.',
  'Run as a rotating station during practice. Every player gets volume without dirt burn. Watch for the trail leg flattening out — keep the figure-4. Add a coach pointing left/right so runners slide to a side of the bag.',
  '2 rounds of 6-8 slides per station',
  'Weekly during season',
  ARRAY['Same slide shape every rep', 'Can slide to either side of the bag on command', 'No slowing down before the slide starts']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'e_q6AWdgabQ');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Pop-Up Slide — Slide and Advance',
  'Game-speed pop-up slide: sliding into the bag on the bent leg and using momentum to pop up ready to advance on an overthrow.',
  'https://www.youtube.com/watch?v=wMZkEfiFBxc',
  'wMZkEfiFBxc',
  'https://img.youtube.com/vi/wMZkEfiFBxc/hqdefault.jpg',
  'CoachUp',
  'Baserunning',
  'Sliding',
  'Base awareness',
  ARRAY['sliding', 'pop-up slide', 'advance', 'advanced']::text[],
  '11-14',
  11,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Medium',
  FALSE,
  ARRAY['base', 'grass or dirt sliding area']::text[],
  ARRAY['momentum transfer', 'pop-up mechanics', 'read to advance']::text[],
  ARRAY['can''t slide', 'no pop-up slide', 'slides late']::text[],
  'Full-speed pop-up slides on dirt only after mat/grass mastery; no headfirst variations.',
  'Only after the basic bent-leg slide is automatic. Cue ''slide through the bag, not to it'' — momentum carries the runner up onto the planted foot. Pair with a coach throwing simulated overthrows to train the advance read.',
  '8-10 pop-up slides, last 4 with an overthrow read',
  '1x/week',
  ARRAY['Pops to standing without using hands', 'Eyes find the ball immediately after the slide', 'Advances confidently on overthrows in scrimmages']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'wMZkEfiFBxc');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Steal Breaks — Reading the Pitcher & First Move',
  'Teaches the steal break: what runners watch on the pitcher, when to take off, and the explosive crossover first move. Coach-facing so it translates straight to team practice.',
  'https://www.youtube.com/watch?v=JVwDSgbUfBM',
  'JVwDSgbUfBM',
  'https://img.youtube.com/vi/JVwDSgbUfBM/hqdefault.jpg',
  'Dominate The Diamond',
  'Baserunning',
  'Base stealing',
  'First-step quickness',
  ARRAY['stealing', 'steal break', 'crossover', 'reads']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Outdoor',
  'Medium',
  FALSE,
  ARRAY['bases', 'cones']::text[],
  ARRAY['crossover step', 'pitcher reads', 'reaction to first move']::text[],
  ARRAY['late steal break', 'bad jumps', 'doesn''t read the pitcher', 'poor crossover step on steals']::text[],
  NULL,
  'Line the whole team up off an imaginary first base facing a coach simulating a pitcher. On first move: break. Cue ''sink, cross over, run through second''s back corner.'' Call out what tipped the pitcher''s move each rep.',
  '3 rounds of 6 breaks (react to leg lift, first move, pickoff mix)',
  '2x/week',
  ARRAY['Breaks on first move, not on a guess', 'Crossover step gains ground toward second', 'Freezes correctly on pickoff moves']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'JVwDSgbUfBM');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Secondary Lead & Delayed Steal',
  'The secondary lead and the delayed steal: timing shuffles with the pitch, reading the catcher, and stealing bases without elite speed.',
  'https://www.youtube.com/watch?v=SXfbP6x3iXI',
  'SXfbP6x3iXI',
  'https://img.youtube.com/vi/SXfbP6x3iXI/hqdefault.jpg',
  'YouGoProBaseball',
  'Baserunning',
  'Base stealing',
  'Base awareness',
  ARRAY['stealing', 'secondary lead', 'delayed steal']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Outdoor',
  'Medium',
  FALSE,
  ARRAY['bases']::text[],
  ARRAY['secondary lead timing', 'catcher reads', 'delayed steal timing']::text[],
  ARRAY['no secondary lead', 'frozen on steal attempts', 'can''t steal bases']::text[],
  NULL,
  'Rep the two-shuffle secondary timed to the pitch crossing the zone. For the delayed steal, break as the catcher''s throw goes back to the pitcher. Works especially well at levels where catchers lob returns.',
  '10 secondary leads + 6 delayed-steal reps',
  '1-2x/week',
  ARRAY['Secondary lead lands as the pitch crosses the plate', 'Momentum moving toward the next base at contact', 'Successfully times a delayed steal in scrimmage']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'SXfbP6x3iXI');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Pro Base-Stealing Package — Leads, Reads & Jumps',
  'Game-speed stealing package: primary lead distance, reading pitcher tells and pickoff moves, and maximizing the jump against live pitching.',
  'https://www.youtube.com/watch?v=iZK-Rtp1bv4',
  'iZK-Rtp1bv4',
  'https://img.youtube.com/vi/iZK-Rtp1bv4/hqdefault.jpg',
  'Dominate The Diamond',
  'Baserunning',
  'Base stealing',
  'First-step quickness',
  ARRAY['stealing', 'leads', 'jumps', 'pickoffs', 'advanced']::text[],
  '11-15',
  11,
  15,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['bases', 'live pitcher or coach on mound', 'stopwatch']::text[],
  ARRAY['primary lead', 'pitcher tells', 'jump quality']::text[],
  ARRAY['gets picked off', 'bad jumps', 'can''t steal bases', 'slow jump on steals']::text[],
  NULL,
  'Run against a live pitcher working from the stretch. Chart every rep: safe jump / late / picked. Teach one tell at a time (heel lift, shoulder lean, head pattern). Time first-move-to-second and track improvement.',
  '8-10 live steal reps, charted',
  '1x/week in-season',
  ARRAY['Identifies the pitcher''s tell and states it out loud', 'Jump rate improves on the weekly chart', 'Returns standing on pickoffs — never dives late from an overextended lead']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'iZK-Rtp1bv4');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Little League Cuts & Relays System',
  'A simplified cut-and-relay system built for Little League fields: where each fielder goes on balls to each outfield spot, kept simple enough for young teams to run in games.',
  'https://www.youtube.com/watch?v=Yle6R1-flA8',
  'Yle6R1-flA8',
  'https://img.youtube.com/vi/Yle6R1-flA8/hqdefault.jpg',
  'Dominate The Diamond',
  'Team Defense',
  'Cutoffs & relays',
  'Throwing accuracy',
  ARRAY['cutoffs', 'relays', 'team defense', 'positioning']::text[],
  '8-12',
  8,
  12,
  'Beginner',
  2,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['baseballs', 'bases', 'cones']::text[],
  ARRAY['cutoff positioning', 'who covers what', 'communication']::text[],
  ARRAY['no cutoff man', 'doesn''t line up on relays', 'throws to the wrong base']::text[],
  'Sequence throws so only one ball is live at a time; young fielders should never turn their back on an incoming throw.',
  'Walk the whole team through each scenario at half speed with no ball first — every player physically moves to their spot. Then add a rolled ball, then a thrown ball. Quiz players: ''ball in the right-center gap, runner on first — where do you go?''',
  'Walk-through of 4 scenarios, then 2 live reps each',
  'Weekly early season, biweekly after',
  ARRAY['Every player moves somewhere on contact — nobody stands still', 'Cutoff man is in line between outfielder and target base', 'Team can name their assignment for each gap without prompting']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'Yle6R1-flA8');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Line Relay Race — Catch, Turn, Throw',
  'A repeatable line-relay drill: lining up to the ball, presenting a big target with hands up, and making quick catch-turn-throw transfers down the line. Run it as a race between two lines.',
  'https://www.youtube.com/watch?v=YipF1W7BDJM',
  'YipF1W7BDJM',
  'https://img.youtube.com/vi/YipF1W7BDJM/hqdefault.jpg',
  'PowerNet',
  'Team Defense',
  'Cutoffs & relays',
  'Transfer',
  ARRAY['relays', 'relay race', 'transfer', 'target']::text[],
  '8-13',
  8,
  13,
  'Beginner',
  2,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['baseballs', 'cones']::text[],
  ARRAY['hands-up target', 'glove-side turn', 'quick exchange']::text[],
  ARRAY['slow relay throws', 'poor relays', 'misses the cutoff man']::text[],
  'Match throwing distances to arm strength — shorten the links for 8-10U rather than letting kids max-effort long throws.',
  'Two lines of 4-5 players, 60-90 feet apart per link. Cue ''big hands, catch, turn glove-side, throw through the chest.'' First line to run the ball down and back wins. Shrink spacing for younger kids.',
  '4-6 races per session',
  'Weekly',
  ARRAY['Relay man''s hands are up calling for the ball before it arrives', 'Turns glove-side automatically', 'Ball travels line-to-line without hitting the ground']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'YipF1W7BDJM');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Cutoff Responsibilities by Situation',
  'Team cutoff and relay responsibilities by situation — who the cutoff man is on balls to each outfield spot, and how infielders and outfielders communicate to hit the cutoff.',
  'https://www.youtube.com/watch?v=wIU9NdCBBkE',
  'wIU9NdCBBkE',
  'https://img.youtube.com/vi/wIU9NdCBBkE/hqdefault.jpg',
  'ELITE YOUTH BASEBALL',
  'Team Defense',
  'Cutoffs & relays',
  'Base awareness',
  ARRAY['cutoffs', 'relays', 'situations', 'communication']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['baseballs', 'bases']::text[],
  ARRAY['situational assignments', 'cutoff communication', 'throw decisions']::text[],
  ARRAY['misses the cutoff man', 'throws to the wrong base', 'airmails the cutoff']::text[],
  'One live ball at a time; runners wear helmets during live cutoff reps.',
  'Add runners so decisions are real: runner on first, ball to left-center — where''s the throw? Let the cutoff man call ''cut two / cut three / let it go'' loudly. Rotate players through cutoff roles so everyone learns both ends.',
  '6-8 situational reps with runners',
  'Weekly',
  ARRAY['Outfield throws come down through the cutoff man''s head height', 'Cutoff man makes a loud call on every ball', 'Correct base chosen on 4 of 5 situational reps']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'wIU9NdCBBkE');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Machine-Fed Relay Sequences at Game Speed',
  'Game-speed cutoff and relay team sequences modeled on Vanderbilt''s practice, using machine-fed balls to rep full outfield-to-infield relays at high tempo.',
  'https://www.youtube.com/watch?v=TJXQiYdueQc',
  'TJXQiYdueQc',
  'https://img.youtube.com/vi/TJXQiYdueQc/hqdefault.jpg',
  'ATEC Sports',
  'Team Defense',
  'Cutoffs & relays',
  'Throwing accuracy',
  ARRAY['cutoffs', 'relays', 'game speed', 'machine', 'advanced']::text[],
  '13-16',
  13,
  16,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['pitching machine or fungo', 'baseballs', 'bases']::text[],
  ARRAY['full-speed relays', 'double cuts', 'tempo']::text[],
  ARRAY['slow relay throws', 'misses the cutoff man', 'poor relays']::text[],
  'Full-intensity relay throws count toward daily throwing volume — run this early in practice on fresh arms.',
  'Machine or fungo fires balls into the gaps on a fixed interval so tempo never drops. Run double-cut sequences on balls to the wall. Score runs-prevented vs. bases-gained to make it competitive between defensive groups.',
  '3 rounds of 5 relay sequences at full speed',
  '1x/week for advanced teams',
  ARRAY['Relay throws are caught chest-high moving toward the target', 'Double cut executes with the trail man communicating', 'Sequence time from outfield touch to tag drops week over week']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'TJXQiYdueQc');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Two-Base Pickle Drill',
  'A simple pickle setup — two bases, two fielders, one runner — teaching kids to run hard at the runner, hold the ball up, and make one crisp throw for the tag.',
  'https://www.youtube.com/watch?v=OEYEvKRh2eQ',
  'OEYEvKRh2eQ',
  'https://img.youtube.com/vi/OEYEvKRh2eQ/hqdefault.jpg',
  'GoDog Sports',
  'Team Defense',
  'Rundowns',
  'Throwing accuracy',
  ARRAY['rundown', 'pickle', 'tags']::text[],
  '8-12',
  8,
  12,
  'Beginner',
  2,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['2 bases', 'baseballs']::text[],
  ARRAY['ball up and visible', 'run at the runner', 'one-throw finish']::text[],
  ARRAY['panics in rundowns', 'too many throws in rundowns', 'runner escapes rundowns']::text[],
  'Runners wear helmets; tags applied with the glove, no arm swings at head height.',
  'Cue ''run him back, ball up by your ear, one throw.'' The receiving fielder calls ''now!'' for the throw. Rotate every player through both fielder spots and runner. Count throws out loud — celebrate one-throw outs.',
  'Each player: 4-6 reps per role',
  'Weekly',
  ARRAY['Fielder sprints at the runner instead of hesitating', 'Ball stays visible above the shoulder — no pump fakes', 'Most outs recorded in two throws or fewer']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'OEYEvKRh2eQ');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Calm Rundowns — Push Back, Follow Your Throw',
  'Takes the panic out of youth rundowns: pushing the runner back toward the previous base, following your throw, and getting the out in as few throws as possible.',
  'https://www.youtube.com/watch?v=cV8Ivq0XcJA',
  'cV8Ivq0XcJA',
  'https://img.youtube.com/vi/cV8Ivq0XcJA/hqdefault.jpg',
  'Dominate The Diamond',
  'Team Defense',
  'Rundowns',
  'Base awareness',
  ARRAY['rundown', 'pickle', 'rotation']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['bases', 'baseballs']::text[],
  ARRAY['push runner back', 'follow the throw', 'rotation']::text[],
  ARRAY['doesn''t follow the throw', 'panics in rundowns', 'too many throws in rundowns']::text[],
  'Helmets on runners; keep rundown lanes clear of bats and loose balls.',
  'Layer in the rule: always push the runner back toward the base he came from, and always follow your throw to the end of the opposite line. Add a second runner variant once the basic rotation is automatic.',
  '6-8 rundown reps with full rotation',
  'Biweekly',
  ARRAY['Runner is always moving back toward the trailing base', 'Thrower follows his throw every time without reminding', 'Backup fielder is in line before the throw is made']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'cV8Ivq0XcJA');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Game-Speed Rundown Execution',
  'Pro-level rundown execution at game speed — sprinting to close distance, ball visible above the shoulder, dart-throw timing, and rotating behind the play.',
  'https://www.youtube.com/watch?v=OAbBekHAk_g',
  'OAbBekHAk_g',
  'https://img.youtube.com/vi/OAbBekHAk_g/hqdefault.jpg',
  'Antonelli Baseball',
  'Team Defense',
  'Rundowns',
  'Transfer',
  ARRAY['rundown', 'pickle', 'game speed', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['bases', 'baseballs', 'fast runners']::text[],
  ARRAY['closing speed', 'dart throw timing', 'rotation depth']::text[],
  ARRAY['runner escapes rundowns', 'panics in rundowns', 'doesn''t follow the throw']::text[],
  'Game-speed dart throws at short range demand focus — receivers give a clear target away from the runner''s head, and runners wear helmets.',
  'Use your fastest players as runners and score it: out in ≤2 throws = defense wins. Cue ''sprint, show, dart'' — full-speed close, ball shown early, short dart throw on the receiver''s call. Rotate at full speed.',
  '8-10 competitive reps, scored',
  '1x/week in-season',
  ARRAY['Defense wins 80% of reps vs. fast runners', 'Dart throws released on the receiver''s call — never early', 'Rotation continues seamlessly through multiple throws when needed']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'OAbBekHAk_g');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'First Base Fundamentals — Finding the Bag & the Stretch',
  'Core first-base play: getting to the bag, setting the feet, and basic stretch mechanics to receive throws. The starting point before picks and off-line throws.',
  'https://www.youtube.com/watch?v=95B1kSchurQ',
  '95B1kSchurQ',
  'https://img.youtube.com/vi/95B1kSchurQ/hqdefault.jpg',
  'Ultimate Baseball Training',
  'Fielding (Infield)',
  'First-base footwork',
  'Receiving throws',
  ARRAY['first base', 'footwork', 'stretch']::text[],
  '8-12',
  8,
  12,
  'Beginner',
  2,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['base', 'baseballs', 'first baseman''s mitt (optional)']::text[],
  ARRAY['find the bag', 'heel on the bag', 'stretch timing']::text[],
  ARRAY['can''t find the bag', 'stretches too early', 'first baseman fundamentals']::text[],
  NULL,
  'Cue ''find it with your feet, face the thrower, stretch on release — not before.'' Rep the footwork with no ball first: sprint to the bag from fielding depth, find it, set. Then add easy chest-high throws.',
  '3 rounds of 8 reps (footwork only, then with throws)',
  '2x/week for first basemen',
  ARRAY['Finds the bag without looking down', 'Stretch happens as the throw is released, not as the fielder arrives', 'Heel contact maintained through the catch']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '95B1kSchurQ');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'First Base Footwork & Throw Adjustments',
  'Youth-specific work around the bag from a former pro: adjusting the feet to the throw and stretching to balls at different locations, with repeatable practice drills.',
  'https://www.youtube.com/watch?v=R1sbhgRzneQ',
  'R1sbhgRzneQ',
  'https://img.youtube.com/vi/R1sbhgRzneQ/hqdefault.jpg',
  'Antonelli Baseball',
  'Fielding (Infield)',
  'First-base footwork',
  'Receiving throws',
  ARRAY['first base', 'footwork', 'adjustments']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['base', 'baseballs']::text[],
  ARRAY['foot adjustments', 'shifting on the bag', 'stretch to the ball']::text[],
  ARRAY['pulls foot off the bag', 'misses off-line throws at first', 'first base footwork']::text[],
  NULL,
  'Throw intentionally to all four quadrants. Cue ''chase the ball with your glove-side foot'' — the stretch foot moves toward the throw while the anchor toe holds the bag edge. Mix in throws from different infield angles.',
  '4 rounds of 6 throws (one round per quadrant)',
  '2x/week for first basemen',
  ARRAY['Stretch foot mirrors the throw location automatically', 'Anchor foot stays on the bag on wide throws', 'Clean catches on throws to both sides without crossing feet']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'R1sbhgRzneQ');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Advanced First Base — Off-Line Throws, Picks & Short Hops',
  'Academy-level footwork around the bag: shifting for throws to either side, timing the stretch, and picking short hops — the stretch goal for travel-level first basemen.',
  'https://www.youtube.com/watch?v=QR2QWQTHp-s',
  'QR2QWQTHp-s',
  'https://img.youtube.com/vi/QR2QWQTHp-s/hqdefault.jpg',
  'IMG Academy',
  'Fielding (Infield)',
  'First-base footwork',
  'Receiving throws',
  ARRAY['first base', 'picks', 'short hops', 'advanced']::text[],
  '11-14',
  11,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['base', 'baseballs', 'fungo or partner']::text[],
  ARRAY['short-hop picks', 'lateral shifts', 'stretch timing']::text[],
  ARRAY['can''t pick throws at first', 'poor scoops at first', 'misses off-line throws at first']::text[],
  'Short-hop volume is hard on the glove hand — use tennis balls or soft baseballs for high-rep sessions.',
  'Feed short hops on purpose — start with announced hops, progress to random. Cue ''soft glove through the hop, not at it.'' Add baserunner pressure last: a runner sprinting the line forces real stretch timing.',
  '3 sets of 8 picks (announced, random, with runner)',
  '2x/week',
  ARRAY['Picks 6+ of 8 random short hops cleanly', 'Chooses stretch vs. leave-the-bag correctly on wild throws', 'Footwork holds up with a live runner']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'QR2QWQTHp-s');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Daily Backhand Series',
  'Five daily backhand drills training glove angle, footwork, and body position on balls to the glove-side and backhand side — the range and glove control travel-ball infielders need.',
  'https://www.youtube.com/watch?v=IEk4QipiFTY',
  'IEk4QipiFTY',
  'https://img.youtube.com/vi/IEk4QipiFTY/hqdefault.jpg',
  'YouGoProBaseball',
  'Fielding (Infield)',
  'Backhand fielding',
  'Range',
  ARRAY['infield', 'backhand', 'glove work', 'advanced']::text[],
  '12-14',
  12,
  14,
  'Advanced',
  4,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['glove', 'baseballs', 'cones']::text[],
  ARRAY['glove angle', 'backhand footwork', 'fielding through the ball']::text[],
  ARRAY['poor footwork', 'poor approach angles', 'leaving holes between legs']::text[],
  NULL,
  'Run as a daily 10-minute series from knees to full speed. Cue ''thumb down, see the ball into the glove, work through it.'' The right foot plants outside the ball on a true backhand — check plant position every rep.',
  '5 drills x 6 reps daily',
  '4-5x/week (short daily sessions)',
  ARRAY['Fields backhands with the glove out front — not beside the body', 'Plant foot consistently outside the ball', 'Converts backhand to throw without extra steps']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'IEk4QipiFTY');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Three-Ball Slow Roller Drill',
  'Rapid-fire three-ball slow roller drill: charge, field on the run, and throw on the move under time pressure — the do-or-die play against fast runners.',
  'https://www.youtube.com/watch?v=Elzjz_qhLM4',
  'Elzjz_qhLM4',
  'https://img.youtube.com/vi/Elzjz_qhLM4/hqdefault.jpg',
  'Championship Productions',
  'Fielding (Infield)',
  'Slow rollers',
  'Throwing on the run',
  ARRAY['infield', 'slow roller', 'charge', 'advanced']::text[],
  '12-14',
  12,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['baseballs', 'fungo or coach rolling balls']::text[],
  ARRAY['charge angle', 'field on the run', 'throw on the move']::text[],
  ARRAY['poor approach angles', 'poor fielding position', 'poor footwork']::text[],
  'Throwing on the run stresses the arm — full warm-up first and cap circuits for youth arms.',
  'Three balls spaced progressively closer — the fielder charges, fields, and throws each in sequence with no reset. Cue ''right foot, left foot, throw'' rhythm on the run. Bare-hand only when the ball has stopped.',
  '3 circuits of 3 balls per session',
  '2x/week',
  ARRAY['Fields the ball outside the glove-side foot on the run', 'Throw releases within two steps of fielding', 'Accurate to first on all three balls of a circuit']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'Elzjz_qhLM4');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Double-Play Feeds & Turns',
  'Double-play footwork, feeds, and pivots at second base for both middle-infield positions — game-speed exchange and turn mechanics for 12-14U middle infielders.',
  'https://www.youtube.com/watch?v=F0MwVYtimb8',
  'F0MwVYtimb8',
  'https://img.youtube.com/vi/F0MwVYtimb8/hqdefault.jpg',
  'Antonelli Baseball',
  'Fielding (Infield)',
  'Double plays',
  'Transfer',
  ARRAY['infield', 'double play', 'feeds', 'pivot', 'advanced']::text[],
  '12-14',
  12,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['bases', 'baseballs', 'partner']::text[],
  ARRAY['feed accuracy', 'pivot footwork', 'quick exchange']::text[],
  ARRAY['slow transfer', 'slow transitions from catch to throw', 'extra steps before throw']::text[],
  'Teach bag footwork that clears the runner''s path; no live hard slides in practice turns.',
  'Rep feeds first (chest-high, at the bag), then turns without a runner, then with a soft slide. Cue ''give him the ball where his hands start.'' Alternate 4-6-3 and 6-4-3 every round so both players learn both ends.',
  '4 rounds of 6 turns per pairing',
  '2x/week',
  ARRAY['Feeds arrive chest-high at the bag every rep', 'Pivot man''s exchange takes one step or fewer', 'Full turn (contact to first-base catch) under a coach-set time target']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'F0MwVYtimb8');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Call It Early — Outfield Communication Basics',
  'Introduces calling the ball — loud, early ''mine, mine, mine'' between outfielders — with a simple drill format that builds the habit and prevents collisions.',
  'https://www.youtube.com/watch?v=x5oEDLlVpqo',
  'x5oEDLlVpqo',
  'https://img.youtube.com/vi/x5oEDLlVpqo/hqdefault.jpg',
  'DICK''S Sporting Goods',
  'Fielding (Fly Balls)',
  'Communication',
  'Tracking',
  ARRAY['outfield', 'communication', 'call the ball']::text[],
  '7-11',
  7,
  11,
  'Beginner',
  1,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['baseballs or soft balls', 'gloves']::text[],
  ARRAY['early loud calls', 'yielding when called off', 'tracking together']::text[],
  ARRAY['doesn''t call the ball', 'nobody calls it', 'two players let it drop']::text[],
  NULL,
  'Toss high flies between two fielders. Rule: the call must come before the ball''s peak, three times loud. The other player answers ''take it, take it'' and peels away. Start with soft balls so nobody fears the collision.',
  '10-12 fly balls per pair',
  'Weekly',
  ARRAY['Call comes before the ball peaks', 'Non-catching player audibly yields and peels off', 'Zero silent drops between fielders in scrimmages']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'x5oEDLlVpqo');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Infield/Outfield Priority Drill',
  'A practice-plan drill covering fly-ball priority between infielders and outfielders — who calls it, who peels off — plus ready-position habits, straight from the ABCA.',
  'https://www.youtube.com/watch?v=5q3b9m2ERho',
  '5q3b9m2ERho',
  'https://img.youtube.com/vi/5q3b9m2ERho/hqdefault.jpg',
  'American Baseball Coaches Association (ABCA)',
  'Fielding (Fly Balls)',
  'Communication',
  'Priority rules',
  ARRAY['outfield', 'infield', 'priority', 'communication']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['baseballs', 'fungo']::text[],
  ARRAY['priority rules', 'outfielder calls off infielder', 'ready position']::text[],
  ARRAY['poor priority on fly balls', 'doesn''t call off the infielder', 'collisions on fly balls']::text[],
  NULL,
  'Hit tweeners between the infield and outfield on purpose. Teach the rule plainly: the outfielder coming in owns any ball he can reach — infielders yield to his call. Freeze the play after each rep and ask ''whose ball, and why?''',
  '8-10 tweeners per group',
  'Biweekly',
  ARRAY['Outfielder''s call overrides the infielder every time', 'Infielder peels off without stopping in the landing zone', 'Tweeners get caught instead of dropping between frozen fielders']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '5q3b9m2ERho');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Do-or-Die Charge & Throw',
  'The outfield do-or-die play: charging a ground ball hard, fielding off the glove-side foot, and releasing quickly to cut down a runner at the plate.',
  'https://www.youtube.com/watch?v=iUdI35veg5E',
  'iUdI35veg5E',
  'https://img.youtube.com/vi/iUdI35veg5E/hqdefault.jpg',
  'PowerNet',
  'Fielding (Fly Balls)',
  'Charging ground balls',
  'Throwing on the run',
  ARRAY['outfield', 'do or die', 'charge', 'advanced']::text[],
  '12-14',
  12,
  14,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['baseballs', 'fungo', 'bases or target']::text[],
  ARRAY['attack angle', 'glove-side pickup', 'momentum through the throw']::text[],
  ARRAY['poor route efficiency', 'lazy routes', 'backpedaling on fly balls']::text[],
  'Max-effort throws — warm up fully and cap at 8 reps per session for youth arms.',
  'Only for game-on-the-line situations — teach the distinction from the routine knee-down block. Cue ''attack, glove-side foot, crow hop through the ball.'' Chart throw time and accuracy to a plate-sized target.',
  '6-8 charged balls per session',
  '1x/week',
  ARRAY['Fielding happens off the glove-side foot at speed', 'Momentum continues through the throw toward the target', 'Throw is catchable at the plate on a line or one long hop']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'iUdI35veg5E');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Traditional Changeup — Grip & First Throws',
  'Step-by-step introduction to holding and throwing a traditional changeup, built for youth hands: burying the ball deep in the palm and throwing with fastball intent.',
  'https://www.youtube.com/watch?v=RJRjtqWjNnQ',
  'RJRjtqWjNnQ',
  'https://img.youtube.com/vi/RJRjtqWjNnQ/hqdefault.jpg',
  'ARM Pitching Development',
  'Pitching',
  'Changeup',
  'Pitch grips',
  ARRAY['changeup', 'grip', 'offspeed', 'youth pitching']::text[],
  '8-12',
  8,
  12,
  'Beginner',
  2,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['baseballs', 'glove']::text[],
  ARRAY['deep grip', 'fastball arm speed', 'release feel']::text[],
  ARRAY['no changeup', 'only throws fastballs', 'no second pitch']::text[],
  'The changeup is the safe first off-speed pitch for youth arms — no curveball spin. Keep total throwing volume within normal daily limits.',
  'Start at short distance playing catch with the grip — no mound. Cue ''throw the fastball, the grip does the work.'' If the ball sails, the grip is too shallow; if it dies into the dirt, too deep. Find the middle.',
  '15-20 changeup throws within a normal catch session',
  'Every catch-play session for 2-3 weeks',
  ARRAY['Arm speed looks identical to the fastball from behind', 'Ball comes out 8-10% slower without being aimed', 'Comfortable enough to throw it in a bullpen without hesitation']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'RJRjtqWjNnQ');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Teaching the Changeup — Fastball Arm, Slower Ball',
  'A pro coach''s method for developing the changeup with young pitchers: grip selection for small hands and keeping arm speed identical to the fastball so the pitch actually deceives.',
  'https://www.youtube.com/watch?v=9CzbPIQfXmM',
  '9CzbPIQfXmM',
  'https://img.youtube.com/vi/9CzbPIQfXmM/hqdefault.jpg',
  'Coach Dan Blewett',
  'Pitching',
  'Changeup',
  'Pitch grips',
  ARRAY['changeup', 'arm speed', 'deception', 'youth pitching']::text[],
  '9-13',
  9,
  13,
  'Intermediate',
  3,
  'Outdoor',
  'Medium',
  TRUE,
  ARRAY['baseballs', 'glove', 'mound (optional)']::text[],
  ARRAY['arm speed maintenance', 'grip refinement', 'command to the zone']::text[],
  ARRAY['no changeup', 'needs an offspeed pitch', 'one speed pitcher']::text[],
  'Introduce off-speed only after fastball mechanics are stable; changeup before any breaking ball for youth pitchers.',
  'Film from the side: the fastball and changeup deliveries should be indistinguishable. Common fault is slowing the arm — fix it by cueing ''throw it hard'' and letting the grip kill velocity. Mix 1 changeup per 3 fastballs in bullpens.',
  '10-12 changeups per bullpen, mixed with fastballs',
  '1-2 bullpens/week',
  ARRAY['Side-by-side video shows matching arm speed', 'Changeup lands in the bottom half of the zone', 'Hitters in live BP are visibly out in front']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '9CzbPIQfXmM');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Changeup Grip Menu — Match the Grip to the Hand',
  'Walks through circle, three-finger, and other changeup grip options so pitchers can match a grip to their hand size as they grow — and refine feel and movement.',
  'https://www.youtube.com/watch?v=Ji0QzOJe3hE',
  'Ji0QzOJe3hE',
  'https://img.youtube.com/vi/Ji0QzOJe3hE/hqdefault.jpg',
  'ARM Pitching Development',
  'Pitching',
  'Changeup',
  'Pitch grips',
  ARRAY['changeup', 'circle change', 'three finger', 'grips']::text[],
  '9-14',
  9,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['baseballs', 'glove']::text[],
  ARRAY['grip selection', 'pronation feel', 'movement profile']::text[],
  ARRAY['changeup grip', 'no changeup', 'pitch grips']::text[],
  'Grip experiments stay within normal catch-play volume; no max-effort mound work while testing grips.',
  'Have the pitcher test 2-3 grips over two weeks of catch play and keep whichever kills the most speed with the least effort. Small hands usually can''t do a true circle — three-finger is the honest starting point. Revisit each off-season as hands grow.',
  '10 throws per grip during catch play',
  '2-3x/week for two weeks, then settle on one',
  ARRAY['Picks one grip and can describe why it fits', 'Consistent 8-12% speed gap off the fastball', 'Some arm-side fade develops as pronation improves']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'Ji0QzOJe3hE');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'The Catch Drill — Track & Read Pitches',
  'Hitters catch pitches instead of swinging, training the eyes to read pitch type and location out of the hand — recognition and discipline without swing pressure.',
  'https://www.youtube.com/watch?v=0Phvj-iyLcc',
  '0Phvj-iyLcc',
  'https://img.youtube.com/vi/0Phvj-iyLcc/hqdefault.jpg',
  'Coach Dan Blewett',
  'Hitting',
  'Pitch recognition',
  'Tracking',
  ARRAY['pitch recognition', 'tracking', 'vision', 'hitting']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Medium',
  TRUE,
  ARRAY['glove', 'helmet', 'live or machine pitching']::text[],
  ARRAY['reading out of the hand', 'early recognition', 'strike zone judgment']::text[],
  ARRAY['poor pitch recognition', 'can''t recognize spin', 'fooled by slow pitches']::text[],
  'Helmet required when standing in the box; start with reduced-speed pitching for younger hitters.',
  'Hitter stands in the box wearing a helmet with a glove and catches the pitch, calling ''fastball'' or ''change'' as early as possible. Score correct early calls. Rotate hitters standing in during bullpens for free reps.',
  '2 rounds of 10 pitches, calls scored',
  '2x/week (piggyback on bullpens)',
  ARRAY['Calls pitch type before the ball is halfway home', 'Correctly takes balls and ''catches strikes'' by location call', 'Carries calmer takes into live at-bats']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '0Phvj-iyLcc');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Stay Back — Beat the Changeup',
  'What ''staying back'' actually means, with drills to keep weight and hands loaded so hitters aren''t fooled out front by off-speed pitches.',
  'https://www.youtube.com/watch?v=8_6Ea45fL5s',
  '8_6Ea45fL5s',
  'https://img.youtube.com/vi/8_6Ea45fL5s/hqdefault.jpg',
  'Ultimate Baseball Training',
  'Hitting',
  'Off-speed hitting',
  'Balance',
  ARRAY['stay back', 'offspeed', 'balance', 'timing']::text[],
  '11-15',
  11,
  15,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Medium',
  TRUE,
  ARRAY['bat', 'tee', 'balls', 'front-toss screen']::text[],
  ARRAY['weight control', 'hands loaded', 'adjustable stride']::text[],
  ARRAY['out in front of offspeed', 'off balance against slow stuff', 'way out in front']::text[],
  NULL,
  'Front toss with random speed changes: the feeder varies fast/slow without telling. Cue ''stride to hit the fastball, keep the hands back for the change.'' The stride lands on time — the hands wait.',
  '3 rounds of 12 mixed-speed swings',
  '2x/week',
  ARRAY['Head and weight stay behind the front hip on slow pitches', 'Hard contact on both speeds within the same round', 'No double-stride or lunge when fooled']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '8_6Ea45fL5s');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'In-Swing Off-Speed Adjustment',
  'The correct in-swing adjustment when a hitter recognizes off-speed mid-pitch — keeping the barrel in the zone instead of rolling over, for hitters facing pitchers who mix speeds.',
  'https://www.youtube.com/watch?v=oCq8NblqfQE',
  'oCq8NblqfQE',
  'https://img.youtube.com/vi/oCq8NblqfQE/hqdefault.jpg',
  'Dominate The Diamond',
  'Hitting',
  'Off-speed hitting',
  'Barrel control',
  ARRAY['offspeed', 'adjustment', 'barrel control', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Indoor/Outdoor',
  'Medium',
  TRUE,
  ARRAY['bat', 'balls', 'front-toss screen or machine']::text[],
  ARRAY['mid-pitch adjustment', 'barrel in the zone', 'posture hold']::text[],
  ARRAY['can''t hit offspeed', 'can''t hit the changeup', 'fooled by slow pitches']::text[],
  NULL,
  'Machine or feeder mixes speeds with a 2:1 fastball bias. Cue ''swing fastball, adjust down and long'' — the barrel stays through the hitting zone so late recognition still produces fair contact. Track hard-hit rate on the off-speed only.',
  '4 rounds of 10 mixed pitches',
  '1-2x/week',
  ARRAY['Off-speed contact goes up the middle or oppo instead of weak pull-side', 'Posture holds through the adjusted swing', 'Hard-hit rate on off-speed climbs over 3-4 sessions']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'oCq8NblqfQE');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Opposite-Field Teaching Progression',
  'Five coach-friendly methods for teaching hitters to drive the ball the other way — the foundation for hitting behind runners and executing situational at-bats.',
  'https://www.youtube.com/watch?v=pn3xtpCc8uM',
  'pn3xtpCc8uM',
  'https://img.youtube.com/vi/pn3xtpCc8uM/hqdefault.jpg',
  'Dominate The Diamond',
  'Hitting',
  'Situational hitting',
  'Opposite field',
  ARRAY['opposite field', 'oppo', 'situational hitting']::text[],
  '9-13',
  9,
  13,
  'Beginner',
  2,
  'Indoor/Outdoor',
  'Medium',
  TRUE,
  ARRAY['bat', 'tee', 'balls']::text[],
  ARRAY['letting the ball travel', 'inside path', 'contact depth']::text[],
  ARRAY['can''t go opposite field', 'pull happy', 'no situational hitting']::text[],
  NULL,
  'Start on the tee set deep in the zone. Cue ''let it get to your back hip, hit the inside half.'' Progress through the five methods as each sticks. Success is direction, not distance — a firm ground ball the other way counts.',
  '3 rounds of 10 swings, all must go opposite field',
  '2x/week',
  ARRAY['Ball flight consistently between center and the opposite-field line', 'Contact point is visibly deeper than the pull-side swing', 'Can call ''oppo'' and execute on demand in BP']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'pn3xtpCc8uM');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Oppo Tee & Toss — Stay Inside the Ball',
  'A repeatable tee/toss drill for staying inside the ball and driving outside pitches the other way — plugs directly into situational BP rounds.',
  'https://www.youtube.com/watch?v=OhWNIpPlcgA',
  'OhWNIpPlcgA',
  'https://img.youtube.com/vi/OhWNIpPlcgA/hqdefault.jpg',
  'Pro Speed Baseball',
  'Hitting',
  'Situational hitting',
  'Opposite field',
  ARRAY['opposite field', 'tee work', 'inside the ball']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['bat', 'tee', 'balls', 'net']::text[],
  ARRAY['staying inside the ball', 'outside-pitch path', 'extension through contact']::text[],
  ARRAY['can''t go opposite field', 'pull happy', 'doesn''t hit behind the runner']::text[],
  NULL,
  'Tee on the outer third, slightly deep. Cue ''knob to the ball, barrel late.'' Rolling over the outside pitch means the barrel released early — reset with three one-arm bottom-hand swings, then return to full swings.',
  '4 sets of 8 swings on the outer-third tee',
  '2-3x/week',
  ARRAY['Line drives to the opposite gap off the outer-third tee', 'No rolled-over contact for a full set', 'Same swing shows up on outside pitches in front toss']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'OhWNIpPlcgA');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'The Move-''Em At-Bat — Advancing Runners',
  'The ''move ''em'' at-bat — advancing a runner from second with nobody out — broken down with College World Series examples: approach, pitch zones, and execution under pressure.',
  'https://www.youtube.com/watch?v=_yEr3pFHQUA',
  '_yEr3pFHQUA',
  'https://img.youtube.com/vi/_yEr3pFHQUA/hqdefault.jpg',
  'Catalyst Sports',
  'Hitting',
  'Situational hitting',
  'Approach',
  ARRAY['situational hitting', 'moving runners', 'approach', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['bat', 'balls', 'bases', 'live or machine pitching']::text[],
  ARRAY['zone selection', 'right-side contact', 'situational discipline']::text[],
  ARRAY['can''t move runners', 'doesn''t advance runners', 'no approach with runners on']::text[],
  NULL,
  'Run situational BP: runner at second, nobody out, hitter must move him. Only pitches middle-away get swings — pulling a ball on the ground to short is a failed rep even if it''s a ''hit.'' Score execution, not outcomes.',
  '2 situational rounds of 6 at-bat scenarios per session',
  'Weekly in-season',
  ARRAY['Runner reaches third on 4+ of 6 execution reps', 'Hitter can state the plan before stepping in', 'Takes the inside pitch he can''t execute with, without frustration']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = '_yEr3pFHQUA');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Overload/Underload Bat Speed Progression',
  'Overload/underload training with weighted and light bats to raise bat speed in youth hitters — how to sequence heavy-light swings safely for developing players.',
  'https://www.youtube.com/watch?v=Oz1oGdb0n-8',
  'Oz1oGdb0n-8',
  'https://img.youtube.com/vi/Oz1oGdb0n-8/hqdefault.jpg',
  'Hitting Done Right - HDR',
  'Hitting',
  'Bat speed',
  'Sequencing',
  ARRAY['bat speed', 'overload', 'underload', 'advanced']::text[],
  '11-14',
  11,
  14,
  'Advanced',
  4,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['standard bat', 'heavier training bat', 'lighter training bat', 'tee', 'balls']::text[],
  ARRAY['intent to swing fast', 'sequencing under load', 'barrel speed']::text[],
  ARRAY['slow bat', 'slow bat speed', 'late on fast pitching']::text[],
  'Keep overload bats within ~20% of game bat weight for youth; stop if wrist or elbow soreness appears.',
  'Order matters: heavy (feel sequence) → light (move fast) → game bat (transfer). Full intent on every swing — lazy overload swings teach slow. Measure with a swing sensor or simple phone video if no sensor.',
  '3 rounds: 5 heavy + 5 light + 5 game-bat swings',
  '2x/week with rest days between',
  ARRAY['Game-bat swing speed measurably up over 4-6 weeks', 'Swing sequence stays intact under the heavy bat', 'No grip/wrist soreness — load is age-appropriate']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'Oz1oGdb0n-8');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Deaden & Direct — Bunt Placement Drill',
  'A simple high-rep bunting drill that trains deadening the ball and placing bunts toward first or third on command — precision beyond basic technique.',
  'https://www.youtube.com/watch?v=pIx9tM4NKrU',
  'pIx9tM4NKrU',
  'https://img.youtube.com/vi/pIx9tM4NKrU/hqdefault.jpg',
  'Baseball By The Yard',
  'Bunting',
  'Bunt placement',
  'Bat control',
  ARRAY['bunting', 'placement', 'deaden']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  TRUE,
  ARRAY['bat', 'balls', 'cones or towels as targets']::text[],
  ARRAY['deadening the ball', 'bat angle steering', 'top-hand give']::text[],
  ARRAY['can''t place bunts', 'pops up bunts', 'can''t get a bunt down']::text[],
  NULL,
  'Lay towels or cone lanes down each line. Feeder calls ''first side'' or ''third side'' mid-toss. Cue ''catch it with the barrel'' — soft top hand gives with contact. Chase the ball angle with the knob, not the barrel.',
  '3 rounds of 10 bunts, alternating target lanes',
  'Weekly',
  ARRAY['7+ of 10 bunts stop inside the called lane', 'Ball dies within 15 feet of the plate', 'Bat starts at the top of the zone — anything above it is taken']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'pIx9tM4NKrU');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Competitive Team Bunting Game',
  'A team-wide competitive bunting game scoring sacrifice bunts, push bunts, and bunting for a hit — pressure and accountability so bunting practice transfers to games.',
  'https://www.youtube.com/watch?v=SR8atnQMvg4',
  'SR8atnQMvg4',
  'https://img.youtube.com/vi/SR8atnQMvg4/hqdefault.jpg',
  'Coach Trent Mongero',
  'Bunting',
  'Bunt execution',
  'Pressure execution',
  ARRAY['bunting', 'competition', 'pressure', 'advanced']::text[],
  '12-16',
  12,
  16,
  'Advanced',
  4,
  'Outdoor',
  'Full field',
  TRUE,
  ARRAY['bats', 'balls', 'bases', 'live pitching or machine']::text[],
  ARRAY['execution under pressure', 'bunt-type selection', 'situational bunting']::text[],
  ARRAY['can''t get a bunt down', 'sacrifice bunt', 'bunting for a hit']::text[],
  NULL,
  'Split the team; each hitter draws a situation card (sac to third, push past the pitcher, squeeze). Points only for executed bunts against live pitching. Losing team does field cleanup — pressure makes the reps real.',
  'Each player: 4-6 competitive bunt attempts',
  'Biweekly in-season',
  ARRAY['Executes 3 different bunt types against live pitching', 'Success rate climbs across sessions', 'Players choose the right bunt for the situation without coaching']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'SR8atnQMvg4');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Youth J-Band Routine — Pre-Throwing Activation',
  'Essential J-band resistance exercises for youth pitchers and throwers: warming up the shoulder and building arm strength before any throwing session.',
  'https://www.youtube.com/watch?v=yrgUzW0UK40',
  'yrgUzW0UK40',
  'https://img.youtube.com/vi/yrgUzW0UK40/hqdefault.jpg',
  'ARM Pitching Development',
  'Arm Care',
  'Shoulder activation',
  'Injury prevention',
  ARRAY['arm care', 'j-bands', 'warm up', 'shoulder']::text[],
  '8-14',
  8,
  14,
  'Beginner',
  1,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['J-bands or light resistance bands', 'fence or anchor point']::text[],
  ARRAY['scapular activation', 'rotator cuff warm-up', 'band control']::text[],
  ARRAY['arm gets tired', 'no arm care routine', 'needs j-bands']::text[],
  'Light resistance only for youth — bands should bend, not strain. Stop any exercise that causes joint pain rather than muscle warmth.',
  'Anchor at elbow height and keep tension light — these are activation reps, not strength maxes. Cue ''slow out, slow back'' with no band snap. Make it the non-negotiable first station before any throwing.',
  '1 round of 8-10 reps per exercise, before every throwing session',
  'Every throwing day',
  ARRAY['Completes the routine without form breakdown', 'Reports the arm feeling ''ready'' before the first throw', 'Routine happens without being reminded']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'yrgUzW0UK40');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  '9-Exercise J-Band Strength Routine',
  'A nine-exercise J-band routine targeting the rotator cuff and scapular muscles for throwing durability and velocity — proper band tension, tempo, and the common form mistakes.',
  'https://www.youtube.com/watch?v=slqo583qoAg',
  'slqo583qoAg',
  'https://img.youtube.com/vi/slqo583qoAg/hqdefault.jpg',
  'Northern Baseball Training',
  'Arm Care',
  'Rotator cuff strength',
  'Injury prevention',
  ARRAY['arm care', 'j-bands', 'rotator cuff', 'strength']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['J-bands or resistance bands', 'anchor point']::text[],
  ARRAY['rotator cuff strength', 'scapular control', 'tempo work']::text[],
  ARRAY['weak rotator cuff', 'arm fatigue', 'arm durability']::text[],
  'Strength band work belongs on low-throwing days; skip it the day after a max pitch-count outing.',
  'Run as a standalone mini-workout on lighter throwing days, not tacked onto a max-effort session. Cue controlled 2-second tempo each direction. Elbows stay at the set height — dropping the elbow is the giveaway fatigue sign to stop.',
  '2 sets of 10 reps per exercise',
  '2-3x/week on low-throw days',
  ARRAY['All 9 exercises completed with steady tempo', 'Band resistance can progress after 3-4 weeks', 'Arm bounces back faster between outings']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'slqo583qoAg');

INSERT INTO drill_resources (drill_name, description, youtube_url, youtube_video_id, thumbnail_url, channel, skill_category, primary_skill, secondary_skill, tags, age_range, min_age, max_age, difficulty_level, progression_level, indoor_outdoor, space_required, requires_partner, equipment_needed, mechanic_focus, common_flaws_fixed, safety_notes, ai_coaching_notes, reps_guidance, frequency_guidance, success_markers)
SELECT
  'Post-Throwing Recovery Routine',
  'Eight exercises pitchers should do after bullpens or game outings to flush the arm and protect the rotator cuff — a consistent recovery habit between outings.',
  'https://www.youtube.com/watch?v=EunHAooYktE',
  'EunHAooYktE',
  'https://img.youtube.com/vi/EunHAooYktE/hqdefault.jpg',
  'ARM Pitching Development',
  'Arm Care',
  'Recovery',
  'Injury prevention',
  ARRAY['arm care', 'recovery', 'post throwing', 'pitchers']::text[],
  '10-14',
  10,
  14,
  'Intermediate',
  3,
  'Indoor/Outdoor',
  'Small',
  FALSE,
  ARRAY['light bands', 'open space']::text[],
  ARRAY['blood flow', 'range of motion', 'downregulation']::text[],
  ARRAY['sore arm after pitching', 'no recovery routine', 'dead arm']::text[],
  'Recovery work is light by design — no heavy resistance after throwing. Persistent sharp pain after outings is a see-a-doctor sign, not a push-through sign.',
  'The routine happens within 15 minutes of the last pitch, every outing — consistency is the entire point. Keep everything light and rhythmic; recovery work should feel easier than warm-up work. Log soreness the next day to show players it works.',
  '1 round of 8 exercises immediately after throwing',
  'After every bullpen, start, or heavy throwing day',
  ARRAY['Next-day soreness noticeably reduced in the player''s log', 'Routine completed unprompted after outings', 'Full pain-free range of motion maintained through the season']::text[]
WHERE NOT EXISTS (SELECT 1 FROM drill_resources WHERE youtube_video_id = 'EunHAooYktE');


-- ---------------------------------------------------------------------------
-- 3. drill_problem_map (47 rows) — drill_id resolved by youtube_video_id
-- ---------------------------------------------------------------------------

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)  -- existing library drill
SELECT id, 'catcher-receiving', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'Kwo1k2i-tSE'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'catcher-receiving', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'JDRg2nvAwqU'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'catcher-receiving', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'Z1erh6UVR_w'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'catcher-receiving', 4, TRUE
FROM drill_resources WHERE youtube_video_id = 'yJxiRn88Ms0'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)  -- existing library drill
SELECT id, 'catcher-blocking', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'Tjzv5anKEe0'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'catcher-blocking', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'eQCF2jZiU5M'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'catcher-blocking', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'n8OCrOmbTBU'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-slide', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'h_mEnVPL6Qg'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-slide', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'e_q6AWdgabQ'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-slide', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'wMZkEfiFBxc'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'base-stealing', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'JVwDSgbUfBM'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'base-stealing', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'SXfbP6x3iXI'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'base-stealing', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'iZK-Rtp1bv4'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cutoffs-relays', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'Yle6R1-flA8'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cutoffs-relays', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'YipF1W7BDJM'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cutoffs-relays', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'wIU9NdCBBkE'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cutoffs-relays', 4, TRUE
FROM drill_resources WHERE youtube_video_id = 'TJXQiYdueQc'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'rundowns', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'OEYEvKRh2eQ'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'rundowns', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'cV8Ivq0XcJA'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'rundowns', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'OAbBekHAk_g'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'first-base-footwork', 1, TRUE
FROM drill_resources WHERE youtube_video_id = '95B1kSchurQ'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'first-base-footwork', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'R1sbhgRzneQ'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'first-base-footwork', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'QR2QWQTHp-s'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'outfield-communication', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'x5oEDLlVpqo'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)  -- existing library drill
SELECT id, 'outfield-communication', 2, TRUE
FROM drill_resources WHERE youtube_video_id = '7CbADt5veC0'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'outfield-communication', 3, TRUE
FROM drill_resources WHERE youtube_video_id = '5q3b9m2ERho'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-changeup', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'RJRjtqWjNnQ'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-changeup', 2, TRUE
FROM drill_resources WHERE youtube_video_id = '9CzbPIQfXmM'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-changeup', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'Ji0QzOJe3hE'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-hit-offspeed', 1, TRUE
FROM drill_resources WHERE youtube_video_id = '0Phvj-iyLcc'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-hit-offspeed', 2, TRUE
FROM drill_resources WHERE youtube_video_id = '8_6Ea45fL5s'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-hit-offspeed', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'oCq8NblqfQE'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-situational-hitting', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'pn3xtpCc8uM'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-situational-hitting', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'OhWNIpPlcgA'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'no-situational-hitting', 3, TRUE
FROM drill_resources WHERE youtube_video_id = '_yEr3pFHQUA'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)  -- existing library drill
SELECT id, 'cant-bunt', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'jw2edYj5Pk4'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-bunt', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'pIx9tM4NKrU'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'cant-bunt', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'SR8atnQMvg4'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'arm-fatigue', 1, TRUE
FROM drill_resources WHERE youtube_video_id = 'yrgUzW0UK40'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'arm-fatigue', 2, TRUE
FROM drill_resources WHERE youtube_video_id = 'slqo583qoAg'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'arm-fatigue', 3, TRUE
FROM drill_resources WHERE youtube_video_id = 'EunHAooYktE'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'poor-fielding-footwork', 90, FALSE
FROM drill_resources WHERE youtube_video_id = 'IEk4QipiFTY'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'poor-fielding-footwork', 91, FALSE
FROM drill_resources WHERE youtube_video_id = 'Elzjz_qhLM4'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'slow-transfer', 90, FALSE
FROM drill_resources WHERE youtube_video_id = 'F0MwVYtimb8'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'slow-transfer', 91, FALSE
FROM drill_resources WHERE youtube_video_id = 'RmlsQPV4OGs'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'late-timing', 90, FALSE
FROM drill_resources WHERE youtube_video_id = 'Oz1oGdb0n-8'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

INSERT INTO drill_problem_map (drill_id, problem_slug, sort_order, curated)
SELECT id, 'backpedaling-flyballs', 90, FALSE
FROM drill_resources WHERE youtube_video_id = 'iUdI35veg5E'
LIMIT 1
ON CONFLICT (drill_id, problem_slug) DO NOTHING;


COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Verification — run after commit; expected values in comments
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS problems_total FROM problem_taxonomy;                        -- expect 48
SELECT COUNT(*) AS drills_total FROM drill_resources;                           -- expect 206
SELECT COUNT(*) AS mappings_on_new_problems FROM drill_problem_map
  WHERE problem_slug IN ('catcher-receiving', 'catcher-blocking', 'cant-slide', 'base-stealing', 'cutoffs-relays', 'rundowns', 'first-base-footwork', 'outfield-communication', 'no-changeup', 'cant-hit-offspeed', 'no-situational-hitting', 'cant-bunt', 'arm-fatigue');                                          -- expect 41
SELECT COUNT(*) AS appended_advanced_mappings FROM drill_problem_map
  WHERE sort_order >= 90 AND curated = FALSE;                                   -- expect 6
-- Per-problem curated sequence check (every new problem should show 2-4 rows):
SELECT problem_slug, COUNT(*) AS drills, BOOL_AND(curated) AS all_curated
  FROM drill_problem_map
  WHERE problem_slug IN ('catcher-receiving', 'catcher-blocking', 'cant-slide', 'base-stealing', 'cutoffs-relays', 'rundowns', 'first-base-footwork', 'outfield-communication', 'no-changeup', 'cant-hit-offspeed', 'no-situational-hitting', 'cant-bunt', 'arm-fatigue')
  GROUP BY problem_slug ORDER BY problem_slug;
-- Orphan check (should return 0 rows — every mapping resolved to a drill):
SELECT problem_slug FROM drill_problem_map WHERE drill_id IS NULL;
