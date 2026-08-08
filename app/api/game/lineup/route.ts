import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  SubRuleSet, DEFAULT_SUB_RULES, PlayerGameState,
  canEnter, canExit, canSwap, applyEntry, applyExit,
} from '@/lib/substitutions'
import { migrationHintFor } from '@/lib/migrationHints'

// The live lineup: who is in, who is where, and what a change would cost.
//
// Every legality decision comes from lib/substitutions — the same module the
// in-game assistant reasons from. If the button and the assistant ever
// disagreed about whether a swap is legal, the coach would be right to stop
// trusting both.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function loadState(gameId: string): Promise<{
  rules: SubRuleSet
  players: PlayerGameState[]
  positions: Record<number, Record<string, string>>
  inning: number
}> {
  const [{ data: game }, { data: rows }, { data: log }] = await Promise.all([
    supabaseAdmin.from('games').select('id, sub_rules, current_inning, lineup_locked_at').eq('id', gameId).maybeSingle(),
    supabaseAdmin
      .from('game_participation')
      .select('*, team_player:team_players(id, player:players(name, jersey_number))')
      .eq('game_id', gameId),
    supabaseAdmin.from('game_position_log').select('team_player_id, inning, position').eq('game_id', gameId),
  ])

  const players: PlayerGameState[] = (rows || []).map((r: any) => ({
    teamPlayerId: r.team_player_id,
    name: r.team_player?.player?.name || 'Unknown',
    isStarter: !!r.is_starter,
    battingSlot: r.batting_slot ?? null,
    isIn: !!r.is_in,
    timesRemoved: r.times_removed || 0,
    reentries: r.reentries || 0,
  }))

  // inning → { team_player_id → position }
  const positions: Record<number, Record<string, string>> = {}
  for (const l of (log || []) as any[]) {
    if (!l.position) continue
    ;(positions[l.inning] ||= {})[l.team_player_id] = l.position
  }

  return {
    rules: ((game as any)?.sub_rules as SubRuleSet) || DEFAULT_SUB_RULES,
    players,
    positions,
    inning: (game as any)?.current_inning || 1,
  }
}

// ---------------------------------------------------------------------------
// GET ?gameId= — the lineup, plus what each player is allowed to do next
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 })

  try {
    const { rules, players, positions, inning } = await loadState(gameId)

    return NextResponse.json({
      rules,
      inning,
      // Legality is computed here rather than in the browser so the answer
      // cannot drift from what the write path will accept.
      players: players.map(p => ({
        ...p,
        currentPosition: positions[inning]?.[p.teamPlayerId] ?? null,
        entry: canEnter(p, rules),
        exit: canExit(p, rules),
      })),
      positionsByInning: positions,
    })
  } catch (error: any) {
    console.error('Game lineup GET error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      rules: DEFAULT_SUB_RULES, inning: 1, players: [], positionsByInning: {},
      needsMigration: !!hint, migrationMessage: hint?.message || null,
    })
  }
}

// ---------------------------------------------------------------------------
// POST — set the starting lineup
//   { gameId, subRules?, starters: [{ teamPlayerId, battingSlot, position? }],
//     bench?: [teamPlayerId] }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { gameId, subRules, starters, bench } = await request.json()
    if (!gameId || !Array.isArray(starters)) {
      return NextResponse.json({ error: 'gameId and starters are required' }, { status: 400 })
    }

    if (subRules) {
      await supabaseAdmin.from('games').update({ sub_rules: subRules }).eq('id', gameId)
    }

    const rows = [
      ...starters.map((s: any, i: number) => ({
        game_id: gameId,
        team_player_id: s.teamPlayerId,
        is_starter: true,
        batting_slot: s.battingSlot ?? i + 1,
        is_in: true,
        times_removed: 0,
        reentries: 0,
      })),
      ...(Array.isArray(bench) ? bench : []).map((id: string) => ({
        game_id: gameId,
        team_player_id: id,
        is_starter: false,
        batting_slot: null,
        is_in: false,
        times_removed: 0,
        reentries: 0,
      })),
    ]

    const { error } = await supabaseAdmin
      .from('game_participation')
      .upsert(rows, { onConflict: 'game_id,team_player_id' })
    if (error) throw error

    // First-inning positions, where the starting card gave them.
    const posRows = starters
      .filter((s: any) => s.position)
      .map((s: any) => ({
        game_id: gameId,
        team_player_id: s.teamPlayerId,
        inning: 1,
        position: s.position,
      }))
    if (posRows.length > 0) {
      await supabaseAdmin
        .from('game_position_log')
        .upsert(posRows, { onConflict: 'game_id,team_player_id,inning' })
    }

    await supabaseAdmin
      .from('games')
      .update({ lineup_locked_at: new Date().toISOString() })
      .eq('id', gameId)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Game lineup POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not save the lineup' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// PATCH — a change during the game
