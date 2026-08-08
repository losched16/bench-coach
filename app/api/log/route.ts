import { NextRequest, NextResponse } from 'next/server'
import { migrationHintFor } from '@/lib/migrationHints'
import { createClient } from '@supabase/supabase-js'
import { normalizeStatLine } from '@/lib/entries'
import { findExistingGame } from '@/lib/games'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// `games.result` is stored as win | loss | tie (what the Stats page filters on).
// Scores are the more reliable signal when both are present; fall back to the
// W/L letter the box score printed.
function normalizeResult(
  result: string | null | undefined,
  teamScore: number | null | undefined,
  opponentScore: number | null | undefined
): 'win' | 'loss' | 'tie' | null {
  if (typeof teamScore === 'number' && typeof opponentScore === 'number') {
    if (teamScore > opponentScore) return 'win'
    if (teamScore < opponentScore) return 'loss'
    return 'tie'
  }
  const first = String(result || '').trim().toLowerCase().charAt(0)
  if (first === 'w') return 'win'
  if (first === 'l') return 'loss'
  if (first === 't') return 'tie'
  return null
}

// GET: recent entries for a team (the "you've logged this" trail)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const teamId = searchParams.get('teamId')
  const limit = Number(searchParams.get('limit') || 10)

  if (!coachId) {
    return NextResponse.json({ error: 'coachId required' }, { status: 400 })
  }

  try {
    let query = supabaseAdmin
      .from('entries')
      .select('*, observations(id, prompt_key, body), player:players(id, name)')
      .eq('coach_id', coachId)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 50))

    if (teamId) query = query.eq('team_id', teamId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ entries: data || [] })
  } catch (error: any) {
    console.error('Log GET error:', error)
    // The table may not exist yet — don't break the page over it
    return NextResponse.json({ entries: [], needsMigration: true, migrationMessage: migrationHintFor(error)?.message || null })
  }
}

