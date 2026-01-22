import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase'
import { generatePracticePlan, TeamContext } from '@/lib/anthropic'

export async function POST(request: NextRequest) {
  try {
    const { teamId, duration, focus, constraints } = await request.json()

    if (!teamId || !duration || !focus) {
      return NextResponse.json(
        { error: 'Missing required fields' },
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

    // Load team notes
    const { data: teamNotes } = await supabase
      .from('team_notes')
      .select('note')
      .eq('team_id', teamId)
      .eq('pinned', true)
      .limit(3)

    // Build context
    const context: TeamContext = {
      team: {
        name: team.name,
        age_group: team.age_group,
        skill_level: team.skill_level,
        practice_duration_minutes: team.practice_duration_minutes,
        primary_goals: team.primary_goals || [],
      },
      coachPreferences: {},
      teamNotes: teamNotes?.map(n => ({ note: n.note, pinned: true })) || [],
      players: [],
    }

    // Generate practice plan
    const plan = await generatePracticePlan(duration, focus, context, constraints)

    return NextResponse.json(plan)

  } catch (error: any) {
    console.error('Practice plan API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
