// Player scope: who may read private context about which player.
//
//   npm run test:player-scope
//
// Three layers, each executed rather than read:
//
//   1. lib/playerScope.ts — the rule itself, against the strict in-memory
//      database (scripts/lib/strictSupabase.ts), which applies every filter and
//      refuses operators it does not implement.
//
//   2. lib/coachContext.ts — the shared context builder, the same way, with the
//      query log inspected: a player-scoped table must never be queried for a
//      player the scope did not verify.
//
//   3. The REAL authorization path and the REAL route handlers. lib/authz.ts
//      runs unmodified: session → user → coach account → team role → player.
//      Exactly one thing is supplied by the test, because Next supplies it at
//      runtime and nothing else can: the request's cookie jar (next/headers).
//      The session cookie in it is read by the real @supabase/ssr client, and
//      the access token is validated over HTTP by a local stand-in for the auth
//      server — so a request with no cookie, or a token the auth server does
//      not recognise, is refused by the same code production runs. The model
//      API is a capture server on the same port; no model is called.
//
// What this cannot establish: that production's auth server, cookies and data
// behave as these stand-ins do. See the release check printed at the end.
//
// All data is synthetic — scripts/fixtures/playerScopeFixture.ts.

import * as http from 'http'
import * as path from 'path'
import { seed, U, C, T, P, STAGE, mark, markers } from './fixtures/playerScopeFixture'
import type { StrictSupabase as StrictT } from './lib/strictSupabase'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const none = (name: string, text: string, forbidden: string[]) => {
  const hit = forbidden.filter(m => text.includes(m))
  check(name, hit.length === 0, `found: ${hit.join(', ')}`)
}
const all = (name: string, text: string, required: string[]) => {
  const miss = required.filter(m => !text.includes(m))
  check(name, miss.length === 0, `missing: ${miss.join(', ')}`)
}

const PRIVATE_TABLES = ['players', 'player_traits', 'player_metrics', 'player_notes', 'player_journal_entries']
/** Every query on a player-scoped table, as `table:playerId`. */
function playerReads(db: StrictT): string[] {
  const out: string[] = []
  for (const q of db.log) {
    if (!PRIVATE_TABLES.includes(q.table)) continue
    // An existence probe that selects only the id — the scope check itself —
    // returns nothing private. Anything else is a read of content.
    if ((q.select || '').replace(/\s/g, '') === 'id') continue
    for (const f of q.filters) {
      if ((f.column === 'player_id' || (q.table === 'players' && f.column === 'id'))) {
        const vals = f.op === 'in' ? (f.value as any[]) : [f.value]
        for (const v of vals) out.push(`${q.table}:${v}`)
      }
    }
  }
  return out
}
const readsOf = (db: StrictT, player: string) => playerReads(db).filter(r => r.endsWith(`:${player}`))

// ── state shared with the stubs ────────────────────────────────────────────

const state: { db: StrictT | null; user: string | null } = { db: null, user: null }
function freshDb(extra?: (t: ReturnType<typeof seed>) => void): StrictT {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { StrictSupabase } = require('./lib/strictSupabase')
  const t = seed()
  if (extra) extra(t)
  state.db = new StrictSupabase(t)
  return state.db!
}

// ── the auth stand-in and the model capture, on one port ───────────────────

