// An invitation is a bearer credential. These are the ways it must stop working.
//
// The four refusals — expired, revoked, already used, unknown — are the kind of
// logic that normally lives twelve lines deep inside a route handler that also
// does I/O, and therefore never gets tested. validateInvitation() is pure so
// that they can be.
//
//   npm run test:league-invites

import {
  validateInvitation,
  teamRoleFor,
  inviteExpiry,
  withinCoachLimit,
  generateInviteToken,
  isIntendedRole,
  decideOwnershipTransfer,
  LEAGUE_INVITE_TTL_DAYS,
  LeagueInvitationRow,
} from '@/lib/leagueInvites'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, actual: any, expected: any) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

const NOW = new Date('2027-03-01T12:00:00Z')

const invite = (over: Partial<LeagueInvitationRow> = {}): LeagueInvitationRow => ({
  id: 'inv-1',
  league_id: 'league-1',
  team_id: 'team-1',
  email: 'coach@example.com',
  intended_role: 'head_coach',
  invite_token: 'tok',
  status: 'pending',
  expires_at: '2027-04-01T00:00:00Z',
  ...over,
})
// ^ That semicolon-free line is followed by a bare `{` block, which the parser
// would otherwise read as the start of an arrow-function parameter list — so
// the fixture above gets reparsed as a destructuring pattern, `id: 'inv-1'`
// becomes "bind id to the identifier 'inv-1'", and a string is not an
// identifier. The block below therefore opens with a leading semicolon, the
// same guard this codebase already uses for `;(async () => {`.
//
// Worth knowing why it matters: one syntax error suppresses SEMANTIC
// diagnostics for the entire program, so the symptom was tsc reporting 17
// errors instead of the honest 186 — a parse failure reads as an improvement.

// ---------------------------------------------------------------------------
// 1. The happy path
// ---------------------------------------------------------------------------
;{
  const v = validateInvitation(invite(), NOW)
  ok('valid invitation accepts', v.ok)
  ok('valid invitation has no refusal reason', !v.reason)
}

// Readable before anyone signs in — the invitation screen renders for a coach
// who does not have an account yet, and that is the whole point of it.
;{
  const v = validateInvitation(invite(), NOW, null)
  ok('valid invitation is readable while signed out', v.ok)
  ok('signed out is not an email mismatch', !v.emailMismatch)
}

// No expiry set at all.
ok('invitation with no expiry is valid', validateInvitation(invite({ expires_at: null }), NOW).ok)

// ---------------------------------------------------------------------------
// 2. The four refusals
// ---------------------------------------------------------------------------
;{
  const v = validateInvitation(invite({ expires_at: '2027-02-01T00:00:00Z' }), NOW)
  ok('expired invitation is refused', !v.ok)
  eq('expired: reason', v.reason, 'expired')
  eq('expired: status is 410 Gone, not 404', v.status, 410)
  ok('expired: message tells them how to fix it', !!v.message && v.message.includes('new one'))
}

// Expiry is decided by the date even when the status column still says pending,
// because nothing sweeps these rows. If status alone were trusted, expires_at
// would be decorative.
;{
  const v = validateInvitation(invite({ status: 'pending', expires_at: '2027-01-01T00:00:00Z' }), NOW)
  eq('a pending row past its date is still expired', v.reason, 'expired')
}

// And by the status when a sweep has stamped it.
eq('status expired is refused', validateInvitation(invite({ status: 'expired' }), NOW).reason, 'expired')

;{
  const v = validateInvitation(invite({ status: 'revoked' }), NOW)
  ok('revoked invitation is refused', !v.ok)
  eq('revoked: reason', v.reason, 'revoked')
  eq('revoked: status', v.status, 410)
}

// Reuse. The common cause is a coach opening the same email twice, so the
// message points them at signing in rather than calling it an error.
;{
  const v = validateInvitation(invite({ status: 'accepted' }), NOW)
  ok('an accepted invitation cannot be reused', !v.ok)
  eq('reused: reason', v.reason, 'already_accepted')
  eq('reused: status', v.status, 410)
  ok('reused: message points at signing in', !!v.message && v.message.includes('sign in'))
}

// A revoked invitation stays refused even if its date is still good — status
// beats the calendar in the direction that denies.
ok('revoked beats a valid expiry date',
  !validateInvitation(invite({ status: 'revoked', expires_at: '2099-01-01T00:00:00Z' }), NOW).ok)

;{
  const v = validateInvitation(null, NOW)
  ok('missing invitation is refused', !v.ok)
  eq('missing: reason', v.reason, 'not_found')
  eq('missing: status is 404', v.status, 404)
}

