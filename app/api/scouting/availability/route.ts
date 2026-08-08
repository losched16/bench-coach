import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  computePitcherAvailability,
  PitchCountRuleSet,
  daysBetween,
} from '@/lib/scouting'
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

// The availability board: for each known pitcher, last appearance, pitches
// thrown, rest status, and projected availability for a target game date.
// Works for a scouted opponent (from opponent_appearances) or the coach's
// own team (from its existing game data — no re-entry).
//
// Everything here is deduction from box scores the tournament already
// published. Coverage is only as good as what was logged, and the response
// says so explicitly instead of implying full coverage.

async function loadRuleSet(coachId: string, ruleId: string | null): Promise<PitchCountRuleSet | null> {
  if (ruleId) {
    const { data } = await supabaseAdmin
      .from('pitch_count_rules')
      .select('*')
      .eq('id', ruleId)
      .single()
    if (data && (data.coach_id === null || data.coach_id === coachId)) {
      return data as PitchCountRuleSet
    }
    return null
  }
  // Default: first system rule set (Little League 11-12 is the most common)
  const { data } = await supabaseAdmin
    .from('pitch_count_rules')
    .select('*')
    .is('coach_id', null)
    .eq('sanctioning_body', 'Little League')
    .eq('age_group', '11-12')
    .single()
  return (data as PitchCountRuleSet) || null
}

