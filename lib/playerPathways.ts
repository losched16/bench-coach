// Where a player actually is on a pathway, and what a coach may do about it.
//
// Pure. Every function here takes rows and returns a decision, so the rules can
// be tested without a database and so the API routes and the UI cannot drift
// apart about what "can advance" means — they both call these.
//
// WHAT THIS FILE IS NOT ALLOWED TO DO
//
//   * decide anything on the coach's behalf. Nothing here advances a player.
//     canAdvance() answers a question; a route calls it because a human pressed
//     a button. Measurements are summarised and never judged.
//   * schedule. lib/developmentPathways.ts recommends drills for a stage and
//     the practice planner schedules them. This layer only says WHICH stage.
//   * own difficulty. lib/progression.ts is the HOW HARD axis and is untouched.

import {
  LoadedPathway, PathwayStage, orderedStages, stageByKey,
} from './developmentPathways'
import { MetricType, MetricReading, MetricDirection } from './metrics'

// ───────────────────────────────────────────────────────────────────────────
// Rows
// ───────────────────────────────────────────────────────────────────────────

export type ProgressStatus = 'active' | 'paused' | 'completed'

export type PathwayEventType =
  | 'enrolled' | 'session_logged' | 'mastery_recorded' | 'note'
  | 'advanced' | 'regressed' | 'completed' | 'paused' | 'resumed'

export interface PlayerPathwayProgress {
  id: string
  player_id: string
  team_id: string
  pathway_id: string
  pathway_version: number
  current_stage_key: string
  current_stage_number: number | null
  status: ProgressStatus
  started_at: string
  stage_started_at: string
  completed_at: string | null
  created_by: string | null
}

export interface PlayerPathwayEvent {
  id: string
  progress_id: string
  event_type: PathwayEventType
  stage_key: string | null
  stage_number: number | null
  from_stage_key: string | null
  to_stage_key: string | null
  detail: Record<string, any>
  note: string | null
  actor_user_id: string | null
  occurred_on: string
  created_at: string
}

// ───────────────────────────────────────────────────────────────────────────
// Where is the player
// ───────────────────────────────────────────────────────────────────────────

/**
 * A resolution that is honest about not resolving.
 *
 * The stale case is the whole reason this returns a shape rather than a stage.
 * A pathway can be re-curated: v2 renames a stage key or drops a stage that v1
 * had. A player enrolled against v1 then points at a key that no longer exists,
 * and the two wrong answers are (a) crash and (b) quietly move them to stage 1
 * as though nothing happened. Both lose the fact that a real child was being
 * taught something. So the caller gets told, and shows the coach.
 */
export type StageResolution =
  | { ok: true; stage: PathwayStage; total: number }
  | { ok: false; reason: 'no_pathway' | 'no_stages' | 'stage_gone'; total: number }

export function resolveStage(
  pathway: LoadedPathway | null | undefined,
  progress: Pick<PlayerPathwayProgress, 'current_stage_key'> | null | undefined
): StageResolution {
  if (!pathway || !progress) return { ok: false, reason: 'no_pathway', total: 0 }
  const stages = orderedStages(pathway)
  if (stages.length === 0) return { ok: false, reason: 'no_stages', total: 0 }
  const stage = stageByKey(pathway, progress.current_stage_key)
  if (!stage) return { ok: false, reason: 'stage_gone', total: stages.length }
  return { ok: true, stage, total: stages.length }
}

/** What to tell a coach when the stage they were on is not in the pathway any more. */
export function staleStageMessage(pathwayName: string): string {
  return `This pathway has been updated since this player started it, and the stage ` +
    `they were on is no longer part of ${pathwayName}. Their history is kept. ` +
    `Choose the stage that matches where they actually are to carry on.`
}

// ───────────────────────────────────────────────────────────────────────────
// What may the coach do
// ───────────────────────────────────────────────────────────────────────────