// Fail closed on a status this code has never heard of. A future migration
// adding a status must not silently mean "valid".
;{
  const v = validateInvitation(invite({ status: 'quarantined' }), NOW)
  ok('unknown status is refused', !v.ok)
  eq('unknown status: reason', v.reason, 'unknown_status')
}

// ---------------------------------------------------------------------------
// 3. Wrong signed-in email — handled, deliberately not refused
//
// A league secretary types the address off a registration form and coaches
// routinely already have an account under another one. Refusing would strand a
// real coach holding a real invitation. The token is the credential here,
// exactly as it is for team invitations today — so this is surfaced for
// confirmation rather than blocked, which stops a forwarded invitation being
// accepted by the wrong person without anyone noticing.
// ---------------------------------------------------------------------------
;{
  const v = validateInvitation(invite(), NOW, 'someone.else@example.com')
  ok('email mismatch still accepts', v.ok)
  ok('email mismatch is flagged for confirmation', v.emailMismatch === true)
}
;{
  const v = validateInvitation(invite(), NOW, 'coach@example.com')
  ok('matching email is not flagged', !v.emailMismatch)
}
;{
  const v = validateInvitation(invite({ email: 'Coach@Example.COM' }), NOW, 'coach@example.com')
  ok('email comparison ignores case', !v.emailMismatch)
}
;{
  const v = validateInvitation(invite({ email: ' coach@example.com ' }), NOW, 'coach@example.com')
  ok('email comparison ignores surrounding whitespace', !v.emailMismatch)
}

// A mismatch never rescues an otherwise dead invitation.
ok('email mismatch on an expired invitation is still expired',
  validateInvitation(invite({ status: 'revoked' }), NOW, 'other@example.com').reason === 'revoked')

// ---------------------------------------------------------------------------
// 4. Role mapping
// ---------------------------------------------------------------------------
eq('head coach maps to admin when they do not own the team', teamRoleFor('head_coach'), 'admin')
eq('assistant coach maps to contributor', teamRoleFor('assistant_coach'), 'contributor')
// Anything unrecognised gets the weaker role. An invitation with a corrupted
// role must not hand out roster control.
eq('an unknown intended role falls back to contributor', teamRoleFor('commissioner'), 'contributor')
eq('an empty intended role falls back to contributor', teamRoleFor(''), 'contributor')

ok('head_coach is an intended role', isIntendedRole('head_coach'))
ok('assistant_coach is an intended role', isIntendedRole('assistant_coach'))
ok('viewer is not an intended role', !isIntendedRole('viewer'))

// ---------------------------------------------------------------------------
// 4b. Ownership transfer
//
// The rule that keeps "league coaches use normal BenchCoach" true. A league
// admin has to own the teams they create in February, because teams.coach_id is
// NOT NULL and there is nobody else yet — so that ownership is a placeholder
// and a head coach accepting in March claims it.
//
// The first implementation asked "is the current owner a league admin?". That
// is a heuristic and it is WRONG for a commissioner who also coaches in their
// own league: their real team, with a real roster, satisfied it. Placeholder
// status is now a recorded fact — teams.league_placeholder_owner_id — and the
// tests below pin every way that fact can fail to hold.
// ---------------------------------------------------------------------------
const PLACEHOLDER = 'coach-admin'

const transfer = (over: Partial<Parameters<typeof decideOwnershipTransfer>[0]> = {}) =>
  decideOwnershipTransfer({
    intendedRole: 'head_coach',
    currentOwnerCoachId: PLACEHOLDER,
    placeholderOwnerCoachId: PLACEHOLDER,
    currentOwnerUserId: 'admin-user',
    acceptingUserId: 'coach-user',
    teamHasActivity: false,
    ...over,
  })

// TransferDecision is a discriminated union, so a refusal reason is only
// reachable after narrowing — which is the type working as intended: nothing
// can read `.reason` off a decision that succeeded.
const reasonOf = (d: ReturnType<typeof decideOwnershipTransfer>) => d.transfer ? null : d.reason

ok('head coach claims an unclaimed placeholder team', transfer().transfer)

eq('an assistant coach never takes ownership',
  reasonOf(transfer({ intendedRole: 'assistant_coach' })), 'not_head_coach')
eq('an unknown intended role never transfers',
  reasonOf(transfer({ intendedRole: 'commissioner' })), 'not_head_coach')

