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
  /**
   * Elapsed practice minutes. For a station block this is the whole
   * rotation — groups × rotation_minutes plus the seams — never the sum of
   * the stations.
   */
  minutes?: number
  description?: string
  equipment?: string[]
  coaching_cues?: string[]
  setup?: string
  watch_for?: string
  /** Which selected focus areas this block gives real reps for. */
  skills?: string[]
  /**
   * A station block carries its parallel activities here. Each child is a
   * block in its own right (title, drill, detail) with `minutes` equal to one
   * rotation, and the parent is one row on the clock.
   */
  stations?: PlanBlock[]
  groups?: number
  rotation_minutes?: number
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
  /**
   * What the plan gave each selected priority, measured at generation time.
   * Plans written before this existed have none, and a reader derives it from
   * the blocks instead — see lib/priorityCoverage.
   */
  priority_coverage: any | null
}

/** Is this block a station rotation with its activities stored structurally? */
export function isStationGroup(b: PlanBlock | null | undefined): boolean {
  return Boolean(b && Array.isArray(b.stations) && b.stations.length >= 2)
}

/** Every block that carries coaching content: top-level blocks and station children. */
export function flattenBlocks(blocks: PlanBlock[]): PlanBlock[] {
  const out: PlanBlock[] = []
  for (const b of blocks || []) {
    out.push(b)
    if (isStationGroup(b)) for (const s of b.stations as PlanBlock[]) out.push(s)
  }
  return out
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
    priority_coverage: c.priority_coverage && typeof c.priority_coverage === 'object' ? c.priority_coverage : null,
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
  for (const b of flattenBlocks(blocks)) {
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
  /** Which selected focus areas the block serves, when the plan stamped them. */
  skills: string[]
  /**
   * A station rotation's activities, one line each ("A. High Tee — 8 min"),
   * so the sheet lists the stations under the one row the rotation occupies.
   */
  stations: string[]
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
    const station = isStationGroup(b)
    const rotation = station ? (Number(b.rotation_minutes) || Math.max(0, Math.floor((minutes - ((b.stations as PlanBlock[]).length - 1)) / (b.stations as PlanBlock[]).length))) : 0
    return {
      index,
      from, to, minutes,
      title: b?.title || 'Untitled block',
      description: b?.description || '',
      type: station ? 'station' : (b?.type || 'drill'),
      skills: Array.isArray(b?.skills) ? b.skills.map(String) : [],
      stations: station
        ? (b.stations as PlanBlock[]).map((s, i) =>
            `${String.fromCharCode(65 + i)}. ${s?.title || s?.drill_name || 'Station'} — ${s?.minutes || rotation} min`)
        : [],
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

// ---------------------------------------------------------------------------
// Rebuilding a plan the coach has already read
// ---------------------------------------------------------------------------

/** Titles compare on their words, not their punctuation or capitals. */
function titleKey(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Does this block carry anything worth keeping, or is it just a heading? */
export function isExpanded(b: PlanBlock | null | undefined): boolean {
  return Boolean(
    b && (b.detailed_instructions || b.setup ||
          b.coaching_cues?.length || b.common_mistakes?.length)
  )
}

/**
 * The already-written version of a block, if the rebuild kept it unchanged.
 *
 * "More baserunning, drop the bunting station" should not silently reword the
 * four blocks the coach liked. Telling the model to keep them "as close to
 * identical as you can" was never going to hold — so instead, when a rebuilt
 * block has the same name and the same length as one the coach already read,
 * its detail is carried across verbatim and never regenerated.
 *
 * Length has to match as well as the name: if they asked for longer tee work,
 * the rep counts and timings inside the instructions are now wrong, and a
 * block that says "3 rounds of 2 minutes" under a 20-minute heading is worse
 * than one that was rewritten.
 */
export function reusableBlock(
  block: PlanBlock,
  previous: PlanBlock[] | null | undefined
): PlanBlock | null {
  const key = titleKey(block?.title)
  if (!key) return null
  for (const p of previous || []) {
    if (!isExpanded(p)) continue
    if (titleKey(p.title) !== key) continue
    if (Number(p.minutes) !== Number(block?.minutes)) continue
    // The skeleton's own fields win — it may have changed the description or
    // matched a different video — and the written detail comes from the copy
    // the coach already approved.
    return { ...p, ...block }
  }
  return null
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
  for (const b of flattenBlocks(blocks)) {
    const cue = b?.coaching_cues?.[0]
    if (cue) out.push(String(cue))
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Editing the overview by hand
// ---------------------------------------------------------------------------
// Coaching points and flags are lists, but a coach edits them as lines in a
// box. These two are the whole translation, kept here so the review and the
// tests agree on what a blank line means (nothing) and what whitespace means
// (nothing either).

/** A list as textarea text: one item per line. */
export function listToLines(items: string[] | null | undefined): string {
  return (items || []).map(x => String(x ?? '').trim()).filter(Boolean).join(String.fromCharCode(10))
}

/** Textarea text as a list: one item per non-blank line, trimmed. */
export function linesToList(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Steps written as one line
// ---------------------------------------------------------------------------
// The generator writes "1. Wrist Flips — ... 2. Rocker Throws — ..." as ONE
// string with no line breaks, and a renderer that preserves line breaks has
// nothing to preserve. Verified against production rows: instructions carry
// five to eight inline markers and zero newlines. This turns that back into
// the list the writer meant.
//
// Conservative on purpose. A marker is "N. " with a space after the period,
// so "6.5 feet" and "10.30am" are never split, and the numbers must run
// 1, 2, 3… — a stray "in 2. " in prose does not make a list.

export interface StepText {
  /** True when the text is a numbered list; items then carry no marker. */
  numbered: boolean
  items: string[]
}

export function stepsFrom(text: string | null | undefined): StepText {
  const raw = String(text ?? '').trim()
  if (!raw) return { numbered: false, items: [] }

  // Real line breaks win: a coach who typed steps on separate lines meant
  // exactly that, whether or not they numbered them.
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    const stripped = lines.map(l => l.replace(/^\d+[.)]\s+/, ''))
    const allNumbered = lines.every(l => /^\d+[.)]\s/.test(l))
    return { numbered: allNumbered, items: allNumbered ? stripped : lines }
  }

  // One line. Find inline markers and check they count up from 1.
  const marker = /(^|\s)(\d+)\.\s+(?=\S)/g
  const found: Array<{ n: number; at: number; len: number }> = []
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    found.push({ n: Number(m[2]), at: m.index + m[1].length, len: m[0].length - m[1].length })
  }
  const sequential = found.length >= 2 && found.every((f, i) => f.n === i + 1)
  if (!sequential) return { numbered: false, items: [raw] }

  const items: string[] = []
  const lead = raw.slice(0, found[0].at).trim()
  for (let i = 0; i < found.length; i++) {
    const start = found[i].at + found[i].len
    const end = i + 1 < found.length ? found[i + 1].at : raw.length
    const piece = raw.slice(start, end).trim()
    if (piece) items.push(piece)
  }
  // Text before "1." is an intro sentence, not a step; keep it as the first
  // item only if it says something.
  return { numbered: true, items: lead ? [lead, ...items] : items }
}
