import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Verify a player belongs to one of this coach's opponent teams
async function playerBelongsToCoach(playerId: string, coachId: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('opponent_players')
    .select('*, opponent_team:opponent_teams(id, coach_id)')
    .eq('id', playerId)
    .single()
  if (!data || (data.opponent_team as any)?.coach_id !== coachId) return null
  return data
}

// PUT: edit an opponent player (name, jersey, bats/throws, notes, confidence)
export async function PUT(request: NextRequest) {
  try {
    const { coachId, playerId, updates } = await request.json()
    if (!coachId || !playerId) {
      return NextResponse.json({ error: 'coachId and playerId required' }, { status: 400 })
    }

    const player = await playerBelongsToCoach(playerId, coachId)
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const allowed: any = {}
    for (const key of ['name', 'jersey_number', 'bats', 'throws', 'positions', 'notes', 'confidence', 'needs_review']) {
      if (updates?.[key] !== undefined) allowed[key] = updates[key]
    }

    const { error } = await supabaseAdmin
      .from('opponent_players')
      .update(allowed)
      .eq('id', playerId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Opponent player PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST { action: 'merge', keepId, mergeId }: manual merge of duplicate
// opponent players. Appearances move to the kept row; the duplicate row is
// deleted. This is deliberately manual-only — auto-merging below a high
// confidence bar corrupts pitch-count math, which is the feature's value.
export async function POST(request: NextRequest) {
  try {
    const { coachId, action, keepId, mergeId } = await request.json()
    if (action !== 'merge') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }
    if (!coachId || !keepId || !mergeId || keepId === mergeId) {
      return NextResponse.json({ error: 'coachId, keepId and mergeId (distinct) required' }, { status: 400 })
    }

    const keep = await playerBelongsToCoach(keepId, coachId)
    const merge = await playerBelongsToCoach(mergeId, coachId)
    if (!keep || !merge) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }
    if (keep.opponent_team_id !== merge.opponent_team_id) {
      return NextResponse.json({ error: 'Players must be on the same opponent team' }, { status: 400 })
    }

    // Move appearances to the kept player
    const { error: moveError } = await supabaseAdmin
      .from('opponent_appearances')
      .update({ opponent_player_id: keepId })
      .eq('opponent_player_id', mergeId)
    if (moveError) throw moveError

    // Fill gaps on the kept row from the merged row; widen first/last seen
    const updates: any = { needs_review: false }
    if (!keep.jersey_number && merge.jersey_number) updates.jersey_number = merge.jersey_number
    if (!keep.bats && merge.bats) updates.bats = merge.bats
    if (!keep.throws && merge.throws) updates.throws = merge.throws
    const positions = Array.from(new Set([...(keep.positions || []), ...(merge.positions || [])]))
    if (positions.length > (keep.positions || []).length) updates.positions = positions
    if (merge.notes) {
      updates.notes = keep.notes ? `${keep.notes}\n${merge.notes}` : merge.notes
    }
    if (merge.first_seen && (!keep.first_seen || merge.first_seen < keep.first_seen)) {
      updates.first_seen = merge.first_seen
    }
    if (merge.last_seen && (!keep.last_seen || merge.last_seen > keep.last_seen)) {
      updates.last_seen = merge.last_seen
    }

    const { error: updateError } = await supabaseAdmin
      .from('opponent_players')
      .update(updates)
      .eq('id', keepId)
    if (updateError) throw updateError

    const { error: deleteError } = await supabaseAdmin
      .from('opponent_players')
      .delete()
      .eq('id', mergeId)
    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Opponent player merge error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove an opponent player (appearances cascade)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const playerId = searchParams.get('playerId')
  const coachId = searchParams.get('coachId')

  if (!playerId || !coachId) {
    return NextResponse.json({ error: 'playerId and coachId required' }, { status: 400 })
  }

  try {
    const player = await playerBelongsToCoach(playerId, coachId)
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const { error } = await supabaseAdmin
      .from('opponent_players')
      .delete()
      .eq('id', playerId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Opponent player DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