// THE ONE THE HEURISTIC GOT WRONG.
//
// A commissioner who also coaches a team in their own league. Under the old
// rule the owner "is a league admin" was true, and their real team would have
// been transferred to whoever opened a head-coach invitation pointing at it.
// A team created through ordinary onboarding has no placeholder marker, so it
// is now permanently untransferable regardless of what roles its owner holds.
eq('a league admin’s OWN real team is never transferred',
  reasonOf(transfer({ placeholderOwnerCoachId: null })), 'not_a_placeholder')

// Already claimed once: the marker was cleared on the first transfer, so the
// owner no longer matches it. Claiming is one-way and once-only.
eq('a team already claimed cannot be claimed again',
  reasonOf(transfer({ currentOwnerCoachId: 'coach-real', placeholderOwnerCoachId: null })),
  'not_a_placeholder')

// The marker survives but ownership has moved on — belt to the compare-and-set
// in the route.
eq('a stale placeholder marker does not authorise a transfer',
  reasonOf(transfer({ currentOwnerCoachId: 'coach-real', placeholderOwnerCoachId: PLACEHOLDER })),
  'not_a_placeholder')

// A team owned by a genuine coach who is not a league admin at all.
eq('a team owned by a real coach is never transferred',
  reasonOf(transfer({ currentOwnerCoachId: 'coach-real', placeholderOwnerCoachId: null })),
  'not_a_placeholder')

// Belt to that braces. A placeholder is empty by definition, so activity means
// an assumption already broke — leave the data alone and join as staff.
eq('a placeholder with real activity on it is not transferred',
  reasonOf(transfer({ teamHasActivity: true })), 'team_has_activity')

eq('no transfer when the accepting coach already owns it',
  reasonOf(transfer({ currentOwnerUserId: 'coach-user' })), 'already_owner')
eq('no transfer when the team has no owner at all',
  reasonOf(transfer({ currentOwnerCoachId: null })), 'no_owner')

// Ordering: identity is checked before placeholder status, so a coach who
// already owns their team is told that rather than "not a placeholder".
eq('already-owner outranks placeholder checks',
  reasonOf(transfer({ currentOwnerUserId: 'coach-user', placeholderOwnerCoachId: null })),
  'already_owner')

// Every refusal must name a reason — a bare `false` gives the route nothing to
// log and nothing to tell the coach.
for (const bad of [
  { intendedRole: 'assistant_coach' },
  { placeholderOwnerCoachId: null },
  { teamHasActivity: true },
  { currentOwnerCoachId: null },
  { currentOwnerUserId: 'coach-user' },
]) {
  const d = transfer(bad as any)
  ok(`refusal carries a reason: ${JSON.stringify(bad)}`, d.transfer === false && !!d.reason)
}

// ---------------------------------------------------------------------------
// 5. Expiry stamping
// ---------------------------------------------------------------------------
;{
  const stamped = new Date(inviteExpiry(NOW))
  const days = Math.round((stamped.getTime() - NOW.getTime()) / 86400000)
  eq('default expiry is the documented TTL', days, LEAGUE_INVITE_TTL_DAYS)
  eq('the documented TTL is 30 days', LEAGUE_INVITE_TTL_DAYS, 30)
  // Longer than the team invite's 7 days on purpose: leagues send these in
  // February for a season starting in April.
  ok('league invites outlive team invites', LEAGUE_INVITE_TTL_DAYS > 7)
  ok('a freshly stamped invitation validates',
    validateInvitation(invite({ expires_at: inviteExpiry(NOW) }), NOW).ok)
}

// ---------------------------------------------------------------------------
// 6. Coach limit
//
// Counted against ACCEPTED invitations, not pending ones: a commissioner should
// be able to send forty invitations against a thirty-seat licence and have the
// last ten fail at acceptance, rather than being blocked from inviting the
// coaches they are about to buy seats for.
// ---------------------------------------------------------------------------
ok('null coach limit is unlimited', withinCoachLimit(null, 9999))
ok('undefined coach limit is unlimited', withinCoachLimit(undefined, 9999))
ok('under the limit is allowed', withinCoachLimit(30, 29))
ok('at the limit is refused', !withinCoachLimit(30, 30))
ok('over the limit is refused', !withinCoachLimit(30, 31))
ok('a zero limit refuses everyone', !withinCoachLimit(0, 0))

// ---------------------------------------------------------------------------
// 7. Tokens
// ---------------------------------------------------------------------------
;{
  const a = generateInviteToken()
  const b = generateInviteToken()
  eq('token is 64 hex chars (256 bits)', a.length, 64)
  ok('token is hex', /^[0-9a-f]+$/.test(a))
  ok('tokens are not repeated', a !== b)
}

// ---------------------------------------------------------------------------
console.log(`\nleague invites: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
