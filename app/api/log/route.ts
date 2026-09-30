import { NextRequest, NextResponse } from 'next/server'
import { migrationHintFor } from '@/lib/migrationHints'
import { createClient } from '@supabase/supabase-js'
import { normalizeStatLine } from '@/lib/entries'
import { findExistingGame } from '@/lib/games'
import { requireSession, authorizeTeam, authorizeOwnCoach, authzResponse, AuthzError } from '@/lib/authz'
import { resolvePlayerScope } from '@/lib/playerScope'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

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

// GET: recent entries — the activity list on the Log page and a player's
// history on their profile.
//
// With a team: everyone on the staff with 'read' (viewers included) sees what
// every staff member logged for that team — the head coach's practices and the
// assistant's notes alike. Nothing from another team, even one the same coach
// owns. A named player must be on the team (roster or archive).
//
// Without a team: the caller's own entries.
//
// Who is asking comes from the session. A coachId in the query is ignored.
// Each entry carries its author's display name, and viewerCoachId says which
// of them are the caller's own.
export async function GET(request: NextRequest) {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated

  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId') || null
  // The player page asks for one player's history. Team-wide entries (a
  // practice logged against the whole roster) carry no player_id and are
  // deliberately excluded — "Charlie's history" showing every team practice
  // is the noise that made the old journal tab readable in the first place.
  const playerId = searchParams.get('playerId')
  const limit = Number(searchParams.get('limit') || 10)

  let viewerCoachId: string | null
  let ownerCoachId: string
  try {
    if (teamId) {
      const actor = await authorizeTeam(teamId, 'read')
      viewerCoachId = actor.coachId
      ownerCoachId = actor.ownerCoachId
    } else {
      const actor = await authorizeOwnCoach()
      viewerCoachId = actor.coachId
      ownerCoachId = actor.coachId
    }
    if (playerId) {
      const scope = await resolvePlayerScope(supabaseAdmin, { playerId, teamId, ownerCoachId })
      if (!scope.ok) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }
  } catch (error) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    throw error
  }

  try {
    let query = supabaseAdmin
      .from('entries')
      .select('*, observations(id, prompt_key, body), player:players(id, name), author:coaches(id, display_name)')
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50))

    query = teamId ? query.eq('team_id', teamId) : query.eq('coach_id', ownerCoachId)
    if (playerId) query = query.eq('player_id', playerId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ entries: data || [], viewerCoachId })
  } catch (error: any) {
    console.error('Log GET error:', error)
    // The table may not exist yet — don't break the page over it
    return NextResponse.json({ entries: [], needsMigration: true, migrationMessage: migrationHintFor(error)?.message || null })
  }
}

// WHO IS WRITING, AND WHAT THEY MAY WRITE ABOUT
//
// Authorship comes from the session, never from the request. A coachId in the
// body is ignored: the entry and its observations are written under the
// caller's own coach profile, so nobody can file a note as another coach.
//
//   With a team:  'record' on that team (owner, admin, contributor — not a
//                 viewer, not a league administrator), and every player, roster
//                 row and priority named must belong to that team.
//   No team:      the caller's own account (a Personal plan coach), and the
//                 player and priority must be theirs.
//
// Anything that fails answers 404 (or the authorization status) before a
// single row is written.
async function authorizeLogWrite(teamId: string | null): Promise<{ authorCoachId: string; ownerCoachId: string; teamId: string | null }> {
  if (teamId) {
    const actor = await authorizeTeam(teamId, 'record')
    if (!actor.coachId) throw new AuthzError('Your account has no coach profile to record this under', 403)
    return { authorCoachId: actor.coachId, ownerCoachId: actor.ownerCoachId, teamId }
  }
  const actor = await authorizeOwnCoach()
  return { authorCoachId: actor.coachId, ownerCoachId: actor.coachId, teamId: null }
}

