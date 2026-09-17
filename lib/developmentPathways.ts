// What to teach first, next, and later.
//
// A pathway is a curated teaching sequence: ordered stages, each with an
// objective, a mastery signal, and several drills doing different jobs. This
// module loads one, navigates it, and turns a stage into a bounded
// recommendation a practice planner can use.
//
// WHAT THIS IS NOT
//
// It is not a practice plan. It returns a stage objective, some drill ids with
// roles, a suggested order and a reason for each — and stops. The planner still
// decides minutes, stations, rotations and what else is in the session.
// Everything here is advice; nothing here writes.
//
// It is also not a difficulty model. lib/progression.ts owns that, and it is
// used here the way the brief asks: difficulty RANKS the options inside a
// stage, and never decides which stage a coach is on. A stage routinely holds
// drills from three difficulty levels, because "what comes next" and "how hard
// is it" are different axes.
//
// THE POOL
//
// Every recommendation is drawn from the SCHEDULABLE pool and nothing else.
// The exclusion is not restated here — callers hand in rows and this filters
// them with isSchedulable from lib/drills, which is the single definition of
// what a coach may be offered. A stage that recommended a source collection
// would undo two phases of curation.

import { DrillRecord, isSchedulable, SchedulableOptions } from './drills'
import {
  ageEligible, playerCountEligible, coachCountEligible,
  environmentEligible, spaceEligible, equipmentEligible,
} from './drillEligibility'
import { stageOf } from './progression'

// ── shapes ──────────────────────────────────────────────────────────────────

export type StageDrillRole =
  | 'primary' | 'regression' | 'reinforcement'
  | 'progression' | 'assessment' | 'game_application'

export interface Pathway {
  id: string
  slug: string
  name: string
  skill_category?: string | null
  summary?: string | null
  applicability?: string | null
  min_age?: number | null
  max_age?: number | null
  version?: number | null
  status?: string | null
  provenance?: string | null
}

export interface PathwayStage {
  id: string
  pathway_id: string
  stage_number: number
  stage_key: string
  name: string
  objective: string
  why_it_matters?: string | null
  prerequisite_stage_id?: string | null
  mastery_signals: string[]
  common_failure_modes: string[]
  coaching_emphasis?: string | null
  estimated_practices_min?: number | null
  estimated_practices_max?: number | null
  notes?: string | null
}

export interface StageDrillLink {
  stage_id: string
  drill_id: string
  role: StageDrillRole
  rank: number
  rationale: string
}

export interface LoadedPathway {
  pathway: Pathway
  /** Always ordered by stage_number, 1..n. */
  stages: PathwayStage[]
  linksByStage: Map<string, StageDrillLink[]>
  problemsByStage: Map<string, string[]>
}

// ── loading ─────────────────────────────────────────────────────────────────

const PATHWAY_FIELDS =
  'id, slug, name, skill_category, summary, applicability, min_age, max_age, ' +
  'version, status, provenance'
const STAGE_FIELDS =
  'id, pathway_id, stage_number, stage_key, name, objective, why_it_matters, ' +
  'prerequisite_stage_id, mastery_signals, common_failure_modes, ' +
  'coaching_emphasis, estimated_practices_min, estimated_practices_max, notes'

/**
 * Every pathway a coach may choose, published only.
 *
 * A draft pathway is one somebody is still writing and a retired one is kept so
 * a stored reference still resolves — the same split the drill library draws
 * between visible and schedulable. Neither belongs in a picker.
 *
 * Returns an empty list rather than throwing when the tables are not there. A
 * database without migration 069 should cost a coach the pathway feature, not
 * their practice plan — the same rule lib/drillMedia follows for media.
 */
export async function loadPathways(supabase: any): Promise<Pathway[]> {
  try {
    const { data, error } = await supabase
      .from('development_pathways').select(PATHWAY_FIELDS)
      .eq('status', 'published').order('name')
    if (error) throw error
    return (data || []) as Pathway[]
  } catch {
    return []
  }
}

