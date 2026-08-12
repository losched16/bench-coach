import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { textFrom } from '@/lib/claudeText'
import { COACH_VOICE } from '@/lib/coachVoice'
import {
  buildFieldingPlan, validateFieldingPlan, battingSlots,
  LineupPlayer, LineupMode, Strategy, positionsFor,
} from '@/lib/lineup'
import { guard } from '@/lib/authz'
import { claude as anthropic, describeClaudeFailure, logClaudeFailure } from '@/lib/claudeClient'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Two different problems, solved two different ways.
//
// FIELDING is a constraint problem: every player accounted for every inning,
// nobody at two positions, key positions only to flagged players, innings
// balanced (or deliberately not, in competitive mode). That belongs in code,
// where the constraints hold. It used to be a model call whose prompt ended in
// a list of pleadings, and a model satisfies constraints usually, not always.
//
// THE BATTING ORDER is judgment, and it is where the value actually is. It
// used to be built from a subjective 1-5 hitting rating and nothing else. Now
// it gets on-base numbers, recent form, what the coach wrote down during the
// game, and the opposing pitcher when we've scouted them.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const body = await request.json()
    const {
      teamId, innings = 6, pitchingType = 'coach_pitch', fieldPositions = 10,
      everyoneBats, lineupMode, strategy, dhPlayerId, unavailableIds,
      opponent, gameDate,
      // Set when the lineup is being built for a known game, which is what
      // makes tonight-only eligibility possible.
      gameId,
    } = body

    if (!teamId) return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })

    // Older clients send everyoneBats; newer ones send lineupMode.
    const mode: LineupMode = (['continuous', 'fixed_9', 'fixed_10'] as const).includes(lineupMode)
      ? lineupMode
      : everyoneBats === false ? 'fixed_9' : 'continuous'
    const needsPitcher = pitchingType === 'live_pitch' || pitchingType === 'player_pitch'

    // ── Team + roster ──
    const { data: team } = await supabaseAdmin
      .from('teams').select('*, season:seasons(name, league_type)').eq('id', teamId).single()
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    // The team's saved default is the starting point; an explicit choice for
    // this game wins. A rec team in a tournament should be able to switch for
    // the day without changing what the team is.
    const strat: Strategy = strategy === 'competitive' || strategy === 'development'
      ? strategy
      : ((team as any).default_strategy === 'competitive' ? 'competitive' : 'development')

    const { data: roster } = await supabaseAdmin
      .from('team_players')
      .select('*, player:players(id, name, jersey_number)')
      .eq('team_id', teamId)

    if (!roster || roster.length === 0) {
      return NextResponse.json({ error: 'No players on roster' }, { status: 400 })
    }

    const playerIds = roster.map((r: any) => r.id)
    const out = new Set<string>(Array.isArray(unavailableIds) ? unavailableIds : [])

    // ── Eligibility + position history ──
    //
    // The team setting is the standing answer. A row in game_position_
    // eligibility overrides it for THIS game only — which is how a coach tries
    // a kid at catcher for one week without promising he catches from now on.
    const [{ data: eligData }, gameElig] = await Promise.all([
      supabaseAdmin
        .from('position_eligibility')
        .select('team_player_id, position, eligible')
        .in('team_player_id', playerIds),
      gameId
        ? supabaseAdmin
            .from('game_position_eligibility')
            .select('team_player_id, position, eligible')
            .eq('game_id', gameId)
        // Not scoped to a game, or the override table isn't there yet. Either
        // way the team setting alone is a correct answer, so this never fails
        // the lineup.
        : Promise.resolve({ data: [] as any[] }),
    ])

    const eligible: Record<string, Record<string, boolean>> = {}
    for (const e of (eligData || []) as any[]) {
      ;(eligible[e.team_player_id] ||= {})[e.position] = !!e.eligible
    }
    for (const e of ((gameElig as any)?.data || []) as any[]) {
      ;(eligible[e.team_player_id] ||= {})[e.position] = !!e.eligible
    }

    const eligibilityMap: Record<string, string[]> = {}
    for (const [tp, positions] of Object.entries(eligible)) {
      for (const [pos, ok] of Object.entries(positions)) {
        if (ok) (eligibilityMap[tp] ||= []).push(pos)
      }
    }

    const { data: pastLineups } = await supabaseAdmin
      .from('game_lineups').select('id').eq('team_id', teamId)
      .order('game_date', { ascending: false }).limit(5)

    const positionHistory: Record<string, Record<string, number>> = {}
    if (pastLineups && pastLineups.length > 0) {
      const { data: assignments } = await supabaseAdmin
        .from('lineup_assignments')
        .select('team_player_id, position')
        .in('game_lineup_id', pastLineups.map((l: any) => l.id))
      for (const a of (assignments || []) as any[]) {
        if (!a.position) continue
        const h = (positionHistory[a.team_player_id] ||= {})
        h[a.position] = (h[a.position] || 0) + 1
      }
    }

    const players: LineupPlayer[] = roster.map((r: any) => ({
      id: r.id,
      name: r.player?.name || 'Unknown',
      jersey_number: r.player?.jersey_number ?? null,
      hitting_level: r.hitting_level,
      throwing_level: r.throwing_level,
      fielding_level: r.fielding_level,
      pitching_level: r.pitching_level,
      eligiblePositions: eligibilityMap[r.id] || [],
      positionHistory: positionHistory[r.id] || {},
      // Rules the coach set once on the roster. Columns may not exist yet if
      // migration 027 hasn't been applied — undefined reads as "no constraint"
      // in the solver, so the builder keeps working either way.
      lockedPosition: r.locked_position ?? null,
      excludedPositions: r.excluded_positions || [],
      minInnings: r.min_innings ?? null,
      maxInnings: r.max_innings ?? null,
      out: out.has(r.id),
    }))

    const availablePlayers = players.filter(p => !p.out)
    if (availablePlayers.length === 0) {
      return NextResponse.json({ error: 'Everyone is marked unavailable' }, { status: 400 })
    }

    // ── The batting order: the part that is actually judgment ──
    const evidence = await gatherHittingEvidence(teamId, playerIds, opponent)
    const slots = battingSlots(mode, availablePlayers.length)
    const order = await buildBattingOrder(
      availablePlayers, evidence, {
        slots, mode, strategy: strat, team, opponent, gameDate,
      }
    )

    // ── The fielding plan: solved, then checked ──
    const orderedIds = order.batting_order.map(o => o.team_player_id)
    const plan = buildFieldingPlan(players, {
      innings,
      fieldPositions,
      strategy: strat,
      lineupMode: mode,
      battingOrderIds: orderedIds,
      dhPlayerId: mode === 'fixed_10' ? dhPlayerId || null : null,
      needsPitcher,
    })

    // Belt and braces: the reason this moved out of the model is that invalid
    // plans reached coaches. Catch it here rather than at the fence.
    const errors = validateFieldingPlan(plan, players, {
      innings, fieldPositions, strategy: strat, lineupMode: mode,
      // "Everyone plays at least one inning" lives on the team so it is said
      // once. A player's own minimum overrides it.
      minInningsAll: (team as any).min_innings_all ?? undefined,
      dhPlayerId: mode === 'fixed_10' ? dhPlayerId || null : null,
      needsPitcher,
    })
    if (errors.length > 0) {
      console.error('Fielding plan failed validation:', errors)
    }

    return NextResponse.json({
      batting_order: order.batting_order,
      field_assignments: plan.field_assignments,
      bench_by_inning: plan.bench_by_inning,
      innings_by_player: plan.innings_by_player,
      notes: order.notes,
      reasoning: order.reasoning,
      warnings: [...plan.warnings, ...errors],
      meta: {
        mode, strategy: strat, slots,
        positions: positionsFor(fieldPositions, needsPitcher),
        evidence_used: evidence.summary,
      },
    })
  } catch (error: any) {
    console.error('Lineup API error:', error)
    // An upstream failure is not the coach's fault and must not reach
    // them as a raw body — on an Anthropic APIError, error.message IS
    // the JSON response.
    const upstream = describeClaudeFailure(error)
    if (upstream) {
      logClaudeFailure('lineup', error)
      return NextResponse.json(
        { error: upstream.message, retryable: upstream.retryable },
        { status: upstream.status }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Failed to generate lineup' },
      { status: 500 }
    )
  }
}

