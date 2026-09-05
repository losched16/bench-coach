// Where access comes from, and — more importantly — what it must never do.
//
// The load-bearing test in this file is "league access does not mutate
// individual subscription status". Everything else here is arithmetic on dates;
// that one is the product rule. A league paying for forty coaches must not
// leave forty coach rows claiming to be subscribers, because nothing would ever
// reconcile them and the day the league leaves those forty keep Coach-plan
// surfaces that nobody is paying for.
//
// decideEntitlements() is pure, so all of this runs without a database.
//
//   npm run test:league-entitlements

import {
  decideEntitlements,
  isLicenseLive,
  isTeamSponsored,
  liveLeagueIds,
  EntitlementFacts,
  LicenseRow,
} from '@/lib/leagueEntitlements'
import { canManageLeague, isLeagueRole } from '@/lib/leagueAuthz'
import { readFileSync } from 'fs'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, actual: any, expected: any) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

const NOW = new Date('2027-05-15T12:00:00Z')

const license = (over: Partial<LicenseRow> = {}): LicenseRow => ({
  id: 'lic-1',
  league_id: 'league-1',
  status: 'active',
  starts_at: '2027-01-01T00:00:00Z',
  ends_at: '2027-12-31T00:00:00Z',
  ...over,
})

const facts = (over: Partial<EntitlementFacts> = {}): EntitlementFacts => ({
  coach: { is_subscribed: false, subscription_tier: 'free' },
  ownedTeams: [],
  memberTeams: [],
  licenses: [],
  now: NOW,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Licence liveness
//
// Dates decide, not the status column. Nothing sweeps these rows, so a licence
// still marked 'active' six months after it ended is the NORMAL state of the
// world rather than a data error — if status alone were trusted, ends_at would
// be decorative and no league would ever lose access.
// ---------------------------------------------------------------------------
ok('active licence inside its window is live', isLicenseLive(license(), NOW))
ok('trial grants access exactly like active', isLicenseLive(license({ status: 'trial' }), NOW))

ok('expired status is not live', !isLicenseLive(license({ status: 'expired' }), NOW))
ok('suspended status is not live', !isLicenseLive(license({ status: 'suspended' }), NOW))
ok('canceled status is not live', !isLicenseLive(license({ status: 'canceled' }), NOW))

ok('active but past its end date is not live',
  !isLicenseLive(license({ ends_at: '2027-04-01T00:00:00Z' }), NOW))
ok('active but not yet started is not live',
  !isLicenseLive(license({ starts_at: '2027-09-01T00:00:00Z' }), NOW))

ok('no end date means it does not expire',
  isLicenseLive(license({ ends_at: null }), NOW))
ok('no dates at all is live while active',
  isLicenseLive(license({ starts_at: null, ends_at: null }), NOW))

// The boundary. ends_at is exclusive: a licence ending at noon is dead at noon,
// not a millisecond later. Erring toward less access is the right way round
// when the alternative is billing someone for a day they did not buy.
ok('ends_at is exclusive at the exact instant',
  !isLicenseLive(license({ ends_at: NOW.toISOString() }), NOW))
ok('starts_at is inclusive at the exact instant',
  isLicenseLive(license({ starts_at: NOW.toISOString() }), NOW))

// Fail closed on a typo rather than handing out access.
ok('unparseable end date is not live',
  !isLicenseLive(license({ ends_at: 'not-a-date' }), NOW))
ok('unparseable start date is not live',
  !isLicenseLive(license({ starts_at: 'whenever' }), NOW))

eq('liveLeagueIds dedupes and filters',
  liveLeagueIds([
    license({ id: 'a', league_id: 'league-1' }),
    license({ id: 'b', league_id: 'league-1' }),
    license({ id: 'c', league_id: 'league-2', status: 'expired' }),
  ], NOW).join(','),
  'league-1')

// ---------------------------------------------------------------------------
// 2. The four access paths
// ---------------------------------------------------------------------------

// An individual paid coach, no league anywhere.
{
  const e = decideEntitlements(facts({
    coach: { is_subscribed: true, subscription_tier: 'team' },
    ownedTeams: [{ id: 't1', league_id: null }],
  }))
  eq('individual paid: source', e.source, 'individual')
  ok('individual paid: has access', e.hasAccess)
  ok('individual paid: team features', e.teamFeatures)
  ok('individual paid: not league sponsored', !e.leagueSponsored)
  eq('individual paid: tier', e.tier, 'team')
}

// An invited assistant with no plan of their own. Their access is the team
// owner's, resolved per-team by assertTeamFeatures — this only records that the
// path exists, which is what stops them being sent to checkout.
{
  const e = decideEntitlements(facts({
    coach: null,
    memberTeams: [{ id: 't1', league_id: null }],
  }))
  eq('invited assistant: source', e.source, 'team_membership')
  ok('invited assistant: has access', e.hasAccess)
  ok('invited assistant: not counted as paying', !e.individualPaid)
}

// A league-sponsored coach: free tier, team attached to a paying league.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license()],
  }))
  eq('league sponsored: source', e.source, 'league')
  ok('league sponsored: has access', e.hasAccess)
  ok('league sponsored: gets team features', e.teamFeatures)
  ok('league sponsored: gets AI', e.ai)
  eq('league sponsored: names the league', e.leagues.join(','), 'league-1')
  eq('league sponsored: names the team', e.sponsoredTeamIds.join(','), 't1')
  eq('league sponsored: reports the expiry', e.expiresAt, '2027-12-31T00:00:00Z')

  // THE RULE. Sponsorship is an answer computed from a licence, never a flag
  // written onto the coach.
  eq('league sponsored: individual tier still free', e.tier, 'free')
  ok('league sponsored: not recorded as an individual payer', !e.individualPaid)
}

