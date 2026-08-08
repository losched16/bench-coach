import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET: pitch count rule sets visible to a coach (system defaults + their own)
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('pitch_count_rules')
      .select('*')
      .or(`coach_id.is.null,coach_id.eq.${coachId}`)
      .order('sanctioning_body', { ascending: true })
      .order('age_group', { ascending: true })

    if (error) throw error
    return NextResponse.json({ rules: data || [] })
  } catch (error: any) {
    console.error('Pitch rules GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: create a custom rule set for a local circuit
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const { coachId, sanctioningBody, ageGroup, dailyMax, thresholds } = await request.json()

    if (!coachId || !sanctioningBody || !ageGroup || !Array.isArray(thresholds) || thresholds.length === 0) {
      return NextResponse.json(
        { error: 'coachId, sanctioningBody, ageGroup and thresholds required' },
        { status: 400 }
      )
    }

    for (const band of thresholds) {
      if (typeof band.max_pitches !== 'number' || typeof band.rest_days !== 'number') {
        return NextResponse.json(
          { error: 'Each threshold needs numeric max_pitches and rest_days' },
          { status: 400 }
        )
      }
    }

    const { data, error } = await supabaseAdmin
      .from('pitch_count_rules')
      .upsert(
        {
          coach_id: coachId,
          sanctioning_body: sanctioningBody,
          age_group: ageGroup,
          daily_max: dailyMax ?? null,
          thresholds,
        },
        { onConflict: 'coach_id,sanctioning_body,age_group' }
      )
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ rule: data })
  } catch (error: any) {
    console.error('Pitch rules POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove a coach's custom rule set (system defaults are protected)
export async function DELETE(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const ruleId = searchParams.get('ruleId')
  const coachId = searchParams.get('coachId')

  if (!ruleId || !coachId) {
    return NextResponse.json({ error: 'ruleId and coachId required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('pitch_count_rules')
      .delete()
      .eq('id', ruleId)
      .eq('coach_id', coachId) // never matches system rows (coach_id NULL)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Pitch rules DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
