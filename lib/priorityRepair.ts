// Repair an under-covered priority before the coach sees the plan.
//
// Split from lib/priorityCoverage so the measurement stays importable from
// the browser (the review screen derives coverage for plans saved before the
// summary existed) while this file may reach the scheduler, the station
// planner and the retrieval eligibility gates — all server-side.

import type { DrillRecord } from './drills'
import type { PlanBlock } from './practicePlan'
import { MIN_STATION_GROUP, MIN_ROTATION_MINUTES, supportedGroupCount } from './stationPlanner'
import { isRedundant } from './practiceScheduler'
import {
  ageEligible, playerCountEligible, coachCountEligible, equipmentEligible,
} from './drillRetrieval'
import {
  evaluatePriorityCoverage, blockPriorities, indexDrills, isStationBlock,
  CoverageOptions, CoverageReport, PriorityKey, StationChild, normalizePriority, normName, drillPriorities,
} from './priorityCoverage'

/** Types that never create reps in a priority, whatever they mention. */
const NON_MEANINGFUL_TYPES = new Set(['warmup', 'cooldown', 'warm-up', 'cool-down', 'break', 'water'])

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

export interface RepairCandidate {
  drill: DrillRecord
  /** Retrieval score, so a stronger match is preferred among equals. */
  score: number
}

export interface RepairEnvelope {
  playerAge?: number | null
  expectedPlayers?: number | null
  coachCount?: number | null
  equipmentAvailable?: string[] | null
  /** A game is close: never bring in a high-throwing-load drill. */
  limitThrowing?: boolean | null
}

export interface RepairStep {
  strategy: 'replace_redundant' | 'rebalance' | 'stations_from_sequential' | 'add_station' | 'replace_low_value'
  priority: PriorityKey
  detail: string
  before: number
  after: number
}

export interface RepairResult<T extends PlanBlock> {
  blocks: T[]
  steps: RepairStep[]
  coverage: CoverageReport
  /** Priorities still under-covered when the bounded pass ran out. */
  unresolved: PriorityKey[]
}

/** How many repair steps a single plan may take. Bounded on purpose. */
export const MAX_REPAIR_STEPS = 4
/** A drill block shorter than this is a transition with a name. */
export const MIN_DRILL_BLOCK_MINUTES = 6

/**
 * Repair an under-covered priority without breaking the envelope.
 *
 * Strategies in order of least damage, each applied once per step and the
 * coverage re-measured after every step:
 *
 *   1. replace a redundant block of an over-covered priority with a drill for
 *      the under-covered one, keeping the minutes
 *   2. move minutes from over-covered blocks onto the under-covered one's
 *      existing block(s)
 *   3. fold one block per priority into a station rotation, which frees
 *      elapsed time, and spend the freed time on the under-covered priority
 *   4. add the under-covered priority as a station inside an existing rotation
 *   5. replace the lowest-value block of any over-covered priority
 *
 * Total minutes never rise. A replacement drill must clear age, headcount,
 * coach count, equipment, throwing load and family redundancy against every
 * drill already in the plan — the same gates retrieval applies, applied again
 * here because the plan is the thing being changed.
 */
