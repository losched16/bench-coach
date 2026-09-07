// Three things happening at once cost the time of one, not three.
//
// THE BUG THIS EXISTS TO PREVENT
//
// A practice with three stations — ground balls, throwing accuracy, tee work —
// where twelve players split into three groups of four and rotate every eight
// minutes, takes TWENTY-FOUR MINUTES. Every group does every station. Nobody
// waits.
//
// Represented as three sequential drill blocks, the same practice reads as
// seventy-two minutes, and the scheduler will either refuse to fit it or throw
// away two of the three stations to make the arithmetic work. The coach gets a
// worse practice because the model of time was wrong.
//
// So a station group is one unit of practice time containing several parallel
// activities, and `totalMinutes` is `rotationMinutes × groups`, not the sum of
// the stations.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It does not choose the drills. Relevance is `drillRetrieval`'s job and this
// module never reorders by anything but feasibility — it takes candidates in
// the order they were ranked and asks only "can these run side by side, here,
// today, with these people". Keeping selection and feasibility apart is the
// same separation the scheduler already maintains between relevance and time.

import { DrillRecord } from '@/lib/drills'
import { ScoredDrill } from '@/lib/drillRetrieval'

/** A single station within a group. */
export interface Station {
  drill: DrillRecord
  /** Players at this station per rotation. */
  groupSize: number
  /** Why it was placed here — for the evaluator, not the coach's plan. */
  reason: string
}

export interface StationGroup {
  type: 'station_group'
  stations: Station[]
  /** How many groups rotate through. Equals stations.length. */
  groups: number
  /** Minutes each group spends at each station. */
  rotationMinutes: number
  /**
   * Elapsed practice time. rotationMinutes × groups — the whole point of this
   * type. NOT the sum of the stations' durations.
   */
  totalMinutes: number
  /** Transitions between rotations, inside the group. */
  rotationTransitions: number
}

export interface StationFeasibility {
  feasible: boolean
  /** Why not, in words a person can act on. */
  reason?: string
  /** How many parallel groups the people present can actually support. */
  supportedGroups: number
}

/**
 * The smallest group worth running as a station.
 *
 * Two players at a station is a partner drill with extra steps; one is a queue
 * of one. Below three the rotation overhead stops being worth it and the coach
 * is better served by a full-team block.
 */
export const MIN_STATION_GROUP = 3

/** Rotations shorter than this are mostly transition. */
export const MIN_ROTATION_MINUTES = 5

/**
 * How many stations these people can actually staff.
 *
 * The rule that matters: a station needing a coach needs a coach. A practice
 * with one adult can run several stations ONLY if all but one of them run
 * themselves — partner work, a tee, a wall. That is what min_coaches records,
 * and a drill that never declared it is assumed self-running, because assuming
 * otherwise would make an uncalibrated library incapable of stations at all.
 */
export function supportedGroupCount(
  expectedPlayers: number | null | undefined,
  coachCount: number | null | undefined,
  candidates: DrillRecord[]
): number {
  if (expectedPlayers == null || !Number.isFinite(expectedPlayers)) return 0
  if (expectedPlayers < MIN_STATION_GROUP * 2) return 0   // not enough for two groups

  // Ceiling from bodies: every group needs at least MIN_STATION_GROUP players.
  const byPlayers = Math.floor(expectedPlayers / MIN_STATION_GROUP)

  // Ceiling from adults. Unknown coach count is not a constraint.
  let byCoaches = byPlayers
  if (coachCount != null && Number.isFinite(coachCount)) {
    const selfRunning = candidates.filter(d => (d.min_coaches ?? 0) === 0).length
    // Each coach can hold one coach-dependent station; the self-running ones
    // are free. A coach is also needed to float, so this is not generous.
    byCoaches = Math.max(1, coachCount) + Math.min(selfRunning, Math.max(0, byPlayers - Math.max(1, coachCount)))
  }

  return Math.max(0, Math.min(byPlayers, byCoaches, 4))   // four stations is a lot to run
}

/**
 * Can these candidates run as a station group, and how big?
 *
 * Returns a reason on failure because "no stations" is a thing the evaluator
 * and the plan should both be able to explain.
 */