// POST: create an entry, its observations, and (for games) normalized stats
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      coachId,
      teamId,
      playerId,
      entryType,
      occurredOn,
      title,
      notes,            // [{ prompt_key, body }]
      imageUrls,
      rawParse,         // the reviewed parse result
      parseStatus,
      parseConfidence,
      instructorName,
      durationMin,
      games,            // reviewed game rows with matched players
      rosterMappings,   // [{ source_name, team_player_id }] confirmed this session
      prescriptionId: explicitPrescriptionId, // set by the one-tap logger
    } = body

    if (!coachId || !entryType || !occurredOn) {
      return NextResponse.json(
        { error: 'coachId, entryType and occurredOn are required' },
        { status: 400 }
      )
    }

    // A home session works whatever priority is currently active — logging it
    // IS the check-in, so we attach it automatically rather than asking.
    //
    // The one-tap logger names the priority explicitly, which matters once a
    // coach has more than one running: "most recent active" would quietly
    // credit the wrong one.
    //
    // An explicit null is a real answer, not a missing one: "this was
    // maintenance work, don't credit it to anything." Guessing there would
    // inflate the adherence number the check-in uses to decide whether a drill
    // failed or was never run, which is the one signal the loop depends on.
    const choseExplicitly = Object.prototype.hasOwnProperty.call(body, 'prescriptionId')
    let prescriptionId: string | null = explicitPrescriptionId || null
    if (entryType === 'home_session' && !prescriptionId && !choseExplicitly) {
      let pq = supabaseAdmin
        .from('prescriptions')
        .select('id')
        .eq('coach_id', coachId)
        .eq('status', 'active')
        .order('issued_at', { ascending: false })
        .limit(1)
      if (playerId) pq = pq.eq('player_id', playerId)
      else if (teamId) pq = pq.eq('team_id', teamId)
      const { data: active } = await pq
      prescriptionId = active?.[0]?.id || null
    }

    // 1. The entry itself
    const { data: entry, error: entryError } = await supabaseAdmin
      .from('entries')
      .insert({
        coach_id: coachId,
        team_id: teamId || null,
        player_id: playerId || null,
        entry_type: entryType,
        occurred_on: occurredOn,
        title: title || null,
        image_urls: imageUrls || [],
        raw_parse: rawParse || null,
        parse_status: parseStatus || 'none',
        parse_confidence: parseConfidence ?? null,
        prescription_id: prescriptionId,
        instructor_name: instructorName || null,
        duration_min: durationMin ?? null,
      })
      .select()
      .single()

    if (entryError) throw entryError

    // 2. Observations — one row per answered prompt, so the engine can weight
    //    a lesson diagnosis differently from a fatigue note
    const observationRows = (notes || [])
      .filter((n: any) => n?.body && String(n.body).trim())
      .map((n: any) => ({
        coach_id: coachId,
        team_id: teamId || null,
        player_id: playerId || null,
        entry_id: entry.id,
        prompt_key: n.prompt_key || null,
        body: String(n.body).trim(),
        observed_on: occurredOn,
      }))

    if (observationRows.length > 0) {
      const { error: obsError } = await supabaseAdmin.from('observations').insert(observationRows)
      if (obsError) throw obsError
    }

    // 3. Persist confirmed roster mappings so next weekend matches itself
    if (teamId && Array.isArray(rosterMappings) && rosterMappings.length > 0) {
      const mappingRows = rosterMappings
        .filter((m: any) => m?.source_name && m?.team_player_id)
        .map((m: any) => ({
          team_id: teamId,
          source_name: String(m.source_name).trim(),
          team_player_id: m.team_player_id,
        }))
      if (mappingRows.length > 0) {
        await supabaseAdmin
          .from('roster_name_mappings')
          .upsert(mappingRows, { onConflict: 'team_id,source_name' })
      }
    }

    // 4. Normalize parsed games into games / player_game_stats so the Stats
    //    page and season totals stay the single source of truth for stats
    let gamesCreated = 0
    let gamesAttached = 0
    let statLinesCreated = 0
    let firstGameId: string | null = null

    if ((entryType === 'game' || entryType === 'scrimmage') && teamId && Array.isArray(games)) {
      for (const g of games) {
        const gameDate = g.game_date || occurredOn

        // The coach may already have tracked this game live in Game Day, or
        // built a lineup for it. Attach the box score to that record instead
        // of creating a second one — otherwise the season shows it twice.
        const existing = await findExistingGame(supabaseAdmin, {
          teamId, gameDate, opponent: g.opponent,
        })

        let gameId: string
        if (existing) {
          // The box score is the better source for the final line; a live
          // game usually ends without anyone typing the score in.
          await supabaseAdmin
            .from('games')
            .update({
              team_score: g.team_score ?? undefined,
              opponent_score: g.opponent_score ?? undefined,
              result: normalizeResult(g.result, g.team_score, g.opponent_score) ?? undefined,
              status: 'completed',
            })
            .eq('id', existing.id)
          gameId = existing.id
          gamesAttached++
        } else {
          const { data: newGame, error: gameError } = await supabaseAdmin
            .from('games')
            .insert({
              team_id: teamId,
              game_date: gameDate,
              opponent: g.opponent || null,
              team_score: g.team_score ?? null,
              opponent_score: g.opponent_score ?? null,
              result: normalizeResult(g.result, g.team_score, g.opponent_score),
              game_type: entryType === 'scrimmage' ? 'scrimmage' : 'regular',
              status: 'completed',
            })
            .select('id')
            .single()

          if (gameError) throw gameError
          gameId = (newGame as any).id
          gamesCreated++
        }

        if (!firstGameId) firstGameId = gameId

        const statRows = (g.players || [])
          .filter((p: any) => p.team_player_id)
          .map((p: any) => {
            const line = normalizeStatLine(p.batting_line || {})
            return {
              game_id: gameId,
              team_player_id: p.team_player_id,
              at_bats: line.at_bats,
              hits: line.hits,
              doubles: line.doubles,
              triples: line.triples,
              home_runs: line.home_runs,
              rbi: line.rbi,
              runs: line.runs,
              walks: line.walks,
              strikeouts: line.strikeouts,
              stolen_bases: line.stolen_bases,
              errors: p.errors ?? line.errors,
              innings_pitched: p.innings_pitched ?? line.innings_pitched,
              pitches_thrown: p.pitches_thrown ?? line.pitches_thrown,
              pitching_strikeouts: p.pitching_k ?? line.pitching_strikeouts,
              pitching_walks: p.pitching_bb ?? line.pitching_walks,
            }
          })

        if (statRows.length > 0) {
          // Attaching to a game that already exists means the same box score
          // could be uploaded twice — which used to make a duplicate game
          // (bad) and would now double the stat lines on one game (worse).
          // Clear this game's rows for these players first. Deterministic,
          // and doesn't depend on a unique constraint we can't verify.
          if (existing) {
            await supabaseAdmin
              .from('player_game_stats')
              .delete()
              .eq('game_id', gameId)
              .in('team_player_id', statRows.map((r: any) => r.team_player_id))
          }

          const { error: statError } = await supabaseAdmin
            .from('player_game_stats')
            .insert(statRows)
          if (statError) throw statError
          statLinesCreated += statRows.length
        }
      }

      if (firstGameId) {
        await supabaseAdmin.from('entries').update({ game_id: firstGameId }).eq('id', entry.id)
      }
    }

    return NextResponse.json({
      entry,
      summary: {
        observations: observationRows.length,
        gamesCreated,
        gamesAttached,
        statLinesCreated,
        linkedToPrescription: !!prescriptionId,
      },
    })
  } catch (error: any) {
    console.error('Log POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH: attach notes to an entry that already exists.
//
// The one-tap logger saves the session the instant the button is pressed —
// that is the whole point, and making it wait for a text box is how you get
// nothing logged at all. The optional "how did it go" arrives afterwards, if
// they feel like it, and lands here.
export async function PATCH(request: NextRequest) {
  try {
    const { coachId, entryId, notes } = await request.json()

    if (!coachId || !entryId) {
      return NextResponse.json({ error: 'coachId and entryId are required' }, { status: 400 })
    }

    const { data: entry } = await supabaseAdmin
      .from('entries')
      .select('id, team_id, player_id, occurred_on')
      .eq('id', entryId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

    const rows = (notes || [])
      .filter((n: any) => n?.body && String(n.body).trim())
      .map((n: any) => ({
        coach_id: coachId,
        team_id: (entry as any).team_id,
        player_id: (entry as any).player_id,
        entry_id: (entry as any).id,
        prompt_key: n.prompt_key || null,
        body: String(n.body).trim(),
        observed_on: (entry as any).occurred_on,
      }))

    if (rows.length === 0) return NextResponse.json({ success: true, observations: 0 })

    const { error } = await supabaseAdmin.from('observations').insert(rows)
    if (error) throw error

    return NextResponse.json({ success: true, observations: rows.length })
  } catch (error: any) {
    console.error('Log PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove an entry (observations cascade)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get('entryId')
  const coachId = searchParams.get('coachId')

  if (!entryId || !coachId) {
    return NextResponse.json({ error: 'entryId and coachId required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('entries')
      .delete()
      .eq('id', entryId)
      .eq('coach_id', coachId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Log DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
