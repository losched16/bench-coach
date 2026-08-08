import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { migrationHintFor } from '@/lib/migrationHints'
import { guard } from '@/lib/authz'
import { resolveSteps, clampStep, PlanStep } from '@/lib/progression'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Moving up a step in a plan.
//
// 'record' rather than 'decide': this is the parent saying what they saw in the
// backyard, which is the same class of act as logging a session. It does not
// change what the plan is, only where the player has got to in it. An assistant
// coach who ran the drill and watched the kid clear the gate should be able to
// say so.
//
// Going BACKWARDS is deliberately allowed and deliberately unremarkable. A
// movement that holds up on a tee and falls apart against live pitching is the
// single most common thing that happens in a progression, and a plan that
// treats stepping back as a failure state teaches parents to lie to it.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const DRILL_FIELDS =
  'id, drill_name, progression_level, difficulty_level, success_markers'

export async function PATCH(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const { prescriptionId, coachId, step, direction } = await request.json()

    if (!prescriptionId || !coachId) {
      return NextResponse.json({ error: 'prescriptionId and coachId required' }, { status: 400 })
    }

    const { data: p, error: readErr } = await supabaseAdmin
      .from('prescriptions')
      .select('id, drill_ids, plan_steps, current_step')
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (readErr) throw readErr
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const ids = ((p as any).drill_ids || []) as string[]
    const { data: drills } = ids.length
      ? await supabaseAdmin.from('drill_resources').select(DRILL_FIELDS).in('id', ids)
      : { data: [] as any[] }

    const byId = new Map((drills || []).map((d: any) => [d.id, d]))
    const ordered = ids.map(id => byId.get(id)).filter(Boolean)
    const steps = resolveSteps(((p as any).plan_steps || null) as PlanStep[] | null, ordered as any[])

    if (steps.length === 0) {
      return NextResponse.json({ error: 'This plan has no drills to step through.' }, { status: 400 })
    }

    const from = clampStep((p as any).current_step, steps)
    const target =
      typeof step === 'number' ? step :
      direction === 'back' ? from - 1 :
      from + 1
    const next = clampStep(target, steps)

    // Freezing the steps on the first advance is what stops a plan being
    // renumbered under a coach who has already been told what step 2 is.
    const { error } = await supabaseAdmin
      .from('prescriptions')
      .update({
        current_step: next,
        plan_steps: steps,
        step_advanced_at: new Date().toISOString(),
      })
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)

    if (error) throw error

    return NextResponse.json({
      currentStep: next,
      steps,
      // So the UI can say "that's the last one" rather than silently doing
      // nothing when they tap a button at the end of the plan.
      atEnd: next >= steps.length,
      moved: next !== from,
    })
  } catch (error: any) {
    console.error('Plan step error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      error: hint?.message || error.message || 'Could not update the step.',
      needsMigration: !!hint,
    }, { status: 500 })
  }
}
