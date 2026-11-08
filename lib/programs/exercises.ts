// Built-in program exercises.
//
// These are NOT drill-library records and are never written to drill_resources.
// The curated library stays the primary source of baseball drills. These cover
// what the library does not carry: warm-ups, athletic-strength and balance
// work, readiness checks, and the short "no ball, no bat, no partner" routines
// a child can do alone.
//
// Why static data instead of model output: whether something is safe to do
// unsupervised is a safety claim, and safety claims do not come from a
// language model. `supervision` here is the only authority the generator
// consults; the validator re-derives it from the exercises in a session.

import type { BlockKind, Supervision, SkillKey, DrillRow } from './types'

export interface Exercise {
  key: string
  name: string
  skill: SkillKey
  kind: BlockKind
  /** The LEAST supervision this exercise may be done with. */
  supervision: Supervision
  equipment: string[]
  /** Minimum age this exercise is written for. */
  minAge: number
  intensity: DrillRow['intensity']
  minutes: number
  sets: number | null
  reps: string | null
  rest: string | null
  instructions: string[]
  cues: string[]
  success: string[]
  modification: string
  /** Strength exercises carry a progression ladder a coach can step through. */
  progression?: { easier: string; harder: string }
  /** Used by the phase selector: which phases this suits. */
  phases: Array<'foundation' | 'controlled' | 'reactive' | 'game_speed' | 'evaluation'>
}

const ALL = ['foundation', 'controlled', 'reactive', 'game_speed', 'evaluation'] as const
type P = Exercise['phases']
const ex = (e: Omit<Exercise, 'phases'> & { phases?: P }): Exercise => ({ phases: [...ALL], ...e })