export function repairPriorityCoverage<T extends PlanBlock>(
  blocks: T[],
  selectedPriorities: string[],
  candidatesByPriority: Record<string, RepairCandidate[]>,
  opts: CoverageOptions & { envelope?: RepairEnvelope; maxSteps?: number } = {}
): RepairResult<T> {
  const selected = Array.from(new Set((selectedPriorities || []).map(normalizePriority).filter(Boolean)))
  const index = opts.drills instanceof Map ? opts.drills : indexDrills(opts.drills as DrillRecord[] | null)
  const env = opts.envelope || {}
  const maxSteps = opts.maxSteps ?? MAX_REPAIR_STEPS
  const steps: RepairStep[] = []
  let work: T[] = blocks.map(b => ({ ...b }))
  let report = evaluatePriorityCoverage(work, selected, { drills: index, weights: opts.weights, labels: opts.labels })

  const inPlan = (): DrillRecord[] => {
    const out: DrillRecord[] = []
    for (const b of work) {
      const d = b.drill_name ? index.get(normName(b.drill_name)) : null
      if (d) out.push(d)
      for (const s of (b.stations as StationChild[] | undefined) || []) {
        const sd = s.drill_name ? index.get(normName(s.drill_name)) : null
        if (sd) out.push(sd)
      }
    }
    return out
  }

  const usable = (p: PriorityKey, minutes: number): DrillRecord | null => {
    const used = new Set(work.flatMap(b => [normName(b.drill_name), ...((b.stations as StationChild[] | undefined) || []).map(s => normName(s.drill_name))]))
    const present = inPlan()
    const list = (candidatesByPriority[p] || []).slice().sort((a, b) => b.score - a.score)
    for (const c of list) {
      const d = c.drill
      if (!d?.drill_name || used.has(normName(d.drill_name))) continue
      if (!drillPriorities(d, [p]).length) continue
      if (!ageEligible(d, env.playerAge)) continue
      if (!playerCountEligible(d, env.expectedPlayers)) continue
      if (!coachCountEligible(d, env.coachCount)) continue
      if (!equipmentEligible(d, env.equipmentAvailable)) continue
      if (env.limitThrowing && String(d.throwing_load || '').toLowerCase() === 'high') continue
      if (present.some(x => isRedundant(x, d))) continue
      // A drill that needs far longer than the slot cannot be run once in it.
      const est = Number(d.est_duration_minutes)
      if (Number.isFinite(est) && est > 0 && est > minutes * 1.75) continue
      index.set(normName(d.drill_name), d)
      return d
    }
    return null
  }

  const blockFor = (d: DrillRecord, minutes: number, type = 'drill'): T => ({
    type,
    title: d.drill_name,
    minutes,
    description: firstSentence(d.description) || `${d.drill_name} — ${d.skill_category || 'drill'} work.`,
    drill_name: d.drill_name,
    youtube_video_id: d.youtube_video_id || undefined,
    youtube_channel: d.channel || undefined,
    skills: drillPriorities(d, selected),
  } as unknown as T)

  const row = (p: PriorityKey) => report.priorities.find(r => r.priority === p)!
  const over = () => report.priorities
    .filter(r => r.status === 'strong' && r.meaningful_blocks >= 1)
    .sort((a, b) => b.exposure_minutes - a.exposure_minutes)
  const sequentialIdx = (p: PriorityKey) => work
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => !isStationBlock(b) && !NON_MEANINGFUL_TYPES.has(String(b.type || 'drill').toLowerCase()) &&
      row(p).credits.some(c => c.index === i && c.station == null && !c.secondary))
    .map(x => x.i)

  for (let step = 0; step < maxSteps && report.under_covered.length > 0; step++) {
    const p = report.under_covered[0]
    const before = row(p).exposure_minutes
    const need = row(p).minimum_minutes
    let done: RepairStep | null = null

    // 1. Replace a redundant block of an over-covered priority. Redundant
    //    means the priority keeps at least one other meaningful block.
    for (const o of over()) {
      const idxs = sequentialIdx(o.priority)
      if (idxs.length < 2) continue
      // The lowest-value one: shortest, then latest.
      const victim = idxs.slice().sort((a, b) => victimRank(work[a]) - victimRank(work[b]) ||
        (Number(work[a].minutes) || 0) - (Number(work[b].minutes) || 0) || b - a)[0]
      const minutes = Number(work[victim].minutes) || 0
      const d = usable(p, minutes)
      if (!d) continue
      const replaced = work[victim]
      work[victim] = blockFor(d, minutes, replaced.type === 'game' ? 'drill' : String(replaced.type || 'drill'))
      done = { strategy: 'replace_redundant', priority: p, before, after: 0,
               detail: `replaced "${replaced.title}" (${minutes} min, ${o.label}, one of ${idxs.length}) with "${d.drill_name}"` }
      break
    }

    // 2. Rebalance: move minutes from over-covered blocks to this priority's
    //    own blocks until it clears its minimum, never below the block floor.
    if (!done) {
      const mine = sequentialIdx(p)
      if (mine.length > 0) {
        let moved = 0
        let deficit = need - before
        for (const o of over()) {
          for (const i of sequentialIdx(o.priority).sort((a, b) => (Number(work[b].minutes) || 0) - (Number(work[a].minutes) || 0))) {
            if (deficit <= 0) break
            const have = Number(work[i].minutes) || 0
            const spare = have - Math.max(MIN_DRILL_BLOCK_MINUTES, Math.ceil(have * 0.6))
            if (spare <= 0) continue
            const take = Math.min(spare, deficit)
            work[i] = { ...work[i], minutes: have - take }
            const target = mine[0]
            work[target] = { ...work[target], minutes: (Number(work[target].minutes) || 0) + take }
            moved += take
            deficit -= take
          }
          if (deficit <= 0) break
        }
        if (moved > 0) {
          done = { strategy: 'rebalance', priority: p, before, after: 0,
                   detail: `moved ${moved} min from over-covered blocks onto "${work[mine[0]].title}"` }
        }
      }
    }

    // 3. Fold one block per priority into a station rotation and spend the
    //    freed elapsed time on the under-covered priority.
    if (!done && env.expectedPlayers != null && env.expectedPlayers >= MIN_STATION_GROUP * 2) {
      const picks: number[] = []
      for (const r of report.priorities) {
        const idxs = sequentialIdx(r.priority).filter(i => !picks.includes(i))
        const stationable = idxs.filter(i => {
          const d = work[i].drill_name ? index.get(normName(work[i].drill_name)) : null
          return !d || d.station_friendly !== false
        })
        if (stationable.length) picks.push(stationable[0])
      }
      if (picks.length >= 2) {
        const groups = supportedGroupCount(env.expectedPlayers, env.coachCount,
          picks.map(i => index.get(normName(work[i].drill_name)) || ({} as DrillRecord)))
        if (groups >= 2) {
          const chosen = picks.slice(0, Math.min(groups, picks.length)).sort((a, b) => a - b)
          const sumMinutes = chosen.reduce((s, i) => s + (Number(work[i].minutes) || 0), 0)
          const seams = chosen.length - 1
          const rotation = Math.max(MIN_ROTATION_MINUTES, Math.floor((sumMinutes - seams) / chosen.length))
          const elapsed = rotation * chosen.length + seams
          const freed = sumMinutes - elapsed
          if (rotation >= MIN_ROTATION_MINUTES && (freed >= MIN_DRILL_BLOCK_MINUTES || !sequentialIdx(p).length)) {
            const children = chosen.map(i => ({ ...work[i], type: 'drill', minutes: rotation })) as StationChild[]
            const parent = {
              type: 'station',
              title: `${chosen.length}-Station Rotation`,
              minutes: elapsed,
              description: `${groups} groups rotate through ${chosen.length} stations, ${rotation} minutes each.`,
              groups: chosen.length,
              rotation_minutes: rotation,
              stations: children,
              skills: Array.from(new Set(children.flatMap(c => blockPriorities(c, selected, index)))),
            } as unknown as T
            const first = chosen[0]
            const next = work.filter((_, i) => !chosen.includes(i) || i === first)
              .map((b, i, arr) => b) // placeholder, rebuilt below
            const rebuilt: T[] = []
            work.forEach((b, i) => {
              if (i === first) rebuilt.push(parent)
              else if (!chosen.includes(i)) rebuilt.push(b)
            })
            void next
            work = rebuilt
            let detail = `folded ${chosen.length} blocks into a ${chosen.length}-station rotation (${rotation} min × ${chosen.length} = ${elapsed} min elapsed, ${freed} min freed)`
            if (freed >= MIN_DRILL_BLOCK_MINUTES) {
              const d = usable(p, freed)
              if (d) {
                const at = work.findIndex(b => b === parent) + 1
                work.splice(at, 0, blockFor(d, freed))
                detail += `; added "${d.drill_name}" (${freed} min)`
              } else {
                // Nothing eligible to add: give the freed minutes back to the
                // rotation so the clock is still spent.
                const extra = Math.floor(freed / chosen.length)
                if (extra > 0) {
                  ;(parent as any).rotation_minutes = rotation + extra
                  ;(parent as any).minutes = (rotation + extra) * chosen.length + seams
                  for (const c of children) c.minutes = rotation + extra
                  detail += `; rotation lengthened to ${rotation + extra} min`
                }
              }
            }
            done = { strategy: 'stations_from_sequential', priority: p, before, after: 0, detail }
          }
        }
      }
    }

    // 4. Add the under-covered priority as a station inside an existing rotation.
    if (!done) {
      const si = work.findIndex(b => isStationBlock(b))
      if (si >= 0) {
        const parent = work[si]
        const kids = parent.stations as StationChild[]
        const groups = supportedGroupCount(env.expectedPlayers, env.coachCount,
          kids.map(k => index.get(normName(k.drill_name)) || ({} as DrillRecord)))
        if (kids.length < Math.max(groups, kids.length + (env.expectedPlayers == null ? 1 : 0))) {
          const elapsed = Number(parent.minutes) || 0
          const n = kids.length + 1
          const rotation = Math.floor((elapsed - (n - 1)) / n)
          const d = rotation >= MIN_ROTATION_MINUTES ? usable(p, rotation) : null
          if (d) {
            const child = { ...blockFor(d, rotation), type: 'drill' } as StationChild
            const next: StationChild[] = kids.map(k => ({ ...k, minutes: rotation }))
            next.push(child)
            work[si] = {
              ...parent, stations: next, groups: n, rotation_minutes: rotation,
              title: `${n}-Station Rotation`,
              description: `${n} groups rotate through ${n} stations, ${rotation} minutes each.`,
              skills: Array.from(new Set(next.flatMap(c => blockPriorities(c, selected, index)))),
            } as T
            done = { strategy: 'add_station', priority: p, before, after: 0,
                     detail: `added "${d.drill_name}" as station ${n} of the rotation (${rotation} min each)` }
          }
        }
      }
    }

    // 5. Replace the lowest-value block of any over-covered priority, even its
    //    only one, as long as that priority stays covered at all.
    if (!done) {
      for (const o of over()) {
        const idxs = sequentialIdx(o.priority)
        if (idxs.length === 0) continue
        const victim = idxs.slice().sort((a, b) => victimRank(work[a]) - victimRank(work[b]) ||
          (Number(work[a].minutes) || 0) - (Number(work[b].minutes) || 0) || b - a)[0]
        // Never take the last thing an over-covered priority has unless it
        // still keeps reps inside a station.
        if (idxs.length === 1 && o.station_exposure_minutes === 0) continue
        const minutes = Number(work[victim].minutes) || 0
        const d = usable(p, minutes)
        if (!d) continue
        const replaced = work[victim]
        work[victim] = blockFor(d, minutes, String(replaced.type || 'drill'))
        done = { strategy: 'replace_low_value', priority: p, before, after: 0,
                 detail: `replaced "${replaced.title}" (${minutes} min, ${o.label}) with "${d.drill_name}"` }
        break
      }
    }

    if (!done) break
    report = evaluatePriorityCoverage(work, selected, { drills: index, weights: opts.weights, labels: opts.labels })
    done.after = row(p).exposure_minutes
    steps.push(done)
    // A step that changed nothing for the priority cannot be repeated
    // usefully; the loop's own bound still applies.
    if (done.after <= done.before && done.strategy !== 'stations_from_sequential') break
  }

  return { blocks: work, steps, coverage: report, unresolved: report.under_covered }
}

/** The competitive game is the last block a repair should spend. */
function victimRank(b: PlanBlock): number {
  return String(b?.type || 'drill').toLowerCase() === 'game' ? 1 : 0
}

function firstSentence(s: unknown): string {
  const t = String(s || '').trim()
  if (!t) return ''
  const m = t.match(/^(.+?[.!?])(\s|$)/)
  return (m ? m[1] : t).slice(0, 160)
}

