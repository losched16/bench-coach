import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  validateInvitation,
  teamRoleFor,
  decideOwnershipTransfer,
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

// How a refused claim reaches the coach. Every one of these is an EXPECTED
// outcome — the same person clicking twice, a league that has run out of seats,
// a commissioner who revoked it an hour ago — so none of them is a 500, and
// each says what the coach or their commissioner can actually do about it.
const CLAIM_REFUSALS: Record<string, { status: number; message: string }> = {
  not_found: {
    status: 404,
    message: 'We could not find that invitation. Ask your league to send it again.',
  },
  invitation_accepted: {
    status: 410,
    message: 'This invitation has already been used. If that was you, just sign in.',
  },
  invitation_revoked: {
    status: 410,
    message: 'This invitation was withdrawn by your league. Ask your commissioner for a new one.',
  },
  invitation_expired: {
    status: 410,
    message: 'This invitation has expired. Ask your league to send you a new one.',
  },
  league_unlicensed: {
    status: 402,
    message: 'Your league’s BenchCoach access is not active right now. Ask your commissioner to get in touch with us.',
  },
  coach_limit_reached: {
    status: 402,
    message: 'Your league has used all of its BenchCoach seats. Ask your commissioner to add more.',
  },
}

/**
 * Hand a claimed seat back.
 *
 * The route claims the invitation before doing anything else, so every failure
 * after that point has to undo it — otherwise a transient error burns an
 * invitation and a seat, and the coach is told to ask their commissioner for a
 * link that already exists and no longer works.
 *
 * Best effort by design: if the release itself fails there is nothing useful
 * left to do in the request, and a commissioner can always resend. Logged loudly
 * because it is the one path that leaves state needing a human.
 */
async function releaseSeat(invitationId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('bc_release_league_seat', {
    p_invitation_id: invitationId,
  })
  if (error) {
    console.error('League invite: FAILED TO RELEASE SEAT — invitation left accepted', {
      invitationId, error: error.message,
    })
  }
}

/**
 * Is there anything on this team worth protecting?
 *
 * A placeholder team is empty by definition, so any of this means an assumption
 * has already broken — most likely that the team is not really a placeholder at
 * all. The safe response is to leave the data where it is and add the coach as
 * staff instead of moving ownership out from under whoever built it.
 *
 * Counts only. No note, plan body, message or roster detail is read; `head:
 * true` means Postgres returns the count without the rows.
 */