// Expired licence, nothing else. This is the coach on the day the league did
// not renew, and they must fall all the way back to no access so the normal
// subscribe path can pick them up.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ status: 'expired' })],
  }))
  eq('expired licence: source', e.source, 'none')
  ok('expired licence: no access', !e.hasAccess)
  ok('expired licence: no team features', !e.teamFeatures)
  ok('expired licence: not sponsored', !e.leagueSponsored)
  eq('expired licence: no expiry to report', e.expiresAt, null)
}

// Lapsed by date while still saying 'active' — the same coach, by the more
// common route.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ ends_at: '2027-03-01T00:00:00Z' })],
  }))
  ok('lapsed by date: no access', !e.hasAccess)
  ok('lapsed by date: no team features', !e.teamFeatures)
}

// A coach who pays AND is in a league. They are a customer first: their access
// must survive the league leaving, and the revenue report must still count them.
{
  const e = decideEntitlements(facts({
    coach: { is_subscribed: true, subscription_tier: 'team' },
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license()],
  }))
  eq('paying league coach: individual wins the source', e.source, 'individual')
  ok('paying league coach: still recognised as sponsored', e.leagueSponsored)
  ok('paying league coach: still a payer', e.individualPaid)
}

// The same coach after the league leaves: nothing changes for them.
{
  const e = decideEntitlements(facts({
    coach: { is_subscribed: true, subscription_tier: 'team' },
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ status: 'canceled' })],
  }))
  eq('paying coach survives league cancellation', e.source, 'individual')
  ok('paying coach keeps team features', e.teamFeatures)
}

// One coach, two teams, one league. Sponsorship attaches to the TEAM: the
// private travel team is not covered by the rec league's licence.
{
  const e = decideEntitlements(facts({
    ownedTeams: [
      { id: 'rec', league_id: 'league-1' },
      { id: 'travel', league_id: null },
    ],
    licenses: [license()],
  }))
  eq('mixed teams: only the league team is sponsored', e.sponsoredTeamIds.join(','), 'rec')
}

// Sponsored through membership rather than ownership — an assistant on a
// league team.
{
  const e = decideEntitlements(facts({
    coach: null,
    memberTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license()],
  }))
  eq('sponsored assistant: league beats bare membership', e.source, 'league')
  ok('sponsored assistant: gets team features', e.teamFeatures)
}