export interface MoveOption {
  /** The stage they would land on. */
  stage: PathwayStage
  /** 'Advance to Stage 4 — Elasticity & Quick Ground Contact' */
  label: string
}

export interface CoachDecisions {
  /** Absent on the final stage, and whenever the current stage cannot be resolved. */
  advance: MoveOption | null
  /** Absent on the first stage. */
  regress: MoveOption | null
  /**
   * True only on the FINAL stage of an active enrollment. This is what the
   * advance button becomes — never an extra button beside it, because a coach
   * who can both advance and complete at the same moment is being asked a
   * question with two right answers.
   */
  canComplete: boolean
  /** Already completed, so nothing moves until it is started again. */
  isCompleted: boolean
}

export function coachDecisions(
  pathway: LoadedPathway | null | undefined,
  progress: PlayerPathwayProgress | null | undefined
): CoachDecisions {
  const none: CoachDecisions = { advance: null, regress: null, canComplete: false, isCompleted: false }
  if (!pathway || !progress) return none
  if (progress.status === 'completed') return { ...none, isCompleted: true }

  const res = resolveStage(pathway, progress)
  if (!res.ok) return none

  const stages = orderedStages(pathway)
  const i = stages.findIndex(s => s.stage_key === res.stage.stage_key)
  const prev = i > 0 ? stages[i - 1] : null
  const next = i >= 0 && i < stages.length - 1 ? stages[i + 1] : null

  return {
    advance: next ? { stage: next, label: `Advance to Stage ${next.stage_number} — ${next.name}` } : null,
    regress: prev ? { stage: prev, label: `Go back to Stage ${prev.stage_number} — ${prev.name}` } : null,
    // The last stage is where a pathway ends, so that is where completing it
    // lives. Nowhere else.
    canComplete: next === null,
    isCompleted: false,
  }
}

/**
 * The guard the API route runs before writing.
 *
 * Deliberately separate from coachDecisions, which is for rendering. A UI that
 * hides a button is not a rule — a stale tab, a replayed request or a curl is
 * enough to get past it — so the route asks this and the button asks that, and
 * this one is the one that counts.
 */
export type MoveKind = 'advance' | 'regress' | 'complete' | 'pause' | 'resume' | 'jump'

export function validateMove(
  pathway: LoadedPathway | null | undefined,
  progress: PlayerPathwayProgress | null | undefined,
  kind: MoveKind,
  /**
   * For advance/regress: the stage the caller believes they are moving to, used
   * as a staleness check. For 'jump': the stage they are moving to, required.
   */
  toStageKey?: string | null
): { ok: true; stage: PathwayStage | null } | { ok: false; error: string } {
  if (!progress) return { ok: false, error: 'No enrollment to change' }
  if (!pathway) return { ok: false, error: 'That pathway could not be loaded' }

  if (kind === 'resume') {
    if (progress.status !== 'paused') return { ok: false, error: 'That plan is not paused' }
    return { ok: true, stage: null }
  }
  if (progress.status === 'completed') {
    return { ok: false, error: 'That plan is already complete. Start it again to keep working.' }
  }
  if (kind === 'pause') {
    if (progress.status === 'paused') return { ok: false, error: 'That plan is already paused' }
    return { ok: true, stage: null }
  }

  // JUMPING TO ANY STAGE.
  //
  // The plan is a course, not a gate: a coach may put a player on whichever
  // stage matches where they actually are, without walking them through every
  // stage in between. A kid who arrives mid-season already able to accelerate
  // does not need four practices of being told he is on stage 1.
  //
  // Still bounded by the pathway. The target must be a real stage of THIS
  // pathway, which is the only rule that was ever load-bearing — the one-at-a-
  // time restriction was a UI convention, not a safety property.
  if (kind === 'jump') {
    const key = (toStageKey || '').trim()
    if (!key) return { ok: false, error: 'No stage was named' }
    const target = stageByKey(pathway, key)
    if (!target) return { ok: false, error: 'That stage is not part of this plan' }
    if (key === progress.current_stage_key) {
      return { ok: false, error: 'They are already on that stage' }
    }
    return { ok: true, stage: target }
  }

  const d = coachDecisions(pathway, progress)

  if (kind === 'complete') {
    if (!d.canComplete) {
      return { ok: false, error: 'A pathway is completed from its final stage. Advance there first.' }
    }
    return { ok: true, stage: null }
  }

  const target = kind === 'advance' ? d.advance : d.regress
  if (!target) {
    return {
      ok: false,
      error: kind === 'advance'
        ? 'This is the final stage — there is nothing after it.'
        : 'This is the first stage — there is nothing before it.',
    }
  }
  // The client says where it thinks it is going. If that disagrees with the
  // pathway, something is stale and the safe move is to refuse rather than to
  // move a child somewhere nobody chose.
  if (toStageKey && toStageKey !== target.stage.stage_key) {
    return { ok: false, error: 'This plan has moved on since this page loaded. Reload and try again.' }
  }
  return { ok: true, stage: target.stage }
}

