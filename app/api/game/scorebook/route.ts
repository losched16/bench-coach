import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  GameState, Bases, EMPTY_BASES, Half, StoredEvent, Runner,
  advanceIfHalfOver, weAreBatting, boxScore,
} from '@/lib/scorebook'
import { migrationHintFor } from '@/lib/migrationHints'

// The book.
//
// Reads are cheap and happen constantly; writes are one row and are guarded
// against the double-tap, which is the failure mode of every button a coach
// presses while looking at the field instead of the phone.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function asBases(v: any): Bases {
  if (!v || typeof v !== 'object') return { ...EMPTY_BASES }
  const one = (r: any): Runner | null =>
    r && typeof r === 'object' && r.id
      ? {
          id: String(r.id),
          // Who it is, as opposed to which trip around the bases this is. Rows
          // written before the two were separated have only the id, and there
          // it WAS the player id — so falling back to it keeps old games
          // reading correctly.
          playerId: r.playerId != null ? String(r.playerId) : null,
          name: String(r.name || 'Runner'),
          earned: r.earned !== false,
        }
      : null
  return { first: one(v.first), second: one(v.second), third: one(v.third) }
}

function asRunners(v: any): Runner[] {
  if (!Array.isArray(v)) return []
  return v
    .filter(r => r && r.id)
    .map(r => ({
      id: String(r.id),
      playerId: r.playerId != null ? String(r.playerId) : null,
      name: String(r.name || 'Runner'),
      earned: r.earned !== false,
    }))
}

function toStored(row: any): StoredEvent {
  return {
    seq: row.seq,
    kind: row.kind,
    inning: row.inning,
    half: row.half as Half,
    weBatting: !!row.we_batting,
    result: row.result,
    batterId: row.batter_team_player_id || null,
    batterName: row.opponent_name || null,
    pitcherId: row.pitcher_player_id || null,
    balls: row.balls || 0,
    strikes: row.strikes || 0,
    pitches: row.pitches || 0,
    rbi: row.rbi || 0,
    outsAfter: row.outs_after || 0,
    basesAfter: asBases(row.bases_after),
    scored: asRunners(row.runs_scored),
    scoring: row.scoring || null,
  }
}

// Where the game stands: the last event's snapshot, rolled forward if that
// event was the third out. Derived in exactly one place.
//
// With no events yet, the book picks up the game's own cursor rather than
// assuming the top of the first. A coach who ran two innings on the pitch
// panel and then opened the book would otherwise find it scoring the wrong
// inning — the scorebook is optional, so it has to be able to join late.
function stateFrom(rows: any[], isHome: boolean, cursor?: { inning: number; half: Half }): GameState {
  if (rows.length === 0) {
    return {
      inning: cursor?.inning || 1,
      half: cursor?.half || 'top',
      outs: 0,
      bases: { ...EMPTY_BASES },
      awayRuns: 0,
      homeRuns: 0,
    }
  }
  const last = rows[rows.length - 1]

  let away = 0
  let home = 0
  for (const r of rows) {
    const n = asRunners(r.runs_scored).length
    if (r.half === 'top') away += n
    else home += n
  }

  return advanceIfHalfOver({
    inning: last.inning,
    half: last.half as Half,
    outs: last.outs_after || 0,
    bases: asBases(last.bases_after),
    awayRuns: away,
    homeRuns: home,
  })
}

