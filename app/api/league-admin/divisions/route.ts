import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague } from '@/lib/leagueAuthz'

export const dynamic = 'force-dynamic'

// Create a division. "10U Majors".
//
// Scoped to a season as well as a league, because divisions get redrawn between
// seasons and last spring's adoption numbers must keep pointing at last
// spring's divisions.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  const denied = await guardLeague(request, 'manage')
  if (denied) return denied

  try {
    const { leagueId, leagueSeasonId, name, ageGroup } = await request.json()

    const trimmed = (name || '').trim()
    if (!trimmed) return NextResponse.json({ error: 'Give the division a name' }, { status: 400 })
    if (!leagueSeasonId) {
      return NextResponse.json({ error: 'Pick a season for this division' }, { status: 400 })
    }

    // The season must belong to the league the caller was authorized against.
    // Without this, an administrator of league A could hang a division off
    // league B's season by passing its id — guardLeague only checked the
    // leagueId in the body, and every other id in it is still just a claim.
    const { data: season } = await supabaseAdmin
      .from('league_seasons')
      .select('id')
      .eq('id', leagueSeasonId)
      .eq('league_id', leagueId)
      .maybeSingle()

    if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

    const { data, error } = await supabaseAdmin
      .from('league_divisions')
      .insert({
        league_id: leagueId,
        league_season_id: leagueSeasonId,
        name: trimmed,
        age_group: (ageGroup || '').trim() || null,
      })
      .select('id, name, age_group, league_season_id')
      .maybeSingle()

    if (error) {
      console.error('Create division failed:', error)
      return NextResponse.json({ error: 'Could not create that division' }, { status: 500 })
    }

    return NextResponse.json({ division: data })
  } catch (error: any) {
    console.error('League division POST error:', error)
    return NextResponse.json({ error: 'Could not create that division' }, { status: 500 })
  }
}
