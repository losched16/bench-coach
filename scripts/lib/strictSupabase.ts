// An in-memory Supabase client for tests that need to run real server code.
//
// WHY NOT scripts/browser/fixture-supabase.mjs
//
// That fixture is an HTTP stand-in for the browser suite, and it is lenient on
// purpose: an operator it does not understand is skipped, so `in.(…)` filters,
// ordering, limits and embedded joins are silently ignored. That is fine for
// "does the page render", and exactly wrong for "does this read stay inside one
// team" — a skipped filter passes a scoping test for the wrong reason.
//
// This one is strict in the other direction. It implements the supabase-js
// builder operators server code here actually uses, applies every one of them,
// and records each query. Anything it does not implement comes back as an
// error result naming the operator, so a test can never pass because a filter
// quietly did nothing.
//
// Not a PostgREST. No RLS: the code under test uses the service role, and the
// point is to see what ITS filters do.

export type Row = Record<string, any>
export type Tables = Record<string, Row[]>

export interface QueryLog {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  select: string | null
  filters: Array<{ op: string; column: string; value: any }>
  order: Array<{ column: string; ascending: boolean }>
  limit: number | null
  error: string | null
  rows: number
}

interface Embed { alias: string; table: string; columns: string[] }

/** `a, b, alias:table(c, d)` → plain columns + one-level embeds. */
function parseSelect(sel: string | null): { columns: string[] | '*'; embeds: Embed[] } {
  if (!sel || sel.trim() === '*') return { columns: '*', embeds: [] }
  const parts: string[] = []
  let depth = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())

  const columns: string[] = []
  const embeds: Embed[] = []
  let star = false
  for (const p of parts) {
    const m = /^(?:(\w+):)?(\w+)(?:!\w+)?\(([\s\S]*)\)$/.exec(p)
    if (m) {
      embeds.push({
        alias: m[1] || m[2],
        table: m[2],
        columns: m[3].split(',').map(s => s.trim()).filter(Boolean),
      })
    } else if (p === '*') star = true
    else columns.push(p)
  }
  return { columns: star ? '*' : columns, embeds }
}

const SINGULAR: Record<string, string> = {
  players: 'player', teams: 'team', seasons: 'season', games: 'game', entries: 'entry',
  development_pathways: 'pathway', playbook_templates: 'template', coaches: 'coach',
}

export class StrictSupabase {
  tables: Tables
  log: QueryLog[] = []
  /** Tables that answer with an error, as a database missing a migration would. */
  failing: Set<string>

  constructor(tables: Tables, opts: { failing?: string[] } = {}) {
    this.failing = new Set(opts.failing || [])
    // Deep-ish copy so a test cannot mutate its own seed by accident.
    this.tables = Object.fromEntries(
      Object.entries(tables).map(([k, v]) => [k, v.map(r => ({ ...r }))]))
  }

  from(table: string) { return new Builder(this, table) }

  queriesOn(table: string): QueryLog[] { return this.log.filter(q => q.table === table) }

  /** Stand-in for supabase.auth — enough for code that asks who is signed in. */
  auth = {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  }

  storage = { from: () => ({ upload: async () => ({ error: { message: 'fixture: no storage' } }) }) }

  rpc(name: string) {
    this.log.push({ table: `rpc:${name}`, op: 'select', select: null, filters: [], order: [], limit: null, error: 'fixture: rpc not implemented', rows: 0 })
    return Promise.resolve({ data: null, error: { message: `fixture: rpc ${name} not implemented` } })
  }
}

class Builder implements PromiseLike<any> {
  private op: QueryLog['op'] = 'select'
  private sel: string | null = null
  private filters: QueryLog['filters'] = []
  private orders: QueryLog['order'] = []
  private lim: number | null = null
  private singleMode: 'one' | 'maybe' | null = null
  private head = false
  private countMode: string | null = null
  private payload: Row[] | Row | null = null
  private unsupported: string | null = null

  constructor(private db: StrictSupabase, private table: string) {}

