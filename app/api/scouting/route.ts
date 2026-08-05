import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  matchOpponentPlayer,
  matchOpponentTeam,
  nameSimilarity,
  OpponentPlayerLite,
} from '@/lib/scouting'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET: list opponent teams for a coach, or full detail for one opponent
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const opponentTeamId = searchParams.get('opponentTeamId')

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    if (opponentTeamId) {
      const { data: team, error: teamError } = await supabaseAdmin
        .from('opponent_teams')
        .select('*')
        .eq('id', opponentTeamId)
        .eq('coach_id', coachId)
        .single()

      if (teamError || !team) {
        return NextResponse.json({ error: 'Opponent team not found' }, { status: 404 })
      }

      const [playersRes, entriesRes, matchupsRes] = await Promise.all([
        supabaseAdmin
          .from('opponent_players')
          .select('*, appearances:opponent_appearances(*)')
          .eq('opponent_team_id', opponentTeamId)
          .order('jersey_number', { ascending: true }),
        supabaseAdmin
          .from('scouting_entries')
          .select('*')
          .eq('opponent_team_id', opponentTeamId)
          .order('occurred_on', { ascending: false }),
        supabaseAdmin
          .from('matchups')
          .select('*')
          .eq('opponent_team_id', opponentTeamId)
          .order('scheduled_at', { ascending: true }),
      ])

      return NextResponse.json({
        team,
        players: playersRes.data || [],
        entries: entriesRes.data || [],
        matchups: matchupsRes.data || [],
      })
    }

    // List mode: teams with entry/player counts + upcoming matchups
    const [teamsRes, matchupsRes] = await Promise.all([
      supabaseAdmin
        .from('opponent_teams')
        .select('*, players:opponent_players(id), entries:scouting_entries(id, entry_type, occurred_on)')
        .eq('coach_id', coachId)
        .order('last_seen', { ascending: false, nullsFirst: false }),
      supabaseAdmin
        .from('matchups')
        .select('*, opponent_team:opponent_teams(id, name)')
        .eq('coach_id', coachId)
        .in('status', ['upcoming', 'possible'])
        .order('scheduled_at', { ascending: true, nullsFirst: false }),
    ])

    const teams = (teamsRes.data || []).map((t: any) => ({
      ...t,
      player_count: t.players?.length || 0,
      entry_count: t.entries?.length || 0,
      last_entry_on: t.entries?.reduce(
        (max: string | null, e: any) => (e.occurred_on && (!max || e.occurred_on > max) ? e.occurred_on : max),
        null
      ),
      players: undefined,
      entries: undefined,
    }))

    return NextResponse.json({ teams, matchups: matchupsRes.data || [] })
  } catch (error: any) {
    console.error('Scouting GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Find-or-create an opponent team, reusing an existing record when the name
// is effectively the same (avoids duplicate team records from typos)
async function resolveOpponentTeam(
  coachId: string,
  newTeam: { name: string; org_name?: string; age_group?: string; region?: string },
  occurredOn?: string | null
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from('opponent_teams')
    .select('id, name')
    .eq('coach_id', coachId)

  const match = matchOpponentTeam(newTeam.name, existing || [])
  if (match && match.similarity >= 0.95) {
    return { id: match.id, created: false }
  }

  const { data: created, error } = await supabaseAdmin
    .from('opponent_teams')
    .insert({
      coach_id: coachId,
      name: newTeam.name.trim(),
      org_name: newTeam.org_name || null,
      age_group: newTeam.age_group || null,
      region: newTeam.region || null,
      first_seen: occurredOn || null,
      last_seen: occurredOn || null,
    })
    .select('id')
    .single()

  if (error) throw error
  return { id: created.id, created: true }
}

// Attach a parsed player to an existing opponent_players row at high
// confidence, or create a new row (flagged for review when a plausible
// duplicate exists). Never auto-merge below the confidence bar — a wrong
// merge silently corrupts the pitch-count math.
async function resolveOpponentPlayer(
  opponentTeamId: string,
  parsed: { name: string; jersey_number?: string | null; positions?: string[] },
  existing: OpponentPlayerLite[],
  occurredOn: string | null
): Promise<{ id: string; created: boolean }> {
  const match = matchOpponentPlayer(parsed, existing)

  if (match.player) {
    const updates: any = { last_seen: occurredOn }
    if (!match.player.jersey_number && parsed.jersey_number) {
      updates.jersey_number = parsed.jersey_number
    }
    await supabaseAdmin.from('opponent_players').update(updates).eq('id', match.player.id)
    return { id: match.player.id, created: false }
  }

  const isPossibleDupe = match.matchLevel === 'possible'
  const { data: created, error } = await supabaseAdmin
    .from('opponent_players')
    .insert({
      opponent_team_id: opponentTeamId,
      name: parsed.name.trim(),
      jersey_number: parsed.jersey_number || null,
      positions: parsed.positions || [],
      confidence: isPossibleDupe ? 'uncertain' : 'confirmed',
      needs_review: isPossibleDupe,
      notes: isPossibleDupe
        ? 'Possible duplicate of an existing player on this team — review and merge if it is the same kid.'
        : null,
      first_seen: occurredOn,
      last_seen: occurredOn,
    })
    .select('id')
    .single()

  if (error) throw error
  return { id: created.id, created: true }
}

// POST: create a scouting entry (and its players/appearances/matchups)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      coachId,
      opponentTeamId,
      newTeam,
      entryType,
      occurredOn,
      tournamentName,
      notes,
      imageUrls,
      rawParse,
      parseConfidence,
      pastedText, // raw GameChanger recap text pasted by the coach
      players, // reviewed box-score player rows
      bracket, // reviewed bracket parse { teams, games, tournament_name }
      teamId, // coach's own team, for bracket matchups
      ownTeamName,
    } = body

    if (!coachId || !entryType) {
      return NextResponse.json({ error: 'coachId and entryType required' }, { status: 400 })
    }

    // Keep the original pasted recap alongside the parse, and fold what it
    // said into the entry notes so it's visible on the entry and reaches the
    // chat assistant's scouting context.
    const storedParse = pastedText
      ? { ...(rawParse || {}), pasted_text: String(pastedText).slice(0, 20000) }
      : rawParse || null
    let entryNotes: string | null = notes || null
    if (rawParse?.summary || (rawParse?.tendencies || []).length > 0 || rawParse?.pitching_notes) {
      const recapParts: string[] = []
      if (rawParse.summary) recapParts.push(`Recap: ${rawParse.summary}`)
      if (rawParse.pitching_notes) recapParts.push(`Pitching: ${rawParse.pitching_notes}`)
      if ((rawParse.tendencies || []).length > 0) recapParts.push(`Tendencies: ${rawParse.tendencies.join('; ')}`)
      entryNotes = [entryNotes, recapParts.join('\n')].filter(Boolean).join('\n')
    } else if (pastedText && !rawParse) {
      // Text pasted but never parsed — keep it readable rather than losing it
      entryNotes = [entryNotes, `Pasted recap: ${String(pastedText).slice(0, 2000)}`].filter(Boolean).join('\n')
    }

    // 1. Resolve the opponent team (not needed for bracket entries)
    let resolvedTeamId: string | null = opponentTeamId || null
    if (!resolvedTeamId && entryType !== 'bracket') {
      if (!newTeam?.name) {
        return NextResponse.json({ error: 'opponentTeamId or newTeam required' }, { status: 400 })
      }
      const resolved = await resolveOpponentTeam(coachId, newTeam, occurredOn)
      resolvedTeamId = resolved.id
    }

    // 2. Create the entry
    const { data: entry, error: entryError } = await supabaseAdmin
      .from('scouting_entries')
      .insert({
        coach_id: coachId,
        opponent_team_id: resolvedTeamId,
        entry_type: entryType,
        occurred_on: occurredOn || null,
        tournament_name: tournamentName || null,
        image_urls: imageUrls || [],
        raw_parse: storedParse,
        parse_status: rawParse ? 'parsed' : 'none',
        parse_confidence: parseConfidence || null,
        notes: entryNotes,
      })
      .select()
      .single()

    if (entryError) throw entryError

    let playersCreated = 0
    let playersMatched = 0
    let appearancesCreated = 0
    let matchupsCreated = 0
    let teamsCreated = 0

    // 3. Box score: resolve identities and log appearances
    if (entryType === 'box_score' && resolvedTeamId && Array.isArray(players) && players.length > 0) {
      const { data: existingPlayers } = await supabaseAdmin
        .from('opponent_players')
        .select('id, name, jersey_number, confidence')
        .eq('opponent_team_id', resolvedTeamId)

      // Resolve sequentially so two same-named parsed rows don't both create
      const roster: OpponentPlayerLite[] = (existingPlayers || []) as OpponentPlayerLite[]
      for (const p of players) {
        if (!p.name) continue
        const { id: playerId, created } = await resolveOpponentPlayer(
          resolvedTeamId, p, roster, occurredOn || null
        )
        if (created) {
          playersCreated++
          roster.push({
            id: playerId,
            name: p.name,
            jersey_number: p.jersey_number || null,
            confidence: 'confirmed',
          })
        } else {
          playersMatched++
        }

        const { error: appError } = await supabaseAdmin.from('opponent_appearances').insert({
          opponent_player_id: playerId,
          scouting_entry_id: entry.id,
          game_date: occurredOn || new Date().toISOString().split('T')[0],
          batting_order_slot: p.batting_order_slot ?? null,
          positions_played: p.positions || [],
          batting_line: p.batting_line || null,
          pitches_thrown: p.pitches_thrown ?? null,
          innings_pitched: p.innings_pitched ?? null,
          raw: p,
        })
        if (appError) throw appError
        appearancesCreated++
      }
    }

    // 4. Recap: attach mentioned players (notes only, no appearances)
    if (entryType === 'recap' && resolvedTeamId && Array.isArray(rawParse?.players_mentioned)) {
      const { data: existingPlayers } = await supabaseAdmin
        .from('opponent_players')
        .select('id, name, jersey_number, confidence, notes')
        .eq('opponent_team_id', resolvedTeamId)

      const roster: OpponentPlayerLite[] = (existingPlayers || []) as OpponentPlayerLite[]
      for (const pm of rawParse.players_mentioned) {
        if (!pm.name) continue
        const { id: playerId, created } = await resolveOpponentPlayer(
          resolvedTeamId, pm, roster, occurredOn || null
        )
        if (created) {
          playersCreated++
          roster.push({ id: playerId, name: pm.name, jersey_number: pm.jersey_number || null, confidence: 'confirmed' })
        }
        if (pm.note) {
          const existingRow: any = (existingPlayers || []).find((e: any) => e.id === playerId)
          const dateTag = occurredOn ? `[${occurredOn}] ` : ''
          const newNote = existingRow?.notes
            ? `${existingRow.notes}\n${dateTag}${pm.note}`
            : `${dateTag}${pm.note}`
          await supabaseAdmin.from('opponent_players').update({ notes: newNote }).eq('id', playerId)
        }
      }
    }

    // 5. Bracket: create possible matchups for teams the coach might face
    if (entryType === 'bracket' && bracket && Array.isArray(bracket.teams)) {
      const { data: existingTeams } = await supabaseAdmin
        .from('opponent_teams')
        .select('id, name')
        .eq('coach_id', coachId)

      const knownTeams = [...(existingTeams || [])]
      for (const bt of bracket.teams) {
        if (!bt.name || bt.name.toUpperCase() === 'TBD') continue
        // Skip the coach's own team if it appears in the bracket
        if (ownTeamName && nameSimilarity(bt.name, ownTeamName) >= 0.85) continue

        const match = matchOpponentTeam(bt.name, knownTeams)
        let btId: string
        if (match && match.similarity >= 0.9) {
          btId = match.id
        } else {
          const { data: created, error } = await supabaseAdmin
            .from('opponent_teams')
            .insert({
              coach_id: coachId,
              name: bt.name.trim(),
              first_seen: occurredOn || null,
              last_seen: occurredOn || null,
            })
            .select('id')
            .single()
          if (error) throw error
          btId = created.id
          knownTeams.push({ id: btId, name: bt.name })
          teamsCreated++
        }

        const { error: muError } = await supabaseAdmin.from('matchups').insert({
          coach_id: coachId,
          team_id: teamId || null,
          opponent_team_id: btId,
          tournament_name: bracket.tournament_name || tournamentName || null,
          bracket_position: bt.bracket_position || null,
          status: 'possible',
        })
        if (muError) throw muError
        matchupsCreated++
      }
    }

    // 6. Keep the opponent team's first/last seen fresh
    if (resolvedTeamId && occurredOn) {
      const { data: team } = await supabaseAdmin
        .from('opponent_teams')
        .select('first_seen, last_seen')
        .eq('id', resolvedTeamId)
        .single()
      if (team) {
        const updates: any = {}
        if (!team.first_seen || occurredOn < team.first_seen) updates.first_seen = occurredOn
        if (!team.last_seen || occurredOn > team.last_seen) updates.last_seen = occurredOn
        if (Object.keys(updates).length > 0) {
          await supabaseAdmin.from('opponent_teams').update(updates).eq('id', resolvedTeamId)
        }
      }
    }

    return NextResponse.json({
      entry,
      opponentTeamId: resolvedTeamId,
      summary: { playersCreated, playersMatched, appearancesCreated, matchupsCreated, teamsCreated },
    })
  } catch (error: any) {
    console.error('Scouting POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PUT: update opponent team notes/details
export async function PUT(request: NextRequest) {
  try {
    const { opponentTeamId, coachId, updates } = await request.json()
    if (!opponentTeamId || !coachId) {
      return NextResponse.json({ error: 'opponentTeamId and coachId required' }, { status: 400 })
    }

    const allowed: any = {}
    for (const key of ['name', 'org_name', 'age_group', 'region', 'notes']) {
      if (updates?.[key] !== undefined) allowed[key] = updates[key]
    }

    const { error } = await supabaseAdmin
      .from('opponent_teams')
      .update(allowed)
      .eq('id', opponentTeamId)
      .eq('coach_id', coachId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Scouting PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove a scouting entry (appearances cascade) or an opponent team
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get('entryId')
  const opponentTeamId = searchParams.get('opponentTeamId')
  const coachId = searchParams.get('coachId')

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    if (entryId) {
      const { error } = await supabaseAdmin
        .from('scouting_entries')
        .delete()
        .eq('id', entryId)
        .eq('coach_id', coachId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }
    if (opponentTeamId) {
      const { error } = await supabaseAdmin
        .from('opponent_teams')
        .delete()
        .eq('id', opponentTeamId)
        .eq('coach_id', coachId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'entryId or opponentTeamId required' }, { status: 400 })
  } catch (error: any) {
    console.error('Scouting DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