// ---------------------------------------------------------------------------
// GET ?gameId= — the book, where the game stands, and the box score
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 })

  try {
    const { data: game } = await supabaseAdmin
      .from('games')
      .select('id, team_id, opponent, is_home, total_innings, current_inning, current_half')
      .eq('id', gameId)
      .maybeSingle()
    if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })

    const g = game as any
    const isHome = g.is_home !== false

    const [{ data: rows, error }, { data: participation }] = await Promise.all([
      supabaseAdmin.from('game_events').select('*').eq('game_id', gameId).order('seq'),
      supabaseAdmin
        .from('game_participation')
        .select('team_player_id, batting_slot, is_in, team_player:team_players(id, player:players(id, name, jersey_number))')
        .eq('game_id', gameId),
    ])
    if (error) throw error

    const all = rows || []
    const state = stateFrom(all, isHome, {
      inning: g.current_inning || 1,
      half: (g.current_half as Half) || 'top',
    })

    // Our batting order, so the book knows who is due up without being told.
    const order = (participation || [])
      .filter((p: any) => p.batting_slot)
      .sort((a: any, b: any) => a.batting_slot - b.batting_slot)
      .map((p: any) => ({
        teamPlayerId: p.team_player_id,
        playerId: p.team_player?.player?.id || null,
        name: p.team_player?.player?.name || 'Unknown',
        jersey: p.team_player?.player?.jersey_number || null,
        slot: p.batting_slot,
        isIn: !!p.is_in,
      }))

    // Whoever we have batted the most times is where we are in the order. It
    // survives substitutions and a coach who scored two innings after the fact,
    // which "count the PAs and divide" does not.
    const ourPAs = all.filter((e: any) => e.we_batting && e.kind === 'pa')
    const dueUpIndex = order.length > 0 ? ourPAs.length % order.length : 0

    // Their order is just slots — nobody rosters the other team.
    const theirPAs = all.filter((e: any) => !e.we_batting && e.kind === 'pa')
    const opponentNames: Record<number, string> = {}
    for (const e of all as any[]) {
      if (e.opponent_slot && e.opponent_name) opponentNames[e.opponent_slot] = e.opponent_name
    }

    const names: Record<string, string> = {}
    for (const o of order) {
      names[o.teamPlayerId] = o.name
      if (o.playerId) names[o.playerId] = o.name
    }

    return NextResponse.json({
      isHome,
      opponent: g.opponent || null,
      totalInnings: g.total_innings || 6,
      state,
      weBatting: weAreBatting(state.half, isHome),
      order,
      dueUpIndex,
      opponentSlot: order.length > 0 ? (theirPAs.length % 9) + 1 : (theirPAs.length % 9) + 1,
      opponentNames,
      events: all.map(toStored),
      box: boxScore(all.map(toStored), names),
    })
  } catch (error: any) {
    console.error('Scorebook GET error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      isHome: true, state: { inning: 1, half: 'top', outs: 0, bases: EMPTY_BASES, awayRuns: 0, homeRuns: 0 },
      weBatting: false, order: [], dueUpIndex: 0, opponentSlot: 1, opponentNames: {},
      events: [], box: { batting: [], pitching: [], lineScore: [], awayRuns: 0, homeRuns: 0 },
      needsMigration: !!hint, migrationMessage: hint?.message || 'Run migration 030_scorebook.sql.',
    })
  }
}

