import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague } from '@/lib/leagueAuthz'
import { sessionClient } from '@/lib/authz'
import { generateInviteToken, inviteExpiry, isIntendedRole } from '@/lib/leagueInvites'
import { deliverLeagueInvite } from '@/lib/leagueInviteEmail'

export const dynamic = 'force-dynamic'

// Inviting a coach, resending, and revoking.
//
// The invite URL is returned on every path that creates or refreshes a token,
// because there is no email transport in this project (see
// lib/leagueInviteEmail.ts) and a commissioner sending these from their own
// address needs the link in front of them. When a sender is wired up, the link
// stays — a commissioner texting a coach who never opens email is not an edge
// case in youth sports.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function inviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/league/invite/${token}`
}

// POST — invite a coach, or resend an existing invitation with a fresh token.
export async function POST(request: NextRequest) {
  const denied = await guardLeague(request, 'manage')
  if (denied) return denied

  try {
    const body = await request.json()
    const { leagueId, email, teamId, leagueSeasonId, leagueDivisionId, intendedRole, resendId } = body

    const supabase = await sessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'You need to be signed in' }, { status: 401 })

    const { data: league } = await supabaseAdmin
      .from('leagues').select('id, name').eq('id', leagueId).maybeSingle()
    if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ── Resend ───────────────────────────────────────
    // A new token and a new clock, on the row the commissioner is already
    // looking at. Rotating the token matters: the old link may be sitting in a
    // forwarded email, and "resend" should not leave two live credentials for
    // one seat.
    if (resendId) {
      const { data: existing } = await supabaseAdmin
        .from('league_invitations')
        .select('id, email, team_id, intended_role, status')
        .eq('id', resendId)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (!existing) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
      if ((existing as any).status === 'accepted') {
        return NextResponse.json({
          error: 'That coach has already accepted — there is nothing to resend.',
        }, { status: 400 })
      }

      const token = generateInviteToken()
      const { data: updated, error } = await supabaseAdmin
        .from('league_invitations')
        .update({
          invite_token: token,
          status: 'pending',
          expires_at: inviteExpiry(),
          invited_at: new Date().toISOString(),
          invited_by: user.id,
        })
        .eq('id', resendId)
        .select('id, email, status, team_id, intended_role, invited_at, expires_at')
        .maybeSingle()

      if (error) {
        console.error('Resend league invitation failed:', error)
        return NextResponse.json({ error: 'Could not resend that invitation' }, { status: 500 })
      }

      const { data: team } = (updated as any)?.team_id
        ? await supabaseAdmin.from('teams').select('name').eq('id', (updated as any).team_id).maybeSingle()
        : { data: null }

      const delivery = await deliverLeagueInvite({
        to: (updated as any).email,
        leagueName: (league as any).name,
        teamName: (team as any)?.name || null,
        inviteUrl: inviteUrl(token),
        intendedRole: (updated as any).intended_role,
      })

      return NextResponse.json({ invitation: updated, inviteUrl: inviteUrl(token), delivery })
    }

    // ── New invitation ───────────────────────────────
    const address = (email || '').trim()
    if (!address || !address.includes('@')) {
      return NextResponse.json({ error: 'Enter the coach’s email address' }, { status: 400 })
    }

    const role = isIntendedRole(intendedRole) ? intendedRole : 'head_coach'

    // Ids from the body are claims; guardLeague only vouched for leagueId.
    if (teamId) {
      const { data: team } = await supabaseAdmin
        .from('teams').select('id').eq('id', teamId).eq('league_id', leagueId).maybeSingle()
      if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Already here? Re-inviting somebody who has accepted is a mistake worth
    // catching, not a second seat.
    const { data: already } = await supabaseAdmin
      .from('league_invitations')
      .select('id, status')
      .eq('league_id', leagueId)
      .ilike('email', address)
      .eq('status', 'accepted')
      .maybeSingle()

    if (already) {
      return NextResponse.json({
        error: 'That coach has already accepted an invitation to this league.',
      }, { status: 409 })
    }

    const token = generateInviteToken()

    // Upsert onto the partial unique index from migration 050 — one pending
    // invitation per email per league. Re-inviting somebody who has not
    // accepted refreshes the row the commissioner is looking at, rather than
    // creating a second one that makes "coaches invited" count them twice.
    const { data: pending } = await supabaseAdmin
      .from('league_invitations')
      .select('id')
      .eq('league_id', leagueId)
      .ilike('email', address)
      .eq('status', 'pending')
      .maybeSingle()

    const values = {
      league_id: leagueId,
      league_season_id: leagueSeasonId || null,
      league_division_id: leagueDivisionId || null,
      team_id: teamId || null,
      email: address,
      intended_role: role,
      invite_token: token,
      status: 'pending',
      invited_by: user.id,
      invited_at: new Date().toISOString(),
      expires_at: inviteExpiry(),
    }

    const { data: invitation, error } = pending
      ? await supabaseAdmin
          .from('league_invitations').update(values).eq('id', (pending as any).id)
          .select('id, email, status, team_id, intended_role, invited_at, expires_at').maybeSingle()
      : await supabaseAdmin
          .from('league_invitations').insert(values)
          .select('id, email, status, team_id, intended_role, invited_at, expires_at').maybeSingle()

    if (error) {
      // 23505 is the partial unique index from migration 050 doing its job:
      // one pending invitation per email per league. The select-then-insert
      // above is not atomic, so two commissioners inviting the same coach at
      // the same moment race, and the loser lands here.
      //
      // That is an EXPECTED outcome, not a server fault. It used to surface as
      // a generic 500 — "Could not create that invitation" — which reads as
      // "the product is broken" when the truth is "your colleague just did
      // this". The index is what guarantees only one row exists; this only
      // decides how the loser is told.
      if ((error as any).code === '23505') {
        return NextResponse.json({
          error: 'This coach already has a pending invitation to this league.',
          reason: 'already_invited',
        }, { status: 409 })
      }
      console.error('Create league invitation failed:', error)
      return NextResponse.json({ error: 'Could not create that invitation' }, { status: 500 })
    }

    const { data: team } = teamId
      ? await supabaseAdmin.from('teams').select('name').eq('id', teamId).maybeSingle()
      : { data: null }

    const delivery = await deliverLeagueInvite({
      to: address,
      leagueName: (league as any).name,
      teamName: (team as any)?.name || null,
      inviteUrl: inviteUrl(token),
      intendedRole: role,
    })

    // Metadata only: that an invitation was sent, and to which league. Not the
    // address — an event log is not the place for a second copy of it.
    await supabaseAdmin.from('user_events').insert({
      user_id: user.id,
      event_type: 'league',
      event_name: 'league_invitation_sent',
      metadata: { league_id: leagueId, team_id: teamId || null, intended_role: role },
    }).then(() => {}, () => {})

    return NextResponse.json({ invitation, inviteUrl: inviteUrl(token), delivery })
  } catch (error: any) {
    console.error('League invitation POST error:', error)
    return NextResponse.json({ error: 'Could not create that invitation' }, { status: 500 })
  }
}

// DELETE — revoke a pending invitation.
export async function DELETE(request: NextRequest) {
  const denied = await guardLeague(request, 'manage')
  if (denied) return denied

  try {
    const url = new URL(request.url)
    const leagueId = url.searchParams.get('leagueId')
    const id = url.searchParams.get('id')

    if (!id) return NextResponse.json({ error: 'Missing invitation id' }, { status: 400 })

    // Scoped to the league the caller was authorized against, so an
    // administrator of one league cannot revoke another league's invitation by
    // id. Revoked rather than deleted: the commissioner's report should still
    // show that it was sent and withdrawn.
    const { data, error } = await supabaseAdmin
      .from('league_invitations')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('league_id', leagueId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Revoke league invitation failed:', error)
      return NextResponse.json({ error: 'Could not revoke that invitation' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({
        error: 'That invitation is not pending any more — it may already have been accepted.',
      }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('League invitation DELETE error:', error)
    return NextResponse.json({ error: 'Could not revoke that invitation' }, { status: 500 })
  }
}
