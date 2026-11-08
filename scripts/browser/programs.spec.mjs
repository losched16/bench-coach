// Development Program screens in a real browser. See run-programs.sh for what
// is real and what is mocked.

import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const APP = process.env.APP_URL || 'http://127.0.0.1:3101'
const FIXTURE = process.env.FIXTURE_URL || 'http://127.0.0.1:54322'
const TEAM = '22222222-2222-4222-8222-222222222222'
const PLAYER = '33333333-3333-4333-8333-333333333333'
const USER = '11111111-1111-4111-8111-111111111111'
const COACH = 'coach-1'

let passed = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); return }
  failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

const DRAFT = JSON.parse(readFileSync(process.env.PROGRAM_DRAFT_JSON, 'utf8'))
const PAYLOAD = JSON.parse(readFileSync(process.env.PROGRAM_PAYLOAD_JSON, 'utf8'))

// ── the mock API: the routes' contract over the real generator's output ─────
const state = { draft: null, draftVersion: 1, program: null, completions: {}, readings: [], revisions: [], calls: [], saved: 0 }
const uid = (p, i) => `${p}-${i}`
function buildProgram() {
  const sessions = PAYLOAD.sessions.map((s, i) => ({
    id: uid('s', i), program_id: 'prog-1', team_id: TEAM, session_key: s.session_key, week: s.week, scheduled_date: s.scheduled_date,
    kind: s.kind, supervision: s.supervision, title: s.title, focus: s.focus, est_minutes: s.est_minutes, status: state.completions[uid('s', i)] ? 'completed' : 'planned',
    checkpoint: s.checkpoint, assessments: s.assessments, requires_throwing_gate: s.requires_throwing_gate, coach_note: s.coach_note, filming_note: s.filming_note,
    equipment: s.equipment, origin: s.origin, completion: state.completions[uid('s', i)] || null,
    drills: s.drills.map((d, j) => ({ ...d, id: uid(`d${i}`, j), session_id: uid('s', i) })),
  }))
  const types = { sprint_5y: { id: 't1', shape: 'measurement', unit: 'sec', label: '5 yard acceleration' }, first_step_pct: { id: 't2', shape: 'challenge', unit: null, label: 'Correct first step' }, broad_jump: { id: 't3', shape: 'measurement', unit: 'in', label: 'Standing broad jump' } }
  const lines = Object.entries(types).map(([slug, t]) => {
    const rs = state.readings.filter(r => r.slug === slug)
    return { slug, label: t.label, baseline: rs[0] ? String(rs[0].value) : null, latest: rs.length > 1 ? String(rs[rs.length - 1].value) : null, direction: rs.length > 1 ? 'improved' : 'not_enough_data', readings: rs.length, attempts: null, confidence: 'low', conditions: rs[0]?.conditions || null, note: rs.length > 1 ? 'Two readings show direction only, not a trend.' : 'Only the baseline is recorded.' }
  })
  return {
    program: { id: 'prog-1', team_id: TEAM, player_id: PLAYER, title: PAYLOAD.program.title, summary: PAYLOAD.program.summary, start_date: PAYLOAD.program.start_date, end_date: PAYLOAD.program.end_date, status: 'active', version: 1 + state.revisions.filter(r => r.status === 'applied').length, source: PAYLOAD.program.source },
    phases: PAYLOAD.phases.map(p => ({ ...p, id: p.phase_key, start_date: p.start_date, end_date: p.end_date })),
    skills: PAYLOAD.skills.map((s, i) => ({ ...s, id: `sk${i}` })), sessions, revisions: state.revisions, readings: [], drillMedia: {}, assessments: lines, metricTypes: types,
  }
}
async function mockApi(context) {
  await context.route(/\/api\/development-program/, async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname.replace('/api/development-program', '') || '/'
    const method = req.method(); const body = method === 'GET' || method === 'DELETE' ? {} : JSON.parse(req.postData() || '{}')
    state.calls.push(`${method} ${path}`)
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/generate') { state.lastGenerate = body; state.draft = JSON.parse(JSON.stringify(DRAFT)); state.draftVersion = 1; return json({ status: 'ok', draftId: 'draft-1', draft: state.draft }) }
    if (path === '/draft' && method === 'GET') return json({ draft: state.draft, version: state.draftVersion, status: state.program ? 'saved' : 'draft', playerId: PLAYER, savedProgramId: null })
    if (path === '/draft' && method === 'PATCH') {
      if (body.version !== state.draftVersion) return json({ error: 'This draft changed or was already saved. Reload to see the latest.' }, 409)
      state.draft = body.draft; state.draftVersion++; return json({ version: state.draftVersion, qualityReport: state.draft.qualityReport, draft: state.draft })
    }
    if (path === '/draft/save') { state.saved++; state.program = true; return json({ programId: 'prog-1', alreadySaved: state.saved > 1 }) }
    if (path === '/session' && method === 'POST') {
      if (body.action === 'complete') { state.completions[body.sessionId] = { completed_on: body.on, drills_done: body.drills, ratings: body.ratings, pain_reported: body.pain, notes: body.notes, actual_minutes: body.minutes, coach_confirmed: true }
        for (const r of body.readings || []) state.readings.push({ slug: r.slug, value: r.value ?? r.successes, conditions: r.conditions }); return json({ success: true }) }
      if (body.action === 'undo') { delete state.completions[body.sessionId]; return json({ success: true }) }
    }
    if (path === '/assessment') { for (const r of body.readings) state.readings.push({ slug: r.slug, value: r.value ?? r.successes, conditions: body.conditions }); return json({ success: true, recorded: body.readings.length }) }
    if (path === '/revision') {
      if (body.action === 'propose') { state.revisions = [{ id: 'rev-1', status: 'proposed', summary: 'Planned starts are getting faster but reaction starts are not. Consider adding controlled reaction-based starts.', evidence: ['5 yard acceleration: 1.4 → 1.3'] }]; return json({ created: 1, advice: [] }) }
      if (body.action === 'apply') { state.applied = true; state.revisions = state.revisions.map(r => ({ ...r, status: 'applied' })); return json({ success: true, version: 2, sessionsChanged: 6 }) }
    }
    if (path === '/' || path === '') {
      if (url.searchParams.get('programId')) return json(buildProgram())
      return json({ programs: state.program ? [{ id: 'prog-1', player_id: PLAYER, title: PAYLOAD.program.title, start_date: PAYLOAD.program.start_date, end_date: PAYLOAD.program.end_date, status: 'active' }] : [], drafts: [] })
    }
    return json({ error: 'unmocked' }, 404)
  })
}

