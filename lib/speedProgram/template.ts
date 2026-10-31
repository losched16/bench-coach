// Speed, Agility & Explosiveness — the reusable four-week session template.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// BenchCoach already has a stage-based pathway for this skill
// (`speed-and-agility-development`, migration 074): ten stages, each with
// mastery signals and canonical drills. This file does NOT replace it and
// does NOT add a second set of drills. It is the SESSION layer a coach runs
// on a given week: three session plans (A, B, C) with exact sets, reps, rest,
// cues and space substitutes, across Foundation / Development / Advanced
// variants, over a Learn → Build → Transfer → Integrate four-week sequence.
//
// Every exercise points at the canonical library drill it corresponds to
// (see `drillMap`, mirrored in migration 081's mapping table and checked
// against it by test:speed-program). Where the library has no drill, the
// mapping says so — nothing is invented to fill the gap.
//
// SOURCE AND STATUS
//
// Development-level numbers are the specification's own (Notion: "Speed,
// Agility & Explosiveness — Reusable Youth Baseball Development Pathway",
// 2026-10-31). Foundation and Advanced are derived from that page's stated
// adaptation rules and carry `review: 'draft'` — they have not been reviewed
// by a coach. The prescriptions are a coaching draft, not the original
// creators' instructions, and nothing here is evidence of results.
//
// Video links are creator-credited references the coach may remove or
// replace. They are always `unreviewed`: BenchCoach has not verified them.

export const TEMPLATE_KEY = 'speed-agility-explosiveness'
export const TEMPLATE_VERSION = 1

export type LevelKey = 'foundation' | 'development' | 'advanced'
export type SessionKey = 'A' | 'B' | 'C'
export type SpaceKey = 'indoor_small' | 'outdoor_open'
export type ScoreKind = 'landing' | 'braking' | 'reaction'
export type MatchKind = 'exact' | 'close' | 'partial' | 'none'

export const LEVELS: LevelKey[] = ['foundation', 'development', 'advanced']
export const SESSION_KEYS: SessionKey[] = ['A', 'B', 'C']
export const SCORE_KINDS: ScoreKind[] = ['landing', 'braking', 'reaction']

export interface Reference {
  creator: string
  title: string
  url: string
  /** Always 'unreviewed'. There is no 'verified' state in this feature. */
  status: 'unreviewed'
}

export interface DrillMapEntry {
  /** Canonical library drill name (drill_resources.drill_name), or null. */
  name: string | null
  match: MatchKind
  note: string
}

export interface ExerciseDef {
  key: string
  name: string
  cue: string
  commonError?: string
  /** Which of the three 0–2 scores a coach can observe in this exercise. */
  observe: ScoreKind[]
  drillMap: DrillMapEntry
  references: Reference[]
}

/** One line of a session. Numbers are the prescription for ONE level. */
export interface Prescription {
  exercise: string
  sets: number
  reps: number | string
  /** What `reps` counts: "reps per leg", "trips per side", "total rounds"… */
  repsLabel: string
  /** [min, max] seconds, or null when the coach sets it. */
  rest: [number, number] | null
  restNote?: string
  optional?: boolean
  /** Needs open outdoor space (a straight run longer than a few yards). */
  outdoorOnly?: boolean
  /** What to do instead in a 20×15 ft indoor space. */
  indoorSubstitute?: string
  /** A progression that must be unlocked before this appears / progresses. */
  gate?: string
  lockedText?: string
  unlockedText?: string
  note?: string
}

export interface SessionDef {
  key: SessionKey
  title: string
  theme: string
  items: Prescription[]
}

export interface LevelDef {
  key: LevelKey
  label: string
  /** Advisory only — never used to gate anything. */
  typicalFit: string
  sessionsPerWeek: number
  minutes: string
  dose: string
  readiness: string
  review: 'source' | 'draft'
  adaptations: string[]
  sessions: Record<SessionKey, SessionDef>
}

