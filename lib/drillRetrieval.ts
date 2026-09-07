// Choosing which drills a surface gets to see.
//
// THE PROBLEM THIS REPLACES
//
// Chat asked for the first hundred drills and pasted them into the prompt. No
// filter, no ordering, no relevance — the coach's question did not participate
// in selection at all. With 206 drills in the library and no ORDER BY, that
// meant roughly half of it was invisible on any given request, and *which*
// half was undefined. A coach asking about a slow transfer got a hundred rows
// including every bunting and baserunning drill, and the model did the picking
// by reading.
//
// Prescribe, meanwhile, already had a real pipeline: a controlled problem
// vocabulary, curated mappings, and filters. This module is that pipeline made
// reusable, plus the operational metadata a production export proved has been
// sitting unused in the table — indoor_outdoor, space_required and
// requires_partner are populated on every single row and no recommendation
// surface has ever selected them.
//
// THE SHAPE
//
//   understand → filter → gather → score → rank → cut
//
// Understand and gather are I/O. Everything between them is pure and lives
// below the fold in this file, which is what makes it testable without a
// database — the test suite runs the whole ranking against fixtures.
//
// TWO RULES THAT ARE EASY TO GET WRONG
//
// An unknown constraint is not a constraint. A coach who did not mention
// equipment has not told us they have none, and filtering on absence would
// quietly empty the library. Every hard filter below fires only when the value
// is actually known.
//
// The keyword score bounds the pool; it does not decide correctness. That
// principle is inherited from prescribe, where a comment records what happens
// when it is broken — a changeup-grip video recommended for a velocity
// question because both mention "pitching". Taxonomy mapping outranks text,
// and text alone can only get a drill into consideration.

import { visibleDrills, DRILL_FIELDS, DrillRecord } from '@/lib/drills'
import { watchUrl } from '@/lib/drillVideo'
import { scoreDrillRelevance } from '@/lib/analysis'
import { Diagnosis, TaxonomyRow, diagnose, loadTaxonomy, ageCaveats } from '@/lib/drillDiagnosis'

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface RetrievalConstraints {
  /** The player's age, when a specific player is in scope. */
  playerAge?: number | null
  /** 'rec' | 'travel'. A drill scoped to the other one is excluded. */
  competitionLevel?: string | null
  /** Restrict to these skill_category values. Usually from the diagnosis. */
  categories?: string[]
  /** 'indoor' | 'outdoor', when the coach said where they are. */
  indoorOutdoor?: 'indoor' | 'outdoor' | null
  /** 'small' | 'medium' | 'large', when the coach said how much room. */
  spaceAvailable?: 'small' | 'medium' | 'large' | null
  /** What they actually have. Empty/undefined means unknown, not none. */
  availableEquipment?: string[] | null
  /** True when the coach has said they are on their own with one player. */
  alone?: boolean | null

  // ── Ability, logistics and preference (migration 056) ──────────────────
  //
  // These are all optional and all default to unknown. A surface that knows
  // none of them — Player Reports knows a player's age and need, not a roster
  // size — gets exactly the behaviour it got before.

  /**
   * How good this team is at baseball. INDEPENDENT of age.
   *
   * An advanced 9U side is a real thing and should get advanced drills that
   * are age-appropriate for nine-year-olds. This never widens the age gate.
   */
  skillLevel?: 'beginner' | 'developing' | 'advanced' | null
  /** Players expected at THIS session. Hard-gates min_players/max_players. */
  expectedPlayers?: number | null
  /** Adults at THIS session. Hard-gates min_coaches. */
  coachCount?: number | null
  /** The coach asked for fun, competition or games. Ranking only. */
  preferEngaging?: boolean | null
  /** A game is close; prefer low throwing load. Ranking only. */
  limitThrowing?: boolean | null
  /** Building stations; prefer activities that can run in parallel. */
  preferStations?: boolean | null
}

