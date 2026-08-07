import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computePitcherAvailability, PitchCountRuleSet, AppearanceLite } from '@/lib/scouting'

// Standalone pitch counting — no game required.
//
// The existing Game Day flow makes you declare a game before you can count a
// pitch. That's the wrong shape for the actual moment: someone is standing at
// the fence, the kid is warming up, and they want to tap a name and start.
// Often the kid is on the OTHER team, which Game Day has no concept of at all.
//
// Opponent counts are the interesting half. The scouting availability engine
// already turns appearances into "he threw 68 on Saturday, he's ineligible
// until Wednesday" — it just had no way to receive a count taken by hand.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET — open counters first, then recent history
//   ?coachId=&teamId=
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')

  if (!coachId) return NextResponse.json({ error: 'coachId required' }, { status: 400 })

  try {
    const { data, error } = await supabaseAdmin
      .from('pitch_count_sessions')
      .select('*')
      .eq('coach_id', coachId)
      .order('finished_at', { ascending: true, nullsFirst: true })
      .order('updated_at', { ascending: false })
      .limit(40)

    if (error) throw error

    const sessions = data || []
    return NextResponse.json({
      open: sessions.filter((s: any) => !s.finished_at),
      recent: sessions.filter((s: any) => s.finished_at).slice(0, 20),
    })
  } catch (error: any) {
    console.error('Pitch count GET error:', error)
    return NextResponse.json({ open: [], recent: [], needsMigration: true })
  }
}