export interface WeekDef {
  week: 1 | 2 | 3 | 4
  name: 'Learn' | 'Build' | 'Transfer' | 'Integrate and assess'
  focus: string
  effort: string
}

export interface ProgressionDef {
  key: string
  label: string
  description: string
  /** Score kinds that must be observed, and 2/2, across the last two sessions. */
  requires: ScoreKind[]
  outdoorOnly?: boolean
}

// ── exercises ───────────────────────────────────────────────────────────────

const R = (creator: string, title: string, url: string): Reference => ({ creator, title, url, status: 'unreviewed' })

export const EXERCISES: ExerciseDef[] = [
  {
    key: 'warmup', name: 'Warm-up',
    cue: 'Gradual, never maximal.',
    observe: [],
    drillMap: { name: 'Baseball Dynamic Stretches for Youth Players', match: 'partial', note: 'The library routine covers the dynamic stretching; the march, skips, gentle shuffle, backward turn-and-go and two gradual starts are in A-March and A-Skip.' },
    references: [R('TKO Athletic Performance', 'Warm-up: skips, gallops, shuffles, backwards run with turn-and-go', 'https://www.instagram.com/reel/DbSHm9aPrVG/')],
  },
  {
    key: 'wall_drive', name: 'Wall drive or standing march',
    cue: 'Push the ground back.',
    commonError: 'Bent at the waist, or overstriding.',
    observe: [],
    drillMap: { name: 'Wall Drive — Straight Body, Punch the Knee', match: 'exact', note: '' },
    references: [R('Underdog Speed', 'Sprint mechanics: drive back, do not reach forward', 'https://www.instagram.com/reel/DZbPGI2OtlK/')],
  },
  {
    key: 'falling_start', name: 'Falling-start acceleration (5 yards)',
    cue: 'Push, then rise.',
    commonError: 'Standing straight up on the first step.',
    observe: ['braking'],
    drillMap: { name: 'Falling Start — Fall, Then Go', match: 'exact', note: '' },
    references: [],
  },
  {
    key: 'accel_10', name: 'Ten-yard acceleration',
    cue: 'Push, push, push.',
    commonError: 'Reaching the front foot out ahead of the hip.',
    observe: ['braking'],
    drillMap: { name: 'Ten-Yard Acceleration — Push, Push, Push', match: 'exact', note: '' },
    references: [],
  },
  {
    key: 'cone_reaction_chase', name: 'Cone reaction chase',
    cue: 'See, push, go.',
    commonError: 'Anticipating the signal instead of reacting to it.',
    observe: ['reaction'],
    drillMap: { name: 'Tennis Ball Drop — See It, Go', match: 'close', note: 'Chase Start — Five-Yard Race is the competitive version.' },
    references: [R('MVP Sports', 'Chase Game: grab the cone, take off', 'https://www.instagram.com/reel/Dak40ZVOVJT/')],
  },
  {
    key: 'shuffle_stop', name: 'Lateral shuffle and controlled stop',
    cue: 'Brake, plant, push.',
    commonError: 'Standing up, or crossing the feet, to stop.',
    observe: ['braking'],
    drillMap: { name: 'Snap Down — Get Under Control Fast', match: 'partial', note: 'Library drill teaches the controlled stop; the lateral shuffle into it is the exercise here.' },
    references: [R('Coach Mike Physical', 'Low lateral shuffles and cuts around cones', 'https://www.instagram.com/reel/DeorgFRRINU/')],
  },
  {
    key: 'shuffle_plant_accel', name: 'Shuffle, controlled plant, 3-yard acceleration',
    cue: 'Brake, plant, push.',
    commonError: 'Planting with the knee collapsing inward.',
    observe: ['braking', 'reaction'],
    drillMap: { name: 'Shuffle to Sprint — Open the Hips and Go', match: 'close', note: '' },
    references: [],
  },
  {
    key: 'half_circle_cut', name: 'Half-circle cone cut',
    cue: 'Feet under hips, eyes up.',
    commonError: 'Leaning out of the arc.',
    observe: ['braking'],
    drillMap: { name: 'Plant and Go — The 45-Degree Cut', match: 'partial', note: 'Closest library drill. The half-circle arc around three cones has no library drill yet; a draft is in docs/speed-program.' },
    references: [R('UOA Sports', 'Half-circle drills: low start, cut, accelerate', 'https://www.instagram.com/reel/DeO_uGgK7iw/')],
  },
  {
    key: 'react_roll_field', name: 'React to a rolled tennis ball and field',
    cue: 'Move through the ball.',
    commonError: 'Stopping the feet to field.',
    observe: ['reaction', 'braking'],
    drillMap: { name: 'Four Cones Ground Ball Drill', match: 'partial', note: 'Same lateral move into a fielding position; the partner-rolled tennis ball is the reaction cue.' },
    references: [R('Baseball by CT', 'Agility hoop drill: footwork, reaction, ground-ball fundamentals', 'https://www.instagram.com/reel/DZle8fbAKex/')],
  },
  {
    key: 'pogo_jumps', name: 'Low two-foot pogo jumps',
    cue: 'Small, quick, quiet.',
    commonError: 'Big, loud, slow contacts.',
    observe: ['landing'],
    drillMap: { name: 'Pogo Jumps — Quick, Quiet Contacts', match: 'exact', note: '' },
    references: [R('Pierre Elite Performance', '3 drills kids need to master: skipping, pogo jumps, broad jumps', 'https://www.instagram.com/reel/Db0wVLNNKTs/')],
  },
  {
    key: 'broad_jump_freeze', name: 'Broad jump and freeze',
    cue: 'Land like a cat.',
    commonError: 'Landing stiff-legged, or stumbling forward.',
    observe: ['landing'],
    drillMap: { name: 'Broad Jump — Jump and Stick It', match: 'exact', note: '' },
    references: [R('Pierre Elite Performance', '3 drills kids need to master: skipping, pogo jumps, broad jumps', 'https://www.instagram.com/reel/Db0wVLNNKTs/')],
  },
  {
    key: 'skater_step_stick', name: 'Lateral skater step and stick',
    cue: 'Own the landing.',
    commonError: 'Hopping before the single-leg landing is steady.',
    observe: ['landing', 'braking'],
    drillMap: { name: null, match: 'none', note: 'No library drill covers a lateral single-leg landing. A draft is in docs/speed-program for review.' },
    // No reference. The one previously attached showed hurdle hops into single-leg hops, which is the
    // opposite of a step-and-stick with no hop. Removed (docs/speed-program/REFERENCE-REVIEW.md).
    references: [],
  },
  {
    key: 'infield_react_throw', name: 'Infield reaction and throw (controlled pace)',
    cue: 'Keep the feet moving through the play.',
    commonError: 'Planting and stopping before the throw.',
    observe: ['reaction', 'braking'],
    drillMap: { name: 'Three-Ball Slow Roller Drill', match: 'partial', note: 'Charging under control and throwing on the move; the library drill is the closest match.' },
    // No reference. The one previously attached is about double-play footwork, not a controlled
    // reaction and throw. Removed (docs/speed-program/REFERENCE-REVIEW.md).
    references: [],
  },
  {
    key: 'broad_to_accel', name: 'Broad jump into 5-yard acceleration',
    cue: 'Land, then push.',
    commonError: 'Chasing speed through a sloppy landing.',
    observe: ['landing', 'braking'],
    drillMap: { name: 'Broad Jump — Jump and Stick It', match: 'partial', note: 'Library drill covers the jump and stick; the follow-on acceleration is a progression.' },
    references: [],
  },
]

