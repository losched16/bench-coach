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

export type TransferRefusal =
  | 'not_head_coach'
  | 'no_owner'
  | 'already_owner'
  | 'not_a_placeholder'
  | 'team_has_activity'

export type TransferDecision =
  | { transfer: true }
  | { transfer: false; reason: TransferRefusal }

/**
 * Should accepting this invitation make the coach the OWNER of the team?
 *
 * This is the rule that keeps "league coaches use normal BenchCoach" true
 * rather than aspirational.
 *
 * teams.coach_id is NOT NULL, so a league admin building next season's teams in
 * February has to own them — there is nobody else yet. If it stopped there, the
 * head coach who accepts in March would be a guest on their own team: no Staff
 * page, no billing, unable to invite their own assistants, and unable to delete
 * a team they created everything in. That is a visibly worse product than the
 * one they would have bought themselves, which is the exact thing the league
 * layer is not allowed to be.
 *
 * So the admin's ownership is a PLACEHOLDER, and accepting a head-coach
 * invitation claims it.
 *
 * WHY THIS NO LONGER ASKS WHETHER THE OWNER IS A LEAGUE ADMIN
 *
 * The first version's test was "the current owner administers this league".
 * That is a heuristic, and it is wrong in a case that will certainly happen: a
 * commissioner who also coaches a team in their own league. Their real team —
 * real roster, real practice plans, a season of notes — satisfied that test,
 * and would have been transferred to whoever opened a head-coach invitation
 * pointing at it. The owner's ROLE says nothing about whether a particular team
 * is a placeholder.
 *
 * So placeholder-ness is now a recorded fact: teams.league_placeholder_owner_id
 * is set at creation by league provisioning and cleared on claim. A team is
 * claimable only while its owner IS the recorded placeholder holder, which
 * makes claiming a one-way, once-only transition and leaves every ordinarily
 * created team permanently untransferable.
 *
 * `teamHasActivity` is belt to that braces. A placeholder should be empty by
 * definition, so activity means an assumption has already broken somewhere —
 * and the safe response to a broken assumption is to leave the data alone and
 * add the coach as staff instead.
 */
export function decideOwnershipTransfer(opts: {
  intendedRole: string
  // teams.coach_id — who owns it right now.
  currentOwnerCoachId: string | null
  // teams.league_placeholder_owner_id — who is holding it, if anyone.
  placeholderOwnerCoachId: string | null
  // The owning coach row's user, for the "it is already mine" case.
  currentOwnerUserId: string | null
  acceptingUserId: string
  // Any roster, plan, conversation or game on this team. A placeholder has none.
  teamHasActivity: boolean
}): TransferDecision {
  if (opts.intendedRole !== 'head_coach') return { transfer: false, reason: 'not_head_coach' }
  if (!opts.currentOwnerCoachId) return { transfer: false, reason: 'no_owner' }

  // Already theirs. Not an error, and not a transfer either.
  if (opts.currentOwnerUserId && opts.currentOwnerUserId === opts.acceptingUserId) {
    return { transfer: false, reason: 'already_owner' }
  }

  // The load-bearing condition. NULL here means an ordinary team; a value that
  // no longer matches the owner means the team has already been claimed once.
  if (!opts.placeholderOwnerCoachId || opts.placeholderOwnerCoachId !== opts.currentOwnerCoachId) {
    return { transfer: false, reason: 'not_a_placeholder' }
  }

  if (opts.teamHasActivity) return { transfer: false, reason: 'team_has_activity' }

  return { transfer: true }
}

/**
 * Has this league run out of the coaches it paid for?
 *
 * ADVISORY ONLY. This is for showing "28 of 30 seats used" on the commissioner's
 * dashboard. It is NOT what enforces the limit.
 *
 * Enforcement lives in bc_claim_league_seat() (migration 050), which takes a row
 * lock on the licence, counts accepted invitations and flips the invitation to
 * accepted inside one transaction. It has to be there rather than here: a
 * read-then-write in application code lets two coaches accepting the last seat
 * both read "29 of 30" and both proceed, which is exactly what this function
 * used to permit when the route called it directly.
 *
 * Kept because a number on a dashboard is worth having, and deliberately not
 * kept as a gate. Two sources of truth for a limit means the limit has none.
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
