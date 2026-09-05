import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague } from '@/lib/leagueAuthz'
import { sessionClient } from '@/lib/authz'

export const dynamic = 'force-dynamic'

// Create a team inside a league.
//
// The awkward part, stated plainly: teams.coach_id and teams.season_id are both
// NOT NULL, and in February there is no coach yet. So the administrator creating
// the team owns it, on their own coach row and their own season, and that
// ownership is a PLACEHOLDER — the head coach's invitation claims it on
// acceptance (see lib/leagueInvites.ts shouldTransferOwnership and the accept
// route).
//
// The alternative — leaving the admin as permanent owner and making the head
// coach an 'admin' member — was rejected because it gives a league coach a
// visibly worse product than the one they would have bought: no Staff page, no
// ability to invite their own assistants, no control of their own team. That is
// the exact failure this whole layer is meant to avoid.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  const denied = await guardLeague(request, 'manage')
  if (denied) return denied

  try {
    const { leagueId, leagueSeasonId, leagueDivisionId, name, ageGroup } = await request.json()

    const trimmed = (name || '').trim()
    if (!trimmed) return NextResponse.json({ error: 'Give the team a name' }, { status: 400 })

    const supabase = await sessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'You need to be signed in' }, { status: 401 })

    // Every id in the body other than leagueId is an unverified claim, and
    // guardLeague only vouched for leagueId. Both are re-checked against the
    // league before use so an administrator of one league cannot file a team
    // under another league's season or division.
    if (leagueSeasonId) {
      const { data: season } = await supabaseAdmin
        .from('league_seasons').select('id').eq('id', leagueSeasonId).eq('league_id', leagueId).maybeSingle()
      if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    }
    if (leagueDivisionId) {
      const { data: division } = await supabaseAdmin
        .from('league_divisions').select('id').eq('id', leagueDivisionId).eq('league_id', leagueId).maybeSingle()
      if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
    }

    // The administrator's own coach row, created if they have never coached.
    // is_subscribed is untouched: running a league is not buying a plan.
    let { data: coach } = await supabaseAdmin
      .from('coaches').select('id').eq('user_id', user.id).maybeSingle()

    if (!coach) {
      const { data: created, error: coachError } = await supabaseAdmin
        .from('coaches')
        .insert({
          user_id: user.id,
          display_name: (user.user_metadata as any)?.full_name || user.email?.split('@')[0] || null,
        })
        .select('id')
        .maybeSingle()
      if (coachError || !created) {
        console.error('League team: could not create admin coach row:', coachError)
        return NextResponse.json({ error: 'Could not set up your league profile' }, { status: 500 })
      }
      coach = created
    }

    const coachId = (coach as any).id as string

    // One holding season per league season, reused across every team the admin
    // creates, so a thirty-team league does not produce thirty seasons that
    // each vanish the moment their team is claimed.
    const { data: leagueSeason } = leagueSeasonId
      ? await supabaseAdmin
          .from('league_seasons').select('name, starts_at, ends_at').eq('id', leagueSeasonId).maybeSingle()
      : { data: null }

    const seasonName = (leagueSeason as any)?.name || 'League'

    let { data: season } = await supabaseAdmin
      .from('seasons')
      .select('id')
      .eq('coach_id', coachId)
      .eq('name', seasonName)
      .maybeSingle()

    if (!season) {
      const { data: createdSeason, error: seasonError } = await supabaseAdmin
        .from('seasons')
        .insert({
          coach_id: coachId,
          name: seasonName,
          league_type: 'rec',
          start_date: (leagueSeason as any)?.starts_at || null,
          end_date: (leagueSeason as any)?.ends_at || null,
        })
        .select('id')
        .maybeSingle()
      if (seasonError || !createdSeason) {
        console.error('League team: could not create holding season:', seasonError)
        return NextResponse.json({ error: 'Could not create that team' }, { status: 500 })
      }
      season = createdSeason
    }

    const { data: team, error } = await supabaseAdmin
      .from('teams')
      .insert({
        season_id: (season as any).id,
        coach_id: coachId,
        name: trimmed,
        age_group: (ageGroup || '').trim() || null,
        league_id: leagueId,
        league_season_id: leagueSeasonId || null,
        league_division_id: leagueDivisionId || null,
      })
      .select('id, name, age_group, league_division_id')
      .maybeSingle()

    if (error) {
      console.error('Create league team failed:', error)
      return NextResponse.json({ error: 'Could not create that team' }, { status: 500 })
    }

    return NextResponse.json({ team })
  } catch (error: any) {
    console.error('League team POST error:', error)
    return NextResponse.json({ error: 'Could not create that team' }, { status: 500 })
  }
}
