// Did the practice actually cover what the coach asked for?
//
// THE BUG THIS EXISTS TO PREVENT
//
// A coach selects Throwing, Hitting and Infield for a 90-minute practice and
// gets back one 10-minute tee drill and seventy minutes of infield and
// throwing, with a flag that reads "High Tee Drill is your only hitting rep
// today, so protect that one." The system noticed and apologised. It should
// have fixed it.
//
// Nothing upstream was measuring coverage. Retrieval ranks the whole pool by
// relevance to ONE combined query, the scheduler fills the clock greedily in
// that order, and the model is handed the result as "these drills fit". A
// focus area whose drills score lower than another's can lose the whole
// practice on ranking alone, and the only thing that ever said so was the
// model's own flag.
//
// WHAT THIS MODULE IS
//
// A deterministic measure of PLAYER EXPOSURE per selected priority, computed
// from the composed plan, and a bounded repair pass that changes the plan when
// a priority is under-covered — before the coach ever sees it. No model call,
// no I/O, and nothing server-only is imported — the review screen measures a
// saved plan with the same function. The repair pass, which needs the
// scheduler and the retrieval gates, lives in lib/priorityRepair.ts.
//
// EXPOSURE, NOT ELAPSED TIME
//
// A 24-minute rotation of three stations — hitting, infield, throwing — gives
// every player eight minutes of each. The practice spends 24 minutes; hitting
// is credited 8, not 24 and not 0. A sequential 12-minute tee block credits
// hitting 12. Warm-ups and cool-downs credit nothing, however much the
// description mentions swings: a mention is not a rep.
//
// NOT EQUAL SPLITS
//
// Three priorities do not mean 33.3% each. One priority may dominate when the
// coach's objective justifies it. What may not happen is one selected priority
// quietly getting token minutes while another gets forty. The rule is a
// minimum meaningful share, derived from the drill time the plan actually has,
// and it is written once, here, so the tests and the UI agree on it.

import type { DrillRecord } from './drills'
import type { PlanBlock } from './practicePlan'

// ---------------------------------------------------------------------------
// Which priority a block serves
// ---------------------------------------------------------------------------

import {
  PriorityKey, PRIORITY_KEYWORDS, normalizePriority, defaultLabel, normName, drillPriorities,
  UNDER_COVERED_SHARE, STRONG_SHARE, MIN_ABSOLUTE_MINUTES, MAX_DOMINANCE_RATIO,
} from './priorityMap'

export type { PriorityKey } from './priorityMap'
export {
  PRIORITY_CATEGORIES, PRIORITY_KEYWORDS, normalizePriority, defaultLabel, normName, drillPriorities,
  UNDER_COVERED_SHARE, STRONG_SHARE, MIN_ABSOLUTE_MINUTES, MAX_DOMINANCE_RATIO,
} from './priorityMap'

/** Types that never create reps in a priority, whatever they mention. */
const NON_MEANINGFUL_TYPES = new Set(['warmup', 'cooldown', 'warm-up', 'cool-down', 'break', 'water'])

/**
 * Which selected priorities a block gives real reps for.
 *
 * A block linked to a library drill answers through the drill. A block the
 * model wrote from its own head answers through its title, and only then its
 * description, because the title is the activity and the description is the
 * sales pitch. A warm-up or cool-down never answers at all.
 */
export function blockPriorities(
  block: PlanBlock,
  selected: PriorityKey[],
  drillsByName?: Map<string, DrillRecord> | null
): PriorityKey[] {
  const type = String(block?.type || 'drill').toLowerCase()
  if (NON_MEANINGFUL_TYPES.has(type)) return []

  // A block stamped at generation time carries its own answer. Trusted only
  // for keys the coach actually selected, so an old stamp cannot invent a
  // priority the coach did not pick this time.
  if (Array.isArray(block.skills) && block.skills.length) {
    const stamped = block.skills.map(normalizePriority).filter(s => selected.includes(s))
    if (stamped.length) return stamped
  }

  const linked = drillsByName && block.drill_name
    ? drillsByName.get(normName(block.drill_name)) : null
  if (linked) {
    const viaDrill = drillPriorities(linked, selected)
    if (viaDrill.length) return viaDrill
  }

  const title = String(block?.title || '')
  const fromTitle = keywordPriorities(title, selected)
  if (fromTitle.length) return fromTitle
  return keywordPriorities(String(block?.description || ''), selected).slice(0, 1)
}