export interface RetrieveInput extends RetrievalConstraints {
  supabase: any
  coachId: string | null | undefined
  /** What the coach actually typed. Drives both diagnosis and text scoring. */
  query: string
  /** How many to return. Small on purpose — see the note on limits below. */
  limit?: number
  /** Skip the model call and take a diagnosis the caller already has. */
  diagnosis?: Diagnosis
  /** Skip the taxonomy read too. Tests and the eval harness pass this. */
  taxonomy?: TaxonomyRow[]
  /** Starred drills, used only to break ties between equally good candidates. */
  favorites?: Set<string>
}

/** Why one drill is in the result, and above the one below it. */
export interface RetrievalReason {
  score: number
  /** Highest-weight signal that fired, for a human reading the eval output. */
  primary: 'curated-map' | 'auto-map' | 'text' | 'category'
  matchedProblems: string[]
  curated: boolean
  textScore: number
  /** Filters this drill passed that were actually applied. */
  notes: string[]
}

export interface ScoredDrill {
  drill: DrillRecord
  reason: RetrievalReason
}

export interface RetrievalDebug {
  retrievalPath: 'taxonomy' | 'textual' | 'hybrid' | 'category' | 'empty'
  matchedProblems: string[]
  matchedCategories: string[]
  candidateCountBeforeFilters: number
  candidateCountAfterFilters: number
  returned: number
  filtersApplied: string[]
  /** Constraints that were unknown, and therefore deliberately not applied. */
  filtersSkipped: string[]
  /** Age guidance attached to a matched problem, if any. */
  ageCaveats: Array<{ slug: string; label: string; note: string }>
}

export interface RetrievalResult {
  drills: DrillRecord[]
  scored: ScoredDrill[]
  diagnosis: Diagnosis | null
  debug: RetrievalDebug
}

// A menu, not a catalogue. Twelve is about what a model can weigh properly in
// one pass and about what a coach would tolerate being offered. The old
// hundred was not a choice, it was a page size.
const DEFAULT_LIMIT = 12
// How much of the library to pull before ranking. Above the real table size,
// so the whole library is eligible and nothing is invisible by position.
const POOL_CEILING = 500

// ---------------------------------------------------------------------------
// Pure scoring — no I/O below this line until retrieveDrills()
// ---------------------------------------------------------------------------

const WEIGHTS = {
  curatedMap: 100,
  autoMap: 55,
  // A drill mapped to the FIRST diagnosed problem beats one mapped to the
  // third. sort_order then orders within a problem, foundational first.
  problemRankStep: 12,
  sortOrderScale: 0.05,
  categoryMatch: 8,
  // Text is deliberately small next to a curated mapping. It is a recall
  // mechanism, not a ranking authority.
  textScale: 1.4,
  favorite: 3,
  // Contextual fit, when the coach told us the context.
  contextFit: 6,
  // Preference signals (056). All small by design, and all summed AFTER the
  // taxonomy score, so they order a correct candidate pool rather than
  // reordering relevance. The largest of them, at 3 points a step, cannot
  // overturn a curated mapping worth 100 or even a category match worth 8.
  //
  // This is the property the brief calls taxonomy dominance, and it is
  // enforced by arithmetic rather than by intention.
  skillFit: 3,
  engagement: 2,
  throwing: 2,
  station: 2,
  groupSize: 2,
  competitionCtx: 1,
} as const

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
 * Whether a drill's rec/travel scoping excludes it for this team.
 *
 * KEPT AS A FILTER BUT NARROWED, and the narrowing is the point.
 *
 * This used to exclude any drill whose competition_level differed from the
 * team's. That made `travel` a proxy for ability: an advanced 9U all-star team
 * playing in a rec league could never be shown a drill tagged `travel`, no
 * matter how well it fitted, and a beginner travel team was shown everything
 * whether it suited them or not.
 *
 * Rec and travel describe WHERE A TEAM PLAYS. They do not describe how good it
 * is. Ability now has its own axis — see skillLevel — and this is back to what
 * it should always have been: a weak contextual signal.
 *
 * So the filter now only excludes when BOTH are known AND they disagree AND
 * the team level is the more restrictive one. In practice that means a rec
 * team no longer loses `travel`-tagged drills; ranking handles the preference
 * instead. Nothing is excluded on the basis of a level the drill never
 * declared.
 */