const COOLDOWN = 'Cool-down and cue notes, 2 minutes.'
export const WARMUP_TEXT = '4–5 minutes: march, skips, gentle shuffle, backward turn-and-go and 2 gradual starts.'
export { COOLDOWN as COOLDOWN_TEXT }

// ── Development level: the specification's exact prescriptions ─────────────

// The specification gives this substitute for the 10-yard acceleration. It is
// reused, with the same rep count, for the 5-yard falling start — the page
// does not say what to do indoors there, and a 20×15 ft space leaves almost no
// run-out for a 5-yard start. Flagged as an assumption in docs/speed-program.
const INDOOR_ACCEL = 'Indoors: 3 reps of a controlled 2–3-yard takeoff and brake. Not a full sprint.'
// PENDING COACH APPROVAL (docs/speed-program/INDOOR-FALLING-START.md). The source gives an indoor
// substitute for the 10-yard acceleration only. A 5-yard falling start needs the whole 15 ft side,
// leaving no stopping room, so indoors it becomes a two-step lean-and-catch with a clear run-out.
const INDOOR_FALLING = 'Indoors: lean-and-catch. Lean forward from a standing stance, take two quick low steps (about 2 yards) and land balanced on two feet. Use the 20 ft length and keep 10 ft clear past the stop line. Grippy footwear, dry non-slip floor. If the floor is slick or the space is tight, skip it and add one wall-drive set instead.'

