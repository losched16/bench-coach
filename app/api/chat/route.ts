import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateChatResponse, TeamContext } from '@/lib/anthropic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    // Load players with notes
    const { data: teamPlayers } = await supabaseAdmin
      .from('team_players')
      .select(`
        *,
        player:players(name),
        notes:player_notes(note, created_at)
      `)
      .eq('team_id', teamId)

    const players = teamPlayers?.map(tp => ({
      name: tp.player.name,
      positions: tp.positions || [],
      notes: tp.notes?.map((n: any) => n.note) || [],
    })) || []

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
    const playbookContext = activePlaybooks?.map((pb: any) => {
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
          activities: currentSession.activities
        } : undefined,
        previous_session: previousSession ? {
          day: previousSession.day,
          title: previousSession.title,
          phase: previousSession.phase,
          goal: previousSession.goal,
          activities: previousSession.activities
        } : undefined,
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
