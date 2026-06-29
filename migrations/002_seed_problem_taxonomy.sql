-- ============================================================================
-- Migration 002: Seed problem_taxonomy
-- ============================================================================
-- ~35 canonical youth-baseball problems, clustered from the real free-text in
-- drill_resources.common_flaws_fixed (see docs/drill-audit.md). Each `aliases`
-- array contains both:
--   (a) plain-English phrases a coach would actually type, and
--   (b) the exact existing flaw strings (lowercased) so migration 003 can
--       auto-populate drill_problem_map by matching.
-- Idempotent: re-running updates labels/aliases in place.
-- ============================================================================

INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases) VALUES

-- ---------- HITTING ----------
('late-timing', 'Late / poor timing', 'Hitting',
 'Hitter is behind the pitch, especially on faster pitching.',
 ARRAY['poor timing','timing','late on fast pitching','late on faster pitching','late swing','behind the ball','slow bat','slow bat speed','slow bat to the zone','slow bat to zone','slow recognition','slow hands']),

('casting', 'Casting / long swing', 'Hitting',
 'Hands drift away from the body; long, loopy bat path that is late and weak.',
 ARRAY['casting','casting (getting long)','casting hands away from body','long swing','long swing path','long loopy swing','loopy swing','looping','dragging the bat','dragging barrel','dragging the barrel','barrel dragging on low pitches']),

('pulling-head', 'Pulling head / eyes off ball', 'Hitting',
 'Head and eyes leave the ball before contact.',
 ARRAY['pulling head','head pulling off','head pulling','pulling off the ball','looking away before contact','not watching the ball','not tracking the ball','losing track of ball','poor tracking','not tracking through contact']),

('lunging', 'Lunging / poor balance', 'Hitting',
 'Weight drifts forward early; hitter lunges instead of rotating in balance.',
 ARRAY['poor balance','loss of balance','drifting forward before swing','drifting / losing balance','lunging','swaying instead of rotating','leaking weight forward','leaking weight','leaking','no axis to swing around','no axis']),

('inconsistent-contact', 'Inconsistent / weak contact', 'Hitting',
 'Contact quality and location vary swing to swing.',
 ARRAY['inconsistent contact','weak contact','poor contact','inconsistent contact on off-speed','inconsistent contact direction','poor hand-eye coordination','poor hand eye coordination']),

('uppercutting', 'Uppercutting / bad swing plane', 'Hitting',
 'Swing plane does not match the pitch — big uppercut or chopping down.',
 ARRAY['uppercutting','uppercut','uppercut swing','chopping down on ball','poor swing plane','bad swing path','poor bat path','poor launch angle']),

('flying-open', 'Flying open / no load', 'Hitting',
 'No load or early shoulder opening; upper and lower body fire together.',
 ARRAY['no load','passive swing','early shoulder opening','flying open early','spinning out','no separation between upper and lower body','losing torque']),

('rolling-over', 'Rolling over / weak top hand', 'Hitting',
 'Wrists roll early, producing weak ground balls to the pull side.',
 ARRAY['rolling over','rolling over too early','weak top hand','getting around the ball']),

('stepping-in-bucket', 'Steps in the bucket', 'Hitting',
 'Front foot strides away from the plate / open instead of toward the pitcher.',
 ARRAY['stepping in the bucket','stepping out','striding across body','poor stride direction','landing open (turned out front foot)','landing open']),

('barring-arm', 'Barring front arm / disconnected', 'Hitting',
 'Front arm bars out and the swing disconnects from the body.',
 ARRAY['barring front arm','barring the front arm','disconnected swing','swinging with arms only','poor extension','no extension']),

('plate-confidence', 'Low confidence / fear at the plate', 'Hitting',
 'Hesitant or fearful in the box; reluctant to commit to a swing.',
 ARRAY['no confidence at the plate','fear of swinging','fear at the plate','fear of ball / low confidence']),