const DEVELOPMENT_SESSIONS: Record<SessionKey, SessionDef> = {
  A: {
    key: 'A', title: 'Day A — First step and acceleration', theme: 'first-step acceleration',
    items: [
      { exercise: 'warmup', sets: 1, reps: 5, repsLabel: 'minutes', rest: null },
      { exercise: 'wall_drive', sets: 2, reps: 5, repsLabel: 'controlled reps per leg', rest: [30, 30] },
      { exercise: 'falling_start', sets: 1, reps: 4, repsLabel: 'reps', rest: [45, 60], indoorSubstitute: INDOOR_FALLING, outdoorOnly: true },
      { exercise: 'accel_10', sets: 1, reps: 3, repsLabel: 'reps', rest: [60, 90], outdoorOnly: true, indoorSubstitute: INDOOR_ACCEL },
      { exercise: 'cone_reaction_chase', sets: 1, reps: 4, repsLabel: 'reps', rest: [45, 60] },
    ],
  },
  B: {
    key: 'B', title: 'Day B — Lateral agility and deceleration', theme: 'lateral agility / change of direction',
    items: [
      { exercise: 'warmup', sets: 1, reps: 5, repsLabel: 'minutes', rest: null },
      { exercise: 'shuffle_stop', sets: 2, reps: 2, repsLabel: 'trips per side (3 yards)', rest: [30, 30] },
      { exercise: 'shuffle_plant_accel', sets: 1, reps: 3, repsLabel: 'reps each direction', rest: [45, 60] },
      { exercise: 'half_circle_cut', sets: 1, reps: 2, repsLabel: 'reps each direction', rest: [45, 60] },
      { exercise: 'react_roll_field', sets: 1, reps: 4, repsLabel: 'total rounds', rest: [30, 45] },
    ],
  },
  C: {
    key: 'C', title: 'Day C — Explosive coordination and baseball transfer', theme: 'jumps, landing and baseball reaction',
    items: [
      { exercise: 'warmup', sets: 1, reps: 5, repsLabel: 'minutes', rest: null },
      { exercise: 'pogo_jumps', sets: 2, reps: 8, repsLabel: 'reps', rest: [45, 45] },
      { exercise: 'broad_jump_freeze', sets: 3, reps: 2, repsLabel: 'reps, freeze 2 seconds', rest: [45, 60] },
      {
        exercise: 'skater_step_stick', sets: 2, reps: 3, repsLabel: 'each side', rest: [45, 60],
        gate: 'skater_hop',
        lockedText: 'Step and pause on one foot. No hop yet.',
        unlockedText: 'Step and stick; a controlled hop is unlocked for this player.',
      },
      { exercise: 'infield_react_throw', sets: 1, reps: '4–6', repsLabel: 'total rounds', rest: [30, 30], restNote: 'about 30 seconds', note: 'Controlled pace.' },
      {
        exercise: 'broad_to_accel', sets: 1, reps: 2, repsLabel: 'reps', rest: [60, 60], optional: true, outdoorOnly: true,
        gate: 'broad_jump_to_sprint',
        note: 'Only if time and quality allow. Replace an exercise rather than adding volume.',
      },
    ],
  },
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// ── Foundation: the page's stated adaptation, applied mechanically ─────────
// "2 sessions/week alternating A and B/C, 1 set for each movement, 2–3 short
// starts, no timed maximal races, low jumps or step instead of hops. 12–18
// min, 2–4 reps per drill." Anything the page does not state is not invented:
// rep counts above 4 are capped to 4, starts become 2–3, hops stay locked.
const START_EXERCISES = new Set(['falling_start', 'accel_10', 'cone_reaction_chase', 'shuffle_plant_accel', 'half_circle_cut'])

function foundationFrom(dev: Record<SessionKey, SessionDef>): Record<SessionKey, SessionDef> {
  const out = clone(dev)
  for (const k of SESSION_KEYS) {
    for (const it of out[k].items) {
      if (it.exercise === 'warmup') continue
      it.sets = 1
      if (START_EXERCISES.has(it.exercise)) { it.reps = '2–3'; it.repsLabel = 'short starts' }
      else if (typeof it.reps === 'number') it.reps = Math.min(it.reps, 4)
      else it.reps = '2–4'
      if (it.exercise === 'broad_jump_freeze') it.note = 'Low, comfortable jumps. Stick the landing.'
      if (it.exercise === 'accel_10') it.note = 'Short starts for form. Not timed, not a race.'
      if (it.exercise === 'infield_react_throw') it.note = 'Play and enjoyment first; easy short throws.'
    }
  }
  return out
}

// ── Advanced: Development structure + the page's stated adaptations ────────
// "4–6 quality short reps and longer recovery". The page gives no rest
// numbers for Advanced, so rest keeps the Development values as a FLOOR and
// the coach sets the rest. Nothing here adds volume and speed together.
function advancedFrom(dev: Record<SessionKey, SessionDef>): Record<SessionKey, SessionDef> {
  const out = clone(dev)
  for (const k of SESSION_KEYS) {
    for (const it of out[k].items) {
      if (it.exercise === 'warmup') continue
      if (START_EXERCISES.has(it.exercise)) { it.reps = '4–6'; it.repsLabel = 'quality short reps' }
      if (it.rest) it.restNote = 'At least this; longer recovery than Development. Coach sets it.'
    }
  }
  return out
}

export const LEVEL_DEFS: Record<LevelKey, LevelDef> = {
  foundation: {
    key: 'foundation', label: 'Foundation', typicalFit: 'Often ages 6–8, or a new mover. Advisory only.',
    sessionsPerWeek: 2, minutes: '12–18 minutes', review: 'draft',
    dose: '2 sessions a week, 12–18 minutes, 2–4 reps per drill. Games and coordinated movement.',
    readiness: 'Can stop balanced on both feet, follow a directional cue, and accelerate without collisions.',
    adaptations: [
      'Two sessions a week, alternating A with B or C.',
      'One set of each movement; 2–3 short starts. No timed maximal races.',
      'Low jumps, or a step instead of a hop.',
      'Prioritize play and enjoyment. Shorten any session that affects focus or mechanics.',
    ],
    sessions: foundationFrom(DEVELOPMENT_SESSIONS),
  },
  development: {
    key: 'development', label: 'Development', typicalFit: 'Often ages 9–12, or younger skilled athletes. Advisory only.',
    sessionsPerWeek: 3, minutes: '20–25 minutes', review: 'source',
    dose: '2–3 sessions a week, 20–25 minutes, 3–5 short reps, full recovery.',
    readiness: 'Consistent mechanics, soft landings, plant and cut with knee tracking and body control.',
    adaptations: [],
    sessions: DEVELOPMENT_SESSIONS,
  },
  advanced: {
    key: 'advanced', label: 'Advanced youth', typicalFit: 'Often ages 13+, or experienced athletes with mature movement skills. Advisory only.',
    sessionsPerWeek: 3, minutes: 'about 25–35 minutes', review: 'draft',
    dose: '2–3 sessions a week, about 25–35 minutes, 4–6 quality short reps and longer recovery. Do not add volume just because the athlete is older.',
    readiness: 'Can maintain technique under faster or sport-reactive demands.',
    adaptations: [
      'More reactive partner cues once unlocked.',
      '10–20-yard acceleration where there is safe outdoor space.',
      'Controlled single-leg hops once unlocked.',
      'Varied baseball starting positions.',
      'Optional supervised resistance work. A trained coach individualizes older or advanced players.',
      'Do not stack harder jumps, added volume and faster cuts in the same week.',
    ],
    sessions: advancedFrom(DEVELOPMENT_SESSIONS),
  },
}

export const WEEKS: WeekDef[] = [
  { week: 1, name: 'Learn', focus: 'Slow walk-throughs, correct start stance, stable two-foot landings, deceleration.', effort: '70–85% effort on complex cuts.' },
  { week: 2, name: 'Build', focus: 'Quicker short bursts on drills already controlled. Introduce reaction cue games.', effort: 'Keep rep counts similar to week 1.' },
  { week: 3, name: 'Transfer', focus: 'Finish a shuffle with fielding or throwing. Controlled broad jump into a short acceleration as a substitute, once unlocked.', effort: 'Preserve rest.' },
  { week: 4, name: 'Integrate and assess', focus: 'Combine first step, cut and reaction with a catch or throw only while technique stays consistent. Retest the chosen measures under the same conditions as the baseline.', effort: 'Quality over volume.' },
]

export const PROGRESSIONS: ProgressionDef[] = [
  { key: 'skater_hop', label: 'Skater hop', description: 'Hop (not just step) in the lateral skater exercise.', requires: ['landing'] },
  { key: 'broad_jump_to_sprint', label: 'Broad jump into a short acceleration', description: 'Add the optional broad jump → 5-yard acceleration. Outdoor only.', requires: ['landing', 'braking'], outdoorOnly: true },
  { key: 'reactive_partner_cues', label: 'Reactive partner cues', description: 'A partner gives the direction cue instead of a fixed pattern.', requires: ['reaction', 'braking'] },
  { key: 'single_leg_hops', label: 'Controlled single-leg hops', description: 'Single-leg hops in the jump work (Advanced).', requires: ['landing'] },
]

export const LEVEL_UP_REQUIRES: ScoreKind[] = ['landing', 'braking', 'reaction']

export const GUARDRAILS: string[] = [
  'Up to three quality high-intensity sessions a week, separated by recovery. Games and hard practices count toward that total, so a game or a hard practice replaces a dedicated session rather than adding to it.',
  'Short accelerations with generous rest. This is never sprint conditioning.',
  'Stop for pain, dizziness, loss of form or a clear drop in speed. Pain is not something to train through.',
  'A parent or coach supervises and checks the run-out and landing space is clear and level.',
  'A 20×15 ft indoor space is for short, controlled footwork, jumps, brakes and short reactions. Not full 10-yard sprints and not home-to-first tests.',
  'No heavy loading. Start with quiet two-foot landings; add single-leg work only with control.',
]

// ── lookups ─────────────────────────────────────────────────────────────────

export const EXERCISE_BY_KEY: Record<string, ExerciseDef> = Object.fromEntries(EXERCISES.map(e => [e.key, e]))

/** Everything a snapshot needs, copied by value so later edits never reach it. */
export function templateSnapshot() {
  return clone({
    template: { key: TEMPLATE_KEY, version: TEMPLATE_VERSION },
    exercises: EXERCISES,
    levels: LEVEL_DEFS,
    weeks: WEEKS,
    progressions: PROGRESSIONS,
    levelUpRequires: LEVEL_UP_REQUIRES,
    guardrails: GUARDRAILS,
    warmup: WARMUP_TEXT,
    cooldown: COOLDOWN,
  })
}
export type PlanSnapshot = ReturnType<typeof templateSnapshot>
