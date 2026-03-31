import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const playerId = searchParams.get('playerId') // team_player_id
  const teamId = searchParams.get('teamId')

  if (!playerId || !teamId) {
    return NextResponse.json({ error: 'playerId and teamId required' }, { status: 400 })
  }

  try {
    // Load season stats
    const { data: stats } = await supabaseAdmin
      .from('player_season_batting')
      .select('*')
      .eq('team_player_id', playerId)
      .single()

    if (!stats) {
      return NextResponse.json({ error: 'No stats found' }, { status: 404 })
    }

    // Load team info
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('name, age_group')
      .eq('id', teamId)
      .single()

    // Load recent games for last 5 trend
    const { data: recentGames } = await supabaseAdmin
      .from('player_game_stats')
      .select('hits, at_bats, game:games(game_date, opponent)')
      .eq('team_player_id', playerId)
      .order('created_at', { ascending: false })
      .limit(5)

    // Load milestones
    const { data: tp } = await supabaseAdmin
      .from('team_players')
      .select('player_id')
      .eq('id', playerId)
      .single()

    let milestoneCount = 0
    if (tp) {
      const { count } = await supabaseAdmin
        .from('player_milestones')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', tp.player_id)
        .eq('team_id', teamId)

      milestoneCount = count || 0
    }

    const avg = Number(stats.batting_avg) || 0
    const obp = Number(stats.obp) || 0
    const slg = Number(stats.slg) || 0
    const ops = obp + slg

    // Generate SVG card
    const teamName = team?.name || 'Team'
    const ageGroup = team?.age_group || ''
    const playerName = stats.player_name || 'Player'
    const jersey = stats.jersey_number || '?'

    // Build last 5 games mini chart
    const last5 = (recentGames || []).reverse()
    const barChartBars = last5.map((g: any, i: number) => {
      const ab = g.at_bats || 0
      const h = g.hits || 0
      const gameAvg = ab > 0 ? h / ab : 0
      const barH = Math.max(gameAvg * 60, 3)
      const color = gameAvg >= 0.300 ? '#22c55e' : gameAvg > 0 ? '#ef4444' : '#cbd5e1'
      const x = 456 + i * 22
      return `<rect x="${x}" y="${90 - barH}" width="16" height="${barH}" rx="2" fill="${color}" opacity="0.9"/>
      <text x="${x + 8}" y="${100}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="monospace">${h}-${ab}</text>`
    }).join('\n')

    // Season highlights text
    const highlightLines: string[] = []
    if (stats.total_hr > 0) highlightLines.push(`${stats.total_hr} HR`)
    if (stats.total_sb > 0) highlightLines.push(`${stats.total_sb} SB`)
    if (milestoneCount > 0) highlightLines.push(`${milestoneCount} milestone${milestoneCount > 1 ? 's' : ''}`)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#dc2626"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
    <filter id="shadow" x="-4%" y="-4%" width="108%" height="108%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="600" height="340" rx="20" fill="url(#bg)"/>
  
  <!-- Top accent line -->
  <rect x="0" y="0" width="600" height="4" rx="2" fill="url(#accent)"/>
  
  <!-- Jersey number circle -->
  <circle cx="52" cy="52" r="30" fill="#dc2626" filter="url(#shadow)"/>
  <text x="52" y="60" text-anchor="middle" font-size="24" font-weight="900" fill="white" font-family="system-ui, -apple-system, sans-serif">${jersey}</text>
  
  <!-- Player name -->
  <text x="96" y="44" font-size="26" font-weight="800" fill="white" font-family="system-ui, -apple-system, sans-serif">${playerName}</text>
  
  <!-- Team + age group -->
  <text x="96" y="66" font-size="13" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif">${teamName}${ageGroup ? ' · ' + ageGroup : ''} · ${stats.games_played || 0} games</text>
  
  <!-- Big AVG -->
  <text x="410" y="52" text-anchor="end" font-size="44" font-weight="900" fill="white" font-family="monospace">${avg.toFixed(3).replace('0.', '.')}</text>
  <text x="420" y="52" font-size="12" fill="#64748b" font-family="system-ui, -apple-system, sans-serif">AVG</text>
  
  <!-- Divider -->
  <rect x="24" y="84" width="408" height="1" fill="#334155"/>
  
  <!-- Last 5 games chart -->
  ${last5.length > 0 ? `
  <text x="456" y="28" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" text-anchor="middle">LAST ${last5.length}</text>
  <rect x="448" y="30" width="${last5.length * 22 + 8}" height="82" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  ${barChartBars}
  ` : ''}
  
  <!-- Main stats row -->
  <g transform="translate(0, 100)">
    <!-- OBP -->
    <text x="72" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="white" font-family="monospace">${obp.toFixed(3).replace('0.', '.')}</text>
    <text x="72" y="48" text-anchor="middle" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">OBP</text>
    
    <!-- SLG -->
    <text x="192" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="white" font-family="monospace">${slg.toFixed(3).replace('0.', '.')}</text>
    <text x="192" y="48" text-anchor="middle" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">SLG</text>
    
    <!-- OPS -->
    <text x="312" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="${ops >= 0.700 ? '#22c55e' : ops >= 0.500 ? '#eab308' : '#ef4444'}" font-family="monospace">${ops.toFixed(3).replace(/^0/, '')}</text>
    <text x="312" y="48" text-anchor="middle" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">OPS</text>
    
    <!-- RBI -->
    <text x="432" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="white" font-family="monospace">${stats.total_rbi || 0}</text>
    <text x="432" y="48" text-anchor="middle" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">RBI</text>
    
    <!-- RUNS -->
    <text x="532" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="white" font-family="monospace">${stats.total_runs || 0}</text>
    <text x="532" y="48" text-anchor="middle" font-size="10" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">RUNS</text>
  </g>
  
  <!-- Divider -->
  <rect x="24" y="165" width="552" height="1" fill="#334155"/>
  
  <!-- Counting stats grid -->
  <g transform="translate(0, 180)">
    ${[
      { label: 'H', val: stats.total_hits || 0, x: 50 },
      { label: 'AB', val: stats.total_ab || 0, x: 120 },
      { label: '2B', val: stats.total_doubles || 0, x: 190 },
      { label: '3B', val: stats.total_triples || 0, x: 260 },
      { label: 'HR', val: stats.total_hr || 0, x: 330 },
      { label: 'BB', val: stats.total_walks || 0, x: 400 },
      { label: 'K', val: stats.total_strikeouts || 0, x: 470 },
      { label: 'SB', val: stats.total_sb || 0, x: 540 },
    ].map(s => `
    <text x="${s.x}" y="20" text-anchor="middle" font-size="20" font-weight="700" fill="#e2e8f0" font-family="monospace">${s.val}</text>
    <text x="${s.x}" y="36" text-anchor="middle" font-size="9" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">${s.label}</text>
    `).join('')}
  </g>
  
  <!-- Highlights row -->
  ${highlightLines.length > 0 ? `
  <g transform="translate(24, 240)">
    ${highlightLines.map((h, i) => `
    <rect x="${i * 120}" y="0" width="${h.length * 8 + 20}" height="24" rx="12" fill="#dc262620" stroke="#dc262640" stroke-width="1"/>
    <text x="${i * 120 + (h.length * 8 + 20) / 2}" y="16" text-anchor="middle" font-size="11" fill="#fca5a5" font-family="system-ui, -apple-system, sans-serif">${h}</text>
    `).join('')}
  </g>
  ` : ''}
  
  <!-- Footer -->
  <rect x="24" y="290" width="552" height="1" fill="#334155"/>
  
  <!-- Bench Coach branding -->
  <text x="24" y="320" font-size="13" font-weight="700" fill="#dc2626" font-family="system-ui, -apple-system, sans-serif">BENCH COACH</text>
  <text x="156" y="320" font-size="11" fill="#475569" font-family="system-ui, -apple-system, sans-serif">mybenchcoach.com</text>
  
  <!-- Season label -->
  <text x="576" y="320" text-anchor="end" font-size="11" fill="#475569" font-family="system-ui, -apple-system, sans-serif">${new Date().getFullYear()} Season</text>
</svg>`

    // Return SVG as PNG-compatible image
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
      },
    })

  } catch (error: any) {
    console.error('Player card error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