('two-strike-approach', 'Two-strike approach', 'Hitting',
 'Same aggressive swing in every count; no two-strike adjustment.',
 ARRAY['same swing in all counts','poor two-strike discipline','panic with two strikes','swinging at bad pitches','poor adjustment to different pitch levels']),

-- ---------- THROWING ----------
('throwing-mechanics', 'Poor throwing mechanics', 'Throwing',
 'General arm-path / sequencing breakdown; slinging or all-arm throws.',
 ARRAY['poor mechanics','poor arm path','sloppy mechanics','scarecrow arm action','arm pain / poor mechanics','poor arm preparation','throwing with only the arm','throwing with only arm','throwing with entire arm not forearm/wrist','slinging the ball','sling arm action']),

('short-arming', 'Short-arming', 'Throwing',
 'Arm does not extend through release; throw is short and tense.',
 ARRAY['short-arming','short arming','stopping arm short','stopping short','no arm extension','no arm extension through release']),

('no-follow-through-throw', 'No follow-through (throwing)', 'Throwing',
 'Arm stops at release instead of finishing across the body.',
 ARRAY['no follow-through','weak follow-through','incomplete follow-through','short follow-through','improper follow-through']),

('low-arm-slot', 'Low arm slot / sidearm', 'Throwing',
 'Elbow drops below the shoulder; ball comes out sidearm.',
 ARRAY['low arm slot','sidearm throws','throwing sideways','dropping elbow below shoulder','elbow dropping below shoulder','inconsistent arm slot']),

('weak-throws', 'Weak throws / arm strength', 'Throwing',
 'Low velocity and carry; no momentum into the throw.',
 ARRAY['weak throws','weak velocity','no momentum','no momentum into ball','weak crow hop']),

('inaccurate-throws', 'Inaccurate throws', 'Throwing',
 'Throws miss the target; no step or alignment to the target.',
 ARRAY['inaccurate throwing','inaccurate throws','poor accuracy','throwing off-line','inaccuracy','no specific target focus','no target focus','no step','not stepping toward target','no stepping toward target','throwing across body','striding across body','no alignment to target','chest not facing target']),

('no-wrist-snap', 'No wrist snap', 'Throwing',
 'No wrist/finger snap at release; ball lacks backspin.',
 ARRAY['no wrist snap','poor wrist snap']),

-- ---------- FIELDING (INFIELD) ----------
('slow-transfer', 'Slow transfer / exchange', 'Fielding (Infield)',
 'Slow glove-to-hand exchange and footwork from catch to throw.',
 ARRAY['slow transfer','slow transitions','slow transitions from catch to throw','slow ball transfer','slow transfers','slow hands on transfer','slow hands','slow release','extra steps before throw','fumbling','poor transfer speed','poor transition rhythm','poor fielding-to-throw transition','poor throwing after fielding']),

('fielding-flat-footed', 'Fields flat-footed / not in front', 'Fielding (Infield)',
 'Fields standing up / flat-footed instead of low and in front.',
 ARRAY['fielding flat-footed','standing flat-footed','flat-footed throws','not getting in front of the ball','standing up instead of dropping','poor fielding position']),

('poor-fielding-footwork', 'Poor fielding footwork / approach', 'Fielding (Infield)',
 'Bad approach angles, leaving holes, stabbing at the ball.',
 ARRAY['poor footwork','leaving holes between legs','inconsistent fielding mechanics','poor approach angles','stabbing at the ball','stabbing at ball','deflecting balls too far','poor body angle']),

-- ---------- FIELDING (FLY BALLS) ----------
('backpedaling-flyballs', 'Backpedals / bad routes on fly balls', 'Fielding (Fly Balls)',
 'Backpedals instead of turning and running; inefficient routes.',
 ARRAY['backpedaling instead of turning and running','backpedaling on fly balls','poor route efficiency','lazy routes to fly balls','poor positioning under fly balls','freezing on balls hit overhead','poor route efficiency','lazy routes']),