//   { gameId, action: 'swap',     outId, inId }
//   { gameId, action: 'position', teamPlayerId, inning, position }
//   { gameId, action: 'enter'|'exit', teamPlayerId }
//   { ..., force: true } to override a refusal
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { gameId, action, force } = body
    if (!gameId || !action) {
      return NextResponse.json({ error: 'gameId and action are required' }, { status: 400 })
    }

    // Moving someone around the field is not a substitution and never needs a
    // rules check — in every ruleset a player already in the game can play
    // anywhere.
    if (action === 'position') {
      const { teamPlayerId, inning, position } = body
      if (!teamPlayerId || !inning) {
        return NextResponse.json({ error: 'teamPlayerId and inning are required' }, { status: 400 })
      }
      const { error } = await supabaseAdmin
        .from('game_position_log')
        .upsert(
          { game_id: gameId, team_player_id: teamPlayerId, inning, position: position || null },
          { onConflict: 'game_id,team_player_id,inning' }
        )
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    const { rules, players } = await loadState(gameId)
    const byId = new Map(players.map(p => [p.teamPlayerId, p]))

    const persist = async (p: PlayerGameState) => {
      const { error } = await supabaseAdmin
        .from('game_participation')
        .update({ is_in: p.isIn, times_removed: p.timesRemoved, reentries: p.reentries })
        .eq('game_id', gameId)
        .eq('team_player_id', p.teamPlayerId)
      if (error) throw error
    }

    if (action === 'swap') {
      const out = byId.get(body.outId)
      const incoming = byId.get(body.inId)
      if (!out || !incoming) {
        return NextResponse.json({ error: 'Both players must be on this game sheet' }, { status: 400 })
      }

      const verdict = canSwap(out, incoming, rules)
      // A refusal is returned as 409 with the reason, not swallowed. The coach
      // can still override — an umpire's ruling, an injury, a league quirk we
      // do not model — but they do it knowingly rather than by accident.
      if (!verdict.allowed && !force) {
        return NextResponse.json({ ...verdict, needsOverride: true }, { status: 409 })
      }

      await persist(applyExit(out, rules))
      await persist(applyEntry(incoming, rules))
      return NextResponse.json({ success: true, ...verdict, overridden: !verdict.allowed })
    }

    if (action === 'enter' || action === 'exit') {
      const p = byId.get(body.teamPlayerId)
      if (!p) return NextResponse.json({ error: 'Player is not on this game sheet' }, { status: 400 })

      const verdict = action === 'enter' ? canEnter(p, rules) : canExit(p, rules)
      if (!verdict.allowed && !force) {
        return NextResponse.json({ ...verdict, needsOverride: true }, { status: 409 })
      }

      await persist(action === 'enter' ? applyEntry(p, rules) : applyExit(p, rules))
      return NextResponse.json({ success: true, ...verdict, overridden: !verdict.allowed })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error('Game lineup PATCH error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not make that change' },
      { status: 500 }
    )
  }
}