async function hasMeaningfulActivity(teamId: string): Promise<boolean> {
  // Each table named literally rather than looped over a list.
  //
  // A `.from(variable)` cannot be read by scripts/verify-league-privacy.mjs,
  // which refuses computed table names in league routes precisely so that no
  // league surface can reach a table the checker cannot see. This function was
  // the first thing that rule caught, and writing it out is the right answer
  // rather than the exemption — the checker is not wrong just because it is
  // inconvenient here.
  //
  // Counts only: `head: true` returns the count without any rows, so no roster
  // entry, plan body or message is read.
  const count = async (
    query: { count: number | null; error: unknown },
  ) => (query.error ? 0 : query.count || 0)

  const [players, plans, threads, games] = await Promise.all([
    supabaseAdmin.from('team_players').select('id', { count: 'exact', head: true }).eq('team_id', teamId).then(count),
    supabaseAdmin.from('practice_plans').select('id', { count: 'exact', head: true }).eq('team_id', teamId).then(count),
    supabaseAdmin.from('chat_threads').select('id', { count: 'exact', head: true }).eq('team_id', teamId).then(count),
    // `games` was created outside this repo, so a deployment may not have it. An
    // error reads as "no activity from that source" rather than blocking the
    // whole acceptance.
    supabaseAdmin.from('games').select('id', { count: 'exact', head: true }).eq('team_id', teamId).then(count),
  ])

  return players + plans + threads + games > 0
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

    // A coach row, because owning a team requires one and because every other
    // surface in the app assumes it. Created rather than demanded: an invited
    // coach should not have to complete a separate signup before their league's
    // invitation works. is_subscribed is untouched and stays false — this coach
    // has not bought anything, and their access comes from the licence.
    //
    // Done BEFORE the claim on purpose: it is idempotent, it is what signup
    // would have created anyway, and leaving it behind after a lost race costs
    // nothing. Everything after this point is not idempotent, which is why the
    // claim sits between them.
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

    // ── Claim the invitation and a seat, atomically, BEFORE any side effect ──
    //
    // This ordering is the whole fix for the concurrency bug. The previous
    // version created the coach row, moved the team and inserted a membership,
    // and only THEN tried to mark the invitation accepted — so two people
    // opening the same link both did all that work, and the loser found out
    // afterwards with its writes already committed.
    //
    // bc_claim_league_seat() takes a row lock on the licence, re-reads the
    // invitation under it, checks the seat count and flips the status in one
    // transaction. Losing that race now costs nothing, because nothing has
    // happened yet.
    const { data: claimRows, error: claimError } = await supabaseAdmin
      .rpc('bc_claim_league_seat', {
        p_invitation_id: invitation.id,
        p_league_id: invitation.league_id,
      })

    if (claimError) {
      // The function ships in migration 050 alongside the tables this route
      // already read successfully, so a missing function means a partially
      // applied migration. Refusing loudly is right: the alternative is an
      // unguarded fallback that silently reintroduces both races.
      console.error('League invite: seat claim failed:', claimError)
      return NextResponse.json({
        error: 'League support is not fully installed on this environment. Ask your commissioner to contact us.',
        reason: 'claim_unavailable',
      }, { status: 503 })
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows

    if (!claim?.claimed) {
      const reason = claim?.reason || 'not_found'
      const refusal = CLAIM_REFUSALS[reason] || CLAIM_REFUSALS.not_found
      return NextResponse.json({ error: refusal.message, reason }, { status: refusal.status })
    }

    // From here on the invitation is ours. Anything that fails below must hand
    // the seat back — see releaseSeat().
    let teamId = invitation.team_id || null
    let transferred = false

    try {
      if (teamId) {
        const { data: team } = await supabaseAdmin
          .from('teams')
          .select('id, name, coach_id, season_id, league_id, league_placeholder_owner_id')
          .eq('id', teamId)
          .maybeSingle()

        if (!team) {
          await releaseSeat(invitation.id)
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

        // Is anything actually going on here? A placeholder is empty by
        // definition, so activity means an assumption has broken and the safe
        // answer is to leave the data alone and join as staff instead.
        const teamHasActivity = await hasMeaningfulActivity(teamId)

        const decision = decideOwnershipTransfer({
          intendedRole: invitation.intended_role,
          currentOwnerCoachId: (team as any).coach_id || null,
          placeholderOwnerCoachId: (team as any).league_placeholder_owner_id || null,
          currentOwnerUserId: ownerUserId,
          acceptingUserId: userId,
          teamHasActivity,
        })

        if (decision.transfer) {
          // The season is created FIRST, and a failure here aborts before
          // ownership moves.
          //
          // Seasons belong to a coach. If ownership moved while season_id still
          // pointed at the administrator's season, the head coach would own a
          // team whose season row RLS forbids them to read — the incoherent
          // half-state this ordering exists to prevent. The previous version
          // ignored the insert error and transferred anyway.
          //
          // Reused when one of the same name already exists, so a coach
          // accepting two invitations in one league season gets one season
          // rather than two identically named ones.
          const { data: leagueSeason } = invitation.league_season_id
            ? await supabaseAdmin
                .from('league_seasons')
                .select('name, starts_at, ends_at')
                .eq('id', invitation.league_season_id)
                .maybeSingle()
            : { data: null }

          const seasonName = (leagueSeason as any)?.name || 'Season'

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
              console.error('League invite: season creation failed, aborting transfer:', seasonError)
              await releaseSeat(invitation.id)
              return NextResponse.json({
                error: 'Could not set up your season. Nothing was changed — please try again.',
              }, { status: 500 })
            }
            season = createdSeason
          }

          // Compare-and-set on BOTH the owner and the placeholder marker. If
          // another request claimed this team first, zero rows come back and we
          // fall through to membership rather than reporting a phantom success.
          const { data: moved } = await supabaseAdmin
            .from('teams')
            .update({
              coach_id: coachId,
              season_id: (season as any).id,
              // Cleared on claim, so a team can be claimed exactly once and is
              // never transferable again.
              league_placeholder_owner_id: null,
            })
            .eq('id', teamId)
            .eq('coach_id', (team as any).coach_id)
            .eq('league_placeholder_owner_id', (team as any).league_placeholder_owner_id)
            .select('id')

          transferred = Array.isArray(moved) && moved.length > 0

          if (!transferred) {
            console.warn('League invite: team was claimed concurrently, joining as staff instead', { teamId })
          }
        }

        // Not the owner — join as staff. This covers every non-transfer path:
        // an assistant coach, a head coach invited to a team a real coach
        // already runs, a team with activity on it, and the loser of a
        // concurrent claim. Already-a-member is not an error; a coach who
        // clicks twice should land on their dashboard, not on a complaint.
        if (!transferred && ownerUserId !== userId) {
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

            // A duplicate here is the same coach arriving twice at once, which
            // is a success, not a failure.
            if (memberError && (memberError as any).code !== '23505') {
              console.error('League invite: could not add team member:', memberError)
              await releaseSeat(invitation.id)
              return NextResponse.json({
                error: 'Could not add you to that team. Nothing was changed — please try again.',
              }, { status: 500 })
            }
          }
        }
      }
    } catch (teamError: any) {
      // Any unexpected throw in the team work hands the seat back, so a
      // transient failure does not burn an invitation.
      console.error('League invite: team setup threw, releasing seat:', teamError)
      await releaseSeat(invitation.id)
      return NextResponse.json({
        error: 'Could not finish setting up your team. Nothing was changed — please try again.',
      }, { status: 500 })
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
    ]).then(
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
      seatsUsed: claim.seats_used ?? null,
      coachLimit: claim.coach_limit ?? null,
    })
  } catch (error: any) {
    console.error('League invite POST error:', error)
    return NextResponse.json({ error: 'Could not accept that invitation' }, { status: 500 })
  }
}
