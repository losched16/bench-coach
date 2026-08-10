// Six practices for the six nights the generator is not the better answer.
//
// The generator knows the roster, the attendance, the active priorities, last
// practice's recap, the coach's favorites and what is in the car. A static
// template knows none of that, so for "work on hitting" it loses badly and
// should.
//
// It wins in four places:
//
//   - The first night. A brand-new coach has logged nothing, so the loop
//     context is empty and the generated plan is nearly as generic as this one
//     — but slower, and it costs tokens.
//   - When the model is down. There was no escape hatch the day the rebuild
//     504'd.
//   - Someone deciding whether to pay, who wants to see a plan without waiting
//     thirty seconds.
//   - Occasions. "First practice of the season" and "game-day warm-up" are
//     conventional. Being right beats being novel, and the model has no edge.
//
// So these are OCCASIONS, never skills. Skills are the generator's job.
//
// ---------------------------------------------------------------------------
// Two deliberate constraints
// ---------------------------------------------------------------------------
//
// NO youtube_video_id ANYWHERE. Not an oversight. Half the drill library is
// currently several drills sharing one video, and that is being audited — a
// template hard-wired to a video id that gets retired becomes a dead link
// nobody notices. Blocks name their drill and PracticeBlock's lookup matches
// it against the library at render time, so a video appears when one exists
// and simply does not when it doesn't. Self-healing, and it survives the audit
// whatever it decides.
//
// STATIC DATA, NOT DATABASE ROWS. These are identical for every coach, so
// there is no reason for them to be rows anybody has to migrate. In the repo
// they are reviewable, diffable and impossible to have "not installed yet".

import { PlanBlock } from './practicePlan'

export interface TemplateSeed {
  duration: number
  // Must be values from FOCUS_OPTIONS in the practice builder, or they arrive
  // at a chip that does not exist and silently do nothing.
  focus: string[]
  objective: string
  equipment: string[]
  // Goes into the builder's "Anything specific?" box, which the generator
  // treats as outranking everything else it knows.
  specifics: string
}

export interface PracticeTemplate {
  id: string
  title: string
  description: string
  // 'all' means every age — the occasion does not change with the birthday.
  age_group: string
  duration_minutes: number
  occasion: string
  skill_level: string
  tags: string[]
  content: {
    objective: string
    coaching_points: string[]
    coach_notes: string
    flags: string[]
    blocks: PlanBlock[]
  }
  seed: TemplateSeed
}

export const OCCASIONS = [
  { value: 'all', label: 'Every occasion' },
  { value: 'season-start', label: 'Start of season' },
  { value: 'game-day', label: 'Game day' },
  { value: 'indoors', label: 'Rained out / indoors' },
  { value: 'short', label: 'Short on time' },
  { value: 'evaluation', label: 'Evaluation day' },
  { value: 'tournament', label: 'Before a tournament' },
]

