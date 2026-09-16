// What the Drill Finder shows, and in what order.
//
// THE PRINCIPLE THIS FILE ENFORCES
//
//   The drill is the product. Media supports the drill.
//
// That is not a slogan here, it is a constraint with numbers behind it. The
// library has 219 media rows, ZERO curated timestamps and ZERO verified rows,
// and 69 of the 154 schedulable activities are backed by a video that also
// backs another drill. A card that leads with a thumbnail and a play button is
// promising a coach something the library cannot deliver: they tap it and land
// at 0:00 of a twelve-minute compilation.
//
// Phase 2C is what makes the alternative possible. Every schedulable activity
// now carries a description, coaching cues, success markers, a regression and a
// progression — 154 of 154, measured, not assumed. So the activity has enough
// to lead with on its own, and this module is the part that decides what leads.
//
// WHY IT IS A LIBRARY AND NOT COMPONENT CODE
//
// Every decision in here is a rule that can be wrong: what counts as a
// defensible chip, what a search should rank first, when two drills are
// genuinely related, and — the load-bearing one — what a media link is allowed
// to claim. Those belong somewhere a test can reach them.
// scripts/test-drill-finder.ts asserts them against both fixtures and the real
// production shape.

import { DrillRecord } from './drills'
import { PlayableMedia } from './drillMedia'
import { formatTimestamp } from './drillVideo'

// ── text ────────────────────────────────────────────────────────────────────
//
// Coaches type "warm up", the library says "Warmup" and the taxonomy says
// "warm-up". Those are one word and the search has to agree, so everything is
// compared in two normalized forms: a spaced one for tokens and a squashed one
// for phrases.

/** Lowercase, punctuation to spaces, runs collapsed. */
export function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** norm() with the spaces removed, so "warm-up", "warm up" and "warmup" agree. */
export function squash(s: unknown): string {
  return norm(s).replace(/ /g, '')
}

// Dropped from queries only. A coach typing "afraid of fly balls" means the
// same as "afraid fly balls", and keeping "of" would make a three-token query
// fail an all-tokens-must-match rule for no reason.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'my',
  'his', 'her', 'their', 'is', 'are', 'it', 'he', 'she', 'they', 'kid', 'kids',
  'player', 'players', 'drill', 'drills',
])

/** Meaningful words in a query. Never empty unless the query is. */
export function queryTokens(s: unknown): string[] {
  const all = norm(s).split(' ').filter(Boolean)
  const kept = all.filter(t => !STOPWORDS.has(t))
  // If a coach types only stopwords ("the drill"), fall back to what they typed
  // rather than matching everything.
  return kept.length ? kept : all
}

/**
 * Every word in a haystack, plus the singular of anything plural.
 *
 * The same fix Phase 2C's instruction gate needed: the library writes "fly
 * balls" and a coach types "fly ball". Matching the singular too costs one line
 * and removes a whole class of silent miss.
 */
export function haystackTokens(s: unknown): Set<string> {
  const out = new Set<string>()
  const words = norm(s).split(' ').filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    out.add(w)
    if (w.length > 3 && w.charAt(w.length - 1) === 's') out.add(w.slice(0, -1))
  }
  return out
}

// ── purpose ─────────────────────────────────────────────────────────────────

/**
 * The one line under the drill name: what this is and why you would run it.
 *
 * The first sentence of the description, because that is where Phase 2C put the
 * purpose — every one of the 142 rewritten rows opens by saying what the
 * activity is. A second sentence is taken only when the first is too short to
 * be informative on its own.
 *
 * NOT a truncation of the whole description with an ellipsis. A sentence that
 * stops mid-clause reads as broken text; a short complete sentence reads as a
 * summary.
 */
