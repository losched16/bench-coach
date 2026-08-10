// Turning a practice plan into a sheet of paper.
//
// The app shows a coach fifteen fields per block, which is right when they are
// sitting on the couch on Sunday night deciding whether the plan is any good.
// It is wrong at 5:40pm on a Tuesday with a bucket in one hand. On the field
// they want what a clipboard gives them: the one goal, the running order with
// times against it, three things to say all night, and a list of what to put
// in the car.
//
// None of that is new information — it is all already in the plan. This file
// derives it, so the printed sheet and the app can never disagree about what
// the practice is. Nothing here does I/O and nothing here calls a model.

export interface PlanBlock {
  type?: string
  title?: string
  minutes?: number
  description?: string
  equipment?: string[]
  coaching_cues?: string[]
  setup?: string
  watch_for?: string
  [k: string]: any
}

export interface PlanContent {
  blocks: PlanBlock[]
  coach_notes: string | null
  flags: string[]
  // The clipboard fields. All optional — every plan written before today has
  // none of them, and the sheet degrades to "no objective line" rather than
  // to a crash.
  objective: string | null
  coaching_points: string[]
  start_time: string | null
  equipment_available: string[]
}

/**
 * Read a plan's `content` column, whatever shape it is in.
 *
 * Three generations are in the database: a bare array of blocks, then
 * `{ blocks, coach_notes, flags }`, and now the clipboard fields. Callers
 * should never branch on which — they ask for what they want and get a
 * defined value.
 */