// POST: create an entry, its observations, and (for games) normalized stats
export async function POST(request: NextRequest) {
  // Signed in first; the team or own-account check follows once the body says
  // which applies (authorizeLogWrite), before anything is read or written.
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated

  try {
    const body = await request.json()
    const {
      teamId: rawTeamId,
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
      quickLog,                                // true only from "Ran it today"
    } = body

    const teamId: string | null = typeof rawTeamId === 'string' && rawTeamId ? rawTeamId : null
    const { authorCoachId, ownerCoachId } = await authorizeLogWrite(teamId)
    const coachId = authorCoachId

    if (!entryType || !occurredOn) {
      return NextResponse.json(
        { error: 'entryType and occurredOn are required' },
        { status: 400 }
      )
    }

    // The player must be on this team (roster or archive), or with no team,
    // the caller's own. Same rule, same refusal, as every other player read.
    if (playerId) {
      const scope = await resolvePlayerScope(supabaseAdmin, { playerId, teamId, ownerCoachId })
      if (!scope.ok) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // A named priority must be this team's (or, with no team, the caller's
    // own team-less one) and, when a player is named, that player's.
    if (body.prescriptionId) {
      const { data: rx } = await supabaseAdmin
        .from('prescriptions').select('id, team_id, player_id, coach_id')
        .eq('id', String(body.prescriptionId)).maybeSingle()
      const r = rx as any
      const fits = !!r && (teamId
        ? r.team_id === teamId
        : !r.team_id && r.coach_id === ownerCoachId)
        && (!playerId || !r.player_id || r.player_id === playerId)
      if (!fits) return NextResponse.json({ error: 'Priority not found' }, { status: 404 })
    }

    // Roster rows named by a parsed box score or a confirmed name mapping must
    // be this team's. Anything else is dropped, never written.
    let teamRosterIds = new Set<string>()
    if (teamId && (Array.isArray(games) || Array.isArray(rosterMappings))) {
      const { data: roster } = await supabaseAdmin
        .from('team_players').select('id').eq('team_id', teamId)
      teamRosterIds = new Set(((roster || []) as any[]).map(r => r.id))
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
      // The team's priorities (set by its owner), or with no team the
      // caller's own — not the author's, which for an assistant is nobody's.
      let pq = supabaseAdmin
        .from('prescriptions')
        .select('id')
        .eq('coach_id', ownerCoachId)
        .eq('status', 'active')
        .order('issued_at', { ascending: false })
        .limit(1)
      pq = teamId ? pq.eq('team_id', teamId) : pq.is('team_id', null)
      if (playerId) pq = pq.eq('player_id', playerId)
      const { data: active } = await pq
      prescriptionId = active?.[0]?.id || null
    }

    // One "Ran it today" per priority per day. Returning the existing entry
    // rather than erroring means a double tap is invisible to the coach and
    // still correct — they meant to record that they ran it, and it is
    // recorded.
    //
    // The full Log an Entry form is deliberately NOT deduplicated: two genuine
    // sessions in a day is a real thing, and blocking the second would be a
    // worse bug than the one this fixes.
    if (quickLog && prescriptionId) {
      const { data: existing } = await supabaseAdmin
        .from('entries')
        .select('*')
        .eq('prescription_id', prescriptionId)
        .eq('occurred_on', occurredOn)
        .eq('quick_log', true)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({
          entry: existing,
          alreadyLogged: true,
          summary: { observations: 0, gamesCreated: 0, gamesAttached: 0, statLinesCreated: 0, linkedToPrescription: true },
        })
      }
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
        quick_log: !!quickLog,
      })
      .select()
      .single()

    if (entryError) {
      // Two taps landing at once both pass the check above; the unique index
      // is what actually stops the second, and this turns that race into the
      // same quiet success as the slow path.
      if (quickLog && prescriptionId && /duplicate|unique/i.test(String(entryError.message))) {
        const { data: existing } = await supabaseAdmin
          .from('entries')
          .select('*')
          .eq('prescription_id', prescriptionId)
          .eq('occurred_on', occurredOn)
          .eq('quick_log', true)
          .maybeSingle()
        if (existing) {
          return NextResponse.json({ entry: existing, alreadyLogged: true })
        }
      }
      throw entryError
    }

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
        .filter((m: any) => m?.source_name && m?.team_player_id && teamRosterIds.has(String(m.team_player_id)))
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
          .filter((p: any) => p.team_player_id && teamRosterIds.has(String(p.team_player_id)))
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
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Log POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// An entry the caller wrote, on a team they may still record on (or, with no
// team, their own). Null answers 404 — a missing entry, someone else's, and
// another team's all look the same.
async function ownEntry(entryId: string) {
  const { data: entry } = await supabaseAdmin
    .from('entries')
    .select('id, coach_id, team_id, player_id, occurred_on')
    .eq('id', entryId)
    .maybeSingle()
  if (!entry) return null
  const e = entry as any
  const { authorCoachId } = await authorizeLogWrite(e.team_id || null)
  return e.coach_id === authorCoachId ? { entry: e, authorCoachId } : null
}

// PATCH: attach notes to an entry that already exists.
//
// The one-tap logger saves the session the instant the button is pressed —
// that is the whole point, and making it wait for a text box is how you get
// nothing logged at all. The optional "how did it go" arrives afterwards, if
// they feel like it, and lands here. Only the entry's author may add to it,
// and a coachId in the body is ignored — see authorizeLogWrite.
export async function PATCH(request: NextRequest) {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated

  try {
    const { entryId, notes } = await request.json()

    if (!entryId) {
      return NextResponse.json({ error: 'entryId is required' }, { status: 400 })
    }

    const found = await ownEntry(String(entryId))
    if (!found) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    const { entry, authorCoachId } = found

    const rows = (notes || [])
      .filter((n: any) => n?.body && String(n.body).trim())
      .map((n: any) => ({
        coach_id: authorCoachId,
        team_id: entry.team_id,
        player_id: entry.player_id,
        entry_id: entry.id,
        prompt_key: n.prompt_key || null,
        body: String(n.body).trim(),
        observed_on: entry.occurred_on,
      }))

    if (rows.length === 0) return NextResponse.json({ success: true, observations: 0 })

    const { error } = await supabaseAdmin.from('observations').insert(rows)
    if (error) throw error

    return NextResponse.json({ success: true, observations: rows.length })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Log PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: remove an entry the caller wrote (observations cascade).
export async function DELETE(request: NextRequest) {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated

  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get('entryId')

  if (!entryId) {
    return NextResponse.json({ error: 'entryId required' }, { status: 400 })
  }

  try {
    const found = await ownEntry(entryId)
    if (!found) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    const { error } = await supabaseAdmin
      .from('entries')
      .delete()
      .eq('id', found.entry.id)
      .eq('coach_id', found.authorCoachId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Log DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
