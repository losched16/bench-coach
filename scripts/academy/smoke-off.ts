// Academy flag-off smoke. The server runs with ACADEMY_LAUNCH="true" (not exactly
// "1"), a published course exists, and one user has already bought it.
// Merging the Academy in this state must expose nothing to visitors.

import { chromium, type Page } from 'playwright'

const APP = process.env.APP_URL!, FIX = process.env.FIXTURE_URL!
const SLUG = 'build-a-better-baseball-swing'
const COURSE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const COACH = { id: '55555555-5555-4555-8555-555555555555', email: 'coach@example.test', password: 'fixture-password' }   // has bought the course
const OTHER = { id: '66666666-6666-4666-8666-666666666666', email: 'other@example.test', password: 'fixture-password' }   // has not
const OWNER = { id: '77777777-7777-4777-8777-777777777777', email: 'owner@example.test', password: 'fixture-password' }   // ADMIN_EMAIL
const TEAM = '22222222-2222-4222-8222-222222222222', TEAM2 = '22222222-2222-4222-8222-222222222223'

let failures = 0
const check = (l: string, ok: boolean, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

async function reset() {
  await fetch(`${FIX}/__fixture/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    users: { [COACH.email]: COACH, [OTHER.email]: OTHER, [OWNER.email]: OWNER },
    tables: {
      academy_courses: [{ id: COURSE_ID, slug: SLUG, title: 'Build a Better Baseball Swing', status: 'published', preview_lesson_key: '1-1', price_cents: 1900, currency: 'usd', stripe_price_id: 'price_x', content_version: 1 }],
      academy_modules: [], academy_lessons: [{ course_id: COURSE_ID, lesson_key: '1-1', module_key: 'm1', kind: 'lesson', position: 1, number_label: '1.1', title: 'First', est_minutes: 5, is_preview: true, status: 'published' }],
      academy_lesson_bodies: [], academy_video_links: [], academy_lesson_progress: [], academy_stripe_events: [], user_events: [],
      academy_enrollments: [{ id: 'enr-coach', user_id: COACH.id, course_id: COURSE_ID, status: 'active', source: 'purchase', stripe_checkout_session_id: 'cs_seed', enrolled_at: '2026-10-01T00:00:00Z', revoked_at: null }],
      coaches: [{ id: 'coach-1', user_id: COACH.id, is_subscribed: true, subscription_tier: 'coach' }, { id: 'coach-2', user_id: OTHER.id, is_subscribed: true, subscription_tier: 'coach' }, { id: 'coach-3', user_id: OWNER.id, is_subscribed: true, subscription_tier: 'coach' }],
      teams: [{ id: TEAM, coach_id: 'coach-1', name: 'Tigers', age_group: '10U', workspace_kind: 'team' }, { id: TEAM2, coach_id: 'coach-2', name: 'Lions', age_group: '10U', workspace_kind: 'team' }],
      team_members: [], team_players: [], players: [], user_ui_prefs: [],
    } }) })
}
async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, null, { timeout: 60000 })
  await page.fill('#email', who.email); await page.fill('#password', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 30000 })
}
const notFoundPage = async (page: Page, url: string) => {
  await page.goto(`${APP}${url}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200)
  const t = await page.locator('body').innerText()
  return /could not be found|404|not found/i.test(t) && !/Build a Better Baseball Swing|Buy|Start the free preview/i.test(t)
}

async function main() {
  await reset()
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
  try {
    console.log('\nA visitor, flag off')
    const v = await browser.newContext(); const vp = await v.newPage()
    for (const u of ['/academy', `/academy/${SLUG}`, `/academy/${SLUG}/preview`]) check(`${u} is not found`, await notFoundPage(vp, u))
    for (const [m, u] of [['POST', '/api/academy/checkout'], ['POST', '/api/academy/confirm'], ['POST', '/api/academy/track']] as const) {
      const r = await v.request.fetch(`${APP}${u}`, { method: m, data: { course: SLUG } })
      check(`${m} ${u} answers 404 (no checkout, no tracking)`, r.status() === 404, String(r.status()))
    }
    const st = await (await v.request.get(`${APP}/api/academy/status`)).json()
    check('the status endpoint says links are off', st.enabled === false)
    const sm = await (await v.request.get(`${APP}/sitemap.xml`)).text()
    check('the sitemap lists no Academy page', !/\/academy/.test(sm) && /<urlset/.test(sm))
    await vp.goto(`${APP}/`, { waitUntil: 'networkidle' }); await vp.waitForTimeout(1500)
    check('the homepage shows no Academy link (header, mobile menu or footer)', (await vp.locator('a[href="/academy"]').count()) === 0)
    await vp.goto(`${APP}/use-cases`, { waitUntil: 'networkidle' }); await vp.waitForTimeout(1500)
    check('the use-cases page shows no Academy link', (await vp.locator('a[href="/academy"]').count()) === 0)
    check('the Stripe webhook route still exists (refunds must keep working)', (await v.request.post(`${APP}/api/stripe/webhook`, { data: '{}' })).status() !== 404)
    await v.close()

    console.log('\nA coach who has not bought, flag off')
    const o = await browser.newContext(); const op = await o.newPage()
    await signIn(op, OTHER); await op.waitForTimeout(1500)
    check('the dashboard has no Academy entry', (await op.locator('a[href="/learn"]').count()) === 0)
    check('/learn is not found', await notFoundPage(op, '/learn'))
    check('checkout is 404 even signed in', (await o.request.post(`${APP}/api/academy/checkout`, { data: { course: SLUG } })).status() === 404)
    await o.close()

    console.log('\nA customer who already bought, flag off')
    const c = await browser.newContext(); const cp = await c.newPage()
    await signIn(cp, COACH)
    await cp.goto(`${APP}/learn`, { waitUntil: 'networkidle' }); await cp.waitForTimeout(800)
    check('their course library still opens (turning the flag off must not lock customers out)', /Build a Better Baseball Swing/.test(await cp.locator('body').innerText()))
    await c.close()

    console.log('\nThe owner, flag off')
    const w = await browser.newContext(); const wp = await w.newPage()
    await signIn(wp, OWNER)
    await wp.goto(`${APP}/academy`, { waitUntil: 'networkidle' })
    check('the owner can preview /academy, with a banner saying it is not launched', (await wp.getByTestId('academy-preview-banner').count()) === 1)
    check('...and the status endpoint shows the owner the links', (await (await w.request.get(`${APP}/api/academy/status`)).json()).enabled === true)
    check('...but checkout is still 404 for the owner', (await w.request.post(`${APP}/api/academy/checkout`, { data: { course: SLUG } })).status() === 404)
    await w.close()
  } finally { await browser.close() }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
  process.exit(failures ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
