import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const teamId = '9dca2403-3a4a-480c-be46-3d9a4b45877f'
  
  const { data: teamPlayers, error } = await supabaseAdmin
    .from('team_players')
    .select('*, player:players(name)')
    .eq('team_id', teamId)

  return NextResponse.json({
    error,
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
