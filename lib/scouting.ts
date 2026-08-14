// Scouting module shared logic: pitching availability math, opponent player
// identity resolution, and staleness weighting. Pure functions — no I/O — so
// the API routes and UI can share one implementation and the pitch-count math
// stays testable.

// ── Types ──────────────────────────────────────────────

export interface PitchThresholdBand {
  max_pitches: number
  rest_days: number
}

export interface PitchCountRuleSet {
  id: string
  coach_id: string | null
  sanctioning_body: string
  age_group: string
  daily_max: number | null
  thresholds: PitchThresholdBand[]
}

export interface AppearanceLite {
  game_date: string // YYYY-MM-DD
  pitches_thrown: number | null
  innings_pitched?: number | null
}

export type AvailabilityStatus = 'ineligible' | 'limited' | 'available' | 'unknown'

export interface PitcherAvailability {
  status: AvailabilityStatus
  last_pitched: string | null        // date of most recent pitching appearance
  last_outing_pitches: number | null // pitches on that date (day total)
  required_rest_days: number | null  // rest required by that outing
  eligible_on: string | null         // first date the pitcher may pitch again
  pitches_last_7_days: number
  explanation: string                // the inference, stated explicitly
}

export interface OpponentPlayerLite {
  id: string
  name: string
  jersey_number: string | null
  confidence: 'confirmed' | 'probable' | 'uncertain'
}

export interface PlayerMatchResult {
  player: OpponentPlayerLite | null  // null = no safe match, create a new row
  matchLevel: 'exact' | 'strong' | 'possible' | 'none'
  // when matchLevel is 'possible' the caller should create a NEW row flagged
  // needs_review and record the suspected duplicate — never auto-merge
  suspectedDuplicateId?: string
}

// ── Date helpers (all date-only, no timezones) ─────────

function parseDate(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day)
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

function addDays(d: string, n: number): string {
  const date = parseDate(d)
  date.setDate(date.getDate() + n)
  return toDateStr(date)
}

// ── Pitching availability ──────────────────────────────

// Rest days required after throwing `pitches` in a day, per the rule set.
// Bands are checked in ascending max_pitches order; throwing more than the
// top band's max is treated as the top band (already over the daily cap).
export function restDaysRequired(pitches: number, thresholds: PitchThresholdBand[]): number {
  const sorted = [...thresholds].sort((a, b) => a.max_pitches - b.max_pitches)
  for (const band of sorted) {
    if (pitches <= band.max_pitches) return band.rest_days
  }
  return sorted.length > 0 ? sorted[sorted.length - 1].rest_days : 0
}