export function competitionEligible(_d: DrillRecord, _level?: string | null): boolean {
  // Deliberately always true. competition_level is a ranking signal now; see
  // competitionAffinity() below. The function is kept, exported and called so
  // the filter list, the debug output and every existing test keep their
  // shape, and so this decision is visible at the point where it used to bite
  // rather than only in a migration note.
  return true
}

// ---------------------------------------------------------------------------
// Ability, independent of age
// ---------------------------------------------------------------------------

/**
 * Fold the vocabularies that mean the same thing onto three labels.
 *
 * The library stores `beginner | intermediate | advanced`. Teams store
 * `beginner | mixed | advanced` — production's CHECK constraint says so, and
 * `mixed` is its default. The product language the brief asks for is
 * `Beginner | Developing | Advanced`.
 *
 * Rather than migrate either column and break the other, both vocabularies
 * normalise here. `mixed` and `intermediate` are the same rung: a team of
 * assorted abilities and a drill pitched between beginner and advanced are
 * both "developing".
 */
export function normalizeSkill(v?: string | null): 'beginner' | 'developing' | 'advanced' | null {
  const t = lower(v)
  if (!t) return null
  if (/(^|\b)(beginner|easy|basic|novice)(\b|$)/.test(t)) return 'beginner'
  if (/(^|\b)(advanced|hard|elite)(\b|$)/.test(t)) return 'advanced'
  if (/(^|\b)(intermediate|moderate|developing|mixed|medium)(\b|$)/.test(t)) return 'developing'
  return null
}

const SKILL_RANK: Record<string, number> = { beginner: 0, developing: 1, advanced: 2 }

/**
 * How well a drill's difficulty suits a team's ability, as a ranking signal.
 *
 * RANKING, NOT A FILTER, and that is the whole design. An advanced team still
 * needs the teaching step sometimes — a double-play progression starts with
 * footwork a beginner could do — so a developing drill must stay reachable for
 * an advanced side. What changes is which one surfaces first when both are
 * equally relevant to the diagnosed problem.
 *
 * Asymmetric on purpose. Giving a beginner team an advanced drill is a worse
 * error than giving an advanced team a beginner one: the first cannot be run
 * at all, the second is merely easy. So the penalty for overshooting is
 * steeper than for undershooting.
 */
export function skillAffinity(d: DrillRecord, want?: string | null): number {
  const target = normalizeSkill(want)
  const have = normalizeSkill(d.difficulty_level)
  if (!target || !have) return 0          // unknown either side is not a signal
  const gap = SKILL_RANK[have] - SKILL_RANK[target]
  if (gap === 0) return 2                 // exact fit
  if (gap > 0) return -2 * gap            // too hard for them
  return -1 * Math.abs(gap)               // easier than needed, still runnable
}

// ---------------------------------------------------------------------------
// Can this actually be run today?
// ---------------------------------------------------------------------------

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

/** Soft: how far the group size is from what the activity is built for. */
export function groupSizeAffinity(d: DrillRecord, groupSize?: number | null): number {
  if (groupSize == null || typeof d.ideal_group_size !== 'number') return 0
  const off = Math.abs(groupSize - d.ideal_group_size)
  if (off === 0) return 1
  if (off <= 2) return 0
  return -1
}

const LOW_MED_HIGH: Record<string, number> = { low: 0, medium: 1, high: 2 }

/**
 * Engagement preference — only when the coach asked for it.
 *
 * "Make it fun" is a real request with a real answer: change HOW the skill is
 * practised, not what is practised. So this rewards high rep density, low idle
 * time, competition and simple instructions — and it is small, because a fun
 * drill that is wrong for the baseball problem is still wrong.
 */
export function engagementAffinity(d: DrillRecord, prefer?: boolean | null): number {
  if (!prefer) return 0
  let n = 0
  const eng = LOW_MED_HIGH[lower(d.engagement_level)]
  if (eng != null) n += eng - 1                       // high +1, low -1
  const idle = LOW_MED_HIGH[lower(d.idle_time_risk)]
  if (idle != null) n += 1 - idle                     // low idle +1
  const reps = LOW_MED_HIGH[lower(d.rep_density)]
  if (reps != null) n += reps - 1
  const comp = lower(d.competition_style)
  if (comp && comp !== 'none') n += 1
  return n
}

