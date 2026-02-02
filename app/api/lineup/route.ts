import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseClient()

    // Verify auth
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { teamId, innings, pitchingType, fieldPositions, everyoneBats, opponent, gameDate } = body

    // Get team info
    const { data: team } = await supabase
      .from('teams')
      .select('*, season:seasons(name)')
      .eq('id', teamId)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Get roster with player details
    const { data: roster } = await supabase
      .from('team_players')
      .select(`
        *,
        player:players(name, jersey_number)
      `)
      .eq('team_id', teamId)
      .order('player(name)')

    if (!roster || roster.length === 0) {
      return NextResponse.json({ error: 'No players on roster' }, { status: 400 })
    }

    // Get position eligibility
    const playerIds = roster.map(r => r.id)
    const { data: eligibility } = await supabase
      .from('position_eligibility')
      .select('*')
      .in('team_player_id', playerIds)

    // Get past lineups for fairness tracking (last 5 games)
    const { data: pastLineups } = await supabase
      .from('game_lineups')
      .select('id, game_date')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false })
      .limit(5)

    let pastAssignments: any[] = []
    if (pastLineups && pastLineups.length > 0) {
      const lineupIds = pastLineups.map(l => l.id)
      const { data: assignments } = await supabase
        .from('lineup_assignments')
        .select('*')
        .in('lineup_id', lineupIds)

      pastAssignments = assignments || []
    }

    // Build position history summary for fairness
    const positionHistory: Record<string, Record<string, number>> = {}
    for (const player of roster) {
      positionHistory[player.id] = {}
      const playerAssignments = pastAssignments.filter(a => a.team_player_id === player.id)
      for (const assignment of playerAssignments) {
        positionHistory[player.id][assignment.position] = 
          (positionHistory[player.id][assignment.position] || 0) + 1
      }
    }

    // Build eligibility map
    const eligibilityMap: Record<string, string[]> = {}
    for (const player of roster) {
      eligibilityMap[player.id] = []
    }
    if (eligibility) {
      for (const e of eligibility) {
        if (e.eligible) {
          eligibilityMap[e.team_player_id]?.push(e.position)
        }
      }
    }

    // Build the prompt
    const rosterInfo = roster.map(p => {
      const eligible = eligibilityMap[p.id] || []
      const history = positionHistory[p.id] || {}
      const historyStr = Object.entries(history)
        .map(([pos, count]) => `${pos}:${count}`)
        .join(', ')

      return `- ${p.player.name} (#${p.player.jersey_number || '?'}) [ID: ${p.id}]
  Skill: Hit ${p.hitting_level || '?'}/5, Throw ${p.throwing_level || '?'}/5, Field ${p.fielding_level || '?'}/5
  Key position eligible: ${eligible.length > 0 ? eligible.join(', ') : 'none flagged'}
  Recent position history (last 5 games): ${historyStr || 'no history'}`
    }).join('\n')

    const allPositions = fieldPositions === 10
      ? ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF']
      : fieldPositions === 9
        ? ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
        : Array.from({ length: fieldPositions }, (_, i) => `POS${i + 1}`)

    const systemPrompt = `You are Bench Coach's lineup generator for youth baseball. You create fair, smart game-day lineups.

RULES FOR ${team.age_group} BASEBALL:
1. ${everyoneBats ? 'EVERYONE BATS every inning - continuous batting order' : 'Standard batting lineup'}
2. ${innings} innings
3. ${fieldPositions} fielding positions per inning
4. Pitching type: ${pitchingType === 'coach_pitch' ? 'Coach pitch (no player pitcher needed)' : pitchingType === 'machine_pitch' ? 'Machine pitch (no player pitcher needed)' : 'Live pitch (need eligible pitcher)'}
5. Players rotate positions each inning for development
6. KEY POSITIONS (C, P if live pitch, 1B) should ONLY be assigned to players flagged as eligible
7. Every player should get roughly equal innings in the field
8. Rotate infield/outfield — don't stick a kid in RF every inning
9. Use position history to ensure fairness across games
10. If there are more players than field positions, rotate bench innings fairly

AVAILABLE POSITIONS: ${allPositions.join(', ')}
${pitchingType === 'coach_pitch' || pitchingType === 'machine_pitch' ? 'NOTE: No player pitcher needed. Skip P position or use it as an extra fielder near the mound if the league allows.' : ''}

ROSTER (${roster.length} players):
${rosterInfo}

Generate a lineup for ${innings} innings. Return ONLY a JSON object in this exact format:
{
  "batting_order": [
    {"team_player_id": "...", "name": "...", "order": 1},
    ...
  ],
  "field_assignments": {
    "1": [
      {"team_player_id": "...", "name": "...", "position": "..."},
      ...
    ],
    "2": [...],
    ...
  },
  "bench_by_inning": {
    "1": [{"team_player_id": "...", "name": "..."}],
    ...
  },
  "notes": "Brief explanation of key decisions"
}

IMPORTANT:
- Every player must appear in EVERY inning, either in field_assignments or bench_by_inning
- Only assign C, P, 1B to eligible players
- Distribute bench time as equally as possible
- Vary positions across innings — maximum development
- The batting_order is the continuous order for the whole game`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate the game day lineup for our game${opponent ? ` against ${opponent}` : ''}${gameDate ? ` on ${gameDate}` : ''}. Make it fair and smart.`,
        },
      ],
    })

    // Parse the response
    const textContent = response.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI')
    }

    // Extract JSON from the response
    let lineupData
    try {
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        lineupData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('Failed to parse lineup JSON:', textContent.text)
      throw new Error('Failed to parse lineup response')
    }

    return NextResponse.json(lineupData)
  } catch (error) {
    console.error('Lineup generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate lineup' },
      { status: 500 }
    )
  }
}