export const PRACTICE_TEMPLATES: PracticeTemplate[] = [
  // -------------------------------------------------------------------------
  {
    id: 'first-practice',
    title: 'First Practice of the Season',
    description:
      'The one that decides whether they come back. Names, a baseline you can ' +
      'coach from all season, and everybody touching a ball in the first ten minutes.',
    age_group: 'all',
    duration_minutes: 75,
    occasion: 'season-start',
    skill_level: 'Any',
    tags: ['first practice', 'names', 'baseline', 'culture'],
    content: {
      objective:
        'Every kid throws, catches, and swings in the first half hour, and leaves ' +
        'knowing three teammates by name.',
      coaching_points: [
        'Use a kid\'s name every single time you speak to them — that is the whole job tonight.',
        'Step with your glove-side foot straight at your target.',
        'Two hands on everything you catch until it is in your throwing hand.',
      ],
      coach_notes:
        'Resist the urge to teach mechanics tonight. You do not yet know who can do what, ' +
        'and a first practice that feels like a lesson is how you lose the kid who was ' +
        'already unsure. The two assessment blocks are not tests — nobody is told they are ' +
        'being watched — they are so that next week you can plan for the team you actually ' +
        'have instead of the one you assumed. If you lose fifteen minutes to late arrivals, ' +
        'cut the Outfield Introduction and keep the game: they will remember how practice ' +
        'ended, not what was in the middle.',
      flags: [
        'Parents will linger on the first night. Give them a job or give them a leaving ' +
        'time in the first two minutes — otherwise you are coaching an audience.',
        'You do not know these arms yet. Nobody throws hard tonight, nobody throws long, ' +
        'and no pitching. A sore arm in week one costs you a month.',
        'If you are the only adult with more than twelve kids, run the two assessment ' +
        'blocks as one line rather than two stations — you cannot watch two places, and ' +
        'unwatched kids on night one is how the season\'s behaviour gets set.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Name Game Catch',
          minutes: 12,
          description:
            'Warm the arms up and learn the roster at the same time, so neither costs you a separate block.',
          setup:
            'Big circle, kids about 10 feet apart, everyone with a glove. You stand in the middle ' +
            'with one ball. No bucket out yet — one ball keeps every head up.',
          detailed_instructions:
            '1. (2 min) Circle up. Go around once: each kid says their name and one thing they like ' +
            'that is not baseball. You repeat each name back.\n' +
            '2. (3 min) You start with the ball. Say a kid\'s name, then toss underhand to them. ' +
            'They say another kid\'s name, then toss. Nobody receives twice until everyone has.\n' +
            '3. (3 min) Same game, overhand now, still soft, still ten feet.\n' +
            '4. (4 min) Break into pairs. Ten throws each at 15 feet, ten more at 25 feet. ' +
            'Nobody backs up past 25 tonight.',
          equipment: ['Baseballs (1 to start, then 1 per pair)', 'Gloves'],
          coaching_cues: [
            'Say the name first, then throw — they need a second to find you.',
            'Two hands. Catch it and cover it.',
            'Step at your target with your front foot.',
            'Soft hands — let the ball come to you, do not stab at it.',
          ],
          common_mistakes: [
            'Kids throw before saying the name — restart that pair, the point is the name.',
            'The good arm starts showing off at 25 feet — cap the distance out loud, for everybody, ' +
            'not just for them.',
            'The nervous kid stands slightly outside the circle — put yourself next to them and ' +
            'be their partner for round one.',
          ],
          drill_variations:
            'Easier: everybody stays underhand the whole block. Harder: after the name, add ' +
            '"and one thing you want to get better at" — you will get your season\'s coaching list for free.',
          success_indicators: [
            'Kids are using each other\'s names without being prompted by round three.',
            'Nobody is standing with their arms folded.',
          ],
          watch_for:
            'The kid who turns their shoulder or closes their eyes as the ball arrives. That is fear, ' +
            'not technique, and it will not fix itself. Do not call it out — just move them closer to ' +
            'their partner for the rest of the night, and put them on soft balls next practice.',
        },
        {
          type: 'drill',
          title: 'Ground Ball Baseline',
          minutes: 18,
          description:
            'Roll everybody the same twelve ground balls so you know, honestly, where the infield stands.',
          setup:
            'Two lines facing you, about 30 feet away, cones marking where they stand. You have a bucket ' +
            'of 15 balls and roll by hand — no bat tonight, you want them identical, not impressive.',
          detailed_instructions:
            '1. (2 min) Show the ready position once: feet wider than shoulders, hands out front, weight ' +
            'on the balls of the feet. No lecture — show it, do not explain it.\n' +
            '2. (6 min) Round 1: six slow rollers each, straight at them. They field it and jog it back ' +
            'to the bucket. No throwing yet.\n' +
            '3. (6 min) Round 2: six more, one step to their left or right. Still no throw.\n' +
            '4. (4 min) Round 3: field and throw to a partner standing 20 feet away. Six each.',
          equipment: ['Baseballs (15+)', 'Cones (4)', 'Gloves'],
          coaching_cues: [
            'Glove on the ground before the ball gets there — it is easier to come up than to go down.',
            'Two hands: glove low, throwing hand on top like an alligator mouth.',
            'Feet first, hands second — move to the ball, do not reach for it.',
            'Charge it. The ball is not going to come to you.',
          ],
          common_mistakes: [
            'Fields with the glove sideways — put a cone down and have them touch it with the glove ' +
            'before each rep so the glove starts low.',
            'Backs up as the ball comes — stand behind them for two reps so backing up is not an option.',
            'One hand only, glove stabbing down — go back to no-throw rounds and make the second ' +
            'hand the whole point.',
          ],
          drill_variations:
            'Easier: tennis balls, and roll from 20 feet. Harder: two balls rolled a second apart so ' +
            'they have to reset and go again.',
          success_indicators: [
            'Glove reaches the ground before the ball arrives on most reps.',
            'You can name, without writing it down, the three kids who need the most infield work.',
          ],
          watch_for:
            'Not whether they field it — whether their glove goes DOWN or their body goes BACK. Everything ' +
            'else is coachable in a week. Backing away from a rolled ball at 30 feet is the thing you build ' +
            'the next month around, and it is invisible if you are only counting clean catches.',
        },
        {
          type: 'drill',
          title: 'Tee and Toss Baseline',
          minutes: 18,
          description:
            'Ten swings each off a tee, ten off soft toss, no instruction. You are watching, not fixing.',
          setup:
            'Two stations at least 20 feet apart and facing away from each other. Station A: tee, net or ' +
            'fence, bucket. Station B: you kneel to the side at 45 degrees, tossing underhand into the same ' +
            'net. Helmets on at both.',
          detailed_instructions:
            '1. (2 min) Split the group in half. Half at the tee, half at soft toss.\n' +
            '2. (7 min) Ten swings each at your station. The kids not swinging are the shaggers — they ' +
            'have a job, which is how you stop the standing around.\n' +
            '3. (2 min) Swap stations.\n' +
            '4. (7 min) Ten swings each at the other station.',
          equipment: ['Tee', 'Bats', 'Helmets', 'Baseballs (15+)', 'Net or fence'],
          coaching_cues: [
            'Knock the tee over on the follow-through if you have to — swing through, not at.',
            'Chin to the front shoulder at the start, chin to the back shoulder at the finish.',
            'Squish the bug — back heel comes up and turns.',
            'Both hands stay on the bat until the ball is gone.',
          ],
          common_mistakes: [
            'Stops the bat at the ball — have them hit three in a row trying to make the loudest noise, ' +
            'which fixes it without a single word about extension.',
            'Steps away from the plate as they swing — put a bat on the ground behind their back foot ' +
            'as a marker they can feel.',
            'Head pulls off to see where it went — "tell me the colour of the tee after you swing" beats ' +
            '"keep your head down" every time.',
          ],
          drill_variations:
            'Easier: wiffle balls off the tee, and shorten the bat by choking up two inches. Harder: ' +
            'call out "low" or "high" before each toss so they have to adjust.',
          success_indicators: [
            'Every kid gets twenty swings, and nobody waited more than a minute between them.',
            'You have a clear picture of who has swung a bat before and who has not.',
          ],
          watch_for:
            'Bat speed, not contact. A kid who swings hard and misses is a much easier project than one ' +
            'who taps at it and makes contact — you can teach a big swing where to go, but you cannot ' +
            'give a careful swing power. Note who swings hard. That is your list.',
        },
        {
          type: 'game',
          title: 'Four Corners Relay Race',
          minutes: 14,
          description:
            'A real competition with a winner, so the first practice ends the way you want every practice to end.',
          setup:
            'Two even teams. Four cones in a square, about 45 feet a side. One ball per team. Coach in the middle ' +
            'as the judge, and be an obviously biased, loud, funny judge.',
          detailed_instructions:
            '1. (2 min) Explain: the ball goes around the square, cone to cone, thrown not carried. Drop it ' +
            'and you go back to the cone you threw from. First team to get the ball around twice wins the round.\n' +
            '2. (3 min) Round 1. Let the chaos happen — do not coach through it.\n' +
            '3. (3 min) Round 2. One rule added: you must catch with two hands or the throw does not count.\n' +
            '4. (3 min) Round 3. Losing team picks the losing team\'s handicap for the winners — they will pick ' +
            'something ridiculous, which is the point.\n' +
            '5. (3 min) Final round, everybody in. Winners pick the team chant.',
          equipment: ['Baseballs (2)', 'Cones (8)', 'Gloves'],
          coaching_cues: [
            'Show your partner a target — glove up where you want it.',
            'Catch it before you throw it. Rushing the catch is what drops it.',
            'Call the name of the kid you are throwing to.',
          ],
          common_mistakes: [
            'Kids throw before their teammate is looking — pause the round once and make the rule ' +
            '"eyes first" out loud.',
            'The competitive kid throws too hard and the round collapses — make the handicap "you throw ' +
            'underhand" and let the team enforce it.',
          ],
          drill_variations:
            'Easier: roll the ball between cones instead of throwing. Harder: shrink the square to 30 feet ' +
            'so the throws come faster.',
          success_indicators: [
            'They are shouting each other\'s names without you telling them to.',
            'Somebody asks if you can play it again next practice.',
          ],
          watch_for:
            'Who organises. Every group has one kid who starts telling the others where to stand — that is your ' +
            'catcher or your shortstop, and the first practice is the easiest place in the whole season to spot them.',
        },
        {
          type: 'cooldown',
          title: 'Circle Up and Set the Season',
          minutes: 13,
          description:
            'Three rules, one thing you noticed about each kid, and what to bring next time.',
          setup: 'Knee-height circle, everybody sitting, gloves off, water out. Parents welcome in for this bit.',
          detailed_instructions:
            '1. (4 min) Easy arm stretches — cross-body pull, overhead triceps, wrist circles. Twenty seconds each.\n' +
            '2. (3 min) Your three rules for the season. Three, not ten, and say them in kid words. ' +
            '"We run on and off the field. We cheer for whoever is up. We do not throw the bat."\n' +
            '3. (4 min) Go around the circle and say ONE specific thing you saw each kid do well tonight. ' +
            'Not "good job" — "you charged that ground ball instead of waiting for it."\n' +
            '4. (2 min) What to bring next time, when to be there, and one thing to try at home.',
          equipment: ['Water'],
          coaching_cues: [
            'Use the name, then the specific thing. Nothing general.',
            'Say the three rules the same way every practice from here on.',
          ],
          common_mistakes: [
            'Running long — thirteen minutes of sitting still is already the limit at this age, and a ' +
            'first practice that overruns is the first thing a parent remembers.',
            'Praising results instead of actions — "you got a hit" teaches nothing, "you kept both hands ' +
            'on the bat all the way through" teaches the thing you want again.',
          ],
          drill_variations:
            'Easier at 6U-8U: cut to two rules and go around the circle faster. Harder at 12U: ask each ' +
            'kid for one thing they want to be better at by the last game, and write them down.',
          success_indicators: [
            'Every kid heard their own name attached to something specific.',
            'Parents heard the three rules, so they can back you up.',
          ],
          watch_for:
            'The kid who does not look up when you say their name. Note it. That is next practice\'s ' +
            'first conversation, and it is much cheaper to have in week one than in week six.',
        },
      ],
    },
    seed: {
      duration: 75,
      focus: ['throwing', 'catching', 'infield', 'hitting'],
      objective:
        'Every kid throws, catches and swings in the first half hour, and leaves knowing three teammates by name.',
      equipment: ['Baseballs', 'Bats', 'Helmets', 'Cones', 'Gloves', 'Tee', 'Water'],
      specifics:
        'This is our FIRST practice of the season. I do not know these kids yet — I do not know who can ' +
        'throw, catch or hit. Build it so I am assessing without anybody feeling assessed, keep throwing ' +
        'volume low because nobody is arm-ready, spend real time on names, and finish with a competitive ' +
        'game they will want to come back for. No pitching, no long toss, no mechanics teaching.',
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'game-day-warmup',
    title: 'Game-Day Warm-Up',
    description:
      'Thirty minutes from the car to first pitch. Arms ready, feet awake, and nothing new taught.',
    age_group: 'all',
    duration_minutes: 30,
    occasion: 'game-day',
    skill_level: 'Any',
    tags: ['game day', 'warm-up', 'arm care', 'pre-game'],
    content: {
      objective:
        'Every arm is loose and every kid has taken a live-speed rep before the first pitch — and nobody ' +
        'has been given anything new to think about.',
      coaching_points: [
        'Nothing gets fixed today. If it is broken, it is Tuesday\'s job.',
        'Loud and early on every fly ball and every cutoff — game noise starts in warm-ups.',
        'Everything at game speed or it is not a warm-up, it is standing around.',
      ],
      coach_notes:
        'The single biggest mistake in a pre-game is coaching. A kid who arrives fine and gets told about ' +
        'their hands in the last ten minutes now has something to think about in the box, which is the one ' +
        'thing you do not want. Say nothing technical after the throwing block. If you are tight on time, ' +
        'cut Infield/Outfield — the arms are what matters, and a team that has not taken infield can still ' +
        'play. A team with cold arms cannot.',
      flags: [
        'Watch the clock, not the plan. Work backwards from first pitch and start the throwing block 25 ' +
        'minutes before it, whatever else has not happened.',
        'Your starting pitcher is on a different schedule from the team — they should be finishing their ' +
        'bullpen as the team starts infield, not throwing with everybody else.',
        'If it is under 55 degrees, add three minutes to the throwing progression and start closer. Cold ' +
        'arms in the first inning is how you lose a pitcher for two weeks.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Dynamic Movement Line',
          minutes: 6,
          description: 'Get the body moving before anything gets thrown. No static stretching.',
          setup: 'Foul line to the outfield grass, roughly 30 yards. Whole team on the line, spread out.',
          detailed_instructions:
            '1. (1 min) Jog down and back, easy.\n' +
            '2. (1 min) High knees down, butt kicks back.\n' +
            '3. (1 min) Side shuffle down facing one way, back facing the other.\n' +
            '4. (1 min) Carioca down and back.\n' +
            '5. (1 min) Arm circles: ten small forward, ten small back, ten big each way.\n' +
            '6. (1 min) Two build-up sprints at about 80 percent.',
          equipment: [],
          coaching_cues: [
            'Chest up, eyes forward.',
            'Build up — the last sprint is the fastest one, not the first.',
          ],
          common_mistakes: [
            'Static stretching before the body is warm — save the holds for after the game.',
            'Half-speed jogging that never builds — one loud "last one is the fast one" fixes it.',
          ],
          drill_variations:
            'Easier at 6U-8U: cut carioca, add a fun follow-the-leader lap. Harder at 12U: finish with ' +
            'two 20-yard sprints out of a baserunning stance.',
          success_indicators: ['Everybody is breathing harder and nobody is sitting down.'],
          watch_for:
            'The kid who arrived five minutes ago and joined at step four. They are not warm and they will ' +
            'be the first arm to hurt. Send them back to step one on their own rather than letting them ' +
            'catch up with the group.',
        },
        {
          type: 'warmup',
          title: 'Throwing Progression',
          minutes: 9,
          description:
            'Short to long, on a clock. This is the block that actually protects the team.',
          setup:
            'Pairs on a line, all facing the same way so no throw crosses another. Start at 15 feet.',
          detailed_instructions:
            '1. (2 min) 15 feet, both on their throwing-side knee. Ten throws each. Wrist snap only.\n' +
            '2. (2 min) 25 feet, standing, feet square to partner. Ten each. Elbow above the shoulder.\n' +
            '3. (2 min) 45 feet, full stride, crow hop. Ten each.\n' +
            '4. (2 min) 60-90 feet depending on age. Eight each, on a line, no rainbows.\n' +
            '5. (1 min) Walk back in to 45 feet. Ten quick, flat throws to finish. Do not end long.',
          equipment: ['Baseballs (1 per pair)', 'Gloves'],
          coaching_cues: [
            'Point your glove at your partner, then pull it to your chest.',
            'Fingers on top of the ball, four seams if you can find them.',
            'Throw it on a line, not over them.',
            'Back off if anything pinches — tell me, do not push through it.',
          ],
          common_mistakes: [
            'Skipping to the long distance because they feel good — hold the group at each stage on your count.',
            'Finishing the block at max distance, which leaves the arm stretched out — the walk-in step ' +
            'is not optional.',
            'Sidearm creeping in as they tire — back that pair up ten feet closer, not further.',
          ],
          drill_variations:
            'Easier: cut the long stage entirely and add a minute to 45 feet. Harder at 12U: add a ' +
            'four-throw "compete" round for accuracy at 90 feet.',
          success_indicators: [
            'Throws are flat and on a line by stage four.',
            'Nobody is shaking out an arm.',
          ],
          watch_for:
            'The pair that has quietly backed up further than everyone else. It always happens, it always ' +
            'involves your two best arms, and it is where pre-game shoulder soreness comes from. Move them ' +
            'back in without making it a telling-off.',
        },
        {
          type: 'drill',
          title: 'Infield / Outfield',
          minutes: 8,
          description:
            'Everyone takes game-speed reps at the position they are actually playing today.',
          setup:
            'Positions as written on today\'s lineup card. You hit fungo from the plate, one coach or parent ' +
            'at first, a bucket at the plate.',
          detailed_instructions:
            '1. (2 min) Outfield first: two fly balls and one ground ball each, thrown to the cutoff.\n' +
            '2. (3 min) Infield: two ground balls each, throw across to first.\n' +
            '3. (2 min) Round two of infield: one ground ball each, throw to second for the force.\n' +
            '4. (1 min) Last one in at each position, catcher receives and throws down to second.',
          equipment: ['Baseballs (15+)', 'Bats', 'Gloves', "Catcher's gear"],
          coaching_cues: [
            'Call it loud and call it early.',
            'Cutoff man, get out there and give them a target.',
            'Through the bag at first, do not stop on it.',
          ],
          common_mistakes: [
            'Kids taking reps at a position they are not playing today — the point is the position they ' +
            'will stand in during the first inning.',
            'Coaching mechanics here — resist it, note it for Tuesday.',
          ],
          drill_variations:
            'Easier at 6U-8U: skip the throw across and just field and hold. Harder: add a runner so the ' +
            'infielders have a real clock.',
          success_indicators: [
            'Every fielder has caught at least one ball cleanly at their real position.',
            'The outfield is talking.',
          ],
          watch_for:
            'Whether the throws to first are on a line or bouncing. If three infielders in a row are ' +
            'short-hopping it, they are not warm enough — go back to the throwing block for two minutes ' +
            'rather than starting a game with arms that are not ready.',
        },
        {
          type: 'drill',
          title: 'Bat Speed and Timing',
          minutes: 5,
          description:
            'Enough swings to be loose, not enough to be tired, and no swing thoughts.',
          setup:
            'Off to the side, away from the field. Coach on a knee at 45 degrees with a screen or a bucket ' +
            'to sit behind. Net or fence.',
          detailed_instructions:
            '1. (1 min) Every kid takes ten dry swings, building from half to full speed.\n' +
            '2. (4 min) Rapid soft toss: eight swings each, one after another, no resetting between. Rotate ' +
            'straight through the lineup order so they are also rehearsing who is up after whom.',
          equipment: ['Bats', 'Helmets', 'Baseballs (15+)', 'Net or fence', 'L-screen'],
          coaching_cues: [
            'See it, hit it. Nothing else today.',
            'Finish the swing — all the way through.',
          ],
          common_mistakes: [
            'A coach giving one last mechanical fix — this is the single most damaging thing you can do ' +
            'in the ten minutes before a game.',
            'Too many swings, so the good hitters arrive at the plate already tired.',
          ],
          drill_variations:
            'Easier: tee instead of toss. Harder: mix one changeup speed into the toss so the timing is live.',
          success_indicators: ['Swings are full speed and loose. Nobody is thinking.'],
          watch_for:
            'The kid who is trying to fix something on their own between swings. Stop them — "you look ' +
            'great, go get one" is more useful in this block than anything true you could tell them about ' +
            'their hands.',
        },
        {
          type: 'cooldown',
          title: 'Dugout Huddle',
          minutes: 2,
          description: 'Lineup, one job each, and the thing you want to see today.',
          setup: 'Dugout, everybody in, one time.',
          detailed_instructions:
            '1. (1 min) Read the lineup and positions once, clearly. Post the card where they can see it.\n' +
            '2. (1 min) One team goal for today — one, and make it a behaviour, not a result. ' +
            '"We are loud on every ball in the air." Then break.',
          equipment: [],
          coaching_cues: [
            'One goal. Say it, and then hold them to that one all game.',
          ],
          common_mistakes: [
            'A long speech. Two minutes, then they play.',
            'Making the goal a result ("let\'s win") instead of something they control.',
          ],
          drill_variations: 'Easier: just the lineup and the break. Harder: let a player name the goal.',
          success_indicators: ['Every kid knows where they are standing in the first inning.'],
          watch_for:
            'Whether the kids not in the starting lineup heard a plan for themselves. Tell them the inning ' +
            'they are going in, now, in front of everybody. It is the difference between a sub and a spare.',
        },
      ],
    },
    seed: {
      duration: 30,
      focus: ['throwing', 'catching', 'hitting'],
      objective:
        'Every arm is loose and every kid has taken a live-speed rep before first pitch — and nobody has ' +
        'been given anything new to think about.',
      equipment: ['Baseballs', 'Bats', 'Helmets', 'Gloves', "Catcher's gear", 'L-screen', 'Water'],
      specifics:
        'This is a GAME DAY warm-up, not a practice. 30 minutes, ending at first pitch. Teach nothing new ' +
        '— no mechanics, no corrections, nothing to think about in the box. Priority order: arms ready, ' +
        'feet moving, a few live-speed swings, then the lineup. Everything at game speed. Include the ' +
        'pitcher and catcher on their own schedule.',
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'indoor-rainout',
    title: 'Rained Out — Indoors, Small Space',
    description:
      'A gym, a garage or a batting cage hallway. No live balls flying, and still a real practice.',
    age_group: 'all',
    duration_minutes: 60,
    occasion: 'indoors',
    skill_level: 'Any',
    tags: ['indoor', 'rain', 'gym', 'small space', 'wiffle'],
    content: {
      objective:
        'Everybody leaves having fixed one thing about how they move, which is easier indoors than ' +
        'anywhere else because there is nowhere for the ball to go.',
      coaching_points: [
        'Slow is fine indoors. You are buying reps and shapes, not distance.',
        'Glove below the ball, always — small spaces are where bad habits get set.',
        'Feet before hands on everything.',
      ],
      coach_notes:
        'Indoors is the best mechanics night you will get all season, because nobody can hit it far enough ' +
        'to be distracted by where it went. Take the trade: fewer reps, much closer coaching. The whole plan ' +
        'runs on tennis or wiffle balls — the first hard baseball off a gym wall ends the practice and possibly ' +
        'the gym booking. If you lose fifteen minutes, cut the Baserunning Footwork block; it is the one that ' +
        'transfers least from a slick floor.',
      flags: [
        'Whatever the space is, it is smaller than you think once fifteen kids are in it. Walk it first and ' +
        'set your stations before anybody comes in, or you will spend ten minutes rearranging with an audience.',
        'Gym floors are slick in baseball cleats and dangerous. Trainers only, and say so in the message ' +
        'the night before, not at the door.',
        'Sound carries indoors and you will lose your voice competing with it. Agree one whistle or one clap ' +
        'pattern for "stop and listen" in the first minute.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Indoor Movement and Arm Circles',
          minutes: 8,
          description: 'Warm up without needing space to run.',
          setup: 'Everybody spread out, arms-length apart, facing you.',
          detailed_instructions:
            '1. (2 min) Jog on the spot, high knees, butt kicks, 30 seconds each with a rest.\n' +
            '2. (2 min) Lunge walk across the space and back. Then side lunges.\n' +
            '3. (2 min) Arm circles small to big, forward and back. Cross-body swings.\n' +
            '4. (2 min) Wall throws: face a wall from 6 feet, throw a tennis ball into it and catch the ' +
            'rebound with two hands. Twenty each.',
          equipment: ['Tennis balls (1 each)', 'Gloves'],
          coaching_cues: [
            'Big circles, slow — you are opening the shoulder, not racing.',
            'Two hands on the rebound, every time.',
          ],
          common_mistakes: [
            'Throwing hard into the wall — a tennis ball at six feet only needs a flick.',
            'Kids drifting into each other\'s space — reset the spacing rather than talking over it.',
          ],
          drill_variations:
            'Easier: catch the rebound off one bounce. Harder: catch it with the bare hand, alternating.',
          success_indicators: ['Everybody is warm and no ball has hit a light.'],
          watch_for:
            'Which hand goes up first on the rebound. Indoors at six feet is the clearest look you will ever ' +
            'get at whether a kid catches with two hands or stabs with one — outdoors the distance hides it.',
        },
        {
          type: 'drill',
          title: 'Tee Work Against the Net',
          minutes: 15,
          description:
            'The single highest-value indoor block. Slow, close, and you can actually see the swing.',
          setup:
            'As many tees as you have, each facing a net or a folded mat against a wall, at least 8 feet apart. ' +
            'Wiffle or soft-core balls only. Helmets on.',
          detailed_instructions:
            '1. (2 min) Set up the stations and split evenly — no more than three kids per tee.\n' +
            '2. (4 min) Round 1, ball in the middle of the plate: ten swings each, half speed, stopping at ' +
            'contact so you can check the position.\n' +
            '3. (4 min) Round 2, tee moved back and inside: ten swings each, full speed.\n' +
            '4. (5 min) Round 3, tee moved forward and outside: ten swings each, trying to hit the net on ' +
            'the opposite side.',
          equipment: ['Tee', 'Bats', 'Helmets', 'Wiffle balls (20+)', 'Net or mat'],
          coaching_cues: [
            'Hands inside the ball — the knob goes at the pitcher first.',
            'Turn the back foot, do not slide it.',
            'Chin starts on the front shoulder and finishes on the back one.',
            'Same swing for every tee position. The tee moves, you do not.',
          ],
          common_mistakes: [
            'Casting — the hands go out and around instead of down and through. Put the tee an inch closer ' +
            'to them and they will feel it immediately.',
            'Dropping the back shoulder on the low tee, which turns into an uppercut. Ask for a line drive ' +
            'into the middle of the net rather than the top.',
            'Rushing through ten swings in twenty seconds — set the pace out loud, one swing every five seconds.',
          ],
          drill_variations:
            'Easier: shorten the bat by choking up and use the middle tee position all three rounds. ' +
            'Harder: call the tee position out only after they are in their stance.',
          success_indicators: [
            'The ball leaves the bat on a line into the net, not up into it.',
            'Kids can move the tee themselves between rounds without being told the positions again.',
          ],
          watch_for:
            'The front shoulder. If it flies open before the hands start, everything else you see is a ' +
            'symptom of that and fixing anything else is wasted. On a tee, at half speed, it is obvious — ' +
            'which is exactly why indoors is the right night for it.',
        },
        {
          type: 'station',
          title: 'Short Hop and Bare Hand Stations',
          minutes: 15,
          description:
            'Two stations, close range, tennis balls. Hands get better indoors faster than outdoors.',
          setup:
            'Station A: pairs, kneeling, 10 feet apart. Station B: pairs standing, 15 feet apart, along a wall.',
          detailed_instructions:
            '1. (1 min) Split into two groups and explain both stations once.\n' +
            '2. (6 min) Station A — Short Hops: on both knees, partner bounces a tennis ball one to two ' +
            'feet in front of them. Twenty reps each, glove only, then twenty bare-handed.\n' +
            '3. (1 min) Swap.\n' +
            '4. (7 min) Station B — Quick Hands: standing, partner rolls the ball firmly. Field it, transfer ' +
            'to the throwing hand and show it, do not throw. Twenty each, then twenty moving one step laterally.',
          equipment: ['Tennis balls (1 per pair)', 'Gloves'],
          coaching_cues: [
            'Glove out front where you can see it — not next to your leg.',
            'Give with the ball, do not fight it.',
            'Bare hand to the middle of your chest on the transfer, every time.',
            'Beat the ball there with your feet.',
          ],
          common_mistakes: [
            'Glove turns sideways or over on a short hop — kneeling removes the legs from the equation so ' +
            'the hands have nowhere to hide.',
            'Transfer happens down by the waist, which is where slow throws come from — ask for the ball ' +
            'to be shown at the chest on every rep.',
            'Partner bouncing it too hard — a short hop should be catchable, the point is the shape not the ' +
            'challenge.',
          ],
          drill_variations:
            'Easier: bigger, softer bounce and glove only. Harder at 12U: alternate a short hop and an ' +
            'in-between hop without warning.',
          success_indicators: [
            'Hands stay out in front on the majority of reps.',
            'The transfer is happening at the chest without you saying it.',
          ],
          watch_for:
            'Whether the glove goes down to the ball or the body pulls back from it. On a knee, ten feet ' +
            'away, with a tennis ball, there is nothing to be afraid of — so if a kid still flinches, that ' +
            'is real and it is worth knowing before they see a hard ground ball on grass.',
        },
        {
          type: 'drill',
          title: 'Baserunning Footwork',
          minutes: 10,
          description:
            'The turns and the first step, walked through slowly on a floor with no ball involved.',
          setup: 'Four bases or cones in a square as big as the space allows. Trainers, not cleats.',
          detailed_instructions:
            '1. (3 min) Home to first, walking: run through the bag, do not slow down before it, look right ' +
            'after you cross. Five each.\n' +
            '2. (3 min) The turn: home to first with a banana curve into the baseline, touching the inside ' +
            'corner of the bag with either foot. Five each at half speed.\n' +
            '3. (2 min) The lead-off and first step (10U+): two shuffles, back on the balls of the feet, ' +
            'crossover step. Ten each.\n' +
            '4. (2 min) Race: two lines, home to second, on the whistle. Best of three.',
          equipment: ['Bases', 'Cones'],
          coaching_cues: [
            'Run through first, do not jump at it.',
            'Hit the inside corner of the bag with whichever foot arrives.',
            'Look right after you cross — that is how you find the overthrow.',
            'First step is a crossover, not a hop.',
          ],
          common_mistakes: [
            'Slowing down two steps before the bag — put a cone five feet past first and make that the finish line.',
            'Running a straight line and then a right angle at the bag — walk the banana curve once with them.',
            'Full speed on a slick floor, which is how somebody gets hurt. Half speed until the race, and ' +
            'the race is on a whistle so it is controlled.',
          ],
          drill_variations:
            'Easier at 6U-8U: just home to first, run through, five times. Harder at 12U: add a secondary ' +
            'lead and a read step off a coach\'s arm movement.',
          success_indicators: [
            'Nobody is slowing down before the bag.',
            'The turn looks like a curve rather than a corner.',
          ],
          watch_for:
            'The head. A kid who looks down at the bag while running is the one who trips over it in a game ' +
            'and the one who never sees the ball get away. Indoors, at half speed, you can fix that in five ' +
            'reps; you will never get their attention for it during a game.',
        },
        {
          type: 'cooldown',
          title: 'Sit-Down Q&A',
          minutes: 12,
          description:
            'The rules and situations conversation you never have room for outdoors.',
          setup: 'Everybody sitting in a circle, gloves off. A whiteboard or a clipboard if you have one.',
          detailed_instructions:
            '1. (3 min) Easy stretching — cross-body, triceps, hamstrings. Twenty seconds each.\n' +
            '2. (7 min) Situations. Set one up out loud and go round the circle: "Runner on first, one out, ' +
            'ground ball to you at short — where does it go?" Do four or five. Let them argue about it.\n' +
            '3. (2 min) One thing to work on at home before next practice, said individually as they leave.',
          equipment: ['Water'],
          coaching_cues: [
            'Ask, do not tell. A kid who works out the answer keeps it.',
            'Wrong answers out loud are worth more than right answers in silence.',
          ],
          common_mistakes: [
            'Turning it into a lecture — if you are talking more than they are, it is not working.',
            'Only calling on the confident kids. Go around the circle in order so everyone gets one.',
          ],
          drill_variations:
            'Easier at 6U-8U: two situations, both about where to throw the ball. Harder at 12U: add ' +
            'count and score so the answer changes.',
          success_indicators: [
            'Kids are disagreeing with each other about where the ball goes.',
            'Somebody asks a question you have not thought about.',
          ],
          watch_for:
            'Who has never been taught the situation at all versus who knows it and cannot do it under ' +
            'pressure. Those are two completely different problems with two different fixes, and this is ' +
            'the only block all season where you can tell them apart.',
        },
      ],
    },
    seed: {
      duration: 60,
      focus: ['hitting', 'infield', 'baserunning', 'game IQ'],
      objective:
        'Everybody leaves having fixed one thing about how they move, which is easier indoors than ' +
        'anywhere else because there is nowhere for the ball to go.',
      equipment: ['Bats', 'Helmets', 'Gloves', 'Tee', 'Cones', 'Bases', 'Water'],
      specifics:
        'We are RAINED OUT and indoors in a small space — a gym or similar. No hard baseballs at all: ' +
        'tennis balls and wiffle balls only, nothing that can break a light or a window. No live throwing ' +
        'across distance. Build it around close-range mechanics, hands, tee work into a net, footwork, and ' +
        'a sit-down situations conversation. Assume a slick floor and trainers, not cleats.',
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'short-practice',
    title: 'Forty-Five Minutes, You Lost the Field',
    description:
      'Half the time and the same kids. Three things done properly instead of eight done badly.',
    age_group: 'all',
    duration_minutes: 45,
    occasion: 'short',
    skill_level: 'Any',
    tags: ['short', 'time crunch', 'shared field'],
    content: {
      objective:
        'Every kid gets a high number of quality reps at the two things we are worst at, and nothing else ' +
        'gets touched.',
      coaching_points: [
        'Two hands on everything.',
        'Step at your target.',
        'Move to the ball — the ball is not coming to you.',
      ],
      coach_notes:
        'The mistake in a short practice is trying to fit the normal one into less time, which produces a ' +
        'practice where nothing gets enough reps to stick. This does the opposite: two skills, high volume, ' +
        'no transitions. There is no game at the end and that is deliberate — the last ten minutes are worth ' +
        'more as reps than as fun when you only have forty-five. If you get to the end early, add reps to the ' +
        'block that was going worst, do not add a new block.',
      flags: [
        'Transitions eat a short practice alive. Set every station up before the kids arrive, and move ' +
        'kids between stations rather than moving equipment.',
        'Forty-five minutes is not long enough to warm up properly AND go long, so nobody throws long today ' +
        'and nobody pitches. That is a real cost and it is the right trade.',
        'If you are sharing the field, know exactly which part is yours before you start. Ten minutes lost ' +
        'to negotiating with another coach is a quarter of this practice.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Straight Into Throwing',
          minutes: 8,
          description:
            'No lap, no circle. Arms moving inside ninety seconds of the last kid arriving.',
          setup: 'Pairs on a line before anybody sits down. Start at 15 feet.',
          detailed_instructions:
            '1. (2 min) Arm circles and cross-body swings while walking to your spot. Ten each direction.\n' +
            '2. (2 min) 15 feet on the throwing-side knee, ten throws each, wrist snap only.\n' +
            '3. (2 min) 30 feet standing, ten each, full stride.\n' +
            '4. (2 min) 45 feet, ten each, on a line. Stop there — no long toss today.',
          equipment: ['Baseballs (1 per pair)', 'Gloves'],
          coaching_cues: [
            'Elbow above the shoulder.',
            'Step right at your partner\'s chest.',
            'On a line — do not loop it.',
          ],
          common_mistakes: [
            'Someone tries to back up past 45 feet — hold the line, there is no time to warm an arm up ' +
            'properly for it.',
            'Late arrivals joining at the 45-foot stage — send them to 15 feet on their own for two minutes.',
          ],
          drill_variations:
            'Easier: stop at 30 feet. Harder: last minute is ten accuracy throws at the partner\'s chest, ' +
            'counting hits.',
          success_indicators: ['Every arm is loose within eight minutes of arriving.'],
          watch_for:
            'Anybody rolling a shoulder or shaking an arm out. A compressed warm-up is exactly where arm ' +
            'trouble starts, and it is worth stopping this whole practice for one kid.',
        },
        {
          type: 'drill',
          title: 'High-Volume Ground Balls',
          minutes: 15,
          description:
            'One skill, as many reps as you can physically deliver in fifteen minutes.',
          setup:
            'Two lines about 25 feet from you, a bucket of 15 balls at your feet, an empty bucket 10 feet to ' +
            'your left as the target. No throws to a base — the ball goes into the bucket.',
          detailed_instructions:
            '1. (1 min) One demonstration of the ready position and the alligator. No explaining.\n' +
            '2. (7 min) Round 1: continuous. You roll, they field, they toss into the bucket, they run to ' +
            'the back of the other line. Never stop rolling. Aim for 20+ reps each.\n' +
            '3. (7 min) Round 2: same, but rolled to their left and right alternately so they have to move.',
          equipment: ['Baseballs (15+)', 'Buckets (2)', 'Gloves', 'Cones (2)'],
          coaching_cues: [
            'Glove down before the ball gets there.',
            'Two hands — alligator.',
            'Left, right, field it — get your feet there.',
            'Go straight to the back of the other line. Keep it moving.',
          ],
          common_mistakes: [
            'The line stops moving because a coach starts teaching one kid — say one word per rep and let ' +
            'the volume do the work.',
            'Balls piling up because nobody is refilling the bucket — give one kid the refill job and rotate it.',
            'Reps get sloppy as they tire, which just practises the bad version — call a thirty-second water ' +
            'break rather than letting the quality go.',
          ],
          drill_variations:
            'Easier: roll slower and straight at them the whole block. Harder: two balls out at once with ' +
            'two rollers, doubling the reps.',
          success_indicators: [
            'Every kid gets over forty ground balls in fifteen minutes.',
            'Gloves are reaching the ground without you saying it by round two.',
          ],
          watch_for:
            'Whether the reps get worse in the last three minutes. High volume only helps if the quality ' +
            'holds — the moment gloves start staying high because arms are tired, you have stopped training ' +
            'the thing and started training its opposite.',
        },
        {
          type: 'drill',
          title: 'Two-Station Hitting',
          minutes: 18,
          description:
            'Everybody swinging almost the whole time, split so nobody is queuing.',
          setup:
            'Station A: tee into a net. Station B: you on a knee at 45 degrees doing soft toss into a second ' +
            'net or fence. At least 20 feet apart, facing away from each other. Helmets on at both.',
          detailed_instructions:
            '1. (1 min) Split in half. Explain both stations in one go.\n' +
            '2. (8 min) Station A ten swings, then straight into shagging while the next kid goes. Station B ' +
            'the same. Continuous rotation — nobody waits.\n' +
            '3. (1 min) Swap stations.\n' +
            '4. (8 min) Repeat.',
          equipment: ['Tee', 'Bats', 'Helmets', 'Baseballs (15+)', 'Nets (2) or a fence'],
          coaching_cues: [
            'Knob to the ball, then let the barrel go.',
            'Swing through it, not at it.',
            'Line drive back up the middle — that is the target every rep.',
            'Both hands on the bat all the way through.',
          ],
          common_mistakes: [
            'The two stations end up unequal in reps because one moves slower — swap early if you have to, ' +
            'reps matter more than the clock.',
            'Kids waiting with nothing to do — every non-swinger is a shagger, no exceptions.',
            'A helmet coming off between swings, which is the moment somebody gets hit.',
          ],
          drill_variations:
            'Easier: both stations on a tee. Harder: Station B goes to short front toss from behind an ' +
            'L-screen at 20 feet.',
          success_indicators: [
            'Every kid takes at least forty swings.',
            'There is never more than one kid standing still at either station.',
          ],
          watch_for:
            'Which station a kid is better at. A big gap between a good tee swing and a poor toss swing is ' +
            'a timing problem, not a swing problem — and knowing which of the two you are dealing with is ' +
            'worth more than another twenty swings.',
        },
        {
          type: 'cooldown',
          title: 'Four Minutes and Out',
          minutes: 4,
          description: 'Arms down, one thing each, gone.',
          setup: 'Circle where you stand. Do not walk anywhere for this.',
          detailed_instructions:
            '1. (2 min) Arm stretches — cross-body, overhead triceps, wrist circles.\n' +
            '2. (2 min) One sentence each: the thing you saw them do well. Then the one thing the whole team ' +
            'is working on before next time.',
          equipment: ['Water'],
          coaching_cues: ['Name plus one specific action. Nothing general.'],
          common_mistakes: [
            'Skipping the cooldown because time ran out — it is four minutes and it is the part they ' +
            'remember. Cut reps from the block before it instead.',
          ],
          drill_variations: 'Easier: whole-team feedback instead of individual. Harder: each kid names their own.',
          success_indicators: ['Every kid hears their own name once.'],
          watch_for:
            'Whether they are more tired than usual. A compressed practice with no game in it is harder work ' +
            'than a normal one, and if they are flat, next practice needs something fun in it to balance the ledger.',
        },
      ],
    },
    seed: {
      duration: 45,
      focus: ['infield', 'hitting'],
      objective:
        'Every kid gets a high number of quality reps at the two things we are worst at, and nothing else ' +
        'gets touched.',
      equipment: ['Baseballs', 'Bats', 'Helmets', 'Gloves', 'Tee', 'Cones', 'Water'],
      specifics:
        'I have only 45 MINUTES and the same full roster. Do NOT try to fit a normal practice into less ' +
        'time. Pick two skills and give them high-volume reps with almost no transitions. No long toss, no ' +
        'pitching, no end-of-practice game — reps are worth more than fun tonight. Every station set up ' +
        'before we start, and kids move between stations, never equipment.',
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'evaluation-day',
    title: 'Evaluation Day',
    description:
      'Tryouts or a first assessment. Everybody gets the same reps in the same order, so your notes ' +
      'actually compare.',
    age_group: 'all',
    duration_minutes: 90,
    occasion: 'evaluation',
    skill_level: 'Any',
    tags: ['tryouts', 'evaluation', 'assessment', 'draft'],
    content: {
      objective:
        'Every player is seen doing the same four things under the same conditions, and every kid leaves ' +
        'feeling they got a fair look.',
      coaching_points: [
        'Same reps, same order, same words for every single kid.',
        'Write it down at the station. You will not remember it in the car.',
        'Tell them what is next before it starts — surprise is not information.',
      ],
      coach_notes:
        'The point of an evaluation is comparability, not difficulty. A kid who gets six ground balls and a ' +
        'kid who gets nine cannot be compared, and a station that changes as it goes tells you about the ' +
        'station rather than the players. So: fixed rep counts, fixed distances, and the same sentence to ' +
        'every kid. Number them and use numbers out loud rather than names at the stations — it keeps your ' +
        'notes straight and it takes the sting out for the kid who knows they are being judged. If you lose ' +
        'time, cut the game, never a station.',
      flags: [
        'You need one adult per station who can write, or this does not work. Recruit before the day, not ' +
        'on it, and give each of them the rep count in writing.',
        'Kids will be nervous and will throw harder than they should to impress. Say out loud, at the start, ' +
        'that arm strength is not being scored on velocity — you will save somebody\'s elbow.',
        'Parents watching an evaluation is a different environment from parents watching a practice. Decide ' +
        'in advance where they stand and say it once, at the start, kindly.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Numbered Warm-Up and Throwing',
          minutes: 15,
          description:
            'Get numbers on, arms warm, and take your first note before any station starts.',
          setup:
            'Numbered pinnies or tape on the back. Pairs on a line, all facing the same direction. Clipboards ' +
            'with the roster ready.',
          detailed_instructions:
            '1. (3 min) Hand out numbers. Explain the whole session in sixty seconds so nobody is guessing.\n' +
            '2. (3 min) Dynamic movement: jog, high knees, side shuffle, carioca, arm circles.\n' +
            '3. (3 min) 15 feet on a knee, ten throws each.\n' +
            '4. (3 min) 30 feet standing, ten each.\n' +
            '5. (3 min) 45-60 feet by age, ten each. Note arm action here — this is a free look before ' +
            'anybody is trying.',
          equipment: ['Baseballs (1 per pair)', 'Gloves', 'Numbers or pinnies'],
          coaching_cues: [
            'This is a warm-up, not a test. Nothing is being scored yet.',
            'Elbow above the shoulder.',
            'On a line to your partner\'s chest.',
          ],
          common_mistakes: [
            'Letting them air it out to impress — cap the distance and say why.',
            'Starting the stations before arms are actually warm, which produces a throwing score that ' +
            'measures the warm-up rather than the arm.',
          ],
          drill_variations: 'Easier: stop at 45 feet. Harder at 12U: add five crow-hop throws at distance.',
          success_indicators: ['Every kid is numbered, warm, and knows what the next 75 minutes look like.'],
          watch_for:
            'Arm action in the relaxed throws, before anyone is being watched. This is the truest look at a ' +
            'throwing motion you will get all day — the moment a stopwatch or a coach with a clipboard ' +
            'appears, every kid changes what they do.',
        },
        {
          type: 'station',
          title: 'Station 1 — Infield',
          minutes: 18,
          description: 'Six ground balls each, identical, fielded and thrown to first.',
          setup:
            'Shortstop position. A coach hitting or rolling from the plate, a first baseman (a coach) at the ' +
            'bag, a note-taker with the roster. Cones marking exactly where the fielder stands.',
          detailed_instructions:
            '1. (1 min) Explain the six: two straight at you, two to your glove side, two to your backhand.\n' +
            '2. (17 min) Each player takes exactly six, in that order, and throws each to first. Note-taker ' +
            'scores each kid 1-5 on: glove down early, feet to the ball, clean transfer, throw accuracy. ' +
            'Same words to every kid before their turn: "Six balls — two at you, two left, two right. Go."',
          equipment: ['Baseballs (15+)', 'Bats', 'Gloves', 'Cones (2)', 'Bases'],
          coaching_cues: [
            'Six balls, same for everyone. Go.',
            'Glove down early.',
            'Through the ball, not around it.',
          ],
          common_mistakes: [
            'Giving a kid a seventh because the sixth was unlucky — it breaks the comparison. Note the bad ' +
            'bounce instead.',
            'Hitting harder to the ones who look good, which is the fastest way to make your own data useless.',
            'Coaching mid-station. Today you are measuring, not fixing.',
          ],
          drill_variations:
            'Easier at 6U-8U: roll by hand and drop the backhand pair. Harder at 12U: add two slow rollers ' +
            'they have to charge.',
          success_indicators: [
            'Every kid got exactly six.',
            'The note-taker has four numbers per kid, written at the station.',
          ],
          watch_for:
            'The first move after the ball is hit. Good infielders move before they know exactly where it is ' +
            'going; nervous ones freeze and then react. That first quarter-second predicts more about the ' +
            'next two seasons than whether they caught this one.',
        },
        {
          type: 'station',
          title: 'Station 2 — Outfield and Arm',
          minutes: 15,
          description: 'Two fly balls, one ground ball, one throw to a base each.',
          setup:
            'Outfield grass with a cone as the starting spot, a coach hitting or throwing fly balls, a cutoff ' +
            'target at a fixed distance, a note-taker.',
          detailed_instructions:
            '1. (1 min) Explain the four: one fly straight at you, one over your shoulder, one ground ball ' +
            'through, one long throw to the cutoff.\n' +
            '2. (14 min) Each player takes exactly four. Score 1-5 on: first step, route, catch, throw ' +
            'carry and accuracy.',
          equipment: ['Baseballs (15+)', 'Bats', 'Gloves', 'Cones (2)'],
          coaching_cues: [
            'Four balls, same for everyone.',
            'First step, then run — do not drift.',
            'Crow hop and throw through the cutoff.',
          ],
          common_mistakes: [
            'Fly balls of wildly different heights, which measures the coach rather than the kid — throw ' +
            'them rather than hit them if you cannot hit them consistently.',
            'Letting the throw come after a long rest, which flatters the arm. Keep the sequence tight.',
          ],
          drill_variations:
            'Easier at 6U-8U: two thrown fly balls at a soft height and no long throw. Harder: add a ' +
            'do-or-die charge.',
          success_indicators: ['Every kid got the same four, in the same order.'],
          watch_for:
            'The first step on the ball over their shoulder. Backpedalling is the single most common ' +
            'outfield fault and the most reliable thing you will see today — a kid who turns and runs, ' +
            'even to the wrong place, is far more coachable than one who backpedals to the right place.',
        },
        {
          type: 'station',
          title: 'Station 3 — Hitting',
          minutes: 20,
          description: 'Five off the tee, then eight of front toss. Same pitcher, same distance, everyone.',
          setup:
            'A cage or a netted area. Tee set middle of the plate. One coach behind an L-screen at a fixed ' +
            'distance for front toss. Note-taker beside the cage.',
          detailed_instructions:
            '1. (1 min) Explain: five off the tee to get loose, then eight live from the coach.\n' +
            '2. (19 min) Each player: five tee swings, then eight front toss. Score 1-5 on: bat speed, ' +
            'contact quality, swing plane, and whether they adjust after a miss. Same tosser and same ' +
            'distance for every single kid, no exceptions.',
          equipment: ['Tee', 'Bats', 'Helmets', 'Baseballs (20+)', 'L-screen', 'Net or cage'],
          coaching_cues: [
            'Five on the tee, eight live. Same for everyone.',
            'Line drive up the middle.',
            'Swing hard — we would rather see the swing than a safe tap.',
          ],
          common_mistakes: [
            'Changing tossers mid-station, which changes everything and invalidates the comparison.',
            'Giving extra swings to a kid who was unlucky — note it instead.',
            'Kids swinging soft to make contact because they think contact is the score. Say out loud that ' +
            'bat speed matters more.',
          ],
          drill_variations:
            'Easier at 6U-8U: all tee, ten swings. Harder at 12U: last two tosses are off-speed.',
          success_indicators: [
            'Every kid got five and eight.',
            'You can rank the group on bat speed without looking at your notes.',
          ],
          watch_for:
            'What happens after a bad swing. The kid who resets and adjusts on the next pitch is telling ' +
            'you something no station can measure directly, and it is the single best predictor of who gets ' +
            'better by August.',
        },
        {
          type: 'station',
          title: 'Station 4 — Run and Catch',
          minutes: 12,
          description: 'A timed run and a short catching look, so speed and receiving are on the same sheet.',
          setup:
            'Home to first marked and measured, a stopwatch, and a catching spot to the side with a coach ' +
            'and a bucket.',
          detailed_instructions:
            '1. (1 min) Explain: one timed run home to first, then ten catches.\n' +
            '2. (6 min) Each player runs home to first once, timed, from a stationary start. Record the time.\n' +
            '3. (5 min) At the second spot: ten thrown balls from 30 feet — five chest high, five to a side. ' +
            'Score 1-5 on hands and on whether both hands are used.',
          equipment: ['Baseballs (10+)', 'Gloves', 'Bases', 'Stopwatch'],
          coaching_cues: [
            'Run through the bag.',
            'Two hands.',
            'One run each, same start for everyone.',
          ],
          common_mistakes: [
            'Timing from a running start for some kids and a standing one for others.',
            'Running the timed sprint at the very end when they are exhausted — it measures fitness, not speed.',
          ],
          drill_variations:
            'Easier at 6U-8U: skip the timing and just note fast, middle, developing. Harder: add a second ' +
            'timed run to see if they repeat it.',
          success_indicators: ['A time and a catching score next to every number on the sheet.'],
          watch_for:
            'The gap between a kid\'s run time and how fast they look in the field. A quick kid who plays ' +
            'slow is usually a kid who does not know where to go — that is coachable in a month and is the ' +
            'best value pick on the sheet.',
        },
        {
          type: 'game',
          title: 'Finish With Something They Enjoy',
          minutes: 10,
          description: 'End the day as a team, not as a queue. Nothing here is scored.',
          setup: 'Two even teams, four cones, one ball each team.',
          detailed_instructions:
            '1. (1 min) Split into teams, and mix the groups up rather than keeping station groups together.\n' +
            '2. (8 min) Relay race around the cones — throw the ball around the square, drop it and go back ' +
            'a cone. Best of three.\n' +
            '3. (1 min) Bring them in. Thank every kid by name and tell them when they will hear.',
          equipment: ['Baseballs (2)', 'Cones (8)', 'Gloves'],
          coaching_cues: [
            'Nothing is being written down now. Go and have fun.',
            'Call your teammate\'s name before you throw.',
          ],
          common_mistakes: [
            'Skipping this to save ten minutes — this block is the difference between an evaluation and an ' +
            'ordeal, and it is what the kid tells their parents about.',
            'Being vague about when they will hear. Give a day.',
          ],
          drill_variations: 'Easier: roll instead of throw. Harder: shrink the square.',
          success_indicators: ['Kids are laughing. Nobody left before this block.'],
          watch_for:
            'Who is encouraging the kids who are struggling now that nothing is being scored. It is not on ' +
            'any sheet and it is worth as much as any number you wrote down today.',
        },
      ],
    },
    seed: {
      duration: 90,
      focus: ['throwing', 'catching', 'infield', 'outfield', 'hitting'],
      objective:
        'Every player is seen doing the same four things under the same conditions, and every kid leaves ' +
        'feeling they got a fair look.',
      equipment: ['Baseballs', 'Bats', 'Helmets', 'Bases', 'Cones', 'Gloves', 'L-screen', 'Tee', 'Water'],
      specifics:
        'This is an EVALUATION / TRYOUT day, not a practice. The priority is COMPARABILITY: every kid gets ' +
        'exactly the same number of reps at exactly the same distance in the same order, and the coach says ' +
        'the same sentence to each of them. Give me fixed rep counts per station and a 1-5 scoring rubric ' +
        'for each. Assume players are numbered. No coaching or fixing during the stations — we are measuring ' +
        'today. Finish with something fun that is not scored.',
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'pre-tournament',
    title: 'Last Practice Before a Tournament',
    description:
      'Sharpen, do not teach. Save the arms, rehearse the situations, and send them home confident.',
    age_group: 'all',
    duration_minutes: 60,
    occasion: 'tournament',
    skill_level: 'Any',
    tags: ['tournament', 'taper', 'situations', 'confidence'],
    content: {
      objective:
        'Everybody knows their spot and their job in the four situations that will actually decide games ' +
        'this weekend, and every arm is fresher than it was on Monday.',
      coaching_points: [
        'We are not learning anything new. We are getting quicker at what we know.',
        'Talk before the play, not after it — call the situation out loud every pitch.',
        'Everything at game speed, and then stop. Volume is the enemy this week.',
      ],
      coach_notes:
        'The temptation before a tournament is to do more. Do less. Anything introduced tonight will not be ' +
        'usable by Saturday and will only add doubt, and a heavy Thursday is why teams look flat in game two ' +
        'on Saturday morning. So: low throwing volume, no bullpens for anyone pitching this weekend, and the ' +
        'time spent on situations instead of skills. If you lose fifteen minutes, cut the hitting block — ' +
        'they will get swings all weekend and they will not get another chance to walk through a first-and-third.',
      flags: [
        'Do not let your weekend starters throw a bullpen tonight. If they need to touch a mound, ten easy ' +
        'throws off flat ground and nothing more. Pitch counts start Saturday, not tonight.',
        'Whatever the weather forecast is, tell them tonight what happens if it rains — a team that knows ' +
        'the plan for a two-hour delay handles it. One that finds out on Saturday does not.',
        'This is the practice where a kid finds out they are not starting game one. Have that conversation ' +
        'tonight, individually, not on Saturday morning in front of everyone.',
      ],
      blocks: [
        {
          type: 'warmup',
          title: 'Short Warm-Up, Long Stretch',
          minutes: 10,
          description: 'Enough to move well, not enough to cost anything.',
          setup: 'Foul line, whole team spread out. Pairs ready with a ball each.',
          detailed_instructions:
            '1. (3 min) Jog, high knees, side shuffle, carioca — down and back on each.\n' +
            '2. (2 min) Arm circles and cross-body swings.\n' +
            '3. (5 min) Throwing: 15 feet on a knee for ten, 30 feet for ten, 45 feet for ten. Stop there. ' +
            'Nobody goes past 45 feet tonight, including the outfielders.',
          equipment: ['Baseballs (1 per pair)', 'Gloves'],
          coaching_cues: [
            'Loose and easy — save it for Saturday.',
            'Stop at 45 feet. That is the whole plan tonight.',
          ],
          common_mistakes: [
            'Long toss "because it feels good" — this is the block where a tournament gets lost on the ' +
            'Thursday before it.',
            'The kid who did not throw on Tuesday wanting to catch up. They cannot, and trying will cost ' +
            'them the weekend.',
          ],
          drill_variations: 'Easier: stop at 30 feet. Harder: ten accuracy throws at 45 feet, counting hits.',
          success_indicators: ['Everyone loose, nobody tired, nobody past 45 feet.'],
          watch_for:
            'Any arm that is sore from the weekend just gone. Tonight is the last moment you can find that ' +
            'out and change your weekend pitching plan while it is still just a plan.',
        },
        {
          type: 'drill',
          title: 'Situations Walk-Through',
          minutes: 20,
          description:
            'The four plays that decide weekend games, walked at half speed until nobody is guessing.',
          setup:
            'Full defence on the field in their most likely positions. Two or three baserunners in helmets. ' +
            'You at the plate with a bucket, rolling and hitting.',
          detailed_instructions:
            '1. (5 min) Runner on first, ground ball to the infield. Walk it, then jog it, then run it. ' +
            'Every fielder says their job out loud before the ball moves.\n' +
            '2. (5 min) Runner on second, base hit to the outfield. Cutoff, relay, and where the trail runner ' +
            'goes. Three reps to each outfield spot.\n' +
            '3. (5 min) First and third, runner goes. Everyone\'s job, twice from each side.\n' +
            '4. (5 min) Pop-up in the infield with runners on. Who calls it, who clears out, what the runners ' +
            'do. Three reps.',
          equipment: ['Baseballs (15+)', 'Bats', 'Gloves', 'Helmets', 'Bases'],
          coaching_cues: [
            'Say your job out loud before the ball moves.',
            'Call it early and call it loud — the ball is not the problem, the silence is.',
            'Where are you going if it is not hit to you? Everyone moves on every ball.',
          ],
          common_mistakes: [
            'Running it at full speed before they know it walking — half speed until it is right, every time.',
            'Only the infield paying attention. Give the outfield and the bench a job on every rep.',
            'Introducing a fifth situation because there is time. Four, done until they are automatic, beats ' +
            'six they half-know.',
          ],
          drill_variations:
            'Easier at 6U-8U: two situations only — ground ball to the infield, and ball in the outfield. ' +
            'Harder at 12U: add the count and the score so the correct answer changes.',
          success_indicators: [
            'Kids are calling out their job before you say anything.',
            'The third rep of each situation runs without a stoppage.',
          ],
          watch_for:
            'The kid who watches what everyone else does before moving. They do not know the play; they are ' +
            'copying. On Saturday there is no time to copy, so find them tonight and walk them through their ' +
            'job on its own.',
        },
        {
          type: 'drill',
          title: 'Game-Speed Hitting',
          minutes: 18,
          description:
            'Live-speed swings, short and sharp, with a purpose attached to each round.',
          setup:
            'Cage or netted area with an L-screen at game distance. Second station on a tee for the ones waiting.',
          detailed_instructions:
            '1. (1 min) Split into two groups.\n' +
            '2. (8 min) Round 1 — no situation, eight swings each at game speed. Just see it and hit it.\n' +
            '3. (1 min) Swap groups.\n' +
            '4. (8 min) Round 2 — with a job: "runner on second, nobody out, move him over." Six swings each, ' +
            'and the swing only counts if it does the job.',
          equipment: ['Bats', 'Helmets', 'Baseballs (20+)', 'L-screen', 'Tee', 'Net or cage'],
          coaching_cues: [
            'See it and hit it. No mechanics tonight.',
            'What is your job in this at-bat? Say it before you step in.',
            'Hard contact beats perfect contact.',
          ],
          common_mistakes: [
            'A coach making a swing change three days before a tournament — the worst possible timing, and ' +
            'it will still be in their head on Saturday.',
            'Too many swings, so they arrive at the weekend already tired.',
            'Round 2 turning into a mechanics lesson. Keep it about the job.',
          ],
          drill_variations:
            'Easier at 6U-8U: drop the situation round and do two rounds of straight swings. Harder: add ' +
            'two-strike round where anything foul is an out.',
          success_indicators: [
            'Swings are full speed and free.',
            'Kids can say their job before the pitch in round two.',
          ],
          watch_for:
            'Anybody trying to fix themselves between swings. Confidence is the product tonight, and a hitter ' +
            'who arrives on Saturday mid-experiment is worse than one who arrives with an imperfect swing they ' +
            'trust.',
        },
        {
          type: 'cooldown',
          title: 'The Weekend Plan',
          minutes: 12,
          description:
            'Times, positions, pitching, and what happens if it rains. Said once, clearly, to everyone.',
          setup: 'Circle, sitting, water out. Parents in for the last five minutes.',
          detailed_instructions:
            '1. (3 min) Stretch: cross-body, triceps, hamstrings, twenty seconds each.\n' +
            '2. (4 min) The plan: arrival time, where to park, what to bring, what happens if it rains, and ' +
            'roughly how the pitching is going to work.\n' +
            '3. (3 min) One thing you have seen this team get better at since the season started. Be specific ' +
            'and use examples.\n' +
            '4. (2 min) Bring the parents in and say the arrival time and the rain plan again, to them.',
          equipment: ['Water'],
          coaching_cues: [
            'Say the arrival time twice. Once to the kids, once to the parents.',
            'Point at something real they have improved. Specific beats enthusiastic.',
          ],
          common_mistakes: [
            'A big motivational speech. They are eleven. What they need is the arrival time and the belief ' +
            'that you think they are ready.',
            'Only telling the parents the schedule — the kids should know their own weekend.',
          ],
          drill_variations:
            'Easier: schedule and one sentence of encouragement. Harder at 12U: let the players set one ' +
            'team goal for the weekend themselves.',
          success_indicators: [
            'Every kid and every parent can say the arrival time.',
            'They leave talking about Saturday rather than about tonight.',
          ],
          watch_for:
            'The quiet kid who does not think they are playing much this weekend. Catch them before they get ' +
            'to the car and tell them, specifically, when they are going in. That thirty-second conversation ' +
            'is the whole difference between a kid who is ready on Sunday and one who has already checked out.',
        },
      ],
    },
    seed: {
      duration: 60,
      focus: ['game IQ', 'hitting', 'confidence'],
      objective:
        'Everybody knows their spot and their job in the four situations that will decide games this ' +
        'weekend, and every arm is fresher than it was on Monday.',
      equipment: ['Baseballs', 'Bats', 'Helmets', 'Bases', 'Gloves', 'L-screen', 'Tee', 'Water'],
      specifics:
        'This is our LAST PRACTICE BEFORE A TOURNAMENT this weekend. Teach nothing new — anything introduced ' +
        'now will not be usable by Saturday and will only add doubt. Keep throwing volume LOW, cap distance, ' +
        'and no bullpens for anyone pitching this weekend. Spend the bulk of the time on game situations ' +
        'walked at half speed until they are automatic, not on skills. Finish with the weekend logistics ' +
        'and something that sends them home confident.',
    },
  },
]

/** One template by id, or null. */
export function templateById(id: string): PracticeTemplate | null {
  return PRACTICE_TEMPLATES.find(t => t.id === id) || null
}

/**
 * The content shape a template copies into practice_plans.content.
 *
 * Identical to what the generator writes, so the printed sheet, the plan page
 * and the recap loop cannot tell a template apart from an AI plan — which is
 * the point. start_time is left null because only the coach knows it.
 */
export function templatePlanContent(t: PracticeTemplate) {
  return {
    blocks: t.content.blocks,
    coach_notes: t.content.coach_notes,
    flags: t.content.flags,
    objective: t.content.objective,
    coaching_points: t.content.coaching_points,
    start_time: null,
    equipment_available: t.seed.equipment,
  }
}