// Availability of one pitcher for a target game date, derived from logged
// appearances only. This is deduction from data the coach already has —
// unlogged games mean the picture is incomplete, and callers must say so.
export function computePitcherAvailability(
  appearances: AppearanceLite[],
  ruleSet: PitchCountRuleSet,
  targetDate: string
): PitcherAvailability {
  // Day totals for actual pitching outings before the target date
  const byDate: Record<string, number> = {}
  for (const a of appearances) {
    if (!a.pitches_thrown || a.pitches_thrown <= 0) continue
    const d = a.game_date.slice(0, 10)
    if (d >= targetDate) continue
    byDate[d] = (byDate[d] || 0) + a.pitches_thrown
  }

  const dates = Object.keys(byDate).sort()
  if (dates.length === 0) {
    return {
      status: 'unknown',
      last_pitched: null,
      last_outing_pitches: null,
      required_rest_days: null,
      eligible_on: null,
      pitches_last_7_days: 0,
      explanation: 'No pitching appearances logged for this player — availability unknown, not confirmed available.',
    }
  }

  // Each outing imposes its own rest window; the binding one is the latest
  let bindingEligibleOn = dates[0]
  let bindingDate = dates[0]
  let bindingPitches = byDate[dates[0]]
  let bindingRest = 0
  for (const d of dates) {
    const rest = restDaysRequired(byDate[d], ruleSet.thresholds)
    const eligibleOn = addDays(d, rest + 1) // rest days are full days off
    if (eligibleOn > bindingEligibleOn) {
      bindingEligibleOn = eligibleOn
      bindingDate = d
      bindingPitches = byDate[d]
      bindingRest = rest
    }
  }

  const lastPitched = dates[dates.length - 1]
  const pitchesLast7 = dates
    .filter(d => daysBetween(d, targetDate) <= 7)
    .reduce((sum, d) => sum + byDate[d], 0)

  const ruleLabel = `${ruleSet.sanctioning_body} ${ruleSet.age_group}`

  if (bindingEligibleOn > targetDate) {
    return {
      status: 'ineligible',
      last_pitched: lastPitched,
      last_outing_pitches: byDate[lastPitched],
      required_rest_days: bindingRest,
      eligible_on: bindingEligibleOn,
      pitches_last_7_days: pitchesLast7,
      explanation: `Threw ${bindingPitches} on ${bindingDate} — under ${ruleLabel} rules that requires ${bindingRest} rest day${bindingRest === 1 ? '' : 's'}, so he shouldn't be available until ${bindingEligibleOn}.`,
    }
  }

  // Eligible, but recent workload can still limit an outing: pitched within
  // the last 2 days (short-rest band) or heavy volume in the last week.
  const daysSince = daysBetween(lastPitched, targetDate)
  const weeklyHeavy = ruleSet.daily_max ? pitchesLast7 >= ruleSet.daily_max : pitchesLast7 >= 75
  if (daysSince <= 2 || weeklyHeavy) {
    const reasons: string[] = []
    if (daysSince <= 2) reasons.push(`pitched ${daysSince === 1 ? 'yesterday' : `${daysSince} days ago`} (${byDate[lastPitched]} pitches)`)
    if (weeklyHeavy) reasons.push(`${pitchesLast7} pitches in the last 7 days`)
    return {
      status: 'limited',
      last_pitched: lastPitched,
      last_outing_pitches: byDate[lastPitched],
      required_rest_days: bindingRest,
      eligible_on: bindingEligibleOn,
      pitches_last_7_days: pitchesLast7,
      explanation: `Eligible under ${ruleLabel} rules, but ${reasons.join(' and ')} — expect a short or limited outing if he pitches.`,
    }
  }

  return {
    status: 'available',
    last_pitched: lastPitched,
    last_outing_pitches: byDate[lastPitched],
    required_rest_days: bindingRest,
    eligible_on: bindingEligibleOn,
    pitches_last_7_days: pitchesLast7,
    explanation: `Last pitched ${lastPitched} (${byDate[lastPitched]} pitches) — fully rested under ${ruleLabel} rules.`,
  }
}

// ── Identity resolution ────────────────────────────────
// GameChanger data is inconsistent: misspelled names, reused jersey numbers.
// Auto-attach only at high confidence; anything ambiguous becomes a NEW row
// flagged for manual review. Duplicates are recoverable via merge; a wrong
// merge silently corrupts the pitch-count math.

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = curr
  }
  return prev[n]
}

// 0..1 similarity that understands abbreviated first names ("T. Smith" vs
// "Tommy Smith") — common in GameChanger box scores.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const partsA = na.split(' ')
  const partsB = nb.split(' ')
  const lastA = partsA[partsA.length - 1]
  const lastB = partsB[partsB.length - 1]
  const firstA = partsA[0].replace(/\./g, '')
  const firstB = partsB[0].replace(/\./g, '')

  // Same last name + matching first initial covers the abbreviation case
  if (partsA.length > 1 && partsB.length > 1 && lastA === lastB) {
    if (firstA[0] === firstB[0]) {
      if (firstA.length === 1 || firstB.length === 1) return 0.92
      const firstDist = levenshtein(firstA, firstB)
      return Math.max(0.75, 1 - firstDist / Math.max(firstA.length, firstB.length)) * 0.98
    }
    return 0.6 // same last name, different first — could be siblings
  }

  const dist = levenshtein(na, nb)
  return 1 - dist / Math.max(na.length, nb.length)
}