// ───────────────────────────────────────────────────────────────────────────
// History
// ───────────────────────────────────────────────────────────────────────────

export interface SessionCounts {
  total: number
  atCurrentStage: number
}

export function sessionCounts(
  events: PlayerPathwayEvent[] | null | undefined,
  currentStageKey: string | null | undefined
): SessionCounts {
  const logged = (events || []).filter(e => e.event_type === 'session_logged')
  return {
    total: logged.length,
    atCurrentStage: currentStageKey
      ? logged.filter(e => e.stage_key === currentStageKey).length
      : 0,
  }
}

/**
 * Which mastery signals the coach has ticked for this stage.
 *
 * The MOST RECENT mastery_recorded event wins rather than the union of all of
 * them, because unticking has to be possible — a coach who decides a signal is
 * not there yet needs that to stick, and a union can only ever grow.
 *
 * Matched on the signal TEXT, which is what migration 072 stores. An index into
 * mastery_signals[] would silently change meaning the moment the canonical
 * array is reordered.
 */
export function checkedSignals(
  events: PlayerPathwayEvent[] | null | undefined,
  stageKey: string | null | undefined
): Set<string> {
  if (!stageKey) return new Set()
  const recorded = (events || [])
    .filter(e => e.event_type === 'mastery_recorded' && e.stage_key === stageKey)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const latest = recorded[recorded.length - 1]
  const signals = latest?.detail?.signals
  return new Set(Array.isArray(signals) ? signals.filter((s: any) => typeof s === 'string') : [])
}

/**
 * The notes written against one stage, newest first.
 *
 * Stage-scoped on purpose. "The pogo rhythm fell apart today" is about stage 4
 * of this plan, and a flat list of notes on the player would lose the only
 * context that makes it findable when the coach comes back to that stage.
 */
export function notesForStage(
  events: PlayerPathwayEvent[] | null | undefined,
  stageKey: string | null | undefined
): PlayerPathwayEvent[] {
  if (!stageKey) return []
  return (events || [])
    .filter(e => e.event_type === 'note' && e.stage_key === stageKey && !!e.note)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

/** How many notes exist per stage, for the plan map. */
export function noteCounts(
  events: PlayerPathwayEvent[] | null | undefined
): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events || []) {
    if (e.event_type !== 'note' || !e.stage_key || !e.note) continue
    out.set(e.stage_key, (out.get(e.stage_key) || 0) + 1)
  }
  return out
}

/** Whole days since a timestamp. Used for "how long have they been here". */
export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return null
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))
}