// ---------------------------------------------------------------------------
// POST — record one event
//
// The client sends the after-state because the coach may have moved runners
// off the defaults, and what they decided is what happened. It also sends the
// seq it based that on: if the book has moved since, this is a double-tap or a
// second phone, and it is refused rather than written twice.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { gameId, kind, result, expectedSeq } = body
    if (!gameId || !result) {
      return NextResponse.json({ error: 'gameId and result are required' }, { status: 400 })
    }

    const { data: game } = await supabaseAdmin
      .from('games')
      .select('id, is_home, current_inning, current_half, scorebook_started_at')
      .eq('id', gameId)
      .maybeSingle()
    if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    const isHome = (game as any).is_home !== false

    const { data: rows, error: readErr } = await supabaseAdmin
      .from('game_events').select('*').eq('game_id', gameId).order('seq')
    if (readErr) throw readErr

    const all = rows || []
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : 0

    // The guard. A coach tapping "single" twice because the first tap didn't
    // look like it registered should not put two runners on first.
    if (typeof expectedSeq === 'number' && expectedSeq !== lastSeq) {
      return NextResponse.json(
        { error: 'The book moved since you started this one. Reloading.', stale: true, lastSeq },
        { status: 409 }
      )
    }

    const cursor = {
      inning: (game as any).current_inning || 1,
      half: ((game as any).current_half as Half) || 'top',
    }
    const before = stateFrom(all, isHome, cursor)
    const weBatting = weAreBatting(before.half, isHome)

    const outsAfter = Math.max(0, Math.min(3, Number(body.outsAfter ?? before.outs)))
    const basesAfter = asBases(body.basesAfter)
    const scored = asRunners(body.scored)
    const pitches = Math.max(0, Number(body.pitches || 0))

    const row = {
      game_id: gameId,
      seq: lastSeq + 1,
      kind: kind === 'base' ? 'base' : 'pa',
      inning: before.inning,
      half: before.half,
      we_batting: weBatting,
      result: String(result),
      scoring: body.scoring || null,
      batter_team_player_id: weBatting ? body.batterTeamPlayerId || null : null,
      opponent_slot: weBatting ? null : body.opponentSlot || null,
      opponent_name: weBatting ? null : body.opponentName?.trim() || null,
      pitcher_player_id: weBatting ? null : body.pitcherPlayerId || null,
      balls: Math.max(0, Number(body.balls || 0)),
      strikes: Math.max(0, Number(body.strikes || 0)),
      pitches,
      rbi: Math.max(0, Number(body.rbi || 0)),
      outs_before: before.outs,
      outs_after: outsAfter,
      bases_before: before.bases as any,
      bases_after: basesAfter as any,
      runs_scored: scored as any,
      adjusted: !!body.adjusted,
      note: body.note?.trim() || null,
    }

    const { error: insErr } = await supabaseAdmin.from('game_events').insert(row)
    if (insErr) throw insErr

    // Pitches counted here are the SAME pitches the pitch panel counts. They
    // go to the same table rather than a second one that would eventually
    // disagree with it — and disagreeing about a pitch count is not a display
    // bug, it is a kid's elbow.
    if (!weBatting && row.pitcher_player_id && pitches > 0) {
      const { data: existing } = await supabaseAdmin
        .from('game_pitch_counts')
        .select('id, pitch_count')
        .eq('game_id', gameId)
        .eq('player_id', row.pitcher_player_id)
        .eq('inning', before.inning)
        .maybeSingle()

      if (existing) {
        await supabaseAdmin
          .from('game_pitch_counts')
          .update({ pitch_count: ((existing as any).pitch_count || 0) + pitches })
          .eq('id', (existing as any).id)
      } else {
        await supabaseAdmin.from('game_pitch_counts').insert({
          game_id: gameId,
          player_id: row.pitcher_player_id,
          inning: before.inning,
          pitch_count: pitches,
        })
      }
    }

    // Keep the game in step: the score, and the inning that pitch counts and
    // notes key off elsewhere in Game Day.
    // The book moves the shared cursor when it is being kept, so the pitch
    // panel and the lineup follow it without the coach touching anything. When
    // it is not being kept, the manual control owns the cursor and this never
    // runs.
    const after = stateFrom([...all, row], isHome, cursor)
    const patch: Record<string, any> = {
      team_score: isHome ? after.homeRuns : after.awayRuns,
      opponent_score: isHome ? after.awayRuns : after.homeRuns,
      current_inning: after.inning,
      current_half: after.half,
    }
    if (!(game as any).scorebook_started_at) patch.scorebook_started_at = new Date().toISOString()
    await supabaseAdmin.from('games').update(patch).eq('id', gameId)

    return NextResponse.json({ success: true, seq: row.seq, state: after })
  } catch (error: any) {
    console.error('Scorebook POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not record that' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// PATCH — which dugout we're in
//
// Getting this wrong flips which half we bat, so it is fixable from the book
// itself rather than only in the game setup a coach filled in an hour ago.
// The events already store we_batting as it was, so correcting it changes what
// happens next without rewriting what already happened.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    const { gameId, isHome } = await request.json()
    if (!gameId || typeof isHome !== 'boolean') {
      return NextResponse.json({ error: 'gameId and isHome are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('games').update({ is_home: isHome }).eq('id', gameId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Scorebook PATCH error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not change that' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// DELETE ?gameId= — undo the last event
//
// One tap, no replay: the row before it already holds the state to go back to.
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 })

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('game_events').select('*').eq('game_id', gameId).order('seq')
    if (error) throw error

    const all = rows || []
    if (all.length === 0) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 })

    const last = all[all.length - 1] as any
    const { error: delErr } = await supabaseAdmin.from('game_events').delete().eq('id', last.id)
    if (delErr) throw delErr

    // Give the pitches back too, or undoing a strikeout would leave five
    // phantom pitches on a kid's arm for the rest of the day.
    if (!last.we_batting && last.pitcher_player_id && last.pitches > 0) {
      const { data: pc } = await supabaseAdmin
        .from('game_pitch_counts')
        .select('id, pitch_count')
        .eq('game_id', gameId)
        .eq('player_id', last.pitcher_player_id)
        .eq('inning', last.inning)
        .maybeSingle()
      if (pc) {
        await supabaseAdmin
          .from('game_pitch_counts')
          .update({ pitch_count: Math.max(0, ((pc as any).pitch_count || 0) - last.pitches) })
          .eq('id', (pc as any).id)
      }
    }

    const { data: game } = await supabaseAdmin
      .from('games').select('is_home').eq('id', gameId).maybeSingle()
    const isHome = (game as any)?.is_home !== false
    const rest = all.slice(0, -1)
    // Undoing back past the first event hands the cursor back to where the
    // undone event happened, not to the top of the first.
    const state = stateFrom(rest, isHome, { inning: last.inning, half: last.half as Half })

    await supabaseAdmin.from('games').update({
      team_score: isHome ? state.homeRuns : state.awayRuns,
      opponent_score: isHome ? state.awayRuns : state.homeRuns,
      current_inning: state.inning,
      current_half: state.half,
    }).eq('id', gameId)

    return NextResponse.json({ success: true, state })
  } catch (error: any) {
    console.error('Scorebook DELETE error:', error)
    return NextResponse.json({ error: error.message || 'Could not undo that' }, { status: 500 })
  }
}
