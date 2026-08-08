// Focus areas — the unit a priority occupies.
//
// A player works pitching, hitting, fielding and agility in the same week.
// That is just what training looks like, and the system has to model it. What
// does NOT work is stacking several corrections on the same motion: give an
// 8-year-old two cues for his swing and he runs neither properly, and when it
// doesn't move you cannot tell which one failed.
//
// So the rule is one active priority PER AREA, running in parallel, each with
// its own three-week window, its own success criteria and its own check-in.
//
// The drill library's skill_category is too granular to be that unit — "Soft
// Toss" and "Warmup" are drill formats, not things a coach decides to work on
// for three weeks. This maps those onto the seven areas a coach actually plans
// a week around.

export type FocusArea =
  | 'hitting'
  | 'pitching'
  | 'throwing'
  | 'fielding'
  | 'catching'
  | 'baserunning'
  | 'athleticism'

export interface FocusAreaConfig {
  key: FocusArea
  label: string
  // Shown when a coach is choosing which priority a session belongs to
  hint: string
  // Tailwind classes for the chip. Distinct enough to scan a weekly rotation.
  chip: string
}

export const FOCUS_AREAS: Record<FocusArea, FocusAreaConfig> = {
  hitting: {
    key: 'hitting', label: 'Hitting',
    hint: 'Swing, approach, bunting, tee and toss work',
    chip: 'bg-red-100 text-red-700',
  },
  pitching: {
    key: 'pitching', label: 'Pitching',
    hint: 'Delivery, command, velocity, arm care',
    chip: 'bg-blue-100 text-blue-700',
  },
  throwing: {
    key: 'throwing', label: 'Throwing',
    hint: 'Arm action, accuracy, transfer, long toss',
    chip: 'bg-sky-100 text-sky-700',
  },
  fielding: {
    key: 'fielding', label: 'Fielding',
    hint: 'Infield, fly balls, outfield reads, team defense',
    chip: 'bg-green-100 text-green-700',
  },
  catching: {
    key: 'catching', label: 'Catching',
    hint: 'Receiving, blocking, throwing down',
    chip: 'bg-purple-100 text-purple-700',
  },
  baserunning: {
    key: 'baserunning', label: 'Baserunning',
    hint: 'Leads, jumps, turns, stealing',
    chip: 'bg-amber-100 text-amber-800',
  },
  athleticism: {
    key: 'athleticism', label: 'Athleticism',
    hint: 'Speed, agility, mobility, general movement',
    chip: 'bg-slate-100 text-slate-700',
  },
}

export const FOCUS_AREA_ORDER: FocusArea[] = [
  'hitting', 'pitching', 'throwing', 'fielding', 'catching', 'baserunning', 'athleticism',
]

// The library's skill_category values, exactly as they appear in the database.
// Anything not listed falls through to the keyword pass below.
const CATEGORY_TO_AREA: Record<string, FocusArea> = {
  'hitting': 'hitting',
  'bunting': 'hitting',
  'soft toss': 'hitting',
  'pitching': 'pitching',
  'arm care': 'pitching',
  'throwing': 'throwing',
  'fielding (infield)': 'fielding',
  'fielding (fly balls)': 'fielding',
  'fielding': 'fielding',
  'team defense': 'fielding',
  'catching': 'catching',
  'baserunning': 'baserunning',
  'athletic development': 'athleticism',
  'warmup': 'athleticism',
}

// Ordered most-specific first: "outfield" must not be swallowed by "field",
// and "agility" must not lose to an incidental "run".
const KEYWORD_TO_AREA: Array<[RegExp, FocusArea]> = [
  [/\b(catcher|catching|block(ing)?|receiv|pop time)\b/i, 'catching'],
  [/\b(pitch(er|ing)?|mound|velo(city)?|delivery|changeup|curve|arm care)\b/i, 'pitching'],
  [/\b(hit(ting)?|swing|bat(ting)?|tee|bunt|contact|plate|at.?bat)\b/i, 'hitting'],
  [/\b(outfield|infield|ground ?ball|fly ?ball|glove|field(ing)?|defen[cs]e|double play)\b/i, 'fielding'],
  [/\b(throw(ing)?|arm action|long toss|accuracy|transfer)\b/i, 'throwing'],
  [/\b(baserun|base ?running|steal(ing)?|lead ?off|first step|round(ing)? (the )?bag)\b/i, 'baserunning'],
  [/\b(agility|speed|quick(ness)?|mobility|conditioning|athletic|footwork|sprint)\b/i, 'athleticism'],
]

export function isFocusArea(value: unknown): value is FocusArea {
  return typeof value === 'string' && value in FOCUS_AREAS
}

// Resolve a focus area from whatever the diagnosis produced. Categories are
// the reliable signal; the text is the fallback for goals like "how do we get
// faster" that never match a catalogued problem.
export function resolveFocusArea(
  categories: string[] | null | undefined,
  text?: string | null
): FocusArea | null {
  for (const c of categories || []) {
    const hit = CATEGORY_TO_AREA[String(c).trim().toLowerCase()]
    if (hit) return hit
  }
  const haystack = String(text || '')
  if (haystack.trim()) {
    for (const [pattern, area] of KEYWORD_TO_AREA) {
      if (pattern.test(haystack)) return area
    }
  }
  return null
}

export function focusAreaLabel(area: string | null | undefined): string {
  return isFocusArea(area) ? FOCUS_AREAS[area].label : 'General'
}

export function focusAreaChip(area: string | null | undefined): string {
  return isFocusArea(area) ? FOCUS_AREAS[area].chip : 'bg-gray-100 text-gray-600'
}

// Sort helper so a weekly rotation always renders in the same order rather
// than whatever order the database handed back.
export function focusAreaRank(area: string | null | undefined): number {
  const i = isFocusArea(area) ? FOCUS_AREA_ORDER.indexOf(area) : -1
  return i === -1 ? FOCUS_AREA_ORDER.length : i
}

// The practice builder's focus vocabulary is older and shaped around what a
// team runs stations for, not the areas a priority occupies. This is the
// bridge, so "build a practice around this" arrives with the right box ticked.
const PRACTICE_FOCUS: Record<string, string> = {
  hitting: 'hitting',
  pitching: 'throwing',
  throwing: 'throwing',
  fielding: 'infield',
  catching: 'catching',
  baserunning: 'baserunning',
  // athleticism has no practice-station equivalent — better to preselect
  // nothing than to tick a box the coach didn't mean.
}

export function practiceFocusFor(area: string | null | undefined): string | null {
  if (!area) return null
  return PRACTICE_FOCUS[area] || null
}
