import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { commitPrescription } from '@/lib/prescriptions'
import { focusAreaLabel, isFocusArea } from '@/lib/focusAreas'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Confirming a read the coach has already seen.
//
// Takes the exact markdown that was on screen rather than regenerating, so
// what gets tracked is word-for-word what they agreed to. Regenerating would
// also mean paying for the analysis twice and risking a different answer to
// the same question, which is the fastest way to lose someone's trust.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const body = await request.json()
    const {
      coachId, draft, drillIds, rejectedDrillIds, confirmSupersede,
    } = body

    if (!coachId || !draft?.markdown || !Array.isArray(draft?.sections)) {
      return NextResponse.json(
        { error: 'coachId and the analysis draft are required' },
        { status: 400 }
      )
    }

    const scope: 'player' | 'team' = draft.scope === 'team' ? 'team' : 'player'

    // Same check the analysis route runs, repeated here because this is the
    // call that actually writes. Between reading the analysis and confirming
    // it, another priority in this area could have been set from a different
    // tab, and silently abandoning it is the behaviour we removed.
    if (draft.focusArea && !confirmSupersede) {
      let sq = supabaseAdmin
        .from('prescriptions')
        .select('id, priority, created_at')
        .eq('coach_id', coachId)
        .eq('status', 'active')
        .eq('focus_area', draft.focusArea)

      sq = scope === 'player'
        ? sq.eq('player_id', draft.playerId)
        : sq.eq('team_id', draft.teamId || '').eq('scope', 'team')

      const { data: conflicting } = await sq.order('created_at', { ascending: false }).limit(1)
      const existing = (conflicting || [])[0] as any

      if (existing) {
        const { count } = await supabaseAdmin
          .from('entries')
          .select('id', { count: 'exact', head: true })
          .eq('prescription_id', existing.id)

        return NextResponse.json({
          needsConfirmation: true,
          focusArea: draft.focusArea,
          focusAreaLabel: focusAreaLabel(draft.focusArea),
          replacing: {
            id: existing.id,
            priority: String(existing.priority || '').replace(/[#*_`>]/g, '').trim().slice(0, 240) || null,
            age_days: existing.created_at
              ? Math.max(0, Math.floor((Date.now() - new Date(existing.created_at).getTime()) / 86400000))
              : null,
            sessions_logged: count ?? 0,
          },
        }, { status: 409 })
      }
    }

    const result = await commitPrescription(supabaseAdmin, {
      coachId,
      scope,
      playerId: draft.playerId,
      teamId: draft.teamId,
      markdown: draft.markdown,
      sections: draft.sections,
      focusArea: draft.focusArea ?? null,
      problemSlug: draft.problemSlug ?? null,
      // The coach's list, not ours. Dropping every drill is allowed — the
      // priority is the deliverable and the drills are how you attack it.
      drillIds: Array.isArray(drillIds) ? drillIds : [],
      rejectedDrillIds: Array.isArray(rejectedDrillIds) ? rejectedDrillIds : [],
      origin: draft.origin === 'instructor' ? 'instructor' : 'ai',
    })

    return NextResponse.json({
      prescriptionId: result.prescriptionId,
      supersededCount: result.supersededCount,
    })
  } catch (error: any) {
    console.error('Prescription commit error:', error)
    return NextResponse.json(
      { error: error.message || 'Could not save the priority' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// PATCH { coachId, prescriptionId, focusArea } — say what a plan is about
//
// Priorities written before areas existed have none, and the classifier cannot
// always tell from the text. Rather than leave them labelled "General" forever,
// the coach can just say. Setting it is a decision about what the plan IS, so
// it needs 'decide'.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const { coachId, prescriptionId, focusArea } = await request.json()
    if (!coachId || !prescriptionId) {
      return NextResponse.json(
        { error: 'coachId and prescriptionId are required' }, { status: 400 }
      )
    }
    if (focusArea !== null && !isFocusArea(focusArea)) {
      return NextResponse.json({ error: 'Not an area we know' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('prescriptions')
      .update({ focus_area: focusArea })
      .eq('id', prescriptionId)
      .eq('coach_id', coachId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Set focus area error:', error)
    return NextResponse.json({ error: error.message || 'Could not set that' }, { status: 500 })
  }
}
