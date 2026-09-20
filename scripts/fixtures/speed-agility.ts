// The 9U Speed & Agility pathway, and the drills it needed that did not exist.
//
// Emitted by scripts/emit-speed-pathway.ts into migrations/074. Edit here, not
// there.
//
// WHY THIS FIXTURE CARRIES DRILLS AND development-pathways.ts DOES NOT
//
// Phase 2E's fixture references drills by name and refuses to invent any: the
// library already held a curated drill for nearly every hitting, throwing and
// fielding stage, and the job was sequencing what existed. That assumption does
// not survive contact with this pathway.
//
// The audit (docs/audits/phase2h-player-pathway-audit.md) read all 226 curated
// rows. The library is a BASEBALL SKILL library. Its entire movement holding is
// two rows filed under 'Athletic Development' — a mobility warm-up and a timed
// bases circuit — plus three warm-ups. There is no A-march, no wall drive, no
// pogo, no snap-down, no cut, no reactive start anywhere in it.
//
// So stages 1–7 of this pathway are a genuine coverage gap and are filled here.
// Stages 8–10 are not, and deliberately reuse existing baserunning and fielding
// drills by name — which is the result that justifies this pathway living in a
// baseball product rather than in a fitness app.
//
// TWO RULES THESE DRILLS ARE WRITTEN UNDER
//
//   1. Train speed while fresh. Every rep guidance below is short with long
//      rest. A speed drill run to fatigue is a conditioning drill that has
//      stopped teaching speed, and youth coaches convert one into the other by
//      accident constantly.
//   2. No volume creep. These are 8-to-12-year-olds. 'Do not turn this into
//      adult plyometric volume' is the brief's instruction for stage 4 and it
//      is applied to every stage here.
//
// No media is attached to any of these. The library's media system is separate,
// nothing here invents a YouTube URL or a timestamp, and a drill works from its
// written instructions alone.

import type { PathwaySpec } from './development-pathways'

/**
 * A canonical drill that does not exist yet.
 *
 * Column set and vocabulary copied from migration 071's insert, including the
 * CHECK-constrained ones. `practice_roles` in particular is NOT the pathway
 * sequence vocabulary — 071 was rejected by production for writing 'prepare',
 * which is a pathway step and not a drill role.
 */
export interface NewDrillSpec {
  name: string
  skillCategory: string
  primarySkill: string
  secondarySkill: string
  description: string
  coachingNotes: string
  safetyNotes?: string
  successMarkers: string[]
  repsGuidance: string
  regression: string
  progression: string
  mechanicFocus: string[]
  commonFlaws: string[]
  tags: string[]
  minAge: number
  maxAge: number
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  progressionLevel: number | null
  equipment: string[]
  indoorOutdoor: 'Indoor' | 'Outdoor' | 'Both'
  space: 'Small' | 'Medium' | 'Large' | 'Full Field'
  requiresPartner: boolean
  minutes: number
  activityFormat: 'individual' | 'partner' | 'small_group' | 'station' | 'full_team' | 'game'
  practiceRoles: string[]
  minPlayers: number
  idealGroupSize: number
  minCoaches: number
  stationFriendly: boolean
  repDensity: 'low' | 'medium' | 'high'
  idleRisk: 'low' | 'medium' | 'high'
  engagement: 'low' | 'medium' | 'high'
  competitionStyle: 'none' | 'scored' | 'head_to_head' | 'team_vs_team' | 'game'
  instructionComplexity: 'low' | 'medium' | 'high'
  physicalIntensity: 'low' | 'medium' | 'high'
  mixedSkillFriendly: boolean
  /** problem_taxonomy slugs, only where the mapping is honest. */
  problems?: string[]
}

const NONE = 'None (bodyweight only)'

