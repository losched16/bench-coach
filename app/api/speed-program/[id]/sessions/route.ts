import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { notEnabled, authorizeProgram, db, fail, toCore, loadChildren } from '@/lib/speedProgram/server'
import { effectivePlan, validateSessionInput } from '@/lib/speedProgram/rules'

export const dynamic = 'force-dynamic'

// GET  logged sessions, newest first (read)
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'read')
    if ('error' in r) return r.error
    const { sessions } = await loadChildren(r.assignment.id)
    return NextResponse.json({ sessions: sessions.slice().reverse() })
  } catch (e) { return fail(e) }
}

// POST a session: completed or skipped, with 0-2 scores, fatigue and pain (record: contributor and above)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'record')
    if ('error' in r) return r.error
    let body: any = null
    try { body = await request.json() } catch { /* below */ }
    const { events } = await loadChildren(r.assignment.id)
    const core = toCore(r.assignment)
    const today = new Date().toISOString().slice(0, 10)
    const v = validateSessionInput(body, core, effectivePlan(core, events), today)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const s = v.value
    // team_id and player_id are not sent: the database derives them from the program.
    const { data, error } = await db.from('speed_program_sessions').insert({
      assignment_id: r.assignment.id, week: s.week, session_key: s.session_key, status: s.status, skip_reason: s.skip_reason,
      occurred_on: s.occurred_on, performed: s.performed, effort: s.effort, fatigue: s.fatigue,
      landing: s.landing, braking: s.braking, reaction: s.reaction, first_step_cue: s.first_step_cue,
      pain_flag: s.pain_flag, pain_note: s.pain_note, adjustments_note: s.adjustments_note, coach_notes: s.coach_notes,
      actor_user_id: r.actor.userId,
    }).select('id').single()
    if (error) throw error
    return NextResponse.json({ id: (data as any).id }, { status: 201 })
  } catch (e) { return fail(e) }
}
