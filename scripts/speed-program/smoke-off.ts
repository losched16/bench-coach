// Flag-off smoke: the server runs with SPEED_PROGRAM="true" (not exactly "1").
// A signed-in head coach must find that the program does not exist anywhere:
// every API route and method answers 404, the page is a 404, the Development
// tab shows no entry, and no table is touched. Everything else still works.

import { chromium } from 'playwright'

const APP = process.env.APP_URL!, FIXTURE = process.env.FIXTURE_URL!
const TEAM = '22222222-2222-4222-8222-222222222222'
const PLAYER = '33333333-3333-4333-8333-333333333333'
const USER = '11111111-1111-4111-8111-111111111111'
let passed = 0; const failures: string[] = []
const check = (n: string, c: boolean, d = '') => { if (c) { passed++; console.log(`  ✓ ${n}`) } else { failures.push(`${n} ${d}`); console.log(`  ✗ ${n} ${d}`) } }

async function main() {
  await fetch(`${FIXTURE}/__fixture/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    tables: {
      coaches: [{ id: 'coach-1', user_id: USER, subscription_tier: 'team', is_subscribed: true }],
      teams: [{ id: TEAM, coach_id: 'coach-1', name: 'Wildcats 9U', age_group: '9U', workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z' }],
      team_members: [], team_players: [{ id: 'tp1', team_id: TEAM, player_id: PLAYER, name: 'Charlie', player: { name: 'Charlie', jersey_number: '7' }, positions: [] }],
      players: [{ id: PLAYER, name: 'Charlie', jersey_number: '7' }], team_player_archive: [], player_notes: [], user_ui_prefs: [], team_staff: [],
      speed_program_assignments: [{ id: 'existing-1', player_id: PLAYER, team_id: TEAM, level: 'development', status: 'active', current_week: 1 }],
    } }) })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
  try {
    console.log('\nSigned out, flag off')
    const anon = await browser.newContext()
    const a = await anon.request.get(`${APP}/api/speed-program?teamId=${TEAM}`)
    check('signed out: the API answers 404 (it does not even ask who you are)', a.status() === 404, String(a.status()))
    await anon.close()

    console.log('\nHead coach, flag off')
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, undefined, { timeout: 30000 })
    await page.fill('input[type="email"]', 'coach@example.test'); await page.fill('input[type="password"]', 'fixture-password')
    await page.click('button[type="submit"]'); await page.waitForURL(/\/dashboard/, { timeout: 30000 })
    const id = 'existing-1'
    const probes: Array<[string, string, any?]> = [
      ['GET', `/api/speed-program?teamId=${TEAM}&playerId=${PLAYER}`],
      ['POST', '/api/speed-program', { teamId: TEAM, playerId: PLAYER, level: 'development', intake: { space: 'outdoor_open' } }],
      ['GET', `/api/speed-program/${id}`], ['PATCH', `/api/speed-program/${id}`, { action: 'pause' }],
      ['GET', `/api/speed-program/${id}/sessions`], ['POST', `/api/speed-program/${id}/sessions`, {}],
      ['GET', `/api/speed-program/${id}/assessments`], ['POST', `/api/speed-program/${id}/assessments`, {}],
      ['POST', `/api/speed-program/${id}/advance`, { kind: 'week' }],
    ]
    for (const [m, u, body] of probes) {
      const r = await ctx.request.fetch(`${APP}${u}`, { method: m, data: body })
      check(`${m} ${u.replace(TEAM, 'T').replace(PLAYER, 'P').replace(id, ':id')} -> 404`, r.status() === 404, String(r.status()))
    }
    const pg = await page.goto(`${APP}/dashboard/roster/${PLAYER}/speed-program?teamId=${TEAM}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const body = await page.locator('body').innerText()
    check('the program page shows not-found and none of the program', /could not be found|404|not found/i.test(body) && !/Assign the program|Speed, Agility/.test(body) && (await page.getByTestId('speed-program').count()) === 0, `status ${pg?.status()} ${JSON.stringify(body.slice(0, 120))}`)
    await page.goto(`${APP}/dashboard/roster/${PLAYER}?teamId=${TEAM}&tab=development`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    check('the Development tab shows no program entry', (await page.getByTestId('speed-program-card').count()) === 0)
    check('...and the rest of the tab still works', /Development/.test(await page.locator('body').innerText()))
    const st = (await (await fetch(`${FIXTURE}/__fixture/state`)).json()) as any
    check('no speed-program row was written or removed', (st.tables.speed_program_assignments || []).length === 1 && !(st.tables.speed_program_sessions || []).length && !(st.tables.speed_program_events || []).length)
    await ctx.close()
  } finally { await browser.close() }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  console.log('ALL PASS')
}
main().catch(e => { console.error(e); process.exit(1) })