export const EXERCISES: Exercise[] = [
  // ── warm-up and cool-down ────────────────────────────────────────────────
  ex({
    key: 'dynamic_warmup', name: 'Dynamic warm-up', skill: 'strength_athleticism', kind: 'warmup',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 8, sets: null, reps: '2 passes of each, about 15 yards',
    rest: null,
    instructions: [
      'Easy jog down and back to raise the heart rate.',
      'Walking knee hugs, walking quad pulls, and walking lunges with a twist.',
      'Side shuffles, high knees, and butt kicks — relaxed, not racing.',
      'Finish with 5 arm circles each direction and 5 bodyweight squats.',
    ],
    cues: ['Warm, not tired.'],
    success: ['Moves smoothly through each position without rushing.'],
    modification: 'Indoors, march and shuffle in place or down a hallway; skip the jog.',
  }),
  ex({
    key: 'cooldown_mobility', name: 'Cool-down and mobility', skill: 'strength_athleticism', kind: 'cooldown',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 5, sets: null, reps: 'about 30 seconds each',
    rest: null,
    instructions: [
      'Walk one lap to bring the heart rate down.',
      'Hold a standing quad stretch, a hamstring reach, a hip-flexor lunge stretch and a chest-open stretch, 30 seconds each side.',
      'Ask the player two questions: what felt good and what felt off today?',
    ],
    cues: ['Breathe slow.'],
    success: ['Player can name one thing that went well.'],
    modification: 'Skip any stretch that pinches; never stretch into pain.',
  }),
  ex({
    key: 'session_review', name: 'Two-minute review', skill: 'strength_athleticism', kind: 'cooldown',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 3, sets: null, reps: null, rest: null,
    instructions: [
      'Ask the player what the one cue of the day was and whether it felt easier than last time.',
      'Mark completion, note any pain or fatigue, and record anything you want to tell the coach.',
    ],
    cues: ['One thing we are getting better at.'],
    success: ['Player can say the day’s cue in their own words.'],
    modification: 'If the player is tired or upset, keep it to one sentence and finish on something they did well.',
  }),

  // ── first step and acceleration ──────────────────────────────────────────
  ex({
    key: 'wall_drive', name: 'Wall drive posture', skill: 'acceleration', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 4, sets: 3, reps: '6 slow knee drives each leg', rest: '30 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Lean into a wall with straight arms, body in one straight line from head to ankle at about a 45-degree lean.',
      'Drive one knee up until the thigh is level, foot flexed under the knee, then snap it back down and switch legs.',
      'Keep the line from head to ankle. If the hips sag or the back arches, stand up and reset.',
    ],
    cues: ['Straight line. Knee up. Foot under the knee.'],
    success: ['Holds a straight line for all 6 drives on each leg.'],
    modification: 'Stand more upright against the wall if the lean is too hard to hold.',
  }),
  ex({
    key: 'acceleration_march', name: 'Acceleration march and skip', skill: 'acceleration', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 5, sets: 3, reps: '10 yards march, 10 yards skip', rest: 'walk back',
    phases: ['foundation', 'controlled'],
    instructions: [
      'March with a forward lean, driving the knee up and the opposite arm back, for 10 yards.',
      'Turn the march into an A-skip for another 10 yards: knee up, quick tap down under the hip.',
      'Walk back to recover — every rep should start fresh.',
    ],
    cues: ['Lean. Drive. Tall arms back.'],
    success: ['Arms and legs alternate smoothly; the body stays leaned, not bent at the waist.'],
    modification: 'Do the march only if the skip rhythm is not there yet.',
  }),
  ex({
    key: 'stand_and_go', name: 'Stand-and-go starts', skill: 'acceleration', kind: 'skill',
    supervision: 'parent', equipment: [], minAge: 7, intensity: 'fast', minutes: 8, sets: 6, reps: '1 start, 5–10 yards, full effort', rest: '45–60 sec walk back',
    phases: ['controlled', 'reactive', 'game_speed'],
    instructions: [
      'Start in a comfortable athletic stance with a staggered foot, weight on the balls of the feet.',
      'On "go", push the ground back hard for 3 steps and keep the lean for 5–10 yards, then slow down gradually — do not stop short.',
      'Rest fully between starts so each one is fast. If the starts slow down, end the set.',
    ],
    cues: ['Push the ground away.'],
    success: ['The first three steps are short and quick with the body leaned forward.'],
    modification: 'Use a half-speed start for the first two reps as a rehearsal.',
  }),
  ex({
    key: 'reaction_start', name: 'Reaction starts (clap, hand drop)', skill: 'first_step', kind: 'skill',
    supervision: 'parent', equipment: [], minAge: 7, intensity: 'fast', minutes: 8, sets: 6, reps: '1 start, 5 yards', rest: '45 sec',
    phases: ['reactive', 'game_speed', 'controlled'],
    instructions: [
      'Player waits in a ready stance facing the parent, who stands to the side with a hand at shoulder height.',
      'Parent drops the hand or claps at a random time. The player pushes off and sprints 5 yards in the direction the parent points.',
      'Change the signal timing every rep so the start cannot be guessed. Count the number of starts with a clean first push.',
    ],
    cues: ['Eyes on the hand. Push, don’t step back.'],
    success: ['No false step or rock-back on at least 7 of 10 starts.'],
    modification: 'Use a single known direction until two sets in a row are clean, then add a left/right choice.',
  }),
  ex({
    key: 'lateral_shuffle_stop', name: 'Shuffle, push and stop', skill: 'first_step', kind: 'skill',
    supervision: 'parent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 6, sets: 4, reps: '3 shuffles each way then a sprint push', rest: '30 sec',
    phases: ['foundation', 'controlled', 'reactive'],
    instructions: [
      'Mark two lines about 5 yards apart with shoes or tape.',
      'Shuffle to one line staying low, plant the outside foot and push back the other way for the 5 yards.',
      'On the second rep, add a stop and hold the landing for two seconds before the next push.',
    ],
    cues: ['Low hips. Push off the outside foot.'],
    success: ['Lands with the knee over the foot and holds the stop without wobbling.'],
    modification: 'Shorten the distance to 3 yards if the stop feels uncontrolled.',
  }),
  ex({
    key: 'first_step_shadow', name: 'First-step shadow footwork', skill: 'first_step', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 4, sets: 3, reps: '6 quick pushes (left, right, back)', rest: '30 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Stand in a ready position with feet a little wider than the shoulders and weight on the balls of the feet.',
      'Call out a direction to yourself and push off that way for two quick steps; return to the ready position and reset.',
      'Make each push quiet and fast — no stomping, no long first step.',
    ],
    cues: ['Ready. Push. Reset.'],
    success: ['Both feet start the move together; weight never rocks backward first.'],
    modification: 'Slow the pace and focus on the push foot if balance is shaky.',
  }),

  // ── outfield footwork that needs no ball ─────────────────────────────────
  ex({
    key: 'drop_step_shadow', name: 'Drop-step and crossover shadow', skill: 'outfield_tracking', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 5, sets: 3, reps: '4 each side', rest: '30 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Start in a ready position. Imagine a ball hit over your left shoulder.',
      'Open the left hip, pick the left foot straight back (drop step), then turn and run three or four crossover steps.',
      'Look back toward where the ball would be on the third step, then repeat to the right side.',
    ],
    cues: ['Open, drop, go. Eyes back up.'],
    success: ['The feet never cross before the hips open; the head turns after the third step.'],
    modification: 'Walk the drop step slowly for the first set.',
  }),

  // ── infield shadow work ──────────────────────────────────────────────────
  ex({
    key: 'ready_position_shadow', name: 'Ready position and funnel shadow', skill: 'infield_fundamentals', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 4, sets: 3, reps: '8 slow reps', rest: '20 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Get into a ready position: feet wide, knees bent, glove low and out front.',
      'Take two shuffle steps toward an imaginary ground ball and bring the glove to the ground out front.',
      'Bring both hands to the middle of the chest — the funnel — and step into a throw position.',
    ],
    cues: ['Glove down. Funnel to the middle.'],
    success: ['Glove is out front and below the knees at the moment of the pretend field.'],
    modification: 'Use a rolled-up sock instead of a glove if no glove is handy.',
  }),

  // ── hitting without a bat ────────────────────────────────────────────────
  ex({
    key: 'balance_stride_shadow', name: 'Balance, stride and hands-stay-back shadow', skill: 'hitting', kind: 'skill',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 4, sets: 3, reps: '6 slow reps', rest: '20 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Stand in the batting stance with hands up by the back shoulder — no bat.',
      'Lift the front foot slightly, hold for a one-second balance, then stride softly toward the pitcher while the hands stay back.',
      'Land on the front foot with the hands still behind it. Freeze for two seconds, then reset.',
    ],
    cues: ['Stride and stay back.'],
    success: ['Hands do not move toward the pitcher before the front foot lands.'],
    modification: 'Hold a towel at the back shoulder so the hands have something to hold in place.',
  }),

  // ── strength and athleticism ─────────────────────────────────────────────
  ex({
    key: 'bodyweight_squat_hinge', name: 'Squat and hip-hinge pattern', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 6, sets: 2, reps: '8 squats, 8 hip hinges', rest: '30 sec',
    phases: ['foundation', 'controlled'],
    instructions: [
      'Squat: feet shoulder-width, sit the hips back and down, keep the heels flat and the chest up, stand tall.',
      'Hinge: with a flat back and soft knees, push the hips back as if closing a door with the backside, then stand tall.',
      'Move slowly — 2 seconds down, 1 second up.',
    ],
    cues: ['Hips back, chest proud.'],
    success: ['Heels stay down and the back stays flat on every rep.'],
    modification: 'Squat to a chair if depth or balance is a problem.',
    progression: { easier: 'Box squat to a chair', harder: 'Goblet squat with a light dumbbell (supervised)' },
  }),
  ex({
    key: 'balance_landing', name: 'Single-leg balance and stick-the-landing', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'easy', minutes: 5, sets: 3, reps: '20-sec balance each leg; 5 small hops and stick', rest: '30 sec',
    phases: ['foundation', 'controlled', 'reactive'],
    instructions: [
      'Stand on one leg with hands on hips for 20 seconds; if you wobble badly, put the foot down and restart the count.',
      'Hop forward from two feet (a distance you can land cleanly, no higher than a stair) and land quietly on both feet; hold the landing for 2 seconds.',
      'Progress to a one-foot landing only after five clean two-foot landings.',
    ],
    cues: ['Land quiet. Knees over toes.'],
    success: ['Holds the landing for 2 seconds with knees tracking over the feet.'],
    modification: 'Keep a hand near a wall for balance on the first set.',
  }),
  ex({
    key: 'plank_bear_crawl', name: 'Plank and bear crawl', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'independent', equipment: [], minAge: 6, intensity: 'moderate', minutes: 5, sets: 3, reps: '20-sec plank; 10-yard bear crawl', rest: '30 sec',
    phases: ['foundation', 'controlled', 'reactive'],
    instructions: [
      'Plank on the forearms with a straight line from head to heels. Stop the hold when the hips sag.',
      'Bear crawl: hands and feet on the floor, knees just off the ground, opposite hand and foot move together.',
      'Keep the back flat — imagine balancing a cup on the lower back.',
    ],
    cues: ['Flat back, opposite hand and foot.'],
    success: ['Plank holds 20 seconds with a straight line.'],
    modification: 'Plank from the knees.',
  }),
  ex({
    key: 'band_pull_apart', name: 'Light band pulls and rows', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'parent', equipment: ['resistance bands'], minAge: 7, intensity: 'moderate', minutes: 6, sets: 2, reps: '10 pull-aparts, 10 rows', rest: '45 sec',
    phases: ['controlled', 'reactive', 'game_speed'],
    instructions: [
      'Check the band for nicks before every use; an adult holds or anchors it at a secure, low point.',
      'Pull-apart: arms straight in front at shoulder height, pull the band apart until the hands are at the sides, squeezing the shoulder blades back.',
      'Row: anchored band, pull the hands toward the ribs with the elbows close.',
      'Choose a band the player can use for all reps with good posture — never a band that makes the shoulders shrug.',
    ],
    cues: ['Squeeze the shoulder blades.'],
    success: ['All reps use a controlled 2-second return with no shrugging.'],
    modification: 'Use the lightest band, or no band, and focus on the posture.',
    progression: { easier: 'Lighter band or tempo only', harder: 'Heavier band only after two weeks of clean reps' },
  }),
  ex({
    key: 'goblet_squat_row', name: 'Goblet squat and single-arm row (light dumbbell)', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'parent', equipment: ['dumbbells'], minAge: 7, intensity: 'moderate', minutes: 8, sets: 2, reps: '8 goblet squats, 8 rows each arm', rest: '60 sec',
    phases: ['controlled', 'reactive', 'game_speed'],
    instructions: [
      'An adult watches every rep. Use a dumbbell light enough that the player can squat 8 times with perfect form and still do 3 more.',
      'Goblet squat: hold the dumbbell at the chest, sit down between the knees, chest up, stand tall.',
      'Row: one hand and knee on a bench or couch, pull the dumbbell to the ribs and lower it slowly.',
      'No maximum lifts and no jerking the weight. Stop the set when form changes.',
    ],
    cues: ['Light weight, perfect form.'],
    success: ['Full range and a flat back on every rep with a weight the player could lift 3 more times.'],
    modification: 'Use bodyweight squats and a water bottle for the row.',
    progression: { easier: 'Bodyweight squats', harder: 'Slightly heavier dumbbell after two weeks of clean reps' },
  }),
  ex({
    key: 'med_ball_rotational', name: 'Medicine ball rotational throws', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'parent', equipment: ['medicine ball'], minAge: 7, intensity: 'fast', minutes: 6, sets: 3, reps: '5 throws each side', rest: '45 sec',
    phases: ['controlled', 'reactive', 'game_speed'],
    instructions: [
      'Use a light medicine ball (about 2–4 pounds, no heavier) and throw into a padded wall or a catch net — never at a person.',
      'Stand sideways to the target, load onto the back leg, then rotate the hips first and the arms last as you throw.',
      'Reset between throws. Stop if the player loses balance, braces or twists the back.',
    ],
    cues: ['Hips first, arms last.'],
    success: ['The hips rotate before the arms; the player finishes balanced.'],
    modification: 'Use a soft ball or a rolled towel if a medicine ball bounces back too hard.',
  }),
  ex({
    key: 'med_ball_scoop_chest', name: 'Medicine ball scoop and chest throws', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'parent', equipment: ['medicine ball'], minAge: 7, intensity: 'moderate', minutes: 5, sets: 2, reps: '6 scoop throws, 6 chest passes', rest: '45 sec',
    phases: ['controlled', 'reactive', 'game_speed'],
    instructions: [
      'Light ball (about 2–4 pounds). Throw into a padded wall or catch net.',
      'Scoop: squat, swing the ball between the knees and drive up through the legs to launch it forward and up.',
      'Chest pass: hold at the chest, step and push from the legs through the arms.',
    ],
    cues: ['Legs first. Smooth, not heavy.'],
    success: ['Legs drive the throw on every rep.'],
    modification: 'Use a soft ball.',
  }),
  ex({
    key: 'jump_stick_series', name: 'Jump and stick series', skill: 'strength_athleticism', kind: 'strength',
    supervision: 'parent', equipment: [], minAge: 7, intensity: 'moderate', minutes: 6, sets: 3, reps: '3 broad jumps, 3 lateral hops', rest: '45 sec',
    phases: ['reactive', 'game_speed', 'evaluation'],
    instructions: [
      'Broad jump from a standing start and stick the landing for 2 seconds.',
      'Lateral hop from one foot to the other over a line and stick it.',
      'Use a flat, clear surface with good shoe grip. Stop when the landings get noisy.',
    ],
    cues: ['Stick it.'],
    success: ['Quiet, balanced landings on all jumps.'],
    modification: 'Reduce the jump distance; do two-foot lateral hops.',
  }),

  // ── arm care and the throwing-readiness gate ─────────────────────────────
  ex({
    key: 'readiness_check', name: 'Throwing-readiness check (no throwing)', skill: 'pitching_readiness', kind: 'throwing',
    supervision: 'parent', equipment: [], minAge: 7, intensity: 'easy', minutes: 10, sets: null, reps: null, rest: null,
    phases: ['foundation', 'evaluation'],
    instructions: [
      'Ask the player, privately, whether the arm hurts anywhere: shoulder, elbow, or forearm — resting or when reaching overhead. Record the answer.',
      'Check range of motion: reach each arm overhead, behind the head, and across the chest. Compare sides; stop at any pain.',
      'Check shoulder and hip mobility: a bodyweight lunge with a twist and a 20-second single-leg balance each side.',
      'Record anything unusual and who decided whether to start throwing. If there is any pain, swelling, or a history you are unsure about, do not start the throwing ladder — have the player evaluated by a medical professional first.',
    ],
    cues: ['Honest answers. Pain means stop.'],
    success: ['No reported pain; equal range of motion on both sides; clear coach decision recorded.'],
    modification: 'Repeat the check at the start of any week that includes throwing.',
  }),
  ex({
    key: 'arm_care_bands', name: 'Light arm-care circuit', skill: 'pitching_readiness', kind: 'throwing',
    supervision: 'parent', equipment: ['resistance bands'], minAge: 7, intensity: 'easy', minutes: 6, sets: 2, reps: '10 each: external rotation, scapular retraction, wall slides', rest: '30 sec',
    phases: ['foundation', 'controlled', 'reactive', 'game_speed'],
    instructions: [
      'Very light band only; this is endurance and posture work, not strength.',
      'External rotation at the side with the elbow bent 90 degrees, slow out and slower back.',
      'Wall slides: back against the wall, slide the arms up like a goalpost.',
      'Stop at any pain or pinching.',
    ],
    cues: ['Light and slow.'],
    success: ['No compensation in the shoulder; the player does not feel it in the front of the shoulder.'],
    modification: 'Skip the band and do the wall slides alone.',
  }),
]

export const EXERCISE_BY_KEY: Record<string, Exercise> =
  Object.fromEntries(EXERCISES.map(e => [e.key, e]))

export function toDrillRow(e: Exercise, minutes = e.minutes): DrillRow {
  return {
    drillId: null, exerciseKey: e.key, name: e.name, skill: e.skill, minutes,
    sets: e.sets, reps: e.reps, rest: e.rest, intensity: e.intensity,
    instructions: e.instructions, cues: e.cues, success: e.success,
    modification: e.modification, equipment: e.equipment, hasVideo: false,
  }
}

/** Is every piece of equipment this exercise needs actually available? */
export function exerciseEquipmentOk(e: Exercise, have: string[]): boolean {
  if (e.equipment.length === 0) return true
  const got = have.map(h => h.toLowerCase())
  return e.equipment.every(n => got.some(g => g.includes(n.toLowerCase()) || n.toLowerCase().includes(g)
    || (n === 'dumbbells' && /dumbbell/.test(g))
    || (n === 'resistance bands' && /band/.test(g))
    || (n === 'medicine ball' && /med/.test(g))))
}
