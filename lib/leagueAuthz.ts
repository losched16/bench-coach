import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AuthzError, authzResponse, sessionClient } from './authz'

// Who runs this league, and what may they do.
//
// The sibling of lib/authz.ts, and deliberately a SEPARATE module rather than
// more capabilities bolted onto that one. The two answer different questions
// about different principals:
//
//   authz.ts        may this person touch this TEAM's data?
//   leagueAuthz.ts  may this person administer this LEAGUE?
//
// Keeping them apart is the privacy boundary made structural. There is no
// function in this file that returns access to a roster, a note, a practice
// plan or a conversation, and nothing in authz.ts consults league membership
// when deciding who may read a team. A commissioner wanting to see a team's
// player notes has to be invited onto that team like anyone else, and the
// reason is that no code path exists to do it any other way.
//
// Same enforcement shape as authz.ts otherwise: these run in API routes holding
// the service role, so RLS is not protecting those paths and this is what does.

export type LeagueRole =
  | 'owner'
  | 'commissioner'
  | 'admin'
  | 'coaching_director'
  | 'division_admin'

// Mirrors bc_league_rank() in migration 050. Two enforcement points, one
// ordering — if these ever disagree, the database and the app disagree about
// who runs a league.
const LEAGUE_RANK: Record<LeagueRole, number> = {
  owner: 4,
  commissioner: 3,
  admin: 2,
  coaching_director: 1,
  // Reserved. Ranks lowest and is currently league-wide read-only: the scope
  // that would make it mean "this division only" does not exist yet, and a
  // permission that silently reads wider than its name is worse than one that
  // is honestly limited. Phase 2 narrows it.
  division_admin: 0,
}

export type LeagueCapability =
  // See the league and its adoption numbers. Every league role.
  | 'view'
  // Run the season: create seasons, divisions and teams, invite and revoke
  // coaches. Coaching directors included — coach enablement is their job, and
  // it is the job this product is for.
  | 'manage'
  // Change who runs the league, and the licence. Held tight because adding a
  // league administrator is privilege escalation.
  | 'administer'

const LEAGUE_NEEDS: Record<LeagueCapability, LeagueRole> = {
  view: 'division_admin',
  manage: 'coaching_director',
  administer: 'commissioner',
}

export function isLeagueRole(value: unknown): value is LeagueRole {
  return typeof value === 'string' && value in LEAGUE_RANK
}

/**
 * Does this role carry this capability?
 */
export function canManageLeague(
  role: LeagueRole | null | undefined,
  capability: LeagueCapability = 'manage'
): boolean {
  if (!isLeagueRole(role)) return false
  return LEAGUE_RANK[role] >= LEAGUE_RANK[LEAGUE_NEEDS[capability]]
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export interface LeagueMembership {
  leagueId: string
  userId: string
  role: LeagueRole
}

/**
 * This user's membership of this league, or null.
 */
export async function getLeagueMembership(
  userId: string,
  leagueId: string
): Promise<LeagueMembership | null> {
  if (!userId || !leagueId) return null

  const { data } = await supabaseAdmin
    .from('league_members')
    .select('league_id, user_id, role')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()

  const role = (data as any)?.role
  if (!isLeagueRole(role)) return null

  return { leagueId, userId, role }
}

/**
 * Every league this user administers. Drives the "League Admin" nav link,
 * which must not appear for the ordinary coaches a league sponsors.
 */
export async function getLeagueMemberships(userId: string): Promise<LeagueMembership[]> {
  if (!userId) return []

  const { data } = await supabaseAdmin
    .from('league_members')
    .select('league_id, user_id, role')
    .eq('user_id', userId)

  return ((data || []) as any[])
    .filter(m => isLeagueRole(m.role))
    .map(m => ({ leagueId: m.league_id, userId, role: m.role as LeagueRole }))
}

async function currentUserId(): Promise<string | null> {
  const supabase = await sessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

/**
 * The caller may do `capability` on `leagueId`. Throws AuthzError otherwise.
 *
 * Returns the membership so a handler that has already established who is
 * asking does not have to ask again.
 */
export async function requireLeagueRole(
  leagueId: string | null | undefined,
  capability: LeagueCapability = 'view'
): Promise<LeagueMembership> {
  if (!leagueId) throw new AuthzError('Missing leagueId', 400)

  const userId = await currentUserId()
  if (!userId) throw new AuthzError('You need to be signed in', 401)

  const membership = await getLeagueMembership(userId, leagueId)

  // 404 rather than 403, matching authorizeTeam(): a 403 confirms to somebody
  // probing that the league id they guessed is real.
  if (!membership) throw new AuthzError('Not found', 404)

  if (!canManageLeague(membership.role, capability)) {
    throw new AuthzError(LEAGUE_REFUSALS[capability](membership.role), 403)
  }

  return membership
}

// Named for what the person would need, not for the rule that stopped them.
const LEAGUE_REFUSALS: Record<LeagueCapability, (role: LeagueRole) => string> = {
  view: () => 'You do not have access to this league.',
  manage: () =>
    'Only a league admin can change seasons, divisions, teams or invitations. Ask your commissioner.',
  administer: () =>
    'Only the league owner or commissioner can change who administers this league.',
}

/**
 * The one-line guard, matching guard() in lib/authz.ts:
 *
 *   const denied = await guardLeague(request, 'manage')
 *   if (denied) return denied
 *
 * Finds the leagueId on the request and refuses if the caller may not do
 * `capability` there. Fails CLOSED — a request carrying no leagueId at all is
 * refused rather than waved through.
 */
export async function guardLeague(request: Request, capability: LeagueCapability = 'view') {
  try {
    await requireLeagueRole(await leagueIdFrom(request), capability)
    return null
  } catch (error) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    throw error
  }
}

async function leagueIdFrom(request: Request): Promise<string | null> {
  let leagueId: string | null = null

  try {
    leagueId = new URL(request.url).searchParams.get('leagueId')
  } catch { /* not a URL we can parse */ }

  // Reading .method can throw during Next's build-time prerender pass — the
  // same stand-in Request that idsFrom() in lib/authz.ts guards against. Every
  // league route sets force-dynamic so that pass never runs; this is the belt.
  let method = 'GET'
  try { method = request.method } catch { /* treat as GET */ }

  if (!leagueId && method !== 'GET' && method !== 'HEAD') {
    try {
      // A clone, so the handler can still read its own body.
      const body = await request.clone().json()
      if (body && typeof body === 'object' && typeof body.leagueId === 'string') {
        leagueId = body.leagueId
      }
    } catch { /* no body, or not JSON */ }
  }

  return leagueId
}