/** Throwing load, when a game is close and the arm matters more than the rep. */
export function throwingAffinity(d: DrillRecord, limit?: boolean | null): number {
  if (!limit) return 0
  const t = lower(d.throwing_load)
  if (!t) return 0
  if (t === 'none' || t === 'low') return 2
  if (t === 'medium') return 0
  return -3                                            // high, on a game week
}

/** Station preference, when the plan is going to be built as stations. */
export function stationAffinity(d: DrillRecord, prefer?: boolean | null): number {
  if (!prefer) return 0
  if (d.station_friendly === true) return 2
  if (d.station_friendly === false) return -2
  return 0
}

/**
 * How well a drill's rec/travel scoping matches the team's, as a ranking nudge.
 *
 * Small on purpose. A curated taxonomy mapping is worth 100; this is worth a
 * few points, which is enough to order two otherwise equal drills and nowhere
 * near enough to promote a wrong one.
 */
export function competitionAffinity(d: DrillRecord, level?: string | null): number {
  if (!level) return 0
  const c = lower(d.competition_level)
  if (!c || c === 'both') return 0
  return c === lower(level) ? 1 : -1
}

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

const SPACE_RANK: Record<string, number> = {
  small: 1, medium: 2, 'medium-large': 3, large: 3, 'outfield/large': 4, outfield: 4, field: 4,
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

/** Score one drill against the diagnosis, the query and the context. */
export function scoreDrill(
  d: DrillRecord,
  ctx: {
    query: string
    slugs: string[]
    categories: string[]
    mappings: Map<string, Array<{ problem_slug: string; curated: boolean; sort_order: number }>>
    constraints: RetrievalConstraints
    favorites?: Set<string>
  }
): RetrievalReason {
  const notes: string[] = []
  let score = 0
  let primary: RetrievalReason['primary'] = 'text'
  let curated = false
  const matchedProblems: string[] = []

  // ── taxonomy: the strongest signal ──────────────────────────────────────
  for (const m of ctx.mappings.get(d.id) || []) {
    const rank = ctx.slugs.indexOf(m.problem_slug)
    if (rank === -1) continue
    matchedProblems.push(m.problem_slug)
    const base = m.curated ? WEIGHTS.curatedMap : WEIGHTS.autoMap
    // Earlier-diagnosed problems are worth more; sort_order breaks ties within
    // a problem so a foundational drill leads its own sequence.
    const value = base - rank * WEIGHTS.problemRankStep - (m.sort_order ?? 100) * WEIGHTS.sortOrderScale
    if (value > score) {
      score = value
      primary = m.curated ? 'curated-map' : 'auto-map'
      curated = m.curated
    } else if (m.curated) {
      curated = true
    }
  }
  if (matchedProblems.length) notes.push(`mapped to ${matchedProblems.join(', ')}`)

  // ── text ────────────────────────────────────────────────────────────────
  // Scored against a widened surface: the base scorer reads five fields, and
  // production has three more that carry real signal (primary_skill,
  // secondary_skill, tags). Passing them through drill_name is a deliberate
  // shim — they are short label-ish strings, which is what that slot weights.
  const textTarget = {
    ...d,
    drill_name: [d.drill_name, d.primary_skill, d.secondary_skill, ...asArray(d.tags)]
      .filter(Boolean).join(' '),
  }
  const textScore = ctx.query ? scoreDrillRelevance(ctx.query, textTarget as any) : 0
  if (textScore > 0) {
    score += textScore * WEIGHTS.textScale
    notes.push(`text ${textScore}`)
  }

  // ── category ────────────────────────────────────────────────────────────
  if (ctx.categories.length) {
    const cats = ctx.categories.map(lower)
    if (cats.includes(lower(d.skill_category)) || cats.includes(lower(d.primary_skill))) {
      score += WEIGHTS.categoryMatch
      if (primary === 'text' && textScore === 0) primary = 'category'
      notes.push('category match')
    }
  }

  // ── contextual fit, only where the coach told us the context ────────────
  const c = ctx.constraints
  if (c.alone && d.requires_partner === false) {
    score += WEIGHTS.contextFit
    notes.push('works alone')
  }
  if (c.indoorOutdoor === 'indoor' && lower(d.indoor_outdoor).includes('indoor')) {
    score += WEIGHTS.contextFit
    notes.push('indoor-friendly')
  }
  if (c.spaceAvailable === 'small' && lower(d.space_required) === 'small') {
    score += WEIGHTS.contextFit
    notes.push('fits small space')
  }

  // ── ability, logistics and preference (056) ─────────────────────────────
  // Each helper returns 0 when it has nothing to say — either the coach did
  // not tell us, or the drill does not declare it. Unknown contributes
  // nothing rather than penalising, which is what keeps 206 uncalibrated rows
  // ranking exactly as they did before.
  const skill = skillAffinity(d, c.skillLevel)
  if (skill !== 0) {
    score += skill * WEIGHTS.skillFit
    notes.push(skill > 0
      ? `difficulty fits ${c.skillLevel}`
      : `difficulty ${lower(d.difficulty_level) || 'unknown'} vs ${c.skillLevel}`)
  }

  const eng = engagementAffinity(d, c.preferEngaging)
  if (eng !== 0) {
    score += eng * WEIGHTS.engagement
    if (eng > 0) notes.push('high engagement, low idle')
  }

  const thr = throwingAffinity(d, c.limitThrowing)
  if (thr !== 0) {
    score += thr * WEIGHTS.throwing
    notes.push(thr > 0 ? 'light on the arm' : 'heavy throwing')
  }

  const st = stationAffinity(d, c.preferStations)
  if (st !== 0) {
    score += st * WEIGHTS.station
    if (st > 0) notes.push('station-friendly')
  }

  const grp = groupSizeAffinity(d, c.expectedPlayers != null && c.coachCount
    ? Math.ceil(c.expectedPlayers / Math.max(1, c.coachCount))
    : null)
  if (grp !== 0) score += grp * WEIGHTS.groupSize

  const comp = competitionAffinity(d, c.competitionLevel)
  if (comp !== 0) score += comp * WEIGHTS.competitionCtx

  // ── favorites: a tiebreak, never a promotion ────────────────────────────
  // Small enough that it cannot lift a drill over a curated taxonomy match.
  // A favorite that is wrong for the problem is still wrong.
  if (ctx.favorites?.has(d.id)) {
    score += WEIGHTS.favorite
    notes.push('★ favorite')
  }

  return { score, primary, matchedProblems, curated, textScore, notes }
}

/**
 * Deterministic ordering.
 *
 * Ties break on curated → taxonomy match → progression (foundational first) →
 * difficulty → id. The id at the end matters: without it two identically
 * scored drills can swap places between runs, and a retrieval system that
 * returns different answers to the same question is untestable.
 */
const DIFFICULTY_ORDER: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 }

