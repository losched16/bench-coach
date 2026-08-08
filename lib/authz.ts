import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Who is asking, and are they allowed.
//
// Every API route in this app uses the service-role client, which bypasses RLS
// by design — the routes do work RLS cannot express. The cost is that RLS then
// protects nothing on those paths, and for a long time they took a teamId
// straight from the request body and trusted it. Any logged-in user who knew a
// teamId could read and write another coach's team.
//
// So authorization lives here, in one module, rather than as a judgement call
// in forty-odd files. A route asks a single question — "may this caller record
// against this game?" — and gets an answer or an error to return.
//
// THE PERMISSION MODEL: RECORD, DON'T DECIDE
//
// A contributor is a user, not an editor. They can write down what HAPPENED —
// the book, pitch counts, notes, scouting captures, tonight's eligibility. Those
// are facts: appendable, attributable, and undoable.
//
// They cannot decide what happens NEXT — priorities, the roster, a pre-game
// lineup, team settings. Those are the head coach's, because they redirect a
// kid's development or change what the team is.
//
// The line runs between a record of tonight and a decision about the season.
// Trying a kid at catcher for one game is a record. Deciding he is a catcher is
// a decision.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Role = 'owner' | 'admin' | 'contributor' | 'viewer'

// Ordered weakest to strongest. Every check is "at least this".
const RANK: Record<Role, number> = { viewer: 0, contributor: 1, admin: 2, owner: 3 }

export type Capability =
  // Look at it. Every role, including viewer.
  | 'read'
  // Ask CoachAI. A viewer may ask anything — reading everything and teaching
  // it nothing is a coherent position, and the most useful thing a parent
  // helper can do with the app.
  | 'ask'
  // Write down what happened: the scorebook, pitch counts, game notes, log
  // entries, scouting captures, in-game substitutions, tonight's eligibility.
  | 'record'
  // Decide what happens next: the roster, pre-game lineups, priorities, team
  // settings, the drill library.
  | 'decide'
  // Reshape the owner's persistent memory. Separate from 'decide' because
  // CoachAI does it as a SIDE EFFECT of a conversation — a contributor asking
  // a question must not quietly rewrite how the app understands the head
  // coach, and would never see it happen.
  | 'remember'
  // Staff and billing.
  | 'own'

const NEEDS: Record<Capability, Role> = {
  read: 'viewer',
  ask: 'viewer',
  record: 'contributor',
  decide: 'admin',
  remember: 'admin',
  own: 'owner',
}

export function can(role: Role, capability: Capability): boolean {
  return RANK[role] >= RANK[NEEDS[capability]]
}

export interface Actor {
  userId: string
  // The caller's OWN coach row, when they have one. An invited assistant may
  // not.
  coachId: string | null
  // The coach who owns the data being touched. Almost everything is scoped to
  // this rather than to the caller — a contributor logging a game writes into
  // the head coach's team, which is the point.
  ownerCoachId: string
  role: Role
}

export class AuthzError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * A Supabase client that reads the caller's session from the request cookies.
 *
 * The adapter shape is VERSION SPECIFIC and getting it wrong fails silently as
 * "not signed in" — which is the worst possible way for an auth bug to
 * present, because it looks like the user's data is gone.
 *
 * @supabase/ssr 0.1.x (what this project is on) wants get/set/remove.
 * 0.4+ wants getAll/setAll. Supplying BOTH means an upgrade cannot quietly
 * log everybody out, and the unused pair is ignored either way.
 *
 * The writers are no-ops on purpose: these callers only ever READ who you are.
 * A route handler that rotated the session cookie without returning it would
 * hand back a token the browser never receives.
 */
export async function sessionClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set() { /* read-only */ },
        remove() { /* read-only */ },
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only */ },
      } as any,
    }
  )
}

