// Development plans reach every consumer's prompt — proved at the boundary.
//
//   npm run test:pathway-context-consumers
//
// The REAL route handlers run, in this process, against synthetic data. Two
// things are replaced and nothing else:
//
//   * the database — scripts/lib/strictSupabase.ts, which applies every filter
//     and refuses any operator it does not implement;
//   * the model — the real Anthropic SDK is pointed, via ANTHROPIC_BASE_URL,
//     at a capture server on 127.0.0.1 that records each request body and
//     answers 400. So every assertion below is about the exact JSON the SDK
//     serialised for the API: the prompt as sent, not a string we assembled
//     ourselves to look like one.
//
// And one thing is stubbed, stated plainly: route AUTHORIZATION. guard(),
// authorizeTeam(), authorizeReport() and authorizePlayer() read the Next
// request cookies, which do not exist outside Next. They are replaced by stubs
// that admit the synthetic team-A coach; the player stub still applies the real
// scope rule (lib/playerScope.ts) to the database, but it does NOT run the real
// caller check. NOTHING IN THIS FILE IS EVIDENCE OF REAL AUTHORIZATION — that is
// npm run test:player-scope, which runs lib/authz.ts unmodified. Route-level authorization is covered by verify:authz; what
// this change adds is the assembler's OWN scoping, which runs for real here
// and is attacked directly in test:pathway-context.
//
// No model is called. Nothing here says the advice is better — only that the
// evidence is in front of the model, for the right player, and nobody else's.

import * as http from 'http'
import * as path from 'path'
import { seedTables, IDS, LEAK_SENTINEL, ARM_SIGNALS } from './fixtures/pathwayContextFixture'
import type { StrictSupabase as StrictSupabaseT } from './lib/strictSupabase'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const has = (name: string, text: string, needle: string) =>
  check(name, text.includes(needle), `missing: ${JSON.stringify(needle)}`)
const lacks = (name: string, text: string, needle: string) =>
  check(name, !text.includes(needle), `unexpectedly present: ${JSON.stringify(needle)}`)

// ── the capture server ─────────────────────────────────────────────────────

interface Captured { model: string; stream: boolean; text: string }
const captured: Captured[] = []

function startCapture(): Promise<number> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}')
        // Everything the model would read: system, then every message.
        const parts: string[] = []
        const sys = j.system
        if (typeof sys === 'string') parts.push(sys)
        else if (Array.isArray(sys)) for (const b of sys) if (b?.text) parts.push(b.text)
        for (const m of j.messages || []) {
          if (typeof m.content === 'string') parts.push(m.content)
          else for (const b of m.content || []) if (b?.text) parts.push(b.text)
        }
        captured.push({ model: String(j.model || ''), stream: !!j.stream, text: parts.join('\n\n') })
      } catch { /* a malformed body is still a request we saw */ }
      res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'capture' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture server: request recorded' } }))
    })
  })
  server.unref()
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)))
}

// ── wiring ─────────────────────────────────────────────────────────────────

const state: { db: StrictSupabaseT | null } = { db: null }
const db = () => state.db!

