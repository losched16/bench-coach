import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateChatResponse, TeamContext, JournalEntry } from '@/lib/anthropic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { teamId, message, history } = await request.json()

    if (!teamId || !message) {
      return NextResponse.json(
        { error: 'Missing teamId or message' },
        { status: 400 }
      )
    }

    // Load team context
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

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

    // Load players with notes and skill ratings
    const { data: teamPlayers } = await supabaseAdmin
      .from('team_players')
      .select(`
        *,
        player:players(name),
        notes:player_notes(note)
      `)
      .eq('team_id', teamId)

    // Load player journal entries (recent entries for each player)
    let journalEntries: any[] = []
    try {
      const { data: journals } = await supabaseAdmin
        .from('player_journal_entries')
        .select('*')
        .eq('team_id', teamId)
        .order('session_date', { ascending: false })
        .limit(20)

      journalEntries = journals || []
    } catch (e) {
      console.warn('Could not load journal entries (table may not exist yet)')
    }

    // Group journal entries by player
    const journalByPlayer: Record<string, JournalEntry[]> = {}
    for (const entry of journalEntries) {
      const playerId = entry.player_id
      if (!journalByPlayer[playerId]) {
        journalByPlayer[playerId] = []
      }
      if (journalByPlayer[playerId].length < 5) {
        journalByPlayer[playerId].push({
          date: entry.session_date,
          type: entry.session_type,
          instructor: entry.instructor_name,
          focus: entry.focus_area,
          went_well: entry.went_well,
          needs_work: entry.needs_work,
          home_drills: entry.home_drills,
          skills: entry.skills || [],
        })
      }
    }

    const players = teamPlayers?.map(tp => {
      const playerData = tp.player as any
      return {
        name: playerData?.name || 'Unknown',
        positions: tp.positions || [],
        hitting_level: tp.hitting_level,
        throwing_level: tp.throwing_level,
        fielding_level: tp.fielding_level,
        pitching_level: tp.pitching_level,
        baserunning_level: tp.baserunning_level,
        coachability_level: tp.coachability_level,
        notes: tp.notes?.map((n: any) => n.note) || [],
        journal: journalByPlayer[tp.player_id] || [],
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

    // Load active playbooks
    let activePlaybooks: any[] = []
    try {
      const { data: playbooks } = await supabaseAdmin
        .from('assigned_playbooks')
        .select(`
          *,
          playbook:playbooks(title, skill_category, content)
        `)
        .eq('team_id', teamId)
        .eq('status', 'active')

      if (playbooks) {
        activePlaybooks = playbooks.map(ap => {
          const pb = ap.playbook as any
          const sessions = pb?.content?.sessions || []
          const currentDay = ap.current_day || 1
          const currentSession = sessions.find((s: any) => s.day === currentDay)
          const previousSession = currentDay > 1 ? sessions.find((s: any) => s.day === currentDay - 1) : null

          return {
            playbook_title: pb?.title || 'Unknown Playbook',
            assigned_to: ap.assigned_to_name || 'Team',
            skill_category: pb?.skill_category || 'General',
            goal: pb?.content?.goal || '',
            progress: `Day ${currentDay} of ${sessions.length}`,
            current_day: currentDay,
            current_session: currentSession ? {
              day: currentSession.day,
              title: currentSession.title,
              phase: currentSession.phase,
              goal: currentSession.goal,
              activities: currentSession.activities?.map((a: any) => a.name || a.title || a) || [],
            } : undefined,
            previous_session: previousSession ? {
              day: previousSession.day,
              title: previousSession.title,
              goal: previousSession.goal,
            } : undefined,
            started_at: ap.started_at,
          }
        })
      }
    } catch (e) {
      console.warn('Could not load playbooks (table may not exist yet)')
    }

    // Load saved drills
    let savedDrills: string[] = []
    try {
      const { data: drills } = await supabaseAdmin
        .from('saved_drills')
        .select('title')
        .eq('team_id', teamId)
        .limit(10)

      savedDrills = drills?.map(d => d.title) || []
    } catch (e) {
      console.warn('Could not load saved drills (table may not exist yet)')
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
      activePlaybooks: activePlaybooks.length > 0 ? activePlaybooks : undefined,
      savedDrills: savedDrills.length > 0 ? savedDrills : undefined,
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
      const { data: newThread } = await supabaseAdmin
        .from('chat_threads')
        .insert({ team_id: teamId })
        .select()
        .single()
      thread = newThread
    }

    // Save messages
    const { data: userMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread!.id,
        role: 'user',
        content: message,
      })
      .select()
      .single()

    const { data: assistantMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread!.id,
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
      id: assistantMsg?.id,
      user_message_id: userMsg?.id,
    })

  } catch (error: any) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
