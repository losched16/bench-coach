import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { notEnabled, authorizeProgram, db, fail, toCore, loadChildren, buildState } from '@/lib/speedProgram/server'
import { validateAdvanceInput, decideAdvance } from '@/lib/speedProgram/rules'

export const dynamic = 'force-dynamic'

// POST { kind: week | level | unlock, key?, override?, reason? }  (decide: admin and above)
// The decision is computed from the logged sessions on the server. The request
// cannot supply scores, and an override needs a written reason. Pain at the most
// recent session blocks everything, override included.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'decide')
    if ('error' in r) return r.error
    let body: any = null
    try { body = await request.json() } catch { /* below */ }
    const input = validateAdvanceInput(body)
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
    const a = r.assignment
    const { sessions, events } = await loadChildren(a.id)
    const d = decideAdvance(input.value, { core: toCore(a), sessions, events })
    if (!d.ok) return NextResponse.json({ error: d.error, eligibility: d.eligibility ?? null }, { status: d.status })

    // The event is written first: a decision with no record must not take effect.
    const ev = await db.from('speed_program_events').insert({ assignment_id: a.id, event_type: 'advance', detail: d.detail, reason: input.value.reason, actor_user_id: r.actor.userId })
    if (ev.error) throw ev.error
    const patch: Record<string, any> = {}
    if (input.value.kind === 'week') patch.current_week = d.to
    else if (input.value.kind === 'level') patch.level = d.to
    else patch.unlocks = Array.from(new Set([...(a.unlocks || []), d.to as string]))
    const up = await db.from('speed_program_assignments').update(patch).eq('id', a.id)
    if (up.error) throw up.error

    const fresh = await authorizeProgram(params.id, 'read')
    if ('error' in fresh) return fresh.error
    return NextResponse.json({ overridden: d.overridden, state: await buildState(fresh.assignment) })
  } catch (e) { return fail(e) }
}