export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const opponentTeamId = searchParams.get('opponentTeamId')
  const ownTeamId = searchParams.get('ownTeamId')
  const targetDate = searchParams.get('date') || new Date().toISOString().split('T')[0]
  const ruleId = searchParams.get('ruleId')

  if (!coachId || (!opponentTeamId && !ownTeamId)) {
    return NextResponse.json(
      { error: 'coachId and opponentTeamId or ownTeamId required' },
      { status: 400 }
    )
  }

  try {
    const ruleSet = await loadRuleSet(coachId, ruleId)
    if (!ruleSet) {
      return NextResponse.json(
        { error: 'No pitch count rule set found. Apply migration 010 to seed defaults.' },
        { status: 404 }
      )
    }

    // Rows: { player: {...}, appearances: [{game_date, pitches_thrown}] }
    let pitcherRows: Array<{
      id: string
      name: string
      jersey_number: string | null
      confidence: string
      appearances: Array<{ game_date: string; pitches_thrown: number | null }>
    }> = []
    let loggedGameDates: string[] = []
    let nonPitcherCount = 0

    if (opponentTeamId) {
      const { data: players } = await supabaseAdmin
        .from('opponent_players')
        .select('id, name, jersey_number, confidence, appearances:opponent_appearances(game_date, pitches_thrown)')
        .eq('opponent_team_id', opponentTeamId)

      const all = players || []
      const dateSet = new Set<string>()
      all.forEach((p: any) =>
        (p.appearances || []).forEach((a: any) => a.game_date && dateSet.add(a.game_date))
      )
      loggedGameDates = Array.from(dateSet).sort()

      pitcherRows = all
        .filter((p: any) => (p.appearances || []).some((a: any) => (a.pitches_thrown || 0) > 0))
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          jersey_number: p.jersey_number,
          confidence: p.confidence,
          appearances: p.appearances || [],
        }))
      nonPitcherCount = all.length - pitcherRows.length
    } else if (ownTeamId) {
      // Own team, same lens: aggregate pitch data already logged in Stats
      // (player_game_stats.pitches_thrown) and Game Day (game_pitch_counts)
      const { data: games } = await supabaseAdmin
        .from('games')
        .select('id, game_date')
        .eq('team_id', ownTeamId)

      const gameDateById: Record<string, string> = {}
      ;(games || []).forEach((g: any) => {
        gameDateById[g.id] = g.game_date
      })
      const gameIds = Object.keys(gameDateById)
      loggedGameDates = Array.from(new Set(Object.values(gameDateById))).sort()

      // pitches per player per game, from both sources; a game logged in
      // both Stats and Game Day counts once (take the larger figure)
      const statsByPlayerGame: Record<string, Record<string, number>> = {}
      const liveByPlayerGame: Record<string, Record<string, number>> = {}
      const jerseyByPlayer: Record<string, string | null> = {}

      if (gameIds.length > 0) {
        const [statsRes, liveRes] = await Promise.all([
          supabaseAdmin
            .from('player_game_stats')
            .select('game_id, pitches_thrown, team_player:team_players(player:players(name, jersey_number))')
            .in('game_id', gameIds)
            .gt('pitches_thrown', 0),
          supabaseAdmin
            .from('game_pitch_counts')
            .select('game_id, pitch_count, player:players(name, jersey_number)')
            .in('game_id', gameIds),
        ])

        for (const s of statsRes.data || []) {
          const player = (s.team_player as any)?.player
          if (!player?.name || !gameDateById[s.game_id]) continue
          jerseyByPlayer[player.name] = player.jersey_number
          if (!statsByPlayerGame[player.name]) statsByPlayerGame[player.name] = {}
          statsByPlayerGame[player.name][s.game_id] =
            (statsByPlayerGame[player.name][s.game_id] || 0) + (s.pitches_thrown || 0)
        }
        for (const pc of liveRes.data || []) {
          const player = pc.player as any
          if (!player?.name || !gameDateById[pc.game_id]) continue
          jerseyByPlayer[player.name] = jerseyByPlayer[player.name] ?? player.jersey_number
          if (!liveByPlayerGame[player.name]) liveByPlayerGame[player.name] = {}
          liveByPlayerGame[player.name][pc.game_id] =
            (liveByPlayerGame[player.name][pc.game_id] || 0) + (pc.pitch_count || 0)
        }
      }

      const playerNames = Array.from(
        new Set([...Object.keys(statsByPlayerGame), ...Object.keys(liveByPlayerGame)])
      )
      pitcherRows = playerNames.map((name, i) => {
        const byDate: Record<string, number> = {}
        const gameIdsForPlayer = new Set([
          ...Object.keys(statsByPlayerGame[name] || {}),
          ...Object.keys(liveByPlayerGame[name] || {}),
        ])
        gameIdsForPlayer.forEach(gid => {
          const date = gameDateById[gid]
          const perGame = Math.max(
            statsByPlayerGame[name]?.[gid] || 0,
            liveByPlayerGame[name]?.[gid] || 0
          )
          byDate[date] = (byDate[date] || 0) + perGame
        })
        return {
          id: `own-${i}`,
          name,
          jersey_number: jerseyByPlayer[name] || null,
          confidence: 'confirmed',
          appearances: Object.entries(byDate).map(([game_date, pitches_thrown]) => ({
            game_date,
            pitches_thrown,
          })),
        }
      })
    }

    const board = pitcherRows
      .map(row => ({
        player: {
          id: row.id,
          name: row.name,
          jersey_number: row.jersey_number,
          identity_confidence: row.confidence,
        },
        availability: computePitcherAvailability(row.appearances, ruleSet, targetDate),
      }))
      .sort((a, b) => {
        const order: Record<string, number> = { ineligible: 0, limited: 1, available: 2, unknown: 3 }
        return (order[a.availability.status] ?? 9) - (order[b.availability.status] ?? 9)
      })

    // State coverage honestly: if the last logged game is old, or few games
    // are logged, the picture is incomplete — say so rather than implying
    // full coverage.
    const lastLogged = loggedGameDates[loggedGameDates.length - 1] || null
    const coverageNotes: string[] = []
    coverageNotes.push(
      `Based on ${loggedGameDates.length} logged game${loggedGameDates.length === 1 ? '' : 's'}. Games that were not logged are NOT counted — a pitcher shown as available may have thrown in an unlogged game.`
    )
    if (lastLogged && daysBetween(lastLogged, targetDate) > 2) {
      coverageNotes.push(
        `Most recent logged game is ${lastLogged} (${daysBetween(lastLogged, targetDate)} days before the target date). Any appearances since then are missing from this picture.`
      )
    }
    if (nonPitcherCount > 0) {
      coverageNotes.push(
        `${nonPitcherCount} known player${nonPitcherCount === 1 ? ' has' : 's have'} never been logged pitching — any of them could still take the mound.`
      )
    }

    return NextResponse.json({
      targetDate,
      ruleSet: {
        id: ruleSet.id,
        sanctioning_body: ruleSet.sanctioning_body,
        age_group: ruleSet.age_group,
        daily_max: ruleSet.daily_max,
        thresholds: ruleSet.thresholds,
      },
      board,
      coverage: {
        logged_game_count: loggedGameDates.length,
        last_logged_game: lastLogged,
        notes: coverageNotes,
      },
    })
  } catch (error: any) {
    console.error('Availability GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