const captured: string[] = []
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenFor = (userId: string) => [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'test-signature-not-verified-by-the-stand-in-but-required-by-shape',
].join('.')
const authUser = (id: string) => ({
  id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.test`,
  app_metadata: {}, user_metadata: {}, identities: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const KNOWN_USERS = new Set<string>(Object.values(U))

function startServer(): Promise<number> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const url = req.url || ''
      if (url.startsWith('/auth/v1/user')) {
        // The auth server's job: say whose token this is, or refuse it.
        const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        let sub: string | null = null
        try { sub = JSON.parse(Buffer.from(tok.split('.')[1] || '', 'base64url').toString()).sub } catch { /* bad token */ }
        if (sub && KNOWN_USERS.has(sub) && tok.split('.')[2]?.startsWith('test-signature')) {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(authUser(sub)))
        } else {
          res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'invalid JWT' }))
        }
        return
      }
      if (url.startsWith('/v1/messages')) {
        try {
          const j = JSON.parse(body || '{}')
          const parts: string[] = []
          if (typeof j.system === 'string') parts.push(j.system)
          else for (const b of j.system || []) if (b?.text) parts.push(b.text)
          for (const m of j.messages || []) {
            if (typeof m.content === 'string') parts.push(m.content)
            else for (const b of m.content || []) if (b?.text) parts.push(b.text)
          }
          captured.push(parts.join('\n'))
        } catch { captured.push(body) }
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture: recorded' } }))
        return
      }
      res.writeHead(404); res.end('{}')
    })
  })
  server.unref()
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))
}

function installStubs(port: number) {
  // Database: service-role clients get the strict fake; anon-key clients — the
  // ones @supabase/ssr builds to read the session — get the REAL client, pointed
  // at the auth stand-in.
  const sbPath = require.resolve('@supabase/supabase-js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realSb = require('@supabase/supabase-js')
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const target: any = state.db
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  require.cache[sbPath]!.exports = {
    ...realSb,
    createClient: (url: string, key: string, opts?: any) =>
      key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? realSb.createClient(url, key, opts) : proxy,
  }

  // The request cookie jar — the one thing Next provides at runtime.
  const hPath = require.resolve('next/headers')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realHeaders = require('next/headers')
  const cookieName = `sb-${new URL(`http://127.0.0.1:${port}`).hostname.split('.')[0]}-auth-token`
  const jar = () => {
    const cookies: Array<{ name: string; value: string }> = []
    if (state.user) {
      const session = {
        access_token: tokenFor(state.user), token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${state.user}`,
        user: authUser(state.user),
      }
      cookies.push({ name: cookieName, value: JSON.stringify(session) })
    }
    return {
      get: (n: string) => cookies.find(c => c.name === n),
      getAll: () => cookies,
      has: (n: string) => cookies.some(c => c.name === n),
    }
  }
  require.cache[hPath]!.exports = { ...realHeaders, cookies: () => jar() }
}