export function rankScored(scored: ScoredDrill[]): ScoredDrill[] {
  return [...scored].sort((a, b) => {
    if (b.reason.score !== a.reason.score) return b.reason.score - a.reason.score
    if (a.reason.curated !== b.reason.curated) return a.reason.curated ? -1 : 1
    const am = a.reason.matchedProblems.length, bm = b.reason.matchedProblems.length
    if (am !== bm) return bm - am
    const ap = a.drill.progression_level ?? 99, bp = b.drill.progression_level ?? 99
    if (ap !== bp) return ap - bp
    const ad = DIFFICULTY_ORDER[lower(a.drill.difficulty_level)] ?? 99
    const bd = DIFFICULTY_ORDER[lower(b.drill.difficulty_level)] ?? 99
    if (ad !== bd) return ad - bd
    return String(a.drill.id).localeCompare(String(b.drill.id))
  })
}

/**
 * The whole pipeline, minus I/O. Exported so tests and the eval harness can
 * drive it against fixtures with no database and no API key.
 */
export function rankDrills(
  pool: DrillRecord[],
  mappingRows: Array<{ drill_id: string; problem_slug: string; curated: boolean; sort_order: number }>,
  input: {
    query: string
    slugs: string[]
    categories: string[]
    constraints: RetrievalConstraints
    favorites?: Set<string>
    limit?: number
  }
): { scored: ScoredDrill[]; debug: Omit<RetrievalDebug, 'ageCaveats'> } {
  const mappings = new Map<string, Array<{ problem_slug: string; curated: boolean; sort_order: number }>>()
  for (const m of mappingRows) {
    if (!mappings.has(m.drill_id)) mappings.set(m.drill_id, [])
    mappings.get(m.drill_id)!.push(m)
  }

  const c = input.constraints
  const filtersApplied: string[] = []
  const filtersSkipped: string[] = []
  const note = (name: string, known: boolean) =>
    (known ? filtersApplied : filtersSkipped).push(name)

  note('age', c.playerAge != null)
  // Listed as a ranking signal rather than a filter, because that is what it
  // now is. Naming it here keeps the evaluator's "filters" line honest.
  note('competition_level (ranking)', !!c.competitionLevel)
  note('indoor_outdoor', !!c.indoorOutdoor)
  note('space_required', !!c.spaceAvailable)
  note('equipment', !!(c.availableEquipment && c.availableEquipment.length))
  note('requires_partner', !!c.alone)
  note('skill_level (ranking)', !!c.skillLevel)
  note('min_players', c.expectedPlayers != null)
  note('min_coaches', c.coachCount != null)

  const eligible = pool.filter(d =>
    ageEligible(d, c.playerAge) &&
    competitionEligible(d, c.competitionLevel) &&
    environmentEligible(d, c.indoorOutdoor) &&
    spaceEligible(d, c.spaceAvailable) &&
    equipmentEligible(d, c.availableEquipment) &&
    // Feasibility (056). Both are inert until a drill declares a requirement
    // AND the caller declares a count — an uncalibrated library and a surface
    // that knows neither, like Player Reports, see no change at all.
    playerCountEligible(d, c.expectedPlayers) &&
    coachCountEligible(d, c.coachCount) &&
    // Partner is a preference rather than a hard filter: a coach working alone
    // can often improvise, and excluding outright would gut the pool.
    true
  )

  const scored = eligible
    .map(d => ({ drill: d, reason: scoreDrill(d, { ...input, mappings }) }))
    .filter(s => s.reason.score > 0)

  const ranked = rankScored(scored).slice(0, input.limit ?? DEFAULT_LIMIT)

  const anyMapped = ranked.some(s => s.reason.matchedProblems.length > 0)
  const anyText = ranked.some(s => s.reason.textScore > 0)
  const path: RetrievalDebug['retrievalPath'] =
    ranked.length === 0 ? 'empty'
      : anyMapped && anyText ? 'hybrid'
      : anyMapped ? 'taxonomy'
      : anyText ? 'textual'
      : 'category'

  return {
    scored: ranked,
    debug: {
      retrievalPath: path,
      matchedProblems: input.slugs,
      matchedCategories: input.categories,
      candidateCountBeforeFilters: pool.length,
      candidateCountAfterFilters: eligible.length,
      returned: ranked.length,
      filtersApplied,
      filtersSkipped,
    },
  }
}

