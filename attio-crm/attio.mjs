// Attio REST client, scope check and endpoint preflight.
//
// A NOTE ON THE ENDPOINT SHAPES BELOW
//
// docs.attio.com is unreachable from the environment this was written in
// (CONNECT tunnel 403), so these paths and payloads come from knowledge of the
// documented v2 API rather than from checking it today. They may be wrong.
//
// Rather than hope, preflight() GETs every collection this client intends to
// POST to and fails loudly with the real response if a path 404s or a body
// does not have the expected shape. That runs before the first write, so a
// stale assumption costs an error message rather than a half-configured
// workspace. If preflight fails, fix the path here — everything else is
// structured to make that a one-line change.

const BASE = process.env.ATTIO_API_BASE || 'https://api.attio.com'

export class AttioError extends Error {
  constructor(message, { status, body, url, method } = {}) {
    super(message)
    this.name = 'AttioError'
    this.status = status
    this.body = body
    this.url = url
    this.method = method
  }
}

export function tokenFromEnv() {
  const key = process.env.ATTIO_API_KEY
  if (!key) {
    throw new AttioError(
      'ATTIO_API_KEY is not set.\n\n' +
      'Create one at: Attio -> Workspace settings -> Developers -> API keys\n' +
      'Required scope: object_configuration:read-write\n' +
      'Then: cp .env.example .env and paste it in.'
    )
  }
  return key
}

/** Last four characters only. Never log the token itself. */
export function tokenFingerprint(key) {
  return `…${String(key).slice(-4)}`
}

export class Attio {
  constructor(key = tokenFromEnv()) {
    this.key = key
    this.calls = []
  }

