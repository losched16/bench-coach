import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { migrationHintFor } from '@/lib/migrationHints'
import { callerCoachId, requireSession } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// The drills a coach keeps coming back to.
//
// The library is ~150 drills and a coach uses about twelve. Marking those
// twelve is what lets the practice builder prefer drills their players already
// know the setup for, and what stops the swap picker opening on a wall.
//
// Scoped to the caller's own coach row, always. The coachId in the body is
// checked against the session rather than trusted — otherwise anyone could
// read, or quietly edit, somebody else's shortlist.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function mine(claimed: string | null | undefined): Promise<string | null> {
  const actual = await callerCoachId()
  if (!actual) return null
  // A mismatch is not an error worth explaining — it is someone asking about a
  // coach that is not them.
  if (claimed && claimed !== actual) return null
  return actual
}

// GET ?coachId= — the ids this coach has starred
export async function GET(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = await mine(searchParams.get('coachId'))
  if (!coachId) return NextResponse.json({ drillIds: [] })

  try {
    const { data, error } = await supabaseAdmin
      .from('drill_favorites')
      .select('drill_id, note')
      .eq('coach_id', coachId)

    if (error) throw error

    return NextResponse.json({
      drillIds: (data || []).map((r: any) => r.drill_id),
      notes: Object.fromEntries(
        (data || []).filter((r: any) => r.note).map((r: any) => [r.drill_id, r.note])
      ),
    })
  } catch (error: any) {
    console.error('Drill favorites GET error:', error)
    // Migration 041 may not be applied. An empty list keeps the library
    // usable — a coach loses their stars, not their drills.
    return NextResponse.json({
      drillIds: [],
      notes: {},
      needsMigration: true,
      migrationMessage: migrationHintFor(error)?.message || null,
    })
  }
}

// POST { coachId, drillId, note? } — star it
export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const { coachId: claimed, drillId, note } = await request.json()
    const coachId = await mine(claimed)
    if (!coachId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!drillId) return NextResponse.json({ error: 'drillId required' }, { status: 400 })

    // Upsert rather than insert: starring something already starred is a
    // double-tap, not an error.
    const { error } = await supabaseAdmin
      .from('drill_favorites')
      .upsert(
        { coach_id: coachId, drill_id: drillId, note: note || null },
        { onConflict: 'coach_id,drill_id' }
      )

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Drill favorite POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      error: hint?.message || error.message || 'Could not save that favorite.',
      needsMigration: !!hint,
    }, { status: 500 })
  }
}

// DELETE { coachId, drillId } — unstar it
export async function DELETE(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const { coachId: claimed, drillId } = await request.json()
    const coachId = await mine(claimed)
    if (!coachId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabaseAdmin
      .from('drill_favorites')
      .delete()
      .eq('coach_id', coachId)
      .eq('drill_id', drillId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Drill favorite DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
