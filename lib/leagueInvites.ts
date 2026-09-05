import crypto from 'crypto'
import type { Role } from './authz'

// League invitations: the rules, with no database attached.
//
// The validation lives here as a pure function rather than inline in the accept
// route for one reason — an invitation is a bearer credential, and the four
// ways it can be invalid (expired, revoked, already used, unknown) are exactly
// the four cases nobody writes a test for when they are twelve lines inside a
// handler that also does I/O. Here they are trivially testable, and
// scripts/test-league-invites.ts tests them.

export type IntendedRole = 'head_coach' | 'assistant_coach'
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

// 30 days, against the team invite's 7. A league sends these in a batch in
// February for a season that starts in April, and a coach who opens the email
// in March should not find a dead link.
export const LEAGUE_INVITE_TTL_DAYS = 30

export interface LeagueInvitationRow {
  id: string
  league_id: string
  league_season_id?: string | null
  league_division_id?: string | null
  team_id?: string | null
  email: string
  intended_role: string
  invite_token: string
  status: string
  invited_by?: string | null
  invited_at?: string | null
  accepted_at?: string | null
  expires_at?: string | null
}

export function generateInviteToken(): string {
  // Same shape and entropy as the team invite token in
  // app/api/team/invite/route.ts. 256 bits: not guessable, and short enough to
  // survive being pasted into a text message.
  return crypto.randomBytes(32).toString('hex')
}

/**
 * What a coach becomes on the team they were invited to.
 *
 * head_coach maps to 'owner' only through an ownership transfer the accept
 * route performs deliberately and conditionally — see claimTeamOwnership().
 * When that transfer does not apply (the team already has a real coach), the
 * head coach lands as 'admin': everything except staff and billing.
 *
 * assistant_coach is 'contributor', which is the record-don't-decide role from
 * migration 034. An assistant logs what happened; they do not redraw the roster
 * or change the season's priorities.
 */
export function teamRoleFor(intendedRole: string): Role {
  return intendedRole === 'head_coach' ? 'admin' : 'contributor'
}

export function isIntendedRole(value: unknown): value is IntendedRole {
  return value === 'head_coach' || value === 'assistant_coach'
}

export type InvitationRefusal =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'already_accepted'
  | 'unknown_status'

export interface InvitationVerdict {
  ok: boolean
  reason?: InvitationRefusal
  // Shown to the coach verbatim. An invitation screen that says "invalid" has
  // told someone holding a real email from their league that we are broken.
  message?: string
  // HTTP status for the route. 410 Gone for an invitation that existed and no
  // longer works, which is the honest code and distinguishes it from a typo.
  status?: number
  // Not a refusal. The invitation was addressed to one email and the person
  // holding it is signed in as another — see acceptance below.
  emailMismatch?: boolean
}

/**
 * Is this invitation usable right now, by this signed-in address?
 *
 * `now` and `callerEmail` are parameters rather than ambient so this stays
 * pure. Pass callerEmail as null when nobody is signed in yet: the invitation
 * screen renders before authentication, and a valid invitation must be
 * readable by a coach who has not made an account.
 */
export function validateInvitation(
  invitation: LeagueInvitationRow | null | undefined,
  now: Date = new Date(),
  callerEmail?: string | null
): InvitationVerdict {
  if (!invitation) {
    return {
      ok: false,
      reason: 'not_found',
      status: 404,
      message: 'We could not find that invitation. Check the link, or ask your league to send it again.',
    }
  }

  if (invitation.status === 'revoked') {
    return {
      ok: false,
      reason: 'revoked',
      status: 410,
      message: 'This invitation was withdrawn by your league. Ask your commissioner for a new one.',
    }
  }

  if (invitation.status === 'accepted') {
    return {
      ok: false,
      reason: 'already_accepted',
      status: 410,
      // Named as the likely truth rather than as an error: the overwhelmingly
      // common way to see this is a coach opening the same email twice.
      message: 'This invitation has already been used. If that was you, just sign in.',
    }
  }

  // Expiry is decided by the date, not by the status column. Nothing sweeps
  // these rows, so a lapsed invitation still says 'pending' — treating that as
  // valid would make expires_at decorative.
  const expired =
    invitation.status === 'expired' ||
    (!!invitation.expires_at && new Date(invitation.expires_at).getTime() <= now.getTime())

  if (expired) {
    return {
      ok: false,
      reason: 'expired',
      status: 410,
      message: 'This invitation has expired. Ask your league to send you a new one — it only takes them a moment.',
    }
  }

  if (invitation.status !== 'pending') {
    // Fail closed on a status this code does not know. A future status added by
    // a migration should not silently mean "valid".
    return {
      ok: false,
      reason: 'unknown_status',
      status: 410,
      message: 'This invitation is no longer valid. Ask your league to send you a new one.',
    }
  }

  // The invitation names an address; the person holding it may be signed in as
  // another. This is NOT a refusal, and making it one would be the wrong call:
  // a league secretary types the address off a registration form, and coaches
  // routinely already have a BenchCoach account under a different one. The
  // token is the credential, exactly as it is for team invitations today.
  //
  // What we do instead is tell them, and make them confirm — so a coach who
  // was forwarded somebody else's invitation by mistake finds out before they
  // join the wrong team, and the commissioner's adoption report does not
  // quietly record the wrong person as activated.
  const emailMismatch =
    !!callerEmail &&
    callerEmail.trim().toLowerCase() !== (invitation.email || '').trim().toLowerCase()

  return { ok: true, emailMismatch }
}

/**
 * The expiry to stamp on a new invitation.
 */
export function inviteExpiry(now: Date = new Date(), days: number = LEAGUE_INVITE_TTL_DAYS): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Has this league run out of the coaches it paid for?
 *
 * coach_limit is NULL for unlimited, matching lib/tiers.ts. Counted against
 * ACCEPTED invitations rather than pending ones: a commissioner should be able
 * to send forty invitations against a thirty-coach licence and have the last
 * ten fail at acceptance, rather than being blocked from inviting the coaches
 * they are about to buy more seats for.
 */
export function withinCoachLimit(
  coachLimit: number | null | undefined,
  acceptedCount: number
): boolean {
  if (coachLimit === null || coachLimit === undefined) return true
  return acceptedCount < coachLimit
}