/** One pathway with its stages, drill links and problems. Null when unknown. */
export async function loadPathway(supabase: any, slug: string): Promise<LoadedPathway | null> {
  try {
    const { data: rows, error } = await supabase
      .from('development_pathways').select(PATHWAY_FIELDS).eq('slug', slug).limit(1)
    if (error) throw error
    const pathway = ((rows || [])[0] || null) as Pathway | null
    if (!pathway) return null

    const { data: stageRows } = await supabase
      .from('development_pathway_stages').select(STAGE_FIELDS)
      .eq('pathway_id', pathway.id).order('stage_number')
    const stages = ((stageRows || []) as PathwayStage[]).slice()
      // Ordered again in memory rather than trusting the ORDER BY: every
      // navigation function below assumes this array is the sequence, and a
      // silently unordered list would make "next stage" wrong rather than
      // failing.
      .sort((a, b) => a.stage_number - b.stage_number)

    const ids = stages.map(s => s.id)
    const linksByStage = new Map<string, StageDrillLink[]>()
    const problemsByStage = new Map<string, string[]>()

    if (ids.length) {
      const { data: linkRows } = await supabase
        .from('development_pathway_stage_drills')
        .select('stage_id, drill_id, role, rank, rationale').in('stage_id', ids)
      for (const l of (linkRows || []) as StageDrillLink[]) {
        linksByStage.set(l.stage_id, (linksByStage.get(l.stage_id) || []).concat([l]))
      }

      const { data: probRows } = await supabase
        .from('development_pathway_stage_problems')
        .select('stage_id, problem_slug').in('stage_id', ids)
      for (const p of (probRows || []) as any[]) {
        problemsByStage.set(p.stage_id, (problemsByStage.get(p.stage_id) || []).concat([p.problem_slug]))
      }
    }

    return { pathway, stages, linksByStage, problemsByStage }
  } catch {
    return null
  }
}

// ── navigation ──────────────────────────────────────────────────────────────

export function orderedStages(p: LoadedPathway | null | undefined): PathwayStage[] {
  return (p?.stages || []).slice().sort((a, b) => a.stage_number - b.stage_number)
}

/**
 * The stage a coach is on.
 *
 * Clamped, the same way lib/progression.clampStep is: a stored stage number
 * that no longer exists — because the pathway was re-versioned with fewer
 * stages — must not leave a coach parked on nothing. Absent or nonsense means
 * stage one, because that is where a pathway starts.
 */
export function currentStage(
  p: LoadedPathway | null | undefined,
  stageNumber?: number | null
): PathwayStage | null {
  const stages = orderedStages(p)
  if (stages.length === 0) return null
  const n = typeof stageNumber === 'number' && stageNumber >= 1 ? Math.floor(stageNumber) : 1
  return stages[Math.min(n, stages.length) - 1]
}

/**
 * The stage after this one, or null at the end.
 *
 * Null is the point. A pathway's final stage has nothing after it, and
 * inventing a next stage — or looping to the start — would tell a coach there
 * is more when there is not.
 */
export function nextStage(
  p: LoadedPathway | null | undefined,
  stageNumber?: number | null
): PathwayStage | null {
  const stages = orderedStages(p)
  const here = currentStage(p, stageNumber)
  if (!here) return null
  const i = stages.findIndex(s => s.id === here.id)
  return i >= 0 && i + 1 < stages.length ? stages[i + 1] : null
}

/** The stage to go back to when the current one is not landing. */
export function previousStage(
  p: LoadedPathway | null | undefined,
  stageNumber?: number | null
): PathwayStage | null {
  const stages = orderedStages(p)
  const here = currentStage(p, stageNumber)
  if (!here) return null
  const i = stages.findIndex(s => s.id === here.id)
  return i > 0 ? stages[i - 1] : null
}

export function stageByKey(p: LoadedPathway | null | undefined, key: string): PathwayStage | null {
  return orderedStages(p).find(s => s.stage_key === key) || null
}

export function isFinalStage(p: LoadedPathway | null | undefined, stageNumber?: number | null): boolean {
  return nextStage(p, stageNumber) === null && currentStage(p, stageNumber) !== null
}

/** What a coach is told about where they are. */
export function describeStage(p: LoadedPathway | null | undefined, stageNumber?: number | null): string {
  const stages = orderedStages(p)
  const here = currentStage(p, stageNumber)
  if (!here) return 'No stages on this pathway.'
  return `Stage ${here.stage_number} of ${stages.length} — ${here.name}`
}

// ── feasibility ─────────────────────────────────────────────────────────────

export interface Feasibility {
  playerAge?: number | null
  playerCount?: number | null
  coachCount?: number | null
  environment?: 'indoor' | 'outdoor' | null
  space?: 'small' | 'medium' | 'large' | null
  equipment?: string[] | null
}

