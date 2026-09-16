// Can a volunteer coach run this drill from the text alone?
//
// THE RULE THIS FILE EXISTS FOR
//
// A schedulable curated activity must be understandable and runnable from
// BenchCoach's own words. A video is enrichment. The coach standing in a car
// park with a bucket of balls and no signal is the one this library is for, and
// a row that only works with a video attached does not work for them.
//
// WHY IT IS NOT A CHARACTER COUNT
//
// "Work on proper batting stance fundamentals." is 43 characters of nothing. It
// names the topic and says not one thing a coach could do. Length alone would
// pass it at any threshold low enough to be useful and fail real drills that
// happen to be terse. So the gate asks three questions instead:
//
//   1. is there a description with actual content in it, not a restatement of
//      the drill's own name and not a stock phrase
//   2. does it say what HAPPENS — an arrangement, a rep, an object, a person
//   3. is it about the coach's practice, not about a video
//   4. is there coaching detail beyond the description: what to say, or what
//      to watch for
//
// WHY (3) IS ITS OWN QUESTION
//
// "Coach Duke and Coach Steve from Dominate the Diamond walk through the
// three-phase throwing progression" is a real sentence in this library, on a
// schedulable row, and it is 250 characters of concrete nouns. It passes every
// length and vocabulary test and it is still the wrong kind of text: the
// subject is somebody in a video, and the coach reading it has been handed a
// review instead of instructions. These rows are the exact ones that stop
// working when the video does, so a gate about running the drill without media
// has to catch them.
//
// WHAT THIS DELIBERATELY DOES NOT APPLY TO
//
// Coach-authored drills. A coach writing down the station they invented owes
// nobody a success marker, and holding their note to an editorial standard
// would be both rude and pointless — they already know how to run it. The gate
// is for the curated library, which is the part BenchCoach is responsible for.

export interface InstructionFields {
  drill_name?: string | null
  description?: string | null
  ai_coaching_notes?: string | null
  success_markers?: string[] | null
  equipment_needed?: string[] | null
  est_duration_minutes?: number | null
  min_age?: number | null
  max_age?: number | null
  age_range?: string | null
  difficulty_level?: string | null
  practice_roles?: string[] | null
  regression_notes?: string | null
  progression_notes?: string | null
  safety_notes?: string | null
  created_by_coach_id?: string | null
  [key: string]: any
}

export type Tier = 'READY' | 'USABLE' | 'THIN'

const text = (v: any) => String(v ?? '').trim()
const arr = (v: any) => (Array.isArray(v) ? v.filter(x => text(x)) : [])

/**
 * Phrases that describe a topic rather than an activity.
 *
 * Every one of these was lifted from a real row in this library. "Work on
 * proper batting stance fundamentals" is the whole of one drill's description,
 * and it is indistinguishable from the drill's own title.
 */
const STOCK = [
  /^work on\b/i,
  /^practice\s+(?:proper|basic|good)\b/i,
  /^(?:basic|proper|comprehensive|essential|fundamental)s?\b.{0,40}\b(?:fundamentals|technique|instruction|drills?)\.?$/i,
  /\bfundamentals\.?$/i,
  /^(?:a\s+)?(?:drill|exercise)\s+(?:for|to)\b.{0,30}\.?$/i,
]

/**
 * Phrases whose subject is a video or its presenter rather than the drill.
 *
 * Deliberately narrow. Naming a source is fine — "the Ripken tee progression"
 * is a drill. What is caught here is prose ABOUT a recording: somebody
 * demonstrating, a video covering, an endorsement, a credential. Those are
 * reasons to trust the drill, not instructions for running it.
 */
const VIDEO_FRAMING = [
  /\b(?:this|the) video\b/i,
  /\bvideo (?:shows|covers|walks|demonstrat)/i,
  /\bwalks? (?:you )?through\b/i,
  /\b(?:coach|former|official)\b[^.]{0,70}\b(?:demonstrates?|breaks down|walks|explains)\b/i,
  /\b(?:demonstrat\w+|showcas\w+)\b[^.]{0,40}\b(?:drill|routine|progression|technique)\b/i,
  /\bendorsed by\b/i,
  /\b(?:former (?:pro|mlb)|first-round draft pick)\b/i,
  /\btutorial\b/i,
]

