import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { notEnabled, authorizeProgram, db, fail, toCore, buildState, loadChildren } from '@/lib/speedProgram/server'
import { validateAdjustment, validateIntake, SPACES } from '@/lib/speedProgram/rules'

export const dynamic = 'force-dynamic'

// GET  the whole program: plan, history, guidance (read)
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'read')
    if ('error' in r) return r.error
    return NextResponse.json(await buildState(r.assignment))
  } catch (e) { return fail(e) }
}

// PATCH { action: adjust | schedule | space | pause | resume | complete, ... }  (decide)
// Every change is an event; nothing rewrites history or the plan snapshot.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'decide')
    if ('error' in r) return r.error
    const a = r.assignment
    let body: any = null
    try { body = await request.json() } catch { /* below */ }
    if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Say what to change.' }, { status: 400 })
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : null
    const log = async (event_type: string, detail: Record<string, any>) => {
      const { error } = await db.from('speed_program_events').insert({ assignment_id: a.id, event_type, detail, reason, actor_user_id: r.actor.userId })
      if (error) throw error
    }
    const set = async (patch: Record<string, any>) => {
      const { error } = await db.from('speed_program_assignments').update(patch).eq('id', a.id)
      if (error) throw error
    }

    if (body.action === 'adjust') {
      const adj = validateAdjustment(body.adjustment, toCore(a))
      if (!adj.ok) return NextResponse.json({ error: adj.error }, { status: 400 })
      await log('adjustment', adj.value as any)
    } else if (body.action === 'schedule') {
      const d = body.daysPerWeek
      if (!Number.isInteger(d) || d < 1 || d > 3) return NextResponse.json({ error: 'Sessions per week must be 1, 2 or 3.' }, { status: 400 })
      if (a.status === 'completed') return NextResponse.json({ error: 'This program is finished.' }, { status: 409 })
      await set({ days_per_week: d }); await log('schedule', { from: a.days_per_week, to: d })
    } else if (body.action === 'space') {
      if (!SPACES.includes(body.space)) return NextResponse.json({ error: 'Choose indoor (about 20×15 ft) or open outdoor.' }, { status: 400 })
      if (a.status === 'completed') return NextResponse.json({ error: 'This program is finished.' }, { status: 409 })
      await set({ space: body.space }); await log('space', { from: a.space, to: body.space })
    } else if (body.action === 'pause') {
      if (a.status !== 'active') return NextResponse.json({ error: 'Only a running program can be paused.' }, { status: 409 })
      await set({ status: 'paused' }); await log('pause', {})
    } else if (body.action === 'resume') {
      if (a.status !== 'paused') return NextResponse.json({ error: 'Only a paused program can be resumed.' }, { status: 409 })
      await set({ status: 'active' }); await log('resume', {})
    } else if (body.action === 'complete') {
      if (a.status === 'completed') return NextResponse.json({ error: 'Already finished.' }, { status: 409 })
      await set({ status: 'completed', completed_at: new Date().toISOString() }); await log('complete', { week: a.current_week })
    } else if (body.action === 'intake') {
      const i = validateIntake(body.intake)
      if (!i.ok) return NextResponse.json({ error: i.error }, { status: 400 })
      await set({ intake: i.value })
    } else {
      return NextResponse.json({ error: 'Unknown change.' }, { status: 400 })
    }
    const fresh = await authorizeProgram(params.id, 'read')
    if ('error' in fresh) return fresh.error
    return NextResponse.json(await buildState(fresh.assignment))
  } catch (e) { return fail(e) }
}