/**
 * Can this drill actually be run here?
 *
 * TRUE constraints only, every one of them reusing the predicate the practice
 * planner already uses. An unknown value never excludes: a drill with no
 * min_players has not said it needs four, and filtering on absence would empty
 * a stage for a reason nobody could see.
 *
 * Difficulty is deliberately absent. An advanced drill in a stage a young team
 * is on is a ranking problem, not an eligibility one — see rankStageDrills.
 */
export function feasible(d: DrillRecord, f: Feasibility = {}): boolean {
  return (
    ageEligible(d, f.playerAge) &&
    playerCountEligible(d, f.playerCount) &&
    coachCountEligible(d, f.coachCount) &&
    environmentEligible(d, f.environment ?? null) &&
    spaceEligible(d, f.space ?? null) &&
    equipmentEligible(d, f.equipment ?? null)
  )
}

// ── candidates ──────────────────────────────────────────────────────────────

export interface StageCandidate {
  drill: DrillRecord
  role: StageDrillRole
  rank: number
  rationale: string
  /** 1-3, from lib/progression. Used to order, never to exclude. */
  difficulty: number
}

const ROLE_ORDER: StageDrillRole[] = [
  'primary', 'regression', 'reinforcement', 'progression', 'assessment', 'game_application',
]

/**
 * Every drill this stage offers, narrowed to what may be run.
 *
 * Two narrowings, in this order and for different reasons:
 *
 *   1. isSchedulable — what a coach may be OFFERED at all. Not negotiable, not
 *      restated here, and applied even though the emitter already checked:
 *      curation can demote a row after a pathway is written, and this is the
 *      surface that has to notice.
 *   2. feasible — what can be run TODAY, given the roster and the field.
 *
 * A link pointing at a drill the caller did not supply is dropped silently;
 * `stageCandidates` is given a pool and answers about that pool.
 */
export function stageCandidates(
  p: LoadedPathway | null | undefined,
  stage: PathwayStage | null | undefined,
  pool: DrillRecord[],
  f: Feasibility = {},
  options: SchedulableOptions = {}
): StageCandidate[] {
  if (!p || !stage) return []
  const byId = new Map<string, DrillRecord>()
  for (const d of pool || []) if (d && d.id) byId.set(d.id, d)

  const out: StageCandidate[] = []
  for (const link of p.linksByStage.get(stage.id) || []) {
    const drill = byId.get(link.drill_id)
    if (!drill) continue
    if (!isSchedulable(drill, options)) continue
    if (!feasible(drill, f)) continue
    out.push({
      drill,
      role: link.role,
      rank: link.rank,
      rationale: link.rationale,
      difficulty: stageOf(drill as any),
    })
  }
  return rankStageDrills(out)
}

/**
 * Order the options inside a stage.
 *
 * Role first, because a primary drill and an assessment answer different
 * questions and a coach reaching for "the drill for this stage" means the
 * primary. Then the curator's rank. Then difficulty — which is where
 * lib/progression's scale earns its place: within one role, the simpler
 * version comes first. Then name, so the list is stable between two identical
 * requests.
 */
export function rankStageDrills(candidates: StageCandidate[]): StageCandidate[] {
  return candidates.slice().sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
    a.rank - b.rank ||
    a.difficulty - b.difficulty ||
    String(a.drill.drill_name || '').localeCompare(String(b.drill.drill_name || ''))
  )
}

// ── sequence intelligence ───────────────────────────────────────────────────
//
// prepare → teach → isolate → repeat → progress → decide → compete → apply
//
// Not every practice needs every step, and the brief says so. What this does is
// order whatever a stage actually offers into that shape, so a session reads as
// a progression rather than as a list sorted by difficulty.
//
// The mapping leans on drill_resources.practice_roles, which is curated on 153
// of the 154 schedulable rows and which nothing in the product sequenced with
// before. Where a drill has no practice_role, its role in the STAGE is used
// instead — a stage's primary drill is a teach whatever the row says.

export type PracticeStep =
  | 'prepare' | 'teach' | 'isolate' | 'repeat'
  | 'progress' | 'decide' | 'compete' | 'apply'

export const PRACTICE_SEQUENCE: PracticeStep[] = [
  'prepare', 'teach', 'isolate', 'repeat', 'progress', 'decide', 'compete', 'apply',
]