export function assessStations(input: {
  candidates: DrillRecord[]
  expectedPlayers?: number | null
  coachCount?: number | null
  availableMinutes: number
}): StationFeasibility {
  const { candidates, expectedPlayers, coachCount, availableMinutes } = input

  if (expectedPlayers == null || !Number.isFinite(expectedPlayers)) {
    return { feasible: false, supportedGroups: 0, reason: 'expected player count unknown' }
  }
  if (expectedPlayers < MIN_STATION_GROUP * 2) {
    return {
      feasible: false, supportedGroups: 0,
      reason: `${expectedPlayers} players is fewer than two groups of ${MIN_STATION_GROUP}`,
    }
  }

  const stationable = candidates.filter(d => d.station_friendly !== false)
  if (stationable.length < 2) {
    return {
      feasible: false, supportedGroups: 0,
      reason: 'fewer than two candidate activities can run as a station',
    }
  }

  const groups = supportedGroupCount(expectedPlayers, coachCount, stationable)
  if (groups < 2) {
    return {
      feasible: false, supportedGroups: groups,
      reason: coachCount != null
        ? `${coachCount} coach${coachCount === 1 ? '' : 'es'} cannot staff two parallel stations from these activities`
        : 'not enough groups supported',
    }
  }

  if (availableMinutes < groups * MIN_ROTATION_MINUTES) {
    return {
      feasible: false, supportedGroups: groups,
      reason: `${availableMinutes} min cannot hold ${groups} rotations of at least ${MIN_ROTATION_MINUTES}`,
    }
  }

  return { feasible: true, supportedGroups: groups }
}

/**
 * Build a station group from ranked candidates.
 *
 * Takes candidates in ranked order and fills stations with the best ones that
 * can run in parallel — it never promotes a weaker drill for being more
 * station-friendly, because relevance was already decided upstream and this
 * module's job is feasibility.
 *
 * Returns null when stations are not the right shape for this practice, which
 * the caller should treat as "use ordinary sequential blocks" rather than as an
 * error. A practice with nine players and one coach is not a failure.
 */
export function planStationGroup(input: {
  candidates: ScoredDrill[]
  expectedPlayers?: number | null
  coachCount?: number | null
  /** Minutes the plan can give to this group in total. */
  availableMinutes: number
}): StationGroup | null {
  const { candidates, expectedPlayers, coachCount, availableMinutes } = input

  const pool = candidates.map(c => c.drill)
  const check = assessStations({ candidates: pool, expectedPlayers, coachCount, availableMinutes })
  if (!check.feasible) return null

  const groups = check.supportedGroups
  const players = expectedPlayers as number

  // Take the top `groups` candidates that can run as stations, in rank order.
  const chosen: ScoredDrill[] = []
  let coachesSpent = 0
  const coachesAvailable = coachCount != null && Number.isFinite(coachCount)
    ? Math.max(1, coachCount) : Infinity

  for (const c of candidates) {
    if (chosen.length >= groups) break
    if (c.drill.station_friendly === false) continue
    const needs = c.drill.min_coaches ?? 0
    if (coachesSpent + needs > coachesAvailable) continue   // no adult left for it
    chosen.push(c)
    coachesSpent += needs
  }

  if (chosen.length < 2) return null

  const actualGroups = chosen.length

  // Group sizes: split as evenly as the roster allows, remainder to the front.
  const base = Math.floor(players / actualGroups)
  const remainder = players % actualGroups

  // Rotation length: the practice time divided by the number of rotations,
  // minus the seams between them. Every group visits every station, so the
  // elapsed time is one rotation per station — not the sum of the stations.
  const rotationTransitions = Math.max(0, actualGroups - 1)
  const usable = availableMinutes - rotationTransitions
  const rotationMinutes = Math.max(MIN_ROTATION_MINUTES, Math.floor(usable / actualGroups))

  const stations: Station[] = chosen.map((c, i) => ({
    drill: c.drill,
    groupSize: base + (i < remainder ? 1 : 0),
    reason: [
      `rank ${i + 1}`,
      c.drill.station_friendly === true ? 'station-friendly' : 'no station objection',
      (c.drill.min_coaches ?? 0) === 0 ? 'self-running' : `needs ${c.drill.min_coaches} coach`,
    ].join(' · '),
  }))

  return {
    type: 'station_group',
    stations,
    groups: actualGroups,
    rotationMinutes,
    totalMinutes: rotationMinutes * actualGroups + rotationTransitions,
    rotationTransitions,
  }
}

/** One line a person can read, for the evaluator and logs. */
export function describeStationGroup(g: StationGroup): string {
  // The counterfactual is the whole point of the line, so it has to be the
  // RIGHT counterfactual: every group visiting every station one after another,
  // which is groups × stations × rotation. Comparing against stations ×
  // rotation would print a smaller number than the answer and read as a loss.
  const sequential = g.groups * g.stations.length * g.rotationMinutes
  const head =
    `${g.groups} stations × ${g.rotationMinutes} min = ${g.totalMinutes} min elapsed ` +
    `(one after another it would be ${sequential})`
  const body = g.stations
    .map((s, i) => `    ${String.fromCharCode(65 + i)}. ${s.drill.drill_name}  (${s.groupSize} players) — ${s.reason}`)
    .join('\n')
  return `${head}\n${body}`
}