function req(url: string, init: { method?: string; body?: any } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NextRequest } = require('next/server')
  return new NextRequest(`http://localhost${url}`, {
    method: init.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}
async function call(handler: any, url: string, init: { method?: string; body?: any; params?: any } = {}) {
  const res = await handler(req(url, init), init.params ? { params: init.params } : undefined)
  let text = ''
  try { text = await res.text() } catch { /* body errored */ }
  return { status: res.status as number, text }
}

// ── layer 1 and 2: the rule and the builder ────────────────────────────────

async function structural() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolvePlayerScope } = require('../lib/playerScope')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { assembleCoachContext, renderCoachContext } = require('../lib/coachContext')

  const db = freshDb()
  const r = (o: any) => resolvePlayerScope(db, o)
  check('rule: roster player on their team', (await r({ playerId: P.marcus, teamId: T.a })).ok)
  check('rule: archived player on their team', (await r({ playerId: P.archie, teamId: T.a })).via === 'archive')
  check('rule: another team\'s player is refused', !(await r({ playerId: P.zoe, teamId: T.a })).ok)
  check('rule: a missing player is refused', !(await r({ playerId: P.missing, teamId: T.a })).ok)
  check('rule: no team — the owning coach', (await r({ playerId: P.solokid, ownerCoachId: C.solo })).ok)
  check('rule: no team — another coach\'s player is refused', !(await r({ playerId: P.zoe, ownerCoachId: C.solo })).ok)
  check('rule: no team and no coach is refused', !(await r({ playerId: P.solokid })).ok)
  check('rule: empty id is refused', !(await r({ playerId: '', teamId: T.a })).ok)
  const failing = new (require('./lib/strictSupabase').StrictSupabase)(seed(), { failing: ['team_players', 'team_player_archive', 'players'] })
  check('rule: a failed read is a refusal', !(await resolvePlayerScope(failing, { playerId: P.marcus, teamId: T.a })).ok &&
    !(await resolvePlayerScope(failing, { playerId: P.solokid, ownerCoachId: C.solo })).ok)

  // The builder, permitted.
  const okDb = freshDb()
  const ok = renderCoachContext(await assembleCoachContext(okDb, { coachId: C.a, teamId: T.a, playerId: P.marcus }))
  all('builder: a team player\'s private context is present', ok,
    [mark(P.marcus, 'name'), mark(P.marcus, 'trait'), mark(P.marcus, 'note'), mark(P.marcus, 'observation')])
  check('builder: the permitted player\'s measurements are read', readsOf(okDb, P.marcus).includes(`player_metrics:${P.marcus}`))

  // Denied — another team's player, and a missing one.
  const denyDb = freshDb()
  const denied = renderCoachContext(await assembleCoachContext(denyDb, { coachId: C.a, teamId: T.a, playerId: P.zoe }))
  none('builder: nothing of another team\'s player', denied, markers(P.zoe))
  check('builder: no player-scoped table is queried for them', readsOf(denyDb, P.zoe).length === 0, readsOf(denyDb, P.zoe).join(', '))
  none('builder: and no team-wide fallback replaces them', denied, ['MK-team-a-wide-observation', ...markers(P.marcus)])

  const missDb = freshDb()
  const missing = renderCoachContext(await assembleCoachContext(missDb, { coachId: C.a, teamId: T.a, playerId: P.missing }))
  check('builder: a missing player and an out-of-scope one look identical', missing === denied)
  check('builder: no player-scoped table is queried for a missing player', readsOf(missDb, P.missing).length === 0)

  // No team.
  const soloDb = freshDb()
  const solo = renderCoachContext(await assembleCoachContext(soloDb, { coachId: C.solo, playerId: P.solokid }))
  all('builder: solo coach\'s own player', solo, [mark(P.solokid, 'name'), mark(P.solokid, 'trait'), mark(P.solokid, 'observation')])
  const soloDenyDb = freshDb()
  const soloDeny = renderCoachContext(await assembleCoachContext(soloDenyDb, { coachId: C.solo, playerId: P.zoe }))
  none('builder: no team — another coach\'s player yields nothing', soloDeny, markers(P.zoe))
  check('builder: no team — nothing queried for them', readsOf(soloDenyDb, P.zoe).length === 0)
  const blankDb = freshDb()
  await assembleCoachContext(blankDb, { coachId: '', playerId: P.solokid })
  check('builder: no team and no coach — nothing queried', readsOf(blankDb, P.solokid).length === 0)

  // Team-level context without a player is unchanged in kind.
  const teamDb = freshDb()
  const team = renderCoachContext(await assembleCoachContext(teamDb, { coachId: C.a, teamId: T.a }))
  all('builder: team context still carries team-wide observations', team, ['MK-team-a-wide-observation'])
  none('builder: team context carries no other team', team, markers(P.zoe))

  // Development plans and player scope, together. A permitted player's plan
  // is in context; a refused player gets neither their own plan NOR the team's
  // plans in its place; a team question still gets the team's plans.
  all('plans: a permitted player\'s plan is in context', ok, ['DEVELOPMENT PLANS', STAGE.two, mark(P.marcus, 'plannote')])
  none('plans: a refused player gets no plan block at all', denied, ['DEVELOPMENT PLANS', STAGE.one, STAGE.two, mark(P.zoe, 'plannote'), mark(P.marcus, 'plannote')])
  none('plans: nor does a missing player', missing, ['DEVELOPMENT PLANS', STAGE.two, mark(P.marcus, 'plannote')])
  check('plans: no plan table is queried for a refused player',
    !denyDb.log.some(q => q.table === 'player_pathway_progress' || q.table === 'player_pathway_events'))
  all('plans: a team question gets the team\'s plans', team, ['DEVELOPMENT PLANS', STAGE.two])
  none('plans: a team question gets no other team\'s plans', team, [mark(P.zoe, 'plannote')])

  // A coach who controls two teams: a player on team C is still outside team A.
  const crossDb = freshDb()
  const cross = renderCoachContext(await assembleCoachContext(crossDb, { coachId: C.a, teamId: T.a, playerId: P.cleo }))
  none('builder: the same coach\'s other team is still out of scope', cross, [...markers(P.cleo), 'DEVELOPMENT PLANS'])
}

// ── layer 3: the real authorization path and the real routes ───────────────

