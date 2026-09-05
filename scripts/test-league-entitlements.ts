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
console.log(`\nleague entitlements: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