('fear-fly-balls', 'Fear of fly balls', 'Fielding (Fly Balls)',
 'Tentative or fearful tracking and catching of fly balls overhead.',
 ARRAY['fear of fly balls']),

-- ---------- CATCHING (receiving a thrown/tossed ball) ----------
('fear-of-ball', 'Fear of the ball / turns away', 'Catching',
 'Flinches, turns away, or closes eyes on an incoming ball.',
 ARRAY['fear of the ball','fear of ball','fear of ball / low confidence','turning away','fear of throwing','fear of catching']),

('one-hand-catching', 'One-handed / stabs at the ball', 'Catching',
 'Catches one-handed or stabs instead of using two hands with soft give.',
 ARRAY['one-hand catching','no two-hand catch','stabbing at the ball','stabbing at ball','dropping glove','poor hand positioning','wrong glove orientation','wrong glove position','only knowing one glove position']),

-- ---------- BASERUNNING ----------
('bad-base-turns', 'Bad base-running turns', 'Baserunning',
 'Wide, slow turns; does not hit the inside of the bag.',
 ARRAY['running past bases without proper turns','wide inefficient turns','wide/slow base turns','not hitting inside of bag','slowing down before base','running in foul territory']),

('base-awareness', 'Poor base awareness / hesitation', 'Baserunning',
 'Hesitates, does not know when to advance or take a lead.',
 ARRAY['poor base awareness','not knowing when to advance','hesitation on the bases','forgetting to take a lead']),

('slow-first-step', 'Slow first step / acceleration', 'Baserunning',
 'Slow to accelerate out of the box or off the base.',
 ARRAY['slow first step','poor acceleration','poor body control when changing direction']),

-- ---------- PITCHING ----------
('rushing-delivery', 'Rushing the delivery', 'Pitching',
 'Rushes through the balance point; lower and upper half out of sync.',
 ARRAY['rushing','rushing delivery','rushing the delivery','rushing through balance point','skipping phases of delivery','static delivery','pitching from a standstill']),

('balance-leg-lift', 'Poor balance at leg lift / falls off', 'Pitching',
 'Wobbles at leg lift or falls off to the side of the mound.',
 ARRAY['poor balance on one leg','poor balance at leg lift','wobbly delivery','falling off to one side','falling off the mound','falling off to the side','no balance point']),

('inconsistent-release', 'Inconsistent release / command', 'Pitching',
 'Release point and command vary pitch to pitch.',
 ARRAY['inconsistent release point','releasing ball too early','poor command','no backspin on fastball','poor spin','poor backspin','slowing arm at release']),

('no-hip-lead', 'No hip lead / separation', 'Pitching',
 'Hips and shoulders rotate together; no separation or hip lead.',
 ARRAY['no hip lead','no hip engagement','hip stall','hips and shoulders rotating together (no separation)','early opening','losing front side']),

('inconsistent-stride', 'Inconsistent stride / lands off-line', 'Pitching',
 'Stride length/direction varies; lands off-line to the target.',
 ARRAY['striding across body (arm-side)','striding too far open (glove-side)','inconsistent stride length','landing off-line','inconsistent stride']),

-- ---------- ARM CARE / WARMUP ----------
('cold-arm', 'Throws without warming up / arm soreness', 'Arm Care',
 'Throws cold; stiffness or soreness from inadequate warm-up.',
 ARRAY['cold arm throwing','throwing without warming up','skipping warm-up','skipping warm-up progression','arm soreness from inadequate warm-up','stiff shoulders','tight shoulders','poor range of motion','restricted range of motion','cold throwing','arm tightness','cold muscles','insufficient shoulder mobility'])

ON CONFLICT (slug) DO UPDATE
  SET label = EXCLUDED.label,
      skill_category = EXCLUDED.skill_category,
      description = EXCLUDED.description,
      aliases = EXCLUDED.aliases;
