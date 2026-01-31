import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const teamId = '9dca2403-3a4a-480c-be46-3d9a4b45877f'
  
  const { data: teamPlayers, error } = await supabaseAdmin
    .from('team_players')
    .select(`
      *,
      player:players(name),
      notes:player_notes(note, created_at)
    `)
    .eq('team_id', teamId)

  return NextResponse.json({
    error,
    raw: teamPlayers,
    mapped: teamPlayers?.map(tp => ({
      name: tp.player?.name,
      hitting_level: tp.hitting_level,
      throwing_level: tp.throwing_level,
      fielding_level: tp.fielding_level,
      pitching_level: tp.pitching_level,
      baserunning_level: tp.baserunning_level,
      coachability_level: tp.coachability_level,
    }))
  })
}