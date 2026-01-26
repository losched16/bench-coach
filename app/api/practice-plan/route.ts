import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generatePracticePlan, TeamContext } from '@/lib/anthropic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { teamId, duration, focus, constraints } = await request.json()

    if (!teamId || !duration || !focus) {
      return NextResponse.json(
        { error: 'Missing required fields' },
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

    // Load team notes
    const { data: teamNotes } = await supabaseAdmin
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
        improved_areas: team.improved_areas || [],
        mastered_areas: team.mastered_areas || [],
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
