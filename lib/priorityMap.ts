// Which selected priority a drill serves, and the coverage thresholds.
//
// Split out of lib/priorityCoverage so the scheduler can reserve a share per
// priority without importing the coverage module (which imports the
// scheduler for isRedundant). Nothing here does I/O.

import { DrillRecord } from './drills'

export type PriorityKey = string

/** The library's skill_category and primary_skill values, by priority. */
export const PRIORITY_CATEGORIES: Record<string, string[]> = {
  hitting: ['hitting', 'bunting', 'soft toss'],
  throwing: ['throwing', 'pitching', 'arm care'],
  catching: ['catching'],
  infield: ['fielding (infield)', 'fielding', 'team defense', 'cutoffs & relays', 'rundowns'],
  outfield: ['fielding (fly balls)', 'fielding', 'team defense', 'cutoffs & relays'],
  baserunning: ['baserunning', 'base stealing', 'sliding'],
  'game iq': ['team defense'],
}

/**
 * What a block is about when it is not tied to a library drill. Ordered most
 * specific first, and deliberately narrow: a warm-up that "includes dry
 * swings" is caught by its type before it ever reaches this table, and a
 * fungo drill is a fielding drill however it is hit.
 */
export const PRIORITY_KEYWORDS: Array<[PriorityKey, RegExp]> = [
  ['catching', /\b(catcher|catchers|receiving|blocking|pop time|framing)\b/i],
  ['baserunning', /\b(baserunning|base running|base runner|steal|stealing|lead ?off|rounding|first.?to.?third|rundown|tag ?up|sliding)\b/i],
  ['hitting', /\b(hit|hitting|hitter|swing|swings|tee|toss|batting|bunt|bunting|bp|live at.?bats?|contact point|barrel|line drive)\b/i],
  ['outfield', /\b(outfield|fly ?ball|pop ?fly|drop step|crow hop)\b/i],
  ['infield', /\b(infield|ground ?ball|groundball|double play|fielding|glove work|short ?hop|backhand|forehand|transfer)\b/i],
  ['throwing', /\b(throw|throwing|throws|arm action|long toss|accuracy|arm slot|arm care|catch play|four.?seam|pitch|pitching|pitcher)\b/i],
  ['game iq', /\b(situation|situational|game iq|read the play|cutoff|relay|team defense|defensive alignment)\b/i],
]

/**
 * The minimum meaningful share.
 *
 * Derived, not invented: the scheduler already defines the drill time a
 * practice has (computeBudget), and with N co-primary priorities the fair
 * share is that time over N. A priority is under-covered below 60% of its
 * fair share, and never with fewer than MIN_ABSOLUTE_MINUTES — because eight
 * minutes of anything is one drill run once, whatever the arithmetic says.
 *
 * Checked against the real case: a 90-minute practice carries roughly 60
 * drill minutes; three priorities give a 20-minute fair share and a 12-minute
 * floor. Ten minutes of hitting against thirty-four of infield is flagged.
 * Sixteen minutes is not — one priority may lead — but it has to be real.
 */
export const UNDER_COVERED_SHARE = 0.6
export const STRONG_SHARE = 0.9
export const MIN_ABSOLUTE_MINUTES = 8
/**
 * A selected priority is also under-covered when the best-covered one has
 * more than twice its exposure, however the shares work out. This is the
 * "ten minutes against forty" rule, and it only bites when the gap is that
 * wide.
 */
export const MAX_DOMINANCE_RATIO = 2.0

export function normalizePriority(p: string): PriorityKey {
  return String(p || '').trim().toLowerCase()
}

export function defaultLabel(p: PriorityKey): string {
  if (p === 'game iq') return 'Game IQ'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function normName(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Which selected priorities this drill provides real reps for.
 *
 * Primary category or primary skill decides the main priority. A drill's
 * secondary skill counts too when it names a DIFFERENT selected priority —
 * "Quick Transfer" (throwing, secondary infield) is a transfer drill in both
 * senses — but tags, descriptions and coaching notes never do, because that
 * is how a fungo drill ends up counted as hitting.
 */
export function drillPriorities(d: DrillRecord | null | undefined, selected: PriorityKey[]): PriorityKey[] {
  if (!d) return []
  const out: PriorityKey[] = []
  const cat = String(d.skill_category || '').toLowerCase()
  const primary = String(d.primary_skill || '').toLowerCase()
  const secondary = String(d.secondary_skill || '').toLowerCase()
  for (const p of selected) {
    const cats = PRIORITY_CATEGORIES[p] || []
    if (cats.includes(cat) || cats.includes(primary)) out.push(p)
  }
  if (out.length === 0) {
    // A primary skill the table does not list ("sliding" for baserunning)
    // still names one thing; the keyword table reads it.
    for (const p of selected) {
      if (!out.includes(p) && PRIORITY_KEYWORDS.some(([k, re]) => k === p && (re.test(primary) || re.test(cat)))) out.push(p)
    }
  }
  for (const p of selected) {
    if (!out.includes(p) && (PRIORITY_CATEGORIES[p] || []).includes(secondary)) out.push(p)
  }
  return out
}
