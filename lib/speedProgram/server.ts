// Server-side plumbing for the speed program: the flag, scope, and the one place
// a program's state is assembled. Routes stay thin; every rule is in rules.ts.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse, type Capability } from '@/lib/authz'
import { migrationHintFor, FEATURE_UNAVAILABLE } from '@/lib/migrationHints'
import { LEVEL_DEFS, WEEKS, PROGRESSIONS, LEVEL_UP_REQUIRES, GUARDRAILS, LEVELS, TEMPLATE_KEY, type SessionKey } from './template'
import {
  effectivePlan, guidance, eligibility, weekSessions, assessmentSummary, scheduleWarning,
  type AssignmentCore, type PlanEvent, type SessionRecord, type AssessmentRecord,
} from './rules'

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** The launch flag. Off unless SPEED_PROGRAM=1, so a deploy exposes nothing. */
export function speedProgramEnabled(): boolean {
  return process.env.SPEED_PROGRAM === '1'
}

/** When the flag is off the API does not exist: same answer as any unknown route. */
export function notEnabled(): NextResponse | null {
  return speedProgramEnabled() ? null : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)

export interface AssignmentRow {
  id: string
  player_id: string
  team_id: string
  template_key: string
  template_version: number
  level: AssignmentCore['level']
  space: AssignmentCore['space']
  days_per_week: number
  current_week: number
  unlocks: string[]
  status: AssignmentCore['status']
  intake: Record<string, any>
  plan: AssignmentCore['plan']
  started_at: string
  completed_at: string | null
}

export const toCore = (a: AssignmentRow): AssignmentCore => ({
  level: a.level, space: a.space, current_week: a.current_week, days_per_week: a.days_per_week,
  unlocks: a.unlocks || [], status: a.status, plan: a.plan,
})

/**
 * Scope for every route that takes a program id: the program's own team decides.
 * An id that does not exist and one on a team the caller cannot reach answer the
 * same 404, so the response never says which.
 */
export async function authorizeProgram(id: string, capability: Capability) {
  if (!isUuid(id)) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  const { data, error } = await db.from('speed_program_assignments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  try {
    const actor = await authorizeTeam((data as any).team_id, capability)
    return { actor, assignment: data as unknown as AssignmentRow } as const
  } catch (e) {
    const a = authzResponse(e)
    // A caller with no access to the team learns nothing: 404, not 403.
    if (a && (a.status === 403 || a.status === 404)) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
    throw e
  }
}

/** Uniform error answer. Never echoes database text to the caller. */
export function fail(e: unknown): NextResponse {
  const a = authzResponse(e)
  if (a) return NextResponse.json(a.body, { status: a.status })
  const hint = migrationHintFor(e as any)
  if (hint) return NextResponse.json({ error: FEATURE_UNAVAILABLE, migrationMessage: hint.message }, { status: 503 })
  console.error('[speed-program]', (e as any)?.message || e)
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
}

const toEvent = (r: any): PlanEvent => ({ id: r.id, event_type: r.event_type, detail: r.detail || {}, reason: r.reason, occurred_at: r.created_at })

export async function loadChildren(assignmentId: string) {
  const [s, a, e] = await Promise.all([
    db.from('speed_program_sessions').select('*').eq('assignment_id', assignmentId).order('occurred_on', { ascending: true }).order('created_at', { ascending: true }),
    db.from('speed_program_assessments').select('*').eq('assignment_id', assignmentId).order('occurred_on', { ascending: true }).order('created_at', { ascending: true }),
    db.from('speed_program_events').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: true }),
  ])
  for (const r of [s, a, e]) if (r.error) throw r.error
  return {
    sessions: (s.data || []) as unknown as SessionRecord[],
    assessments: (a.data || []) as unknown as AssessmentRecord[],
    events: (e.data || []).map(toEvent),
  }
}

/** Everything the coach page shows, computed from stored facts only. */
export async function buildState(a: AssignmentRow) {
  const { sessions, assessments, events } = await loadChildren(a.id)
  const core = toCore(a)
  const plan = effectivePlan(core, events)
  const lastAdvanceAt = events.filter(e => e.event_type === 'advance').map(e => e.occurred_at).filter(Boolean).sort().pop() ?? null
  const intake = a.intake || {}
  const weekPlan: SessionKey[] = weekSessions(a.days_per_week, a.current_week)
  const thisWeek = sessions.filter(s => s.week === a.current_week)
  const def = LEVEL_DEFS[a.level]
  return {
    program: {
      id: a.id, player_id: a.player_id, team_id: a.team_id, status: a.status, level: a.level, levelLabel: def.label, levelFit: def.typicalFit,
      levelReview: def.review, space: a.space, daysPerWeek: a.days_per_week, currentWeek: a.current_week, unlocks: a.unlocks || [],
      intake, startedAt: a.started_at, completedAt: a.completed_at, template: { key: a.template_key, version: a.template_version },
    },
    week: { ...WEEKS[a.current_week - 1], planned: weekPlan, done: thisWeek.filter(s => s.status === 'completed').map(s => s.session_key), skipped: thisWeek.filter(s => s.status === 'skipped').map(s => s.session_key) },
    weeks: WEEKS,
    dose: { minutes: def.minutes, dose: def.dose, readiness: def.readiness, adaptations: def.adaptations },
    plan,
    guidance: guidance(sessions),
    scheduleWarning: scheduleWarning(a.days_per_week, intake.weekly_games ?? 0, intake.weekly_hard_practices ?? 0),
    eligibility: {
      week: eligibility([], sessions, lastAdvanceAt),
      level: eligibility(LEVEL_UP_REQUIRES, sessions, lastAdvanceAt),
      nextLevel: LEVELS[LEVELS.indexOf(a.level) + 1] ?? null,
    },
    progressions: PROGRESSIONS.map(p => ({ ...p, unlocked: (a.unlocks || []).includes(p.key), eligibility: eligibility(p.requires, sessions, lastAdvanceAt) })),
    sessions: sessions.slice().reverse(),
    assessments: assessmentSummary(assessments),
    events: events.slice().reverse(),
    guardrails: GUARDRAILS,
    templateKey: TEMPLATE_KEY,
  }
}