/** "3 weeks on this stage" / "Started today". Plain, and never congratulatory. */
export function describeDuration(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

/** One line per event, for the history list. Never names anyone. */
export function describeEvent(e: PlayerPathwayEvent, stageName?: (key: string | null) => string): string {
  const name = (k: string | null) => (stageName ? stageName(k) : k || 'a stage')
  switch (e.event_type) {
    case 'enrolled': return `Started the plan at ${name(e.stage_key)}`
    case 'session_logged': {
      const m = e.detail?.minutes
      return `Worked on ${name(e.stage_key)}${typeof m === 'number' && m > 0 ? ` for ${m} minutes` : ''}`
    }
    case 'mastery_recorded': {
      const n = Array.isArray(e.detail?.signals) ? e.detail.signals.length : 0
      return `Recorded what ${n === 1 ? 'one signal' : `${n} signals`} looked like at ${name(e.stage_key)}`
    }
    case 'note': return `Note on ${name(e.stage_key)}`
    case 'advanced': return `Moved from ${name(e.from_stage_key)} to ${name(e.to_stage_key)}`
    case 'regressed': return `Went back from ${name(e.from_stage_key)} to ${name(e.to_stage_key)}`
    case 'completed': return 'Completed the plan'
    case 'paused': return 'Paused the plan'
    case 'resumed': return 'Picked the plan back up'
    default: return 'Something changed'
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The whole plan, at a glance
// ───────────────────────────────────────────────────────────────────────────
//
// "What is coming up, and when." The second half is the careful one.
//
// THE ONLY UNIT THIS SYSTEM HONESTLY HAS IS PRACTICES, NOT DATES.
// development_pathway_stages carries estimated_practices_min/max and nothing
// anywhere records how often a team practises. Turning "3-5 practices" into
// "about two weeks" would be inventing a cadence, and turning it into a date
// would be inventing a schedule — on a layer whose whole position is that a
// coach advances a player when they are ready, never on a timer. So estimates
// stay in practices, and the only real dates shown are ones that already
// happened.
//
// Where there IS history, history wins. A stage the player has actually been
// through reports the sessions they logged and the day they moved on, because
// that is a fact and the estimate is a guess.

export type StageProgressState = 'visited' | 'current' | 'ahead'

export interface OutlineStage {
  stage: PathwayStage
  state: StageProgressState
  /** Sessions logged while on this stage. Real, not estimated. */
  sessions: number
  /** The day the coach moved off this stage, when they have. */
  leftOn: string | null
  /** The day the player first arrived here. */
  arrivedOn: string | null
  /** From the curriculum. Null when the stage does not say. */
  practicesMin: number | null
  practicesMax: number | null
  /** How many drills the stage offers, when the caller knows. */
  drillCount: number | null
  /** Notes written against this stage. */
  notes: number
}

export interface PlanOutline {
  stages: OutlineStage[]
  currentIndex: number
  total: number
  /** Practices for the whole pathway, end to end. */
  totalMin: number
  totalMax: number
  /** Practices from the current stage to the end, current stage included. */
  remainingMin: number
  remainingMax: number
  /** Every session the coach has logged on this plan. */
  sessionsSoFar: number
  isCompleted: boolean
}

export function planOutline(
  pathway: LoadedPathway | null | undefined,
  progress: PlayerPathwayProgress | null | undefined,
  events: PlayerPathwayEvent[] | null | undefined,
  drillCounts?: Map<string, number> | null
): PlanOutline | null {
  if (!pathway) return null
  const stages = orderedStages(pathway)
  if (stages.length === 0) return null

  const evs = events || []
  const currentKey = progress?.current_stage_key ?? null
  const currentIndex = stages.findIndex(s => s.stage_key === currentKey)
  const completed = progress?.status === 'completed'

  // Which stages the player has actually set foot on. Derived from events
  // rather than from the stage number, because a regression means a player can
  // have visited stage 5 while standing on stage 4 — and an outline that called
  // stage 5 "ahead" would be telling the coach they had never run it.
  const visited = new Set<string>()
  for (const e of evs) {
    if (e.stage_key) visited.add(e.stage_key)
    if (e.from_stage_key) visited.add(e.from_stage_key)
    if (e.to_stage_key) visited.add(e.to_stage_key)
  }

  const sessionsByStage = new Map<string, number>()
  for (const e of evs) {
    if (e.event_type !== 'session_logged' || !e.stage_key) continue
    sessionsByStage.set(e.stage_key, (sessionsByStage.get(e.stage_key) || 0) + 1)
  }

  // Oldest first, so "first arrival" and "most recent departure" both read the
  // right way round however the caller sorted them.
  const chron = evs.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const arrived = new Map<string, string>()
  const left = new Map<string, string>()
  for (const e of chron) {
    if (e.event_type === 'enrolled' && e.stage_key && !arrived.has(e.stage_key)) {
      arrived.set(e.stage_key, e.occurred_on)
    }
    if (e.event_type === 'advanced' || e.event_type === 'regressed') {
      if (e.from_stage_key) left.set(e.from_stage_key, e.occurred_on)
      if (e.to_stage_key && !arrived.has(e.to_stage_key)) arrived.set(e.to_stage_key, e.occurred_on)
    }
  }

  const notes = noteCounts(evs)

  const outline: OutlineStage[] = stages.map((s, i) => {
    const isCurrent = !completed && s.stage_key === currentKey
    const state: StageProgressState = isCurrent
      ? 'current'
      : visited.has(s.stage_key) || (completed && currentIndex >= 0 && i <= currentIndex)
        ? 'visited'
        : 'ahead'
    return {
      stage: s,
      state,
      sessions: sessionsByStage.get(s.stage_key) || 0,
      leftOn: left.get(s.stage_key) ?? null,
      arrivedOn: arrived.get(s.stage_key) ?? null,
      practicesMin: (s as any).estimated_practices_min ?? null,
      practicesMax: (s as any).estimated_practices_max ?? null,
      drillCount: drillCounts?.get(s.stage_key) ?? null,
      notes: notes.get(s.stage_key) || 0,
    }
  })

  const sum = (list: OutlineStage[], key: 'practicesMin' | 'practicesMax') =>
    list.reduce((n, o) => n + (o[key] ?? 0), 0)

  // From where they stand, not from stage 1. A coach on stage 8 wants to know
  // what is left, and counting the stages already behind them would be an
  // answer to a question nobody asked.
  const from = currentIndex >= 0 ? outline.slice(currentIndex) : outline

  return {
    stages: outline,
    currentIndex,
    total: stages.length,
    totalMin: sum(outline, 'practicesMin'),
    totalMax: sum(outline, 'practicesMax'),
    remainingMin: completed ? 0 : sum(from, 'practicesMin'),
    remainingMax: completed ? 0 : sum(from, 'practicesMax'),
    sessionsSoFar: evs.filter(e => e.event_type === 'session_logged').length,
    isCompleted: completed,
  }
}

/** "3–5 practices" / "4 practices" / "" when the stage does not say. */
export function practiceRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return ''
  if (min != null && max != null && min !== max) return `${min}–${max} practices`
  const n = (min ?? max) as number
  return `${n} practice${n === 1 ? '' : 's'}`
}

// ───────────────────────────────────────────────────────────────────────────
// Measurements
// ───────────────────────────────────────────────────────────────────────────
//
// Reads player_metrics through lib/metrics types. No new storage, no new
// vocabulary — metric_types already knows that a sprint time improving means
// the number goes DOWN, and this honours that column rather than hardcoding it.

/** The four the speed pathway asks for. Slugs, matching migration 073. */
export const SPEED_METRIC_SLUGS = ['sprint_10y', 'sprint_20y', 'home_to_first', 'broad_jump'] as const

export interface MeasurementSummary {
  type: MetricType
  baseline: MetricReading | null
  previous: MetricReading | null
  latest: MetricReading | null
  /** latest − baseline, in the metric's own units. null when there is nothing to compare. */
  change: number | null
  /**
   * Whether the change is in the direction the metric calls better.
   *
   * NOT a verdict, and deliberately not called one. A tenth of a second on a
   * hand-held stopwatch held by a parent is noise, and a child who grew two
   * inches mid-season can move better and time slower. The UI shows the numbers
   * and this flag colours an arrow; neither says the player improved.
   */
  towardBetter: boolean | null
}

const sortByDate = (a: MetricReading, b: MetricReading) =>
  a.measured_on < b.measured_on ? -1 : a.measured_on > b.measured_on ? 1 : 0

export function summariseMeasurement(
  type: MetricType,
  readings: MetricReading[]
): MeasurementSummary {
  const mine = readings
    .filter(r => r.metric_type_id === type.id || r.metric === type.slug)
    .slice()
    .sort(sortByDate)

  if (mine.length === 0) {
    return { type, baseline: null, previous: null, latest: null, change: null, towardBetter: null }
  }

  const baseline = mine[0]
  const latest = mine[mine.length - 1]
  // 'previous' is the one before latest, and is null when there has only ever
  // been one reading — which is the common case at the start of a pathway and
  // must not be dressed up as a comparison.
  const previous = mine.length >= 2 ? mine[mine.length - 2] : null

  const change = mine.length >= 2 ? round2(latest.value - baseline.value) : null
  return {
    type, baseline, previous, latest, change,
    towardBetter: change === null || change === 0 ? null : isBetter(change, type.direction),
  }
}

export function summariseSpeedMeasurements(
  types: MetricType[],
  readings: MetricReading[],
  slugs: readonly string[] = SPEED_METRIC_SLUGS
): MeasurementSummary[] {
  const bySlug = new Map(types.map(t => [t.slug, t]))
  return slugs
    .map(s => bySlug.get(s))
    .filter((t): t is MetricType => !!t)
    .map(t => summariseMeasurement(t, readings))
}

function isBetter(change: number, direction: MetricDirection): boolean {
  return direction === 'lower' ? change < 0 : change > 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * "−0.11 sec" / "+5 in". Signed, in the metric's units, with no adjectives.
 *
 * The sign is the real one, not a flipped "improvement" number: a coach reading
 * a sprint time needs to see that it went down. Whether down is good is the
 * direction column's business and is expressed by the arrow, not by the digits.
 */
export function formatChange(summary: MeasurementSummary): string {
  if (summary.change === null) return ''
  const sign = summary.change > 0 ? '+' : ''
  const unit = summary.type.unit ? ` ${summary.type.unit}` : ''
  return `${sign}${summary.change}${unit}`
}

/** How many of the four benchmarks have any reading at all. */
export function measurementsRecorded(summaries: MeasurementSummary[]): number {
  return summaries.filter(s => s.latest !== null).length
}

// ───────────────────────────────────────────────────────────────────────────
// Reading and writing
// ───────────────────────────────────────────────────────────────────────────
//
// Thin. Anything with a rule in it lives above this line so it can be tested
// without a database.

export interface ActivePathwayRow extends PlayerPathwayProgress {
  pathway: { slug: string; name: string; skill_category: string | null } | null
}

/**
 * Every enrollment for a player on a team, newest first.
 *
 * Returns [] rather than throwing when migration 072 has not been applied — the
 * same position lib/developmentPathways takes about 069. A player profile
 * should lose a section, not fail to load.
 */
export async function loadPlayerPathways(
  supabase: any,
  playerId: string,
  teamId: string
): Promise<ActivePathwayRow[]> {
  try {
    const { data, error } = await supabase
      .from('player_pathway_progress')
      .select('*, pathway:development_pathways(slug, name, skill_category)')
      .eq('player_id', playerId)
      .eq('team_id', teamId)
      .order('started_at', { ascending: false })
    if (error) throw error
    return (data || []) as ActivePathwayRow[]
  } catch {
    return []
  }
}

export async function loadPathwayEvents(
  supabase: any,
  progressId: string
): Promise<PlayerPathwayEvent[]> {
  try {
    const { data, error } = await supabase
      .from('player_pathway_events')
      .select('*')
      .eq('progress_id', progressId)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []) as PlayerPathwayEvent[]
  } catch {
    return []
  }
}