/**
 * Words that mean something is physically arranged, done, or measured.
 *
 * The list grew once, deliberately. It originally failed "Rapid-fire three-ball
 * slow roller drill: charge, field on the run, and throw on the move under time
 * pressure" — which describes an activity about as concretely as English
 * allows — because it held `fielder` but not `field`, and `runner` but not
 * `runners`. That is a defect in the rule, not a thin drill, and the fix is
 * more vocabulary rather than a lower threshold.
 */
const CONCRETE = [
  // people
  'coach', 'coaches', 'partner', 'partners', 'feeder', 'player', 'players', 'hitter', 'hitters',
  'fielder', 'fielders', 'runner', 'runners', 'catcher', 'pitcher', 'thrower', 'tosser',
  'group', 'groups', 'pair', 'pairs', 'line', 'lines', 'team',
  // objects and places
  'tee', 'ball', 'balls', 'bucket', 'cone', 'cones', 'net', 'screen', 'bat', 'glove', 'gloves',
  'base', 'bases', 'bag', 'plate', 'mound', 'target', 'targets', 'wall', 'fence', 'tape', 'chalk',
  'station', 'stations', 'infield', 'outfield', 'field',
  // what happens
  'toss', 'tosses', 'throw', 'throws', 'throwing', 'roll', 'rolls', 'rolled', 'swing', 'swings',
  'catch', 'catches', 'field', 'fields', 'fielding', 'hit', 'hits', 'pitch', 'pitches',
  'grounder', 'grounders', 'hop', 'hops', 'charge', 'sprint', 'shuffle', 'jog', 'tag', 'slide',
  'step', 'steps', 'stand', 'stands', 'kneel', 'kneeling', 'run', 'runs', 'move', 'moves',
  // body and measurement
  'feet', 'foot', 'hand', 'hands', 'knee', 'knees', 'hip', 'hips', 'eyes', 'head',
  'arm', 'arms', 'leg', 'legs', 'shoulder', 'shoulders', 'elbow', 'elbows', 'wrist',
  'chest', 'body', 'back',
  'rep', 'reps', 'round', 'rounds', 'set', 'sets', 'circuit', 'count', 'seconds', 'minutes',
  'distance', 'apart', 'behind', 'front', 'side', 'sideways', 'start', 'starts',
  'alternate', 'rotate', 'forward', 'backward', 'yards',
  // conditioning and arm care, which are activities too — the list was built
  // from throwing and fielding drills and had no words for a warm-up at all,
  // so a routine of leg swings and walking lunges scored as abstract.
  'stretch', 'stretches', 'lunge', 'lunges', 'squat', 'jog', 'walk', 'walking',
  'stride', 'pivot', 'turn', 'lean', 'drop', 'release', 'grip', 'stance',
  'band', 'bands', 'circles', 'rotation', 'rotations', 'anchor', 'exercise', 'exercises',
]

/**
 * Is this text about a recording rather than about a practice?
 *
 * Exported because "rewrite this so it is about the drill" is a different
 * editorial job from "write this, there is nothing here", and the audit should
 * be able to say which one a row needs.
 */
export function describesAVideo(d: InstructionFields): boolean {
  return VIDEO_FRAMING.some(re => re.test(text(d.description)))
}

/**
 * Does this description describe an ACTIVITY, or only name a topic?
 *
 * Exported so the audit and the tests ask the same question rather than two
 * similar ones.
 */
export function describesAnActivity(d: InstructionFields): boolean {
  const desc = text(d.description)
  if (desc.length < 60) return false
  if (describesAVideo(d)) return false

  // A description that is mostly the drill's own name restated says nothing the
  // title did not.
  const name = text(d.drill_name).toLowerCase()
  const stripped = desc.toLowerCase().replace(name, '').replace(/[^a-z\s]/g, ' ').trim()
  if (stripped.split(/\s+/).filter(Boolean).length < 8) return false

  if (STOCK.some(re => re.test(desc))) return false

  // Matched against the singular too. Without this the list needs every plural
  // spelled out, and the ones that get forgotten fail real rows for no reason —
  // "Pitchers perform each part in slow motion" missed because the list held
  // `pitcher` and not `pitchers`, which is a typo masquerading as a standard.
  const found = new Set<string>()
  for (const w of desc.toLowerCase().match(/[a-z]+/g) || []) {
    found.add(w)
    if (w.endsWith('s')) found.add(w.slice(0, -1))
  }
  return CONCRETE.filter(w => found.has(w)).length >= 3
}

