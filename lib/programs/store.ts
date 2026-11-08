// Reads and writes for drafts and saved programs.
//
// Authorisation is the CALLER's job (the routes use lib/authz before anything
// here runs) — these functions take an admin client and assume the ids have
// already been checked against the caller's team. What they do enforce:
// every query is scoped by team_id as well as by id, so an id from another
// team simply finds nothing.

import { addDays } from './brief'
import { DraftSchema, type ProgramDraft } from './types'

type Db = any

export class StoreError extends Error {
  constructor(message: string, public code: 'not_found' | 'conflict' | 'invalid' | 'closed' | 'db', public detail?: any) { super(message) }
}

const mig = (e: any) => /relation .* does not exist|Could not find the table|schema cache/i.test(String(e?.message || ''))
export const isMissingTables = mig

// ── payload for bc_save_development_program ──────────────────────────────────

export function toSavePayload(draft: ProgramDraft) {
  const sessions = draft.sessions.map(s => {
    let position = 0
    const drills = s.blocks.flatMap((b, bi) => b.drills.map(d => ({
      position: position++, block_index: bi, block_kind: b.kind, block_title: b.title, block_minutes: b.minutes,
      skill: d.skill, drill_id: d.drillId, exercise_key: d.exerciseKey, name: d.name, minutes: d.minutes,
      sets: d.sets, reps: d.reps, rest: d.rest, intensity: d.intensity, instructions: d.instructions, cues: d.cues,
      success: d.success, modification: d.modification, equipment: d.equipment,
    })))
    return {
      session_key: s.key, week: s.week, scheduled_date: s.date, kind: s.kind, supervision: s.supervision, title: s.title,
      focus: s.focus, est_minutes: s.minutes, checkpoint: s.checkpoint, assessments: s.assessments,
      requires_throwing_gate: s.requiresThrowingGate, coach_note: s.coachNote, filming_note: s.filmingNote,
      equipment: s.equipment, origin: s.origin, drills,
    }
  })
  const lastDate = draft.sessions.reduce((a, s) => (s.date > a ? s.date : a), draft.brief.startDate)
  return {
    program: {
      title: draft.title, summary: draft.summary, start_date: draft.brief.startDate,
      end_date: lastDate > addDays(draft.brief.startDate, draft.brief.weeks * 7 - 1) ? lastDate : addDays(draft.brief.startDate, draft.brief.weeks * 7 - 1),
      source: {
        brief: draft.brief, assumptions: draft.assumptions, throwingGate: draft.throwingGate,
        progressionRules: draft.progressionRules, weeklyLoad: draft.weeklyLoad, curationFlags: draft.curationFlags,
        assessment: draft.assessment, generation: draft.generation,
        qualityWarnings: draft.qualityReport?.warnings ?? [],
      },
    },
    phases: draft.phases.map(p => ({
      phase_order: p.order, phase_key: p.key, name: p.name, start_date: p.startDate, end_date: p.endDate,
      goals: p.goals, skills: p.skills, progression_requirements: p.progressionRequirements, difficulty: p.difficulty,
    })),
    skills: draft.skills.map(s => ({
      skill: s.skill, label: s.label, priority: s.priority, rationale: s.rationale, baseline: s.baseline, target: s.target,
      current_stage: s.currentStage, progress_id: s.progressId,
    })),
    sessions,
  }
}

// ── drafts ───────────────────────────────────────────────────────────────────

export async function createDraft(db: Db, row: { teamId: string; playerId: string; threadId?: string | null; userId: string | null; draft: ProgramDraft }) {
  const { data, error } = await db.from('development_program_drafts').insert({
    team_id: row.teamId, player_id: row.playerId, thread_id: row.threadId ?? null, created_by: row.userId, payload: row.draft,
  }).select('id, version, status, created_at').single()
  if (error) throw new StoreError(error.message, 'db', error)
  return data as { id: string; version: number; status: string; created_at: string }
}