export const NEW_DRILLS: NewDrillSpec[] = [
  // ── stage 1: baseline and running mechanics ───────────────────────────────
  {
    name: 'A-March — Posture and Ground Contact',
    skillCategory: 'Athletic Development',
    primarySkill: 'sprint posture',
    secondarySkill: 'ground contact',
    description:
      'Walking, slowly, with one knee coming up to about hip height while the opposite arm drives, then the foot placed back down under the hip rather than reaching out in front. Tall through the spine, eyes forward, no leaning back. Ten yards, walk back, repeat. It looks like nothing and it is the position every sprint step is made of — a player who cannot hold it walking cannot hold it at speed, and at speed nobody can see what went wrong.',
    coachingNotes:
      'Cue "tall, knee up, foot down under you". Three things to watch, in this order. First, the hips: a young athlete will sit back to get the knee higher, which trains the opposite of what is wanted — lower the knee until the hips stay stacked. Second, the foot: it should come down under the body, not out in front. A foot landing ahead of the hips is a brake, and reaching is the single most common youth sprint fault. Third, the arms: elbows near ninety degrees, hands moving from hip to chin, no swinging across the body. Do not add speed to fix a bad position; slow it down instead.',
    successMarkers: [
      'Holds a tall posture for the full ten yards without leaning back',
      'Foot lands under the hip rather than reaching in front',
      'Opposite arm and leg move together without crossing the body',
    ],
    repsGuidance: '3-4 lengths of 10 yards, walking back between',
    regression: 'March on the spot, holding a fence or a partner, so balance is not part of the problem.',
    progression: 'Move to the A-skip, which is the same position with an elastic bounce added.',
    mechanicFocus: ['sprint posture', 'knee drive', 'foot strike under the hip', 'arm action'],
    commonFlaws: ['reaching the foot out in front', 'leaning back to lift the knee', 'arms swinging across the body'],
    tags: ['speed', 'running mechanics', 'warmup', 'beginner', 'no equipment'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 1,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 5, activityFormat: 'small_group', practiceRoles: ['warmup', 'teach'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'low', engagement: 'low', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'low', mixedSkillFriendly: true,
  },
  {
    name: 'A-Skip — Rhythm and Quick Contact',
    skillCategory: 'Athletic Development',
    primarySkill: 'running rhythm',
    secondarySkill: 'elastic ground contact',
    description:
      'The A-march with a skip in it. Same tall posture, same knee up, same foot down under the hip — but now the support leg gives a small bounce, so the athlete is briefly off the ground between each one. The aim is a quick, light, rhythmic contact rather than height. Ten yards, walk back, repeat. This is where posture becomes rhythm, and rhythm is what separates a child who runs fast from a child who runs hard.',
    coachingNotes:
      'Cue "quick and quiet". Listen rather than watch for the first few reps — a heavy, slapping contact means the athlete is reaching and landing on the heel. The skip is small; players will try to jump as high as they can, which turns a rhythm drill into a jumping drill and loses the point. Keep the knee height the same as the march and add nothing but the bounce. If the rhythm falls apart, go back to the march. A player who can skip smoothly for ten yards has the coordination base for everything in stages 2 through 7.',
    successMarkers: [
      'Rhythm stays even for the full ten yards',
      'Contacts sound light rather than heavy',
      'Posture matches the A-march — no leaning back',
    ],
    repsGuidance: '3-4 lengths of 10 yards, walking back between',
    regression: 'Back to the A-march until the position holds without the bounce.',
    progression: 'Build-up runs, where the same rhythm has to survive real speed.',
    mechanicFocus: ['running rhythm', 'elastic ground contact', 'coordination', 'knee drive'],
    commonFlaws: ['skipping for height instead of rhythm', 'heavy heel contact', 'rhythm collapsing after a few steps'],
    tags: ['speed', 'running mechanics', 'coordination', 'beginner', 'no equipment'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 5, activityFormat: 'small_group', practiceRoles: ['warmup', 'teach', 'repetition'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'low', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'medium', mixedSkillFriendly: true,
  },
  {
    name: 'Arm Action Check — Hip to Chin',
    skillCategory: 'Athletic Development',
    primarySkill: 'sprint arm action',
    secondarySkill: 'upper body posture',
    description:
      'Standing still, feet apart, the athlete drives the arms as if sprinting: elbows around ninety degrees, hands travelling from beside the hip up to about chin height, shoulders loose, nothing crossing the midline. Fifteen seconds hard, rest, repeat. Then the same thing seated on the ground with the legs straight, which removes every way of cheating with the body. Arms are half of sprinting and the only half a young athlete can control consciously.',
    coachingNotes:
      'Cue "hip to chin, elbows locked at the angle". The fault to hunt is the arm crossing the body: hands that swing across the chest twist the torso, and a twisting torso makes the feet land offline, which is where the wandering-into-the-next-lane look comes from. The seated version is the teaching tool — sit them down and the shoulders have nowhere to hide. Keep the hands relaxed; a clenched fist tightens the whole arm and slows it. Fifteen seconds is plenty. This is a coordination drill and it stops teaching as soon as the athlete gets tired.',
    successMarkers: [
      'Hands travel from hip to chin without crossing the body',
      'Elbow angle stays roughly constant',
      'Shoulders stay down and loose rather than creeping up',
    ],
    repsGuidance: '3 x 15 seconds standing, then 2 x 15 seconds seated',
    regression: 'Seated only, slowly, with the coach moving the athlete\'s arms through the path once.',
    progression: 'Add it to the last five yards of a build-up run so the arm action has to hold at speed.',
    mechanicFocus: ['sprint arm action', 'elbow angle', 'shoulder relaxation'],
    commonFlaws: ['arms crossing the midline', 'shoulders hunched up', 'clenched fists'],
    tags: ['speed', 'running mechanics', 'beginner', 'no equipment', 'indoor'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 1,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 4, activityFormat: 'small_group', practiceRoles: ['warmup', 'teach', 'isolate'],
    minPlayers: 1, idealGroupSize: 10, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'low', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'low', mixedSkillFriendly: true,
  },
  {
    name: 'Build-Up Runs — Find Top Speed Under Control',
    skillCategory: 'Athletic Development',
    primarySkill: 'progressive acceleration',
    secondarySkill: 'running mechanics at speed',
    description:
      'A thirty-yard run that starts easy and gets faster: jog the first ten, quicker through the middle ten, near-full speed for the last ten, then ease off over another ten rather than stopping dead. Walk back. Four of them. The point is not the finish time — it is that the posture and arm action from the marching drills are still there when the athlete is actually moving, which is the first place they usually disappear.',
    coachingNotes:
      'Cue "smooth to fast, not hard to faster". Watch the last ten yards, not the first: that is where a young athlete tightens up, the shoulders climb, the face screws up, and the stride starts reaching. Tension is slow. If the mechanics fall apart at 90%, run the next one at 70% and build from there — a clean 70% run is worth more than a ragged sprint. Full walk-back recovery between reps, every time. Four build-ups with real rest teaches more than twelve with none, and twelve with none is a conditioning session wearing a speed session\'s clothes.',
    successMarkers: [
      'Posture and arm action survive the fast section',
      'Accelerates smoothly rather than lunging at the start',
      'Eases down over ten yards instead of stopping abruptly',
    ],
    repsGuidance: '4 runs of 30 yards, walking back between each',
    regression: 'Shorten to twenty yards and cap the effort at three-quarter speed.',
    progression: 'Hold the top speed for a further ten yards, or start from a two-point stance.',
    mechanicFocus: ['progressive acceleration', 'top speed mechanics', 'relaxation at speed'],
    commonFlaws: ['tightening up at high speed', 'reaching with the front foot', 'stopping dead at the line'],
    tags: ['speed', 'sprinting', 'running mechanics', 'beginner'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: ['Cones or markers'], indoorOutdoor: 'Outdoor', space: 'Large', requiresPartner: false,
    minutes: 8, activityFormat: 'small_group', practiceRoles: ['warmup', 'repetition'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'low', idleRisk: 'medium', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
  },
  {
    name: 'Speed Benchmark Test — Time It and Write It Down',
    skillCategory: 'Athletic Development',
    primarySkill: 'speed assessment',
    secondarySkill: 'repeatable measurement',
    description:
      'Four measurements, taken the same way every time so the numbers can be compared later: a 10-yard sprint, a 20-yard sprint, home to first, and a standing broad jump. Each one twice, best recorded. Fully warm and fully rested — this is a test, not a workout. Done at the start of the pathway it is a baseline; done again at the end it is the retest. The measurements do not decide whether a player has improved. They inform a coach who is already watching.',
    coachingNotes:
      'Repeatability beats precision. A hand-held stopwatch is not accurate to a hundredth of a second and pretending otherwise invents progress that is not there — what matters is that the same person starts the watch on the same cue, from the same line, on the same surface, every single time. Start the watch on first movement, not on a shout. Give a full recovery between every attempt; a tired second attempt is not a measurement of speed. For the broad jump, measure to the back of the heels and only count a landing the athlete sticks. Record all four in the player\'s measurements so the retest has something to compare against, and resist reading anything into a tenth of a second.',
    safetyNotes: 'Fully warmed up first. Maximal sprinting and jumping on cold legs is how youth hamstrings and knees get hurt.',
    successMarkers: [
      'All four measurements recorded under the same conditions',
      'Each attempt taken fully rested rather than back to back',
      'Broad jump landings are stuck, not stumbled',
    ],
    repsGuidance: '2 attempts at each of the four, full recovery between',
    regression: 'Record only the 10-yard sprint and the broad jump — two numbers taken well beat four taken badly.',
    progression: 'Add a second timer on the same run and average them, which shows the athlete how much the stopwatch itself varies.',
    mechanicFocus: ['speed assessment', 'repeatable measurement', 'baseline and retest'],
    commonFlaws: ['timing attempts while fatigued', 'changing the start cue between tests', 'reading meaning into stopwatch noise'],
    tags: ['speed', 'assessment', 'measurement', 'baseline'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: null,
    equipment: ['Stopwatch', 'Tape measure', 'Cones or markers'], indoorOutdoor: 'Outdoor',
    space: 'Large', requiresPartner: false,
    minutes: 15, activityFormat: 'station', practiceRoles: ['assessment'],
    minPlayers: 1, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'low', idleRisk: 'high', engagement: 'medium', competitionStyle: 'scored',
    instructionComplexity: 'medium', physicalIntensity: 'high', mixedSkillFriendly: true,
  },

  // ── stage 2: acceleration position ────────────────────────────────────────
  {
    name: 'Wall Drive — Straight Body, Punch the Knee',
    skillCategory: 'Athletic Development',
    primarySkill: 'acceleration angle',
    secondarySkill: 'knee drive',
    description:
      'Hands on a wall or a fence, arms straight, body leaning in one straight line from the heel through the hip to the head at roughly forty-five degrees. From there the athlete drives one knee up and puts the foot back down under the hip — first one leg at a time on a count, then alternating. The wall holds the lean the athlete cannot yet hold on their own, which is the whole reason it works: acceleration is a body angle before it is anything else.',
    coachingNotes:
      'Cue "straight body, punch the knee". The line that breaks is almost always the hips — they sag toward the wall or pike back, and either way the athlete is no longer in an acceleration position. Put a hand flat on the lower back for a rep or two so they can feel it. Heels stay down or very slightly lifted; up on the toes is a different drill teaching a different thing. Ankle of the driving leg stays pulled up toward the shin rather than pointing down. Start with single-leg holds on a three-count, and only go to alternating once one leg can hold the line by itself.',
    successMarkers: [
      'Body holds one straight line from heel to head',
      'Foot returns under the hip rather than in front of it',
      'Hips stay level through the knee drive',
    ],
    repsGuidance: '2 x 5 each leg on a count, then 2 x 8 alternating',
    regression: 'Just hold the lean, no knee drive, for a five-count at a time.',
    progression: 'Wall drive into a release — the coach taps the shoulder and the athlete sprints out five yards.',
    mechanicFocus: ['acceleration angle', 'knee drive', 'hip position', 'ankle position'],
    commonFlaws: ['hips sagging toward the wall', 'piking at the waist', 'foot landing in front of the hip'],
    tags: ['speed', 'acceleration', 'beginner', 'no equipment', 'indoor'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: ['A wall or fence'], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 6, activityFormat: 'small_group', practiceRoles: ['teach', 'isolate'],
    minPlayers: 1, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'medium', mixedSkillFriendly: true,
  },
  {
    name: 'Falling Start — Fall, Then Go',
    skillCategory: 'Athletic Development',
    primarySkill: 'first-step projection',
    secondarySkill: 'acceleration posture',
    description:
      'The athlete stands tall, feet under the hips, and leans forward from the ANKLES — not the waist — keeping the body in one line, until they are about to fall over. At that point they let the fall happen and sprint out ten yards. Nobody counts them down; gravity picks the moment. It is the fastest way to show a young athlete what a forward body angle feels like, because they cannot get it wrong without falling on their face.',
    coachingNotes:
      'Cue "fall, then go". The error is bending at the waist, which puts the chest over the toes while the hips stay behind — that is not a lean, it is a bow, and the first step out of it goes straight up. Hands off the hips, arms relaxed and ready to drive. Watch the first three steps: they should stay low and push back, with the body gradually rising rather than popping upright at step one. Ten yards is enough; the drill is about the first three steps and everything after that is just running. Full walk-back between reps.',
    safetyNotes: 'Run on a flat, clear surface. An athlete who genuinely over-balances needs somewhere safe to land.',
    successMarkers: [
      'Leans from the ankles with the body in one line',
      'Does not pop upright on the first step',
      'First three steps project forward and push back',
    ],
    repsGuidance: '5-6 starts of 10 yards, walking back between',
    regression: 'Lean and catch the fall with one step, no sprint, until the ankle lean is the habit.',
    progression: 'Falling start into a 20-yard run, then from a baseball ready position rather than standing tall.',
    mechanicFocus: ['first-step projection', 'forward body angle', 'acceleration posture'],
    commonFlaws: ['bending at the waist instead of the ankles', 'popping upright on step one', 'stepping before the fall'],
    tags: ['speed', 'acceleration', 'first step', 'beginner', 'no equipment'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Medium', requiresPartner: false,
    minutes: 6, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'high', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
    problems: ['slow-first-step'],
  },
  {
    name: 'Ten-Yard Acceleration — Push, Push, Push',
    skillCategory: 'Athletic Development',
    primarySkill: 'acceleration mechanics',
    secondarySkill: 'ground force',
    description:
      'A ten-yard sprint from a staggered standing start, run as hard as the athlete can, with full rest before the next one. Cones at zero and ten. The only coaching point is what the first three steps do: push the ground backward, stay low, let the body rise gradually. Five or six of these with real rest between is a complete acceleration session for this age — and the rest is not a detail, it is the drill.',
    coachingNotes:
      'Cue "push, push, push" — said on the first three steps and then nothing. Watch for the athlete who reaches, putting the foot out in front and pulling the ground toward them; that is a brake and it feels fast to them because it is busy. A good first step covers a lot of ground and lands under or behind the hips. Expect the body to rise over about six or seven steps, not immediately and not never. Give at least forty-five seconds between reps: a second sprint on a tired athlete is slower, and teaching the nervous system a slower pattern is the opposite of the point.',
    successMarkers: [
      'First three steps push back rather than reaching forward',
      'Body rises gradually over the ten yards',
      'The last rep looks as good as the first',
    ],
    repsGuidance: '5-6 sprints of 10 yards, at least 45 seconds rest between',
    regression: 'Five yards instead of ten, which keeps the whole rep inside the acceleration phase.',
    progression: 'Add a reaction cue for the start, or extend to twenty yards.',
    mechanicFocus: ['acceleration mechanics', 'ground force', 'first three steps'],
    commonFlaws: ['reaching the foot out in front', 'standing up immediately', 'running the reps too close together'],
    tags: ['speed', 'acceleration', 'sprinting', 'beginner'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: ['Cones or markers'], indoorOutdoor: 'Outdoor', space: 'Medium', requiresPartner: false,
    minutes: 8, activityFormat: 'small_group', practiceRoles: ['repetition', 'progress'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'low', idleRisk: 'medium', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
  },

  // ── stage 3: first-step explosion ─────────────────────────────────────────
  {
    name: 'Reaction Start — Go On the Signal',
    skillCategory: 'Athletic Development',
    primarySkill: 'first-step reaction',
    secondarySkill: 'eliminating the false step',
    description:
      'The athlete sets up in an athletic ready position — knees soft, weight forward, feet under the hips — and sprints five to ten yards when the coach gives a signal. The signal changes: a clap, a dropped glove, a pointed arm. What is being hunted is the false step, the little backward or sideways step almost every young player takes before going forward. Five clean reps out of five is the target, and most players start nowhere near it.',
    coachingNotes:
      'Cue "first step gains ground". Stand where you can see the feet from the side, because a false step is invisible from the front. A small step that goes backward or straight down is wasted time the athlete cannot feel; tell them it happened, every time, and they will fix it faster than any drill will. Weight should already be slightly forward in the ready position — a player rocked back on the heels has to false-step, they have no choice. Mix visual and audible signals so they are reacting rather than timing a rhythm. Stop the set the moment the starts get sloppy.',
    successMarkers: [
      'No false step on four of five reps',
      'First step gains meaningful ground',
      'Stays low out of the start rather than standing up',
    ],
    repsGuidance: '5-6 starts, 30 seconds rest between',
    regression: 'Call the signal on a slow count so the athlete knows when it is coming, and only then remove the warning.',
    progression: 'Start from a crouch, a seated position, or facing away from the coach.',
    mechanicFocus: ['first-step reaction', 'false step elimination', 'ready position'],
    commonFlaws: ['false step backward before going forward', 'weight on the heels in the ready position', 'standing up on the first step'],
    tags: ['speed', 'agility', 'reaction', 'first step', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Both', space: 'Medium', requiresPartner: false,
    minutes: 7, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition', 'decision'],
    minPlayers: 1, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'high', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
    problems: ['slow-first-step'],
  },
  {
    name: 'Chase Start — Five-Yard Race',
    skillCategory: 'Athletic Development',
    primarySkill: 'competitive first step',
    secondarySkill: 'reactive acceleration',
    description:
      'Two players start side by side, one a yard behind the other. The player in front leaves whenever they choose; the player behind goes when they see it and tries to catch them inside five yards. Then they swap. It is the same first step as the reaction start with a person attached to it, and the difference in effort between a player racing a stopwatch and a player racing a teammate is not small.',
    coachingNotes:
      'Cue "see it, go". Keep the distance short — five yards, maybe seven. Long enough to be a race and short enough to stay a first-step drill rather than turning into conditioning, which is what happens at twenty yards and is not what this stage is for. Pair players who are genuinely close in speed; a mismatch teaches one child to coast and the other to give up. Watch the chaser\'s first step specifically, because that is the rep — the leader is just the stimulus. Let them swap roles every rep so nobody spends the session behind.',
    safetyNotes: 'Lanes wide enough that two sprinting players cannot converge, and a clear run-off beyond the finish.',
    successMarkers: [
      'Chaser moves on the leader\'s first movement rather than after a delay',
      'No false step under competitive pressure',
      'Gains ground over the five yards',
    ],
    repsGuidance: '6 races, alternating roles, 30 seconds between',
    regression: 'Coach gives the go signal for both players, so the chaser is reacting to a cue rather than to a person.',
    progression: 'Leader may start from any stance or direction, and the gap comes down to half a yard.',
    mechanicFocus: ['competitive first step', 'reactive acceleration', 'visual reaction'],
    commonFlaws: ['waiting for certainty before going', 'false step under pressure', 'straightening up to look across'],
    tags: ['speed', 'agility', 'reaction', 'competition', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Outdoor', space: 'Medium', requiresPartner: true,
    minutes: 7, activityFormat: 'partner', practiceRoles: ['repetition', 'competition'],
    minPlayers: 2, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'low', engagement: 'high', competitionStyle: 'head_to_head',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
  },

  // ── stage 4: elasticity and quick ground contact ──────────────────────────
  {
    name: 'Pogo Jumps — Quick, Quiet Contacts',
    skillCategory: 'Athletic Development',
    primarySkill: 'elastic ground contact',
    secondarySkill: 'ankle stiffness',
    description:
      'Small, continuous two-footed hops on the spot, driven from the ankles with the knees almost straight and the body tall. Not squatting and jumping — bouncing. Ten to fifteen contacts, rest, repeat. Then the same thing hopping side to side over a line. The aim is the shortest possible time on the ground, which is the quality that makes a fast athlete look springy and a slow one look heavy.',
    coachingNotes:
      'Cue "quick and quiet, off the ankles". Two faults, both common. The first is bending the knees and turning it into a squat jump — height is not the goal and a deep bend guarantees a long ground contact. The second is landing flat and loud; the contact should be on the ball of the foot with the heel kissing the ground, not slamming into it. Keep the hips and shoulders stacked. Ten to fifteen contacts is a set. Do not let this become a volume contest: this is a coordination and stiffness drill for children, not adult plyometric training, and the third sloppy set is worse than useless.',
    safetyNotes: 'Flat, forgiving surface and supportive shoes. Stop the set as soon as contacts get heavy or the landings get sloppy — that is fatigue, and jumping past it is where injuries come from.',
    successMarkers: [
      'Contacts are quick and quiet rather than heavy',
      'Knees stay mostly straight — bouncing, not squatting',
      'Posture stays tall through the set',
    ],
    repsGuidance: '3 sets of 10-15 contacts, full rest between',
    regression: 'Hold a fence or a partner\'s hands for balance and do 6-8 contacts.',
    progression: 'Lateral pogos over a line, then single-leg pogos for a shorter set.',
    mechanicFocus: ['elastic ground contact', 'ankle stiffness', 'rhythm', 'posture under load'],
    commonFlaws: ['squatting instead of bouncing', 'heavy flat-footed landings', 'doing too many sets'],
    tags: ['speed', 'plyometrics', 'coordination', 'no equipment', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 5, activityFormat: 'small_group', practiceRoles: ['warmup', 'teach', 'isolate'],
    minPlayers: 1, idealGroupSize: 10, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'medium', mixedSkillFriendly: true,
  },
  {
    name: 'Jump Rope Rhythm — Sixty Seconds of Springs',
    skillCategory: 'Athletic Development',
    primarySkill: 'rhythmic ground contact',
    secondarySkill: 'coordination',
    description:
      'Ordinary skipping, done deliberately: small bounces on the balls of the feet, knees soft but not bending much, wrists turning the rope rather than the arms. Thirty to sixty seconds, rest, repeat two or three times. It is the cheapest elasticity work there is, it can be done at home between practices, and it builds exactly the quick ground contact that stage 4 is about while feeling like nothing.',
    coachingNotes:
      'Cue "wrists turn the rope, ankles do the work". A player swinging the rope with their whole arms will jump too high to keep a rhythm. Rope length matters more than people expect — standing on the middle, the handles should reach roughly to the armpits; too long and the rhythm is impossible. Beginners should count misses without being embarrassed by them, and a player who cannot yet skip continuously does bouts of ten successful turns instead of thirty seconds. This is the one drill in the pathway a player can realistically do alone at home, so it is worth teaching properly.',
    successMarkers: [
      'Keeps a steady rhythm for thirty seconds',
      'Bounces stay small and on the balls of the feet',
      'Turns the rope from the wrists',
    ],
    repsGuidance: '3 bouts of 30-60 seconds, resting between',
    regression: 'Skip without a rope, miming the turn, or do sets of ten successful turns.',
    progression: 'Alternate-foot skipping, then short bouts of double-unders.',
    mechanicFocus: ['rhythmic ground contact', 'coordination', 'ankle stiffness'],
    commonFlaws: ['swinging the rope with the arms', 'jumping far too high', 'rope the wrong length'],
    tags: ['speed', 'coordination', 'plyometrics', 'home practice', 'beginner'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: ['Jump rope'], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 5, activityFormat: 'individual', practiceRoles: ['warmup', 'repetition'],
    minPlayers: 1, idealGroupSize: 12, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'medium', mixedSkillFriendly: true,
  },
  {
    name: 'Broad Jump — Jump and Stick It',
    skillCategory: 'Athletic Development',
    primarySkill: 'lower body power',
    secondarySkill: 'landing control',
    description:
      'A two-footed standing jump for distance, with one rule that matters more than the distance: the landing has to be stuck. Feet land together, knees bend to absorb, and the athlete holds the position for a two-count without stepping or falling forward. Arms swing back then drive forward. Five jumps with full rest. A jump that cannot be landed is not a jump the athlete owns yet.',
    coachingNotes:
      'Cue "jump far, land quiet, hold it". The stick is the teaching tool — it forces the athlete to land in a controlled athletic position, which is the same position stage 5 needs for deceleration, so this drill does double duty. Expect the first jumps to be too ambitious and the landings to be a mess; tell them to jump slightly less far and land it perfectly, and the distance comes back within a session. Arms matter: a jump with no arm swing loses a surprising amount of distance. Full rest between jumps — this is a power drill and a tired jump is just a jump.',
    safetyNotes: 'Grass or a forgiving surface. Landing repeatedly on concrete is hard on young knees for no benefit.',
    successMarkers: [
      'Lands with both feet together and holds for a two-count',
      'Knees bend to absorb rather than locking straight',
      'Uses a full arm swing into the jump',
    ],
    repsGuidance: '5 jumps, full rest between',
    regression: 'Jump for height rather than distance, or jump onto a marked line so the landing is the whole task.',
    progression: 'Two jumps in a row, landing the first and going straight into the second.',
    mechanicFocus: ['lower body power', 'landing control', 'arm swing', 'triple extension'],
    commonFlaws: ['stumbling forward on landing', 'landing with straight legs', 'no arm swing'],
    tags: ['speed', 'power', 'plyometrics', 'assessment', 'beginner'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: ['Tape measure', 'Cones or markers'], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 5, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition', 'assessment'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'high', competitionStyle: 'scored',
    instructionComplexity: 'low', physicalIntensity: 'medium', mixedSkillFriendly: true,
  },

  // ── stage 5: deceleration ─────────────────────────────────────────────────
  {
    name: 'Sprint and Stick — Stop Where the Cone Is',
    skillCategory: 'Athletic Development',
    primarySkill: 'deceleration',
    secondarySkill: 'body control',
    description:
      'A sprint of five or ten yards to a cone, where the athlete has to stop — under control, balanced, hips down — within about a yard of it and hold that position for a two-count. Not slow down. Stop. Getting fast is only half of being quick; the half that shows up in a rundown, on a bad read, or coming back to a base is being able to shut it off.',
    coachingNotes:
      'Cue "hips down, chest up". The default youth stop is to stay tall and stiff-leg it, which takes several extra steps and puts every bit of the force through the knee. What is wanted is the athlete dropping the hips over the last two or three steps and widening the base slightly, so the whole leg absorbs it. Start at five yards and half speed and add speed only when the stop is genuinely controlled — an out-of-control stop is where knees get hurt, so this is the one place in the pathway to be conservative on purpose. Count the steps past the cone: fewer is the whole score.',
    safetyNotes: 'Build speed up gradually across the session. Flat, dry surface — a stop on wet grass is a slide.',
    successMarkers: [
      'Lowers the hips into the stop rather than staying tall',
      'Stops within about a yard of the cone',
      'Holds a balanced position for a two-count without stepping',
    ],
    repsGuidance: '6 reps, alternating 5 and 10 yards, 30 seconds between',
    regression: 'Jog to the cone and stop, so the position is learned before speed is added.',
    progression: 'Stop, then immediately sprint back the other way — which is the bridge into stage 6.',
    mechanicFocus: ['deceleration', 'hip lowering', 'balance under control', 'body control'],
    commonFlaws: ['staying tall and stiff-legging the stop', 'taking several extra steps', 'falling forward past the cone'],
    tags: ['speed', 'agility', 'deceleration', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Both', space: 'Medium', requiresPartner: false,
    minutes: 7, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition'],
    minPlayers: 1, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'high', mixedSkillFriendly: true,
  },
  {
    name: 'Snap Down — Get Under Control Fast',
    skillCategory: 'Athletic Development',
    primarySkill: 'absorbing force',
    secondarySkill: 'athletic position',
    description:
      'The athlete stands tall on the balls of the feet, then snaps down into an athletic position as fast as they can — feet jump out a little wider, hips drop back, chest stays up, arms come down — and freezes there. It is the landing position from the broad jump and the stopping position from sprint-and-stick, taken on its own and repeated until it is automatic. Five reps, reset between each.',
    coachingNotes:
      'Cue "down, not out". Speed into the position is what is being trained, so a slow squat is not the drill — it should be a snap. Check the freeze: shins roughly vertical, knees over the middle of the feet rather than caved inward, chest up, weight on the whole foot. Knees collapsing inward is the fault worth stopping for; it is the position associated with knee injuries and it is easy to correct at this age with a cue to push the knees out. Use it as a five-rep primer immediately before sprint-and-stick, so the athlete goes into the deceleration work already knowing what position they are aiming for.',
    successMarkers: [
      'Reaches the athletic position in one quick movement',
      'Knees track over the feet rather than caving inward',
      'Chest stays up with the hips back',
    ],
    repsGuidance: '2 sets of 5, resetting fully between reps',
    regression: 'Move into the position slowly and hold it, with the coach checking the knees.',
    progression: 'Snap down from a small hop, so the position has to be found on landing.',
    mechanicFocus: ['absorbing force', 'athletic position', 'knee tracking'],
    commonFlaws: ['knees caving inward', 'chest dropping forward', 'sinking slowly instead of snapping'],
    tags: ['speed', 'deceleration', 'no equipment', 'beginner', 'indoor'],
    minAge: 8, maxAge: 12, difficulty: 'Beginner', progressionLevel: 2,
    equipment: [NONE], indoorOutdoor: 'Both', space: 'Small', requiresPartner: false,
    minutes: 4, activityFormat: 'small_group', practiceRoles: ['warmup', 'teach', 'isolate'],
    minPlayers: 1, idealGroupSize: 10, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'low', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'low', mixedSkillFriendly: true,
  },

  // ── stage 6: change of direction ──────────────────────────────────────────
  {
    name: 'Shuffle to Sprint — Open the Hips and Go',
    skillCategory: 'Athletic Development',
    primarySkill: 'change of direction',
    secondarySkill: 'crossover step',
    description:
      'The athlete shuffles laterally between two cones five yards apart, staying low and not letting the feet click together, and on a signal turns the hips and sprints out in the direction they were shuffling. Then the same thing with the sprint going the OTHER way, which requires a crossover step. The shuffle is how a fielder and a baserunner hold ground; the exit is how they stop holding it.',
    coachingNotes:
      'Cue "open and go, one step". The turn should be one decisive movement — the hips open, the near foot crosses, and they are sprinting. What you will see instead is two or three little setup steps while the player works out what to do, and those steps are the whole difference between reaching a ball and not. Stay low through the shuffle: a player who stands up between the cones has to sink again before they can push. Call the exit direction late and mix it, otherwise the athlete is rehearsing a routine rather than changing direction.',
    successMarkers: [
      'Exits with one decisive plant rather than several setup steps',
      'Hips turn toward the new direction immediately',
      'Stays low through the shuffle rather than bobbing up',
    ],
    repsGuidance: '6-8 reps, exit direction mixed, 30 seconds between',
    regression: 'Call the exit direction before the shuffle starts, so only the footwork is new.',
    progression: 'Coach points the direction at the last moment, or the exit is triggered by a thrown ball.',
    mechanicFocus: ['change of direction', 'crossover step', 'hip rotation', 'lateral movement'],
    commonFlaws: ['several setup steps before the exit', 'standing up during the shuffle', 'feet clicking together'],
    tags: ['speed', 'agility', 'change of direction', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Both', space: 'Medium', requiresPartner: false,
    minutes: 7, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition', 'decision'],
    minPlayers: 1, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'high', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'high', mixedSkillFriendly: true,
  },
  {
    name: 'Plant and Go — The 45-Degree Cut',
    skillCategory: 'Athletic Development',
    primarySkill: 'cutting mechanics',
    secondarySkill: 'reacceleration',
    description:
      'Two cones set to make a shallow angle. The athlete sprints five yards to the turn cone, plants the OUTSIDE foot, and accelerates out at about forty-five degrees. The cut should be one plant, not a slow rounded curve and not a full stop. Three each way. This is the movement that takes a fielder to a ball in the gap and a runner around a base, and youth players almost universally round it off.',
    coachingNotes:
      'Cue "outside foot, then go". The plant foot is the one away from the direction of travel — cutting left means planting the right. Players will plant the wrong foot, which forces an extra step, so watch the feet rather than the body. Lower the hips slightly into the plant: a tall player cannot push sideways. The other common fault is drifting around the cone in a smooth arc, which is comfortable and slow; make the angle sharp enough that rounding it is obviously wrong. Keep the eyes and chest coming up out of the cut rather than staring at the ground.',
    safetyNotes: 'Dry, flat surface with good footing. Cutting hard on wet grass in the wrong shoes is how ankles turn.',
    successMarkers: [
      'Plants the outside foot on most reps',
      'Exits the cut accelerating rather than drifting',
      'Stays balanced through the plant',
    ],
    repsGuidance: '6 reps, 3 in each direction, 30 seconds between',
    regression: 'Walk and then jog the angle, planting deliberately, before adding speed.',
    progression: 'A second cut immediately after the first, or a coach calling the direction as the athlete approaches.',
    mechanicFocus: ['cutting mechanics', 'plant foot selection', 'reacceleration', 'hip lowering'],
    commonFlaws: ['rounding the cut into an arc', 'planting the inside foot', 'standing tall through the plant'],
    tags: ['speed', 'agility', 'change of direction', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Outdoor', space: 'Medium', requiresPartner: false,
    minutes: 7, activityFormat: 'small_group', practiceRoles: ['teach', 'repetition'],
    minPlayers: 1, idealGroupSize: 6, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'medium', competitionStyle: 'none',
    instructionComplexity: 'medium', physicalIntensity: 'high', mixedSkillFriendly: true,
  },

  // ── stage 7: reactive agility ─────────────────────────────────────────────
  {
    name: 'Tennis Ball Drop — See It, Go',
    skillCategory: 'Athletic Development',
    primarySkill: 'reactive acceleration',
    secondarySkill: 'visual reaction',
    description:
      'The coach stands five to eight yards away holding a tennis ball at shoulder height and drops it without warning. The player, in an athletic ready position, sprints and tries to catch it before the second bounce. Move closer or further to make it easier or harder. Nothing else in this pathway produces the same quality of first step, because the athlete cannot anticipate the start — they can only react to it.',
    coachingNotes:
      'Cue "see it, go". Vary the interval between reps genuinely; a coach who drops the ball on a rhythm is training timing, not reaction. Distance is the difficulty dial and should be set so the player catches it roughly half the time — always catching it is too easy to improve anything, never catching it stops them trying. Two balls, alternating hands, adds a direction read for free. Watch the first step for the false step that stage 3 worked on, because this is where it comes back under pressure. Six to eight reps is a set; the quality falls off a cliff after that.',
    successMarkers: [
      'Moves on the drop rather than after a hesitation',
      'First step goes toward the ball, not backward',
      'Stays balanced enough to make a catch at the end of the sprint',
    ],
    repsGuidance: '6-8 drops, 30 seconds between',
    regression: 'Move closer and allow a third bounce, or announce that the drop is coming.',
    progression: 'Two balls held wide, either one dropped, so the direction is part of the read.',
    mechanicFocus: ['reactive acceleration', 'visual reaction', 'first step under uncertainty'],
    commonFlaws: ['hesitating to confirm the drop', 'false step under pressure', 'standing upright while waiting'],
    tags: ['speed', 'agility', 'reaction', 'fun', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Tennis balls'], indoorOutdoor: 'Both', space: 'Medium', requiresPartner: true,
    minutes: 7, activityFormat: 'partner', practiceRoles: ['teach', 'repetition', 'decision'],
    minPlayers: 1, idealGroupSize: 4, minCoaches: 1, stationFriendly: true,
    repDensity: 'medium', idleRisk: 'medium', engagement: 'high', competitionStyle: 'none',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
    problems: ['slow-first-step'],
  },
  {
    name: 'Mirror Drill — Match the Leader',
    skillCategory: 'Athletic Development',
    primarySkill: 'reactive agility',
    secondarySkill: 'lateral movement',
    description:
      'Two players face each other a few yards apart inside a five-yard box. One leads, moving laterally, forward and back however they like; the other mirrors them as closely as they can. Ten to fifteen seconds, then swap. The follower has no idea what is coming, which is the point — every other agility drill in this pathway has a pattern, and games do not.',
    coachingNotes:
      'Cue "stay low, stay square". The follower should stay in an athletic position with the feet shuffling and never cross them or turn their shoulders — the moment they turn, they have committed and a good leader will go the other way. Keep the bouts short: ten to fifteen seconds is genuinely demanding when it is done properly, and a thirty-second bout becomes a jog. Tell the leader to change direction sharply rather than moving constantly, because the change is what the follower is learning to read. Swap roles every bout so both players get the reactive work.',
    successMarkers: [
      'Stays square to the leader without crossing the feet',
      'Changes direction with the leader rather than a beat behind',
      'Maintains a low athletic position through the bout',
    ],
    repsGuidance: '4-6 bouts of 10-15 seconds, swapping roles each time',
    regression: 'Leader moves only side to side, slowly, so the follower learns the footwork first.',
    progression: 'Add forward and backward movement, and let the leader break out of the box on a sprint.',
    mechanicFocus: ['reactive agility', 'lateral movement', 'reading a stimulus', 'athletic position'],
    commonFlaws: ['crossing the feet', 'turning the shoulders and committing', 'standing too tall to change direction'],
    tags: ['speed', 'agility', 'reaction', 'partner', 'fun', 'intermediate'],
    minAge: 8, maxAge: 12, difficulty: 'Intermediate', progressionLevel: 3,
    equipment: ['Cones or markers'], indoorOutdoor: 'Both', space: 'Small', requiresPartner: true,
    minutes: 6, activityFormat: 'partner', practiceRoles: ['repetition', 'competition'],
    minPlayers: 2, idealGroupSize: 8, minCoaches: 1, stationFriendly: true,
    repDensity: 'high', idleRisk: 'low', engagement: 'high', competitionStyle: 'head_to_head',
    instructionComplexity: 'low', physicalIntensity: 'high', mixedSkillFriendly: true,
  },
]

// ───────────────────────────────────────────────────────────────────────────
// The pathway
// ───────────────────────────────────────────────────────────────────────────
//
// skill_category is 'athleticism' — an existing lib/focusAreas.FocusArea, which
// 'Athletic Development' and 'Warmup' already map onto. No new category is
// invented, per the brief's §6.
//
// Age 8-12 rather than 9U only. The brief asks for a reusable youth curriculum
// and warns against overfitting to one child.
//
// Stages 8, 9 and 10 reference drills that ALREADY EXIST by name. That is the
// part of this pathway that makes it baseball rather than track.

export const SPEED_PATHWAY: PathwaySpec = {
  slug: 'speed-and-agility-development',
  name: 'Speed & Agility Development',
  skillCategory: 'athleticism',
  summary:
    'Teach a young player to accelerate, stop, change direction and react — then put it back into baserunning and defence. For the player whose baseball skills are ahead of their movement.',
  applicability:
    'For 8-to-12-year-olds who can already play — this is about how they move, not how they hit or throw. It assumes a player who is healthy and can run without pain. Train speed while fresh: these stages belong at the START of a practice, never at the end, and a game or a hard team practice replaces a high-intensity speed day rather than adding to it. Daily movement is good; daily maximal sprinting is not.',
  minAge: 8,
  maxAge: 12,
  provenance:
    'Sequenced for BenchCoach in Phase 2H from standard youth long-term athletic development practice: mechanics before acceleration, acceleration before reaction, and deceleration taught before change of direction rather than after it. Stages 1-7 are general movement and needed new drills; stages 8-10 transfer into baseball using drills the library already held.',
  stages: [
    {
      key: 'baseline-and-mechanics',
      name: 'Baseline & Running Mechanics',
      objective:
        'Record repeatable baseline measurements, and hold a tall sprint posture with a clean arm action.',
      whyItMatters:
        'Everything later in this pathway is a change to how the player moves, and without a number written down at the start there is no way to tell later whether anything changed. The mechanics come first for the same reason you teach a grip before a swing — a faster version of a bad running pattern is just a bad running pattern arriving sooner.',
      masterySignals: [
        'Maintains coordinated opposite arm and leg action through a build-up run',
        'Runs without the arms swinging across the body',
        'Holds a tall posture in the A-march without leaning back',
        'All four baseline measurements recorded under the same conditions',
      ],
      commonFailureModes: [
        'Reaching the foot out in front instead of landing under the hip',
        'Arms crossing the midline, which turns the torso and sends the feet offline',
        'Measurements taken while tired, or with the start cue changing between attempts',
      ],
      coachingEmphasis:
        'Slow is fine here. Every drill in this stage is a position drill and adding speed to a position that is not yet right only hides it.',
      practicesMin: 2,
      practicesMax: 4,
      problems: [],
      drills: [
        { drill: 'A-March — Posture and Ground Contact', role: 'primary', rank: 1,
          rationale: 'The sprint position taken at walking pace, where a coach can actually see the foot landing under the hip and correct it. Every stage after this assumes it.' },
        { drill: 'A-Skip — Rhythm and Quick Contact', role: 'progression', rank: 1,
          rationale: 'The same posture with an elastic bounce added — the step between holding a position and running in it.' },
        { drill: 'Arm Action Check — Hip to Chin', role: 'reinforcement', rank: 1,
          rationale: 'Isolates the half of sprinting a young athlete can consciously control, and the seated version removes every way of compensating with the body.' },
        { drill: 'Build-Up Runs — Find Top Speed Under Control', role: 'reinforcement', rank: 2,
          rationale: 'The first test of whether the marching posture survives real speed, which is where it usually disappears.' },
        { drill: 'Speed Benchmark Test — Time It and Write It Down', role: 'assessment', rank: 1,
          rationale: 'Produces the four numbers this pathway is measured against. Recorded, not judged — the retest in stage 10 is what gives them meaning.' },
        { drill: 'Baseball Dynamic Stretches for Youth Players', role: 'reinforcement', rank: 3,
          rationale: 'Speed work on cold legs is where youth hamstrings go. The library already had this and it belongs in front of every session in this pathway.' },
      ],
    },
    {
      key: 'acceleration-position',
      name: 'Acceleration Position',
      objective:
        'Project the body forward and push into the ground for the first few steps instead of standing straight up.',
      whyItMatters:
        'Almost every sprint in baseball is over in ten to twenty yards, so the acceleration phase is not the start of the race — it is the whole race. A player who pops upright on the first step has spent the only part that mattered.',
      masterySignals: [
        'Does not pop upright on the first step',
        'First three steps project the body forward',
        'No excessive reaching with the front foot',
        'Holds a consistent forward body angle out of a falling start',
      ],
      commonFailureModes: [
        'Bending at the waist instead of leaning from the ankles',
        'Hips sagging or piking in the wall drive, so the lean is not a straight line',
        'Running the acceleration reps too close together, which turns them into conditioning',
      ],
      coachingEmphasis:
        'Rest is part of the drill. Five hard ten-yard sprints with a real walk-back teach more than fifteen crammed together, and the crammed version teaches the body to run slowly.',
      practicesMin: 2,
      practicesMax: 4,
      problems: ['slow-first-step'],
      drills: [
        { drill: 'Wall Drive — Straight Body, Punch the Knee', role: 'primary', rank: 1,
          rationale: 'The wall holds the forward angle the athlete cannot yet hold alone, so the knee drive can be taught in a position they could not otherwise reach.' },
        { drill: 'Falling Start — Fall, Then Go', role: 'primary', rank: 2,
          rationale: 'Gravity picks the body angle, so the athlete feels the correct lean instead of being told about it. The fastest way into this stage.' },
        { drill: 'Ten-Yard Acceleration — Push, Push, Push', role: 'reinforcement', rank: 1,
          rationale: 'Where the position becomes a sprint. Ten yards is long enough to accelerate and short enough that the whole rep is still acceleration.' },
        { drill: 'A-March — Posture and Ground Contact', role: 'regression', rank: 1,
          rationale: 'When the lean collapses into a bow at the waist, the problem is usually the posture underneath it — go back a stage and rebuild it.' },
      ],
    },
    {
      key: 'first-step-explosion',
      name: 'First-Step Explosion',
      objective:
        'React and move without a wasted step, gaining ground on the very first one.',
      whyItMatters:
        'A false step costs about a third of a second, which is roughly a stride and a half — the exact margin between a ball fielded and a ball through the gap, or a stolen base and an out. Almost every young player takes one, and almost none of them know they do.',
      masterySignals: [
        'No false step on four of five quality reps',
        'First step gains meaningful ground',
        'Reacts quickly without standing straight up',
        'Can repeat clean starts from more than one athletic position',
      ],
      commonFailureModes: [
        'A small backward or sideways step before going forward',
        'Weight settled on the heels in the ready position, which makes a false step unavoidable',
        'Anticipating a rhythm rather than reacting to the signal',
      ],
      coachingEmphasis:
        'Watch the feet from the side. A false step is invisible from the front and a player cannot feel their own — being told it happened, every time, fixes it faster than any drill.',
      practicesMin: 3,
      practicesMax: 5,
      problems: ['slow-first-step'],
      drills: [
        { drill: 'Reaction Start — Go On the Signal', role: 'primary', rank: 1,
          rationale: 'Puts an unpredictable start cue on the acceleration from the previous stage, which is what exposes the false step in the first place.' },
        { drill: 'Chase Start — Five-Yard Race', role: 'reinforcement', rank: 1,
          rationale: 'A teammate a yard ahead produces an honest first step that no stopwatch gets out of a nine-year-old.' },
        { drill: 'Falling Start — Fall, Then Go', role: 'regression', rank: 1,
          rationale: 'When the first step keeps going backward, remove the reaction entirely and rebuild the forward angle before adding the cue back.' },
        { drill: 'Ready and Go — Outfield First Step', role: 'game_application', rank: 1,
          rationale: 'The same first step with a ball attached and a direction to read. Already in the library, and the first point in this pathway where the movement is baseball.' },
      ],
    },
    {
      key: 'elasticity',
      name: 'Elasticity & Quick Ground Contact',
      objective:
        'Leave the ground quickly and land under control, with quiet, springy contacts.',
      whyItMatters:
        'Time spent on the ground is time not spent moving. The player who looks springy and the player who looks heavy are usually not separated by strength but by how long each foot stays down, and that is trainable at this age with very little volume.',
      masterySignals: [
        'Pogo contacts are quick and quiet rather than heavy',
        'Maintains a tall posture through a set of pogos',
        'Sticks a broad-jump landing and holds it for a two-count',
        'Keeps a steady jump-rope rhythm for thirty seconds',
      ],
      commonFailureModes: [
        'Squatting and jumping instead of bouncing from the ankles',
        'Landing flat and loud',
        'Adding sets — this is coordination work for children, not adult plyometric volume',
      ],
      coachingEmphasis:
        'Keep it short on purpose. Three sets of ten to fifteen contacts is the whole stage; the third sloppy set is worse than not doing it, and fatigue here is what turns a coordination drill into an injury risk.',
      practicesMin: 2,
      practicesMax: 4,
      problems: [],
      drills: [
        { drill: 'Pogo Jumps — Quick, Quiet Contacts', role: 'primary', rank: 1,
          rationale: 'The most direct way to train a short ground contact, and it needs nothing but a flat surface and thirty seconds.' },
        { drill: 'Broad Jump — Jump and Stick It', role: 'reinforcement', rank: 1,
          rationale: 'Trains the push and the landing together, and the stuck landing is the same athletic position deceleration needs in the next stage.' },
        { drill: 'Jump Rope Rhythm — Sixty Seconds of Springs', role: 'reinforcement', rank: 2,
          rationale: 'The one drill in this pathway a player can genuinely do alone at home, which makes it the one that accumulates between practices.' },
        { drill: 'Snap Down — Get Under Control Fast', role: 'regression', rank: 1,
          rationale: 'When landings keep collapsing, take the jump away and rehearse the landing position on its own.' },
      ],
    },
    {
      key: 'deceleration',
      name: 'Deceleration',
      objective:
        'Stop under control from a sprint, with the hips down and without extra steps.',
      whyItMatters:
        'Taught before change of direction on purpose. A player who cannot stop cannot safely turn, and a cut is nothing more than a stop with an exit attached. It is also the least-coached quality in youth baseball and the one most associated with knee injuries later.',
      masterySignals: [
        'Lowers the hips into the stop instead of staying tall',
        'Stops within about a yard of the target without extra steps',
        'Avoids straight-leg braking',
        'Holds a balanced position for a two-count after stopping',
      ],
      commonFailureModes: [
        'Staying tall and stiff-legging the stop, putting the load through the knee',
        'Knees caving inward on the snap down',
        'Adding speed before the stop is genuinely under control',
      ],
      coachingEmphasis:
        'This is the one stage to be deliberately conservative in. Build speed up across the session rather than starting at full effort — an out-of-control stop is exactly the mechanism that hurts young knees.',
      practicesMin: 2,
      practicesMax: 4,
      problems: [],
      drills: [
        { drill: 'Sprint and Stick — Stop Where the Cone Is', role: 'primary', rank: 1,
          rationale: 'The whole objective in one rep: run fast, then shut it off in a balanced athletic position and prove it by holding it.' },
        { drill: 'Snap Down — Get Under Control Fast', role: 'reinforcement', rank: 1,
          rationale: 'Five reps of the stopping position immediately before sprinting into it means the athlete already knows the shape they are aiming for.' },
        { drill: 'Broad Jump — Jump and Stick It', role: 'reinforcement', rank: 2,
          rationale: 'A stuck landing is a deceleration in miniature — same hips, same knees, same absorbing — with far less speed to control.' },
      ],
    },
    {
      key: 'change-of-direction',
      name: 'Change of Direction',
      objective:
        'Plant once, redirect, and accelerate out of the turn.',
      whyItMatters:
        'Baseball is played in short bursts that almost never go in a straight line. A fielder who takes three setup steps before changing direction has given up more ground than any amount of top-end speed will get back.',
      masterySignals: [
        'Uses one decisive plant rather than several setup steps',
        'Hips turn toward the new direction quickly',
        'Exits the cut accelerating rather than drifting',
        'Stays balanced through the plant',
      ],
      commonFailureModes: [
        'Rounding the cut into a comfortable arc',
        'Planting the inside foot, which forces an extra step',
        'Standing tall through the plant, leaving nothing to push with',
      ],
      coachingEmphasis:
        'Watch the plant foot, not the body. Cutting left means planting right, and a player planting the wrong foot will look busy and slow without either of you knowing why.',
      practicesMin: 3,
      practicesMax: 5,
      problems: ['poor-fielding-footwork'],
      drills: [
        { drill: 'Plant and Go — The 45-Degree Cut', role: 'primary', rank: 1,
          rationale: 'Isolates the cut itself at an angle sharp enough that rounding it off is obviously wrong to the player, not just to the coach.' },
        { drill: 'Shuffle to Sprint — Open the Hips and Go', role: 'primary', rank: 2,
          rationale: 'The lateral-to-linear transition, which is the version of this a shortstop and a baserunner actually use.' },
        { drill: 'Sprint and Stick — Stop Where the Cone Is', role: 'regression', rank: 1,
          rationale: 'A cut is a stop with an exit. When the plant is out of control, take the exit away and go back to owning the stop.' },
        { drill: 'Cross-Shuffle Drill', role: 'game_application', rank: 1,
          rationale: 'Already in the library as infield footwork, and it is the same crossover with a ground ball at the end of it.' },
      ],
    },
    {
      key: 'reactive-agility',
      name: 'Reactive Agility',
      objective:
        'Move correctly in response to something the player could not predict.',
      whyItMatters:
        'Cone patterns are memorised within a few reps, and a memorised pattern stops training the thing that actually matters. Games never tell a fielder which way the ball is going, so at some point the drill has to stop telling them too.',
      masterySignals: [
        'Reacts rather than guesses',
        'First movement goes toward the correct stimulus',
        'Stays balanced before accelerating',
        'Technique from the earlier stages holds when the direction is unknown',
      ],
      commonFailureModes: [
        'Hesitating to be certain before moving',
        'The false step returning under pressure',
        'Crossing the feet or turning the shoulders too early and committing',
      ],
      coachingEmphasis:
        'Vary the interval genuinely. A coach who drops the ball on a rhythm is training timing, and the athlete will get better at the drill without getting better at anything else.',
      practicesMin: 3,
      practicesMax: 5,
      problems: ['slow-first-step'],
      drills: [
        { drill: 'Tennis Ball Drop — See It, Go', role: 'primary', rank: 1,
          rationale: 'Produces the best first step in the pathway because the athlete genuinely cannot anticipate it — and the catch gives them a reason to care.' },
        { drill: 'Mirror Drill — Match the Leader', role: 'primary', rank: 2,
          rationale: 'A live opponent rather than a cue, so the read is continuous and there is no pattern to memorise.' },
        { drill: 'Reaction Start — Go On the Signal', role: 'regression', rank: 1,
          rationale: 'When the false step reappears under pressure, go back to a single known direction and rebuild the clean start.' },
        { drill: 'Game-Speed Reaction Blocking', role: 'game_application', rank: 1,
          rationale: 'The library already holds a read-and-react drill for catchers, and reacting to a ball in the dirt is this stage in full gear.' },
      ],
    },
    {
      key: 'baseball-acceleration',
      name: 'Baseball Acceleration',
      objective:
        'Turn the acceleration mechanics into baserunning — out of the box, off the base, and into a steal.',
      whyItMatters:
        'This is where the pathway either pays off or does not. Seven stages of general movement are worth nothing to a baseball team until they show up in the ninety feet between home and first.',
      masterySignals: [
        'Exits the batter\'s box without wasted steps',
        'First three steps toward first are aggressive',
        'Crossover step on a steal gains ground',
        'No shuffle-shuffle-turn pattern when breaking for the next base',
      ],
      commonFailureModes: [
        'Watching the ball instead of running',
        'Standing up out of the box the way they stood up out of a sprint start',
        'Hopping or shuffling before the crossover',
      ],
      coachingEmphasis:
        'Every drill in this stage already existed in the library. The new part is the player arriving at them able to accelerate — so coach the baseball read, and let the movement be the thing they already own.',
      practicesMin: 3,
      practicesMax: 6,
      problems: [],
      drills: [
        { drill: 'Swing and Sprint', role: 'primary', rank: 1,
          rationale: 'The most repeated sprint in the sport, started from where it actually starts. The acceleration angle from stage 2 either transfers out of the box or visibly does not.' },
        { drill: 'Steal Breaks — Reading the Pitcher & First Move', role: 'primary', rank: 2,
          rationale: 'The crossover from stage 6 with a pitcher to read, which is the change-of-direction work turned into a baseball decision.' },
        { drill: 'First Base Decision', role: 'reinforcement', rank: 1,
          rationale: 'Reading the ball out of the box and rounding the bag, so the sprint has somewhere to go rather than ending at a line on the grass.' },
        { drill: 'Secondary Lead & Delayed Steal', role: 'progression', rank: 1,
          rationale: 'Acceleration from a moving start, which is harder than from a stop and is the situation a secondary lead always creates.' },
        { drill: 'Simple Base Running Drills for Youth Practice', role: 'reinforcement', rank: 2,
          rationale: 'Covers leads, breaks and running through the bag in one block, which is the repetition this stage needs between the sharper drills.' },
      ],
    },
    {
      key: 'position-speed',
      name: 'Position-Specific Speed',
      objective:
        'Turn the first step and the change of direction into defensive movement.',
      whyItMatters:
        'A fielder\'s range is mostly the first two steps. Everything in stages 3, 6 and 7 was pointed here, and this is where a coach sees the pathway in a game without anyone holding a stopwatch.',
      masterySignals: [
        'First move is correct for what the ball did',
        'Uses an efficient crossover rather than a prolonged shuffle',
        'Accelerates immediately after the drop step',
        'Stays in a fielding position while moving quickly',
      ],
      commonFailureModes: [
        'Standing flat at the pitch, so the first step has to be a recovery',
        'Drifting sideways to a ball instead of attacking an angle',
        'Good movement that arrives with the body in no position to field',
      ],
      coachingEmphasis:
        'Add the glove back. A player who moves beautifully and cannot field at the end of it has learned an athletic skill, not a baseball one.',
      practicesMin: 3,
      practicesMax: 6,
      problems: ['poor-fielding-footwork', 'fielding-flat-footed'],
      drills: [
        { drill: 'Outfield Drop Step Drill', role: 'primary', rank: 1,
          rationale: 'The one defensive movement most obviously built out of a crossover, and the one where a slow first step is most expensive.' },
        { drill: 'Ready and Go — Outfield First Step', role: 'primary', rank: 2,
          rationale: 'Four directions off an unknown read, which is stage 7 with a glove on.' },
        { drill: 'Four Cones Ground Ball Drill', role: 'reinforcement', rank: 1,
          rationale: 'Lateral movement into a fielding position, so the cutting from stage 6 has to end somewhere useful.' },
        { drill: 'Three-Ball Slow Roller Drill', role: 'progression', rank: 1,
          rationale: 'Charging under control and throwing on the move — acceleration and deceleration inside one play.' },
        { drill: 'On the Run', role: 'game_application', rank: 1,
          rationale: 'Route running and catching on the move, which is the whole pathway arriving at the same moment.' },
      ],
    },
    {
      key: 'game-speed-and-retest',
      name: 'Game-Speed Integration & Retest',
      objective:
        'Hold the movement together under competitive pressure, and repeat the baseline measurements.',
      whyItMatters:
        'Technique that only survives a drill has not transferred. This stage puts the player in a race and in a game read, then takes the four numbers again — not to pass or fail them, but to give the coach something to look at alongside what they have been watching for weeks.',
      masterySignals: [
        'Movement quality holds up under reaction pressure',
        'Technique stays intact at full speed',
        'All four measurements repeated under the same conditions as the baseline',
        'Coach has decided whether the pathway is complete or worth recycling into specific stages',
      ],
      commonFailureModes: [
        'Mechanics falling apart as soon as the drill becomes a competition',
        'Treating a faster time as proof and a slower one as failure, when a stopwatch in a parent\'s hand is not that precise',
        'Retesting tired, at the end of a practice, and comparing it to a baseline taken fresh',
      ],
      coachingEmphasis:
        'Do NOT require every number to improve before completing the pathway. A child who grew two inches mid-season can move better and time slower. The measurements inform the decision; the coach makes it.',
      practicesMin: 1,
      practicesMax: 3,
      problems: [],
      drills: [
        { drill: 'Speed Benchmark Test — Time It and Write It Down', role: 'assessment', rank: 1,
          rationale: 'The same four measurements taken the same way, which is the only thing that makes the baseline in stage 1 worth having recorded.' },
        { drill: 'Base Running Athletic Circuit', role: 'primary', rank: 1,
          rationale: 'Acceleration, turning and deceleration in one timed circuit — the library already had it, and it is this pathway with a stopwatch on it.' },
        { drill: 'Chase Start — Five-Yard Race', role: 'assessment', rank: 2,
          rationale: 'Competitive pressure on the first step, which is how a coach sees whether stage 3 holds once the player stops thinking about their feet.' },
        { drill: 'Mirror Drill — Match the Leader', role: 'game_application', rank: 1,
          rationale: 'Reactive movement against a live opponent, which is the closest this pathway gets to a game without being one.' },
        { drill: 'Broad Jump — Jump and Stick It', role: 'assessment', rank: 2,
          rationale: 'Part of the retest, and the one measurement where a bigger number is the better one — a useful contrast for a coach reading four results at once.' },
      ],
    },
  ],
}
