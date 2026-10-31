import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { notEnabled, authorizeProgram, db, fail, toCore, loadChildren } from '@/lib/speedProgram/server'
import { validateAssessmentInput, assessmentSummary } from '@/lib/speedProgram/rules'

export const dynamic = 'force-dynamic'

// GET  baselines and retests, each retest compared only when conditions match (read)
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'read')
    if ('error' in r) return r.error
    const { assessments } = await loadChildren(r.assignment.id)
    return NextResponse.json({ assessments: assessmentSummary(assessments) })
  } catch (e) { return fail(e) }
}

// POST a baseline or retest: timed (with conditions) or the 0-2 form rubric (record)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled(); if (off) return off
  const denied = await requireSession(); if (denied) return denied
  try {
    const r = await authorizeProgram(params.id, 'record')
    if ('error' in r) return r.error
    let body: any = null
    try { body = await request.json() } catch { /* below */ }
    const today = new Date().toISOString().slice(0, 10)
    const v = validateAssessmentInput(body, toCore(r.assignment), today)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const a = v.value
    const { data, error } = await db.from('speed_program_assessments').insert({
      assignment_id: r.assignment.id, kind: a.kind, method: a.method, metric_slug: a.metric_slug, value: a.value, unit: a.unit,
      rubric: a.rubric, conditions: a.conditions, occurred_on: a.occurred_on, note: a.note, actor_user_id: r.actor.userId,
    }).select('id').single()
    if (error) throw error
    return NextResponse.json({ id: (data as any).id }, { status: 201 })
  } catch (e) { return fail(e) }
}
