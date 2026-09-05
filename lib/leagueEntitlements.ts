import { createClient } from '@supabase/supabase-js'
import { tierOf, tierConfig, Tier } from './tiers'

// Where a coach's access comes from.
//
// Before the league layer there was one answer: coaches.is_subscribed, read
// through tierOf(). An assistant coach was the single exception, and even that
// resolved to somebody's subscription — assertTeamFeatures() asks the TEAM
// OWNER's tier, not the caller's, which is why an invited assistant gets Coach
// surfaces without paying.
//
// A league buying BenchCoach for forty coaches is a third source, and the one
// rule that matters is that it stays a THIRD SOURCE.
//
// THE THING NOT TO DO
//
// The cheap implementation is to set is_subscribed = true on every sponsored
// coach and go home. It would work, it would take an afternoon, and it would be
// a lie stored in a boolean. The day the league does not renew, forty rows
// still say "this person pays us". Nothing reconciles them, because nothing
// knows they were ever different. The coaches keep Coach-plan surfaces, the
// revenue report counts forty subscribers who are not subscribers, and the
// only way back is a hand-written UPDATE that has to guess which rows were
// sponsored.
//
// So is_subscribed keeps meaning exactly one thing — this person bought a
// plan — and league sponsorship is answered by asking the licence, every time.
// The cost is a query. The benefit is that when a league leaves, access ends
// because the licence ended, and nothing has to be cleaned up.
//
// WHAT THIS MODULE IS
//
// A pure decision core plus a thin resolver. decideEntitlements() takes facts
// and returns a verdict with no I/O, which is what makes the expiry and
// precedence rules testable without a database — the same shape as the drill
// retrieval tests. getUserEntitlements() does the fetching and calls it.

export type AccessSource = 'individual' | 'league' | 'team_membership' | 'none'

// Trial grants access exactly like active: a pilot league whose coaches cannot
// open the product is not a pilot. Everything else is a licence that has
// stopped paying, in one way or another.
const LIVE_LICENSE_STATUSES = ['trial', 'active']

export interface LicenseRow {
  id: string
  league_id: string
  league_season_id?: string | null
  status: string
  plan?: string | null
  coach_limit?: number | null
  starts_at?: string | null
  ends_at?: string | null
}

export interface TeamRef {
  id: string
  league_id: string | null
}

export interface EntitlementFacts {
  // The caller's own coach row. Null for an invited assistant who never
  // created one — which is legal, and is why access cannot be read off this
  // alone.
  coach: { is_subscribed?: boolean | null; subscription_tier?: string | null } | null
  // Teams the caller owns, and teams they are staff on. Kept apart because
  // ownership and membership are different grants that happen to overlap here.
  ownedTeams: TeamRef[]
  memberTeams: TeamRef[]
  licenses: LicenseRow[]
  now: Date
}

export interface Entitlements {
  // The individual plan, unchanged. A sponsored coach on no plan of their own
  // reads 'free' here forever, and that is correct: it is what they are paying
  // for, which is nothing.
  tier: Tier
  individualPaid: boolean
  leagueSponsored: boolean
  teamMembershipAccess: boolean
  // Which single source is answering. Individual first, because a coach who
  // pays should be described as a paying customer even when a league also
  // covers them — and because their access must survive the league leaving.
  source: AccessSource
  hasAccess: boolean
  // The effective answer the app acts on. This is the only field that league
  // sponsorship changes, and it is computed, never stored.
  teamFeatures: boolean
  ai: boolean
  leagues: string[]
  sponsoredTeamIds: string[]
  // When sponsored access runs out, when that is known. Null means either not
  // sponsored, or sponsored by a licence with no end date.
  expiresAt: string | null
}

/**
 * Is this licence paying, right now?
 *
 * Dates are compared as instants rather than trusted from `status`, because
 * status is set by a human on a phone call and ends_at is set by a contract.
 * A licence still marked 'active' three months after it ended is the expected
 * state of the world, not an anomaly — nothing sweeps these — so the date is
 * what decides.
 */
export function isLicenseLive(license: LicenseRow, now: Date): boolean {
  if (!LIVE_LICENSE_STATUSES.includes(license.status)) return false

  const t = now.getTime()

  if (license.starts_at) {
    const starts = new Date(license.starts_at).getTime()
    // An unparseable date is treated as "not yet valid" rather than ignored.
    // Failing closed on a malformed contract date is the right way round: the
    // alternative hands out access on a typo.
    if (Number.isNaN(starts) || starts > t) return false
  }

  if (license.ends_at) {
    const ends = new Date(license.ends_at).getTime()
    if (Number.isNaN(ends) || ends <= t) return false
  }

  return true
}

/**
 * The leagues currently paying, out of a set of licences.
 */
export function liveLeagueIds(licenses: LicenseRow[], now: Date): string[] {
  const out = new Set<string>()
  for (const l of licenses) {
    if (isLicenseLive(l, now)) out.add(l.league_id)
  }
  return Array.from(out)
}

/**
 * The verdict. No I/O — every input is a fact handed in.
 */
