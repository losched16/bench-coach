import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { teamId, innings, pitchingType, fieldPositions, everyoneBats, opponent, gameDate } = body

    console.log('=== LINEUP API START ===')
    console.log('teamId:', teamId)
    console.log('innings:', innings, 'pitchingType:', pitchingType, 'fieldPositions:', fieldPositions)

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set')
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    // ── 1. Load team ──────────────────────────────────────────
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('*, season:seasons(name)')
      .eq('id', teamId)
      .single()

    if (teamError) {
      console.error('Team query error:', teamError)
      return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
    }
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    console.log('Team loaded:', team.name, 'age_group:', team.age_group)

    // ── 2. Load roster ────────────────────────────────────────
    const { data: roster, error: rosterError } = await supabaseAdmin
      .from('team_players')
      .select(`*, player:players(id, name, jersey_number)`)
      .eq('team_id', teamId)

    if (rosterError) {
      console.error('Roster query error:', rosterError)
      return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
    }
    if (!roster || roster.length === 0) {
      return NextResponse.json({ error: 'No players on roster' }, { status: 400 })
    }
    console.log('Roster loaded:', roster.length, 'players')

    // ── 3. Load position eligibility (OK if table doesn't exist yet) ──
    let eligibility: any[] = []
    try {
      const playerIds = roster.map(r => r.id)
      const { data: eligData, error: eligError } = await supabaseAdmin
        .from('position_eligibility')
        .select('*')
        .in('team_player_id', playerIds)

      if (eligError) {
        console.warn('Eligibility query error (non-fatal):', eligError.message)
      } else {
        eligibility = eligData || []
      }
    } catch (e) {
      console.warn('Eligibility table may not exist yet, skipping')
    }
    console.log('Eligibility entries:', eligibility.length)

    // ── 4. Load past lineups for fairness (OK if table doesn't exist) ──
    let pastAssignments: any[] = []
    try {
      const { data: pastLineups, error: pastError } = await supabaseAdmin
        .from('game_lineups')
        .select('id, game_date')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false })
        .limit(5)

      if (!pastError && pastLineups && pastLineups.length > 0) {
        const lineupIds = pastLineups.map(l => l.id)
        const { data: assignments } = await supabaseAdmin
          .from('lineup_assignments')
          .select('*')
          .in('lineup_id', lineupIds)

        pastAssignments = assignments || []
      }
    } catch (e) {
      console.warn('Past lineups table may not exist yet, skipping')
    }
    console.log('Past assignments loaded:', pastAssignments.length)

    // ── 5. Build position history for fairness ────────────────
    const positionHistory: Record<string, Record<string, number>> = {}
    for (const player of roster) {
      positionHistory[player.id] = {}
      const playerAssignments = pastAssignments.filter(a => a.team_player_id === player.id)
      for (const assignment of playerAssignments) {
        positionHistory[player.id][assignment.position] =
          (positionHistory[player.id][assignment.position] || 0) + 1
      }
    }

    // ── 6. Build eligibility map ──────────────────────────────
    const eligibilityMap: Record<string, string[]> = {}
    for (const player of roster) {
      eligibilityMap[player.id] = []
    }
    for (const e of eligibility) {
      if (e.eligible) {
        eligibilityMap[e.team_player_id]?.push(e.position)
      }
    }

    // ── 7. Build prompt ───────────────────────────────────────
    const rosterInfo = roster.map(p => {
      const playerData = p.player as any
      const name = playerData?.name || 'Unknown'
      const jersey = playerData?.jersey_number || '?'
      const eligible = eligibilityMap[p.id] || []
      const history = positionHistory[p.id] || {}
      const historyStr = Object.entries(history)
        .map(([pos, count]) => `${pos}:${count}`)
        .join(', ')

      return `- ${name} (#${jersey}) [ID: ${p.id}]
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

RULES FOR ${team.age_group || '8U'} BASEBALL:
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

Generate a lineup for ${innings} innings. Return ONLY a JSON object in this exact format with no markdown formatting, no backticks, and no extra text:
{
  "batting_order": [
    {"team_player_id": "uuid-here", "name": "Player Name", "order": 1}
  ],
  "field_assignments": {
    "1": [
      {"team_player_id": "uuid-here", "name": "Player Name", "position": "SS"}
    ],
    "2": []
  },
  "bench_by_inning": {
    "1": [{"team_player_id": "uuid-here", "name": "Player Name"}]
  },
  "notes": "Brief explanation of key decisions"
}

IMPORTANT:
- Every player must appear in EVERY inning, either in field_assignments or bench_by_inning
- Only assign C, P, 1B to eligible players
- Distribute bench time as equally as possible
- Vary positions across innings — maximum development
- The batting_order is the continuous order for the whole game
- Return ONLY valid JSON. No markdown. No backticks. No explanation outside the JSON.`

    console.log('Calling Claude API...')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate the game day lineup for our game${opponent ? ` against ${opponent}` : ''}${gameDate ? ` on ${gameDate}` : ''}. Make it fair and smart.`,
        },
      ],
    })

    console.log('Claude response received, stop_reason:', response.stop_reason)

    // Parse the response
    const textContent = response.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      console.error('No text content in response:', JSON.stringify(response.content))
      throw new Error('No text response from AI')
    }

    const rawText = textContent.text
    console.log('Raw response length:', rawText.length)
    console.log('First 200 chars:', rawText.substring(0, 200))

    // Extract JSON - strip markdown fences if present
    let jsonStr = rawText
    // Remove ```json ... ``` wrapping
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
    // Find the outermost JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('No JSON found in response. Full text:', rawText)
      throw new Error('No JSON found in lineup response')
    }

    let lineupData
    try {
      lineupData = JSON.parse(jsonMatch[0])
    } catch (parseError: any) {
      console.error('JSON parse error:', parseError.message)
      console.error('Attempted to parse:', jsonMatch[0].substring(0, 500))
      throw new Error('Failed to parse lineup JSON')
    }

    console.log('=== LINEUP API SUCCESS ===')
    console.log('Batting order:', lineupData.batting_order?.length, 'players')
    console.log('Innings generated:', Object.keys(lineupData.field_assignments || {}).length)

    return NextResponse.json(lineupData)
  } catch (error: any) {
    console.error('=== LINEUP API ERROR ===')
    console.error('Error name:', error.name)
    console.error('Error message:', error.message)
    console.error('Full error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate lineup' },
      { status: 500 }
    )
  }
}