export function readPlan(content: any): PlanContent {
  const c = Array.isArray(content) ? { blocks: content } : (content || {})
  return {
    blocks: Array.isArray(c.blocks) ? c.blocks : [],
    coach_notes: c.coach_notes || null,
    flags: Array.isArray(c.flags) ? c.flags : [],
    objective: c.objective || null,
    coaching_points: Array.isArray(c.coaching_points) ? c.coaching_points : [],
    start_time: c.start_time || null,
    equipment_available: Array.isArray(c.equipment_available) ? c.equipment_available : [],
  }
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

// What a coach can plausibly have in the car. Taken from the checklist a coach
// actually uses on a paper practice sheet rather than invented — the point of
// asking is that the model stops designing a tee station for a team with no
// tee.
export const EQUIPMENT_OPTIONS = [
  'Baseballs', 'Bats', 'Helmets', 'Bases', 'Cones',
  'Gloves', "Catcher's gear", 'L-screen', 'Tee', 'Water', 'First aid kit',
]

// Counts, containers and per-player phrasing are useful on the page and fatal
// to deduplication: "bucket of baseballs (15+)", "15 baseballs" and "Baseballs"
// are one line on a packing list.
const LEADING_JUNK = /^(?:a|an|the|\d+[-+]?|\d+\s*[-–]\s*\d+)\s+/i
const CONTAINER = /^(?:bucket|bag|basket|box|crate|set|pack)\s+of\s+/i
const TRAILING_QUALIFIER = /\s*(?:\(.*?\)|per\s+player|per\s+pair|per\s+kid|each|minimum|min\.?|or\s+more)\s*$/gi

// Only the collisions that actually happen. A bigger table would fold things
// that must stay apart — tennis balls and wiffle balls are not baseballs, and
// a coach who packs the wrong one has a different practice.
const SYNONYMS: Record<string, string> = {
  'ball': 'baseballs',
  'baseball': 'baseballs',
  'regular baseball': 'baseballs',
  'glove': 'gloves',
  'baseball glove': 'gloves',
  'bat': 'bats',
  'baseball bat': 'bats',
  'helmet': 'helmets',
  'batting helmet': 'helmets',
  'cone': 'cones',
  'marker cone': 'cones',
  'base': 'bases',
  'batting tee': 'tee',
  'hitting tee': 'tee',
  'l screen': 'l-screen',
  'lscreen': 'l-screen',
  'screen': 'l-screen',
  'catchers gear': "catcher's gear",
  'catcher gear': "catcher's gear",
  'catchers mitt': "catcher's mitt",
  'first aid': 'first aid kit',
  'water bottle': 'water',
  'water bottles': 'water',
  'stopwatch or phone timer': 'stopwatch',
  'timer': 'stopwatch',
}

/** The comparison key for one equipment string. Not shown to anyone. */
export function equipmentKey(raw: string): string {
  let s = String(raw || '').trim().toLowerCase()
  s = s.replace(TRAILING_QUALIFIER, '').trim()
  s = s.replace(CONTAINER, '').trim()
  s = s.replace(LEADING_JUNK, '').trim()
  s = s.replace(/[.,;:]+$/, '').trim()
  if (SYNONYMS[s]) return SYNONYMS[s]
  // Crude plural fold, applied last so the synonym table sees the raw form.
  const singular = s.replace(/ies$/, 'y').replace(/(?<!s)s$/, '')
  if (SYNONYMS[singular]) return SYNONYMS[singular]
  return s
}

/**
 * One packing list for the whole practice.
 *
 * Where two blocks name the same thing differently, the label that carries a
 * count wins — "Baseballs (15+)" tells a coach something "Baseballs" does not,
 * and the whole reason for the list is deciding what goes in the car.
 */
export function equipmentChecklist(blocks: PlanBlock[]): string[] {
  const best = new Map<string, string>()
  for (const b of blocks || []) {
    for (const raw of b?.equipment || []) {
      const item = String(raw || '').trim()
      if (!item) continue
      const key = equipmentKey(item)
      if (!key) continue
      const held = best.get(key)
      if (held === undefined || scoreLabel(item) > scoreLabel(held)) best.set(key, item)
    }
  }
  // Array.from rather than a spread: the build target predates downlevel
  // iteration, so spreading a Map iterator compiles here and fails there.
  return Array.from(best.values())
    .map(titleCase)
    .sort((a, b) => a.localeCompare(b))
}

// A label with a number in it beats one without; among equals, the shorter one
// reads better on paper.
function scoreLabel(s: string): number {
  return (/\d/.test(s) ? 100 : 0) - s.length
}

function titleCase(s: string): string {
  const t = s.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ---------------------------------------------------------------------------
// The running order
// ---------------------------------------------------------------------------

export interface ScheduleRow {
  index: number
  from: string
  to: string
  minutes: number
  title: string
  description: string
  type: string
}

/**
 * Blocks with a clock against them.
 *
 * With a start time it prints wall-clock ranges — 5:30–5:40 — because that is
 * what a coach compares against the clock on the dugout wall. Without one it
 * prints elapsed time from zero, which is still useful and never wrong.
 *
 * An unparseable or missing start time falls back to elapsed rather than
 * throwing: a bad time string should cost the sheet its clock column, not the
 * whole practice plan.
 */
export function scheduleRows(blocks: PlanBlock[], startTime?: string | null): ScheduleRow[] {
  const start = parseTime(startTime)
  let elapsed = 0
  return (blocks || []).map((b, index) => {
    const minutes = Math.max(0, Number(b?.minutes) || 0)
    const from = start === null ? elapsedLabel(elapsed) : clockLabel(start + elapsed)
    elapsed += minutes
    const to = start === null ? elapsedLabel(elapsed) : clockLabel(start + elapsed)
    return {
      index,
      from, to, minutes,
      title: b?.title || 'Untitled block',
      description: b?.description || '',
      type: b?.type || 'drill',
    }
  })
}

/** Minutes since midnight, or null if there is no usable time. */
export function parseTime(value?: string | null): number | null {
  if (!value) return null
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (min > 59) return null
  const mer = m[3]?.toLowerCase()
  if (mer) {
    if (h < 1 || h > 12) return null
    if (mer === 'pm' && h !== 12) h += 12
    if (mer === 'am' && h === 12) h = 0
  } else if (h > 23) return null
  return h * 60 + min
}

function clockLabel(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m % 60).padStart(2, '0')}`
}

function elapsedLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Total practice length as the blocks actually add up, not as requested. */
export function plannedMinutes(blocks: PlanBlock[]): number {
  return (blocks || []).reduce((n, b) => n + (Math.max(0, Number(b?.minutes) || 0)), 0)
}

/**
 * The cues worth printing when there is no room for all of them.
 *
 * Used only as a fallback: if the model gave us explicit coaching_points we
 * print those, and this is what a plan written before that field existed gets
 * instead. One cue per block, in order, so the three that surface are spread
 * across the practice rather than three ways of saying the same thing.
 */
export function fallbackCoachingPoints(blocks: PlanBlock[], limit = 3): string[] {
  const out: string[] = []
  for (const b of blocks || []) {
    const cue = b?.coaching_cues?.[0]
    if (cue) out.push(String(cue))
    if (out.length >= limit) break
  }
  return out
}