// A team in a league nobody is paying for. Being attached to a league is not
// the grant — the licence is.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-2' }],
    licenses: [license({ league_id: 'league-1' })],
  }))
  ok('team in an unlicensed league is not sponsored', !e.leagueSponsored)
  ok('team in an unlicensed league has no access', !e.hasAccess)
}

// Two sponsoring licences: report the SOONEST expiry, because that is the date
// on which something the coach can see changes.
{
  const e = decideEntitlements(facts({
    ownedTeams: [
      { id: 't1', league_id: 'league-1' },
      { id: 't2', league_id: 'league-2' },
    ],
    licenses: [
      license({ id: 'a', league_id: 'league-1', ends_at: '2027-12-31T00:00:00Z' }),
      license({ id: 'b', league_id: 'league-2', ends_at: '2027-08-01T00:00:00Z' }),
    ],
  }))
  eq('two licences: soonest expiry wins', e.expiresAt, '2027-08-01T00:00:00Z')
}

// A brand new user with nothing.
{
  const e = decideEntitlements(facts({ coach: null }))
  eq('new user: no source', e.source, 'none')
  ok('new user: no access', !e.hasAccess)
  ok('new user: no team features', !e.teamFeatures)
}

// A free coach who owns an unaffiliated team — the lapsed individual. Must NOT
// get access, or the free tier means nothing.
{
  const e = decideEntitlements(facts({
    coach: { is_subscribed: false, subscription_tier: 'free' },
    ownedTeams: [{ id: 't1', league_id: null }],
  }))
  ok('lapsed individual gets no access', !e.hasAccess)
  ok('lapsed individual gets no team features', !e.teamFeatures)
}

// ---------------------------------------------------------------------------
// 3. Per-team sponsorship
// ---------------------------------------------------------------------------
ok('isTeamSponsored: live licence covers the team',
  isTeamSponsored('league-1', [license()], NOW))
ok('isTeamSponsored: null league is never sponsored',
  !isTeamSponsored(null, [license()], NOW))
ok('isTeamSponsored: undefined league is never sponsored',
  !isTeamSponsored(undefined, [license()], NOW))
ok('isTeamSponsored: expired licence does not cover',
  !isTeamSponsored('league-1', [license({ status: 'expired' })], NOW))
ok('isTeamSponsored: another league’s licence does not cover',
  !isTeamSponsored('league-1', [license({ league_id: 'league-9' })], NOW))
ok('isTeamSponsored: one live licence among dead ones is enough',
  isTeamSponsored('league-1', [
    license({ id: 'a', status: 'expired' }),
    license({ id: 'b', status: 'active' }),
  ], NOW))

// ---------------------------------------------------------------------------
// 4. League roles
//
// The ordering here must match bc_league_rank() in migration 050. Two
// enforcement points, one ordering — if they disagree, the database and the app
// disagree about who runs a league.
// ---------------------------------------------------------------------------
ok('owner can administer', canManageLeague('owner', 'administer'))
ok('commissioner can administer', canManageLeague('commissioner', 'administer'))
ok('admin cannot administer', !canManageLeague('admin', 'administer'))

ok('admin can manage', canManageLeague('admin', 'manage'))
ok('coaching director can manage', canManageLeague('coaching_director', 'manage'))
ok('division admin cannot manage', !canManageLeague('division_admin', 'manage'))

ok('division admin can view', canManageLeague('division_admin', 'view'))
ok('owner can view', canManageLeague('owner', 'view'))

ok('a non-member can do nothing', !canManageLeague(null, 'view'))
ok('an unknown role can do nothing', !canManageLeague('team_parent' as any, 'view'))
ok('a team role is not a league role', !isLeagueRole('contributor'))
ok('division_admin is a league role', isLeagueRole('division_admin'))

// A team role must never be mistaken for a league role. This is the line
// between "runs a team" and "runs the league", and it is the whole privacy
// boundary in one assertion.
for (const teamRole of ['owner', 'admin', 'contributor', 'viewer']) {
  // 'owner' and 'admin' are spelled the same in both vocabularies, which is
  // exactly why membership is looked up in league_members and never inferred
  // from a team role. These two assertions are about the string, not the person.
  if (teamRole === 'owner' || teamRole === 'admin') continue
  ok(`team role "${teamRole}" is not a league role`, !isLeagueRole(teamRole))
}

