import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  validateInvitation,
  teamRoleFor,
  shouldTransferOwnership,
  withinCoachLimit,
  LeagueInvitationRow,
} from '@/lib/leagueInvites'
import { isTeamSponsored, LicenseRow } from '@/lib/leagueEntitlements'

// Never prerendered. Reads a token and a session; both are per-request, and
// Next's build-time prerender pass hands the handler a stand-in Request whose
// .url and .method throw when touched.
export const dynamic = 'force-dynamic'

// Accepting a league invitation.
//
// Modelled directly on app/api/team/invite/accept/route.ts, which is why it is
// exempt from verify:authz for the same reason that one is: the TOKEN is the
// credential. The caller is not a member of anything yet, so there is no
// membership to check — what stands in for authorization is that they produced
// an unguessable 256-bit token that we issued, and every other property of the
// invitation is re-validated here against the database rather than trusted from
// the request.
//
// The client sends a userId. That is not trusted as identity on its own: it is
// verified against auth.admin.getUserById before anything is written, exactly
// as the team invite route does.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const INVITATION_COLUMNS =
  'id, league_id, league_season_id, league_division_id, team_id, email, intended_role, invite_token, status, invited_by, invited_at, accepted_at, expires_at'

/**
 * Is the league that issued this invitation actually paying?
 *
 * Checked at acceptance as well as at invitation, because the two can be weeks
 * apart. An invitation sent in February against a licence that lapsed in March
 * must not still hand out access in April.
 */
async function leagueIsPaying(leagueId: string): Promise<boolean> {
  const { data: licenses } = await supabaseAdmin
    .from('league_licenses')
    .select('id, league_id, status, starts_at, ends_at')
    .eq('league_id', leagueId)

  return isTeamSponsored(leagueId, (licenses || []) as LicenseRow[], new Date())
}

