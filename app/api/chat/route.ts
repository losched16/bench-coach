import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase'
import { generateChatResponse, TeamContext } from '@/lib/anthropic'

export async function POST(request: NextRequest) {
  try {
    const { teamId, message, history } = await request.json()

    if (!teamId || !message) {
      return NextResponse.json(
        { error: 'Missing teamId or message' },
        { status: 400 }
      )
    }

    const supabase = createSupabaseClient()

    // Load team context
    const { data: team } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Load coach preferences
    const { data: preferences } = await supabase
      .from('coach_preferences')
      .select('key, value')
      .eq('coach_id', team.coach_id)

    const coachPrefs: Record<string, string> = {}
    preferences?.forEach(p => {
      coachPrefs[p.key] = p.value
    })

    // Load team notes (pinned + recent)
    const { data: teamNotes } = await supabase
      .from('team_notes')
      .select('note, pinned')
      .eq('team_id', teamId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    // Load team memory summary
    const { data: memorySummary } = await supabase
      .from('team_memory_summaries')
      .select('summary')
      .eq('team_id', teamId)
      .single()

    // Load players with notes
    const { data: teamPlayers } = await supabase
      .from('team_players')
      .select(`
        *,
        player:players(name),
        notes:player_notes(note)
      `)
      .eq('team_id', teamId)

    const players = teamPlayers?.map(tp => ({
      name: tp.player.name,
      positions: tp.positions || [],
      notes: tp.notes?.map((n: any) => n.note) || [],
    })) || []

    // Load recent practice plans
    const { data: recentPlans } = await supabase
      .from('practice_plans')
      .select('title, content')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(3)

    const planSummaries = recentPlans?.map(p => p.title) || []

    // Build context
    const context: TeamContext = {
      team: {
        name: team.name,
        age_group: team.age_group,
        skill_level: team.skill_level,
        practice_duration_minutes: team.practice_duration_minutes,
        primary_goals: team.primary_goals || [],
      },
      coachPreferences: coachPrefs,
      teamNotes: teamNotes || [],
      players,
      recentPlans: planSummaries,
      memorySummary: memorySummary?.summary,
    }

    // Convert history
    const conversationHistory = history?.map((h: any) => ({
      role: h.role,
      content: h.content,
    })) || []

    // Generate response
    const response = await generateChatResponse(message, context, conversationHistory)

    // Get or create chat thread
    let { data: thread } = await supabase
      .from('chat_threads')
      .select('id')
      .eq('team_id', teamId)
      .single()

    if (!thread) {
      const { data: newThread } = await supabase
        .from('chat_threads')
        .insert({ team_id: teamId })
        .select()
        .single()
      thread = newThread
    }

    // Save messages
    const { data: userMsg } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: thread.id,
        role: 'user',
        content: message,
      })
      .select()
      .single()

    const { data: assistantMsg } = await supabase
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
          await supabase
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
