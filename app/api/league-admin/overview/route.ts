import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague } from '@/lib/leagueAuthz'
import { isTeamSponsored, LicenseRow } from '@/lib/leagueEntitlements'

// Never prerendered. Reads the session cookie to decide who is calling.
export const dynamic = 'force-dynamic'

// Everything the commissioner's dashboard shows, in one authorized read.
//
// WHAT THIS DELIBERATELY NEVER SELECTS
//
// chat_messages.content. player_notes.note. team_notes.note.
// player_traits.note. scouting_entries. observations. practice_plans.content.
// prescriptions.summary. Not filtered out afterwards — never named in a select
// at all, so there is no version of this handler where a bug leaks them.
//
// The line is counts and timestamps versus free text. A commissioner may know
// that a coach has written eleven practice plans and was last active on Tuesday.
// They may not know what any of them say. That distinction is the entire reason
// a league can be sold this without asking coaches to give up the privacy that
// makes them write anything down in the first place.
//
// This runs with the service role, so RLS is not protecting it — guardLeague()
// is. It is the first statement in the handler for that reason.
//
// A NOTE ON ATTRIBUTION
//
// practice_plans has no author column; it is scoped to a team. So "practice
// plans" on a coach row is that coach's TEAM's plan count, not a personal
// tally, and the UI says so. Inventing per-coach attribution we cannot actually
// derive would be a fake metric, which is worse than an honest team-level one.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const DAY = 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const denied = await guardLeague(request, 'view')
  if (denied) return denied

  try {
    const leagueId = new URL(request.url).searchParams.get('leagueId')!
    const now = new Date()

    const [{ data: league }, { data: seasons }, { data: divisions }, { data: licenses }] =
      await Promise.all([
        supabaseAdmin
          .from('leagues')
          .select('id, name, slug, logo_url, website, city, state, governing_body, status')
          .eq('id', leagueId)
          .maybeSingle(),
        supabaseAdmin
          .from('league_seasons')
          .select('id, name, status, starts_at, ends_at')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('league_divisions')
          .select('id, name, age_group, league_season_id')
          .eq('league_id', leagueId)
          .order('name'),
        supabaseAdmin
          .from('league_licenses')
          .select('id, league_id, status, plan, coach_limit, starts_at, ends_at')
          .eq('league_id', leagueId),
      ])

    if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const seasonList = (seasons || []) as any[]
    const activeSeason = seasonList.find(s => s.status === 'active') || seasonList[0] || null

    // Teams. Nothing sensitive on this table — a name, an age group and who
    // owns it — but note that practice_days and primary_goals are not selected
    // either. The commissioner does not need them and every column not asked
    // for is one that cannot leak.
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, name, age_group, coach_id, league_division_id, league_season_id')
      .eq('league_id', leagueId)

    const teamList = (teams || []) as any[]
    const teamIds = teamList.map(t => t.id)

    const [{ data: invitations }, { data: members }, { data: ownerCoaches }] = await Promise.all([
      supabaseAdmin
        .from('league_invitations')
        .select('id, email, intended_role, status, team_id, league_division_id, invited_at, accepted_at, expires_at')
        .eq('league_id', leagueId)
        .order('invited_at', { ascending: false }),
      teamIds.length
        ? supabaseAdmin.from('team_members').select('team_id, user_id, role').in('team_id', teamIds)
        : Promise.resolve({ data: [] as any[] }),
      teamList.length
        ? supabaseAdmin
            .from('coaches')
            .select('id, user_id, display_name')
            .in('id', Array.from(new Set(teamList.map(t => t.coach_id).filter(Boolean))))
        : Promise.resolve({ data: [] as any[] }),
    ])

    const inviteList = (invitations || []) as any[]
    const memberList = (members || []) as any[]
    const ownerList = (ownerCoaches || []) as any[]

    const ownerByCoachId = new Map(ownerList.map(c => [c.id, c]))

    // Everyone who can currently open one of this league's teams: owners and
    // staff. This is the set adoption is measured over.
    const coachUserIds = Array.from(new Set([
      ...ownerList.map(c => c.user_id),
      ...memberList.map(m => m.user_id),
    ].filter(Boolean)))

    // Names only, for people who arrived without an invitation.
    const { data: allCoachRows } = coachUserIds.length
      ? await supabaseAdmin.from('coaches').select('id, user_id, display_name').in('user_id', coachUserIds)
      : { data: [] as any[] }
    const coachByUserId = new Map(((allCoachRows || []) as any[]).map(c => [c.user_id, c]))

    // Activity, as metadata. user_id and created_at — never event_name payloads,
    // never page paths. Thirty days is enough to answer both "active this week"
    // and "when did we last see them", and bounding it keeps this cheap.
    const since = new Date(now.getTime() - 30 * DAY).toISOString()
    const { data: events } = coachUserIds.length
      ? await supabaseAdmin
          .from('user_events')
          .select('user_id, created_at')
          .in('user_id', coachUserIds)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10000)
      : { data: [] as any[] }

    const lastActive = new Map<string, string>()
    for (const e of ((events || []) as any[])) {
      // Ordered newest first, so the first sighting of a user is their latest.
      if (!lastActive.has(e.user_id)) lastActive.set(e.user_id, e.created_at)
    }

    const sevenDaysAgo = now.getTime() - 7 * DAY
    const activeLast7 = new Set(
      Array.from(lastActive.entries())
        .filter(([, at]) => new Date(at).getTime() >= sevenDaysAgo)
        .map(([uid]) => uid)
    )

    // Counts per team. Ids and team_id only — no titles, no content.
    const [{ data: plans }, { data: threads }] = await Promise.all([
      teamIds.length
        ? supabaseAdmin.from('practice_plans').select('id, team_id, created_at').in('team_id', teamIds)
        : Promise.resolve({ data: [] as any[] }),
      teamIds.length
        ? supabaseAdmin.from('chat_threads').select('id, team_id').in('team_id', teamIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const plansByTeam = new Map<string, number>()
    for (const p of ((plans || []) as any[])) {
      plansByTeam.set(p.team_id, (plansByTeam.get(p.team_id) || 0) + 1)
    }
    const chatTeams = new Set(((threads || []) as any[]).map(t => t.team_id))

    const divisionById = new Map(((divisions || []) as any[]).map(d => [d.id, d]))
    const teamById = new Map(teamList.map(t => [t.id, t]))

    const membersByTeam = new Map<string, any[]>()
    for (const m of memberList) {
      membersByTeam.set(m.team_id, [...(membersByTeam.get(m.team_id) || []), m])
    }

    // ── Team rows ──────────────────────────────────────
    const teamRows = teamList.map(t => {
      const owner = ownerByCoachId.get(t.coach_id)
      const staff = membersByTeam.get(t.id) || []
      const ownerActivated = !!owner?.user_id && lastActive.has(owner.user_id)
      return {
        id: t.id,
        name: t.name,
        ageGroup: t.age_group,
        divisionName: divisionById.get(t.league_division_id)?.name || null,
        headCoachName: owner?.display_name || null,
        assistantCount: staff.length,
        // A team is activated once somebody has actually opened it, not merely
        // once it exists. A team the league created and nobody claimed is the
        // number a commissioner most needs to see.
        activated: ownerActivated || staff.some(s => lastActive.has(s.user_id)),
        practicePlans: plansByTeam.get(t.id) || 0,
        chatUsed: chatTeams.has(t.id),
      }
    })

    // ── Coach rows ─────────────────────────────────────
    // Driven by invitations first, because that is what the commissioner sent
    // and "who has not accepted" is the number they came here for. Coaches who
    // arrived another way are appended so the table is not quietly incomplete.
    const seenUsers = new Set<string>()
    const coachRows: any[] = []

    for (const inv of inviteList) {
      const team = inv.team_id ? teamById.get(inv.team_id) : null
      const owner = team ? ownerByCoachId.get(team.coach_id) : null
      const staff = team ? (membersByTeam.get(team.id) || []) : []

      // Which real user this invitation became, when we can tell. Matched by
      // team rather than by email: the accept flow deliberately allows a coach
      // to accept while signed in as a different address.
      const candidate = inv.status === 'accepted'
        ? (inv.intended_role === 'head_coach' && owner ? owner.user_id : staff[0]?.user_id) || null
        : null
      if (candidate) seenUsers.add(candidate)

      coachRows.push({
        kind: 'invitation',
        invitationId: inv.id,
        name: candidate ? (coachByUserId.get(candidate)?.display_name || null) : null,
        email: inv.email,
        role: inv.intended_role,
        teamId: inv.team_id,
        teamName: team?.name || null,
        divisionName: divisionById.get(inv.league_division_id || team?.league_division_id)?.name || null,
        inviteStatus: inv.status,
        invitedAt: inv.invited_at,
        acceptedAt: inv.accepted_at,
        expiresAt: inv.expires_at,
        activated: inv.status === 'accepted' && !!candidate && lastActive.has(candidate),
        lastActiveAt: candidate ? (lastActive.get(candidate) || null) : null,
        practicePlans: inv.team_id ? (plansByTeam.get(inv.team_id) || 0) : 0,
        chatUsed: inv.team_id ? chatTeams.has(inv.team_id) : false,
      })
    }

    for (const t of teamList) {
      const owner = ownerByCoachId.get(t.coach_id)
      const people = [
        ...(owner?.user_id ? [{ user_id: owner.user_id, role: 'head_coach' }] : []),
        ...(membersByTeam.get(t.id) || []).map(m => ({ user_id: m.user_id, role: m.role })),
      ]
      for (const p of people) {
        if (!p.user_id || seenUsers.has(p.user_id)) continue
        seenUsers.add(p.user_id)
        coachRows.push({
          kind: 'member',
          invitationId: null,
          name: coachByUserId.get(p.user_id)?.display_name || null,
          // No email. Reading auth.users in bulk to decorate a report is more
          // access than this screen needs, and an invitation is where an email
          // legitimately comes from.
          email: null,
          role: p.role,
          teamId: t.id,
          teamName: t.name,
          divisionName: divisionById.get(t.league_division_id)?.name || null,
          inviteStatus: null,
          invitedAt: null,
          acceptedAt: null,
          expiresAt: null,
          activated: lastActive.has(p.user_id),
          lastActiveAt: lastActive.get(p.user_id) || null,
          practicePlans: plansByTeam.get(t.id) || 0,
          chatUsed: chatTeams.has(t.id),
        })
      }
    }

    // ── Divisions ──────────────────────────────────────
    const divisionRows = ((divisions || []) as any[]).map(d => {
      const dTeams = teamList.filter(t => t.league_division_id === d.id)
      const dTeamIds = new Set(dTeams.map(t => t.id))
      const dInvites = inviteList.filter(i =>
        i.league_division_id === d.id || (i.team_id && dTeamIds.has(i.team_id)))
      const dRows = coachRows.filter(c => c.teamId && dTeamIds.has(c.teamId))
      return {
        id: d.id,
        name: d.name,
        ageGroup: d.age_group,
        seasonId: d.league_season_id,
        teams: dTeams.length,
        coachesInvited: dInvites.filter(i => i.status !== 'revoked').length,
        coachesActivated: dInvites.filter(i => i.status === 'accepted').length,
        activeCoaches: dRows.filter(c => c.activated).length,
      }
    })

    // ── Licence ────────────────────────────────────────
    const licensed = isTeamSponsored(leagueId, (licenses || []) as LicenseRow[], now)
    const liveLicense = ((licenses || []) as any[]).find(l => ['trial', 'active'].includes(l.status)) || null
    const seatsUsed = inviteList.filter(i => i.status === 'accepted').length

    return NextResponse.json({
      league: {
        id: (league as any).id,
        name: (league as any).name,
        slug: (league as any).slug,
        logoUrl: (league as any).logo_url,
        website: (league as any).website,
        city: (league as any).city,
        state: (league as any).state,
        governingBody: (league as any).governing_body,
        status: (league as any).status,
      },
      seasons: seasonList.map(s => ({
        id: s.id, name: s.name, status: s.status, startsAt: s.starts_at, endsAt: s.ends_at,
      })),
      activeSeason: activeSeason
        ? { id: activeSeason.id, name: activeSeason.name, status: activeSeason.status }
        : null,
      license: {
        licensed,
        status: liveLicense?.status || null,
        plan: liveLicense?.plan || null,
        coachLimit: liveLicense?.coach_limit ?? null,
        endsAt: liveLicense?.ends_at || null,
        seatsUsed,
      },
      kpis: {
        coachesInvited: inviteList.filter(i => i.status !== 'revoked').length,
        coachesActivated: inviteList.filter(i => i.status === 'accepted').length,
        teams: teamList.length,
        activeCoachesLast7Days: Array.from(activeLast7).length,
        practicePlansCreated: ((plans || []) as any[]).length,
        // Said out loud rather than buried. "Active" is derived from
        // user_events, which is written by the dashboard pages a coach visits.
        // A coach who accepted but has never opened the app has no rows there
        // and correctly reads as never active — but so would a coach using a
        // surface that does not track, so this is a floor rather than a
        // precise count. The UI labels it accordingly.
        activityWindowDays: 7,
        activitySource: 'user_events',
      },
      divisions: divisionRows,
      teams: teamRows,
      coaches: coachRows,
    })
  } catch (error: any) {
    console.error('League overview error:', error)
    return NextResponse.json({ error: 'Could not load your league' }, { status: 500 })
  }
}