const ROLE_TO_STEP: Record<string, PracticeStep> = {
  warmup: 'prepare',
  teach: 'teach',
  isolate: 'isolate',
  repetition: 'repeat',
  progress: 'progress',
  decision: 'decide',
  competition: 'compete',
  game_application: 'apply',
  team_execution: 'apply',
  finish: 'compete',
}

const STAGE_ROLE_TO_STEP: Record<StageDrillRole, PracticeStep> = {
  regression: 'teach',
  primary: 'teach',
  reinforcement: 'repeat',
  progression: 'progress',
  assessment: 'decide',
  game_application: 'apply',
}

/** Where in a practice this candidate belongs. */
export function practiceStepFor(c: StageCandidate): PracticeStep {
  const roles = Array.isArray(c.drill.practice_roles) ? c.drill.practice_roles : []
  for (const step of PRACTICE_SEQUENCE) {
    for (const r of roles) {
      const key = String(r || '').toLowerCase().replace(/[^a-z]/g, '_')
      if (ROLE_TO_STEP[key] === step) return step
    }
  }
  return STAGE_ROLE_TO_STEP[c.role] || 'teach'
}

export interface SequencedCandidate extends StageCandidate {
  step: PracticeStep
}

/**
 * A stage's candidates put in practice order.
 *
 * Deduplicated by drill: a drill that holds two roles in a stage is still one
 * activity, and a session that ran it twice under two headings would be a bug
 * a coach notices immediately. The first (best-ranked) role wins.
 */
export function sequenceStage(candidates: StageCandidate[]): SequencedCandidate[] {
  const seen = new Set<string>()
  const out: SequencedCandidate[] = []
  for (const c of rankStageDrills(candidates)) {
    if (seen.has(c.drill.id)) continue
    seen.add(c.drill.id)
    out.push({ ...c, step: practiceStepFor(c) })
  }
  return out.sort((a, b) =>
    PRACTICE_SEQUENCE.indexOf(a.step) - PRACTICE_SEQUENCE.indexOf(b.step) ||
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
    a.rank - b.rank
  )
}

// ── the bounded recommendation ──────────────────────────────────────────────

export interface PathwayRecommendationInput {
  pathway: LoadedPathway
  /** 1-based. Absent means the start. */
  currentStage?: number | null
  /** Minutes available for the pathway work, not for the whole practice. */
  durationMinutes?: number | null
  playerCount?: number | null
  coachCount?: number | null
  environment?: 'indoor' | 'outdoor' | null
  space?: 'small' | 'medium' | 'large' | null
  equipment?: string[] | null
  playerAge?: number | null
  /** Taxonomy slugs the coach arrived with, if any. */
  currentProblems?: string[]
  /** The pool to draw from. Filtered again here regardless. */
  pool: DrillRecord[]
  options?: SchedulableOptions
}

export interface PathwayRecommendation {
  pathway: { slug: string; name: string }
  stage: {
    number: number
    total: number
    key: string
    name: string
    objective: string
    whyItMatters: string | null
    masterySignals: string[]
    commonFailureModes: string[]
    coachingEmphasis: string | null
    problems: string[]
  }
  /** In practice order. Ids, roles, reasons — never minutes. */
  recommended: Array<{
    drillId: string
    drillName: string
    role: StageDrillRole
    step: PracticeStep
    rationale: string
    estimatedMinutes: number | null
  }>
  /** What to check before advancing. */
  assessment: {
    masterySignals: string[]
    drillId: string | null
    drillName: string | null
  }
  nextStage: { number: number; key: string; name: string; objective: string } | null
  regressTo: { number: number; key: string; name: string } | null
  /** Plain-language reasoning, for a coach and for a prompt. */
  rationale: string
  /** Set when the stage could not be served properly. */
  warnings: string[]
}

/**
 * One stage, turned into something a practice planner can act on.
 *
 * Bounded on purpose: it names a stage, some drills, an order and a reason, and
 * it stops. It does not allocate minutes across a practice, decide stations, or
 * write anything. Practice Plan remains the thing that builds the practice —
 * this is a recommendation to it, which is what 2E.6 asks for.
 */