// ---------------------------------------------------------------------------
// 5. The authorization boundary, stated as the questions people will ask
//
// requireLeagueRole() resolves membership from league_members and nothing else.
// These assertions pin the consequences of that, because the failure they guard
// against is subtle: it would look like a helpful shortcut ("this coach IS in
// the league, let them see the league page") right up until a commissioner's
// dashboard opened for someone who merely coaches in it.
// ---------------------------------------------------------------------------
ok('a commissioner can open the league dashboard',
  canManageLeague('commissioner', 'view'))

// An unrelated signed-in user has no row in league_members, so getLeagueMembership
// returns null and canManageLeague(null) is false for every capability.
for (const cap of ['view', 'manage', 'administer'] as const) {
  ok(`an unrelated user cannot ${cap}`, !canManageLeague(null, cap))
}

// The one that matters most. Coaching a team in a league — even owning it, even
// being sponsored by it — is not administering the league. A coach reaches
// league admin only by having a league_members row, which only an existing
// league owner or commissioner can create.
{
  const sponsoredCoach = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license()],
  }))
  ok('a sponsored coach is definitely in the league', sponsoredCoach.leagueSponsored)
  // ...and that fact grants them no league role whatsoever. Entitlement and
  // administration are answered by different tables on purpose.
  ok('...but being sponsored grants no league role', !canManageLeague(null, 'view'))
}

// A team owner is 'owner' in the team vocabulary. If that string were ever fed
// to the league check it would rank 4 — the highest league role there is — and
// every head coach in the league would be a commissioner. The defence is that
// the two vocabularies are never mixed: league roles come only from
// league_members. This asserts the trap exists rather than that it is sprung.
eq('the strings collide, which is why the lookup table must not',
  ['owner', 'admin'].filter(r => isLeagueRole(r)).join(','), 'owner,admin')

// ---------------------------------------------------------------------------
// 5b. Boundaries, offsets and multiple licences
//
// The cases most likely to be got wrong once, quietly, and only noticed when a
// league complains that its coaches lost access a day early — or kept it a
// month late.
// ---------------------------------------------------------------------------

// Timezone offsets. NOW is 12:00Z, which is 08:00-04:00 — the same instant. A
// contract date typed in local time by a salesperson must behave identically to
// the same moment written in UTC, because it IS the same moment.
ok('an end date expressed with an offset is the same instant as UTC',
  !isLicenseLive(license({ ends_at: '2027-05-15T08:00:00-04:00' }), NOW))
ok('a start date expressed with an offset is the same instant as UTC',
  isLicenseLive(license({ starts_at: '2027-05-15T08:00:00-04:00' }), NOW))
ok('an offset date an hour later is still in the future',
  !isLicenseLive(license({ starts_at: '2027-05-15T09:00:00-04:00' }), NOW))
// A bare date with no time is midnight UTC on that day.
ok('a date-only end in the past is not live',
  !isLicenseLive(license({ ends_at: '2027-05-15' }), NOW))
ok('a date-only start earlier this year is live',
  isLicenseLive(license({ starts_at: '2027-01-01' }), NOW))

// One millisecond either side of the boundary, so the comparison operators are
// pinned rather than inferred.
ok('one ms before ends_at is still live',
  isLicenseLive(license({ ends_at: new Date(NOW.getTime() + 1).toISOString() }), NOW))
ok('one ms after starts_at is live',
  isLicenseLive(license({ starts_at: new Date(NOW.getTime() - 1).toISOString() }), NOW))
ok('one ms before starts_at is not live',
  !isLicenseLive(license({ starts_at: new Date(NOW.getTime() + 1).toISOString() }), NOW))