function keywordPriorities(text: string, selected: PriorityKey[]): PriorityKey[] {
  const out: PriorityKey[] = []
  for (const [key, re] of PRIORITY_KEYWORDS) {
    if (selected.includes(key) && re.test(text) && !out.includes(key)) out.push(key)
  }
  // A title that names two things ("Ground Balls and Throws") is one activity
  // with a primary purpose; the first, most specific match is that purpose.
  // The second is credited only when the title says "and".
  if (out.length > 1 && !/\b(and|\+|\/|&)\b|\+|\//.test(text)) return [out[0]]
  return out
}

/** Index a drill menu by name, for linking blocks back to what they cite. */
export function indexDrills(drills: DrillRecord[] | null | undefined): Map<string, DrillRecord> {
  const m = new Map<string, DrillRecord>()
  for (const d of drills || []) {
    if (d?.drill_name) m.set(normName(d.drill_name), d)
  }
  return m
}

// ---------------------------------------------------------------------------
// Exposure
// ---------------------------------------------------------------------------

/** How a station block is shaped when it is stored structurally. */
export interface StationChild extends PlanBlock {
  title?: string
  drill_name?: string
}

export function isStationBlock(b: PlanBlock | null | undefined): boolean {
  return Boolean(b && Array.isArray(b.stations) && b.stations.length >= 2)
}

/**
 * Minutes each player spends at each station of a station block.
 *
 * Every group visits every station once, so the exposure per station is one
 * rotation. Read from the block when the model wrote it; otherwise derived
 * from the elapsed minutes, the station count and the seams between rotations.
 */
export function rotationMinutesOf(b: PlanBlock): number {
  const n = Array.isArray(b.stations) ? b.stations.length : 0
  if (n < 1) return Math.max(0, Number(b.minutes) || 0)
  const stated = Number(b.rotation_minutes)
  if (Number.isFinite(stated) && stated > 0) return Math.round(stated)
  const elapsed = Math.max(0, Number(b.minutes) || 0)
  const seams = Math.max(0, n - 1)
  return Math.max(0, Math.floor((elapsed - seams) / n))
}

export interface CoverageBlockCredit {
  /** Block index in the plan, and station index inside it when applicable. */
  index: number
  station?: number
  title: string
  /** Minutes credited to the priority for this block. */
  minutes: number
  /** 'drill' when linked to a library drill, else how it was read. */
  via: 'drill' | 'stamp' | 'title' | 'description'
  secondary: boolean
}

export type CoverageStatus = 'missing' | 'under_covered' | 'adequate' | 'strong'

export interface PriorityCoverage {
  priority: PriorityKey
  label: string
  /** Minutes a player actually spends on it. */
  exposure_minutes: number
  /** Sequential blocks and station children that give real reps. */
  meaningful_blocks: number
  /** How many of those minutes come from inside station rotations. */
  station_exposure_minutes: number
  /** exposure / fair share, where fair share is drill time / priorities. */
  coverage_ratio: number
  status: CoverageStatus
  /** The minimum this priority needed to not be under-covered. */
  minimum_minutes: number
  credits: CoverageBlockCredit[]
}

export interface CoverageReport {
  priorities: PriorityCoverage[]
  /** Minutes in blocks that create reps in anything (not warm-up/cool-down). */
  meaningful_minutes: number
  /** Total plan minutes as the blocks add up. */
  total_minutes: number
  fair_share_minutes: number
  /** True when every selected priority is at least adequate. */
  balanced: boolean
  under_covered: PriorityKey[]
  /** Why each status was decided, for tests and debug output. */
  explain: string[]
  /** Whether any minute here is an estimate (station rotations). */
  approximate: boolean
}


export interface CoverageOptions {
  drills?: DrillRecord[] | Map<string, DrillRecord> | null
  /**
   * Explicit relative importance, 0..1 per priority, when the product has it.
   * The builder has no ranking today, so this is never inferred: absent means
   * co-primary. A weight changes the fair share, not the floor.
   */
  weights?: Record<string, number> | null
  labels?: Record<string, string> | null
}

export function evaluatePriorityCoverage(
  blocks: PlanBlock[],
  selectedPriorities: string[],
  opts: CoverageOptions = {}
): CoverageReport {
  const selected = Array.from(new Set((selectedPriorities || []).map(normalizePriority).filter(Boolean)))
  const index = opts.drills instanceof Map ? opts.drills : indexDrills(opts.drills as DrillRecord[] | null)
  const explain: string[] = []

  const credits = new Map<PriorityKey, CoverageBlockCredit[]>()
  for (const p of selected) credits.set(p, [])

  let meaningful = 0
  let total = 0
  let approximate = false

  ;(blocks || []).forEach((b, i) => {
    const minutes = Math.max(0, Number(b?.minutes) || 0)
    total += minutes
    const type = String(b?.type || 'drill').toLowerCase()
    if (NON_MEANINGFUL_TYPES.has(type)) return

    if (isStationBlock(b)) {
      approximate = true
      const rotation = rotationMinutesOf(b)
      meaningful += minutes
      ;(b.stations as StationChild[]).forEach((s, si) => {
        const ps = blockPriorities({ ...s, type: s.type || 'drill' }, selected, index)
        credit(credits, ps, {
          index: i, station: si, title: String(s.title || s.drill_name || `Station ${si + 1}`),
          minutes: rotation, via: viaOf(s, index), secondary: false,
        })
      })
      return
    }

    meaningful += minutes
    const ps = blockPriorities(b, selected, index)
    credit(credits, ps, {
      index: i, title: String(b.title || 'Untitled block'), minutes,
      via: viaOf(b, index), secondary: false,
    })
  })

  const n = Math.max(1, selected.length)
  const weights = normalizeWeights(selected, opts.weights)
  const fairShare = meaningful / n

  const rows: PriorityCoverage[] = selected.map(p => {
    const cs = credits.get(p) || []
    const exposure = cs.reduce((s, c) => s + c.minutes, 0)
    const stationExposure = cs.filter(c => c.station != null).reduce((s, c) => s + c.minutes, 0)
    const share = meaningful * weights[p]           // the fair share for THIS priority
    // Never above the fair share itself: a short session cannot owe a
    // priority more than its whole share.
    const minimum = Math.min(Math.round(share), Math.round(Math.max(MIN_ABSOLUTE_MINUTES, share * UNDER_COVERED_SHARE)))
    return {
      priority: p,
      label: opts.labels?.[p] || defaultLabel(p),
      exposure_minutes: exposure,
      meaningful_blocks: cs.length,
      station_exposure_minutes: stationExposure,
      coverage_ratio: share > 0 ? round2(exposure / share) : 0,
      status: 'adequate',
      minimum_minutes: minimum,
      credits: cs,
    }
  })

  const best = rows.reduce((m, r) => Math.max(m, r.exposure_minutes), 0)
  for (const r of rows) {
    const share = meaningful * weights[r.priority]
    if (r.meaningful_blocks === 0 || r.exposure_minutes <= 0) {
      r.status = 'missing'
      explain.push(`${r.label}: no block gives real reps → missing`)
    } else if (r.exposure_minutes < r.minimum_minutes) {
      r.status = 'under_covered'
      explain.push(`${r.label}: ${r.exposure_minutes} min is below the ${r.minimum_minutes}-min minimum ` +
                   `(${Math.round(UNDER_COVERED_SHARE * 100)}% of a ${Math.round(share)}-min fair share, floor ${MIN_ABSOLUTE_MINUTES}) → under-covered`)
    } else if (best > MAX_DOMINANCE_RATIO * r.exposure_minutes && rows.length > 1) {
      r.status = 'under_covered'
      explain.push(`${r.label}: ${r.exposure_minutes} min against ${best} min for the best-covered priority ` +
                   `(more than ${MAX_DOMINANCE_RATIO}×) → under-covered`)
    } else if (r.exposure_minutes >= share * STRONG_SHARE) {
      r.status = 'strong'
      explain.push(`${r.label}: ${r.exposure_minutes} min of a ${Math.round(share)}-min fair share → strong`)
    } else {
      explain.push(`${r.label}: ${r.exposure_minutes} min of a ${Math.round(share)}-min fair share → adequate`)
    }
  }

  const under = rows.filter(r => r.status === 'missing' || r.status === 'under_covered').map(r => r.priority)
  return {
    priorities: rows,
    meaningful_minutes: meaningful,
    total_minutes: total,
    fair_share_minutes: Math.round(fairShare),
    balanced: under.length === 0,
    under_covered: under,
    explain,
    approximate,
  }
}

function credit(map: Map<PriorityKey, CoverageBlockCredit[]>, ps: PriorityKey[], c: CoverageBlockCredit) {
  ps.forEach((p, k) => {
    const list = map.get(p)
    if (!list) return
    // A block that serves two priorities gives each of them real reps, but
    // not each of them the whole block: the second is credited at half.
    list.push(k === 0 ? c : { ...c, minutes: Math.round(c.minutes / 2), secondary: true })
  })
}

function viaOf(b: PlanBlock, index: Map<string, DrillRecord>): CoverageBlockCredit['via'] {
  if (Array.isArray(b.skills) && b.skills.length) return 'stamp'
  if (b.drill_name && index.get(normName(b.drill_name))) return 'drill'
  return 'title'
}

function normalizeWeights(selected: PriorityKey[], weights?: Record<string, number> | null): Record<string, number> {
  const out: Record<string, number> = {}
  const given = weights || {}
  const raw = selected.map(p => {
    const w = Number(given[p])
    return Number.isFinite(w) && w > 0 ? w : 1
  })
  const sum = raw.reduce((a, b) => a + b, 0) || 1
  selected.forEach((p, i) => { out[p] = raw[i] / sum })
  return out
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/** The compact summary a coach reads in three seconds. */
export function summarizeCoverage(report: CoverageReport): Array<{ label: string; minutes: number; status: CoverageStatus }> {
  return report.priorities.map(r => ({ label: r.label, minutes: r.exposure_minutes, status: r.status }))
}

/** Total minutes as blocks add up, station groups counted once. */
export function elapsedMinutes(blocks: PlanBlock[]): number {
  return (blocks || []).reduce((n, b) => n + Math.max(0, Number(b?.minutes) || 0), 0)
}

/** The plain-language lines for a debug dump or a test failure. */
export function describeCoverage(report: CoverageReport): string {
  const lines = report.priorities.map(r =>
    `${r.label.padEnd(12)} ${String(r.exposure_minutes).padStart(3)} min  ` +
    `${String(r.meaningful_blocks).padStart(2)} blocks  ${r.status}` +
    (r.station_exposure_minutes ? `  (${r.station_exposure_minutes} in stations)` : '')
  )
  lines.push(`meaningful ${report.meaningful_minutes} of ${report.total_minutes} min, fair share ${report.fair_share_minutes}, balanced=${report.balanced}`)
  return lines.join('\n')
}
