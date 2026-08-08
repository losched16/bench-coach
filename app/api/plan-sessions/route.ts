import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guard, authorizeCoach } from '@/lib/authz'
import { migrationHintFor } from '@/lib/migrationHints'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request.
export const dynamic = 'force-dynamic'

// Ticking a session off.
//
// Running a session is a RECORD of what happened, so a contributor may do it —
// the same line migration 034 draws everywhere else. Deciding what the plan
// SHOULD be is a decision and lives on the priority.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET ?coachId=&prescriptionId= — what has been ticked
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const prescriptionId = searchParams.get('prescriptionId')
  if (!prescriptionId) {
    return NextResponse.json({ error: 'prescriptionId required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('plan_session_log')
      .select('session_key, session_title, completed_on, minutes')
      .eq('prescription_id', prescriptionId)
      .order('completed_on', { ascending: false })
    if (error) throw error
    return NextResponse.json({ done: data || [] })
  } catch (error: any) {
    const hint = migrationHintFor(error)
    // A missing table is a migration away, not a broken plan — the checklist
    // still renders, just without its ticks.
    return NextResponse.json({
      done: [],
      needsMigration: !!hint,
      migrationMessage: hint?.message || 'Run migration 035_plan_sessions.sql.',
    })
  }
}

// ---------------------------------------------------------------------------
// POST — tick one off.  { coachId, prescriptionId, sessionKey, title, minutes }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const body = await request.json()
    const { coachId, prescriptionId, sessionKey, title, minutes, note } = body
    if (!prescriptionId || !sessionKey) {
      return NextResponse.json({ error: 'prescriptionId and sessionKey are required' }, { status: 400 })
    }

    const actor = await authorizeCoach(coachId, 'record')

    // Idempotent by (prescription, session, day). A second tap on a button
    // that already worked must not read as twice the work — the same mistake
    // the quick-log made, where inflated adherence flipped the check-in.
    const { error } = await supabaseAdmin
      .from('plan_session_log')
      .upsert({
        prescription_id: prescriptionId,
        coach_id: actor.ownerCoachId,
        session_key: String(sessionKey),
        session_title: title ? String(title) : null,
        minutes: Number(minutes) > 0 ? Number(minutes) : null,
        note: note?.trim() || null,
        completed_by: actor.userId,
        completed_on: new Date().toISOString().split('T')[0],
      }, { onConflict: 'prescription_id,session_key,completed_on' })
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Plan session POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not save that' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// DELETE ?prescriptionId=&sessionKey=&on= — untick
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const prescriptionId = searchParams.get('prescriptionId')
  const sessionKey = searchParams.get('sessionKey')
  const on = searchParams.get('on') || new Date().toISOString().split('T')[0]
  if (!prescriptionId || !sessionKey) {
    return NextResponse.json({ error: 'prescriptionId and sessionKey are required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('plan_session_log')
      .delete()
      .eq('prescription_id', prescriptionId)
      .eq('session_key', sessionKey)
      .eq('completed_on', on)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Could not undo that' }, { status: 500 })
  }
}
