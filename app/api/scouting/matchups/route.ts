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

// GET: matchups for a coach (optionally filtered by status)
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read', { needs: 'teamFeatures' })
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const status = searchParams.get('status')

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    let query = supabaseAdmin
      .from('matchups')
      .select('*, opponent_team:opponent_teams(id, name, age_group, last_seen)')
      .eq('coach_id', coachId)
      .order('scheduled_at', { ascending: true, nullsFirst: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ matchups: data || [] })
  } catch (error: any) {
    console.error('Matchups GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: create a matchup
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { coachId, teamId, opponentTeamId, scheduledAt, tournamentName, bracketPosition, status } =
      await request.json()

    if (!coachId || !opponentTeamId) {
      return NextResponse.json({ error: 'coachId and opponentTeamId required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('matchups')
      .insert({
        coach_id: coachId,
        team_id: teamId || null,
        opponent_team_id: opponentTeamId,
        scheduled_at: scheduledAt || null,
        tournament_name: tournamentName || null,
        bracket_position: bracketPosition || null,
        status: status || 'upcoming',
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ matchup: data })
  } catch (error: any) {
    console.error('Matchups POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PUT: update a matchup (schedule, status)
export async function PUT(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { coachId, matchupId, updates } = await request.json()
    if (!coachId || !matchupId) {
      return NextResponse.json({ error: 'coachId and matchupId required' }, { status: 400 })
    }

    const allowed: any = {}
    for (const key of ['scheduled_at', 'tournament_name', 'bracket_position', 'status', 'team_id']) {
      if (updates?.[key] !== undefined) allowed[key] = updates[key]
    }

    const { error } = await supabaseAdmin
      .from('matchups')
      .update(allowed)
      .eq('id', matchupId)
      .eq('coach_id', coachId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Matchups PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove a matchup
export async function DELETE(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const matchupId = searchParams.get('matchupId')
  const coachId = searchParams.get('coachId')

  if (!matchupId || !coachId) {
    return NextResponse.json({ error: 'matchupId and coachId required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('matchups')
      .delete()
      .eq('id', matchupId)
      .eq('coach_id', coachId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Matchups DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
