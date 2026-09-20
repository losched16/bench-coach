// A stand-in for Supabase, so the real app can run in a real browser here.
//
// WHAT THIS IS AND IS NOT
//
// It is an ISOLATED FIXTURE. It speaks enough GoTrue and PostgREST for
// BenchCoach's dashboard and help surfaces to work, backed by an in-memory
// store this process owns. Everything proved against it is a statement about
// the app's own code — that the focus trap traps, that a failed count hides
// the checklist, that a dismissal survives a reload — and NOT a statement
// about production data, production RLS, or production auth.
//
// It is NOT a way around authentication. The browser signs in through the
// real login page against this fixture identity provider and receives a real
// session cookie written by the real Supabase client. Nothing skips the
// middleware, and no production credential is used or needed.
//
// It exists because "production is unreachable from here" is a statement about
// production, not about browsers. Chromium is installed; Next runs; the only
// missing piece was something for it to talk to.

import { createServer } from 'http'

const PORT = Number(process.env.FIXTURE_PORT || 54321)

// ── state ──────────────────────────────────────────────────────────────────

let tables = {}
/** Table name -> status code, for testing what the app does when reads fail. */
let failing = {}
let users = {}

function reset(seed = {}) {
  tables = {
    teams: [], team_players: [], practice_plans: [], team_notes: [],
    user_ui_prefs: [], team_staff: [], coaches: [],
    ...(seed.tables || {}),
  }
  failing = seed.failing || {}
  users = seed.users || {
    'coach@example.test': {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'coach@example.test',
      password: 'fixture-password',
    },
  }
}
reset()

// ── a well-formed unsigned JWT ─────────────────────────────────────────────
//
// The fixture never verifies it; the CLIENT decodes it for the expiry, so the
// claims have to be real even though the signature is not.

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')

function makeToken(user) {
  const now = Math.floor(Date.now() / 1000)
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: user.id, email: user.email, role: 'authenticated',
      aud: 'authenticated', iat: now, exp: now + 3600,
      session_id: 'fixture-session',
    }),
    'fixture-not-a-real-signature',
  ].join('.')
}

function sessionFor(user) {
  return {
    access_token: makeToken(user),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${user.id}`,
    user: {
      id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      phone: '', confirmed_at: '2026-01-01T00:00:00Z',
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, identities: [],
      created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  }
}

function userFromAuth(req) {
  const h = req.headers.authorization || ''
  const token = h.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (!claims.sub) return null
    return Object.values(users).find(u => u.id === claims.sub) || null
  } catch { return null }
}

// ── PostgREST-ish filtering ────────────────────────────────────────────────

const IGNORED = new Set(['select', 'order', 'limit', 'offset'])

function parseValue(raw) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  return raw
}

function applyFilters(rows, params) {
  let out = rows
  for (const [key, raw] of params) {
    if (IGNORED.has(key)) continue
    const m = /^(eq|neq|gt|lt|gte|lte|is)\.(.*)$/s.exec(raw)
    if (!m) continue
    const [, op, v] = m
    const want = parseValue(v)
    out = out.filter(r => {
      const got = r[key]
      switch (op) {
        case 'eq': case 'is': return String(got) === String(want) || got === want
        case 'neq': return String(got) !== String(want)
        case 'gt': return got > want
        case 'lt': return got < want
        case 'gte': return got >= want
        case 'lte': return got <= want
        default: return true
      }
    })
  }
  return out
}

// ── the server ─────────────────────────────────────────────────────────────

const json = (res, status, body, headers = {}) => {
  const payload = body === null ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range, content-length',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS',
    ...headers,
  })
  res.end(payload)
}

const readBody = req => new Promise(resolve => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : null) } catch { resolve(null) } })
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') return json(res, 204, null)

  // ── control plane, for the test harness only ─────────────────────────────
  if (path === '/__fixture/reset') {
    reset(await readBody(req) || {})
    return json(res, 200, { ok: true })
  }
  if (path === '/__fixture/state') {
    return json(res, 200, { tables, failing })
  }

  // ── auth ─────────────────────────────────────────────────────────────────
  if (path === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type')
    const body = await readBody(req) || {}
    if (grant === 'refresh_token') {
      const user = Object.values(users).find(u => `refresh-${u.id}` === body.refresh_token)
      if (!user) return json(res, 400, { error: 'invalid_grant' })
      return json(res, 200, sessionFor(user))
    }
    const user = users[body.email]
    if (!user || user.password !== body.password) {
      return json(res, 400, {
        error: 'invalid_grant', error_description: 'Invalid login credentials',
      })
    }
    return json(res, 200, sessionFor(user))
  }
  if (path === '/auth/v1/user') {
    const user = userFromAuth(req)
    if (!user) return json(res, 401, { message: 'invalid claim' })
    return json(res, 200, sessionFor(user).user)
  }
  if (path === '/auth/v1/logout') return json(res, 204, null)
  if (path.startsWith('/auth/v1/')) return json(res, 200, {})

  // ── data ─────────────────────────────────────────────────────────────────
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length)
    if (failing[table]) {
      return json(res, failing[table], {
        code: 'FIXTURE', message: `injected failure for ${table}`,
        details: null, hint: null,
      })
    }
    if (!(table in tables)) tables[table] = []
    const rows = tables[table]
    const wantsObject = (req.headers.accept || '').includes('pgrst.object')
    const prefer = req.headers.prefer || ''

    if (req.method === 'GET' || req.method === 'HEAD') {
      const found = applyFilters(rows, url.searchParams)
      if (prefer.includes('count=')) {
        const range = found.length ? `0-${found.length - 1}/${found.length}` : `*/0`
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'content-range': range,
            'access-control-expose-headers': 'content-range',
            'access-control-allow-origin': '*',
          })
          return res.end()
        }
        return json(res, 200, found, { 'content-range': range })
      }
      if (wantsObject) {
        if (found.length === 0) {
          // What PostgREST says for "no rows where one was expected".
          // .maybeSingle() turns this into data:null with no error.
          return json(res, 406, {
            code: 'PGRST116', message: 'JSON object requested, 0 rows returned',
            details: 'Results contain 0 rows', hint: null,
          })
        }
        return json(res, 200, found[0])
      }
      return json(res, 200, found)
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const incoming = Array.isArray(body) ? body : [body]
      const merge = prefer.includes('merge-duplicates')
      for (const row of incoming) {
        if (merge && table === 'user_ui_prefs') {
          const i = rows.findIndex(r => r.user_id === row.user_id && r.key === row.key)
          if (i >= 0) { rows[i] = { ...rows[i], ...row }; continue }
        }
        rows.push(row)
      }
      return json(res, 201, prefer.includes('return=representation') ? incoming : null)
    }

    if (req.method === 'DELETE') {
      const doomed = new Set(applyFilters(rows, url.searchParams))
      tables[table] = rows.filter(r => !doomed.has(r))
      return json(res, 204, null)
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      for (const r of applyFilters(rows, url.searchParams)) Object.assign(r, body)
      return json(res, 204, null)
    }
  }

  return json(res, 404, { message: 'not a route this fixture implements', path })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fixture supabase on http://127.0.0.1:${PORT}`)
})
