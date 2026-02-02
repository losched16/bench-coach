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

    // Load team context
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

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

    // Load recent practice recaps (last 3) to feed into the next plan
    let recapContext = ''
    try {
      const { data: recentRecaps } = await supabaseAdmin
        .from('practice_sessions')
        .select('date, recap_note, what_worked, what_didnt_work, player_callouts, energy_level, next_focus, attendance_count')
        .eq('team_id', teamId)
        .order('date', { ascending: false })
        .limit(3)

      if (recentRecaps && recentRecaps.length > 0) {
        const recapLines = recentRecaps.map(r => {
          const parts: string[] = []
          parts.push(`Practice on ${r.date}:`)
          if (r.energy_level) parts.push(`  Energy: ${r.energy_level}`)
          if (r.attendance_count) parts.push(`  Attendance: ${r.attendance_count} players`)
          if (r.what_worked && (r.what_worked as string[]).length > 0) {
            parts.push(`  ✅ What worked: ${(r.what_worked as string[]).join(', ')}`)
          }
          if (r.what_didnt_work && (r.what_didnt_work as string[]).length > 0) {
            parts.push(`  ⚠️ What didn't work: ${(r.what_didnt_work as string[]).join(', ')}`)
          }
          if (r.player_callouts && (r.player_callouts as any[]).length > 0) {
            const callouts = (r.player_callouts as any[])
              .map(c => `${c.player_name}: ${c.note} (${c.type})`)
              .join('; ')
            parts.push(`  Player notes: ${callouts}`)
          }
          if (r.next_focus && (r.next_focus as string[]).length > 0) {
            parts.push(`  Coach wants next practice to focus on: ${(r.next_focus as string[]).join(', ')}`)
          }
          if (r.recap_note) parts.push(`  Notes: ${r.recap_note}`)
          return parts.join('\n')
        })

        recapContext = recapLines.join('\n\n')
      }
    } catch (e) {
      console.warn('Could not load practice recaps (table may not have new columns yet)')
    }

    // Build constraints string that includes recaps
    let fullConstraints = constraints || ''
    if (recapContext) {
      fullConstraints += `\n\nRECENT PRACTICE RECAPS (use these to make this plan better):\n${recapContext}`
    }

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
    const plan = await generatePracticePlan(duration, focus, context, fullConstraints)

    return NextResponse.json(plan)

  } catch (error: any) {
    console.error('Practice plan API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