export function getPathwayPracticeRecommendation(
  input: PathwayRecommendationInput
): PathwayRecommendation | null {
  const p = input.pathway
  const stages = orderedStages(p)
  const stage = currentStage(p, input.currentStage)
  if (!stage) return null

  const f: Feasibility = {
    playerAge: input.playerAge,
    playerCount: input.playerCount,
    coachCount: input.coachCount,
    environment: input.environment,
    space: input.space,
    equipment: input.equipment,
  }

  const all = stageCandidates(p, stage, input.pool, {}, input.options)
  const usable = stageCandidates(p, stage, input.pool, f, input.options)
  const warnings: string[] = []

  if (all.length === 0) {
    warnings.push('No schedulable drill is attached to this stage.')
  } else if (usable.length === 0) {
    warnings.push(
      `All ${all.length} drills for this stage are ruled out by the roster, the space or ` +
      'the equipment. Widen one of those, or run the stage before this one.')
  } else if (usable.length < all.length) {
    warnings.push(`${all.length - usable.length} of ${all.length} drills for this stage cannot be run today.`)
  }

  let sequenced = sequenceStage(usable)

  // Fit the time, if a budget was given. Cut from the END: the sequence runs
  // teach → repeat → progress → apply, so what falls off is the game-transfer
  // work, which is the right thing to lose from a short session and the wrong
  // thing to lose from a long one. Never cut the first item.
  if (input.durationMinutes && input.durationMinutes > 0) {
    const budget = input.durationMinutes
    const kept: SequencedCandidate[] = []
    let spent = 0
    for (const c of sequenced) {
      const mins = Number(c.drill.est_duration_minutes) || 10
      if (kept.length > 0 && spent + mins > budget) break
      kept.push(c)
      spent += mins
    }
    if (kept.length < sequenced.length) {
      warnings.push(
        `${sequenced.length - kept.length} drill(s) left out to fit ${budget} minutes.`)
    }
    sequenced = kept
  }

  const assessmentDrill =
    usable.find(c => c.role === 'assessment') ||
    usable.find(c => c.role === 'game_application') || null

  const next = nextStage(p, stage.stage_number)
  const prev = previousStage(p, stage.stage_number)
  const problems = p.problemsByStage.get(stage.id) || []

  // Does what the coach walked in with line up with this stage?
  const asked = (input.currentProblems || []).filter(Boolean)
  const overlap = asked.filter(s => problems.indexOf(s) >= 0)
  if (asked.length > 0 && overlap.length === 0) {
    const elsewhere = stages.filter(s =>
      (p.problemsByStage.get(s.id) || []).some(x => asked.indexOf(x) >= 0))
    warnings.push(
      elsewhere.length
        ? `The problems named (${asked.join(', ')}) are addressed by stage ` +
          `${elsewhere.map(s => s.stage_number).join(', ')}, not this one.`
        : `The problems named (${asked.join(', ')}) are not addressed anywhere on this pathway.`)
  }

  const rationale = [
    `${p.pathway.name}, stage ${stage.stage_number} of ${stages.length}: ${stage.name}.`,
    `The objective is that the player ${lowerFirst(stage.objective)}`,
    stage.why_it_matters ? stage.why_it_matters : '',
    sequenced.length
      ? `The drills below run ${sequenced.map(s => s.step).filter(dedupe).join(' → ')}, ` +
        'which is teaching order rather than difficulty order.'
      : '',
    overlap.length ? `This stage addresses ${overlap.join(', ')}, which is what was asked about.` : '',
    next
      ? `Advance to "${next.name}" once the mastery signals hold.`
      : 'This is the final stage of the pathway.',
  ].filter(Boolean).join(' ')

  return {
    pathway: { slug: p.pathway.slug, name: p.pathway.name },
    stage: {
      number: stage.stage_number,
      total: stages.length,
      key: stage.stage_key,
      name: stage.name,
      objective: stage.objective,
      whyItMatters: stage.why_it_matters ?? null,
      masterySignals: stage.mastery_signals || [],
      commonFailureModes: stage.common_failure_modes || [],
      coachingEmphasis: stage.coaching_emphasis ?? null,
      problems,
    },
    recommended: sequenced.map(c => ({
      drillId: c.drill.id,
      drillName: String(c.drill.drill_name || ''),
      role: c.role,
      step: c.step,
      rationale: c.rationale,
      estimatedMinutes: Number(c.drill.est_duration_minutes) || null,
    })),
    assessment: {
      masterySignals: stage.mastery_signals || [],
      drillId: assessmentDrill?.drill.id ?? null,
      drillName: assessmentDrill ? String(assessmentDrill.drill.drill_name || '') : null,
    },
    nextStage: next
      ? { number: next.stage_number, key: next.stage_key, name: next.name, objective: next.objective }
      : null,
    regressTo: prev
      ? { number: prev.stage_number, key: prev.stage_key, name: prev.name }
      : null,
    rationale,
    warnings,
  }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const dedupe = (v: string, i: number, a: string[]) => a.indexOf(v) === i

// ── multi-practice shape ────────────────────────────────────────────────────

/**
 * A block of practices across a stage, without repeating a session.
 *
 * 2E.8 asks the model to answer what a three-practice or six-practice block
 * looks like. The rule that makes it worth anything: where a stage has
 * alternatives, consecutive practices use DIFFERENT ones. A three-practice
 * block that runs the same drill three times is a list, not a plan.
 *
 * A stage with only one drill repeats it and says so — that is a fact about
 * the library, not something to paper over by inventing variety.
 */
export interface PracticeBlockEntry {
  practice: number
  stageNumber: number
  stageName: string
  objective: string
  drills: Array<{ drillId: string; drillName: string; role: StageDrillRole; step: PracticeStep }>
  note: string
}

// What to tell the coach about repetition in one practice. A drill that comes
// back from an earlier stage is named, because "you already did this one" is
// the useful sentence and silence would be a lie.
function noteFor(repeatedInStage: number, options: number, fromEarlier: string[]): string {
  const parts: string[] = []
  if (repeatedInStage > 0) {
    parts.push(`${repeatedInStage} drill(s) repeated — this stage has ${options} option(s) in total.`)
  }
  if (fromEarlier.length > 0) {
    parts.push(`Already run earlier in this block, and repeated on purpose: ${fromEarlier.join(', ')}.`)
  }
  return parts.length === 0 ? 'All new drills for this stage.' : parts.join(' ')
}

export function planPracticeBlock(
  p: LoadedPathway,
  startStage: number,
  practices: number,
  pool: DrillRecord[],
  f: Feasibility = {},
  perPractice = 3
): PracticeBlockEntry[] {
  const out: PracticeBlockEntry[] = []
  const stages = orderedStages(p)
  if (stages.length === 0 || practices < 1) return out

  // How many practices a stage is expected to take, from the curation. A stage
  // with no estimate gets one practice rather than a guess.
  let stageIndex = Math.max(0, Math.min(stages.length - 1, (startStage || 1) - 1))
  let usedInStage = 0
  // Two sets, on purpose. usedDrills is cleared at a stage boundary so the new
  // stage still leads with its own primary drill. usedInBlock is never cleared,
  // because a coach who has already run a drill this block has run it, whatever
  // stage it was filed under — and the note has to say so.
  const usedDrills = new Set<string>()
  const usedInBlock = new Set<string>()

  for (let i = 1; i <= practices; i++) {
    const stage = stages[stageIndex]
    const candidates = sequenceStage(stageCandidates(p, stage, pool, f))

    if (candidates.length === 0) {
      out.push({
        practice: i, stageNumber: stage.stage_number, stageName: stage.name,
        objective: stage.objective, drills: [],
        note: 'No drill for this stage can be run under these constraints.',
      })
      stageIndex = Math.min(stages.length - 1, stageIndex + 1)
      continue
    }

    // Prefer what has not been used yet in this stage; fall back to reusing
    // when the stage has nothing left, and say which happened.
    const fresh = candidates.filter(c => !usedDrills.has(c.drill.id))
    const picked = (fresh.length >= perPractice ? fresh : fresh.concat(
      candidates.filter(c => usedDrills.has(c.drill.id)))).slice(0, perPractice)
    for (const c of picked) usedDrills.add(c.drill.id)

    const repeated = picked.filter(c => fresh.indexOf(c) < 0).length
    const seenEarlier = picked.filter(c => usedInBlock.has(c.drill.id))
    for (const c of picked) usedInBlock.add(c.drill.id)
    out.push({
      practice: i,
      stageNumber: stage.stage_number,
      stageName: stage.name,
      objective: stage.objective,
      drills: picked.map(c => ({
        drillId: c.drill.id, drillName: String(c.drill.drill_name || ''),
        role: c.role, step: c.step,
      })),
      note: noteFor(repeated, candidates.length, seenEarlier.map(c => String(c.drill.drill_name || ''))),
    })

    usedInStage++
    const expected = stage.estimated_practices_min || 1
    if (usedInStage >= expected && stageIndex < stages.length - 1) {
      stageIndex++
      usedInStage = 0
      usedDrills.clear()
    }
  }

  return out
}