  async request(method, path, body) {
    const url = `${BASE}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }

    this.calls.push({ method, path, status: res.status })

    if (!res.ok) {
      throw new AttioError(
        `${method} ${path} -> ${res.status} ${res.statusText}: ` +
        (parsed?.message || parsed?.error || text.slice(0, 300)),
        { status: res.status, body: parsed, url, method }
      )
    }
    return parsed
  }

  get(path) { return this.request('GET', path) }
  post(path, body) { return this.request('POST', path, body) }
  patch(path, body) { return this.request('PATCH', path, body) }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Token identity and — critically — its granted scopes. */
  async self() {
    return this.get('/v2/self')
  }

  async listObjects() {
    const r = await this.get('/v2/objects')
    return r?.data ?? []
  }

  async listAttributes(object) {
    // Attio paginates at 500; the standard objects are far below that, but
    // paging is cheap and a silently truncated list would make the diff claim
    // an existing attribute is missing and try to create a duplicate.
    const out = []
    let offset = 0
    for (;;) {
      const r = await this.get(`/v2/objects/${object}/attributes?limit=500&offset=${offset}`)
      const page = r?.data ?? []
      out.push(...page)
      if (page.length < 500) break
      offset += 500
    }
    return out
  }

  async listSelectOptions(object, attribute) {
    const r = await this.get(`/v2/objects/${object}/attributes/${attribute}/options`)
    return r?.data ?? []
  }

  async listStatuses(object, attribute) {
    const r = await this.get(`/v2/objects/${object}/attributes/${attribute}/statuses`)
    return r?.data ?? []
  }

  async countRecords(object) {
    const r = await this.post(`/v2/objects/${object}/records/query`, { limit: 1 })
    return (r?.data ?? []).length
  }

  async listWorkspaceMembers() {
    const r = await this.get('/v2/workspace_members')
    return r?.data ?? []
  }

  // -------------------------------------------------------------------------
  // Writes. Every one is additive.
  // -------------------------------------------------------------------------

  async createAttribute(object, spec) {
    const data = {
      title: spec.title,
      api_slug: spec.api_slug,
      type: spec.type,
      description: spec.description ?? null,
      is_required: false,
      is_unique: false,
      is_multiselect: spec.is_multiselect ?? false,
    }
    // Select and status attributes carry their initial values inline. Sending
    // them at creation is one round trip instead of N and avoids a window
    // where the attribute exists with no valid values.
    if (spec.type === 'select' && spec.options) {
      data.config = { select: { options: spec.options.map(title => ({ title })) } }
    }
    if (spec.type === 'status' && spec.statuses) {
      data.config = {
        status: {
          statuses: spec.statuses.map(title => ({
            title, celebration_enabled: false, target_time_in_status: null,
          })),
        },
      }
    }
    const r = await this.post(`/v2/objects/${object}/attributes`, { data })
    return r?.data
  }

  async createSelectOption(object, attribute, title) {
    const r = await this.post(
      `/v2/objects/${object}/attributes/${attribute}/options`,
      { data: { title } }
    )
    return r?.data
  }

  async createStatus(object, attribute, title) {
    const r = await this.post(
      `/v2/objects/${object}/attributes/${attribute}/statuses`,
      { data: { title, celebration_enabled: false, target_time_in_status: null } }
    )
    return r?.data
  }

  /** Archive, never delete. Reversible in the UI; deletion is not. */
  async archiveStatus(object, attribute, statusId) {
    const r = await this.patch(
      `/v2/objects/${object}/attributes/${attribute}/statuses/${statusId}`,
      { data: { is_archived: true } }
    )
    return r?.data
  }
}

// ---------------------------------------------------------------------------
// Scope check
// ---------------------------------------------------------------------------

export const REQUIRED_SCOPE = 'object_configuration:read-write'

/**
 * Does this token have what schema configuration needs?
 *
 * Attio's /v2/self reports granted scopes. Shapes have varied across versions,
 * so several are accepted. If none is recognised the result is 'unknown'
 * rather than a guess in either direction — apply.mjs then relies on the
 * preflight and, ultimately, on the API's own 403.
 */
export function checkScopes(self) {
  const raw =
    self?.data?.scopes ?? self?.scopes ??
    self?.data?.authorized_scopes ?? self?.authorized_scopes ?? null

  if (raw == null) return { ok: 'unknown', scopes: null }
  const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/).filter(Boolean)
  const has = list.includes(REQUIRED_SCOPE) ||
    list.includes('object_configuration:read-write') ||
    list.some(s => /^object_configuration/.test(s) && /read-write|write/.test(s))
  return { ok: has, scopes: list }
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Verify every endpoint we intend to write to, by reading it first.
 *
 * This exists because the endpoint shapes in this file could not be checked
 * against live documentation. A GET that 404s here means a path is wrong, and
 * finding that out before the first POST is the difference between an error
 * message and a workspace half-configured with attributes nobody planned.
 */
export async function preflight(client, objects = ['companies', 'people', 'deals']) {
  const checks = []
  const record = (name, ok, detail) => checks.push({ name, ok, detail })

  try {
    const self = await client.self()
    const scope = checkScopes(self)
    record('GET /v2/self', true,
      scope.ok === 'unknown'
        ? 'reachable; scopes not reported in a recognised shape'
        : `scopes: ${scope.scopes?.join(', ') || '(none listed)'}`)
    checks.scope = scope
  } catch (e) {
    record('GET /v2/self', false, e.message)
    return { ok: false, checks }
  }

  try {
    const objs = await client.listObjects()
    const slugs = objs.map(o => o.api_slug ?? o?.id?.object_id)
    record('GET /v2/objects', true, `${objs.length} objects: ${slugs.join(', ')}`)
  } catch (e) {
    record('GET /v2/objects', false, e.message)
  }

  for (const object of objects) {
    try {
      const attrs = await client.listAttributes(object)
      record(`GET /v2/objects/${object}/attributes`, true, `${attrs.length} attributes`)

      // Prove the options and statuses sub-resources resolve, using an
      // attribute that already has them. On a default workspace: categories
      // (select, companies) and stage (status, deals).
      const sel = attrs.find(a => a.type === 'select')
      if (sel) {
        const slug = sel.api_slug
        try {
          const opts = await client.listSelectOptions(object, slug)
          record(`GET .../${object}/attributes/${slug}/options`, true, `${opts.length} options`)
        } catch (e) {
          record(`GET .../${object}/attributes/${slug}/options`, false, e.message)
        }
      }
      const st = attrs.find(a => a.type === 'status')
      if (st) {
        const slug = st.api_slug
        try {
          const sts = await client.listStatuses(object, slug)
          record(`GET .../${object}/attributes/${slug}/statuses`, true, `${sts.length} statuses`)
        } catch (e) {
          record(`GET .../${object}/attributes/${slug}/statuses`, false, e.message)
        }
      }
    } catch (e) {
      record(`GET /v2/objects/${object}/attributes`, false, e.message)
    }
  }

  return { ok: checks.every(c => c.ok), checks, scope: checks.scope }
}

/** Attribute list -> map keyed by api_slug. */
export function bySlug(attributes) {
  const m = new Map()
  for (const a of attributes) if (a.api_slug) m.set(a.api_slug, a)
  return m
}
