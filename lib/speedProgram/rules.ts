// Speed program rules — pure functions, no I/O.
//
// Everything that decides whether something is safe, allowed or comparable
// lives here, so it can be tested without a database and so the API routes
// stay thin. The rules, in the order they matter:
//
//   * A snapshot of the template is copied into each assignment. Later changes
//     to the template never reach it (`templateSnapshot` copies by value, the
//     database refuses to change the column).
//   * A coach's changes are EVENTS applied on top of the snapshot, never edits
//     to it, so the original and every change stay visible.
//   * Advancing is the coach's decision. This module only reports whether the
//     last two sessions showed safe control; it never advances anything, and
//     it never recommends more work after a painful or poor-quality day.
//   * A pain flag on the most recent session blocks every advance, with no
//     override. Other shortfalls can be overridden with a written reason.
//   * Timed tests need open outdoor space and are not used at Foundation.
//     Results are only compared when taken under the same conditions.
//   * Nothing here produces a verdict about a player. Differences are numbers.

import {
  LEVELS, SESSION_KEYS, SCORE_KINDS, LEVEL_UP_REQUIRES, PROGRESSIONS, LEVEL_DEFS, WEEKS,
  EXERCISE_BY_KEY, GUARDRAILS, templateSnapshot,
  type LevelKey, type SessionKey, type SpaceKey, type ScoreKind, type PlanSnapshot, type Reference, type MatchKind,
} from './template'

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error })
const good = <T,>(value: T): { ok: true; value: T } => ({ ok: true, value })

