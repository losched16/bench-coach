import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateChatResponse, TeamContext, ScoutingContext } from '@/lib/anthropic'
import { assembleCoachContext, renderCoachContext } from '@/lib/coachContext'
import {
  aggregateBattingLines,
  computePitcherAvailability,
  stalenessLabel,
  stalenessOf,
  MIN_PA_FOR_TENDENCY,
  PitchCountRuleSet,
} from '@/lib/scouting'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Every other AI route got one of these and chat never did. The platform
// default is 15 seconds; a coach question that assembles context, reads the
// scouting data and then thinks before answering blows past that routinely,
// and the function is killed with no error the user can act on.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const { teamId, message, history } = await request.json()

    console.log('Chat API called with teamId:', teamId)

    if (!teamId || !message) {
      return NextResponse.json(
        { error: 'Missing teamId or message' },
        { status: 400 }
      )
    }

    // Check if Anthropic API key is set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set')
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      )
    }

    // Load team context
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (teamError) {
      console.error('Error loading team:', teamError)
      return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
    }

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    console.log('Loaded team:', team.name)

    // Load coach preferences
    const { data: preferences } = await supabaseAdmin
      .from('coach_preferences')
      .select('key, value')
      .eq('coach_id', team.coach_id)

    const coachPrefs: Record<string, string> = {}
    preferences?.forEach(p => {
      coachPrefs[p.key] = p.value
    })

    // Load team notes (pinned + recent)
    const { data: teamNotes } = await supabaseAdmin
      .from('team_notes')
      .select('note, pinned')
      .eq('team_id', teamId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    // Load team memory summary
    const { data: memorySummary } = await supabaseAdmin
      .from('team_memory_summaries')
      .select('summary')
      .eq('team_id', teamId)
      .single()

    // Load players (NO player_notes join - it breaks the query)
    const { data: teamPlayers } = await supabaseAdmin
      .from('team_players')
      .select(`
        *,
        player:players(id, name)
      `)
      .eq('team_id', teamId)

    // Load player journal entries (recent entries for each player)
    const { data: journalEntries } = await supabaseAdmin
      .from('player_journal_entries')
      .select(`
        id,
        player_id,
        session_date,
        session_type,
        duration_minutes,
        instructor_name,
        focus_areas,
        went_well,
        needs_work,
        home_drills,
        notes,
        skills,
        player:players(name)
      `)
      .eq('team_id', teamId)
      .order('session_date', { ascending: false })
      .limit(20) // Last 20 entries across all players

    // Group journal entries by player
    const journalByPlayer: Record<string, any[]> = {}
    journalEntries?.forEach(entry => {
      const playerName = (entry.player as any)?.name || 'Unknown'
      if (!journalByPlayer[playerName]) {
        journalByPlayer[playerName] = []
      }
      journalByPlayer[playerName].push(entry)
    })

    const players = teamPlayers?.map(tp => {
      const playerName = tp.player.name
      const playerJournal = journalByPlayer[playerName] || []
      
      return {
        name: playerName,
        positions: tp.positions || [],
        hitting_level: tp.hitting_level,
        throwing_level: tp.throwing_level,
        fielding_level: tp.fielding_level,
        pitching_level: tp.pitching_level,
        baserunning_level: tp.baserunning_level,
        coachability_level: tp.coachability_level,
        notes: [],
        journal: playerJournal.slice(0, 5).map((j: any) => ({
          date: j.session_date,
          type: j.session_type,
          instructor: j.instructor_name,
          focus: j.focus_areas,
          went_well: j.went_well,
          needs_work: j.needs_work,
          home_drills: j.home_drills,
          skills: j.skills,
        })),
      }
    }) || []

    // Load recent practice plans
    const { data: recentPlans } = await supabaseAdmin
      .from('practice_plans')
      .select('title, content')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(3)

    const planSummaries = recentPlans?.map(p => p.title) || []

    // Load active playbooks with progress
    const { data: activePlaybooks } = await supabaseAdmin
      .from('player_playbooks')
      .select(`
        id,
        title,
        started_at,
        completed_sessions,
        status,
        player:players(name),
        template:playbook_templates(
          title,
          description,
          goal,
          age_group,
          skill_category,
          total_sessions,
          sessions
        )
      `)
      .eq('team_id', teamId)
      .eq('status', 'active')

    // Format playbook context for AI
    const playbookContext = activePlaybooks?.map(pb => {
      const completedCount = Array.isArray(pb.completed_sessions) ? pb.completed_sessions.length : 0
      // Template is returned as array from Supabase join
      const template = Array.isArray(pb.template) ? pb.template[0] : pb.template
      const totalSessions = template?.total_sessions || 0
      const sessions = template?.sessions || []
      
      // Get current session (next incomplete one)
      const currentSessionIndex = completedCount
      const currentSession = sessions[currentSessionIndex]
      const previousSession = currentSessionIndex > 0 ? sessions[currentSessionIndex - 1] : null
      
      return {
        playbook_title: template?.title || pb.title,
        assigned_to: (pb.player as any)?.name || 'Whole Team',
        skill_category: template?.skill_category,
        goal: template?.goal,
        progress: `${completedCount}/${totalSessions} sessions completed`,
        current_day: currentSessionIndex + 1,
        current_session: currentSession ? {
          day: currentSession.day,
          title: currentSession.title,
          phase: currentSession.phase,
          goal: currentSession.goal,
          activities: currentSession.activities?.map((a: any) => a.name) || []
        } : null,
        previous_session: previousSession ? {
          day: previousSession.day,
          title: previousSession.title,
          goal: previousSession.goal
        } : null,
        started_at: pb.started_at
      }
    }) || []

    // Load saved drills
    const { data: savedDrills } = await supabaseAdmin
      .from('saved_drills')
      .select('title, category')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(10)

    const drillsSummary = savedDrills?.map(d => `${d.title} (${d.category})`) || []

    // Load drill resources library for AI to reference
    let drillResources: any[] = []
    try {
      const { data: resources } = await supabaseAdmin
        .from('drill_resources')
        .select('drill_name, skill_category, description, youtube_url, youtube_video_id, channel, age_range, difficulty_level, mechanic_focus, common_flaws_fixed, equipment_needed, ai_coaching_notes, safety_notes')
        .or('status.eq.approved,status.is.null')
        .limit(100)

      drillResources = resources || []
    } catch (e) {
      console.warn('Could not load drill resources (table may not exist yet)')
    }

    // Load recent practice recaps
    let practiceRecaps: any[] = []
    try {
      const { data: recaps } = await supabaseAdmin
        .from('practice_sessions')
        .select('*')
        .eq('team_id', teamId)
        .order('date', { ascending: false })
        .limit(5)

      if (recaps) {
        practiceRecaps = recaps
          .filter(r => r.what_worked || r.what_didnt_work || r.next_focus)
          .map(r => ({
            date: r.date,
            energy_level: r.energy_level,
            attendance_count: r.attendance_count,
            weather: r.weather,
            what_worked: r.what_worked || [],
            what_didnt_work: r.what_didnt_work || [],
            player_callouts: r.player_callouts || [],
            next_focus: r.next_focus || [],
            notes: r.notes,
          }))
      }
    } catch (e) {
      console.warn('Could not load practice recaps (columns may not exist yet)')
    }

    // Load player game stats for AI context
    let playerStats: any[] = []
    try {
      const { data: stats } = await supabaseAdmin
        .from('player_season_batting')
        .select('*')
        .eq('team_id', teamId)

      if (stats && stats.length > 0) {
        for (const ps of stats) {
          const { data: recentGames } = await supabaseAdmin
            .from('player_game_stats')
            .select('hits, at_bats, game_notes, game:games(game_date, opponent)')
            .eq('team_player_id', ps.team_player_id)
            .order('created_at', { ascending: false })
            .limit(3)

          ps.recent_games = recentGames?.map((g: any) => ({
            date: g.game?.game_date,
            opponent: g.game?.opponent,
            hits: g.hits || 0,
            at_bats: g.at_bats || 0,
            notes: g.game_notes,
          })) || []
        }
        playerStats = stats
      }
    } catch (e) {
      console.warn('Could not load player stats (tables may not exist yet)')
    }

    // Load recent games with notes and pitch counts
    let gameData: any[] = []
    try {
      const { data: recentGames } = await supabaseAdmin
        .from('games')
        .select('*')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false })
        .limit(10)

      if (recentGames && recentGames.length > 0) {
        const gameIds = recentGames.map(g => g.id)

        const [notesRes, pitchRes] = await Promise.all([
          supabaseAdmin.from('game_notes').select('*, player:players(name)').in('game_id', gameIds).order('created_at', { ascending: false }),
          supabaseAdmin.from('game_pitch_counts').select('*, player:players(name)').in('game_id', gameIds),
        ])

        gameData = recentGames.map(g => ({
          date: g.game_date,
          opponent: g.opponent,
          status: g.status,
          score: g.team_score !== null ? `${g.team_score}-${g.opponent_score}` : null,
          result: g.result,
          game_notes: (notesRes.data || [])
            .filter(n => n.game_id === g.id)
            .slice(0, 20)
            .map(n => ({
              player: n.player?.name,
              type: n.note_type,
              note: n.note,
              inning: n.inning,
            })),
          pitch_counts: (pitchRes.data || [])
            .filter(pc => pc.game_id === g.id)
            .reduce((acc: any, pc: any) => {
              const name = pc.player?.name || 'Unknown'
              if (!acc[name]) acc[name] = { total: 0, by_inning: {} }
              acc[name].total += pc.pitch_count
              acc[name].by_inning[pc.inning] = pc.pitch_count
              return acc
            }, {}),
        }))
      }
    } catch (e) {
      console.warn('Could not load game data (tables may not exist yet)')
    }

    // Load scouting context when the conversation concerns an opponent.
    // Scouting data is scoped to this coach's account only.
    let scouting: ScoutingContext | undefined
    try {
      const { data: opponentTeams } = await supabaseAdmin
        .from('opponent_teams')
        .select('id, name, age_group, first_seen, last_seen, notes')
        .eq('coach_id', team.coach_id)

      if (opponentTeams && opponentTeams.length > 0) {
        const recentText = [
          message,
          ...(history || []).slice(-4).map((h: any) => h.content || ''),
        ].join('\n').toLowerCase()

        // Teams named in the conversation
        const namedTeams = opponentTeams.filter(ot => {
          const words = ot.name.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 4)
          return recentText.includes(ot.name.toLowerCase()) || words.some((w: string) => recentText.includes(w))
        })

        // Generic scouting intent ("who can they pitch tomorrow?", "their #7")
        const scoutingIntent =
          /(scout|opponent|matchup|bracket|availab)/i.test(recentText) ||
          /\b(they|them|their)\b[^.?!]*\b(pitch|throw|start|bunt|steal|hit|play)/i.test(recentText) ||
          /\b(their|that|the)\s*#\s?\d+/i.test(recentText) ||
          /\b(play|played|face|facing|against)\b[^.?!]*\b(them|these guys|that team)\b/i.test(recentText)

        const { data: allMatchups } = await supabaseAdmin
          .from('matchups')
          .select('opponent_team_id, scheduled_at, status, tournament_name')
          .eq('coach_id', team.coach_id)
          .in('status', ['upcoming', 'possible'])

        let relevantTeams = namedTeams
        if (relevantTeams.length === 0 && scoutingIntent) {
          // No team named — fall back to teams with pending matchups, then most recently seen
          const matchupTeamIds = new Set((allMatchups || []).map(m => m.opponent_team_id))
          relevantTeams = opponentTeams
            .sort((a, b) => {
              const aM = matchupTeamIds.has(a.id) ? 0 : 1
              const bM = matchupTeamIds.has(b.id) ? 0 : 1
              if (aM !== bM) return aM - bM
              return (b.last_seen || '').localeCompare(a.last_seen || '')
            })
            .slice(0, 2)
        }
        relevantTeams = relevantTeams.slice(0, 3)

        if (relevantTeams.length > 0 || (scoutingIntent && (allMatchups || []).length > 0)) {
          const today = new Date().toISOString().split('T')[0]
          const opponentNameById: Record<string, string> = {}
          opponentTeams.forEach(ot => { opponentNameById[ot.id] = ot.name })

          // Rule sets for availability math (coach's own + system defaults)
          const { data: ruleRows } = await supabaseAdmin
            .from('pitch_count_rules')
            .select('*')
            .or(`coach_id.is.null,coach_id.eq.${team.coach_id}`)
          const pickRule = (ageGroup: string | null): PitchCountRuleSet | null => {
            const rules = (ruleRows || []) as PitchCountRuleSet[]
            if (rules.length === 0) return null
            const digits = (ageGroup || team.age_group || '').replace(/\D/g, '')
            const byAge = digits ? rules.find(r => r.age_group.replace(/\D/g, '').includes(digits)) : null
            return byAge
              || rules.find(r => r.sanctioning_body === 'Little League' && r.age_group === '11-12')
              || rules[0]
          }

          const opponentContexts = []
          const availabilityBoards = []

          for (const ot of relevantTeams) {
            const [playersRes, entriesRes] = await Promise.all([
              supabaseAdmin
                .from('opponent_players')
                .select('*, appearances:opponent_appearances(game_date, batting_line, pitches_thrown, positions_played)')
                .eq('opponent_team_id', ot.id),
              supabaseAdmin
                .from('scouting_entries')
                .select('entry_type, occurred_on, notes')
                .eq('opponent_team_id', ot.id)
                .not('notes', 'is', null)
                .order('occurred_on', { ascending: false })
                .limit(5),
            ])

            const players = (playersRes.data || []).slice(0, 18).map((p: any) => {
              const apps = p.appearances || []
              const batting = aggregateBattingLines(apps.map((a: any) => a.batting_line))
              const pitchApps = apps
                .filter((a: any) => (a.pitches_thrown || 0) > 0)
                .sort((a: any, b: any) => (a.game_date || '').localeCompare(b.game_date || ''))
              const lastPitch = pitchApps[pitchApps.length - 1]
              return {
                name: p.name,
                jersey_number: p.jersey_number,
                identity_confidence: p.confidence,
                positions: p.positions || [],
                notes: p.notes,
                last_seen: p.last_seen,
                batting: batting.pa > 0 ? batting : null,
                small_sample: batting.pa > 0 && batting.pa < MIN_PA_FOR_TENDENCY,
                pitching: lastPitch
                  ? {
                      outings: pitchApps.length,
                      total_pitches: pitchApps.reduce((s: number, a: any) => s + (a.pitches_thrown || 0), 0),
                      last_date: lastPitch.game_date,
                      last_pitches: lastPitch.pitches_thrown,
                    }
                  : null,
              }
            })

            opponentContexts.push({
              name: ot.name,
              age_group: ot.age_group,
              first_seen: ot.first_seen,
              last_seen: ot.last_seen,
              staleness_note:
                ot.last_seen && stalenessOf(ot.last_seen, today) !== 'current'
                  ? `Most recent data is ${stalenessLabel(ot.last_seen, today)}`
                  : null,
              team_notes: ot.notes,
              entry_count: (entriesRes.data || []).length,
              players,
              recent_notes: (entriesRes.data || []).map((e: any) => ({
                date: e.occurred_on,
                type: e.entry_type,
                note: e.notes,
              })),
            })

            // Availability board for the nearest pending matchup (or tomorrow)
            const rule = pickRule(ot.age_group)
            if (rule) {
              const teamMatchups = (allMatchups || [])
                .filter(m => m.opponent_team_id === ot.id && m.scheduled_at)
                .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
              const tomorrow = new Date()
              tomorrow.setDate(tomorrow.getDate() + 1)
              const targetDate =
                teamMatchups[0]?.scheduled_at?.split('T')[0] ||
                tomorrow.toISOString().split('T')[0]

              const rows = (playersRes.data || [])
                .filter((p: any) => (p.appearances || []).some((a: any) => (a.pitches_thrown || 0) > 0))
                .map((p: any) => {
                  const avail = computePitcherAvailability(p.appearances || [], rule, targetDate)
                  return {
                    name: p.name,
                    jersey_number: p.jersey_number,
                    identity_confidence: p.confidence,
                    status: avail.status,
                    explanation: avail.explanation,
                  }
                })

              if (rows.length > 0) {
                const gameDates = new Set<string>()
                ;(playersRes.data || []).forEach((p: any) =>
                  (p.appearances || []).forEach((a: any) => a.game_date && gameDates.add(a.game_date))
                )
                availabilityBoards.push({
                  opponent_name: ot.name,
                  target_date: targetDate,
                  rule_label: `${rule.sanctioning_body} ${rule.age_group}`,
                  coverage_notes: [
                    `Based on ${gameDates.size} logged game(s) only — unlogged games are not counted, so the picture may be incomplete.`,
                  ],
                  rows,
                })
              }
            }
          }

          scouting = {
            opponents: opponentContexts,
            availabilityBoards,
            upcomingMatchups: (allMatchups || []).slice(0, 10).map(m => ({
              opponent_name: opponentNameById[m.opponent_team_id] || 'Unknown',
              scheduled_at: m.scheduled_at,
              status: m.status,
              tournament_name: m.tournament_name,
            })),
          }

          // Instrumentation: scouting chat queries
          if (relevantTeams.length > 0) {
            const { data: coachRow } = await supabaseAdmin
              .from('coaches')
              .select('user_id')
              .eq('id', team.coach_id)
              .single()
            if (coachRow?.user_id) {
              await supabaseAdmin.from('user_events').insert({
                user_id: coachRow.user_id,
                event_type: 'feature_use',
                event_name: 'scouting_chat_query',
                metadata: { opponents: relevantTeams.map(t => t.name) },
              })
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not load scouting context (tables may not exist yet)')
    }

    // Load the activity log: observations, lesson diagnoses, and the priority
    // currently in force. Without this, chat happily contradicts the plan the
    // analysis surface just issued.
    let activityLog: string | undefined
    try {
      const coachCtx = await assembleCoachContext(supabaseAdmin, {
        coachId: team.coach_id,
        teamId,
        playerId: null,
      })
      const rendered = renderCoachContext(coachCtx)
      if (rendered && !rendered.startsWith('No history logged')) {
        activityLog = rendered
      }
    } catch (e) {
      console.warn('Could not load activity log context (tables may not exist yet)')
    }

    // Build context
    const context: TeamContext = {
      team: {
        name: team.name,
        age_group: team.age_group,
        skill_level: team.skill_level,
        practice_duration_minutes: team.practice_duration_minutes,
        primary_goals: team.primary_goals || [],
        improved_areas: team.improved_areas || [],
        mastered_areas: team.mastered_areas || [],
      },
      coachPreferences: coachPrefs,
      teamNotes: teamNotes || [],
      players,
      recentPlans: planSummaries,
      memorySummary: memorySummary?.summary,
      activePlaybooks: playbookContext,
      savedDrills: drillsSummary,
      drillResources: drillResources.length > 0 ? drillResources : undefined,
      practiceRecaps: practiceRecaps.length > 0 ? practiceRecaps : undefined,
      playerStats: playerStats.length > 0 ? playerStats : undefined,
      gameData: gameData.length > 0 ? gameData : undefined,
      scouting,
      activityLog,
    }

    // Convert history
    const conversationHistory = history?.map((h: any) => ({
      role: h.role,
      content: h.content,
    })) || []

    // Generate response
    const response = await generateChatResponse(message, context, conversationHistory)

    // Get or create chat thread
    let { data: thread } = await supabaseAdmin
      .from('chat_threads')
      .select('id')
      .eq('team_id', teamId)
      .single()

    if (!thread) {
      const { data: newThread, error: threadErr } = await supabaseAdmin
        .from('chat_threads')
        .insert({ team_id: teamId })
        .select()
        .single()
      thread = newThread
      // Without this the next line throws "Cannot read properties of null",
      // which tells nobody that the conversation table is what failed.
      if (!thread) {
        throw new Error(`Could not open a chat thread for this team: ${threadErr?.message || 'unknown error'}`)
      }
    }

    // Save messages
    const { data: userMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread.id,
        role: 'user',
        content: message,
      })
      .select()
      .single()

    const { data: assistantMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread.id,
        role: 'assistant',
        content: response.message,
        memory_suggestions: response.memory_suggestions,
      })
      .select()
      .single()

    // Auto-save high-confidence coach preferences
    if (response.memory_suggestions.coach_preferences) {
      for (const pref of response.memory_suggestions.coach_preferences) {
        if (pref.confidence > 0.75) {
          await supabaseAdmin
            .from('coach_preferences')
            .upsert({
              coach_id: team.coach_id,
              key: pref.key,
              value: pref.value,
            })
        }
      }
    }

    return NextResponse.json({
      message: response.message,
      memory_suggestions: response.memory_suggestions,
      id: assistantMsg.id,
      user_message_id: userMsg.id,
    })

  } catch (error: any) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET endpoint to load chat history (bypasses RLS)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const teamId = searchParams.get('teamId')

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })
    }

    // Get or create chat thread for this team (use oldest if multiple exist)
    let { data: thread } = await supabaseAdmin
      .from('chat_threads')
      .select('id')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (!thread) {
      const { data: newThread, error: threadErr } = await supabaseAdmin
        .from('chat_threads')
        .insert({ team_id: teamId })
        .select()
        .single()
      thread = newThread
      // Without this the next line throws "Cannot read properties of null",
      // which tells nobody that the conversation table is what failed.
      if (!thread) {
        throw new Error(`Could not open a chat thread for this team: ${threadErr?.message || 'unknown error'}`)
      }
    }

    if (!thread) {
      return NextResponse.json({ error: 'Failed to get/create thread' }, { status: 500 })
    }

    // Load messages for this thread
    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, memory_suggestions, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })

    return NextResponse.json({
      threadId: thread.id,
      messages: messages || []
    })

  } catch (error: any) {
    console.error('Chat GET error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE endpoint to clear chat history (bypasses RLS)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const threadId = searchParams.get('threadId')

    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 })
    }

    // Delete all messages in the thread
    await supabaseAdmin
      .from('chat_messages')
      .delete()
      .eq('thread_id', threadId)

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Chat DELETE error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
