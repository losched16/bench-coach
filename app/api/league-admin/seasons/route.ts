import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague } from '@/lib/leagueAuthz'

export const dynamic = 'force-dynamic'

// Create a league season. "Spring 2027".
//
// Distinct from the `seasons` table, which is one coach's private season and
// belongs to that coach. This is the organisation's calendar.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUSES = ['upcoming', 'active', 'completed']

export async function POST(request: NextRequest) {
  const denied = await guardLeague(request, 'manage')
  if (denied) return denied

  try {
    const { leagueId, name, startsAt, endsAt, status } = await request.json()

    const trimmed = (name || '').trim()
    if (!trimmed) return NextResponse.json({ error: 'Give the season a name' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('league_seasons')
      .insert({
        league_id: leagueId,
        name: trimmed,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        status: STATUSES.includes(status) ? status : 'active',
      })
      .select('id, name, status, starts_at, ends_at')
      .maybeSingle()

    if (error) {
      console.error('Create league season failed:', error)
      return NextResponse.json({ error: 'Could not create that season' }, { status: 500 })
    }

    return NextResponse.json({ season: data })
  } catch (error: any) {
    console.error('League season POST error:', error)
    return NextResponse.json({ error: 'Could not create that season' }, { status: 500 })
  }
}
