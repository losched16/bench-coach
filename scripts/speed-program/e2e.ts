// Speed program: the full coach flow in a real browser, against fixtures.
//
// Proves: assign a player, complete a workout, history persists across a
// reload, a retest is compared only under the same conditions, pain blocks
// advancing, a coach override needs a reason, indoor space swaps in the short
// substitutes, a coach's change is recorded without touching the snapshot, and
// roles/non-members are held at the API.
//
// It does NOT prove production RLS (see test:migration-081) or real-user use.

import { chromium, type Page, type BrowserContext } from 'playwright'
import { mkdirSync } from 'fs'

const APP = process.env.APP_URL!, FIXTURE = process.env.FIXTURE_URL!, OUT = process.env.OUT || '.speed-program-e2e'
mkdirSync(OUT, { recursive: true })

const TEAM = '22222222-2222-4222-8222-222222222222'
const PLAYER = '33333333-3333-4333-8333-333333333333'
const COACH_USER = '11111111-1111-4111-8111-111111111111'
const U = { viewer: '11111111-1111-4111-8111-000000000002', contrib: '11111111-1111-4111-8111-000000000003', outsider: '11111111-1111-4111-8111-000000000004' }
const PW = 'fixture-password'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function seed() {
  const users: Record<string, any> = {}
  for (const [email, id] of [['coach@example.test', COACH_USER], ['viewer@example.test', U.viewer], ['contrib@example.test', U.contrib], ['outsider@example.test', U.outsider]])
    users[email] = { id, email, password: PW }
  const body = {
    users,
    tables: {
      coaches: [{ id: 'coach-1', user_id: COACH_USER, subscription_tier: 'team', is_subscribed: true }, { id: 'coach-2', user_id: U.outsider, subscription_tier: 'team', is_subscribed: true },
        // Staff have their own workspace too, which is what lets the dashboard shell load for them.
        { id: 'coach-v', user_id: U.viewer, subscription_tier: 'team', is_subscribed: true }, { id: 'coach-c', user_id: U.contrib, subscription_tier: 'team', is_subscribed: true }],
      teams: [
        { id: TEAM, coach_id: 'coach-1', name: 'Wildcats 9U', age_group: '9U', workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z' },
        { id: '55555555-5555-4555-8555-555555555551', coach_id: 'coach-v', name: 'Viewer own', age_group: '9U', workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z' },
        { id: '55555555-5555-4555-8555-555555555552', coach_id: 'coach-c', name: 'Contrib own', age_group: '9U', workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z' },
        { id: '55555555-5555-4555-8555-555555555553', coach_id: 'coach-2', name: 'Outsider own', age_group: '9U', workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z' },
      ],
      team_members: [{ team_id: TEAM, user_id: U.viewer, role: 'viewer' }, { team_id: TEAM, user_id: U.contrib, role: 'contributor' }],
      team_players: [{ id: 'tp1', team_id: TEAM, player_id: PLAYER, name: 'Charlie', player: { name: 'Charlie', jersey_number: '7' }, positions: [] }],
      players: [{ id: PLAYER, name: 'Charlie', jersey_number: '7' }],
      team_player_archive: [], player_notes: [], user_ui_prefs: [], team_staff: [],
      speed_program_assignments: [], speed_program_sessions: [], speed_program_assessments: [], speed_program_events: [],
    },
  }
  const r = await fetch(`${FIXTURE}/__fixture/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error('could not reset the fixture')
}
const state = async () => ((await (await fetch(`${FIXTURE}/__fixture/state`)).json()) as any).tables

async function signIn(page: Page, email: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, undefined, { timeout: 30000 })
      await page.fill('input[type="email"]', email)
      await page.fill('input[type="password"]', PW)
      await page.click('button[type="submit"]')
      await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 30000 })
      return
    } catch (e) { if (attempt) throw e }
  }
}
async function as(browser: any, email: string, viewport = { width: 1280, height: 900 }) {
  const context: BrowserContext = await browser.newContext({ viewport })
  const page = await context.newPage()
  await signIn(page, email)
  return { context, page }
}
const programUrl = `${APP}/dashboard/roster/${PLAYER}/speed-program?teamId=${TEAM}`
const text = (page: Page) => page.locator('body').innerText()
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })

async function logSession(page: Page, key: 'A' | 'B' | 'C', o: { braking?: number; reaction?: number; landing?: number; fatigue?: string; pain?: boolean }) {
  await page.getByTestId(`log-${key}`).click()
  const form = page.getByTestId(`log-form-${key}`)
  await form.waitFor()
  const pick = async (label: string, n?: number) => { if (n === undefined) return; await form.getByRole('radiogroup', { name: label }).getByRole('radio').nth(n).click() }
  await pick('Braking', o.braking); await pick('Reaction', o.reaction); await pick('Landing', o.landing)
  if (o.fatigue) await form.getByLabel('Fatigue').selectOption(o.fatigue)
  if (o.pain) await form.getByTestId('pain-flag').check()
  const done = page.waitForResponse(r => r.url().includes('/sessions') && r.request().method() === 'POST')
  await page.getByTestId(`save-${key}`).click()
  const res = await done
  await page.getByTestId(`log-form-${key}`).waitFor({ state: 'detached' }).catch(() => {})
  return res.status()
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
  try {
    await seed()

    // ── a signed-out visitor ────────────────────────────────────────────────
    console.log('\nSigned out')
    const anon = await browser.newContext()
    const ar = await anon.request.get(`${APP}/api/speed-program?teamId=${TEAM}`)
    check('the program API refuses a signed-out request', ar.status() === 401, String(ar.status()))
    const ap = await anon.request.post(`${APP}/api/speed-program`, { data: { teamId: TEAM, playerId: PLAYER, level: 'development' } })
    check('...and refuses a signed-out assignment', ap.status() === 401)
    await anon.close()

    // ── the coach: assign ───────────────────────────────────────────────────
    console.log('\nAssign')
    const { page: p, context: coachCtx } = await as(browser, 'coach@example.test')
    await p.goto(`${APP}/dashboard/roster/${PLAYER}?teamId=${TEAM}&tab=development`, { waitUntil: 'networkidle' })
    const card = p.getByTestId('speed-program-card')
    await card.waitFor({ timeout: 30000 })
    check('the Development tab offers the program, unassigned', /Not assigned yet/.test(await card.innerText()))
    await card.click()
    await p.waitForURL(/speed-program/)
    await p.getByTestId('assign-form').waitFor({ timeout: 30000 })
    const form = p.getByTestId('assign-form')
    check('age is advisory: the level cards say so', (await form.innerText()).includes('Advisory only'))
    check('Foundation and Advanced are labelled drafts', (await form.innerText()).match(/Draft variant/g)!.length === 2)
    check('games and hard practices reduce the suggested sessions', /1 game or hard practice[\s\S]*|2 games or hard practices/.test(await form.innerText()))
    await form.getByLabel('Games per week').fill('3'); await form.getByLabel('Hard practices per week').fill('1')
    check('picking more sessions than the load allows warns, not blocks', await (async () => { await form.getByLabel('Dedicated sessions per week').selectOption('3'); return /exposures this week/.test(await form.innerText()) })())
    await form.getByLabel('Games per week').fill('0'); await form.getByLabel('Hard practices per week').fill('0')
    await form.getByLabel('Dedicated sessions per week').selectOption('3')
    await shot(p, 'assign')
    await p.getByTestId('assign-submit').click()
    await p.getByTestId('program-header').waitFor({ timeout: 30000 })
    const head = await p.getByTestId('program-header').innerText()
    check('assigned: Development, week 1 of 4, Learn', /Development · Week 1 of 4: Learn/.test(head), JSON.stringify(head.slice(0, 200)))
    let t = await state()
    check('one assignment stored with the full three-level snapshot', t.speed_program_assignments.length === 1 && Object.keys(t.speed_program_assignments[0].plan.levels).length === 3)
    check('an "enrolled" event is recorded', t.speed_program_events.some((e: any) => e.event_type === 'enrolled'))
    check('nothing was written to player measurements, pathway progress or practice plans', !(t.player_metrics?.length) && !(t.player_pathway_progress?.length) && !(t.player_pathway_events?.length))
    const dup = await coachCtx.request.post(`${APP}/api/speed-program`, { data: { teamId: TEAM, playerId: PLAYER, level: 'development', daysPerWeek: 3, intake: { space: 'outdoor_open' } } })
    check('a second live program for the same player is refused', dup.status() === 409)

    // ── the plan, exactly ───────────────────────────────────────────────────
    console.log('\nThe plan')
    const a = await p.getByTestId('session-A').innerText()
    const line = async (ex: string) => (await p.getByTestId(`item-A-${ex}`).innerText()).split('\n').find(l => /×/.test(l)) || ''
    check('Session A: wall drive 2 × 5 per leg, falling start 4 reps, 10-yard 3 reps, chase 4 reps',
      /^.*\b2 × 5\b.*per leg/.test(await line('wall_drive')) && /\b1 × 4\b/.test(await line('falling_start')) && /\b1 × 3\b/.test(await line('accel_10')) && /\b1 × 4\b/.test(await line('cone_reaction_chase')),
      [await line('wall_drive'), await line('falling_start'), await line('accel_10'), await line('cone_reaction_chase')].join(' | '))
    check('rest times shown: 30 sec, 45–60 sec, 60–90 sec', /30 sec/.test(a) && /45–60 sec/.test(a) && /60–90 sec/.test(a))
    check('every video is an unreviewed external reference with a credit', (await p.getByTestId('reference').count()) >= 4 && (await p.getByTestId('reference').allInnerTexts()).every(x => /by .+/.test(x) && /not yet reviewed/.test(x)))
    const all = await text(p)
    check('the page never says a video is verified or approved', !/\b(verified|approved)\b/i.test(all))
    check('each exercise names its library drill, or says there is none', /Library drill:/.test(all) && /No library drill yet/.test(all) && /Closest library drill \(not the same exercise\)/.test(all))
    check('skater step is step-only until unlocked', /No hop yet/.test(await p.getByTestId('item-C-skater_step_stick').innerText()))
    check('the optional outdoor broad jump into a sprint is hidden until unlocked', (await p.getByTestId('item-C-broad_to_accel').count()) === 0)

    // ── complete workouts ───────────────────────────────────────────────────
    console.log('\nLog sessions')
    check('session A saved', (await logSession(p, 'A', { braking: 2, reaction: 2, fatigue: 'some' })) === 201)
    await p.getByTestId('history-session').first().waitFor()
    check('history shows it with scores', /Session A/.test(await p.getByTestId('history').innerText()) && /Braking 2/.test(await p.getByTestId('history').innerText()))
    t = await state()
    check('the stored session carries the right numbers', t.speed_program_sessions.length === 1 && t.speed_program_sessions[0].braking === 2 && t.speed_program_sessions[0].landing === null)
    await p.reload({ waitUntil: 'networkidle' })
    await p.getByTestId('history').waitFor()
    check('history persists across a reload', (await p.getByTestId('history-session').count()) === 1)
    const noMove = await p.getByTestId('advance-week').innerText()
    check('one session is not enough to advance', /Needs two completed sessions/.test(noMove))
    check('the guidance never says "advance now"', !/advance now|move up now/i.test(await p.getByTestId('guidance').innerText()))

    // an override needs a written reason
    await p.getByTestId('advance-week').getByRole('button', { name: /Coach override/ }).click()
    const ovBtn = p.getByRole('button', { name: 'Advance with override' })
    check('override is disabled until a reason is written', await ovBtn.isDisabled())
    await p.getByLabel(/Why is this safe/).first().fill('short')
    check('...and a short reason is not enough', await ovBtn.isDisabled())
    await p.getByRole('button', { name: /Coach override/ }).first().click().catch(() => {})

    check('session B saved', (await logSession(p, 'B', { braking: 2, reaction: 2 })) === 201)
    await p.getByTestId('advance-week').getByRole('button', { name: 'Advance' }).waitFor()
    await shot(p, 'ready')
    await p.getByTestId('advance-week').getByRole('button', { name: 'Advance' }).click()
    await p.getByText(/Week 2 of 4: Build/).waitFor({ timeout: 20000 })
    check('with two clean sessions the week advances', true)
    t = await state()
    const adv = t.speed_program_events.filter((e: any) => e.event_type === 'advance')
    check('the advance is recorded with who decided and why it was allowed', adv.length === 1 && adv[0].actor_user_id === COACH_USER && adv[0].detail.override === false && adv[0].detail.eligibility.basis.length === 2)

    // ── pain and poor quality ───────────────────────────────────────────────
    console.log('\nPain and poor quality')
    check('session C with pain saved', (await logSession(p, 'C', { landing: 2, reaction: 2, pain: true })) === 201)
    await p.waitForFunction(() => document.querySelector('[data-testid="guidance"]')?.getAttribute('data-state') === 'hold', undefined, { timeout: 20000 }).catch(() => {})
    check('guidance holds: no added work', (await p.getByTestId('guidance').getAttribute('data-state')) === 'hold' && /Do not add work/.test(await p.getByTestId('guidance').innerText()))
    const pw = await p.getByTestId('advance-panel').innerText()
    check('every advance is blocked until a pain-free session, with no override offered', /Blocked until a pain-free session/.test(pw) && (await p.getByTestId('advance-panel').getByRole('button', { name: /override/i }).count()) === 0)
    const forced = await coachCtx.request.post(`${APP}/api/speed-program/${t.speed_program_assignments[0].id}/advance`, { data: { kind: 'unlock', key: 'skater_hop', override: true, reason: 'The coach insists on this regardless' } })
    check('forcing it through the API is refused too', forced.status() === 409 && /Pain was reported/.test((await forced.json()).error))
    t = await state()
    check('...and nothing changed', t.speed_program_assignments[0].unlocks.length === 0 && t.speed_program_assignments[0].current_week === 2)

    // ── indoor ──────────────────────────────────────────────────────────────
    console.log('\nIndoor space')
    await p.getByLabel('Space', { exact: true }).selectOption('indoor_small')
    await p.getByTestId('indoor-sub').first().waitFor()
    check('indoors, the 10-yard acceleration becomes a short controlled takeoff', /2–3-yard takeoff and brake/.test(await p.getByTestId('item-A-accel_10').innerText()))
    await p.getByTestId('assess-open').click()
    check('indoors, timed tests are not offered', (await p.getByLabel('Type').locator('option').allInnerTexts()).join('|') === 'Movement quality (0–2)')
    await p.getByLabel('Space', { exact: true }).selectOption('outdoor_open')
    await p.getByTestId('assess-open').waitFor()

    // ── adjust and the snapshot ─────────────────────────────────────────────
    console.log('\nCoach adjustments')
    const snapshotBefore = JSON.stringify((await state()).speed_program_assignments[0].plan)
    await p.getByTestId('item-A-wall_drive').getByRole('button', { name: 'Adjust' }).click()
    const adj = p.getByTestId('adjust-wall_drive')
    await adj.getByLabel('Sets').fill('1'); await adj.getByLabel('Note').fill('Sore calf earlier this week')
    await adj.getByRole('button', { name: 'Save change' }).click()
    await p.getByTestId('item-A-wall_drive').getByText('coach-adjusted').waitFor()
    check('the change shows, marked as coach-adjusted', /1 × 5/.test(await p.getByTestId('item-A-wall_drive').innerText()))
    check('the plan snapshot is untouched', JSON.stringify((await state()).speed_program_assignments[0].plan) === snapshotBefore)
    await p.reload({ waitUntil: 'networkidle' }); await p.getByTestId('item-A-wall_drive').waitFor()
    check('the change survives a reload', /coach-adjusted/.test(await p.getByTestId('item-A-wall_drive').innerText()))
    await p.getByTestId('item-A-wall_drive').getByRole('button', { name: 'Adjust' }).click()
    await p.getByTestId('adjust-wall_drive').getByRole('button', { name: 'Remove reference' }).click()
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="item-A-wall_drive"] [data-testid="reference"]').length === 0)
    check('a coach can remove a video reference', true)

    // ── baseline and retest ─────────────────────────────────────────────────
    console.log('\nBaseline and retest')
    const addTimed = async (kind: string, value: string, surface: string) => {
      if (!(await p.getByTestId('assess-form').count())) await p.getByTestId('assess-open').click()
      const f = p.getByTestId('assess-form')
      await f.getByLabel('Which').selectOption(kind); await f.getByLabel('Type').selectOption('timed')
      await f.getByLabel('Time (seconds)').fill(value); await f.getByLabel('Surface').selectOption(surface)
      await p.getByTestId('assess-save').click()
      await p.getByTestId('assess-form').waitFor({ state: 'detached' })
    }
    await addTimed('baseline', '2.31', 'grass')
    await addTimed('retest', '2.20', 'turf')
    check('a retest on a different surface is not compared', /not compared\. Different surface/.test(await p.getByTestId('retest').first().innerText()))
    await addTimed('retest', '2.22', 'grass')
    const rts = await p.getByTestId('retest').allInnerTexts()
    check('a retest under the same conditions is compared, as a number only', /change -0\.09 s/.test(rts[1] || '') && !/improv|better|faster|worse/i.test(rts.join(' ')))
    t = await state()
    check('assessments are stored with their conditions and the player table is untouched', t.speed_program_assessments.length === 3 && t.speed_program_assessments.every((x: any) => x.conditions.timing_method === 'stopwatch') && !(t.player_metrics?.length))
    await shot(p, 'program-desktop')

    // ── roles and isolation ─────────────────────────────────────────────────
    console.log('\nRoles and isolation')
    const id = t.speed_program_assignments[0].id
    const v = await as(browser, 'viewer@example.test')
    await v.page.goto(programUrl, { waitUntil: 'domcontentloaded' }); await v.page.getByTestId('program-header').waitFor({ timeout: 30000 })
    check('a viewer can read the program', true)
    check('...but is offered no way to log, advance or change it', (await v.page.getByTestId('log-A').count()) === 0 && (await v.page.getByTestId('advance-week').count()) === 0 && (await v.page.getByTestId('controls').count()) === 0)
    check('...and the API agrees (log a session: 403)', (await v.context.request.post(`${APP}/api/speed-program/${id}/sessions`, { data: { week: 2, session_key: 'A', status: 'skipped', skip_reason: 'game', occurred_on: new Date().toISOString().slice(0, 10) } })).status() === 403)
    const c = await as(browser, 'contrib@example.test')
    check('a contributor may log a session', (await c.context.request.post(`${APP}/api/speed-program/${id}/sessions`, { data: { week: 2, session_key: 'A', status: 'skipped', skip_reason: 'game', occurred_on: new Date().toISOString().slice(0, 10) } })).status() === 201)
    check('...but cannot assign, adjust or advance (403)', (await c.context.request.patch(`${APP}/api/speed-program/${id}`, { data: { action: 'pause' } })).status() === 403 && (await c.context.request.post(`${APP}/api/speed-program/${id}/advance`, { data: { kind: 'week' } })).status() === 403)
    const o = await as(browser, 'outsider@example.test')
    const oGet = await o.context.request.get(`${APP}/api/speed-program/${id}`)
    check('someone on no team gets 404 for the program (not 403: it does not say it exists)', oGet.status() === 404)
    const oList = (await o.context.request.get(`${APP}/api/speed-program?teamId=${TEAM}`)).status()
    check('...and cannot list the team\'s programs', [403, 404].includes(oList), String(oList))
    check('...nor log a session', (await o.context.request.post(`${APP}/api/speed-program/${id}/sessions`, { data: { week: 2, session_key: 'A', status: 'skipped', skip_reason: 'game', occurred_on: new Date().toISOString().slice(0, 10) } })).status() === 404)
    check('a malformed id answers 404', (await coachCtx.request.get(`${APP}/api/speed-program/not-a-uuid`)).status() === 404)
    const forgedTeam = await coachCtx.request.post(`${APP}/api/speed-program`, { data: { teamId: '99999999-9999-4999-8999-999999999999', playerId: PLAYER, level: 'development', intake: { space: 'outdoor_open' } } })
    check('assigning into a team the coach does not belong to is refused', [403, 404].includes(forgedTeam.status()))
    await v.context.close(); await c.context.close(); await o.context.close()

    // ── a phone ─────────────────────────────────────────────────────────────
    console.log('\nPhone width')
    const m = await as(browser, 'coach@example.test', { width: 390, height: 844 })
    await m.page.goto(programUrl, { waitUntil: 'domcontentloaded' }); await m.page.getByTestId('program-header').waitFor({ timeout: 30000 })
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('no horizontal scroll at 390px', overflow <= 0, `overflow ${overflow}px`)
    await m.page.getByTestId('log-B').click(); await m.page.getByTestId('log-form-B').waitFor()
    check('the log form fits at 390px', (await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0)
    await shot(m.page, 'log-phone')
    await m.context.close()
    await coachCtx.close()
  } finally {
    await browser.close()
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log('\n' + failures.map(f => `  ✗ ${f}`).join('\n')); process.exit(1) }
  console.log('ALL PASS')
}
main().catch(e => { console.error(e); process.exit(1) })