// ── fixture + sign in (as in help.spec.mjs) ─────────────────────────────────
async function seed() {
  const r = await fetch(`${FIXTURE}/__fixture/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tables: {
    coaches: [{ id: COACH, user_id: USER, is_subscribed: true }],
    teams: [{ id: TEAM, coach_id: COACH, name: 'Wildcats 9U', age_group: '9U', workspace_kind: 'team', created_at: '2026-01-01T00:00:00Z' }],
    team_members: [], user_ui_prefs: [], team_notes: [], practice_plans: [],
    team_players: [{ id: 'tp1', team_id: TEAM, name: 'Charlie', player_id: PLAYER, player: { id: PLAYER, name: 'Charlie', jersey_number: '7' } }],
  } }) })
  if (!r.ok) throw new Error('could not reset the fixture')
}
async function signedIn(browser, { role = 'owner', viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport })
  await context.clock?.install?.({ time: new Date('2026-11-10T15:00:00Z') }).catch?.(() => {})
  await context.route(/\/api\/me(\?|$)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role, can: { read: true, ask: true, record: role !== 'viewer', decide: role === 'owner' || role === 'admin', remember: role === 'owner', own: role === 'owner' }, label: role }) }))
  await context.route(/\/api\/entitlements/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'coach', label: 'Coach', ai: true, teamFeatures: true, limits: { maxTeams: 5, maxPersonalPlayers: 5 }, usage: { teams: 1, personalPlayers: 0 }, workspaces: [{ id: TEAM, name: 'Wildcats 9U', kind: 'team' }], can: { addTeam: true, addPersonalPlayer: true }, purchasable: {}, plans: [] }) }))
  await context.route(/\/api\/track/, route => route.fulfill({ status: 200, body: '{}' }))
  await mockApi(context)
  const page = await context.newPage()
  const signIn = async () => {
    await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, { timeout: 30000 })
    await page.fill('input[type="email"]', 'coach@example.test'); await page.fill('input[type="password"]', 'fixture-password')
    await page.click('button[type="submit"]'); await page.waitForURL(/\/dashboard/, { timeout: 30000 })
  }
  try { await signIn() } catch { await signIn() }
  return { context, page }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
const errors = []
try {
  await seed()
  const { context, page } = await signedIn(browser)
  const q = `?teamId=${TEAM}`

  console.log('\nGenerate → review')
  await page.goto(`${APP}/dashboard/development${q}`, { waitUntil: 'networkidle' })
  check('the Development page loads with no programs yet', await page.getByText('No training programs yet.').isVisible({ timeout: 30000 }).catch(() => false))
  check('there is ONE "Development" menu item, not separate Plans and Programs', (await page.getByRole('link', { name: /^Development( —|$)/ }).count()) >= 1 && (await page.getByRole('link', { name: /Development Programs|Development Plans/ }).count()) === 0)
  check('the page has both halves: training programs and skill paths', await page.getByRole('heading', { name: 'Training programs' }).isVisible() && await page.getByRole('heading', { name: 'Skill paths' }).isVisible())
  await page.screenshot({ path: 'docs/development-hub/01-hub-desktop.png', fullPage: true })
  check('the old /programs address still lands on Development', await (async () => { await page.goto(`${APP}/dashboard/programs${q}`); await page.waitForURL(/\/dashboard\/development/, { timeout: 15000 }); return true })().catch(() => false))

  console.log('\nOne skill')
  await page.getByRole('button', { name: /Work on one skill/ }).click()
  await page.getByLabel('Player').selectOption(PLAYER)
  await page.screenshot({ path: 'docs/development-hub/02-one-skill-desktop.png', fullPage: true })
  check('one-skill start offers a self-paced skill path AND a short scheduled program', await page.getByText('Self-paced skill path.', { exact: true }).isVisible() && await page.getByText('Short scheduled program.', { exact: true }).isVisible())
  check('the skill-path option leads to the player’s skill paths', (await page.getByRole('link', { name: /Open their skill paths/ }).getAttribute('href') || '').includes(`/dashboard/roster/${PLAYER}`))
  await page.getByLabel('Which skill?').selectOption('hitting')
  await page.getByLabel(/What do you want out of it/).fill('more power without pulling off the ball')
  await page.getByText('4 weeks').click()
  await page.getByRole('button', { name: /Build the program draft/ }).click()
  await page.waitForURL(/\/programs\/draft\/draft-1/, { timeout: 30000 })
  const g = state.lastGenerate
  check('a one-skill request sends exactly that skill, a short length and the coach’s words', JSON.stringify(g.overrides.skills) === '["hitting"]' && g.overrides.weeks === 4 && g.overrides.independentMinutes === 0 && /pulling off the ball/.test(g.message), JSON.stringify(g))
  await page.goto(`${APP}/dashboard/development${q}`, { waitUntil: 'networkidle' })

  console.log('\nGenerate → review')
  await page.getByRole('button', { name: /Full development program/ }).click()
  await page.getByLabel('Player').selectOption(PLAYER)
  await page.screenshot({ path: 'docs/development-hub/03-full-program-desktop.png', fullPage: true })
  await page.getByRole('button', { name: /Build the program draft/ }).click()
  await page.waitForURL(/\/programs\/draft\/draft-1/, { timeout: 30000 })
  check('building a program opens the editable draft', true)
  await page.getByRole('heading', { level: 1 }).waitFor()
  check('the draft says it is NOT saved', await page.getByText('Draft — not saved').isVisible())
  check('nothing was saved by generating', state.saved === 0 && !state.calls.includes('POST /draft/save'))
  check('all seven requested skills are listed with priorities', (await page.locator('#priorities ~ ul li, section[aria-labelledby="priorities"] li').count()) === 7)
  check('every week 1–8 can be opened', (await page.getByRole('navigation', { name: 'Weeks' }).getByRole('button').count()) === 8)
  check('the throwing gate is shown closed', await page.getByText(/Throwing gate — closed/).isVisible())
  check('the draft separates recorded facts from what you told me', await page.getByText('Recorded facts').isVisible() && await page.getByText('What you told me').isVisible())
  check('assumptions are listed for revision', await page.getByText('Assumptions I made').first().isVisible())
  await page.getByRole('button', { name: 'Week 4' }).click()
  check('week 4 shows its midpoint checkpoint', await page.getByText('midpoint').first().isVisible())
  check('rest days are visible', (await page.getByText('Rest day').count()) > 0)
  await page.locator('details summary', { hasText: 'Open the full session' }).first().click()
  check('a full session opens with its blocks', (await page.locator('details[open] h4').count()) >= 3)
  await page.locator('details[open] li button[aria-expanded]').first().click()
  check('a drill opens to show instructions', await page.locator('details[open] ol li').first().isVisible())

  console.log('\nEdit → save')
  const minutes = page.locator('details[open] input[type="number"]').first()
  await minutes.fill('7')
  await page.getByRole('button', { name: /Save my edits to the draft/ }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Saving edits…'))
  check('an edit is sent with the version it started from and accepted', state.calls.includes('PATCH /draft') && state.draftVersion === 2)
  check('the edited session is marked as the coach’s', (await page.getByText('edited by you').count()) >= 1)
  await page.getByRole('checkbox', { name: /clearing the player to start the throwing ladder/ }).check()
  check('the owner is offered the throwing-gate control and it saved checked', await page.getByRole('checkbox', { name: /clearing the player to start the throwing ladder/ }).isChecked())
  await page.getByRole('button', { name: /Approve and save program/ }).click()
  await page.waitForURL(/\/programs\/prog-1/, { timeout: 30000 })
  check('approval saves once and opens the saved program', state.saved === 1)
  check('the gate clearing was part of the saved edits', state.draft.throwingGate.cleared === true)

  console.log('\nOverview → calendar → today')
  await page.getByRole('heading', { level: 1 }).waitFor()
  check('overview shows progress and the current phase', await page.getByText(/sessions done/).isVisible() && await page.getByText('Foundation').first().isVisible())
  check('a "Today" shortcut opens the day’s workout', await page.getByRole('region', { name: 'Today' }).isVisible())
  await page.getByRole('tab', { name: 'Calendar' }).click()
  check('the calendar lists each day of the week with kind chips', (await page.getByText('Coached session').count()) >= 3 && (await page.getByText('Independent routine').count()) >= 3)
  await page.getByRole('region', { name: 'Today' }).getByRole('link').first().click()
  await page.waitForURL(/\/session\//)
  console.log('\nDaily execution')
  await page.getByRole('heading', { level: 1 }).waitFor()
  check('the session shows its total time and who must be present', await page.getByText(/about 60 minutes/).isVisible() && await page.getByText(/Adult present/).isVisible())
  check('drills are ordered with dose and cues', (await page.getByRole('checkbox').count()) > 5 && await page.getByText(/Say:|Remember:/).first().isVisible())
  const first = page.getByRole('checkbox').nth(1)
  await first.check()
  const kid = page.getByRole('checkbox', { name: /Simple view/ }); await kid.check()
  check('the simple view hides the long instructions', (await page.locator('ol li').count()) === 0)
  await kid.uncheck()
  check('checkpoint measurements are asked for on a checkpoint day', await page.getByRole('heading', { name: 'Checkpoint measurements', exact: true }).isVisible())
  // Today is the second baseline day: outfield, infield and hitting are all
  // scored out of 10 attempts, so it asks for successes rather than a time.
  await page.locator('section[aria-label="Measurements"] input[inputmode="numeric"]').first().fill('6')
  await page.getByLabel(/Conditions/).fill('grass, same shoes')
  await page.getByRole('radio', { name: 'Just right' }).first().check({ force: true })
  await page.getByRole('button', { name: 'Mark session complete' }).click()
  await page.getByText(/Recorded\. Nice work/).waitFor({ timeout: 15000 })
  const done = Object.values(state.completions)[0]
  check('completion records drills done, ratings, notes and conditions', done && done.drills_done.some(d => d.done) && Object.keys(done.ratings).length >= 1 && state.readings[0]?.conditions === 'grass, same shoes')
  check('the page now shows the session as done and offers re-open to the coach', await page.getByText('Done').first().isVisible() && await page.getByRole('button', { name: /Re-open this session/ }).isVisible())
  check('a completed session’s controls are locked', await page.getByRole('radio').first().isDisabled())

  console.log('\nProgress → adjustments')
  await page.goBack(); await page.getByRole('tab', { name: 'Progress' }).click()
  check('the progress table says "not enough data" rather than inventing a trend', (await page.getByText(/Only the baseline is recorded|Not enough data/).count()) >= 1)
  await page.getByRole('button', { name: 'Record measurements' }).click()
  await page.getByLabel(/Conditions/).fill('grass')
  await page.locator('input[inputmode="decimal"]').first().fill('1.3')
  await page.getByRole('button', { name: 'Save measurements' }).click()
  await page.getByText(/Recorded 1 measurement/).waitFor()
  check('a standalone measurement is recorded', state.calls.includes('POST /assessment') && state.readings.length === 2)
  await page.getByRole('tab', { name: /Adjustments/ }).click()
  await page.getByRole('button', { name: 'Check for suggestions' }).click()
  await page.getByText(/reaction-based starts/).waitFor()
  check('a recommendation is shown with its evidence and NOT applied until approved', await page.getByText('5 yard acceleration: 1.4 → 1.3').isVisible() && !state.applied)
  await page.getByRole('button', { name: /Approve for future sessions/ }).click()
  await page.getByText(/Applied to 6 future session/).waitFor()
  check('approval is what applies it', state.applied === true && state.revisions[0].status === 'applied')

  console.log('\nRoles and small screens')
  const viewer = await signedIn(browser, { role: 'contributor' })
  await viewer.page.goto(`${APP}/dashboard/programs/draft/draft-1${q}`, { waitUntil: 'networkidle' })
  state.program = false
  await viewer.page.reload({ waitUntil: 'networkidle' })
  check('a contributor cannot see the approve control', (await viewer.page.getByRole('button', { name: /Approve and save program/ }).count()) === 0 && await viewer.page.getByText(/Only the head coach can approve/).isVisible())
  await viewer.context.close()
  const phone = await signedIn(browser, { viewport: { width: 375, height: 800 } })
  state.program = true
  await phone.page.goto(`${APP}/dashboard/development${q}`, { waitUntil: 'networkidle' })
  await phone.page.getByRole('button', { name: /Work on one skill/ }).click()
  await phone.page.screenshot({ path: 'docs/development-hub/04-hub-phone.png', fullPage: true })
  check('the Development page has no sideways scroll at 375px', (await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1)
  for (const [name, url] of [['draft', `${APP}/dashboard/programs/draft/draft-1${q}`], ['program', `${APP}/dashboard/programs/prog-1${q}`]]) {
    state.program = true
    await phone.page.goto(url, { waitUntil: 'networkidle' })
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`${name} page has no sideways scroll at 375px`, overflow <= 1, `overflows by ${overflow}px`)
  }
  await phone.context.close()
  await context.close()
} catch (e) { errors.push(e) } finally { await browser.close() }

console.log(`\n${passed} passed, ${failures.length} failed`)
if (errors.length) { console.log('\nThe run itself broke:'); for (const e of errors) console.log(`  ${e.stack || e}`) }
if (failures.length || errors.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1) }