/**
 * Cue text that appears on more than one drill, and is therefore about the
 * category rather than about any drill in it.
 *
 * "Cue: low hips, quiet head; field out front; quick exchange." is on eight
 * separate infield rows. It is true of all of them and it is the reason a coach
 * opening the eighth one learns nothing they did not learn from the first. A
 * per-row predicate cannot see this — the row looks fine on its own — so the
 * caller computes the set once and hands it in.
 *
 * Optional everywhere it is used. Passing nothing means "I have not checked",
 * which keeps the single-row call sites (and the tests) honest and simple.
 */
export interface GateContext {
  boilerplate?: Set<string>
}

export function findBoilerplate(rows: InstructionFields[]): Set<string> {
  const seen = new Map<string, number>()
  for (const r of rows) {
    const t = text(r.ai_coaching_notes)
    if (t) seen.set(t, (seen.get(t) || 0) + 1)
  }
  return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([t]) => t))
}

/** Coaching cues that are real, specific to this drill, and long enough to say something. */
function hasOwnCues(d: InstructionFields, ctx: GateContext = {}): boolean {
  const t = text(d.ai_coaching_notes)
  if (t.length < 40) return false
  return !ctx.boilerplate?.has(t)
}

/**
 * The minimum bar for a curated schedulable row: a real description, plus
 * coaching detail somewhere beyond it.
 *
 * Coach-authored rows always pass — see the header. So do rows that are not
 * offered as activities at all; a source collection has nothing to be runnable
 * about, and failing it here would just add noise to the number that matters.
 */
export function isInstructionReady(d: InstructionFields, ctx: GateContext = {}): boolean {
  if (d.created_by_coach_id) return true
  if (!describesAnActivity(d)) return false
  return hasOwnCues(d, ctx) || arr(d.success_markers).length > 0
}

/**
 * READY / USABLE / THIN.
 *
 * READY means a coach who has never seen the drill can set it up, run it, know
 * what to say, and know whether it is working. That is four things, and all
 * four have to be present — it is the bar for "you do not need the video".
 */
export function instructionTier(d: InstructionFields, ctx: GateContext = {}): Tier {
  if (!isInstructionReady(d, ctx)) return 'THIN'

  const hasCues = hasOwnCues(d, ctx)
  const hasMarkers = arr(d.success_markers).length >= 2
  const hasNextStep = text(d.regression_notes).length > 0 || text(d.progression_notes).length > 0
  const substantial = text(d.description).length >= 180

  return hasCues && hasMarkers && hasNextStep && substantial ? 'READY' : 'USABLE'
}

/** The specific things missing, so an editor knows what to write rather than that something is wrong. */
export function missingPieces(d: InstructionFields, ctx: GateContext = {}): string[] {
  const out: string[] = []
  if (describesAVideo(d)) out.push('description is about the video, not the drill')
  else if (!describesAnActivity(d)) out.push('description does not describe an activity')
  else if (text(d.description).length < 180) out.push('description is thin on setup or execution')
  if (ctx.boilerplate?.has(text(d.ai_coaching_notes))) out.push('coaching cues are copied across the category')
  else if (text(d.ai_coaching_notes).length < 40) out.push('no coaching cues')
  if (arr(d.success_markers).length < 2) out.push('fewer than two success markers')
  if (!text(d.regression_notes) && !text(d.progression_notes)) out.push('no progression or regression')
  if (arr(d.equipment_needed).length === 0) out.push('no equipment listed')
  if (!d.est_duration_minutes) out.push('no duration')
  if (!d.min_age && !text(d.age_range)) out.push('no age fit')
  if (!text(d.difficulty_level)) out.push('no difficulty')
  if (arr(d.practice_roles).length === 0) out.push('no practice role')
  return out
}