// --- evidence ---------------------------------------------------------------
// A 1-to-5 rating typed in during setup is the weakest possible input to a
// batting order. Everything here is stronger than that.

interface HittingEvidence {
  byPlayer: Record<string, string[]>
  opponentPitching: string | null
  summary: string[]
}

async function gatherHittingEvidence(
  teamId: string,
  teamPlayerIds: string[],
  opponent?: string | null
): Promise<HittingEvidence> {
  const byPlayer: Record<string, string[]> = {}
  const summary: string[] = []

  // Season line — on-base is what a batting order is actually built on
  try {
    const { data: season } = await supabaseAdmin
      .from('player_season_batting')
      .select('team_player_id, games_played, total_ab, total_hits, total_walks, total_strikeouts, total_sb, batting_avg, obp, slg')
      .in('team_player_id', teamPlayerIds)

    for (const s of (season || []) as any[]) {
      const pa = (s.total_ab || 0) + (s.total_walks || 0)
      const line = `season: ${s.total_hits || 0}-for-${s.total_ab || 0}` +
        ` (AVG ${Number(s.batting_avg || 0).toFixed(3)}, OBP ${Number(s.obp || 0).toFixed(3)}, SLG ${Number(s.slg || 0).toFixed(3)})` +
        `, ${s.total_walks || 0}BB ${s.total_strikeouts || 0}K, ${s.total_sb || 0}SB` +
        (pa < 15 ? ` — only ~${pa} PA, treat as an observation not a tendency` : '')
      ;(byPlayer[s.team_player_id] ||= []).push(line)
    }
    if ((season || []).length > 0) summary.push('season stats')
  } catch { /* stats optional */ }

  // Recent form — a hot week matters more than a season average at this age
  try {
    const { data: recent } = await supabaseAdmin
      .from('player_game_stats')
      .select('team_player_id, hits, at_bats, walks, strikeouts, game:games(game_date)')
      .in('team_player_id', teamPlayerIds)
      .order('created_at', { ascending: false })
      .limit(120)

    const recentByPlayer: Record<string, any[]> = {}
    for (const g of (recent || []) as any[]) {
      const list = (recentByPlayer[g.team_player_id] ||= [])
      if (list.length < 4) list.push(g)
    }
    for (const [id, games] of Object.entries(recentByPlayer)) {
      const h = games.reduce((s, g) => s + (g.hits || 0), 0)
      const ab = games.reduce((s, g) => s + (g.at_bats || 0), 0)
      const bb = games.reduce((s, g) => s + (g.walks || 0), 0)
      const k = games.reduce((s, g) => s + (g.strikeouts || 0), 0)
      ;(byPlayer[id] ||= []).push(`last ${games.length} games: ${h}-for-${ab}, ${bb}BB ${k}K`)
    }
    if (Object.keys(recentByPlayer).length > 0) summary.push('recent form')
  } catch { /* optional */ }

  // What the coach actually saw — including notes tapped out mid-game, which
  // outrank the box score and are the only place "hit it hard right at
  // somebody" ever gets recorded.
  try {
    const { data: obs } = await supabaseAdmin
      .from('observations')
      .select('player_id, body, prompt_key, observed_on')
      .eq('team_id', teamId)
      .order('observed_on', { ascending: false })
      .limit(60)

    const { data: linkRows } = await supabaseAdmin
      .from('team_players')
      .select('id, player_id')
      .in('id', teamPlayerIds)

    const byPlayerId: Record<string, string> = {}
    for (const l of (linkRows || []) as any[]) byPlayerId[l.player_id] = l.id

    let used = 0
    for (const o of (obs || []) as any[]) {
      const tpId = byPlayerId[o.player_id]
      if (!tpId) continue
      const list = (byPlayer[tpId] ||= [])
      if (list.filter(x => x.startsWith('coach saw')).length >= 3) continue
      const live = String(o.prompt_key || '').startsWith('in_game_')
      list.push(`coach saw${live ? ' (live, during a game)' : ''} ${o.observed_on}: ${o.body}`)
      used++
    }
    if (used > 0) summary.push('coach observations')
  } catch { /* optional */ }

  // The opposing pitcher, if we've logged them. Nobody else has this.
  let opponentPitching: string | null = null
  if (opponent?.trim()) {
    try {
      const { data: oppTeam } = await supabaseAdmin
        .from('opponent_teams').select('id, name').ilike('name', opponent.trim()).maybeSingle()

      if (oppTeam) {
        const { data: oppPlayers } = await supabaseAdmin
          .from('opponent_players')
          .select('id, name, jersey_number, throws, notes, positions')
          .eq('opponent_team_id', (oppTeam as any).id)

        const pitchers = (oppPlayers || []).filter((p: any) =>
          (p.positions || []).includes('P') || p.notes?.toLowerCase().includes('pitch'))

        if (pitchers.length > 0) {
          opponentPitching = pitchers.map((p: any) =>
            `${p.name}${p.jersey_number ? ` (#${p.jersey_number})` : ''}` +
            `${p.throws ? ` throws ${p.throws}` : ''}${p.notes ? ` — ${p.notes}` : ''}`
          ).join('\n')
          summary.push('scouted opposing pitchers')
        }
      }
    } catch { /* optional */ }
  }

  return { byPlayer, opponentPitching, summary }
}

// --- the order --------------------------------------------------------------

interface OrderResult {
  batting_order: Array<{ team_player_id: string; name: string; order: number }>
  notes: string
  reasoning: string
}

async function buildBattingOrder(
  players: LineupPlayer[],
  evidence: HittingEvidence,
  opts: {
    slots: number
    mode: LineupMode
    strategy: Strategy
    team: any
    opponent?: string | null
    gameDate?: string | null
  }
): Promise<OrderResult> {
  // Rating-only fallback, used if the model is unavailable or returns junk.
  // Never leaves the coach without a lineup.
  const fallback = (): OrderResult => ({
    batting_order: [...players]
      .sort((a, b) => (b.hitting_level || 0) - (a.hitting_level || 0))
      .slice(0, opts.slots)
      .map((p, i) => ({ team_player_id: p.id, name: p.name, order: i + 1 })),
    notes: 'Ordered by your hitting ratings.',
    reasoning: '',
  })

  if (!process.env.ANTHROPIC_API_KEY) return fallback()

  const roster = players.map(p =>
    `- ${p.name} (#${p.jersey_number || '?'}) [ID: ${p.id}]\n` +
    `    your ratings — hit ${p.hitting_level || '?'}/5, run/field ${p.fielding_level || '?'}/5\n` +
    (evidence.byPlayer[p.id]?.length
      ? evidence.byPlayer[p.id].map(l => `    ${l}`).join('\n')
      : '    no game data logged yet')
  ).join('\n')

  const system = `${COACH_VOICE}

WHAT THIS SURFACE IS

You are setting a batting order. The output is JSON, but the standard above still governs the reasoning you write — name the actual reason, not "he's a good hitter".

HOW A BATTING ORDER IS ACTUALLY BUILT

On-base ability at the top, because the top of the order gets the most plate appearances and every runner in front of your best contact hitters is a run. Strikeout rate matters more than average at this age — a ball in play is an error waiting to happen. Speed matters where it can be used, not as a headline.

Weigh the evidence in the order you always do: what the coach saw outranks the box score, and a small sample is an observation, not a tendency. Twelve at-bats is twelve at-bats — if that is all you have, say so and lean on the coach's ratings rather than pretending the numbers mean something.

${opts.strategy === 'competitive'
  ? 'This is a game they are trying to win. Build the order that scores the most runs.'
  : 'This is a development context. Build a sensible order, but do not bury a kid at the bottom every week — say so if you are rotating someone up.'}`

  const prompt = `Set the batting order for ${opts.team.name}${opts.team.age_group ? ` (${opts.team.age_group}` : ''}${opts.team.season?.league_type ? `, ${opts.team.season.league_type}` : ''}${opts.team.age_group ? ')' : ''}${opts.opponent ? ` vs ${opts.opponent}` : ''}${opts.gameDate ? ` on ${opts.gameDate}` : ''}.

${opts.mode === 'continuous'
  ? `Everyone bats — a continuous order of all ${players.length} available players. Nobody is left out; the question is purely the sequence.`
  : `${opts.slots} batters only. Choosing WHO IS IN THE ORDER is part of the job and matters more than the sequence — say who you left out and why, in one line, without being unkind about a child.`}

AVAILABLE PLAYERS:
${roster}

${evidence.opponentPitching ? `THE PITCHER(S) YOU'RE LIKELY TO SEE (from your own scouting):
${evidence.opponentPitching}

Use this if it changes anything — a hard thrower argues for your short-swing contact hitters up top; someone who walks people argues for patience at the top. If it does not change anything, ignore it rather than inventing a reason.
` : ''}
Return ONLY JSON, no markdown fences:
{
  "batting_order": [{"team_player_id": "uuid", "name": "Name", "order": 1}],
  "notes": "One or two sentences a coach could read on the way to the field.",
  "reasoning": "Two to four sentences on the decisions that were not obvious — why this player at the top, why someone moved, what you'd change if the first two innings go badly. Name the evidence you used. If the data is too thin to justify much, say that plainly instead of inventing analysis."
}`

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: 'low' },
    })

    const text = textFrom(res)
    if (!text) return fallback()

    const match = text.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)
    if (!match) return fallback()

    const parsed = JSON.parse(match[0]) as Partial<OrderResult>
    const valid = new Map(players.map(p => [p.id, p]))

    const order = (parsed.batting_order || [])
      .filter(o => valid.has(o.team_player_id))
      .slice(0, opts.slots)
      .map((o, i) => ({
        team_player_id: o.team_player_id,
        name: valid.get(o.team_player_id)!.name,
        order: i + 1,
      }))

    // A continuous order that dropped somebody is a bug the coach would only
    // find at the plate. Append anyone missing rather than shipping it.
    if (opts.mode === 'continuous' && order.length < players.length) {
      const included = new Set(order.map(o => o.team_player_id))
      for (const p of players) {
        if (!included.has(p.id)) {
          order.push({ team_player_id: p.id, name: p.name, order: order.length + 1 })
        }
      }
    }

    if (order.length === 0) return fallback()

    return {
      batting_order: order,
      notes: parsed.notes || '',
      reasoning: parsed.reasoning || '',
    }
  } catch (e: any) {
    console.warn('Batting order generation failed, using ratings:', e?.message)
    return fallback()
  }
}