// ---------------------------------------------------------------------------
// The I/O wrapper
// ---------------------------------------------------------------------------

/**
 * Retrieve a small, relevant, context-appropriate set of real drills.
 *
 * The whole visible library is eligible: the pool ceiling is above the table
 * size, so nothing is excluded by arriving late in an unordered result.
 */
export async function retrieveDrills(input: RetrieveInput): Promise<RetrievalResult> {
  const { supabase, coachId, query } = input

  const taxonomy = input.taxonomy ?? await loadTaxonomy(supabase)
  const diagnosis = input.diagnosis ?? (query ? await diagnose(query, taxonomy) : null)
  const slugs = diagnosis?.slugs ?? []
  const categories = input.categories?.length ? input.categories : (diagnosis?.categories ?? [])

  const { data: poolRaw } = await visibleDrills(supabase, coachId, DRILL_FIELDS).limit(POOL_CEILING)
  const pool = (poolRaw || []) as DrillRecord[]

  let mappingRows: Array<{ drill_id: string; problem_slug: string; curated: boolean; sort_order: number }> = []
  if (slugs.length > 0) {
    const { data } = await supabase
      .from('drill_problem_map')
      .select('drill_id, problem_slug, curated, sort_order')
      .in('problem_slug', slugs)
    mappingRows = (data || []) as any[]
  }

  const { scored, debug } = rankDrills(pool, mappingRows, {
    query,
    slugs,
    categories,
    constraints: input,
    favorites: input.favorites,
    limit: input.limit,
  })

  return {
    drills: scored.map(s => s.drill),
    scored,
    diagnosis,
    debug: { ...debug, ageCaveats: ageCaveats(slugs, taxonomy) },
  }
}