export async function getDraft(db: Db, id: string, teamId: string) {
  const { data, error } = await db.from('development_program_drafts')
    .select('id, team_id, player_id, thread_id, status, version, payload, saved_program_id, created_by, created_at, updated_at')
    .eq('id', id).eq('team_id', teamId).maybeSingle()
  if (error) throw new StoreError(error.message, 'db', error)
  if (!data) throw new StoreError('Draft not found', 'not_found')
  return data as any
}

/** The open draft for a conversation, if any. */
export async function openDraftForThread(db: Db, threadId: string, teamId: string) {
  const { data } = await db.from('development_program_drafts')
    .select('id, player_id, version, payload').eq('thread_id', threadId).eq('team_id', teamId).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as any) || null
}

/** Replace the draft body. Fails (conflict) if somebody else edited it first. */
export async function updateDraft(db: Db, id: string, teamId: string, expectedVersion: number, draft: ProgramDraft) {
  const parsed = DraftSchema.safeParse(draft)
  if (!parsed.success) throw new StoreError('Draft is not valid: ' + parsed.error.issues.slice(0, 2).map(i => `${i.path.join('.')} ${i.message}`).join('; '), 'invalid')
  const { data, error } = await db.from('development_program_drafts')
    .update({ payload: parsed.data, version: expectedVersion + 1, updated_at: new Date().toISOString() })
    .eq('id', id).eq('team_id', teamId).eq('status', 'draft').eq('version', expectedVersion)
    .select('id, version').maybeSingle()
  if (error) throw new StoreError(error.message, 'db', error)
  if (!data) throw new StoreError('This draft changed or was already saved. Reload to see the latest.', 'conflict')
  return data as { id: string; version: number }
}

export async function discardDraft(db: Db, id: string, teamId: string) {
  const { error } = await db.from('development_program_drafts').update({ status: 'discarded' }).eq('id', id).eq('team_id', teamId).eq('status', 'draft')
  if (error) throw new StoreError(error.message, 'db', error)
}

/** Approve and save, atomically. Calling it twice returns the same program. */
export async function saveDraft(db: Db, draftRow: { id: string; team_id: string; payload: ProgramDraft }, actorUserId: string) {
  const parsed = DraftSchema.safeParse(draftRow.payload)
  if (!parsed.success) throw new StoreError('Draft is not valid and cannot be saved.', 'invalid')
  const { data, error } = await db.rpc('bc_save_development_program', {
    p_draft_id: draftRow.id, p_actor: actorUserId, p_payload: toSavePayload(parsed.data),
  })
  if (error) throw new StoreError(error.message, 'db', error)
  const r = Array.isArray(data) ? data[0] : data
  if (!r?.ok) throw new StoreError(`Could not save (${r?.reason || 'unknown'})`, r?.reason === 'draft_not_found' ? 'not_found' : 'closed')
  return { programId: r.program_id as string, alreadySaved: !!r.already_saved }
}

// ── reading a saved program ──────────────────────────────────────────────────

export interface ProgramView {
  program: any
  phases: any[]
  skills: any[]
  sessions: Array<any & { drills: any[]; completion: any | null }>
  revisions: any[]
  readings: any[]
}

export async function loadProgram(db: Db, id: string, teamId: string): Promise<ProgramView> {
  const { data: program, error } = await db.from('development_programs').select('*').eq('id', id).eq('team_id', teamId).maybeSingle()
  if (error) throw new StoreError(error.message, 'db', error)
  if (!program) throw new StoreError('Program not found', 'not_found')
  const [phases, skills, sessions, comps, revs, readings] = await Promise.all([
    db.from('program_phases').select('*').eq('program_id', id).order('phase_order'),
    db.from('program_skills').select('*').eq('program_id', id).order('priority'),
    db.from('program_sessions').select('*').eq('program_id', id).order('scheduled_date').order('session_key'),
    db.from('program_session_completions').select('*').eq('program_id', id),
    db.from('program_revisions').select('*').eq('program_id', id).order('created_at', { ascending: false }).limit(30),
    db.from('player_metrics').select('id, metric_type_id, metric, value, unit, attempts, successes, measured_on, note, checkpoint, conditions, program_session_id').eq('program_id', id).order('measured_on'),
  ])
  const sids = (sessions.data || []).map((s: any) => s.id)
  const drills = sids.length ? await db.from('program_session_drills').select('*').in('session_id', sids).order('position') : { data: [] }
  const byS = new Map<string, any[]>()
  for (const d of drills.data || []) { if (!byS.has(d.session_id)) byS.set(d.session_id, []); byS.get(d.session_id)!.push(d) }
  const compBy = new Map<string, any>((comps.data || []).map((c: any) => [c.session_id, c]))
  return {
    program, phases: phases.data || [], skills: skills.data || [],
    sessions: (sessions.data || []).map((s: any) => ({ ...s, drills: byS.get(s.id) || [], completion: compBy.get(s.id) || null })),
    revisions: revs.data || [], readings: readings.data || [],
  }
}

