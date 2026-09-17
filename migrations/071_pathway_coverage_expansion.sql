-- ============================================================================
-- 071 — Pathway coverage expansion
-- ============================================================================
--
-- Phase 2F. The coverage audit found 27 THIN or GAP stages. This migration
-- closes them the way the audit says they should be closed, which is mostly
-- NOT by writing new drills:
--
--    6 stages get a new canonical row, because the teaching job genuinely is
--      not in the library
--    9 stages get a drill the library already holds, attached to a stage that
--      needed it and did not link it
--   12 stages get nothing, because two drills for one teaching job is the
--      right answer and a third would only make a table green
--
-- The reasoning for every one of the 27 is in
-- docs/audits/development-pathway-canonical-gap-audit.csv, one row per stage,
-- with the candidate that was checked and why it was or was not enough.
--
-- Six of the candidates the phase brief proposed are NOT here, because the
-- library already has them under other names:
--
--   Segmented Delivery Drill    -> 4-Part Windup Drill
--   Stride-Line Landing Drill   -> Stride Direction Drill (it uses a chalk line)
--   Front-Side Stability Drill  -> Glove-Side Pull Drill — Front Side Control
--   Tempo / Momentum Drill      -> The Swing Shuffle Drill — Momentum & Rhythm
--   Quiet Hands Receiving       -> Youth Receiving Foundations — Quiet Glove
--                                  & Soft Hands (already this stage's primary)
--   Blocking Reaction / Game
--     Speed Blocking            -> Game-Speed Reaction Blocking
--
-- WHAT THIS MIGRATION DELETES
--
-- No drill row is deleted, updated or retired. The library is additive only.
--
-- It does delete ONE pathway link: Baserunning stage 1 currently reinforces
-- "out of the box" with Baseball Dynamic Stretches for Youth Players, an
-- Athletic Development row mapped to cold-arm. That is the category-match
-- error Phase 2E's own curation rules forbid, it was mine, and it comes out.
-- The link is Phase 2E data, not library data.
--
-- It also drops three helper functions (pw_st, pw_ds, pw_ps) created while
-- applying 070 in parts. They were invoker-rights wrappers over the same
-- inserts, usable only by service_role, and they have no reason to persist.
--
-- Written for BenchCoach. No source text is copied, no video is claimed, no
-- timestamp is invented, and every new row is runnable with no video at all.
--
-- Idempotent: fixed UUIDs, ON CONFLICT DO NOTHING, and link inserts guarded
-- against duplicates.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Six new canonical activities.
-- ---------------------------------------------------------------------------
INSERT INTO public.drill_resources (
  id, drill_name, skill_category, primary_skill, secondary_skill,
  description, ai_coaching_notes, safety_notes, success_markers,
  reps_guidance, regression_notes, progression_notes,
  mechanic_focus, common_flaws_fixed, tags,
  age_range, min_age, max_age, difficulty_level, progression_level,
  competition_level, equipment_needed, indoor_outdoor, space_required,
  requires_partner, est_duration_minutes, activity_format, practice_roles,
  min_players, max_players, ideal_group_size, min_coaches, station_friendly,
  rep_density, idle_time_risk, engagement_level, competition_style,
  instruction_complexity, throwing_load, physical_intensity,
  mixed_skill_friendly, resource_kind, status, source, created_by_coach_id
) VALUES

-- Build the Swing, stage 2. The only drill in the library that touched the
-- grip mentioned it in one clause of its set-up. This is the rep.
('2578d426-2185-5a9c-a8bb-cb56c12e6c65','Grip Check — Find It Without Looking','Hitting','grip','hand position','The bat starts on the ground. The hitter picks it up, takes their grip, and holds it out for the coach to see — without looking down at their own hands. The coach checks one thing: are the knocking knuckles roughly lined up. Then the bat goes back down and they do it again. Ten of those takes about ninety seconds and it is the only ninety seconds in a season where the grip is the whole subject. A grip that has to be fixed during the load costs the hitter the load, and a hitter who re-grips mid-swing has already lost the swing.','Cue "knuckles line up, hands relaxed". Knocking knuckles are the middle ones — the set you would knock on a door with. Roughly lined up is the standard, not perfectly: a young hand on an adult-sized handle will never be exact and chasing exactness teaches tension, which is worse than the misalignment. Check the bat is in the FINGERS rather than buried in the palms; a palm grip is what stops the wrists hinging and no amount of knuckle talk will fix it. If the hitter has to look at their hands to find the grip, they have not got it yet, and that is the whole test.',NULL,ARRAY['Finds the grip without looking down on eight of ten pick-ups','Knocking knuckles are roughly aligned','Hands stay relaxed at set-up rather than white-knuckled'],'10 pick-ups, about 90 seconds','Draw a line across the middle knuckles with a marker or a strip of tape so the alignment is visible to the hitter and not only to the coach.','Take the grip, then a dry swing, and check it again at the finish — a grip that survives a swing is the one that will survive a pitch.',ARRAY['grip','knuckle alignment','hands in the fingers'],ARRAY['bat gripped in the palms','knuckles rolled over','re-gripping during the load'],ARRAY['hitting','grip','setup','beginner','no equipment'],'6-14',6,14,'Beginner',1,'both',ARRAY['bat'],'Both','Small',false,3,'station',ARRAY['teach','repetition'],1,NULL,6,1,true,'high','low','low','none','low','none','low',true,'activity','approved','benchcoach_original',NULL),

-- Infield Fundamentals, stage 4. The library has short hops and it has
-- recovery from a bad one. It has nothing that makes the fielder CHOOSE.
('31f82124-8e4f-59dc-8784-f76352941194','Pick Your Hop — Read It and Move to It','Fielding (Infield)','reading hops','hop selection','Ground balls rolled or hit from varied distances so that every one bounces differently, and the fielder has to say out loud which hop they are taking before they take it — "short" or "long". Then they move their feet to get it. A ball that would arrive on the in-between hop is the whole point: the fielder either charges to catch it earlier, on the long hop, or gives ground to take it later, after the short one. What they cannot do is stand still and let the worst hop in baseball come to them. Youth infielders are taught to field the bounce they are given and most errors on ordinary ground balls are the bounce nobody chose.','Cue "count it, then go". Have the fielder count the bounces aloud on the first few — one, two, three — because a player who cannot count the hops cannot pick one. The in-between hop is the one that arrives around knee height as it is rising; it is the hardest ball in the infield and it is almost always avoidable. Watch for goalie fielding: feet planted, glove out, hoping. That is the habit being replaced. Charging is the right answer more often than youth players believe, because it turns a bad hop into a long one and buys the throw as well.','On an uneven surface a ball can come up at the face. Start on the flattest ground available and use a softer ball until the fielder is reading hops rather than reacting to them.',ARRAY['Calls the hop before fielding it on most reps','Moves forward or back rather than standing still on an in-between hop','Takes the ball on the long hop or after the short one, not in between'],'12-15 balls per fielder','Roll from one fixed distance and announce the hop yourself, so the footwork is practised before the reading is added.','Stop calling anything, hit the ball rather than rolling it, and add a throw so the hop the fielder picks has to leave them a play.',ARRAY['reading hops','hop selection','creating a better hop','footwork through the ball'],ARRAY['fielding the in-between hop','standing still and letting the ball play them','stabbing at a changing bounce'],ARRAY['infield','ground balls','decisions','intermediate'],'9-14',9,14,'Intermediate',3,'both',ARRAY['glove','baseballs or soft-core balls'],'Both','Medium',false,12,'station',ARRAY['teach','isolate','decision'],1,NULL,4,1,true,'medium','medium','high','none','medium','low','medium',true,'activity','approved','benchcoach_original',NULL),

-- Outfield Development, stage 1. The drop step covers the ball hit overhead.
-- Nothing covered the ball hit anywhere else from a standing start.
('cef00f99-1829-5dab-aec0-73162ccdd91b','Ready and Go — Outfield First Step','Fielding (Fly Balls)','pre-pitch ready position','first step in any direction','The outfielder sets up in a ready position on an imaginary pitch — feet moving slightly, weight forward, hands off the knees — and the coach sends a ball in one of four directions: in front, over the head, and into each gap. The fielder does not know which. The rep is over as soon as they have taken three good steps; the catch is a bonus, not the point. Almost all youth outfield practice hits a ball to a player who is standing flat, and the first step is where most of the ground in an outfield is won and lost.','Cue "small feet, then big ones". The first movement should be a short adjustment step that gets the weight going, not a lunge. Watch the heels: a fielder rocked back on them takes their first step backwards whichever way the ball went. Vary the direction genuinely randomly — a fielder who can predict the next ball is practising a routine, not a reaction. Balls in front are the ones youth outfielders are worst at and the ones coaches hit least, so send more of them than feels right.',NULL,ARRAY['First step takes ground in the right direction','Weight is on the balls of the feet, not the heels','Is moving before the ball has peaked'],'8-10 reps per player, directions mixed','Call the direction before the ball leaves your hand, so the fielder practises the movement without the read.','Hit the ball with a bat rather than throwing it, so the read comes off the swing, and remove the call entirely.',ARRAY['pre-pitch ready position','first step in any direction','reading direction off the ball'],ARRAY['standing flat at the pitch','first step going backwards','waiting for the ball to peak before moving'],ARRAY['outfield','first step','reaction','beginner'],'8-14',8,14,'Beginner',2,'both',ARRAY['glove','baseballs'],'Outdoor','Medium',false,10,'station',ARRAY['teach','repetition'],1,NULL,4,1,true,'medium','medium','high','none','low','none','high',true,'activity','approved','benchcoach_original',NULL),

-- Outfield Development, stage 7. The library had the do-or-die charge and
-- nothing for the ground ball that is not an emergency.
('93566e0d-787f-5c3c-b479-a6a9d84ddbf1','Routine Outfield Ground Ball — Field It and Come Up Throwing','Fielding (Fly Balls)','routine outfield ground ball','into the throw','A ball rolled or hit through to the outfield with nobody trying to score. The outfielder charges under control, gets around the ball so they are moving toward their target as they field it, takes it in the middle of the body with two hands, and comes up throwing to the cut-off. Then the same ball again with a runner who is not going anywhere, where the right answer is to drop a knee behind it, block it, and concede nothing. Most balls that reach a youth outfield are this ball. The library had only the emergency version, which is a different play with different feet and a different risk.','Cue "around it, through it, up". Getting around the ball is what lets the throw happen — a fielder who runs straight at it has to stop, and a fielder who has stopped has no throw. Two hands on the routine ball: the one-handed pick-up is how a single becomes a triple, and there is no reason to risk it when nobody is running. Teach the knee-down block as the same play with the urgency taken out, and be explicit that choosing it is a decision, not a failure. The difference between this and the do-or-die charge is the score and the runner, not the technique — say that out loud or players will charge everything.',NULL,ARRAY['Fields the ball moving toward the target rather than sideways to it','Two hands on the routine ball','Throw reaches the cut-off man on the fly or on one long hop'],'10 balls per player, a few of them as knee-down blocks','Stand the fielder still and roll straight at them, so the catch and the throw are learned before the approach is added.','Add a runner who will take the extra base on anything mishandled, and mix the do-or-die ball in so the fielder has to pick the play.',ARRAY['routine outfield ground ball','approach angle','two-hand pick-up','into the throw'],ARRAY['waiting for the ball','one-handed pick-up with nobody running','fielding it beside the body so there is no throw'],ARRAY['outfield','ground balls','game situation','beginner'],'8-14',8,14,'Beginner',2,'both',ARRAY['glove','baseballs','a cut-off target or cone'],'Outdoor','Medium',false,12,'station',ARRAY['teach','repetition','decision'],2,NULL,5,1,true,'medium','medium','medium','none','low','medium','medium',true,'activity','approved','benchcoach_original',NULL),

-- Pitching Development, stage 11. One changeup drill existed and it was
-- catch play on flat ground.
('20d240e9-8d9f-567f-9e87-c25a5f0b9cfb','Changeup Off the Mound — Same Arm Speed, Real Sequence','Pitching','changeup off the mound','pitch sequencing','The changeup taken off flat ground and onto a mound, thrown in sequence rather than in isolation. Sets of five: fastball, fastball, changeup, and the pitcher does not get to change anything except the grip. The catcher calls out the arm speed they saw — "same" or "slower" — after every changeup, because the pitcher cannot feel the difference and the hitter can. Then the same sequence to a hitter standing in and taking, which is the first time the pitch has to survive being looked at. A changeup that works on flat ground and disappears off a mound is the normal outcome and the reason this step exists.','Cue "same arm, different grip". Arm speed is the entire pitch; a changeup thrown slower is a batting-practice fastball and it gets hit harder than the fastball does. Expect the first mound changeups to sail high — the grip takes speed off and the release is early — and fix it by finishing out front rather than by aiming. Changeup only at this age. Nothing in this drill or this pathway asks a young arm for a breaking ball, and a pitcher who does not yet have a fastball they can locate does not need a second pitch at all.','Counts toward the pitcher''s throwing total for the day and for the week. Run it inside a normal bullpen rather than on top of one, and stop on any complaint of elbow or shoulder soreness rather than finishing the set.',ARRAY['Catcher reports the same arm speed on most changeups','Changeup finishes in the lower half of the zone rather than sailing','Can throw it for a strike behind two fastballs'],'3 sets of 5 pitches, roughly 15 changeups','Back to flat-ground catch play with the changeup grip until the arm speed holds, then return to the mound.','Let the hitter swing, then let the catcher call the sequence without telling the pitcher what is coming.',ARRAY['changeup off the mound','arm speed consistency','pitch sequencing','release out front'],ARRAY['slowing the arm down on the changeup','changeup only works on flat ground','telegraphing the pitch'],ARRAY['pitching','changeup','sequencing','advanced'],'11-14',11,14,'Advanced',4,'both',ARRAY['baseballs','mound','catcher''s gear','batting helmet'],'Outdoor','Medium',true,15,'partner',ARRAY['isolate','progress','game_application'],2,NULL,3,1,true,'medium','medium','medium','none','medium','high','low',false,'activity','approved','benchcoach_original',NULL),

-- Catching Development, stage 1. All six catching rows assumed a catcher
-- already crouched.
('43aa8d15-da92-5e38-8d99-829b157ef0f6','Catcher''s Stance — Set Up to Receive','Catching','catcher''s receiving stance','setting up before the pitch','The stance on its own, before any pitch is worth receiving. The catcher sets up in full gear: feet a little wider than the shoulders, weight on the inside of the feet rather than back on the heels, throwing hand behind the back or loosely behind the mitt, glove out in front where the pitcher can see it. Hold it for a five-count. Reset. Do it again. Then take one easy toss from short range and reset. Everything else a catcher does starts from this position and the library had six catching drills, every one of which assumed a player already in it.','Cue "big target, small target". Give the pitcher the biggest glove you can early in the count, then a smaller one when you want a specific pitch — but the body stays the same either way. The throwing hand goes behind the back for a young catcher with nobody on base; the tucked-behind-the-mitt version is for later, and it is worth a broken finger to get wrong. Watch the heels: a catcher sitting back on them cannot get out of the stance to block or throw, and that is the fault that persists for a season if nobody names it. Two knees down is the right starting stance at this age. The one-knee setup is a ceiling, not a starting point.','Full gear including a mask and a cup, every time, even with no pitcher. A catcher without a mask is one bad toss from a serious injury and there is no version of this drill worth that.',ARRAY['Holds the stance for five seconds without rocking back','Weight stays on the inside of the feet','Throwing hand is protected on every rep'],'8-10 set-ups, a few with an easy toss','Set up without gear on, in front of a mirror or a phone camera, so the player can see the position they cannot feel.','Add a full round of tosses, then move to the receiving foundations drill where the glove starts doing something.',ARRAY['catcher''s receiving stance','weight distribution','target presentation','throwing hand protection'],ARRAY['sitting back on the heels','throwing hand exposed','glove held too close to the body'],ARRAY['catching','stance','setup','beginner'],'8-14',8,14,'Beginner',1,'both',ARRAY['catcher''s gear','catcher''s mitt','baseballs or soft training balls'],'Both','Small',false,8,'station',ARRAY['teach','repetition'],1,NULL,3,1,true,'medium','low','low','none','low','none','low',true,'activity','approved','benchcoach_original',NULL)

ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Taxonomy mappings.
--
-- Seven mappings for six drills. Deliberately few. 2F.7 asks for honest
-- mappings rather than a higher count, and a drill mapped to a problem it only
-- half answers makes the retrieval worse for the problem, not better for the
-- drill.
--
-- Two of these are acknowledged half-fits and are recorded as such in the gap
-- audit: the grip station maps to rolling-over because rolled knuckles limit
-- the wrist hinge, and the routine outfield ground ball maps to
-- poor-fielding-footwork, which is an infield-framed slug doing double duty.
-- No new problem slug is proposed here; that is a taxonomy decision and it is
-- not being made as a side effect of adding six drills.
-- ---------------------------------------------------------------------------
INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES
  ('2578d426-2185-5a9c-a8bb-cb56c12e6c65','rolling-over',5,true),
  ('31f82124-8e4f-59dc-8784-f76352941194','poor-fielding-footwork',3,true),
  ('31f82124-8e4f-59dc-8784-f76352941194','fielding-flat-footed',3,true),
  ('cef00f99-1829-5dab-aec0-73162ccdd91b','slow-first-step',1,true),
  ('93566e0d-787f-5c3c-b479-a6a9d84ddbf1','poor-fielding-footwork',4,true),
  ('20d240e9-8d9f-567f-9e87-c25a5f0b9cfb','no-changeup',2,true),
  ('43aa8d15-da92-5e38-8d99-829b157ef0f6','catcher-receiving',4,true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The bad link comes out.
--
-- Baserunning stage 1 reinforced "out of the box" with a dynamic stretching
-- routine. Removing it is the point of the stage, not a loss of coverage: two
-- rows that actually train the first step go in below.
-- ---------------------------------------------------------------------------
DELETE FROM public.development_pathway_stage_drills d
 USING public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'baserunning-development' AND s.stage_key = 'out-of-the-box'
   AND d.drill_id = 'b194ff1d-f857-47d5-911c-0bab06c6e6bc';

-- ---------------------------------------------------------------------------
-- 4. Re-ranking, where a new row should lead its stage.
--
-- Six stages get a drill that teaches the stage objective more directly than
-- what is currently in the primary slot. The incumbent is not removed; it is
-- moved to the role it actually plays.
-- ---------------------------------------------------------------------------
UPDATE public.development_pathway_stage_drills d
   SET role = 'reinforcement', rank = 1,
       rationale = 'Builds the stance the grip is taken in, and mentions the grip in one clause of its set-up. That is reinforcement for a hitter who has already been through the grip station, and it was only this stage''s primary because nothing better existed.'
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'build-the-swing' AND s.stage_key = 'grip'
   AND d.drill_id = '252404f0-38c3-481f-a18b-f7ce0262903f';

UPDATE public.development_pathway_stage_drills d SET rank = 2
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'infield-fundamentals' AND s.stage_key = 'reading-hops'
   AND d.drill_id = '2f3326af-9848-534e-9cc2-3d0f628c1162' AND d.role = 'primary';

UPDATE public.development_pathway_stage_drills d
   SET role = 'reinforcement', rank = 2
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'outfield-development' AND s.stage_key = 'ready-and-first-step'
   AND d.drill_id = '07a59bb9-1b7c-554a-a1f1-98f4af671e21';

UPDATE public.development_pathway_stage_drills d
   SET role = 'progression', rank = 1,
       rationale = 'The same ball with the game on it. Do-or-die is the progression of the routine outfield ground ball, not the introduction to it, and it was this stage''s primary only because it was the only outfield ground-ball drill in the library.'
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'outfield-development' AND s.stage_key = 'ground-ball-approach'
   AND d.drill_id = 'daea5efc-42ce-4a83-9f07-a867dd6fbddd';

UPDATE public.development_pathway_stage_drills d SET rank = 2
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'catching-development' AND s.stage_key = 'receiving-foundation'
   AND d.drill_id = '9a6f58a3-0172-47e6-b159-8eb98306f5ca' AND d.role = 'regression';

UPDATE public.development_pathway_stage_drills d SET rank = 2
  FROM public.development_pathway_stages s, public.development_pathways p
 WHERE d.stage_id = s.id AND s.pathway_id = p.id
   AND p.slug = 'baserunning-development' AND s.stage_key = 'leads'
   AND d.drill_id = 'b9bb75c7-9ed0-47ee-9d11-2de953510027' AND d.role = 'primary';

-- ---------------------------------------------------------------------------
-- 5. Stage attachments.
--
-- Two kinds in one list, and the rationale says which: the six new rows, and
-- nine drills the library already held that were attached to no stage that
-- needed them. The second kind is most of it, and it costs nothing.
--
-- Roles are not all 'primary'. A drill is primary where it teaches the stage
-- objective, regression where it is the step back, reinforcement where it adds
-- repetitions to something already taught, progression where it needs the
-- stage to have landed first.
-- ---------------------------------------------------------------------------
INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)
SELECT s.id, v.drill_id::uuid, v.role, v.rank, v.rationale
  FROM (VALUES
    -- new rows
    ('build-the-swing','grip','2578d426-2185-5a9c-a8bb-cb56c12e6c65','primary',1,
     'Written for this stage. The grip is the only subject, the rep is a pick-up rather than a swing, and the mastery signal — finds it without looking — is this stage''s objective stated exactly.'),
    ('infield-fundamentals','reading-hops','31f82124-8e4f-59dc-8784-f76352941194','primary',1,
     'The only activity in the library that makes the fielder choose a hop rather than field the one they are given. Everything else in this stage handles a hop after it has happened.'),
    ('outfield-development','ready-and-first-step','cef00f99-1829-5dab-aec0-73162ccdd91b','primary',1,
     'Starts the fielder set and sends the ball in four directions, which is what the drop-step drill cannot do and what On the Run skips by starting them already moving.'),
    ('outfield-development','ground-ball-approach','93566e0d-787f-5c3c-b479-a6a9d84ddbf1','primary',1,
     'The ball that actually reaches a youth outfield, fielded with nobody scoring. It also carries the knee-down block as its easier version, which the stage referenced and the library did not hold.'),
    ('pitching-development','second-pitch','20d240e9-8d9f-567f-9e87-c25a5f0b9cfb','progression',1,
     'Takes the changeup off flat ground and puts it in a sequence a hitter can see. It needs the catch-play version first, which is why it is a progression and not the stage primary.'),
    ('catching-development','receiving-foundation','43aa8d15-da92-5e38-8d99-829b157ef0f6','regression',1,
     'The position every other catching drill in the library assumes. When receiving falls apart, this is the thing underneath it, and until now there was nowhere to go back to.'),

    -- drills the library already held
    ('pitching-development','delivery-in-parts','69d859e5-5214-4b2d-b42f-07fcc56ff519','regression',2,
     'The same idea one level below the windup: the throw built in phases, knee then hip then full. A pitcher who cannot hold the phases of a throw is not going to hold the phases of a delivery.'),
    ('pitching-development','stride-and-landing','93cf7e08-9bd0-48c3-a344-26e092c651e7','reinforcement',1,
     'Carries stride direction in what it trains alongside the release work, so it adds stride repetitions to a stage the pitcher is already in rather than opening a new subject.'),
    ('pitching-development','front-side','ffc26e2a-7801-42b7-b610-9a996527e638','primary',2,
     'Trains the front hip locking, and it is mapped to flying-open — which is the failure this stage exists to prevent. It teaches the same objective from the hips as the glove-side drill does from the arm.'),
    ('pitching-development','release-point','77722605-74bc-44b8-9581-fdd1c7d9a4d3','reinforcement',1,
     'Mapped to inconsistent-release, which is what a wandering release point is. The shortest possible version of the stage objective, usable as a warm-up rather than a station.'),
    ('pitching-development','momentum-and-tempo','03eab7d0-7e67-4143-91e5-b8e4e783014a','reinforcement',1,
     'Trains the weight shift that momentum is made of. The rhythm drill gives the tempo; this gives the thing being moved.'),
    ('baserunning-development','out-of-the-box','ecf4c61b-0b8b-49bd-bbe5-697d42991d79','reinforcement',1,
     'Mapped to slow-first-step, which is this stage''s problem, and it gives the repetitions the single swing-and-sprint station cannot. It replaces a stretching routine that was attached here in error.'),
    ('baserunning-development','out-of-the-box','35a5e10e-9713-4887-ad07-030b421db06f','reinforcement',2,
     'Trains running through first base among its stations, which is the half of this stage that happens after the first three steps.'),
    ('baserunning-development','turns-and-angles','92366675-97a6-5d04-b3b6-5a2909ce858f','reinforcement',2,
     'Trains rounding technique and is mapped to bad-base-turns, this stage''s problem. It was attached only to the stage before this one, where the decision is the subject rather than the turn.'),
    ('baserunning-development','pop-up-slide','282be624-51e9-4a06-ab37-7646b0a3da8b','reinforcement',1,
     'Slide timing and consistent form under control, which is what a slide needs once the shape is right and the runner is trying to get up and go somewhere.'),
    ('baserunning-development','leads','4106c25c-beeb-4d11-b1aa-eb9aa85978ae','primary',1,
     'Trains the primary lead, pitcher tells and jump quality. The primary lead comes before the secondary one, so this leads the stage and the secondary-lead drill follows it.'),
    ('baserunning-development','leads','f9d5d796-ce11-4964-bc70-a3ce5f8a607f','reinforcement',1,
     'The crossover step and the reaction to the pitcher''s first move, which is the moment a lead turns into anything at all.')
  ) AS v(pathway, stage_key, drill_id, role, rank, rationale)
  JOIN public.development_pathways p ON p.slug = v.pathway
  JOIN public.development_pathway_stages s ON s.pathway_id = p.id AND s.stage_key = v.stage_key
 WHERE NOT EXISTS (
   SELECT 1 FROM public.development_pathway_stage_drills x
    WHERE x.stage_id = s.id AND x.drill_id = v.drill_id::uuid
 );

-- ---------------------------------------------------------------------------
-- 6. The stage notes that 071 makes untrue.
--
-- Six stages carry a hand-written note from Phase 2E saying a drill does not
-- exist and is deliberately not being invented. It exists now. The coverage
-- audit reads these notes before it counts anything, so leaving them would
-- pin those stages at THIN or GAP forever and hide the fact that they closed.
--
-- The outfield ground-ball note is rewritten rather than cleared, because only
-- part of it was closed: the fence carom is still missing and still deferred.
-- ---------------------------------------------------------------------------
UPDATE public.development_pathway_stages s SET notes = NULL
  FROM public.development_pathways p
 WHERE s.pathway_id = p.id AND (p.slug, s.stage_key) IN (
   ('build-the-swing', 'grip'),
   ('infield-fundamentals', 'reading-hops'),
   ('outfield-development', 'ready-and-first-step'),
   ('catching-development', 'receiving-foundation'),
   ('pitching-development', 'second-pitch')
 );

UPDATE public.development_pathway_stages s
   SET notes = 'The routine ground ball and the knee-down block are now covered by their own row, '
               'and do-or-die has moved to the progression slot it belongs in. Still missing: '
               'the ball played off a fence. That is deferred rather than forgotten — most fields '
               'these teams play on have no fence, so the leverage is low.'
  FROM public.development_pathways p
 WHERE s.pathway_id = p.id
   AND p.slug = 'outfield-development' AND s.stage_key = 'ground-ball-approach';

-- ---------------------------------------------------------------------------
-- 7. Drop the helpers used to apply 070 in parts.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pw_st(text, int, text, text, text, text, text[], text[], text, int, int, text);
DROP FUNCTION IF EXISTS public.pw_ds(text, text, uuid, text, int, text);
DROP FUNCTION IF EXISTS public.pw_ps(text, text, text);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification. Run after applying.
-- ---------------------------------------------------------------------------
-- Six new rows, all schedulable:
--   SELECT drill_name, skill_category, status, resource_kind FROM public.drill_resources
--    WHERE id IN ('2578d426-2185-5a9c-a8bb-cb56c12e6c65','31f82124-8e4f-59dc-8784-f76352941194',
--                 'cef00f99-1829-5dab-aec0-73162ccdd91b','93566e0d-787f-5c3c-b479-a6a9d84ddbf1',
--                 '20d240e9-8d9f-567f-9e87-c25a5f0b9cfb','43aa8d15-da92-5e38-8d99-829b157ef0f6');
--
-- Nothing was deleted from the library — expect 226 (220 + 6):
--   SELECT count(*) FROM public.drill_resources WHERE created_by_coach_id IS NULL;
--
-- The stretching routine is off the baserunning stage — expect 0 rows:
--   SELECT 1 FROM public.development_pathway_stage_drills d
--     JOIN public.development_pathway_stages s ON s.id = d.stage_id
--     JOIN public.development_pathways p ON p.id = s.pathway_id
--    WHERE p.slug = 'baserunning-development' AND s.stage_key = 'out-of-the-box'
--      AND d.drill_id = 'b194ff1d-f857-47d5-911c-0bab06c6e6bc';
--
-- The helpers are gone — expect 0:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('pw_st','pw_ds','pw_ps');
-- ---------------------------------------------------------------------------