export function purposeLine(d: Pick<DrillRecord, 'description'>, max = 160): string {
  const desc = String(d?.description ?? '').trim()
  if (!desc) return ''

  // Matched rather than split on a lookbehind: lookbehind is ES2018 and this
  // project targets ES5, where TypeScript rejects the syntax outright.
  const sentences = desc.match(/[^.!?]+[.!?]*/g) || [desc]
  let out = (sentences[0] || '').trim()
  if (out.length < 60 && sentences[1]) out = `${out} ${sentences[1].trim()}`

  if (out.length <= max) return out
  // Only now, and on a word boundary.
  const cut = out.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`
}

// ── context chips ───────────────────────────────────────────────────────────

export interface ContextChip {
  label: string
  /** The longer form, for a title attribute. */
  detail: string
}

const ROLE_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  teach: 'Teaching',
  isolate: 'Isolates one thing',
  repetition: 'Rep builder',
  progress: 'Progression',
  decision: 'Decision-making',
  game_application: 'Game application',
  team_execution: 'Team execution',
  competition: 'Competitive',
  finish: 'Practice finisher',
}

/** small | medium | large, or null when the value is not one we understand. */
export function spaceBand(v: unknown): 'small' | 'medium' | 'large' | null {
  const s = norm(v)
  if (!s) return null
  if (s === 'small') return 'small'
  if (s === 'medium') return 'medium'
  if (s.indexOf('full') === 0 || s.indexOf('outfield') === 0 || s.indexOf('medium large') === 0) return 'large'
  return null
}

/**
 * The chips a card may show — and only the ones the row actually supports.
 *
 * "Only when defensible" is the whole rule here. The practice-intelligence
 * columns (station_friendly, competition_style, rep_density, throwing_load) are
 * populated on 49 to 76 of the 154 schedulable rows. A missing value means
 * nobody has calibrated that row; it does not mean "no". So every chip below
 * renders on a positive value and on nothing else — there is no chip for
 * `station_friendly === false` and none for `station_friendly == null`, because
 * those are different facts and neither is worth a coach's attention.
 *
 * `indoor_outdoor` gets the same treatment in the other direction. Production
 * holds only "Outdoor" and "Both"; "Both" is a claim the curation made, so
 * "Works indoors" is honest, and there is nothing to say about "Outdoor" that a
 * coach standing on a field needs told.
 */
export function contextChips(d: DrillRecord): ContextChip[] {
  const out: ContextChip[] = []

  if (d.station_friendly === true) {
    out.push({ label: 'Station-friendly', detail: 'Runs as one station while other groups do something else' })
  }

  const comp = norm(d.competition_style)
  if (comp && comp !== 'none') {
    out.push({ label: 'Competitive', detail: 'Has a score, a race or a winner built in' })
  }

  const env = norm(d.indoor_outdoor)
  if (env.indexOf('both') >= 0 || env.indexOf('indoor') >= 0) {
    out.push({ label: 'Works indoors', detail: 'Does not need a field' })
  }

  if (spaceBand(d.space_required) === 'small') {
    out.push({ label: 'Small space', detail: 'Fits in a cage, a gym corner or a patch of grass' })
  }

  if (norm(d.throwing_load) === 'high') {
    out.push({ label: 'High throwing load', detail: 'Lots of throws — watch arms, and mind it around a game' })
  }

  const roles = Array.isArray(d.practice_roles) ? d.practice_roles : []
  for (let i = 0; i < roles.length; i++) {
    const label = ROLE_LABELS[norm(roles[i]).replace(/ /g, '_')]
    // Not doubled up: "Competitive" already appears above from
    // competition_style, and saying it twice on one card is noise.
    if (label && !out.some(c => c.label === label)) {
      out.push({ label, detail: 'What this activity is for in a practice' })
      break
    }
  }

  return out
}

// ── taxonomy index ──────────────────────────────────────────────────────────

export interface ProblemRef {
  slug: string
  label: string
  aliases?: string[] | null
  skill_category?: string | null
}

export interface FinderIndex {
  /** drill id -> the named problems it is mapped to fix. */
  problemsByDrill: Map<string, ProblemRef[]>
  /** problem slug -> every word a coach might use for it, pooled. */
  problemTokens: Map<string, Set<string>>
  /**
   * problem slug -> the tokens of EACH label/alias, kept apart.
   *
   * Kept apart because pooling them invents matches. `one-hand-catching` has
   * "dropping glove" and "poor hand positioning" among its aliases; pooled,
   * that problem contains both "dropping" and "hand", so a coach typing
   * "dropping hands" — who means the swing flaw — got a catching drill offered
   * as a confident answer. No single alias says "dropping hand". Requiring one
   * phrase to carry the whole query is the difference.
   */
  problemPhraseTokens: Map<string, Set<string>[]>
  /** problem slug -> its label and aliases, squashed, for phrase matching. */
  problemPhrases: Map<string, string[]>
}

/**
 * The taxonomy, turned into something a keystroke can be matched against.
 *
 * Built once per page load from 49 problems and 393 mappings — both small, both
 * anon-readable, both already on the wire for other surfaces. 153 of the 154
 * schedulable activities are mapped, which is why this is worth doing: it is
 * the difference between a search box that knows "dragging the barrel" is a
 * swing-plane problem and one that does string matching on prose.
 */
export function buildFinderIndex(
  taxonomy: ProblemRef[] | null | undefined,
  mappings: Array<{ drill_id: string; problem_slug: string }> | null | undefined
): FinderIndex {
  const bySlug = new Map<string, ProblemRef>()
  const problemTokens = new Map<string, Set<string>>()
  const problemPhraseTokens = new Map<string, Set<string>[]>()
  const problemPhrases = new Map<string, string[]>()

  const tax = taxonomy || []
  for (let i = 0; i < tax.length; i++) {
    const p = tax[i]
    if (!p || !p.slug) continue
    bySlug.set(p.slug, p)

    const aliases = Array.isArray(p.aliases) ? p.aliases : []
    const phrases = [p.slug, p.label].concat(aliases).filter(Boolean)

    problemTokens.set(p.slug, haystackTokens(phrases.join(' ')))
    problemPhraseTokens.set(p.slug, phrases.map(haystackTokens))
    problemPhrases.set(p.slug, phrases.map(squash).filter(Boolean))
  }

  const problemsByDrill = new Map<string, ProblemRef[]>()
  const maps = mappings || []
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i]
    const p = m && bySlug.get(m.problem_slug)
    if (!p) continue
    const list = problemsByDrill.get(m.drill_id) || []
    list.push(p)
    problemsByDrill.set(m.drill_id, list)
  }

  return { problemsByDrill, problemTokens, problemPhraseTokens, problemPhrases }
}

/** The problems this drill is mapped to fix, for the detail view. */
export function problemsFor(d: DrillRecord, idx: FinderIndex | null): ProblemRef[] {
  if (!idx || !d?.id) return []
  return idx.problemsByDrill.get(d.id) || []
}

// ── search ──────────────────────────────────────────────────────────────────
//
// Ranked in the order 2D.4 asks for:
//
//   1  the drill's name
//   2  a named problem it is mapped to fix
//   3  its purpose / description, or its skill
//   4  coaching cues, tags, what it trains
//   5  anything else, or a partial problem match
//
// WHAT IS DELIBERATELY NOT SEARCHED
//
// The video title and the channel. Not ranked low — absent. Ranking them low
// is not enough: `channel` is on 140 of 154 rows and a handful of channels
// account for most of the library, so "rebellion" or "baseball" would pull
// dozens of unrelated activities into any result set they appeared in. The
// coach is looking for a drill, and the name of whoever filmed it is not one.

export type MatchTier = 1 | 2 | 3 | 4 | 5

export interface Match {
  drill: DrillRecord
  tier: MatchTier
  /** The problem that matched, when one did — shown as "fixes …" on the card. */
  via?: ProblemRef
}

function allTokensIn(tokens: string[], hay: Set<string>): boolean {
  if (tokens.length === 0) return false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!hay.has(t) && !(t.length > 3 && hay.has(t.slice(0, -1)))) return false
  }
  return true
}

function someTokensIn(tokens: string[], hay: Set<string>, need: number): boolean {
  let n = 0
  for (let i = 0; i < tokens.length; i++) if (hay.has(tokens[i])) n++
  return n >= need
}

/**
 * The strongest problem this query names, among the ones this drill fixes.
 *
 * `strong` means the coach's words are fully accounted for by that problem's
 * vocabulary — every content token appears in its label, slug or aliases, or
 * the query is a phrase inside one of them. "dropping hands" is strong for
 * `uppercutting`, whose aliases include "dropping the hands". "afraid of fly
 * balls" is not strong for `fear-fly-balls` — the taxonomy says "fear", not
 * "afraid" — so it comes back weak and ranks at tier 5, which still puts it on
 * screen without claiming a match nobody made.
 */
export function problemMatch(
  d: DrillRecord,
  tokens: string[],
  phrase: string,
  idx: FinderIndex | null
): { problem: ProblemRef; strong: boolean } | null {
  const mine = problemsFor(d, idx)
  if (mine.length === 0 || !idx) return null

  let weak: ProblemRef | null = null
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i]
    const hay = idx.problemTokens.get(p.slug)
    if (!hay) continue

    const phrases = idx.problemPhrases.get(p.slug) || []
    const phraseHit = phrase.length >= 4 && phrases.some(a => a.indexOf(phrase) >= 0)
    // One phrase has to carry the whole query. See problemPhraseTokens.
    const perPhrase = idx.problemPhraseTokens.get(p.slug) || []
    const wholeQueryInOnePhrase = perPhrase.some(set => allTokensIn(tokens, set))
    if (phraseHit || wholeQueryInOnePhrase) return { problem: p, strong: true }

    // Two of three words landing is a real signal and a bad certainty. It is
    // enough to show the drill; it is not enough to call it a match.
    if (!weak && tokens.length >= 2 && someTokensIn(tokens, hay, Math.max(2, Math.ceil(tokens.length * 0.6)))) {
      weak = p
    }
  }

  return weak ? { problem: weak, strong: false } : null
}

/** Which tier this drill matches the query at, or null for no match at all. */
export function matchDrill(d: DrillRecord, query: string, idx: FinderIndex | null): Match | null {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return null
  const phrase = squash(query)

  // 1 — the name.
  const nameSquashed = squash(d.drill_name)
  if (nameSquashed.indexOf(phrase) >= 0 || allTokensIn(tokens, haystackTokens(d.drill_name))) {
    return { drill: d, tier: 1 }
  }

  // 2 — a named problem this drill is mapped to fix.
  const pm = problemMatch(d, tokens, phrase, idx)
  if (pm && pm.strong) return { drill: d, tier: 2, via: pm.problem }

  // 3 — the purpose, or the skill it belongs to.
  const purpose = `${d.description || ''} ${d.skill_category || ''} ${d.primary_skill || ''} ${d.secondary_skill || ''}`
  if (squash(purpose).indexOf(phrase) >= 0 || allTokensIn(tokens, haystackTokens(purpose))) {
    return { drill: d, tier: 3 }
  }

  // 4 — what a coach says while running it, and what it trains.
  const coaching = [
    d.ai_coaching_notes || '',
    (Array.isArray(d.tags) ? d.tags : []).join(' '),
    (Array.isArray(d.mechanic_focus) ? d.mechanic_focus : []).join(' '),
    (Array.isArray(d.common_flaws_fixed) ? d.common_flaws_fixed : []).join(' '),
  ].join(' ')
  if (squash(coaching).indexOf(phrase) >= 0 || allTokensIn(tokens, haystackTokens(coaching))) {
    return { drill: d, tier: 4 }
  }

  // 5 — the rest of the written drill, or a partial problem match.
  const rest = [
    (Array.isArray(d.success_markers) ? d.success_markers : []).join(' '),
    d.regression_notes || '', d.progression_notes || '', d.advanced_progression_notes || '',
    d.reps_guidance || '', d.safety_notes || '',
    (Array.isArray(d.equipment_needed) ? d.equipment_needed : []).join(' '),
  ].join(' ')
  if (squash(rest).indexOf(phrase) >= 0 || allTokensIn(tokens, haystackTokens(rest))) {
    return { drill: d, tier: 5 }
  }
  if (pm) return { drill: d, tier: 5, via: pm.problem }

  return null
}

/**
 * The library, searched and ranked.
 *
 * Ties inside a tier break alphabetically rather than by whatever order
 * PostgREST returned — a result list that reshuffles between two identical
 * searches is a list a coach stops trusting.
 */
export function searchDrills(
  drills: DrillRecord[],
  query: string,
  idx: FinderIndex | null
): Match[] {
  if (!String(query || '').trim()) {
    return (drills || []).map(d => ({ drill: d, tier: 3 as MatchTier }))
  }

  const hits: Match[] = []
  for (let i = 0; i < (drills || []).length; i++) {
    const m = matchDrill(drills[i], query, idx)
    if (m) hits.push(m)
  }

  return hits.sort((a, b) =>
    a.tier - b.tier ||
    String(a.drill.drill_name || '').localeCompare(String(b.drill.drill_name || ''))
  )
}

// ── family relationships ────────────────────────────────────────────────────
//
// 33 of the 154 schedulable rows carry an activity_family_id, across 18
// families, 11 of which have more than one schedulable member. That is a
// minority of the library and it is exactly the minority where the grid is
// currently confusing: "One-Hand Tee Drill (Bottom Hand)", "One Hand Drill" and
// "One-Hand Tee Drill (Top Hand)" sit next to each other looking like three
// near-duplicates, when they are a regression, a base and a progression.

/**
 * How one family member relates to another, in a coach's words.
 *
 * Only the five variation_type values production actually holds. 2D.6 lists
 * "Competitive variation" and "Equipment variation" as well; there is no
 * `competitive_variant` or `equipment_variant` in the data, so there is nothing
 * to label and inventing the label would mean inventing the relationship.
 */
export const RELATION_LABELS: Record<string, string> = {
  base: 'The base drill',
  regression: 'Easier',
  progression: 'Progression',
  advanced: 'Advanced',
  space_variant: 'Space variation',
}

export function relationLabel(variationType: unknown): string | null {
  return RELATION_LABELS[norm(variationType).replace(/ /g, '_')] || null
}

export interface Relative {
  drill: DrillRecord
  label: string
}

/**
 * Other activities in the same family, labelled by how they differ.
 *
 * Two rules, both there to stop this becoming list clutter:
 *
 *   * a shared skill is not a relationship. Only `activity_family_id` counts —
 *     a curation decision somebody made — never "also Hitting".
 *   * a sibling with no `variation_type` is skipped. Showing it would mean
 *     printing a related drill with nothing to say about how it is related,
 *     which is the clutter this is supposed to prevent.
 *
 * Ordered easiest-first so the row reads as a ladder rather than a set.
 */
const RELATION_ORDER = ['regression', 'base', 'progression', 'advanced', 'space_variant']

export function familyMembers(d: DrillRecord, all: DrillRecord[]): Relative[] {
  const fam = d?.activity_family_id
  if (!fam) return []

  const out: Relative[] = []
  for (let i = 0; i < (all || []).length; i++) {
    const other = all[i]
    if (!other || other.id === d.id) continue
    if (other.activity_family_id !== fam) continue
    const label = relationLabel(other.variation_type)
    if (!label) continue
    out.push({ drill: other, label })
  }

  return out.sort((a, b) => {
    const ai = RELATION_ORDER.indexOf(norm(a.drill.variation_type).replace(/ /g, '_'))
    const bi = RELATION_ORDER.indexOf(norm(b.drill.variation_type).replace(/ /g, '_'))
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
      String(a.drill.drill_name || '').localeCompare(String(b.drill.drill_name || ''))
  })
}

// ── media, described honestly ───────────────────────────────────────────────

export interface MediaPresentation {
  /** The link text. Never a promise the data cannot keep. */
  label: string
  /** One line under it, or null when there is nothing worth saying. */
  note: string | null
}

/**
 * What a media link is allowed to say.
 *
 * The rules, in the order they fire:
 *
 *   * a verified row with a timestamp may say "Jump to the drill", and nothing
 *     else may. Zero rows qualify today. The branch exists so that the day
 *     somebody curates a timestamp, the UI already knows what to do with it —
 *     and so a test can prove the promise is gated on verification rather than
 *     on a number being present.
 *   * a video that also backs another drill is a "Source video", and says so.
 *     69 of 154 are in this position. Calling it "Watch this drill" would be
 *     the specific lie this phase exists to stop telling.
 *   * a single-drill video nobody has checked is a "Supporting video". Not
 *     "watch this drill" — unverified means unverified.
 *
 * `sharedWith` is how many drills that video backs, including this one.
 */
export function describeMedia(m: PlayableMedia, sharedWith = 1): MediaPresentation {
  if (m.media_type === 'article') {
    return { label: 'Read the article', note: m.source_name || null }
  }

  const verified = m.verification_status === 'verified'
  const stamped = m.start_seconds != null && m.start_seconds > 0

  if (verified && stamped) {
    // formatTimestamp rather than a second implementation of mm:ss — the whole
    // reason lib/drillVideo exists is that this codebase used to spell video
    // arithmetic out inline in eight places.
    return {
      label: `Jump to the drill (${formatTimestamp(m.start_seconds)})`,
      note: m.source_name || null,
    }
  }

  if (sharedWith > 1) {
    return {
      label: 'Source video',
      note: `Covers ${sharedWith} drills from this library — this one is somewhere inside it.`,
    }
  }

  if (m.media_type === 'instagram' || m.media_type === 'animation' || m.media_type === 'illustration') {
    return { label: 'Additional demonstration', note: m.source_name || null }
  }

  return {
    label: verified ? 'Watch this drill' : 'Supporting video',
    note: m.source_name || null,
  }
}

// ── filters ─────────────────────────────────────────────────────────────────

export interface FinderFilters {
  category: string       // 'All' or a skill_category
  age: string            // 'All' or '6U' | '8U' | '10U' | '12U'
  difficulty: string     // 'All' | 'Beginner' | 'Intermediate' | 'Advanced'
  /** Upper bound in minutes, or null. */
  maxMinutes: number | null
  /** What the coach has in the car. Empty means they have not said. */
  equipment: string[]
  environment: 'indoor' | null
  space: 'small' | 'medium' | 'large' | null
  role: string | null
  stationOnly: boolean
  competitiveOnly: boolean
  favoritesOnly: boolean
}

export const EMPTY_FILTERS: FinderFilters = {
  category: 'All', age: 'All', difficulty: 'All', maxMinutes: null,
  equipment: [], environment: null, space: null, role: null,
  stationOnly: false, competitiveOnly: false, favoritesOnly: false,
}

/** How many filters are actually narrowing anything — for the mobile badge. */
export function activeFilterCount(f: FinderFilters): number {
  let n = 0
  if (f.category !== 'All') n++
  if (f.age !== 'All') n++
  if (f.difficulty !== 'All') n++
  if (f.maxMinutes != null) n++
  if (f.equipment.length) n++
  if (f.environment) n++
  if (f.space) n++
  if (f.role) n++
  if (f.stationOnly) n++
  if (f.competitiveOnly) n++
  if (f.favoritesOnly) n++
  return n
}

export function ageFits(d: DrillRecord, group: string): boolean {
  if (!group || group === 'All') return true
  const want = parseInt(group.replace(/\D/g, ''), 10)
  if (!Number.isFinite(want)) return true
  const lo = Number(d.min_age)
  const hi = Number(d.max_age)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true
  return lo <= want && hi >= want
}

/**
 * The filters, applied.
 *
 * Every one of them treats an absent value as "unknown, keep it" rather than as
 * a no. That matters more here than it looks: `station_friendly` is populated
 * on 49 of 154 rows, so a strict reading of "station-friendly only" would hide
 * 105 activities nobody has ever assessed. The toggle narrows to what is known
 * to be true, and its label has to say so.
 *
 * The exceptions are the two toggles that ARE claims — station and competitive
 * — where a coach ticking the box is asking for the known-true set. Those
 * exclude nulls deliberately, and the UI says "known to work as a station".
 */
export function applyFilters(
  drills: DrillRecord[],
  f: FinderFilters,
  favorites: Set<string>,
  eligibility: {
    environmentEligible: (d: DrillRecord, want: 'indoor' | 'outdoor' | null) => boolean
    spaceEligible: (d: DrillRecord, have: 'small' | 'medium' | 'large' | null) => boolean
    equipmentEligible: (d: DrillRecord, have: string[] | null) => boolean
  }
): DrillRecord[] {
  return (drills || []).filter(d => {
    if (f.category !== 'All' && d.skill_category !== f.category) return false
    if (f.difficulty !== 'All' && d.difficulty_level !== f.difficulty) return false
    if (!ageFits(d, f.age)) return false

    if (f.maxMinutes != null) {
      const mins = Number(d.est_duration_minutes)
      if (Number.isFinite(mins) && mins > f.maxMinutes) return false
    }

    if (f.equipment.length && !eligibility.equipmentEligible(d, f.equipment)) return false
    if (f.environment && !eligibility.environmentEligible(d, f.environment)) return false
    if (f.space && !eligibility.spaceEligible(d, f.space)) return false

    if (f.role) {
      const roles = Array.isArray(d.practice_roles) ? d.practice_roles.map(norm) : []
      if (roles.indexOf(norm(f.role)) < 0) return false
    }

    if (f.stationOnly && d.station_friendly !== true) return false
    if (f.competitiveOnly) {
      const c = norm(d.competition_style)
      if (!c || c === 'none') return false
    }

    if (f.favoritesOnly && !(d.id && favorites.has(d.id))) return false

    return true
  })
}

/**
 * Category, age and difficulty come from the data rather than a hardcoded list.
 *
 * The page previously carried a hand-copied array of 13 categories. They happen
 * to match production today and nothing checks that they do — a new
 * skill_category would simply never appear under any tab, silently. Deriving
 * them means the filter cannot drift from the library.
 */
export function categoriesIn(drills: DrillRecord[]): string[] {
  const seen = new Set<string>()
  for (let i = 0; i < (drills || []).length; i++) {
    const c = drills[i]?.skill_category
    if (c) seen.add(String(c))
  }
  return Array.from(seen).sort()
}

export function rolesIn(drills: DrillRecord[]): string[] {
  const seen = new Set<string>()
  for (let i = 0; i < (drills || []).length; i++) {
    const roles = drills[i]?.practice_roles
    if (Array.isArray(roles)) for (let j = 0; j < roles.length; j++) if (roles[j]) seen.add(String(roles[j]))
  }
  return Array.from(seen).sort((a, b) => {
    const ai = Object.keys(ROLE_LABELS).indexOf(norm(a).replace(/ /g, '_'))
    const bi = Object.keys(ROLE_LABELS).indexOf(norm(b).replace(/ /g, '_'))
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
}

export function roleLabel(role: unknown): string {
  const key = norm(role).replace(/ /g, '_')
  return ROLE_LABELS[key] || String(role ?? '')
}

// ── detail sections ─────────────────────────────────────────────────────────

export interface DetailSection {
  heading: string
  /** Paragraph text, or a list. Exactly one is set. */
  body?: string
  items?: string[]
}

/**
 * The written drill, in the order a coach reads it before running it.
 *
 * Why use it → Setup → How it works → Coach it → Watch for → Easier → Harder.
 * Media is not in this list; it goes after, and the page renders it separately
 * so it cannot accidentally be reordered into the middle of the instructions.
 *
 * A section with nothing behind it is omitted rather than rendered empty. Every
 * one of the first five is populated on all 154 schedulable rows after Phase
 * 2C, so omission is now the rare case rather than the normal one — but
 * `safety_notes` is on 36 and `advanced_progression_notes` on 1, and an empty
 * "Safety" heading reads as though somebody forgot to fill it in.
 */
export function detailSections(d: DrillRecord): DetailSection[] {
  const out: DetailSection[] = []
  const text = (v: unknown) => String(v ?? '').trim()
  const list = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [])

  const purpose = purposeLine(d, 400)
  if (purpose) out.push({ heading: 'Why use it', body: purpose })

  const equipment = list(d.equipment_needed)
  const setup: string[] = []
  if (equipment.length) setup.push(`Equipment: ${equipment.join(', ')}`)
  if (d.min_players || d.ideal_group_size) {
    const bits: string[] = []
    if (d.min_players) bits.push(`${d.min_players}+ players`)
    if (d.ideal_group_size) bits.push(`best at ${d.ideal_group_size}`)
    setup.push(`Group: ${bits.join(', ')}`)
  }
  if (d.requires_partner) setup.push('Players work in pairs.')
  if (text(d.reps_guidance)) setup.push(`Reps: ${text(d.reps_guidance)}`)
  if (setup.length) out.push({ heading: 'Setup', items: setup })

  // The full description, minus the opening sentence already shown as the
  // purpose — so a coach does not read the same line twice.
  const full = text(d.description)
  const rest = full.length > purpose.length && full.indexOf(purpose) === 0
    ? full.slice(purpose.length).trim()
    : full
  if (rest && rest !== purpose) out.push({ heading: 'How it works', body: rest })

  if (text(d.ai_coaching_notes)) out.push({ heading: 'Coach it', body: text(d.ai_coaching_notes) })

  const markers = list(d.success_markers)
  if (markers.length) out.push({ heading: 'Watch for', items: markers })

  if (text(d.regression_notes)) out.push({ heading: 'Make it easier', body: text(d.regression_notes) })

  const harder = [text(d.progression_notes), text(d.advanced_progression_notes)].filter(Boolean)
  if (harder.length) out.push({ heading: 'Make it harder', body: harder.join('\n\n') })

  if (text(d.safety_notes)) out.push({ heading: 'Safety', body: text(d.safety_notes) })

  return out
}