  select(sel?: string, opts?: { count?: string; head?: boolean }) {
    // .insert(...).select() keeps the insert and asks for the written rows
    // back, as PostgREST's return=representation does; only a bare .select()
    // is a read. Without this, a write followed by .select().single() returned
    // null where the real client returns the row.
    this.sel = sel ?? '*'
    if (opts?.head) this.head = true
    if (opts?.count) this.countMode = opts.count
    return this
  }
  insert(p: Row[] | Row) { this.op = 'insert'; this.payload = p; return this }
  upsert(p: Row[] | Row) { this.op = 'upsert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }

  eq(c: string, v: any) { this.filters.push({ op: 'eq', column: c, value: v }); return this }
  neq(c: string, v: any) { this.filters.push({ op: 'neq', column: c, value: v }); return this }
  gt(c: string, v: any) { this.filters.push({ op: 'gt', column: c, value: v }); return this }
  gte(c: string, v: any) { this.filters.push({ op: 'gte', column: c, value: v }); return this }
  lt(c: string, v: any) { this.filters.push({ op: 'lt', column: c, value: v }); return this }
  lte(c: string, v: any) { this.filters.push({ op: 'lte', column: c, value: v }); return this }
  in(c: string, v: any[]) { this.filters.push({ op: 'in', column: c, value: v }); return this }
  is(c: string, v: any) { this.filters.push({ op: 'is', column: c, value: v }); return this }
  not(c: string, o: string, v: any) {
    if (o === 'is') this.filters.push({ op: 'not_is', column: c, value: v })
    else this.unsupported = `not.${o}`
    return this
  }
  ilike(c: string, v: string) { this.filters.push({ op: 'ilike', column: c, value: v }); return this }
  contains(c: string, v: any) { this.filters.push({ op: 'contains', column: c, value: v }); return this }
  // Anything with its own mini-language is refused rather than half-parsed.
  or(expr: string) { this.unsupported = `or(${expr})`; return this }
  filter(c: string, o: string) { this.unsupported = `filter(${c}.${o})`; return this }
  textSearch() { this.unsupported = 'textSearch'; return this }
  match() { this.unsupported = 'match'; return this }

  order(c: string, o?: { ascending?: boolean }) {
    this.orders.push({ column: c, ascending: o?.ascending !== false }); return this
  }
  limit(n: number) { this.lim = n; return this }
  range(from: number, to: number) { this.lim = to - from + 1; return this }
  single() { this.singleMode = 'one'; return this }
  maybeSingle() { this.singleMode = 'maybe'; return this }
  abortSignal() { return this }

  private matches(r: Row): boolean {
    return this.filters.every(f => {
      const got = r[f.column]
      switch (f.op) {
        case 'eq': return got === f.value || (got != null && f.value != null && String(got) === String(f.value))
        case 'neq': return String(got) !== String(f.value)
        case 'gt': return got > f.value
        case 'gte': return got >= f.value
        case 'lt': return got < f.value
        case 'lte': return got <= f.value
        case 'in': return (f.value as any[]).some(v => String(v) === String(got))
        case 'is': return f.value === null ? got == null : got === f.value
        case 'not_is': return f.value === null ? got != null : got !== f.value
        case 'ilike': {
          const rx = new RegExp('^' + String(f.value).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%|\*/g, '.*') + '$', 'i')
          return rx.test(String(got ?? ''))
        }
        case 'contains': return Array.isArray(got) && (f.value as any[]).every(v => got.includes(v))
        default: return false
      }
    })
  }

  private project(r: Row): Row {
    const { columns, embeds } = parseSelect(this.sel)
    const out: Row = columns === '*' ? { ...r } : {}
    if (columns !== '*') for (const c of columns) out[c.split(':').pop()!] = r[c.split(':')[0]]
    for (const e of embeds) {
      const target = this.db.tables[e.table] || []
      const fk = `${e.alias}_id`
      const fk2 = `${SINGULAR[e.table] || e.table}_id`
      const key = r[fk] !== undefined ? r[fk] : r[fk2]
      if (key !== undefined) {
        const hit = target.find(t => String(t.id) === String(key)) || null
        out[e.alias] = hit ? pick(hit, e.columns) : null
      } else {
        // Reverse embed: rows in the target that point back at this one.
        const back = `${SINGULAR[this.table] || this.table.replace(/s$/, '')}_id`
        out[e.alias] = target.filter(t => String(t[back]) === String(r.id)).map(t => pick(t, e.columns))
      }
    }
    return out
  }

  private run(): { data: any; error: any; count?: number | null } {
    const entry: QueryLog = {
      table: this.table, op: this.op, select: this.sel, filters: this.filters.slice(),
      order: this.orders.slice(), limit: this.lim, error: null, rows: 0,
    }
    this.db.log.push(entry)

    if (this.unsupported) {
      entry.error = `fixture: unsupported operator ${this.unsupported}`
      return { data: null, error: { message: entry.error } }
    }
    if (this.db.failing.has(this.table)) {
      entry.error = `relation "public.${this.table}" does not exist`
      return { data: null, error: { message: entry.error, code: '42P01' } }
    }

    const table = (this.db.tables[this.table] ||= [])

    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r, i) => ({
        id: r.id ?? `${this.table}-${table.length + i + 1}`, ...r,
      }))
      table.push(...rows)
      entry.rows = rows.length
      const data = this.sel !== null ? rows.map(r => this.project(r)) : null
      return { data: this.singleMode ? (data ? data[0] : null) : data, error: null }
    }
    if (this.op === 'update') {
      const hit = table.filter(r => this.matches(r))
      for (const r of hit) Object.assign(r, this.payload)
      entry.rows = hit.length
      return { data: this.sel !== null ? hit.map(r => this.project(r)) : null, error: null }
    }
    if (this.op === 'delete') {
      const keep = table.filter(r => !this.matches(r))
      entry.rows = table.length - keep.length
      this.db.tables[this.table] = keep
      return { data: null, error: null }
    }

    let rows = table.filter(r => this.matches(r))
    // Applied last-first so the first .order() is the primary key, as in SQL.
    for (const o of this.orders.slice().reverse()) {
      rows = rows.slice().sort((a, b) => {
        const x = a[o.column], y = b[o.column]
        if (x == null && y == null) return 0
        if (x == null) return 1
        if (y == null) return -1
        const c = x < y ? -1 : x > y ? 1 : 0
        return o.ascending ? c : -c
      })
    }
    const count = rows.length
    if (this.lim != null) rows = rows.slice(0, this.lim)
    entry.rows = rows.length

    if (this.head) return { data: null, error: null, count }
    const data = rows.map(r => this.project(r))
    if (this.singleMode === 'one') {
      return data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { message: `fixture: single() got ${data.length} rows`, code: 'PGRST116' } }
    }
    if (this.singleMode === 'maybe') return { data: data[0] ?? null, error: null }
    return { data, error: null, count: this.countMode ? count : null }
  }

  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    let result: any
    try { result = this.run() } catch (e) { return Promise.reject(e).then(ok, bad) }
    return Promise.resolve(result).then(ok, bad)
  }
}

function pick(r: Row, cols: string[]): Row {
  if (cols.length === 1 && cols[0] === '*') return { ...r }
  const o: Row = {}
  for (const c of cols) o[c] = r[c]
  return o
}