async function real() {
  const port = Number(process.env.__PORT)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authz = require('../lib/authz')
  const as = (u: string | null) => { state.user = u }
  const outcome = async (fn: () => Promise<any>) => {
    try { const v = await fn(); return { ok: true, v, status: 200, msg: '' } }
    catch (e: any) { return { ok: false, v: null, status: e?.status ?? 500, msg: String(e?.message) } }
  }

  // ── authorizePlayer, every role ─────────────────────────────────────────
  freshDb()
  const ap = (u: string | null, playerId: string, teamId: string | null, capability = 'ask') => {
    as(u); return outcome(() => authz.authorizePlayer(playerId, { teamId, capability }))
  }
  check('authz: owner reaches their team\'s player', (await ap(U.ownerA, P.marcus, T.a)).ok)
  check('authz: owner reaches an archived player', (await ap(U.ownerA, P.archie, T.a)).ok)
  check('authz: contributor reaches the team\'s player to ask', (await ap(U.assistant, P.marcus, T.a, 'ask')).ok)
  check('authz: contributor reaches the team\'s player to record', (await ap(U.assistant, P.marcus, T.a, 'record')).ok)
  const asstDecide = await ap(U.assistant, P.marcus, T.a, 'decide')
  check('authz: contributor may not decide — same as team permissions', !asstDecide.ok && asstDecide.status === 403, JSON.stringify(asstDecide))
  check('authz: viewer reaches the team\'s player to ask', (await ap(U.viewer, P.marcus, T.a, 'ask')).ok)

  const other = await ap(U.ownerA, P.zoe, T.a)
  const miss = await ap(U.ownerA, P.missing, T.a)
  check('authz: another team\'s player is refused', !other.ok && other.status === 404)
  check('authz: missing and out-of-scope refusals are identical', other.status === miss.status && other.msg === miss.msg,
    `${other.status} ${other.msg} vs ${miss.status} ${miss.msg}`)
  check('authz: a coach of another team cannot use this team', !(await ap(U.ownerB, P.marcus, T.a)).ok)
  check('authz: league administration grants no player access', !(await ap(U.league, P.marcus, T.a)).ok)
  check('authz: a stranger is refused', !(await ap(U.stranger, P.marcus, T.a)).ok)
  const anon = await ap(null, P.marcus, T.a)
  check('authz: no session is refused as unauthenticated', !anon.ok && anon.status === 401, JSON.stringify(anon))

  check('authz: solo coach reaches their own team-less player', (await ap(U.solo, P.solokid, null)).ok)
  check('authz: owner reaches their own team-less player', (await ap(U.ownerA, P.homekid, null)).ok)
  const asstNoTeam = await ap(U.assistant, P.homekid, null)
  check('authz: staff do not reach the head coach\'s team-less player', !asstNoTeam.ok && asstNoTeam.status === 404)
  check('authz: staff cannot reach a team player by leaving the team out', !(await ap(U.assistant, P.marcus, null)).ok)
  check('authz: no team — another coach\'s player is refused', !(await ap(U.solo, P.zoe, null)).ok)
  check('authz: no team — the viewer\'s own empty account reaches nothing', !(await ap(U.viewer, P.marcus, null)).ok)
  const soloOther = await ap(U.solo, P.zoe, null), soloMiss = await ap(U.solo, P.missing, null)
  check('authz: no team — missing and out-of-scope identical', soloOther.status === soloMiss.status && soloOther.msg === soloMiss.msg)

  // ── the routes ──────────────────────────────────────────────────────────
  const root = path.resolve(__dirname, '..', 'app', 'api')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const load = (p: string) => require(path.join(root, p))
  const chat = load('chat/route.ts')
  const threads = load('chat/threads/route.ts')
  const prescribe = load('prescribe/route.ts')
  const commit = load('prescribe/commit/route.ts')
  const devplan = load('development-plan/route.ts')
  const drills = load('prescribe/drills/route.ts')
  const checkin = load('checkin/route.ts')
  const sources = load('player-reports/[reportId]/sources/route.ts')
  const draftR = load('player-reports/draft/route.ts')

  // Everything a refused request produced — responses and model requests —
  // collected so one check can say none of it names a refused player.
  const refusedOutput: string[] = []
  const refused = async (label: string, p: Promise<{ status: number; text: string }>) => {
    captured.length = 0
    const r = await p
    refusedOutput.push(r.text, ...captured)
    check(`${label}: refused`, r.status === 404, `status ${r.status} ${r.text.slice(0, 200)}`)
    check(`${label}: nothing sent to the model`, captured.length === 0, `${captured.length} request(s)`)
    return r
  }

  // Chat.
  freshDb(); as(U.ownerA)
  captured.length = 0
  await call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.marcus, message: 'How is he throwing?', history: [] } })
  const chatOk = captured.join('\n')
  all('chat: owner — the player\'s private context reaches the prompt', chatOk,
    [mark(P.marcus, 'name'), mark(P.marcus, 'trait'), mark(P.marcus, 'observation')])
  none('chat: owner — no other player', chatOk, markers(P.zoe))

  freshDb(); as(U.assistant); captured.length = 0
  await call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.marcus, message: 'How is he throwing?', history: [] } })
  all('chat: contributor — permitted player context reaches the prompt', captured.join('\n'),
    [mark(P.marcus, 'trait'), mark(P.marcus, 'observation')])

  freshDb(); as(U.ownerA)
  const cz = await refused('chat: another team\'s player', call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.zoe, message: 'x', history: [] } }))
  const cm = await refused('chat: a missing player', call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.missing, message: 'x', history: [] } }))
  check('chat: missing and out-of-scope responses are identical', cz.status === cm.status && cz.text === cm.text)
  check('chat: a refused player is not stored on a thread', (state.db!.tables.chat_threads || []).every(t => t.player_id !== P.zoe))
  as(U.league)
  const cl = await call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.marcus, message: 'x', history: [] } })
  refusedOutput.push(cl.text)
  check('chat: league administration is refused at the team', cl.status === 404, `status ${cl.status}`)

  // Development plans through the real path: permitted in, refused out, and
  // no team plans in place of a refused player.
  freshDb(); as(U.ownerA); captured.length = 0
  await call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.marcus, message: 'How is he throwing?', history: [] } })
  all('plans/chat: the permitted player\'s plan reaches the prompt', captured.join('\n'), [STAGE.two, mark(P.marcus, 'plannote')])
  freshDb(); as(U.ownerA)
  const pz = await refused('plans/chat: another team\'s player', call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.zoe, message: 'x', history: [] } }))
  none('plans/chat: the refusal carries no plan of anyone', pz.text, [STAGE.one, STAGE.two, mark(P.zoe, 'plannote'), mark(P.marcus, 'plannote')])
  await refused('plans/chat: a player on the same coach\'s other team', call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, playerId: P.cleo, message: 'x', history: [] } }))
  captured.length = 0
  await call(chat.POST, '/api/chat', { method: 'POST', body: { teamId: T.a, message: 'Plan the week.', history: [] } })
  all('plans/chat: a team question still gets the team\'s plans', captured.join('\n'), [STAGE.two])
  none('plans/chat: and no other team\'s', captured.join('\n'), [mark(P.zoe, 'plannote')])

  // Threads.
  freshDb(t => {
    t.chat_threads = [
      { id: 'th-ok', team_id: T.a, player_id: P.marcus, title: 'ok', created_at: '2026-09-01T00:00:00Z', last_message_at: '2026-09-02T00:00:00Z', archived: false },
      { id: 'th-stored-other', team_id: T.a, player_id: P.zoe, title: 'stored', created_at: '2026-09-01T00:00:00Z', last_message_at: '2026-09-01T00:00:00Z', archived: false },
    ]
  })
  as(U.ownerA)
  await refused('threads: create with another team\'s player', call(threads.POST, '/api/chat/threads', { method: 'POST', body: { teamId: T.a, playerId: P.zoe } }))
  check('threads: nothing created', !(state.db!.tables.chat_threads || []).some(t => t.id !== 'th-ok' && t.id !== 'th-stored-other'))
  await refused('threads: re-scope to another team\'s player', call(threads.PATCH, '/api/chat/threads', { method: 'PATCH', body: { threadId: 'th-ok', playerId: P.zoe } }))
  check('threads: thread unchanged', state.db!.tables.chat_threads.find(t => t.id === 'th-ok')!.player_id === P.marcus)
  const list = await call(threads.GET, `/api/chat/threads?teamId=${T.a}`)
  refusedOutput.push(list.text)
  check('threads: list keeps the team\'s own player', list.text.includes(mark(P.marcus, 'name')))
  none('threads: list does not name a stored player from another team', list.text, markers(P.zoe))
  const ok = await call(threads.POST, '/api/chat/threads', { method: 'POST', body: { teamId: T.a, playerId: P.marcus } })
  check('threads: create with the team\'s player still works', ok.status === 200, `status ${ok.status}`)

  // Analysis (prescribe): team, solo, and no-team refusals.
  freshDb(); as(U.ownerA); captured.length = 0
  await call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { teamId: T.a, playerId: P.marcus, complaint: 'throws sail high', persist: false } })
  all('prescribe: team player — private context reaches the analysis', captured.join('\n'), [mark(P.marcus, 'trait')])
  freshDb(); as(U.solo); captured.length = 0
  await call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { coachId: C.solo, playerId: P.solokid, complaint: 'throws sail high', persist: false } })
  all('prescribe: solo coach — own player reaches the analysis', captured.join('\n'), [mark(P.solokid, 'trait'), mark(P.solokid, 'observation')])
  freshDb(); as(U.ownerA)
  await refused('prescribe: another team\'s player', call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { teamId: T.a, playerId: P.zoe, complaint: 'x', persist: false } }))
  as(U.solo)
  await refused('prescribe: no team — another coach\'s player', call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { coachId: C.solo, playerId: P.zoe, complaint: 'x', persist: false } }))
  as(U.assistant)
  await refused('prescribe: staff, no team — the head coach\'s team-less player', call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { coachId: C.a, playerId: P.homekid, complaint: 'x', persist: false } }))
  await refused('prescribe: staff, no team — a team player without the team', call(prescribe.POST, '/api/prescribe', { method: 'POST', body: { coachId: C.a, playerId: P.marcus, complaint: 'x', persist: false } }))

  // Commit — the write that stores a player on a priority.
  freshDb(); as(U.ownerA)
  const draft = (playerId: string, teamId: string | null) => ({ coachId: C.a, draft: {
    markdown: '## Priority\nx', sections: [], scope: 'player', playerId, teamId, focusArea: null,
  } })
  await refused('commit: another team\'s player', call(commit.POST, '/api/prescribe/commit', { method: 'POST', body: draft(P.zoe, T.a) }))
  await refused('commit: another coach\'s player with no team', call(commit.POST, '/api/prescribe/commit', { method: 'POST', body: draft(P.solokid, null) }))
  check('commit: no priority written for a refused player', (state.db!.tables.prescriptions || []).length === 0)
  const good = await call(commit.POST, '/api/prescribe/commit', { method: 'POST', body: draft(P.marcus, T.a) })
  check('commit: the team\'s own player is still accepted', good.status === 200 && (state.db!.tables.prescriptions || []).some(r => r.player_id === P.marcus),
    `status ${good.status} ${good.text.slice(0, 200)}`)

  // Stored rows that name a player outside their own team: every reader
  // treats them as absent.
  const rx = (id: string, player: string) => ({
    id, coach_id: C.a, team_id: T.a, player_id: player, scope: 'player', status: 'active', priority: 'x',
    success_criteria: 'y', focus_area: 'throwing', drill_ids: [], issued_at: '2026-09-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z', review_due_at: '2026-09-20T00:00:00Z', plan_steps: null, current_step: null,
  })
  const withRows = () => freshDb(t => {
    t.prescriptions = [rx('rx-ok', P.marcus), rx('rx-other', P.zoe)]
    t.player_reports = [
      { id: 'rep-ok', team_id: T.a, player_id: P.marcus, coach_id: C.a, status: 'draft', report_type: 'general', context: null },
      { id: 'rep-other', team_id: T.a, player_id: P.zoe, coach_id: C.a, status: 'draft', report_type: 'general', context: null },
      { id: 'rep-final', team_id: T.a, player_id: P.marcus, coach_id: C.a, status: 'final', report_type: 'general',
        context: { player_name: 'Frozen Name', frozen: true }, strengths_content: 'frozen' },
    ]
  })

  withRows(); as(U.ownerA)
  const dp = await refused('development plan: a priority naming another team\'s player',
    call(devplan.POST, '/api/development-plan', { method: 'POST', body: { prescriptionId: 'rx-other', coachId: C.a } }))
  const dm = await call(devplan.POST, '/api/development-plan', { method: 'POST', body: { prescriptionId: 'rx-missing', coachId: C.a } })
  check('development plan: indistinguishable from a missing priority', dp.status === dm.status && dp.text === dm.text, `${dp.text} vs ${dm.text}`)
  captured.length = 0
  await call(devplan.POST, '/api/development-plan', { method: 'POST', body: { prescriptionId: 'rx-ok', coachId: C.a } })
  all('development plan: the team\'s own player still reaches the plan writer', captured.join('\n'), [mark(P.marcus, 'trait')])

  await refused('drill swap: a priority naming another team\'s player',
    call(drills.POST, '/api/prescribe/drills', { method: 'POST', body: { prescriptionId: 'rx-other', coachId: C.a } }))

  const ev = await call(checkin.GET, `/api/checkin?coachId=${C.a}&prescriptionId=rx-other`)
  refusedOutput.push(ev.text)
  check('check-in: evidence for another team\'s player is refused', ev.status === 404, `status ${ev.status}`)
  const cl2 = await call(checkin.GET, `/api/checkin?coachId=${C.a}`)
  refusedOutput.push(cl2.text)
  check('check-in list: keeps the team\'s own player', cl2.text.includes(mark(P.marcus, 'name')), cl2.text.slice(0, 300))
  check('check-in list: omits the priority naming another team\'s player', !cl2.text.includes('rx-other'))

  // Reports.
  withRows(); as(U.ownerA)
  const repDb = state.db!
  const src = await call(sources.GET, '/api/player-reports/rep-other/sources', { params: { reportId: 'rep-other' } })
  refusedOutput.push(src.text)
  check('report sources: a report naming another team\'s player offers nothing', JSON.parse(src.text).items?.length === 0, src.text.slice(0, 200))
  check('report sources: no player-scoped table queried for them', readsOf(repDb, P.zoe).length === 0, readsOf(repDb, P.zoe).join(', '))
  const srcOk = await call(sources.GET, '/api/player-reports/rep-ok/sources', { params: { reportId: 'rep-ok' } })
  check('report sources: the team\'s own player still offers their record', srcOk.text.includes(mark(P.marcus, 'trait')))
  check('report sources: and their development plan', srcOk.text.includes(STAGE.two))
  none('report sources: a refused report offers no plan', src.text, [STAGE.one, STAGE.two])
  captured.length = 0
  await call(draftR.POST, '/api/player-reports/draft', { method: 'POST', body: { reportId: 'rep-other', kind: 'development', items: [{ id: 'n', kind: 'note', date: null, text: 'Worked hard.' }] } })
  refusedOutput.push(...captured)
  const before = JSON.stringify(repDb.tables.player_reports.find(r => r.id === 'rep-final'))
  await call(draftR.POST, '/api/player-reports/draft', { method: 'POST', body: { reportId: 'rep-final', kind: 'development', items: [{ id: 'n', kind: 'note', date: null, text: 'x' }] } })
  check('reports: a finalized report is unchanged', JSON.stringify(repDb.tables.player_reports.find(r => r.id === 'rep-final')) === before)
  check('reports: no report row written in the whole flow', !repDb.log.some(q => q.op !== 'select' && q.table.startsWith('player_report')))

  // One sweep over everything refused requests produced.
  none('sweep: no refused request produced any of another team\'s player data', refusedOutput.join('\n'), markers(P.zoe))
  none('sweep: nor any of another coach\'s team-less player', refusedOutput.join('\n'), [...markers(P.solokid), ...markers(P.homekid)])
  none('sweep: nor any of a player on the same coach\'s other team', refusedOutput.join('\n'), markers(P.cleo))
  none('sweep: nor any team plan in place of a refused player', refusedOutput.join('\n'), [STAGE.one, STAGE.two])
  void port
}

async function main() {
  const port = await startServer()
  process.env.__PORT = String(port)
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  freshDb()
  installStubs(port)
  await structural()
  await real()
}

main().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log(`
Executed: the scope rule, the shared context builder, lib/authz.ts unmodified
(session cookie → auth server → coach → team role → player), and nine real
route handlers. Supplied by the test: the request cookie jar, an auth server
stand-in, a strict in-memory database, and a model capture server.
Remaining release check: a signed-in smoke test against the deployed app.`)
  process.exit(0)
}).catch(e => { console.error(e); process.exit(1) })