// GET — what this invitation says, for the screen that renders before anyone
// has signed in. Returns no token, no email address of the inviter, and nothing
// about any other coach: just the league, the team and the role, which is what
// the coach needs to decide whether this is really theirs.
export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const { data: invitation } = await supabaseAdmin
      .from('league_invitations')
      .select(INVITATION_COLUMNS)
      .eq('invite_token', token)
      .maybeSingle()

    const verdict = validateInvitation(invitation as LeagueInvitationRow | null)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.message, reason: verdict.reason }, { status: verdict.status })
    }

    const inv = invitation as unknown as LeagueInvitationRow

    const [{ data: league }, { data: team }, { data: division }] = await Promise.all([
      supabaseAdmin.from('leagues').select('id, name, logo_url, city, state').eq('id', inv.league_id).maybeSingle(),
      inv.team_id
        ? supabaseAdmin.from('teams').select('id, name, age_group').eq('id', inv.team_id).maybeSingle()
        : Promise.resolve({ data: null }),
      inv.league_division_id
        ? supabaseAdmin.from('league_divisions').select('id, name').eq('id', inv.league_division_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    // A league whose licence has lapsed between sending and opening. Said
    // plainly rather than as "invalid invitation", because the coach did
    // nothing wrong and their commissioner is the one who can fix it.
    const licensed = await leagueIsPaying(inv.league_id)

    return NextResponse.json({
      invitation: {
        id: inv.id,
        email: inv.email,
        intendedRole: inv.intended_role,
        leagueName: (league as any)?.name || 'Your league',
        leagueLogoUrl: (league as any)?.logo_url || null,
        teamId: (team as any)?.id || null,
        teamName: (team as any)?.name || null,
        teamAgeGroup: (team as any)?.age_group || null,
        divisionName: (division as any)?.name || null,
        licensed,
      },
    })
  } catch (error: any) {
    console.error('League invite GET error:', error)
    return NextResponse.json({ error: 'Could not load that invitation' }, { status: 500 })
  }
}

// POST — accept it.
export async function POST(request: NextRequest) {
  try {
    const { token, userId } = await request.json()

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    if (!userId) {
      return NextResponse.json({ error: 'You need to be signed in to accept this invitation' }, { status: 401 })
    }

    // The userId in the body is a claim. This is what makes it a fact.
    const { data: userCheck } = await supabaseAdmin.auth.admin.getUserById(userId)
    const user = userCheck?.user
    if (!user) return NextResponse.json({ error: 'Invalid user' }, { status: 401 })

    const { data: invitationRow } = await supabaseAdmin
      .from('league_invitations')
      .select(INVITATION_COLUMNS)
      .eq('invite_token', token)
      .maybeSingle()

    // Re-validated server-side. The GET above already refused the dead cases,
    // but that was a different request and the client is not the authority on
    // any of this.
    const verdict = validateInvitation(invitationRow as LeagueInvitationRow | null, new Date(), user.email)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.message, reason: verdict.reason }, { status: verdict.status })
    }

    const invitation = invitationRow as unknown as LeagueInvitationRow

    if (!(await leagueIsPaying(invitation.league_id))) {
      return NextResponse.json({
        error: 'Your league’s BenchCoach access is not active right now. Ask your commissioner to get in touch with us.',
        reason: 'league_unlicensed',
      }, { status: 402 })
    }

    // Seats. Counted against invitations already accepted for this league, so a
    // commissioner can send more invitations than seats and have the overflow
    // fail here rather than being blocked from inviting at all.
    const [{ data: license }, { count: acceptedCount }] = await Promise.all([
      supabaseAdmin
        .from('league_licenses')
        .select('coach_limit')
        .eq('league_id', invitation.league_id)
        .in('status', ['trial', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('league_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', invitation.league_id)
        .eq('status', 'accepted'),
    ])

    if (!withinCoachLimit((license as any)?.coach_limit ?? null, acceptedCount || 0)) {
      return NextResponse.json({
        error: 'Your league has used all of its BenchCoach seats. Ask your commissioner to add more.',
        reason: 'coach_limit_reached',
      }, { status: 402 })
    }

    // A coach row, because owning a team requires one and because every other
    // surface in the app assumes it. Created rather than demanded: an invited
    // coach should not have to complete a separate signup before their league's
    // invitation works. is_subscribed is untouched and stays false — this coach
    // has not bought anything, and their access comes from the licence.
    let { data: coach } = await supabaseAdmin
      .from('coaches')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!coach) {
      const { data: created, error: coachError } = await supabaseAdmin
        .from('coaches')
        .insert({
          user_id: userId,
          display_name: (user.user_metadata as any)?.full_name || user.email?.split('@')[0] || null,
        })
        .select('id')
        .maybeSingle()

      if (coachError || !created) {
        console.error('League invite: could not create coach row:', coachError)
        return NextResponse.json({ error: 'Could not set up your coach profile' }, { status: 500 })
      }
      coach = created
    }

    const coachId = (coach as any).id as string
    let teamId = invitation.team_id || null
    let transferred = false

    if (teamId) {
      const { data: team } = await supabaseAdmin
        .from('teams')
        .select('id, name, coach_id, season_id, league_id')
        .eq('id', teamId)
        .maybeSingle()

      if (!team) {
        return NextResponse.json({
          error: 'The team on this invitation no longer exists. Ask your league to send a new one.',
        }, { status: 410 })
      }

      const { data: ownerCoach } = await supabaseAdmin
        .from('coaches')
        .select('id, user_id')
        .eq('id', (team as any).coach_id)
        .maybeSingle()

      const ownerUserId = (ownerCoach as any)?.user_id || null

      // Is the current owner a placeholder — an administrator of this league
      // who created the team so it could exist — or a real coach already
      // running it? Only the former may be displaced.
      let ownerIsLeagueAdmin = false
      if (ownerUserId) {
        const { data: adminRow } = await supabaseAdmin
          .from('league_members')
          .select('id')
          .eq('league_id', invitation.league_id)
          .eq('user_id', ownerUserId)
          .maybeSingle()
        ownerIsLeagueAdmin = !!adminRow
      }

      if (shouldTransferOwnership({
        intendedRole: invitation.intended_role,
        currentOwnerUserId: ownerUserId,
        acceptingUserId: userId,
        currentOwnerIsLeagueAdmin: ownerIsLeagueAdmin,
      })) {
        // The team moves to this coach, along with a season of their own.
        //
        // The season has to move too: seasons belong to a coach, and leaving
        // the team pointing at the administrator's season would give the head
        // coach a team whose season row RLS will not let them read. Nothing is
        // deleted — the administrator's season stays exactly where it is for
        // whichever teams have not been claimed yet.
        const { data: leagueSeason } = invitation.league_season_id
          ? await supabaseAdmin
              .from('league_seasons')
              .select('name, starts_at, ends_at')
              .eq('id', invitation.league_season_id)
              .maybeSingle()
          : { data: null }

        const { data: season } = await supabaseAdmin
          .from('seasons')
          .insert({
            coach_id: coachId,
            name: (leagueSeason as any)?.name || 'Season',
            league_type: 'rec',
            start_date: (leagueSeason as any)?.starts_at || null,
            end_date: (leagueSeason as any)?.ends_at || null,
          })
          .select('id')
          .maybeSingle()

        const update: Record<string, any> = { coach_id: coachId }
        if ((season as any)?.id) update.season_id = (season as any).id

        const { error: transferError } = await supabaseAdmin
          .from('teams')
          .update(update)
          .eq('id', teamId)
          // Guard against a race: only transfer if the team is STILL owned by
          // the placeholder we checked. Two head coaches opening the same
          // invitation link at once must not both believe they own it.
          .eq('coach_id', (team as any).coach_id)

        if (transferError) {
          console.error('League invite: ownership transfer failed:', transferError)
          return NextResponse.json({ error: 'Could not set up your team' }, { status: 500 })
        }
        transferred = true
      } else if (ownerUserId !== userId) {
        // Not the owner — join as staff. Already-a-member is not an error: a
        // coach who clicks an invitation twice should land on their dashboard,
        // not on a complaint.
        const { data: existing } = await supabaseAdmin
          .from('team_members')
          .select('id')
          .eq('team_id', teamId)
          .eq('user_id', userId)
          .maybeSingle()

        if (!existing) {
          const { error: memberError } = await supabaseAdmin
            .from('team_members')
            .insert({
              team_id: teamId,
              user_id: userId,
              role: teamRoleFor(invitation.intended_role),
              invited_by: invitation.invited_by,
            })

          if (memberError) {
            console.error('League invite: could not add team member:', memberError)
            return NextResponse.json({ error: 'Could not add you to that team' }, { status: 500 })
          }
        }
      }
    }

    // Mark it used. Conditional on status = 'pending' so two simultaneous
    // accepts cannot both stamp it, and so a revoked-in-the-meantime invitation
    // is not resurrected by a request that started before the revocation.
    const { data: claimed } = await supabaseAdmin
      .from('league_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (!claimed) {
      return NextResponse.json({
        error: 'This invitation has already been used. If that was you, just sign in.',
        reason: 'already_accepted',
      }, { status: 410 })
    }

    // Adoption, as metadata. Two events rather than one because a commissioner
    // asks two different questions: how many have accepted, and how many are
    // actually using it. Nothing here records what the coach does or says.
    await supabaseAdmin.from('user_events').insert([
      {
        user_id: userId,
        event_type: 'league',
        event_name: 'league_invitation_accepted',
        metadata: {
          league_id: invitation.league_id,
          team_id: teamId,
          intended_role: invitation.intended_role,
          transferred_ownership: transferred,
        },
      },
      {
        user_id: userId,
        event_type: 'league',
        event_name: 'coach_activated',
        metadata: { league_id: invitation.league_id, team_id: teamId },
      },
    ]).select('id').maybeSingle().then(
      () => {},
      // Tracking must never be the reason an invitation fails to land.
      (e: any) => console.warn('League invite: event logging failed:', e?.message)
    )

    return NextResponse.json({
      success: true,
      teamId,
      leagueId: invitation.league_id,
      transferred,
      emailMismatch: !!verdict.emailMismatch,
    })
  } catch (error: any) {
    console.error('League invite POST error:', error)
    return NextResponse.json({ error: 'Could not accept that invitation' }, { status: 500 })
  }
}
