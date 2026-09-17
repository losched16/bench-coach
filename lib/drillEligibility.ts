// Can this coach, standing where they are standing, run this drill?
//
// Three predicates about the physical world: the room, the space and the kit.
// They were written inside lib/drillRetrieval, which was the right home when
// only the server asked the question.
//
// WHY THEY MOVED
//
// The Drill Finder asks the same question in the browser, and importing
// drillRetrieval to get them pulled `lib/drillDiagnosis` → `lib/claudeClient` →
// the Anthropic SDK into the client bundle, which fails the build outright
// ("Reading from node:fs is not handled by plugins"). The alternative — a
// second copy of the rules on the client — is how a coach ends up being offered
// a drill in the library that the practice planner would have excluded.
//
// So: one copy, no imports, and drillRetrieval re-exports them so nothing that
// already used them had to change.
//
// THE RULE THEY ALL SHARE
//
// An unknown constraint is not a constraint. A coach who did not mention
// equipment has not told us they own none, and a drill with no recorded space
// requirement has not told us it needs a field. Filtering on absence would
// quietly empty the library, which is a failure nobody sees as a failure.

import { DrillRecord } from './drills'

function lower(v: unknown): string {
  return String(v ?? '').toLowerCase().trim()
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim()) {
    // `tags` is jsonb and can arrive as a JSON string rather than an array.
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.map(x => String(x)).filter(Boolean)
    } catch { /* not JSON — treat as a single value */ }
    return [v]
  }
  return []
}

// ── the roster and the calendar ─────────────────────────────────────────────
//
// Moved here from lib/drillRetrieval alongside the three above, for the same
// reason: the pathway service asks the same questions and must not import the
// Anthropic SDK to do it. Same rule throughout — an unknown value never
// excludes.

/**
 * Indoor/outdoor. `Both` and `Indoor/Outdoor` satisfy either request.
 *
 * Only exclusionary in one direction that matters: asking for indoor must not
 * return an outdoor-only drill. Asking for outdoor keeps everything, since an
 * indoor drill run outside is merely unnecessary, not impossible.
 */
export function environmentEligible(d: DrillRecord, want?: 'indoor' | 'outdoor' | null): boolean {
  if (!want) return true
  const v = lower(d.indoor_outdoor)
  if (!v || v.includes('both') || v.includes('/')) return true
  // Asymmetric on purpose. A coach stuck in a gym cannot run an outdoor-only
  // drill, so "indoor" genuinely excludes. But an indoor drill run outside is
  // merely unnecessary, not impossible — so "outdoor" excludes nothing and the
  // preference is expressed by scoring instead.
  //
  // (Production only stores Outdoor, Both and Indoor/Outdoor today, so this
  // branch is defensive rather than load-bearing — but the column is free text
  // and a plain "Indoor" would otherwise start silently disappearing.)
  if (want === 'outdoor') return true
  return v.includes('indoor')
}

// Every value production actually holds, plus the ones it plausibly could.
//
// 'full field' was missing, and it is the commonest large value in the library:
// 18 of the 154 schedulable drills carry "Full Field" or "Full field", and an
// unrecognised value falls through the "unknown passes" branch. So a coach who
// said they had a small space was still being offered the Base Running Circuit
// and the Pro Base-Stealing Package — by the practice planner, by the Drill
// Finder's space filter, and by anything else built on this.
//
// The lesson is the generous default, not the missing row: "unknown passes" is
// the right rule for a genuinely unknown value and a silent trapdoor for a
// value the table simply forgot. Hence the coverage test in
// scripts/test-pathways.ts, which asserts against the values production holds
// rather than against this table.
const SPACE_RANK: Record<string, number> = {
  small: 1,
  medium: 2,
  'medium-large': 3, large: 3,
  'full field': 4, 'full-field': 4, full: 4,
  'outfield/large': 4, outfield: 4, field: 4,
}

/** A drill needing more room than the coach has is out. Unknown space passes. */
export function spaceEligible(d: DrillRecord, have?: 'small' | 'medium' | 'large' | null): boolean {
  if (!have) return true
  const need = SPACE_RANK[lower(d.space_required)]
  if (need == null) return true
  const got = SPACE_RANK[have]
  return got == null ? true : need <= got
}

/**
 * Equipment.
 *
 * Substring matching in both directions, because the library says "Tee" and a
 * coach says "batting tee". An empty or absent list means unknown — the coach
 * has not told us they own nothing.
 */
export function equipmentEligible(d: DrillRecord, have?: string[] | null): boolean {
  if (!have || have.length === 0) return true
  const needs = asArray(d.equipment_needed).map(lower).filter(Boolean)
  if (needs.length === 0) return true
  const got = have.map(lower)
  return needs.every(n =>
    // "none" and "no equipment" are library values meaning exactly that.
    n.includes('none') || n === 'no equipment' ||
    got.some(g => g.includes(n) || n.includes(g))
  )
}
/**
 * Age eligibility.
 *
 * Both bounds are populated on 206/206 production rows, so this is a real
 * filter rather than a nominal one — but it still only runs when an age is
 * known, and a drill missing a bound is never excluded by it.
 */
export function ageEligible(d: DrillRecord, playerAge?: number | null): boolean {
  if (playerAge == null) return true
  const min = d.min_age, max = d.max_age
  if (min == null || max == null) return true
  return playerAge >= min && playerAge <= max
}

/**
 * Enough players for the activity, and not too many.
 *
 * HARD, but only when both sides are known. A drill that never declared a
 * minimum is eligible for any group; a session that never declared a headcount
 * gates nothing. 206 rows currently declare nothing, so this is inert until
 * calibration data arrives — which is the correct order to build it in.
 */
export function playerCountEligible(d: DrillRecord, expected?: number | null): boolean {
  if (expected == null || !Number.isFinite(expected)) return true
  if (typeof d.min_players === 'number' && expected < d.min_players) return false
  // max_players is a station-sizing hint more than a hard ceiling — a drill
  // built for 4 can be run by 12 in three groups — so it does not exclude.
  return true
}

/**
 * Enough adults.
 *
 * The sharpest of these gates, and the one the brief is most concerned with. A
 * single coach cannot run three simultaneous coach-fed stations, and a plan
 * that says otherwise is not a plan.
 */
export function coachCountEligible(d: DrillRecord, coaches?: number | null): boolean {
  if (coaches == null || !Number.isFinite(coaches)) return true
  if (typeof d.min_coaches === 'number' && coaches < d.min_coaches) return false
  return true
}