export function matchOpponentPlayer(
  candidate: { name: string; jersey_number?: string | null },
  existing: OpponentPlayerLite[]
): PlayerMatchResult {
  const jersey = candidate.jersey_number ? String(candidate.jersey_number).trim() : null

  let best: OpponentPlayerLite | null = null
  let bestSim = 0
  let bestJerseyMatch = false
  for (const p of existing) {
    const sim = nameSimilarity(candidate.name, p.name)
    const jerseyMatch = !!jersey && !!p.jersey_number && String(p.jersey_number).trim() === jersey
    // Prefer jersey-corroborated matches at equal similarity
    if (sim > bestSim || (sim === bestSim && jerseyMatch && !bestJerseyMatch)) {
      best = p
      bestSim = sim
      bestJerseyMatch = jerseyMatch
    }
  }

  if (!best) return { player: null, matchLevel: 'none' }

  const jerseyConflict = !!jersey && !!best.jersey_number && String(best.jersey_number).trim() !== jersey

  // Exact normalized name, no jersey conflict → same kid
  if (bestSim >= 0.999 && !jerseyConflict) {
    return { player: best, matchLevel: 'exact' }
  }
  // Jersey corroborates a strong name match → attach
  if (bestJerseyMatch && bestSim >= 0.85) {
    return { player: best, matchLevel: 'strong' }
  }
  // Very strong name match without jersey data on either side → attach
  if (bestSim >= 0.92 && !jerseyConflict) {
    return { player: best, matchLevel: 'strong' }
  }
  // Plausible but below the auto-merge bar → new row, flag for review
  if ((bestJerseyMatch && bestSim >= 0.5) || bestSim >= 0.75) {
    return { player: null, matchLevel: 'possible', suspectedDuplicateId: best.id }
  }
  return { player: null, matchLevel: 'none' }
}

// Fuzzy team matching to avoid duplicate opponent_teams records
export function matchOpponentTeam(
  name: string,
  teams: Array<{ id: string; name: string }>
): { id: string; name: string; similarity: number } | null {
  let best: { id: string; name: string; similarity: number } | null = null
  for (const t of teams) {
    const sim = nameSimilarity(name, t.name)
    if (!best || sim > best.similarity) best = { ...t, similarity: sim }
  }
  return best && best.similarity >= 0.7 ? best : null
}

// ── Staleness ──────────────────────────────────────────
// Youth players change faster than any other population — decay anything over
// ~4 months and treat data older than a season as historical, not current.

export type Staleness = 'current' | 'aging' | 'historical'

export const MIN_PA_FOR_TENDENCY = 15

export function stalenessOf(dateStr: string, today: string): Staleness {
  const days = daysBetween(dateStr.slice(0, 10), today)
  if (days <= 120) return 'current'
  if (days <= 365) return 'aging'
  return 'historical'
}

export function stalenessLabel(dateStr: string, today: string): string {
  const days = daysBetween(dateStr.slice(0, 10), today)
  if (days <= 120) return 'current'
  if (days <= 365) return `${Math.round(days / 30)} months old — weight lightly, kids change fast`
  return 'over a season old — historical, not current'
}

// Exponential recency weight with ~60-day half-life, floored so old data
// still counts a little
export function recencyWeight(dateStr: string, today: string): number {
  const days = Math.max(0, daysBetween(dateStr.slice(0, 10), today))
  return Math.max(0.05, Math.pow(0.5, days / 60))
}

// ── Batting line aggregation ───────────────────────────
// batting_line jsonb keys vary by source; accept the common spellings.

export interface BattingTotals {
  games: number
  pa: number
  ab: number
  h: number
  bb: number
  k: number
  xbh: number
  sb: number
}

function num(line: any, ...keys: string[]): number {
  if (!line) return 0
  for (const k of keys) {
    const v = line[k] ?? line[k.toUpperCase()] ?? line[k.toLowerCase()]
    if (v !== undefined && v !== null && !isNaN(Number(v))) return Number(v)
  }
  return 0
}