// ---------------------------------------------------------------------------
// POST — start a counter
//   { coachId, teamId?, subjectType, label, teamPlayerId?, opponentPlayerId?,
//     opponentTeamId?, opponentName?, countedOn?, ruleSetId? }
//
// opponentName creates the opponent team/player on the fly: a coach at a
// tournament does not want to leave the counter to go set up a scouting record
// first, and if we make them, they'll just not count.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      coachId, teamId, subjectType, label,
      teamPlayerId, opponentPlayerId, opponentTeamId, opponentName,
      countedOn, ruleSetId,
    } = body

    if (!coachId || !label?.trim()) {
      return NextResponse.json({ error: 'coachId and a name are required' }, { status: 400 })
    }

    const type = ['roster', 'opponent', 'adhoc'].includes(subjectType) ? subjectType : 'adhoc'
    let resolvedOpponentPlayer: string | null = opponentPlayerId || null
    let resolvedOpponentTeam: string | null = opponentTeamId || null

    // Creating the opponent record here is what makes the count useful later —
    // an unattached number can't feed the availability board.
    if (type === 'opponent' && !resolvedOpponentPlayer) {
      if (!resolvedOpponentTeam && opponentName?.trim()) {
        const { data: existingTeam } = await supabaseAdmin
          .from('opponent_teams')
          .select('id')
          .eq('coach_id', coachId)
          .ilike('name', opponentName.trim())
          .maybeSingle()

        if (existingTeam) {
          resolvedOpponentTeam = (existingTeam as any).id
        } else {
          const { data: newTeam, error: teamErr } = await supabaseAdmin
            .from('opponent_teams')
            .insert({
              coach_id: coachId,
              name: opponentName.trim(),
              first_seen: countedOn || new Date().toISOString().slice(0, 10),
              last_seen: countedOn || new Date().toISOString().slice(0, 10),
            })
            .select('id')
            .single()
          if (teamErr) throw teamErr
          resolvedOpponentTeam = (newTeam as any).id
        }
      }

      if (resolvedOpponentTeam) {
        const { data: newPlayer, error: playerErr } = await supabaseAdmin
          .from('opponent_players')
          .insert({
            opponent_team_id: resolvedOpponentTeam,
            name: label.trim(),
            // Typed at the fence by the person watching — not a parse guess.
            confidence: 'confirmed',
            first_seen: countedOn || new Date().toISOString().slice(0, 10),
            last_seen: countedOn || new Date().toISOString().slice(0, 10),
          })
          .select('id')
          .single()
        if (playerErr) throw playerErr
        resolvedOpponentPlayer = (newPlayer as any).id
      }
    }

    const { data, error } = await supabaseAdmin
      .from('pitch_count_sessions')
      .insert({
        coach_id: coachId,
        team_id: teamId || null,
        // If we couldn't resolve an opponent identity, degrade to adhoc rather
        // than failing — a count with a name beats no count.
        subject_type: type === 'opponent' && !resolvedOpponentPlayer ? 'adhoc' : type,
        team_player_id: type === 'roster' ? teamPlayerId || null : null,
        opponent_player_id: resolvedOpponentPlayer,
        opponent_team_id: resolvedOpponentTeam,
        label: label.trim(),
        counted_on: countedOn || new Date().toISOString().slice(0, 10),
        rule_set_id: ruleSetId || null,
        pitches: 0,
      })
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ session: data })
  } catch (error: any) {
    console.error('Pitch count POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH — count, adjust, or finish
//   { coachId, sessionId, delta? | pitches?, innings?, notes?, finish? }
//
// delta is the hot path: one tap, one row update. It reads the current value
// server-side rather than trusting a number from a phone that may have been
// asleep, so two devices counting the same kid can't clobber each other.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    const { coachId, sessionId, delta, pitches, innings, notes, finish } = await request.json()

    if (!coachId || !sessionId) {
      return NextResponse.json({ error: 'coachId and sessionId are required' }, { status: 400 })
    }

    const { data: session } = await supabaseAdmin
      .from('pitch_count_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const s = session as any
    const update: Record<string, any> = {}

    if (typeof delta === 'number') {
      update.pitches = Math.max(0, (s.pitches || 0) + delta)
    } else if (typeof pitches === 'number') {
      update.pitches = Math.max(0, Math.round(pitches))
    }
    if (innings !== undefined) update.innings = innings
    if (notes !== undefined) update.notes = notes
    if (finish) update.finished_at = new Date().toISOString()

    const { data: updated, error } = await supabaseAdmin
      .from('pitch_count_sessions')
      .update(update)
      .eq('id', sessionId)
      .select('*')
      .single()

    if (error) throw error
    const u = updated as any

    // Finishing an opponent count writes the outing into the scouting record,
    // which is what makes it show up on the availability board. Guarded by
    // appearance_id so finishing twice doesn't invent a second outing.
    if (finish && u.subject_type === 'opponent' && u.opponent_player_id && !u.appearance_id) {
      const { data: appearance } = await supabaseAdmin
        .from('opponent_appearances')
        .insert({
          opponent_player_id: u.opponent_player_id,
          game_date: u.counted_on,
          pitches_thrown: u.pitches,
          innings_pitched: u.innings ?? null,
          positions_played: ['P'],
        })
        .select('id')
        .single()

      if (appearance) {
        await supabaseAdmin
          .from('pitch_count_sessions')
          .update({ appearance_id: (appearance as any).id })
          .eq('id', sessionId)
        u.appearance_id = (appearance as any).id
      }
      if (u.opponent_team_id) {
        await supabaseAdmin
          .from('opponent_teams')
          .update({ last_seen: u.counted_on })
          .eq('id', u.opponent_team_id)
      }
    }

    return NextResponse.json({ session: u, availability: await readAvailability(u) })
  } catch (error: any) {
    console.error('Pitch count PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a counter (mis-tapped, wrong kid)
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  const coachId = searchParams.get('coachId')

  if (!sessionId || !coachId) {
    return NextResponse.json({ error: 'sessionId and coachId required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('pitch_count_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('coach_id', coachId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// --- rest-day read ---------------------------------------------------------
// The number on its own is not the useful part. "68 — that's 3 days rest, back
// Wednesday" is, and it's the thing a coach can't work out in their head
// while the game is going on.
async function readAvailability(session: any) {
  if (!session.rule_set_id) return null
  try {
    const { data: rule } = await supabaseAdmin
      .from('pitch_count_rules')
      .select('*')
      .eq('id', session.rule_set_id)
      .maybeSingle()

    if (!rule) return null

    const appearance: AppearanceLite = {
      game_date: session.counted_on,
      pitches_thrown: session.pitches,
      innings_pitched: session.innings ?? null,
    }

    // Read forward from the day after: "when can he pitch again", which is the
    // question being asked, rather than "can he pitch right now".
    const tomorrow = new Date(new Date(session.counted_on).getTime() + 86_400_000)
      .toISOString().slice(0, 10)

    return computePitcherAvailability([appearance], rule as PitchCountRuleSet, tomorrow)
  } catch {
    return null
  }
}