export const SPACES: SpaceKey[] = ['indoor_small', 'outdoor_open']
export const FATIGUE = ['none', 'some', 'high'] as const
export const EFFORT = ['easy', 'just_right', 'hard'] as const
export const SKIP_REASONS = ['game', 'practice', 'sick', 'travel', 'weather', 'space', 'other'] as const
export type Fatigue = (typeof FATIGUE)[number]
export type Effort = (typeof EFFORT)[number]

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.trim().length <= max ? x.trim() : null)
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(x: unknown): x is string {
  if (typeof x !== 'string' || !DATE.test(x)) return false
  const d = new Date(`${x}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x
}

// ── intake ──────────────────────────────────────────────────────────────────

export interface Intake {
  age_band: '6-8' | '9-12' | '13+' | null
  training_background: string
  weekly_games: number
  weekly_hard_practices: number
  space: SpaceKey
  goals: string
  notes: string
}

export function validateIntake(raw: unknown): Result<Intake> {
  if (!isObj(raw)) return bad('Intake must be an object.')
  const age = raw.age_band ?? null
  if (age !== null && !['6-8', '9-12', '13+'].includes(age)) return bad('Age band must be 6-8, 9-12 or 13+.')
  const space = raw.space
  if (!SPACES.includes(space)) return bad('Choose the space available: indoor (about 20×15 ft) or open outdoor.')
  const games = raw.weekly_games ?? 0
  const hard = raw.weekly_hard_practices ?? 0
  for (const [n, v] of [['games', games], ['hard practices', hard]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 7) return bad(`Weekly ${n} must be a whole number from 0 to 7.`)
  }
  const bg = str(raw.training_background ?? '', 300)
  const goals = str(raw.goals ?? '', 300)
  const notes = str(raw.notes ?? '', 300)
  if (bg === null || goals === null || notes === null) return bad('Intake notes are limited to 300 characters each.')
  return good({ age_band: age, training_background: bg, weekly_games: games, weekly_hard_practices: hard, space, goals, notes })
}

// ── schedule ────────────────────────────────────────────────────────────────

/**
 * How many dedicated sessions fit this week, as a SUGGESTION. Games and hard
 * practices count toward the three quality high-intensity exposures a week the
 * page allows, so they reduce the dedicated sessions rather than adding to
 * them. The coach chooses; a coach who picks more is warned, not blocked.
 */
export function recommendedDays(level: LevelKey, games: number, hardPractices: number): { days: number; reason: string } {
  const base = LEVEL_DEFS[level].sessionsPerWeek
  const load = games + hardPractices
  const days = Math.max(1, Math.min(base, 3 - load))
  const reason = load === 0
    ? `${LEVEL_DEFS[level].label} runs ${base} sessions a week when there are no games or hard practices.`
    : `${load} game${load === 1 ? '' : 's'} or hard practice${load === 1 ? '' : 's'} a week already count${load === 1 ? 's' : ''} toward the three high-intensity exposures, so ${days} dedicated session${days === 1 ? '' : 's'}.`
  return { days, reason }
}

export function scheduleWarning(days: number, games: number, hardPractices: number): string | null {
  const total = days + games + hardPractices
  return total > 3
    ? `${days} sessions plus ${games + hardPractices} game or hard-practice day(s) is ${total} high-intensity exposures this week. The guidance is up to three. Consider fewer sessions, or lighter ones.`
    : null
}

/** Which sessions to run in a week, in order. */
export function weekSessions(days: number, week: number): SessionKey[] {
  if (days >= 3) return ['A', 'B', 'C']
  if (days === 2) return week % 2 === 1 ? ['A', 'B'] : ['A', 'C']
  return [['A', 'B', 'C', 'A'][Math.max(0, Math.min(3, week - 1))] as SessionKey]
}

// ── assignment ──────────────────────────────────────────────────────────────

export interface AssignmentInput {
  level: LevelKey
  daysPerWeek: number
  intake: Intake
}

export function validateAssignmentInput(raw: unknown): Result<AssignmentInput> {
  if (!isObj(raw)) return bad('Send the level and intake.')
  if (!LEVELS.includes(raw.level)) return bad('Choose a level: foundation, development or advanced.')
  const intake = validateIntake(raw.intake)
  if (!intake.ok) return intake
  const rec = recommendedDays(raw.level, intake.value.weekly_games, intake.value.weekly_hard_practices)
  const days = raw.daysPerWeek ?? rec.days
  if (!Number.isInteger(days) || days < 1 || days > 3) return bad('Sessions per week must be 1, 2 or 3.')
  return good({ level: raw.level, daysPerWeek: days, intake: intake.value })
}

export function buildPlan(): PlanSnapshot {
  return templateSnapshot()
}

// ── events and the effective plan ───────────────────────────────────────────

export type EventType = 'enrolled' | 'adjustment' | 'schedule' | 'space' | 'advance' | 'pause' | 'resume' | 'complete'

export interface PlanEvent {
  id?: string
  event_type: EventType
  detail: Record<string, any>
  reason?: string | null
  occurred_at?: string
}

export interface AssignmentCore {
  level: LevelKey
  space: SpaceKey
  current_week: number
  days_per_week: number
  unlocks: string[]
  status: 'active' | 'paused' | 'completed'
  plan: PlanSnapshot
}

const REF_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

export function validateReferenceUrl(raw: unknown): Result<string> {
  if (typeof raw !== 'string' || raw.length > 300) return bad('Enter a link (https only).')
  let u: URL
  try { u = new URL(raw.trim()) } catch { return bad('That is not a valid link.') }
  if (u.protocol !== 'https:') return bad('Links must start with https://.')
  if (!REF_HOSTS.has(u.hostname.toLowerCase())) return bad('Only Instagram and YouTube links are accepted here.')
  if (u.username || u.password) return bad('That link is not allowed.')
  return good(u.toString())
}

export interface AdjustmentInput {
  kind: 'exercise' | 'reference'
  session?: SessionKey
  exercise: string
  set?: { sets?: number; reps?: number | string; rest?: [number, number]; note?: string }
  remove?: boolean
  action?: 'hide' | 'replace' | 'add'
  url?: string
  creator?: string
  title?: string
}

const REPS_RANGE = /^\d{1,2}[–-]\d{1,2}$/

export function validateAdjustment(raw: unknown, core: AssignmentCore): Result<AdjustmentInput> {
  if (!isObj(raw)) return bad('Describe the change.')
  const exercise = raw.exercise
  if (typeof exercise !== 'string' || !EXERCISE_BY_KEY[exercise]) return bad('Unknown exercise.')
  if (raw.kind === 'exercise') {
    if (!SESSION_KEYS.includes(raw.session)) return bad('Choose the session (A, B or C).')
    const items = core.plan.levels[core.level].sessions[raw.session as SessionKey].items
    if (!items.some(i => i.exercise === exercise)) return bad('That exercise is not in that session.')
    if (exercise === 'warmup' && raw.remove) return bad('The warm-up cannot be removed.')
    if (raw.remove === true) return good({ kind: 'exercise', session: raw.session, exercise, remove: true })
    const s = raw.set
    if (!isObj(s)) return bad('Say what to change.')
    const set: NonNullable<AdjustmentInput['set']> = {}
    if (s.sets !== undefined) { if (!Number.isInteger(s.sets) || s.sets < 1 || s.sets > 6) return bad('Sets must be 1 to 6.'); set.sets = s.sets }
    if (s.reps !== undefined) {
      const ok = (Number.isInteger(s.reps) && s.reps >= 1 && s.reps <= 30) || (typeof s.reps === 'string' && REPS_RANGE.test(s.reps))
      if (!ok) return bad('Reps must be a number from 1 to 30, or a range like 2–3.')
      set.reps = s.reps
    }
    if (s.rest !== undefined) {
      const r = s.rest
      if (!Array.isArray(r) || r.length !== 2 || !r.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 300) || r[0] > r[1]) return bad('Rest is two numbers of seconds, 0 to 300, smallest first.')
      set.rest = [r[0], r[1]]
    }
    if (s.note !== undefined) { const n = str(s.note, 200); if (n === null) return bad('Notes are limited to 200 characters.'); set.note = n }
    if (Object.keys(set).length === 0) return bad('Say what to change.')
    return good({ kind: 'exercise', session: raw.session, exercise, set })
  }
  if (raw.kind === 'reference') {
    if (!['hide', 'replace', 'add'].includes(raw.action)) return bad('Choose hide, replace or add.')
    if (raw.action === 'hide') return good({ kind: 'reference', exercise, action: 'hide', url: typeof raw.url === 'string' ? raw.url : undefined })
    const url = validateReferenceUrl(raw.url)
    if (!url.ok) return url
    const creator = str(raw.creator, 80)
    const title = str(raw.title, 120)
    if (!creator || !title) return bad('Credit the creator and give the video a title.')
    return good({ kind: 'reference', exercise, action: raw.action, url: url.value, creator, title })
  }
  return bad('Unknown kind of change.')
}

export interface EffectiveItem {
  exercise: string
  name: string
  cue: string
  commonError: string | null
  observe: ScoreKind[]
  sets: number
  reps: number | string
  repsLabel: string
  rest: [number, number] | null
  restText: string
  optional: boolean
  note: string | null
  /** 'as_written' or the indoor substitute text applied. */
  space: 'as_written' | 'indoor_substitute'
  indoorText: string | null
  /** True while a progression gate is still locked. */
  locked: boolean
  lockedText: string | null
  modified: boolean
  drill: { name: string | null; match: MatchKind; note: string; label: string }
  references: Array<Reference & { added?: boolean }>
}

export interface EffectiveSession {
  key: SessionKey
  title: string
  theme: string
  items: EffectiveItem[]
  observes: ScoreKind[]
  warmup: string
  cooldown: string
}

export function restText(rest: [number, number] | null, note?: string): string {
  if (!rest) return note ?? 'Coach sets the rest.'
  const t = rest[0] === rest[1] ? `${rest[0]} sec` : `${rest[0]}–${rest[1]} sec`
  return note ? `${t} (${note})` : t
}

export function drillLabel(match: MatchKind, name: string | null): string {
  if (!name || match === 'none') return 'No library drill yet'
  return match === 'partial' ? `Closest library drill (not the same exercise): ${name}` : `Library drill: ${name}`
}

/**
 * The plan as this player runs it: the level's sessions from the snapshot,
 * the space's substitutes, the unlocked progressions, and every coach
 * adjustment, in the order made. Pure: the same inputs give the same plan.
 */
export function effectivePlan(core: AssignmentCore, events: PlanEvent[]): Record<SessionKey, EffectiveSession> {
  const level = core.plan.levels[core.level]
  const adjustments = events.filter(e => e.event_type === 'adjustment')
  const out = {} as Record<SessionKey, EffectiveSession>
  for (const key of SESSION_KEYS) {
    const def = level.sessions[key]
    const items: EffectiveItem[] = []
    for (const p of def.items) {
      const ex = core.plan.exercises.find(e => e.key === p.exercise)
      if (!ex) continue
      let sets = p.sets, reps = p.reps, rest = p.rest, note: string | null = p.note ?? null
      let removed = false, modified = false
      let refs: Array<Reference & { added?: boolean }> = ex.references.map(r => ({ ...r }))
      for (const ev of adjustments) {
        const d = ev.detail
        if (d.exercise !== p.exercise) continue
        if (d.kind === 'exercise' && d.session === key) {
          modified = true
          if (d.remove) removed = true
          if (d.set) {
            if (d.set.sets !== undefined) sets = d.set.sets
            if (d.set.reps !== undefined) reps = d.set.reps
            if (d.set.rest !== undefined) rest = d.set.rest
            if (d.set.note !== undefined) note = d.set.note
          }
        } else if (d.kind === 'reference') {
          if (d.action === 'hide') refs = d.url ? refs.filter(r => r.url !== d.url) : []
          else if (d.action === 'replace') refs = [{ creator: d.creator, title: d.title, url: d.url, status: 'unreviewed', added: true }]
          else if (d.action === 'add') refs.push({ creator: d.creator, title: d.title, url: d.url, status: 'unreviewed', added: true })
        }
      }
      if (removed) continue
      const gated = !!p.gate
      const unlocked = gated ? core.unlocks.includes(p.gate!) : true
      // An OPTIONAL gated item (the broad jump into a sprint) does not appear at all until unlocked.
      if (gated && p.optional && !unlocked) continue
      const indoor = core.space === 'indoor_small' && p.outdoorOnly
      if (core.space === 'indoor_small' && p.outdoorOnly && !p.indoorSubstitute && p.optional) continue
      const text = gated ? (unlocked ? p.unlockedText ?? note : p.lockedText ?? note) : note
      items.push({
        exercise: p.exercise, name: ex.name, cue: ex.cue, commonError: ex.commonError ?? null, observe: ex.observe,
        sets, reps, repsLabel: p.repsLabel, rest, restText: restText(rest, p.restNote),
        optional: !!p.optional, note: text ?? null,
        space: indoor ? 'indoor_substitute' : 'as_written', indoorText: indoor ? p.indoorSubstitute ?? null : null,
        locked: gated && !unlocked, lockedText: gated && !unlocked ? p.lockedText ?? null : null,
        modified, drill: { ...ex.drillMap, label: drillLabel(ex.drillMap.match, ex.drillMap.name) },
        references: refs,
      })
    }
    // Indoors, an outdoor-only optional item with no substitute is dropped above; any other is shown as its substitute.
    const observes = Array.from(new Set(items.flatMap(i => i.observe))) as ScoreKind[]
    out[key] = { key, title: def.title, theme: def.theme, items, observes, warmup: core.plan.warmup, cooldown: core.plan.cooldown }
  }
  return out
}

// ── sessions ────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id?: string
  week: number
  session_key: SessionKey
  status: 'completed' | 'skipped'
  occurred_on: string
  created_at?: string
  landing: number | null
  braking: number | null
  reaction: number | null
  fatigue: Fatigue | null
  effort?: Effort | null
  pain_flag: boolean
}

export interface SessionInput {
  week: number
  session_key: SessionKey
  status: 'completed' | 'skipped'
  skip_reason: (typeof SKIP_REASONS)[number] | null
  occurred_on: string
  performed: Array<{ exercise: string; sets_done: number; reps_done: string | null; skipped: boolean; note: string | null }>
  effort: Effort | null
  fatigue: Fatigue | null
  landing: number | null
  braking: number | null
  reaction: number | null
  first_step_cue: string | null
  pain_flag: boolean
  pain_note: string | null
  adjustments_note: string | null
  coach_notes: string | null
}

const score = (x: unknown): number | null | undefined => (x === null || x === undefined ? null : Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 2 ? (x as number) : undefined)

export function validateSessionInput(raw: unknown, core: AssignmentCore, plan: Record<SessionKey, EffectiveSession>, today: string): Result<SessionInput> {
  if (!isObj(raw)) return bad('Send the session record.')
  if (core.status !== 'active') return bad(core.status === 'paused' ? 'This program is paused. Resume it to log a session.' : 'This program is finished.')
  if (!SESSION_KEYS.includes(raw.session_key)) return bad('Choose the session (A, B or C).')
  if (!Number.isInteger(raw.week) || raw.week < 1 || raw.week > core.current_week) return bad(`Week must be 1 to ${core.current_week}.`)
  if (!['completed', 'skipped'].includes(raw.status)) return bad('Status must be completed or skipped.')
  if (!isDate(raw.occurred_on)) return bad('Enter the date as YYYY-MM-DD.')
  const t = new Date(`${today}T00:00:00Z`).getTime()
  const d = new Date(`${raw.occurred_on}T00:00:00Z`).getTime()
  if (d > t + 86400000) return bad('That date is in the future.')
  if (d < t - 366 * 86400000) return bad('That date is more than a year ago.')
  const pain = raw.pain_flag === true
  if (raw.pain_flag !== undefined && typeof raw.pain_flag !== 'boolean') return bad('Pain flag must be true or false.')
  const painNote = str(raw.pain_note ?? '', 200)
  const cue = str(raw.first_step_cue ?? '', 200)
  const adj = str(raw.adjustments_note ?? '', 300)
  const notes = str(raw.coach_notes ?? '', 500)
  if (painNote === null || cue === null || adj === null || notes === null) return bad('Notes are limited in length.')

  if (raw.status === 'skipped') {
    if (!SKIP_REASONS.includes(raw.skip_reason)) return bad('Say why it was skipped. Skipping is fine; it is not a failure.')
    for (const k of SCORE_KINDS) if (raw[k] !== undefined && raw[k] !== null) return bad('A skipped session has no scores.')
    return good({
      week: raw.week, session_key: raw.session_key, status: 'skipped', skip_reason: raw.skip_reason, occurred_on: raw.occurred_on,
      performed: [], effort: null, fatigue: null, landing: null, braking: null, reaction: null,
      first_step_cue: null, pain_flag: pain, pain_note: painNote || null, adjustments_note: adj || null, coach_notes: notes || null,
    })
  }

  const session = plan[raw.session_key as SessionKey]
  const performedRaw = raw.performed ?? []
  if (!Array.isArray(performedRaw) || performedRaw.length > 20) return bad('Performed exercises must be a list.')
  const performed: SessionInput['performed'] = []
  const seen = new Set<string>()
  for (const p of performedRaw) {
    if (!isObj(p) || typeof p.exercise !== 'string') return bad('Each performed exercise needs its name.')
    const item = session.items.find(i => i.exercise === p.exercise)
    if (!item) return bad(`"${p.exercise}" is not part of session ${raw.session_key} for this player.`)
    if (seen.has(p.exercise)) return bad('An exercise appears twice.')
    seen.add(p.exercise)
    const sets = p.sets_done ?? 0
    if (!Number.isInteger(sets) || sets < 0 || sets > 10) return bad('Sets done must be 0 to 10.')
    const reps = p.reps_done === undefined || p.reps_done === null ? null : str(String(p.reps_done), 20)
    if (p.reps_done !== undefined && p.reps_done !== null && reps === null) return bad('Reps done is too long.')
    const note = str(p.note ?? '', 200)
    if (note === null) return bad('Exercise notes are limited to 200 characters.')
    performed.push({ exercise: p.exercise, sets_done: sets, reps_done: reps, skipped: p.skipped === true, note: note || null })
  }

  const scores: Record<ScoreKind, number | null> = { landing: null, braking: null, reaction: null }
  for (const k of SCORE_KINDS) {
    const v = score(raw[k])
    if (v === undefined) return bad(`${k[0].toUpperCase() + k.slice(1)} must be 0, 1 or 2.`)
    if (v !== null && !session.observes.includes(k)) return bad(`${k[0].toUpperCase() + k.slice(1)} is not observed in session ${raw.session_key}; leave it blank.`)
    scores[k] = v
  }
  const effort = raw.effort ?? null
  if (effort !== null && !EFFORT.includes(effort)) return bad('Effort must be easy, just right or hard.')
  const fatigue = raw.fatigue ?? null
  if (fatigue !== null && !FATIGUE.includes(fatigue)) return bad('Fatigue must be none, some or high.')
  return good({
    week: raw.week, session_key: raw.session_key, status: 'completed', skip_reason: null, occurred_on: raw.occurred_on,
    performed, effort, fatigue, landing: scores.landing, braking: scores.braking, reaction: scores.reaction,
    first_step_cue: cue || null, pain_flag: pain, pain_note: painNote || null, adjustments_note: adj || null, coach_notes: notes || null,
  })
}

// ── guidance and the safe-advancement gate ──────────────────────────────────

// Oldest first. Ties return 0, so the (stable) sort keeps the order the database
// returned them in rather than flipping on equal timestamps.
const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
const byTime = (a: SessionRecord, b: SessionRecord) =>
  cmp(a.occurred_on, b.occurred_on) || cmp(a.created_at ?? '', b.created_at ?? '')

export function logged(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice().sort(byTime)
}

export interface Guidance {
  state: 'start' | 'continue' | 'reduce' | 'hold'
  message: string
}

/**
 * What the last logged session says about the NEXT one. It never suggests
 * more: after pain or a poor-quality day the answer is hold or reduce.
 */
export function guidance(sessions: SessionRecord[]): Guidance {
  const all = logged(sessions)
  const last = all[all.length - 1]
  if (!last) return { state: 'start', message: 'No sessions yet. Start with Week 1: slow walk-throughs and quiet landings.' }
  if (last.pain_flag) return { state: 'hold', message: 'Pain was reported at the last session. Do not add work. Rest, and have a qualified professional look at it if it continues. Nothing here can be advanced until a pain-free session is logged.' }
  if (last.status === 'skipped') return { state: 'continue', message: 'The last session was skipped. That is fine. Pick up where you left off.' }
  const scored = [last.landing, last.braking, last.reaction].filter((x): x is number => x !== null)
  if (scored.some(s => s === 0) || last.fatigue === 'high')
    return { state: 'reduce', message: 'The last session showed poor control or high fatigue. Next time: reduce the complexity or the volume, and slow the movements down. Do not add intensity.' }
  if (scored.some(s => s === 1))
    return { state: 'continue', message: 'Control was inconsistent on something. Repeat the same work next time at the same level. Do not progress yet.' }
  return { state: 'continue', message: 'Control looked consistent. Keep the same work; progress only when two sessions in a row show it.' }
}

export interface Eligibility {
  eligible: boolean
  /** 'pain' cannot be overridden; 'quality' and 'insufficient' can, with a reason. */
  blocked: 'pain' | 'quality' | 'insufficient' | null
  canOverride: boolean
  reasons: string[]
  basis: Array<{ week: number; session_key: SessionKey; occurred_on: string }>
}

/**
 * Two consecutive completed sessions (since the last advance), each pain-free,
 * without high fatigue and with every score recorded at 2, together covering
 * every required kind. Fewer than two, or a kind never observed, is
 * "insufficient"; a 0 or 1, high fatigue, or pain in either is "quality".
 * Pain in the MOST RECENT logged session blocks outright.
 */
export function eligibility(requires: ScoreKind[], sessions: SessionRecord[], sinceIso: string | null): Eligibility {
  const all = logged(sessions)
  const latest = all[all.length - 1]
  if (latest?.pain_flag) {
    return { eligible: false, blocked: 'pain', canOverride: false, basis: [], reasons: ['Pain was reported at the most recent session. Nothing can be advanced until a pain-free session is logged.'] }
  }
  const since = sinceIso ? new Date(sinceIso).getTime() : -Infinity
  const done = all.filter(s => s.status === 'completed' && (s.created_at ? new Date(s.created_at).getTime() > since : true))
  const last2 = done.slice(-2)
  const basis = last2.map(s => ({ week: s.week, session_key: s.session_key, occurred_on: s.occurred_on }))
  if (last2.length < 2) {
    return { eligible: false, blocked: 'insufficient', canOverride: true, basis, reasons: [`Needs two completed sessions ${sinceIso ? 'since the last advance' : 'logged'}; there ${last2.length === 1 ? 'is 1' : 'are 0'}.`] }
  }
  const reasons: string[] = []
  let quality = false
  for (const s of last2) {
    const label = `Week ${s.week} session ${s.session_key}`
    if (s.pain_flag) { quality = true; reasons.push(`${label}: pain reported.`) }
    if (s.fatigue === 'high') { quality = true; reasons.push(`${label}: high fatigue.`) }
    for (const k of SCORE_KINDS) {
      const v = s[k]
      if (v !== null && v < 2) { quality = true; reasons.push(`${label}: ${k} scored ${v} (needs 2).`) }
    }
  }
  if (quality) return { eligible: false, blocked: 'quality', canOverride: true, basis, reasons }
  const missing = requires.filter(k => !last2.some(s => s[k] !== null))
  if (missing.length) {
    return { eligible: false, blocked: 'insufficient', canOverride: true, basis, reasons: [`Not yet observed in the last two sessions: ${missing.join(', ')}.`] }
  }
  return { eligible: true, blocked: null, canOverride: false, basis, reasons: ['The last two completed sessions showed controlled landing, braking and reaction where they were observed.'] }
}

export interface AdvanceInput { kind: 'week' | 'level' | 'unlock'; key?: string; override: boolean; reason: string | null }

export function validateAdvanceInput(raw: unknown): Result<AdvanceInput> {
  if (!isObj(raw)) return bad('Say what to advance.')
  if (!['week', 'level', 'unlock'].includes(raw.kind)) return bad('Advance a week, a level, or unlock a progression.')
  if (raw.kind === 'unlock' && !PROGRESSIONS.some(p => p.key === raw.key)) return bad('Unknown progression.')
  const override = raw.override === true
  const reason = str(raw.reason ?? '', 300)
  if (reason === null) return bad('The reason is limited to 300 characters.')
  if (override && reason.length < 10) return bad('Overriding the safety check needs a written reason (at least 10 characters).')
  return good({ kind: raw.kind, key: raw.key, override, reason: reason || null })
}

export interface AdvanceContext {
  core: AssignmentCore
  sessions: SessionRecord[]
  events: PlanEvent[]
}

export type AdvanceDecision =
  | { ok: true; to: string | number; detail: Record<string, any>; overridden: boolean; eligibility: Eligibility }
  | { ok: false; status: 400 | 409; error: string; eligibility?: Eligibility }

export function decideAdvance(input: AdvanceInput, ctx: AdvanceContext): AdvanceDecision {
  const { core, sessions, events } = ctx
  if (core.status !== 'active') return { ok: false, status: 409, error: core.status === 'paused' ? 'Resume the program first.' : 'This program is finished.' }
  const advances = events.filter(e => e.event_type === 'advance')
  const lastAdvanceAt = advances.map(e => e.occurred_at).filter(Boolean).sort().pop() ?? null

  let requires: ScoreKind[] = []
  let to: string | number
  if (input.kind === 'week') {
    if (core.current_week >= WEEKS.length) return { ok: false, status: 409, error: 'This is the final week. Finish the program, or start a new one.' }
    to = core.current_week + 1
  } else if (input.kind === 'level') {
    const i = LEVELS.indexOf(core.level)
    if (i >= LEVELS.length - 1) return { ok: false, status: 409, error: 'Already at the highest level.' }
    to = LEVELS[i + 1]
    requires = LEVEL_UP_REQUIRES
  } else {
    const p = PROGRESSIONS.find(x => x.key === input.key)!
    if (core.unlocks.includes(p.key)) return { ok: false, status: 409, error: 'Already unlocked.' }
    if (p.outdoorOnly && core.space !== 'outdoor_open') return { ok: false, status: 409, error: `${p.label} needs open outdoor space.` }
    if (p.key === 'single_leg_hops' && core.level !== 'advanced') return { ok: false, status: 409, error: 'Single-leg hops are an Advanced-level progression.' }
    if (p.key === 'broad_jump_to_sprint' && core.current_week < 3) return { ok: false, status: 409, error: 'This is a Week 3 (Transfer) progression.' }
    if (p.key === 'reactive_partner_cues' && core.current_week < 2) return { ok: false, status: 409, error: 'Reaction cue games start in Week 2.' }
    to = p.key
    requires = p.requires
  }

  // One harder thing per week: harder jumps, more volume and faster cuts are not stacked.
  if (input.kind !== 'week') {
    const already = advances.some(e => (e.detail.kind === 'unlock' || e.detail.kind === 'level') && e.detail.week === core.current_week)
    if (already) return { ok: false, status: 409, error: 'One harder step per week. Do not stack harder jumps, more volume and faster cuts in the same week.' }
  }

  const elig = eligibility(requires, sessions, lastAdvanceAt)
  if (elig.blocked === 'pain') return { ok: false, status: 409, error: elig.reasons[0], eligibility: elig }
  if (!elig.eligible) {
    if (!input.override) return { ok: false, status: 409, error: `Not ready yet. ${elig.reasons.join(' ')} A coach can override with a written reason.`, eligibility: elig }
  }
  return {
    ok: true, to, overridden: !elig.eligible, eligibility: elig,
    detail: { kind: input.kind, key: input.key ?? null, from: input.kind === 'week' ? core.current_week : input.kind === 'level' ? core.level : null, to, week: core.current_week, override: !elig.eligible, eligibility: { blocked: elig.blocked, reasons: elig.reasons, basis: elig.basis } },
  }
}

// ── assessments ─────────────────────────────────────────────────────────────

export const TIMED_METRICS = ['sprint_10y', 'home_to_first'] as const
export const TIMING_METHODS = ['stopwatch', 'phone_video', 'timing_gates', 'other'] as const
export const START_TYPES = ['standing_start', 'three_point', 'falling_start', 'batting_stance', 'other'] as const
export const SURFACES = ['grass', 'turf', 'dirt', 'track', 'hard_floor', 'other'] as const
export const LOCATIONS = ['outdoor_open', 'field', 'indoor_small', 'gym'] as const

export interface Conditions { location: string; surface: string; timing_method: string; start_type: string; distance_yards: number }

export interface AssessmentInput {
  kind: 'baseline' | 'retest'
  method: 'timed' | 'rubric'
  metric_slug: (typeof TIMED_METRICS)[number] | null
  value: number | null
  unit: 's' | null
  rubric: Record<ScoreKind, number> | null
  conditions: Conditions | null
  occurred_on: string
  note: string | null
}

export function validateAssessmentInput(raw: unknown, core: AssignmentCore, today: string): Result<AssessmentInput> {
  if (!isObj(raw)) return bad('Send the assessment.')
  if (core.status === 'completed') return bad('This program is finished.')
  if (!['baseline', 'retest'].includes(raw.kind)) return bad('Choose baseline or retest.')
  if (!['timed', 'rubric'].includes(raw.method)) return bad('Choose a timed measurement or the 0–2 form rubric.')
  if (!isDate(raw.occurred_on)) return bad('Enter the date as YYYY-MM-DD.')
  if (new Date(`${raw.occurred_on}T00:00:00Z`).getTime() > new Date(`${today}T00:00:00Z`).getTime() + 86400000) return bad('That date is in the future.')
  const note = str(raw.note ?? '', 300)
  if (note === null) return bad('The note is limited to 300 characters.')

  if (raw.method === 'rubric') {
    const rubric = {} as Record<ScoreKind, number>
    for (const k of SCORE_KINDS) {
      const v = raw.rubric?.[k]
      if (!Number.isInteger(v) || v < 0 || v > 2) return bad('Landing, braking and reaction are each scored 0, 1 or 2.')
      rubric[k] = v
    }
    return good({ kind: raw.kind, method: 'rubric', metric_slug: null, value: null, unit: null, rubric, conditions: null, occurred_on: raw.occurred_on, note: note || null })
  }

  // Timed. Safety first: not at Foundation, never in the small indoor space.
  if (core.level === 'foundation') return bad('Foundation uses the 0–2 form rubric, not timed races.')
  if (!TIMED_METRICS.includes(raw.metric_slug)) return bad('Choose the 10-yard sprint or home-to-first.')
  if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value <= 0 || raw.value > 30) return bad('Enter the time in seconds.')
  const c = raw.conditions
  if (!isObj(c)) return bad('Record the conditions: where, the surface, how it was timed and how the start was cued.')
  if (!LOCATIONS.includes(c.location)) return bad('Choose where it was done.')
  if (!['outdoor_open', 'field'].includes(c.location)) return bad('Timed sprints need open level outdoor space. A small indoor space is not safe for them. Use the form rubric indoors.')
  if (raw.metric_slug === 'home_to_first' && c.location !== 'field') return bad('Home-to-first is timed on a baseball field.')
  if (!SURFACES.includes(c.surface)) return bad('Choose the surface.')
  if (!TIMING_METHODS.includes(c.timing_method)) return bad('Choose how it was timed.')
  if (!START_TYPES.includes(c.start_type)) return bad('Choose how the start was cued.')
  const dist = raw.metric_slug === 'sprint_10y' ? 10 : c.distance_yards
  if (typeof dist !== 'number' || !Number.isFinite(dist) || dist < 3 || dist > 100) return bad('Enter the distance in yards.')
  if (raw.metric_slug === 'sprint_10y' && c.distance_yards !== undefined && c.distance_yards !== 10) return bad('The 10-yard sprint is 10 yards.')
  return good({
    kind: raw.kind, method: 'timed', metric_slug: raw.metric_slug, value: Math.round(raw.value * 100) / 100, unit: 's', rubric: null,
    conditions: { location: c.location, surface: c.surface, timing_method: c.timing_method, start_type: c.start_type, distance_yards: dist },
    occurred_on: raw.occurred_on, note: note || null,
  })
}

export interface AssessmentRecord {
  id?: string
  kind: 'baseline' | 'retest'
  method: 'timed' | 'rubric'
  metric_slug: string | null
  value: number | null
  rubric: Record<string, number> | null
  conditions: Record<string, any> | null
  occurred_on: string
}

export interface Comparison {
  comparable: boolean
  reasons: string[]
  /** Numbers only. There is no "improved" here, and no verdict. */
  delta: number | Record<string, number> | null
  /** For timed results, whether the change is in the direction a lower time points. */
  towardFaster: boolean | null
}

const CONDITION_KEYS = ['location', 'surface', 'timing_method', 'start_type', 'distance_yards'] as const

export function compareAssessments(baseline: AssessmentRecord, retest: AssessmentRecord): Comparison {
  if (baseline.method !== retest.method) return { comparable: false, reasons: ['One was timed and the other was scored on the form rubric.'], delta: null, towardFaster: null }
  if (baseline.method === 'rubric') {
    const delta: Record<string, number> = {}
    for (const k of SCORE_KINDS) delta[k] = (retest.rubric?.[k] ?? 0) - (baseline.rubric?.[k] ?? 0)
    return { comparable: true, reasons: [], delta, towardFaster: null }
  }
  if (baseline.metric_slug !== retest.metric_slug) return { comparable: false, reasons: ['They measure different things.'], delta: null, towardFaster: null }
  const reasons = CONDITION_KEYS.filter(k => baseline.conditions?.[k] !== retest.conditions?.[k]).map(k => `Different ${k.replace('_', ' ')}.`)
  if (reasons.length) return { comparable: false, reasons: [...reasons, 'Compare only results taken under the same conditions.'], delta: null, towardFaster: null }
  const d = Math.round(((retest.value as number) - (baseline.value as number)) * 100) / 100
  return { comparable: true, reasons: [], delta: d, towardFaster: d === 0 ? null : d < 0 }
}

/** The first baseline for a metric, and each later retest compared to it. */
export function assessmentSummary(records: AssessmentRecord[]) {
  const sorted = records.slice().sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1))
  const out: Array<{ key: string; baseline: AssessmentRecord | null; retests: Array<{ record: AssessmentRecord; comparison: Comparison }> }> = []
  const keys = Array.from(new Set(sorted.map(r => `${r.method}:${r.metric_slug ?? 'rubric'}`)))
  for (const key of keys) {
    const rows = sorted.filter(r => `${r.method}:${r.metric_slug ?? 'rubric'}` === key)
    const baseline = rows.find(r => r.kind === 'baseline') ?? null
    out.push({ key, baseline, retests: rows.filter(r => r.kind === 'retest').map(record => ({ record, comparison: baseline ? compareAssessments(baseline, record) : { comparable: false, reasons: ['There is no baseline to compare with.'], delta: null, towardFaster: null } })) })
  }
  return out
}

export { GUARDRAILS }