// Multiple and overlapping licences for one league. A renewal signed before the
// old one lapses is the normal shape of a renewing customer, and the coach must
// not blink out of access in the overlap.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [
      license({ id: 'old', ends_at: '2027-06-01T00:00:00Z' }),
      license({ id: 'new', starts_at: '2027-05-01T00:00:00Z', ends_at: '2028-06-01T00:00:00Z' }),
    ],
  }))
  ok('overlapping licences keep the coach sponsored', e.leagueSponsored)
  // Soonest expiry is still reported, which is conservative: it is the next
  // date on which something could change, even if a renewal already covers it.
  eq('overlapping licences report the soonest end', e.expiresAt, '2027-06-01T00:00:00Z')
}

// A dead licence alongside a live one must not poison the live one.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ id: 'dead', status: 'canceled' }), license({ id: 'live' })],
  }))
  ok('one live licence among dead ones still sponsors', e.leagueSponsored)
}

// Every dead status together.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: ['expired', 'suspended', 'canceled'].map((status, i) =>
      license({ id: `l${i}`, status })),
  }))
  ok('a pile of dead licences grants nothing', !e.leagueSponsored)
  eq('a pile of dead licences leaves no access', e.source, 'none')
}

// A team that has left the league. league_id is cleared (or the league row was
// deleted, which sets it NULL), so the licence covers nothing for this coach
// even though it is perfectly live.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: null }],
    licenses: [license()],
  }))
  ok('a team no longer affiliated is not sponsored', !e.leagueSponsored)
  eq('...and has no access of its own', e.source, 'none')
}

// SEASON SCOPE — a deliberate Phase 1 decision, asserted so it cannot drift.
//
// league_licenses.league_season_id exists so an annual contract can be told
// apart from a Spring-only one. It is NOT consulted when deciding sponsorship:
// access is granted league-wide for as long as the licence is live, and the
// dates are what bound it.
//
// The alternative — matching a licence's season against the team's
// league_season_id — was rejected for Phase 1 because a team whose season is
// mislabelled, or not yet assigned, would silently lose access mid-season, and
// the failure would look like a bug in the product rather than a data problem.
// Dates are the honest boundary. If per-season entitlement is ever wanted, it
// needs its own decision and its own tests.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ league_season_id: 'season-spring' })],
  }))
  ok('a season-scoped licence still sponsors the league', e.leagueSponsored)
}
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 't1', league_id: 'league-1' }],
    licenses: [license({ league_season_id: 'season-fall', ends_at: '2027-01-02T00:00:00Z' })],
  }))
  ok('a season-scoped licence past its dates sponsors nothing', !e.leagueSponsored)
}

// A coach on teams in two leagues, only one of which pays.
{
  const e = decideEntitlements(facts({
    ownedTeams: [{ id: 'paid', league_id: 'league-1' }, { id: 'unpaid', league_id: 'league-2' }],
    licenses: [license({ league_id: 'league-1' })],
  }))
  eq('only the paying league’s team is sponsored', e.sponsoredTeamIds.join(','), 'paid')
  eq('only the paying league is named', e.leagues.join(','), 'league-1')
}