export function decideEntitlements(facts: EntitlementFacts): Entitlements {
  const { coach, ownedTeams, memberTeams, licenses, now } = facts

  // Untouched by anything league-shaped. This is the individual subscription
  // and it stays the individual subscription.
  const tier = tierOf(coach as any)
  const cfg = tierConfig(tier)
  const individualPaid = tier !== 'free'

  const live = new Set(liveLeagueIds(licenses, now))

  const allTeams = [...ownedTeams, ...memberTeams]
  const sponsoredTeamIds: string[] = []
  const leagues = new Set<string>()
  for (const t of allTeams) {
    if (t.league_id && live.has(t.league_id)) {
      sponsoredTeamIds.push(t.id)
      leagues.add(t.league_id)
    }
  }
  const leagueSponsored = sponsoredTeamIds.length > 0

  // Staff on somebody else's team. Access here is the OWNER's plan, resolved
  // per-team by assertTeamFeatures() rather than globally — this flag only
  // records that the path exists, which is what stops a sponsored assistant
  // being sent to checkout.
  const teamMembershipAccess = memberTeams.length > 0

  const source: AccessSource =
    individualPaid ? 'individual'
    : leagueSponsored ? 'league'
    : teamMembershipAccess ? 'team_membership'
    : 'none'

  // The soonest a sponsoring licence lapses. Soonest rather than latest,
  // because that is the date on which something the coach can see changes.
  let expiresAt: string | null = null
  if (leagueSponsored) {
    for (const l of licenses) {
      if (!leagues.has(l.league_id) || !isLicenseLive(l, now) || !l.ends_at) continue
      if (expiresAt === null || new Date(l.ends_at) < new Date(expiresAt)) {
        expiresAt = l.ends_at
      }
    }
  }

  return {
    tier,
    individualPaid,
    leagueSponsored,
    teamMembershipAccess,
    source,
    hasAccess: source !== 'none',
    // A league buys the Coach plan for its coaches — practice plans, the
    // lineup builder, staff, scouting. That is the product being sponsored.
    teamFeatures: cfg.teamFeatures || leagueSponsored,
    ai: cfg.ai || leagueSponsored,
    leagues: Array.from(leagues),
    sponsoredTeamIds,
    expiresAt,
  }
}

/**
 * Is this one team covered by a live league licence?
 *
 * The per-team question, which is the one assertTeamFeatures() needs: league
 * sponsorship attaches to a TEAM, not to a person. A coach can run a
 * league-sponsored 10U team and a private travel team, and only one of them is
 * paid for by the league.
 */
export function isTeamSponsored(
  teamLeagueId: string | null | undefined,
  licenses: LicenseRow[],
  now: Date
): boolean {
  if (!teamLeagueId) return false
  return licenses.some(l => l.league_id === teamLeagueId && isLicenseLive(l, now))
}

// ── Resolution ─────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * Everything that decides what one user may do, in one call.
 *
 * Deliberately keyed on userId rather than coachId: an invited assistant has a
 * user but may have no coach row, and asking "what may this person do" must
 * work for them too.
 */
export async function getUserEntitlements(
  userId: string,
  now: Date = new Date()
): Promise<Entitlements> {
  const [{ data: coach }, { data: memberships }] = await Promise.all([
    supabaseAdmin
      .from('coaches')
      .select('id, is_subscribed, subscription_tier')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId),
  ])

  const coachId = (coach as any)?.id as string | undefined

  const ownedPromise = coachId
    ? supabaseAdmin.from('teams').select('id, league_id').eq('coach_id', coachId)
    : Promise.resolve({ data: [] as any[] })

  const memberTeamIds = ((memberships || []) as any[]).map(m => m.team_id).filter(Boolean)
  const memberPromise = memberTeamIds.length
    ? supabaseAdmin.from('teams').select('id, league_id').in('id', memberTeamIds)
    : Promise.resolve({ data: [] as any[] })

  const [{ data: ownedTeams }, { data: memberTeams }] = await Promise.all([
    ownedPromise, memberPromise,
  ])

  const leagueIds = Array.from(new Set(
    [...((ownedTeams || []) as any[]), ...((memberTeams || []) as any[])]
      .map(t => t.league_id)
      .filter(Boolean)
  ))

  // Only the leagues this user actually touches. Fetching every licence in the
  // system to answer a question about one coach is how a cheap check becomes a
  // slow one once there are fifty leagues.
  const { data: licenses } = leagueIds.length
    ? await supabaseAdmin
        .from('league_licenses')
        .select('id, league_id, league_season_id, status, plan, coach_limit, starts_at, ends_at')
        .in('league_id', leagueIds)
    : { data: [] as any[] }

  return decideEntitlements({
    coach: (coach as any) || null,
    ownedTeams: ((ownedTeams || []) as any[]).map(t => ({ id: t.id, league_id: t.league_id ?? null })),
    memberTeams: ((memberTeams || []) as any[]).map(t => ({ id: t.id, league_id: t.league_id ?? null })),
    licenses: (licenses || []) as LicenseRow[],
    now,
  })
}

/**
 * The per-team sponsorship question, resolved against the database.
 *
 * Used by assertTeamFeatures() when the team owner's own plan does not include
 * the coaching surfaces — the league might be paying for them instead.
 */
export async function isTeamLeagueSponsored(
  teamId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, league_id')
    .eq('id', teamId)
    .maybeSingle()

  const leagueId = (team as any)?.league_id
  if (!leagueId) return false

  const { data: licenses } = await supabaseAdmin
    .from('league_licenses')
    .select('id, league_id, status, starts_at, ends_at')
    .eq('league_id', leagueId)

  return isTeamSponsored(leagueId, (licenses || []) as LicenseRow[], now)
}