async function currentUserId(): Promise<string | null> {
  // Reads the session cookie rather than trusting anything in the request
  // body. This is the whole point: the caller does not get to say who they are.
  const supabase = await sessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

async function roleFor(userId: string, teamId: string): Promise<{
  role: Role; ownerCoachId: string; coachId: string | null
} | null> {
  const [{ data: team }, { data: ownCoach }] = await Promise.all([
    supabaseAdmin.from('teams').select('id, coach_id').eq('id', teamId).maybeSingle(),
    supabaseAdmin.from('coaches').select('id').eq('user_id', userId).maybeSingle(),
  ])
  if (!team) return null

  const ownerCoachId = (team as any).coach_id as string
  const coachId = (ownCoach as any)?.id || null

  // The owner, by way of their coach row.
  const { data: ownerCoach } = await supabaseAdmin
    .from('coaches').select('user_id').eq('id', ownerCoachId).maybeSingle()
  if ((ownerCoach as any)?.user_id === userId) {
    return { role: 'owner', ownerCoachId, coachId }
  }

  const { data: membership } = await supabaseAdmin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle()

  const r = (membership as any)?.role
  if (r === 'admin' || r === 'contributor' || r === 'viewer') {
    return { role: r, ownerCoachId, coachId }
  }

  // Not the owner, not a member. Not "forbidden" — as far as this caller is
  // concerned the team does not exist, and saying otherwise confirms a guessed
  // id is real.
  return null
}

/**
 * The caller may do `capability` on `teamId`. Throws AuthzError otherwise.
 */
export async function authorizeTeam(
  teamId: string | null | undefined,
  capability: Capability
): Promise<Actor> {
  if (!teamId) throw new AuthzError('Missing teamId', 400)

  const userId = await currentUserId()
  if (!userId) throw new AuthzError('You need to be signed in', 401)

  const found = await roleFor(userId, teamId)
  // Deliberately 404, not 403. A 403 tells someone probing that the id they
  // guessed belongs to a real team.
  if (!found) throw new AuthzError('Team not found', 404)

  if (!can(found.role, capability)) {
    throw new AuthzError(REFUSALS[capability](found.role), 403)
  }

  return { userId, coachId: found.coachId, ownerCoachId: found.ownerCoachId, role: found.role }
}

/**
 * Same, for routes that identify their subject by game rather than by team.
 */
export async function authorizeGame(
  gameId: string | null | undefined,
  capability: Capability
): Promise<Actor & { teamId: string }> {
  if (!gameId) throw new AuthzError('Missing gameId', 400)

  const { data: game } = await supabaseAdmin
    .from('games').select('id, team_id').eq('id', gameId).maybeSingle()
  if (!game) throw new AuthzError('Game not found', 404)

  const teamId = (game as any).team_id as string
  const actor = await authorizeTeam(teamId, capability)
  return { ...actor, teamId }
}

/**
 * For routes scoped to a coach rather than a team — scouting, mostly.
 *
 * The caller passes a coachId. They may act on it if it is their own, or if
 * they are on one of that coach's teams with the capability. Scouting is shared
 * across a coach's teams, so membership of any one of them is the grant.
 */
export async function authorizeCoach(
  coachId: string | null | undefined,
  capability: Capability
): Promise<Actor> {
  if (!coachId) throw new AuthzError('Missing coachId', 400)

  const userId = await currentUserId()
  if (!userId) throw new AuthzError('You need to be signed in', 401)

  const { data: coach } = await supabaseAdmin
    .from('coaches').select('id, user_id').eq('id', coachId).maybeSingle()
  if (!coach) throw new AuthzError('Not found', 404)

  if ((coach as any).user_id === userId) {
    return { userId, coachId, ownerCoachId: coachId, role: 'owner' }
  }

  // A member of any team this coach owns, taking their strongest role.
  const { data: teams } = await supabaseAdmin
    .from('teams').select('id').eq('coach_id', coachId)
  const teamIds = ((teams || []) as any[]).map(t => t.id)
  if (teamIds.length === 0) throw new AuthzError('Not found', 404)

  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('role')
    .eq('user_id', userId)
    .in('team_id', teamIds)

  const roles = ((memberships || []) as any[])
    .map(m => m.role)
    .filter((r): r is Role => r === 'admin' || r === 'contributor' || r === 'viewer')
  if (roles.length === 0) throw new AuthzError('Not found', 404)

  const role = roles.sort((a, b) => RANK[b] - RANK[a])[0]
  if (!can(role, capability)) throw new AuthzError(REFUSALS[capability](role), 403)

  // Their own coach row, if they have one — distinct from whose data this is.
  const { data: ownCoach } = await supabaseAdmin
    .from('coaches').select('id').eq('user_id', userId).maybeSingle()

  return { userId, coachId: (ownCoach as any)?.id || null, ownerCoachId: coachId, role }
}

// Said in the coach's terms, naming what they'd need. "Permission denied" makes
// an assistant think the app is broken.
const REFUSALS: Record<Capability, (role: Role) => string> = {
  read: () => 'You do not have access to this team.',
  ask: () => 'You do not have access to this team.',
  record: role =>
    role === 'viewer'
      ? 'You are a viewer on this team, so you can look but not record. Ask the head coach to make you a contributor.'
      : 'You do not have permission to record that.',
  decide: role =>
    role === 'contributor'
      ? 'Only the head coach or an admin can change that — contributors can keep the book and log what happened, but not change the roster, lineups or priorities.'
      : 'You are a viewer on this team, so this is read-only for you.',
  remember: () =>
    'Only the head coach or an admin can change what the app remembers about this team.',
  own: () => 'Only the head coach can do that.',
}

/**
 * The shape every route uses in its catch block, so an authorization failure
 * comes back as itself rather than as a 500.
 */
export function authzResponse(error: unknown): { body: { error: string }; status: number } | null {
  if (error instanceof AuthzError) {
    return { body: { error: error.message }, status: error.status }
  }
  return null
}

// ── Resolving by thread ────────────────────────────────

/**
 * Some routes name a chat thread and nothing else. The thread knows its team.
 */
export async function authorizeThread(
  threadId: string | null | undefined,
  capability: Capability
): Promise<Actor & { teamId: string }> {
  if (!threadId) throw new AuthzError('Missing threadId', 400)
  const { data: thread } = await supabaseAdmin
    .from('chat_threads').select('id, team_id').eq('id', threadId).maybeSingle()
  if (!thread) throw new AuthzError('Conversation not found', 404)
  const teamId = (thread as any).team_id as string
  const actor = await authorizeTeam(teamId, capability)
  return { ...actor, teamId }
}

// ── The one-line guard ─────────────────────────────────

async function idsFrom(request: Request): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  try {
    const url = new URL(request.url)
    for (const k of ['teamId', 'gameId', 'coachId', 'threadId']) {
      out[k] = url.searchParams.get(k)
    }
  } catch { /* not a URL we can parse */ }

  // Reading .method can THROW, which is not something a Request is supposed to
  // do. Next's build-time prerender pass hands the handler a stand-in whose
  // accessors are proxied onto an object undici refuses to read private fields
  // from, and the getter blows up. Every route now sets force-dynamic so that
  // pass never runs — this is the belt to that pair of braces, because the
  // failure mode was a green local build and a broken deploy.
  let method = 'GET'
  try { method = request.method } catch { /* treat as GET: no body to read */ }

  // Bodies are read from a CLONE. The handler still gets to call request.json()
  // itself, which is what makes this a one-line addition rather than a rewrite
  // of forty handlers.
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const body = await request.clone().json()
      if (body && typeof body === 'object') {
        for (const k of ['teamId', 'gameId', 'coachId', 'threadId']) {
          if (!out[k] && typeof body[k] === 'string') out[k] = body[k]
        }
      }
    } catch { /* no body, or not JSON — the URL params stand */ }
  }
  return out
}