function installStubs() {
  // The database: every createClient() — route-level, module-level, anywhere —
  // hands back a proxy onto whichever fake the current scenario installed.
  const sbPath = require.resolve('@supabase/supabase-js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realSb = require('@supabase/supabase-js')
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const target: any = db()
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  require.cache[sbPath]!.exports = { ...realSb, createClient: () => proxy }

  // Authorization: stubbed, and only these five names.
  const authzPath = require.resolve('../lib/authz')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realAuthz = require('../lib/authz')
  const actor = (teamId: string) => ({
    userId: 'user-a', coachId: IDS.coachA, ownerCoachId: IDS.coachA, role: 'owner', teamId,
  })
  require.cache[authzPath]!.exports = {
    ...realAuthz,
    guard: async () => null,
    requireSession: async () => null,
    authorizeTeam: async (teamId: string) => actor(teamId),
    authorizePlayer: async (playerId: string, o: { teamId?: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolvePlayerScope } = require('../lib/playerScope')
      const s = await resolvePlayerScope(db(), { playerId, teamId: o.teamId || null, ownerCoachId: IDS.coachA })
      if (!s.ok) throw new realAuthz.AuthzError('Player not found', 404)
      return { ...actor(o.teamId || ''), playerId, teamId: o.teamId || null }
    },
    authorizeReport: async (reportId: string) => {
      const r = (db().tables.player_reports || []).find(x => x.id === reportId)
      if (!r) throw new realAuthz.AuthzError('Report not found', 404)
      return { ...actor(r.team_id), report: r }
    },
  }
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

async function drain(res: Response): Promise<string> {
  try { return await res.text() } catch (e: any) { return `<<body error: ${e?.message}>>` }
}

function reset(extra: (t: ReturnType<typeof seedTables>) => void = () => {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { StrictSupabase } = require('./lib/strictSupabase')
  const t = seedTables()
  extra(t)
  state.db = new StrictSupabase(t)
  captured.length = 0
}

const withPlans = (c: Captured) => c.text.includes('DEVELOPMENT PLANS —')

// ── scenarios ──────────────────────────────────────────────────────────────

async function main() {
  const port = await startCapture()
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.ANTHROPIC_API_KEY = 'capture-test-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://strict-fixture.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture-anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service'
  reset()
  installStubs()

  const root = path.resolve(__dirname, '..', 'app', 'api')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const load = (p: string) => require(path.join(root, p))

  // ── Chat: player-scoped, then team-scoped ────────────────────────────────
  {
    const chat = load('chat/route.ts')
    reset()
    await drain(await chat.POST(req('/api/chat', { method: 'POST', body: {
      teamId: IDS.teamA, playerId: IDS.marcus, message: 'What should we do with Marcus this week?', history: [],
    } })))
    const c = captured.find(withPlans)
    check('chat/player: a request reached the model API with the plans block', !!c,
      `${captured.length} request(s) captured, none carried the block`)
    if (c) {
      has('chat/player: player scope', c.text, 'the pathway stages the coaching staff put this player on')
      has('chat/player: current stage', c.text, '[Build the Arm] active · stage 2 of 4 — Direction to the target')
      has('chat/player: recorded signal', c.text, `✓ recorded by the coach 2026-09-12: ${ARM_SIGNALS.s2a}`)
      lacks('chat/player: no teammate plan', c.text, 'Eli Synthetic —')
      lacks('chat/player: nothing from team B', c.text, LEAK_SENTINEL)
      const iSaw = c.text.indexOf('WHAT THE COACH SAW'), iPlans = c.text.indexOf('DEVELOPMENT PLANS —')
      check('chat/player: observations still precede plans in the prompt', iSaw > 0 && iPlans > iSaw)
    }

    reset()
    await drain(await chat.POST(req('/api/chat', { method: 'POST', body: {
      teamId: IDS.teamA, message: 'Plan the week for the whole team.', history: [],
    } })))
    const t = captured.find(withPlans)
    check('chat/team: the team block reached the model API', !!t)
    if (t) {
      has('chat/team: team scope', t.text, 'the pathway stages the coaching staff put players on this team on')
      has('chat/team: Marcus listed', t.text, 'Marcus Synthetic — on this stage since 2026-09-01')
      has('chat/team: Eli listed', t.text, 'Eli Synthetic — on this stage since 2026-09-05')
      lacks('chat/team: Zoe not listed', t.text, 'Zoe')
      lacks('chat/team: nothing from team B', t.text, LEAK_SENTINEL)
    }
  }

  // ── Practice planner: team-scoped, and the gate ──────────────────────────
  {
    const practice = load('practice-plan/route.ts')
    // The fixture has plans but NO prescriptions and NO team observations for
    // this team-wide read — the production shape (0 prescriptions). Before
    // this change the route's gate sent no context at all in that case.
    reset(t => { t.observations = t.observations.filter(o => o.team_id !== IDS.teamA) })
    const out = await drain(await practice.POST(req('/api/practice-plan', { method: 'POST', body: {
      teamId: IDS.teamA, duration: 60, focus: ['Throwing'], coachCount: 2,
    } })))
    const p = captured.find(withPlans)
    check('practice: the plans block reached the model API with no observations or priorities', !!p,
      `${captured.length} request(s) captured; route said: ${out.slice(0, 300)}`)
    if (p) {
      has('practice: under the loop-context heading', p.text, "WHAT WE'RE ALREADY WORKING ON — build around this, don't ignore it:")
      has('practice: grouped by stage for stations', p.text, '  Build the Arm · stage 2 of 4 — Direction to the target')
      has('practice: Marcus', p.text, 'Marcus Synthetic —')
      has('practice: Eli', p.text, 'Eli Synthetic —')
      lacks('practice: completed plans left out of a practice', p.text, 'complete on 2026-07-30')
      lacks('practice: nothing from team B', p.text, LEAK_SENTINEL)
    }

    // Negative control: no plans, no observations, no priorities → no block,
    // exactly as before.
    reset(t => {
      t.observations = t.observations.filter(o => o.team_id !== IDS.teamA)
      t.player_pathway_progress = t.player_pathway_progress.filter(r => r.team_id !== IDS.teamA)
    })
    await drain(await practice.POST(req('/api/practice-plan', { method: 'POST', body: {
      teamId: IDS.teamA, duration: 60, focus: ['Throwing'], coachCount: 2,
    } })))
    check('practice: with nothing to say, nothing is added', captured.length > 0 && !captured.some(withPlans) &&
      !captured.some(c => c.text.includes("WHAT WE'RE ALREADY WORKING ON")),
      `${captured.length} captured`)
  }

  // ── Analysis writer (prescribe): player-scoped ───────────────────────────
  {
    const prescribe = load('prescribe/route.ts')
    reset(t => {
      t.problem_taxonomy = [{
        slug: 'throwing-accuracy', label: 'Throwing accuracy', skill_category: 'throwing',
        description: 'Throws miss the target.', aliases: ['wild throws', 'throwing accuracy'],
        do_not_coach_flag: false, do_not_coach_note: null, age_relevance: null,
      }]
    })
    const out = await drain(await prescribe.POST(req('/api/prescribe', { method: 'POST', body: {
      teamId: IDS.teamA, playerId: IDS.marcus,
      complaint: 'Marcus throws are all over the place from shortstop',
    } })))
    const a = captured.find(c => withPlans(c))
    check('prescribe: the analysis request carried the plans block', !!a,
      `${captured.length} captured (${captured.map(c => c.model).join(', ')}); route said: ${out.slice(0, 300)}`)
    if (a) {
      check('prescribe: it is the analysis model, not the classifier', a.model === 'claude-opus-5', a.model)
      has('prescribe: Marcus\'s stage', a.text, '[Build the Arm] active · stage 2 of 4')
      has('prescribe: his paused plan, marked', a.text, '[Glove Work] PAUSED')
      lacks('prescribe: no teammate', a.text, 'Eli Synthetic —')
      lacks('prescribe: nothing from team B', a.text, LEAK_SENTINEL)
    }
  }

  // ── Home-practice plan writer (development-plan): player-scoped ──────────
  // Not one of the four named consumers, but it calls the same assembler, so
  // it receives the block too. Checked so that is a fact, not an assumption.
  {
    const devplan = load('development-plan/route.ts')
    reset(t => {
      t.prescriptions = [{
        id: 'rx-1', coach_id: IDS.coachA, team_id: IDS.teamA, player_id: IDS.marcus, scope: 'player',
        status: 'active', priority: 'Throw to the chest, not the feet', focus_area: 'throwing',
        success_criteria: 'Seven of ten chest-high from 45 feet', drill_ids: [], issued_at: '2026-09-15T00:00:00Z',
        plan_steps: null, current_step: null,
      }]
    })
    const out = await drain(await devplan.POST(req('/api/development-plan', { method: 'POST', body: {
      prescriptionId: 'rx-1', coachId: IDS.coachA,
    } })))
    const d = captured.find(withPlans)
    check('development-plan: the plan writer\'s request carried the block', !!d,
      `${captured.length} captured; route said: ${out.slice(0, 300)}`)
    if (d) lacks('development-plan: nothing from team B', d.text, LEAK_SENTINEL)
  }

  // ── Report drafter: a selectable source, then the draft prompt ───────────
  {
    const sources = load('player-reports/[reportId]/sources/route.ts')
    const draft = load('player-reports/draft/route.ts')
    reset(t => {
      t.player_reports = [
        { id: 'report-draft', team_id: IDS.teamA, player_id: IDS.marcus, coach_id: IDS.coachA, status: 'draft',
          report_type: 'midseason', context: null },
        { id: 'report-final', team_id: IDS.teamA, player_id: IDS.marcus, coach_id: IDS.coachA, status: 'final',
          report_type: 'midseason', context: { player_name: 'Marcus Synthetic', frozen: true },
          strengths_content: 'Frozen text the family already has.' },
      ]
    })
    const before = JSON.stringify(db().tables.player_reports)

    const bundle = JSON.parse(await drain(await sources.GET(
      req('/api/player-reports/report-draft/sources'), { params: { reportId: 'report-draft' } })))
    const plans = (bundle.items || []).filter((i: any) => i.kind === 'pathway')
    check('report/sources: the picker is offered the player\'s plans', plans.length === 3, `${plans.length}`)
    check('report/sources: none pre-selected', plans.every((i: any) => i.preselected === false))
    lacks('report/sources: nothing from team B', JSON.stringify(bundle), LEAK_SENTINEL)

    const active = plans.find((i: any) => i.id === `pathway:${IDS.marcusArm}`)
    await drain(await draft.POST(req('/api/player-reports/draft', { method: 'POST', body: {
      reportId: 'report-draft', kind: 'development',
      items: [{ id: active.id, kind: active.kind, date: active.date, text: active.text }],
    } })))
    const r = captured.find(c => c.text.includes('<<<RECORDED'))
    check('report/draft: the draft request reached the model API', !!r, `${captured.length} captured`)
    if (r) {
      has('report/draft: the selected plan is in the recorded block, as a pathway item', r.text,
        '· pathway: Development plan: Build the Arm. Working on stage 2 of 4 — Direction to the target')
      has('report/draft: the model is told a stage is not a grade', r.text, 'A stage is not a grade')
      lacks('report/draft: unselected plans are not sent', r.text, 'Glove Work')
    }

    // A finalized report is refused before any model call, and nothing about
    // it changes.
    captured.length = 0
    const fin = await draft.POST(req('/api/player-reports/draft', { method: 'POST', body: {
      reportId: 'report-final', kind: 'development',
      items: [{ id: active.id, kind: active.kind, date: active.date, text: active.text }],
    } }))
    check('report/final: drafting against a finalized report is refused', fin.status === 409, `status ${fin.status}`)
    check('report/final: and nothing was sent to the model', captured.length === 0)
    check('report/final: no report row was touched', JSON.stringify(db().tables.player_reports) === before)
    check('report: no write to any report table in the whole flow',
      !db().log.some(q => q.op !== 'select' && q.table.startsWith('player_report')),
      db().log.filter(q => q.op !== 'select').map(q => `${q.op} ${q.table}`).join(', '))
  }
}

main().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log(`
Proved here: the real route handlers put the development-plan block into the
request the Anthropic SDK sends, for the right player and team, and nobody
else's. Captured at the HTTP boundary; no model was called.
Stubbed: route-level authorization (see verify:authz). Not proved: advice quality.`)
  process.exit(0)
}).catch(e => { console.error(e); process.exit(1) })