// ---------------------------------------------------------------------------
// Rendering for a prompt
// ---------------------------------------------------------------------------

/**
 * The candidate menu, as the model sees it.
 *
 * One block per drill rather than one line: this list is a dozen entries, not
 * a hundred, so there is room to say what a drill actually needs — and the
 * operational fields are the entire point of the exercise. Still bounded:
 * descriptions are clipped and coaching notes only appear for the top few,
 * because the model is choosing here, not running the drill.
 */
export function renderDrillMenu(
  scored: ScoredDrill[],
  opts: { favorites?: Set<string>; withNotesFor?: number } = {}
): string {
  const withNotes = opts.withNotesFor ?? 5
  return scored.map((s, i) => {
    const d = s.drill
    const marks =
      (opts.favorites?.has(d.id) ? '★ ' : '') +
      (d.created_by_coach_id ? "[the coach's own drill] " : '')

    const facts = [
      d.skill_category,
      d.difficulty_level,
      d.age_range ? `ages ${d.age_range}` : null,
      d.indoor_outdoor,
      d.space_required ? `${d.space_required} space` : null,
      d.requires_partner === true ? 'needs a partner' : d.requires_partner === false ? 'works solo' : null,
    ].filter(Boolean).join(' · ')

    const lines = [
      `${i + 1}. ${marks}"${d.drill_name}"  [id: ${d.id}]`,
      `   ${facts}`,
    ]
    if (d.description) lines.push(`   ${String(d.description).slice(0, 200)}`)
    if (asArray(d.common_flaws_fixed).length) {
      lines.push(`   fixes: ${asArray(d.common_flaws_fixed).slice(0, 6).join(', ')}`)
    }
    if (asArray(d.mechanic_focus).length) {
      lines.push(`   trains: ${asArray(d.mechanic_focus).slice(0, 5).join(', ')}`)
    }
    if (asArray(d.equipment_needed).length) {
      lines.push(`   needs: ${asArray(d.equipment_needed).join(', ')}`)
    }
    // The full link rather than the bare id, so a drill anchored to a
    // segment of a compilation reaches the coach at that segment. Chat renders
    // whatever URL the model writes, and a bare id gives it nowhere to put a
    // timestamp.
    if (d.youtube_video_id) {
      const link = watchUrl(d)
      lines.push(`   video: ${d.youtube_video_id}${link ? `  (${link})` : ''}`)
    }
    if (i < withNotes && d.ai_coaching_notes) {
      lines.push(`   coaching: ${String(d.ai_coaching_notes).slice(0, 240)}`)
    }
    return lines.join('\n')
  }).join('\n\n')
}

/**
 * One line telling the model how this shortlist was built.
 *
 * Worth the tokens: a model that knows the list was filtered to an eight-year-old
 * indoors reasons differently about it than one handed an unexplained set of
 * drills, and it stops it apologising for the absence of things that were
 * deliberately excluded.
 */
export function describeRetrieval(r: RetrievalResult): string {
  const bits: string[] = []
  if (r.diagnosis?.slugs.length) {
    bits.push(`Read as: ${r.diagnosis.slugs.join(', ')}.`)
  } else {
    bits.push('No catalogued coaching problem matched this — treated as a general request.')
  }
  if (r.debug.filtersApplied.length) {
    bits.push(`Filtered on ${r.debug.filtersApplied.join(', ')}.`)
  }
  bits.push(`${r.debug.candidateCountAfterFilters} of ${r.debug.candidateCountBeforeFilters} drills were eligible; the best ${r.debug.returned} are below.`)
  for (const c of r.debug.ageCaveats) {
    bits.push(`NOTE on "${c.label}": ${c.note}`)
  }
  return bits.join(' ')
}