// ---------------------------------------------------------------------------
// 6. The database and the app must agree about who runs a league
//
// There are two enforcement points — RLS policies calling bc_league_at_least(),
// and API routes calling requireLeagueRole() — and they carry SEPARATE copies
// of the role ordering. If those ever disagree, the database and the app
// disagree about who is a commissioner, and the disagreement is silent.
//
// Reading the ordering back out of the SQL is the only way to assert it. A
// comment saying "keep these in sync" is not a check.
// ---------------------------------------------------------------------------
{
  const sql = readFileSync('migrations/050_league_layer.sql', 'utf8')

  const fn = sql.slice(
    sql.indexOf('FUNCTION bc_league_rank'),
    sql.indexOf('$$ LANGUAGE sql IMMUTABLE', sql.indexOf('FUNCTION bc_league_rank')),
  )
  ok('migration defines bc_league_rank()', fn.length > 0)

  const sqlRanks: Record<string, number> = {}
  for (const m of Array.from(fn.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+(-?\d+)/g))) {
    sqlRanks[m[1]] = Number(m[2])
  }

  // The app's ordering, derived from behaviour rather than from a private
  // constant: canManageLeague() is what the routes actually use.
  const APP_ORDER = ['division_admin', 'coaching_director', 'admin', 'commissioner', 'owner']

  eq('SQL knows exactly the five league roles',
    Object.keys(sqlRanks).sort().join(','), APP_ORDER.slice().sort().join(','))

  // Same relative ordering, checked pairwise rather than by absolute number, so
  // renumbering is fine and reordering is not.
  for (let i = 1; i < APP_ORDER.length; i++) {
    const lower = APP_ORDER[i - 1], higher = APP_ORDER[i]
    ok(`SQL ranks ${higher} above ${lower}`, sqlRanks[higher] > sqlRanks[lower])
    // And the app agrees: whatever the higher role can do, it can do at least
    // everything the lower one can.
    for (const cap of ['view', 'manage', 'administer'] as const) {
      if (canManageLeague(lower as any, cap)) {
        ok(`app: ${higher} inherits ${lower}'s ${cap}`, canManageLeague(higher as any, cap))
      }
    }
  }

  // ── No policy may reach a team-scoped or private table ──
  //
  // The privacy verifier checks this too. Repeated here because it is the
  // assertion that keeps league membership from becoming a backdoor into team
  // data, and it deserves to fail a test run as well as a build check.
  const policies = sql.match(/CREATE POLICY[\s\S]*?;/gi) || []
  ok('migration 050 creates policies', policies.length > 0)

  const policyTargets = policies
    .map(p => (p.match(/\bON\s+([a-z_]+)/i) || [])[1])
    .filter(Boolean) as string[]

  for (const t of policyTargets) {
    ok(`policy target "${t}" is a league table, not a team or content table`,
      t.startsWith('league'))
  }

  // Every policy is read-only. A write policy would let the browser client
  // create leagues or invitations directly, bypassing requireLeagueRole().
  for (const p of policies) {
    ok('every league policy is SELECT-only', /FOR\s+SELECT/i.test(p))
  }

  // ── league_invitations: RLS on, zero policies ──
  ok('league_invitations has RLS enabled',
    /ALTER TABLE league_invitations ENABLE ROW LEVEL SECURITY/i.test(sql))
  ok('league_invitations has no policy — invite tokens are bearer credentials',
    !policyTargets.includes('league_invitations'))

  // ── No recursive RLS ──
  //
  // bc_in_league_team() reads teams and team_members. That is safe ONLY while
  // no policy using it sits on those tables — a policy that has to query the
  // table it protects is infinite recursion. Migration 034 hit this, which is
  // why its helpers are SECURITY DEFINER, and it is why this is asserted rather
  // than assumed.
  for (const p of policies) {
    if (!/bc_in_league_team/.test(p)) continue
    const target = (p.match(/\bON\s+([a-z_]+)/i) || [])[1]
    ok(`bc_in_league_team is not used in a policy on a table it reads (${target})`,
      target !== 'teams' && target !== 'team_members')
  }

  // Both helpers must be SECURITY DEFINER, or they would be evaluated with the
  // caller's rights and be blocked by the very policies they exist to serve.
  for (const helper of ['bc_league_role', 'bc_in_league_team', 'bc_league_at_least']) {
    const at = sql.indexOf(`FUNCTION ${helper}`)
    ok(`${helper}() exists`, at !== -1)
    ok(`${helper}() is SECURITY DEFINER`,
      at !== -1 && sql.slice(at, at + 900).includes('SECURITY DEFINER'))
  }

  // ── The seat-claim functions must be unreachable from the browser ──
  for (const fnName of ['bc_claim_league_seat', 'bc_release_league_seat']) {
    ok(`${fnName}() exists`, sql.includes(`CREATE OR REPLACE FUNCTION ${fnName}`))
    // The REVOKEs live in one DO block that loops the functions and skips
    // roles a plain Postgres does not have, so both the function name and the
    // role must appear inside that SAME block — not merely somewhere in the
    // file, which a laxer check would accept from a comment.
    const revokeStart = sql.lastIndexOf('DO $$', sql.indexOf('REVOKE ALL ON FUNCTION'))
    const revokeEnd = sql.indexOf('END $$;', sql.indexOf('REVOKE ALL ON FUNCTION'))
    const block = revokeStart === -1 ? '' : sql.slice(revokeStart, revokeEnd)
    ok(`${fnName}() is revoked from authenticated`,
      block.includes(fnName) && block.includes('authenticated'))
  }
}