export function aggregateBattingLines(lines: any[]): BattingTotals {
  const t: BattingTotals = { games: 0, pa: 0, ab: 0, h: 0, bb: 0, k: 0, xbh: 0, sb: 0 }
  for (const line of lines) {
    if (!line) continue
    t.games++
    const ab = num(line, 'ab', 'at_bats')
    const bb = num(line, 'bb', 'walks')
    const hbp = num(line, 'hbp')
    t.ab += ab
    t.bb += bb
    t.h += num(line, 'h', 'hits')
    t.k += num(line, 'k', 'so', 'strikeouts')
    t.xbh += num(line, '2b', 'doubles') + num(line, '3b', 'triples') + num(line, 'hr', 'home_runs')
    t.sb += num(line, 'sb', 'stolen_bases')
    t.pa += ab + bb + hbp
  }
  return t
}

export interface PitchingTotals {
  outings: number
  /** Real innings, decimal. 2.1 + 1.2 is 4, not 3.3 — see addInnings. */
  ip: number
  h: number
  r: number
  er: number
  bb: number
  k: number
  hr: number
  bf: number
  pitches: number
}

/**
 * Add a baseball innings-pitched figure to a running total.
 *
 * IP is printed in thirds and looks like a decimal but is not one: 2.1 means
 * two and one third, and 2.1 + 1.2 is 4 innings, not 3.3. Summing them as
 * decimals is a classic and completely silent error — the number stays
 * plausible, it is just wrong, and it gets worse the more outings you add.
 *
 * Returns outs, so callers accumulate in outs and convert once at the end.
 */
export function inningsToOuts(ip: number): number {
  if (!ip || isNaN(ip)) return 0
  const whole = Math.floor(ip)
  // The fraction is a count of outs (.0, .1, .2), not a proportion. Rounding
  // guards against 2.0999999 arriving from JSON.
  const thirds = Math.round((ip - whole) * 10)
  return whole * 3 + Math.min(2, Math.max(0, thirds))
}

/** Outs back to the printed form: 7 outs is 2.1. */
export function outsToInnings(outs: number): number {
  const whole = Math.floor(outs / 3)
  return Number(`${whole}.${outs % 3}`)
}

/**
 * One pitcher's season line across every outing we have logged.
 *
 * Falls back to the appearance's own innings_pitched when a row has no
 * pitching_line — every outing logged before migration 042 is in that state,
 * and dropping them would make a pitcher's total innings shrink as soon as the
 * feature shipped.
 */
export function aggregatePitchingLines(
  appearances: Array<{ pitching_line?: any; innings_pitched?: any; pitches_thrown?: any }>
): PitchingTotals {
  const t: PitchingTotals = { outings: 0, ip: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0, pitches: 0 }
  let outs = 0
  for (const a of appearances || []) {
    const pitched = Number(a?.pitches_thrown) > 0 || a?.pitching_line || Number(a?.innings_pitched) > 0
    if (!pitched) continue
    t.outings++
    const line = a?.pitching_line
    outs += inningsToOuts(num(line, 'ip', 'innings', 'innings_pitched') || Number(a?.innings_pitched) || 0)
    t.h += num(line, 'h', 'hits')
    t.r += num(line, 'r', 'runs')
    t.er += num(line, 'er', 'earned_runs')
    t.bb += num(line, 'bb', 'walks')
    t.k += num(line, 'k', 'so', 'strikeouts')
    t.hr += num(line, 'hr', 'home_runs')
    t.bf += num(line, 'bf', 'batters_faced')
    t.pitches += Number(a?.pitches_thrown) || num(line, 'pitches')
  }
  t.ip = outsToInnings(outs)
  return t
}

// Marks the end of a streamed opponent analysis and the start of its JSON
// tail. Shared so the client splits on exactly the same token.
export const SCOUT_META_SENTINEL = '\n<<<BENCHCOACH_SCOUT_META>>>'