export async function listPrograms(db: Db, teamId: string, playerId?: string | null) {
  let q = db.from('development_programs').select('id, player_id, title, start_date, end_date, status, version, created_at').eq('team_id', teamId)
  if (playerId) q = q.eq('player_id', playerId)
  const { data, error } = await q.order('start_date', { ascending: false }).limit(50)
  if (error) throw new StoreError(error.message, 'db', error)
  return data || []
}

export async function listOpenDrafts(db: Db, teamId: string, playerId?: string | null) {
  let q = db.from('development_program_drafts').select('id, player_id, version, created_at, payload->title').eq('team_id', teamId).eq('status', 'draft')
  if (playerId) q = q.eq('player_id', playerId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(20)
  if (error) throw new StoreError(error.message, 'db', error)
  return data || []
}

// ── a draft shaped like the saved program, for the shared UI ─────────────────

/** Rebuild draft sessions from saved rows, for applyChanges and the editor. */
export function sessionsFromRows(rows: Array<any & { drills: any[] }>): import('./types').ProgramSession[] {
  return rows.map(r => {
    const byBlock = new Map<number, any[]>()
    for (const d of r.drills) { if (!byBlock.has(d.block_index)) byBlock.set(d.block_index, []); byBlock.get(d.block_index)!.push(d) }
    const blocks = Array.from(byBlock.entries()).sort((a, b) => a[0] - b[0]).map(([, ds]) => ({
      kind: ds[0].block_kind, title: ds[0].block_title, skill: ds[0].skill ?? null, minutes: ds[0].block_minutes,
      drills: ds.map((d: any) => ({
        drillId: d.drill_id, exerciseKey: d.exercise_key, name: d.name, skill: d.skill, minutes: d.minutes, sets: d.sets, reps: d.reps,
        rest: d.rest, intensity: d.intensity, instructions: d.instructions || [], cues: d.cues || [], success: d.success || [],
        modification: d.modification, equipment: d.equipment || [], hasVideo: false,
      })),
    }))
    return {
      key: r.session_key, week: r.week, date: r.scheduled_date, kind: r.kind, supervision: r.supervision, title: r.title,
      focus: r.focus || [], minutes: r.est_minutes, blocks, checkpoint: r.checkpoint, assessments: r.assessments || [],
      requiresThrowingGate: r.requires_throwing_gate, coachNote: r.coach_note, filmingNote: r.filming_note,
      equipment: r.equipment || [], origin: r.origin,
    } as any
  })
}

export function patchFromSessions(sessions: import('./types').ProgramSession[], keys: string[]) {
  const subset = sessions.filter(s => keys.includes(s.key))
  const payload = toSavePayload({ ...({} as any), brief: { startDate: '2000-01-01', weeks: 1 }, title: '', summary: '', sessions: subset, phases: [], skills: [], progressionRules: [], weeklyLoad: [], assumptions: [], curationFlags: [], assessment: {}, throwingGate: null, qualityReport: null, generation: null } as any)
  return payload.sessions.map(s => ({ session_key: s.session_key, est_minutes: s.est_minutes, requires_throwing_gate: s.requires_throwing_gate, drills: s.drills }))
}