/**
 * Drop this at the top of a route handler:
 *
 *   const denied = await guard(request, 'record')
 *   if (denied) return denied
 *
 * It finds whatever scope the request carries — game, team, coach or thread —
 * and refuses if the caller may not do `capability` there. Returns null when
 * the caller is allowed.
 *
 * Fails CLOSED: a route with a guard that finds no scope at all is refused
 * rather than waved through, because "I could not tell what you were asking
 * about" is not a reason to allow it.
 */
export async function guard(request: Request, capability: Capability) {
  try {
    const ids = await idsFrom(request)
    // Most specific first: a game names its team, a thread names its team.
    if (ids.gameId) { await authorizeGame(ids.gameId, capability); return null }
    if (ids.teamId) { await authorizeTeam(ids.teamId, capability); return null }
    if (ids.threadId) { await authorizeThread(ids.threadId, capability); return null }
    if (ids.coachId) { await authorizeCoach(ids.coachId, capability); return null }
    throw new AuthzError('Missing teamId', 400)
  } catch (error) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    throw error
  }
}

/**
 * For routes with no team scope at all — a global drill lookup, a vision parse
 * that touches nothing. They still must not be open to the internet.
 */
export async function requireSession() {
  const userId = await currentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'You need to be signed in' }, { status: 401 })
  }
  return null
}

/**
 * The product owner's own tooling.
 *
 * The admin route used to accept ?email=<the address hardcoded in this repo>,
 * which is not authentication — it is a password published in the source. This
 * requires a real signed-in session whose verified email matches.
 */
export async function requireAdmin() {
  const supabase = await sessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  const allowed = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()

  if (!user?.email || !allowed || user.email.toLowerCase() !== allowed) {
    // 404 rather than 403: an admin surface should not confirm it exists.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}
