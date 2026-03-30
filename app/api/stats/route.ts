import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: Fetch games + stats for a team, or single game detail
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  const gameId = searchParams.get('gameId')
  const playerId = searchParams.get('playerId') // team_player_id for individual player stats
  const view = searchParams.get('view') // 'season' for season totals

  // Auth check
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Single game with all player stats
    if (gameId) {
      const { data: game, error: gameError } = await supabaseAdmin
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single()

      if (gameError) throw gameError

      const { data: stats, error: statsError } = await supabaseAdmin
        .from('player_game_stats')
        .select(`
          *,
          team_player:team_players(
            id,
            player:players(id, name, jersey_number)
          )
        `)
        .eq('game_id', gameId)

      if (statsError) throw statsError

      return NextResponse.json({ game, stats })
    }

    // Individual player season stats
    if (playerId && teamId) {
      // Get season totals from the view
      const { data: seasonStats, error: seasonError } = await supabaseAdmin
        .from('player_season_batting')
        .select('*')
        .eq('team_player_id', playerId)
        .single()

      // Get game-by-game log
      const { data: gameLog, error: logError } = await supabaseAdmin
        .from('player_game_stats')
        .select(`
          *,
          game:games(id, game_date, opponent, team_score, opponent_score, result, game_type)
        `)
        .eq('team_player_id', playerId)
        .order('game(game_date)', { ascending: false })

      // Get milestones
      const { data: player } = await supabaseAdmin
        .from('team_players')
        .select('player_id')
        .eq('id', playerId)
        .single()

      let milestones: any[] = []
      if (player) {
        const { data: ms } = await supabaseAdmin
          .from('player_milestones')
          .select('*')
          .eq('player_id', player.player_id)
          .eq('team_id', teamId)
          .order('achieved_at', { ascending: false })

        milestones = ms || []
      }

      return NextResponse.json({
        seasonStats: seasonStats || null,
        gameLog: gameLog || [],
        milestones
      })
    }

    // All games for a team
    if (teamId) {
      const { data: games, error } = await supabaseAdmin
        .from('games')
        .select('*')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false })

      if (error) throw error

      // Also get season leaderboard
      const { data: leaderboard } = await supabaseAdmin
        .from('player_season_batting')
        .select('*')
        .eq('team_id', teamId)
        .order('batting_avg', { ascending: false })

      return NextResponse.json({ games: games || [], leaderboard: leaderboard || [] })
    }

    return NextResponse.json({ error: 'teamId required' }, { status: 400 })

  } catch (error: any) {
    console.error('Stats API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Create a game + bulk player stats
export async function POST(request: NextRequest) {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { game, playerStats } = body

    // Create the game
    const { data: newGame, error: gameError } = await supabaseAdmin
      .from('games')
      .insert({
        team_id: game.team_id,
        game_date: game.game_date,
        opponent: game.opponent || null,
        home_away: game.home_away || null,
        team_score: game.team_score ?? null,
        opponent_score: game.opponent_score ?? null,
        result: game.result || null,
        game_type: game.game_type || 'regular',
        location: game.location || null,
        notes: game.notes || null,
      })
      .select()
      .single()

    if (gameError) throw gameError

    // Insert player stats (bulk)
    if (playerStats && playerStats.length > 0) {
      const statsToInsert = playerStats
        .filter((ps: any) => ps.team_player_id) // skip empty rows
        .map((ps: any) => ({
          game_id: newGame.id,
          team_player_id: ps.team_player_id,
          at_bats: ps.at_bats ?? null,
          hits: ps.hits ?? null,
          singles: ps.singles ?? null,
          doubles: ps.doubles ?? null,
          triples: ps.triples ?? null,
          home_runs: ps.home_runs ?? null,
          rbi: ps.rbi ?? null,
          runs: ps.runs ?? null,
          walks: ps.walks ?? null,
          strikeouts: ps.strikeouts ?? null,
          hbp: ps.hbp ?? null,
          sac: ps.sac ?? null,
          stolen_bases: ps.stolen_bases ?? null,
          caught_stealing: ps.caught_stealing ?? null,
          putouts: ps.putouts ?? null,
          assists: ps.assists ?? null,
          errors: ps.errors ?? null,
          fielding_innings: ps.fielding_innings ?? null,
          positions_played: ps.positions_played || null,
          innings_pitched: ps.innings_pitched ?? null,
          pitching_hits: ps.pitching_hits ?? null,
          pitching_runs: ps.pitching_runs ?? null,
          earned_runs: ps.earned_runs ?? null,
          pitching_strikeouts: ps.pitching_strikeouts ?? null,
          pitching_walks: ps.pitching_walks ?? null,
          pitching_hbp: ps.pitching_hbp ?? null,
          pitches_thrown: ps.pitches_thrown ?? null,
          game_notes: ps.game_notes || null,
        }))

      if (statsToInsert.length > 0) {
        const { error: statsError } = await supabaseAdmin
          .from('player_game_stats')
          .insert(statsToInsert)

        if (statsError) throw statsError
      }

      // Check for milestones after inserting stats
      await checkMilestones(newGame.id, game.team_id, statsToInsert)
    }

    return NextResponse.json({ game: newGame })

  } catch (error: any) {
    console.error('Stats POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PUT: Update game or player stats
export async function PUT(request: NextRequest) {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { game, playerStats } = body

    if (game && game.id) {
      const { error } = await supabaseAdmin
        .from('games')
        .update({
          game_date: game.game_date,
          opponent: game.opponent || null,
          home_away: game.home_away || null,
          team_score: game.team_score ?? null,
          opponent_score: game.opponent_score ?? null,
          result: game.result || null,
          game_type: game.game_type || 'regular',
          location: game.location || null,
          notes: game.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', game.id)

      if (error) throw error
    }

    if (playerStats && playerStats.length > 0) {
      for (const ps of playerStats) {
        const { error } = await supabaseAdmin
          .from('player_game_stats')
          .upsert({
            game_id: ps.game_id,
            team_player_id: ps.team_player_id,
            at_bats: ps.at_bats ?? null,
            hits: ps.hits ?? null,
            singles: ps.singles ?? null,
            doubles: ps.doubles ?? null,
            triples: ps.triples ?? null,
            home_runs: ps.home_runs ?? null,
            rbi: ps.rbi ?? null,
            runs: ps.runs ?? null,
            walks: ps.walks ?? null,
            strikeouts: ps.strikeouts ?? null,
            hbp: ps.hbp ?? null,
            sac: ps.sac ?? null,
            stolen_bases: ps.stolen_bases ?? null,
            caught_stealing: ps.caught_stealing ?? null,
            putouts: ps.putouts ?? null,
            assists: ps.assists ?? null,
            errors: ps.errors ?? null,
            fielding_innings: ps.fielding_innings ?? null,
            positions_played: ps.positions_played || null,
            innings_pitched: ps.innings_pitched ?? null,
            pitching_hits: ps.pitching_hits ?? null,
            pitching_runs: ps.pitching_runs ?? null,
            earned_runs: ps.earned_runs ?? null,
            pitching_strikeouts: ps.pitching_strikeouts ?? null,
            pitching_walks: ps.pitching_walks ?? null,
            pitching_hbp: ps.pitching_hbp ?? null,
            pitches_thrown: ps.pitches_thrown ?? null,
            game_notes: ps.game_notes || null,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'game_id,team_player_id'
          })

        if (error) throw error
      }
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Stats PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Remove a game (cascades to stats)
export async function DELETE(request: NextRequest) {
  const supabase = createServerComponentClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')

  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('games')
      .delete()
      .eq('id', gameId)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Stats DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Milestone Detection ──────────────────────────────

async function checkMilestones(gameId: string, teamId: string, playerStats: any[]) {
  for (const ps of playerStats) {
    const { data: tp } = await supabaseAdmin
      .from('team_players')
      .select('player_id, player:players(name)')
      .eq('id', ps.team_player_id)
      .single()

    if (!tp) continue
    const playerName = (tp.player as any)?.name || 'Player'
    const playerId = tp.player_id

    const { data: game } = await supabaseAdmin
      .from('games')
      .select('game_date, opponent')
      .eq('id', gameId)
      .single()

    const gameDate = game?.game_date || new Date().toISOString().split('T')[0]
    const opponent = game?.opponent || 'opponent'

    // Get all-time stats for this player on this team
    const { data: allStats } = await supabaseAdmin
      .from('player_game_stats')
      .select('*, game:games(game_date)')
      .eq('team_player_id', ps.team_player_id)
      .order('game(game_date)', { ascending: true })

    if (!allStats || allStats.length === 0) continue

    const totalGames = allStats.length
    const totalHits = allStats.reduce((s: number, g: any) => s + (g.hits || 0), 0)
    const totalABs = allStats.reduce((s: number, g: any) => s + (g.at_bats || 0), 0)
    const totalHR = allStats.reduce((s: number, g: any) => s + (g.home_runs || 0), 0)
    const totalSB = allStats.reduce((s: number, g: any) => s + (g.stolen_bases || 0), 0)

    const milestonesToInsert: any[] = []

    // First hit ever
    if (totalHits === (ps.hits || 0) && (ps.hits || 0) > 0) {
      milestonesToInsert.push({
        player_id: playerId, team_id: teamId, game_id: gameId,
        milestone_type: 'first_hit',
        title: 'First Hit!',
        description: `${playerName} got their first hit against ${opponent}!`,
        achieved_at: gameDate,
      })
    }

    // First home run
    if (totalHR === (ps.home_runs || 0) && (ps.home_runs || 0) > 0) {
      milestonesToInsert.push({
        player_id: playerId, team_id: teamId, game_id: gameId,
        milestone_type: 'first_hr',
        title: 'First Home Run!',
        description: `${playerName} crushed their first home run against ${opponent}!`,
        achieved_at: gameDate,
      })
    }

    // Multi-hit game (3+ hits)
    if ((ps.hits || 0) >= 3) {
      milestonesToInsert.push({
        player_id: playerId, team_id: teamId, game_id: gameId,
        milestone_type: 'multi_hit_game',
        title: `${ps.hits}-Hit Game!`,
        description: `${playerName} went ${ps.hits}-for-${ps.at_bats} against ${opponent}!`,
        stat_value: `${ps.hits}`,
        achieved_at: gameDate,
      })
    }

    // First stolen base
    if (totalSB === (ps.stolen_bases || 0) && (ps.stolen_bases || 0) > 0) {
      milestonesToInsert.push({
        player_id: playerId, team_id: teamId, game_id: gameId,
        milestone_type: 'first_sb',
        title: 'First Stolen Base!',
        description: `${playerName} swiped their first base against ${opponent}!`,
        achieved_at: gameDate,
      })
    }

    // Hitting streak detection (3+ games)
    if ((ps.hits || 0) > 0 && allStats.length >= 3) {
      let streak = 0
      for (let i = allStats.length - 1; i >= 0; i--) {
        if ((allStats[i].hits || 0) > 0) streak++
        else break
      }
      if (streak >= 3 && streak === Math.floor(streak)) { // only on exact milestones
        const existing = await supabaseAdmin
          .from('player_milestones')
          .select('id')
          .eq('player_id', playerId)
          .eq('team_id', teamId)
          .eq('milestone_type', 'hitting_streak')
          .eq('stat_value', `${streak}`)
          .maybeSingle()

        if (!existing?.data) {
          milestonesToInsert.push({
            player_id: playerId, team_id: teamId, game_id: gameId,
            milestone_type: 'hitting_streak',
            title: `${streak}-Game Hitting Streak!`,
            description: `${playerName} has a hit in ${streak} straight games!`,
            stat_value: `${streak}`,
            achieved_at: gameDate,
          })
        }
      }
    }

    // 10th, 25th, 50th, 100th at-bat milestones
    const abMilestones = [10, 25, 50, 100]
    for (const milestone of abMilestones) {
      const prevABs = totalABs - (ps.at_bats || 0)
      if (prevABs < milestone && totalABs >= milestone) {
        milestonesToInsert.push({
          player_id: playerId, team_id: teamId, game_id: gameId,
          milestone_type: 'career_ab_milestone',
          title: `${milestone}th At-Bat!`,
          description: `${playerName} reached ${milestone} career at-bats this season!`,
          stat_value: `${milestone}`,
          achieved_at: gameDate,
        })
      }
    }

    // Insert all milestones
    if (milestonesToInsert.length > 0) {
      await supabaseAdmin
        .from('player_milestones')
        .insert(milestonesToInsert)
    }
  }
}