// ---------------------------------------------------------------------------
// 7. Subscription invariants that are otherwise invisible
//
// These are properties of the SOURCE rather than of a return value, and there
// is no way to observe them from a unit test of a function that does I/O. They
// are asserted here because each one is a regression that would ship silently:
// nothing would throw, no test would fail, and the damage would show up in
// billing or in a support queue weeks later.
// ---------------------------------------------------------------------------
{
  const authz = readFileSync('lib/authz.ts', 'utf8')

  // THE RULE, checked across every file the league layer added: nothing may
  // write coaches.is_subscribed. Sponsorship is computed from a live licence,
  // never stamped onto a coach — otherwise the day a league stops paying, its
  // coaches keep a flag that says they bought something, and nothing reconciles
  // it.
  const leagueSources = [
    'lib/leagueEntitlements.ts', 'lib/leagueAuthz.ts', 'lib/leagueInvites.ts',
    'app/api/league/invite/accept/route.ts', 'app/api/league/me/route.ts',
    'app/api/league-admin/overview/route.ts', 'app/api/league-admin/teams/route.ts',
    'app/api/league-admin/invitations/route.ts', 'app/api/league-admin/members/route.ts',
    'app/api/league-admin/seasons/route.ts', 'app/api/league-admin/divisions/route.ts',
    'app/api/admin/leagues/route.ts',
  ]
  for (const file of leagueSources) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    // An assignment or an object key, as opposed to reading it in a select.
    ok(`${file} never writes is_subscribed`,
      !/is_subscribed\s*[:=]\s*(true|false|[A-Za-z_$])/.test(src))
    ok(`${file} never writes subscription_tier`,
      !/subscription_tier\s*[:=]\s*['"]/.test(src))
  }

  // assertTeamFeatures must try the OWNER'S OWN PLAN first and return before
  // touching the league. A paying coach is the overwhelmingly common case and
  // must not pay a second round trip on every guarded request to answer a
  // question about a league they are not in.
  const fn = authz.slice(
    authz.indexOf('export async function assertTeamFeatures'),
    authz.indexOf('export async function authorizeTeam'),
  )
  ok('assertTeamFeatures() exists', fn.length > 0)

  const earlyReturn = fn.indexOf('teamFeatures) return')
  const leagueCall = fn.indexOf('isTeamLeagueSponsored')
  ok('assertTeamFeatures short-circuits on the owner plan before any league lookup',
    earlyReturn !== -1 && leagueCall !== -1 && earlyReturn < leagueCall)

  // The league lookup is reached only with a teamId, so a coach-scoped route
  // (authorizeCoach, which resolves no team) behaves exactly as it did before
  // the league layer existed.
  ok('the league lookup is guarded by the presence of a teamId',
    /if\s*\(\s*teamId\s*&&\s*await\s+isTeamLeagueSponsored/.test(fn))

  // guard() must hand the team through, or per-team sponsorship silently never
  // applies and every league coach is refused Coach-plan surfaces.
  ok('guard() passes the resolved teamId to assertTeamFeatures',
    /assertTeamFeatures\(\s*actor\.ownerCoachId\s*,\s*actor\.teamId\s*\)/.test(authz))

  // authorizeCoach resolves no team, so it must not invent one.
  const coachFn = authz.slice(
    authz.indexOf('export async function authorizeCoach'),
    authz.indexOf('const REFUSALS'),
  )
  ok('authorizeCoach returns no teamId, leaving coach-scoped routes unchanged',
    // \b matters: the function has a `teamIds` local (plural) for the coach's
    // teams, and a substring match reads that as a teamId being returned.
    coachFn.length > 0 && !/\bteamId\b/.test(coachFn))
}

// ---------------------------------------------------------------------------
console.log(`\nleague entitlements: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
