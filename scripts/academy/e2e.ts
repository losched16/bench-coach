// BenchCoach Academy — end-to-end in a real browser.
//
//   bash scripts/academy/run-e2e.sh            (synthetic course)
//   ACADEMY_MANUSCRIPT=… bash scripts/academy/run-e2e.sh   (the real course, private screenshots)
//
// Real: every Academy page and API, the middleware, the real sign-up and
// login pages, the real Stripe webhook route (signature verified with the
// stripe library), fulfilment, progress. Stand-ins: Supabase
// (scripts/browser/fixture-supabase.mjs — no RLS; RLS is proved in Postgres
// by test:migration-080) and Stripe (scripts/academy/fake-stripe.mjs).
//
// Scenarios from the brief: parent course-only purchase, logged-out preview,
// coach subscriber, webhook replay, unauthorized lesson access, enrollment
// revocation (refund + admin), broken-video fallback, mobile reading — with
// screenshots at 375 / 430 / 1440.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { parseManuscript } from '../../lib/academy/manuscript'
import { courseCopy } from '../../lib/academy/catalog'

const APP = process.env.APP_URL || 'http://127.0.0.1:3200'
const FIX = process.env.FIXTURE_URL || 'http://127.0.0.1:54322'
const STRIPE = process.env.FAKE_STRIPE_URL || 'http://127.0.0.1:12111'
const OUT = process.env.OUT || '.academy-content/e2e'
const SLUG = 'build-a-better-baseball-swing'
const COURSE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const COACH = { id: '55555555-5555-4555-8555-555555555555', email: 'coach@example.test', password: 'fixture-password' }
const OTHER = { id: '66666666-6666-4666-8666-666666666666', email: 'other@example.test', password: 'fixture-password' }
const OWNER = { id: '77777777-7777-4777-8777-777777777777', email: 'owner@example.test', password: 'fixture-password' }
const PARENT = { email: 'parent@example.test', password: 'parent-password-1' }
const TEAM = '22222222-2222-4222-8222-222222222222'

let failures = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  const l = `${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`
  console.log(l); lines.push(l); if (!ok) failures++
}

const manuscriptPath = process.env.ACADEMY_MANUSCRIPT && existsSync(process.env.ACADEMY_MANUSCRIPT)
  ? process.env.ACADEMY_MANUSCRIPT : 'scripts/fixtures/academy-sample-manuscript.md'
const course = parseManuscript(readFileSync(manuscriptPath, 'utf8'), { slug: SLUG, previewLessonKey: '1-1' })
const lessons = course.lessons.filter(l => l.kind === 'lesson')
const paidLesson = lessons[1]   // 1.2 — not the preview
const paidSentence = ((paidLesson.blocks.find(b => b.type === 'labeled' && b.kind === 'teaching') as any)?.text || '').slice(0, 40)
const lastLesson = lessons[lessons.length - 1]

async function reset() {
  const seed = {
    users: {
      [COACH.email]: COACH, [OTHER.email]: OTHER, [OWNER.email]: OWNER,
    },
    uniques: {
      academy_enrollments: [['user_id', 'course_id'], ['stripe_checkout_session_id']],
      academy_stripe_events: [['event_id']],
    },
    tables: {
      academy_courses: [{
        id: COURSE_ID, slug: SLUG, title: course.title, subtitle: course.subtitle, summary: courseCopy(SLUG)!.subheadline,
        status: 'published', preview_lesson_key: '1-1', safety_note: course.safetyText, content_version: 1,
        price_cents: 1900, currency: 'usd', stripe_price_id: 'price_test_course', related_pathway_slug: 'build-the-swing',
      }],
      academy_modules: course.modules.map(m => ({ course_id: COURSE_ID, module_key: m.key, position: m.position, title: m.title, subtitle: m.subtitle, outcome: m.outcome })),
      academy_lessons: course.lessons.map(l => ({ course_id: COURSE_ID, lesson_key: l.key, module_key: l.moduleKey, kind: l.kind, position: l.position, number_label: l.numberLabel, title: l.title, est_minutes: l.estMinutes, is_preview: l.isPreview, status: 'published' })),
      academy_lesson_bodies: course.lessons.map(l => ({ course_id: COURSE_ID, lesson_key: l.key, blocks: l.blocks, field_test: l.fieldTest })),
      academy_video_links: [
        // Synthetic links for the test — NOT real approvals of real videos.
        { id: 'v-ok', course_id: COURSE_ID, lesson_key: lessons[1].key, kind: 'video', title: 'Test demonstration', creator: 'Test Creator', watch_url: 'https://www.youtube.com/watch?v=TESTFIXTURE1', approval_status: 'approved', reviewed_by: 'test', reviewed_at: '2026-10-01', link_status: 'ok', position: 1 },
        { id: 'v-broken', course_id: COURSE_ID, lesson_key: lessons[2].key, kind: 'video', title: 'Removed video', creator: 'Test Creator', watch_url: 'https://www.youtube.com/watch?v=TESTFIXTURE2', approval_status: 'approved', reviewed_by: 'test', reviewed_at: '2026-10-01', link_status: 'broken', position: 1 },
        { id: 'v-candidate', course_id: COURSE_ID, lesson_key: lessons[0].key, kind: 'video', title: 'Unreviewed candidate', creator: 'Someone', watch_url: 'https://www.youtube.com/watch?v=TESTFIXTURE3', approval_status: 'candidate', link_status: 'unchecked', position: 1 },
      ],
      academy_enrollments: [{ id: 'enr-coach', user_id: COACH.id, course_id: COURSE_ID, status: 'active', source: 'purchase', stripe_checkout_session_id: 'cs_seed_coach', enrolled_at: '2026-10-01T00:00:00Z', revoked_at: null }],
      academy_lesson_progress: [], academy_stripe_events: [], user_events: [],
      coaches: [{ id: 'coach-1', user_id: COACH.id, is_subscribed: true, subscription_tier: 'coach', display_name: 'Sample Coach' }],
      teams: [{ id: TEAM, coach_id: 'coach-1', name: 'Sample Tigers 10U', age_group: '10U', workspace_kind: 'team' }],
      team_members: [], team_players: [], players: [], user_ui_prefs: [],
    },
  }
  await fetch(`${FIX}/__fixture/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seed) })
}
const state = async () => (await (await fetch(`${FIX}/__fixture/state`)).json()).tables

async function signIn(page: Page, who: { email: string; password: string }, redirect?: string) {
  await page.goto(`${APP}/auth/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, null, { timeout: 60000 })
  await page.fill('#email', who.email)
  await page.fill('#password', who.password)
  await page.click('button[type="submit"]')
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const status = (page: Page, url: string, init?: any) => page.evaluate(async ([u, i]) => (await fetch(u as string, i as any)).status, [url, init] as const)

async function main() {
  mkdirSync(OUT, { recursive: true })
  await reset()
  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const shot = (p: Page, name: string, full = true) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full })

  // ── 1. Logged out: catalog, sales page, free preview; paid text unreachable ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await page.goto(`${APP}/academy`, { waitUntil: 'networkidle' })
    check('catalog lists the published course', (await page.getByTestId('course-card').count()) === 1)
    check('catalog says other topics are not for sale', /not available to buy yet/.test(await page.content()))
    await shot(page, 'catalog-1440')
    await page.goto(`${APP}/academy/${SLUG}`, { waitUntil: 'networkidle' })
    const sales = await page.content()
    check('sales page shows the curriculum outline', (await page.getByTestId('curriculum').locator('li li').count()) === lessons.length)
    check('sales page shows the price on the buy button', /\$19\.00/.test(await page.getByTestId('buy').first().innerText()))
    check('sales page has Course structured data and a canonical URL', /"@type":"Course"/.test(sales) && /rel="canonical" href="https:\/\/www\.mybenchcoach\.com\/academy\//.test(sales))
    check('sales page carries no paid lesson text', !!paidSentence && !sales.includes(paidSentence))
    await shot(page, 'sales-1440')
    await page.getByTestId('preview-link').click()
    await page.getByTestId('lesson-body').waitFor()
    const preview = await page.content()
    check('free preview reads without an account', (await page.getByTestId('drill').count()) >= 1)
    check('preview shows the course safety notice before the drills', !!course.safetyText && preview.includes(course.safetyText.slice(0, 30)))
    check('an unreviewed candidate video is never shown', !/Unreviewed candidate|TESTFIXTURE3/.test(preview) && (await page.getByTestId('video-pending').count()) === 1)
    await shot(page, 'preview-1440')
    await page.goto(`${APP}/learn/${SLUG}/${paidLesson.key}`, { waitUntil: 'networkidle' })
    check('a paid lesson URL sends a signed-out visitor to log in', /\/auth\/login\?redirect=/.test(page.url()) && !(await page.content()).includes(paidSentence))
    check('progress API refuses a signed-out caller', (await status(page, '/api/academy/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ course: SLUG, lesson: '1-1', action: 'complete' }) })) === 401)
    check('checkout API refuses a signed-out caller', (await status(page, '/api/academy/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ course: SLUG }) })) === 401)
    const forged = await (await fetch(`${STRIPE}/__control/forged`)).json()
    check('a webhook with a bad signature is refused', forged.status === 400 && (await state()).academy_enrollments.length === 1)
    await ctx.close()
  }

  // ── 2. Parent: course-only purchase on a phone, no team, no subscription ──
  let parentId = ''
  let parentPi = ''
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(`${APP}/academy/${SLUG}`, { waitUntil: 'networkidle' })
    await page.getByTestId('buy').first().click()
    await page.waitForURL(/\/auth\/signup\?redirect=/, { timeout: 30000 })
    check('buying signed-out goes to sign-up with Academy wording', /Create your Academy account/.test(await page.content()))
    await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, null, { timeout: 60000 })
    await page.fill('#displayName', 'Pat Parent')
    await page.fill('#email', PARENT.email)
    await page.fill('#password', PARENT.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/127\.0\.0\.1:12111\/pay\//, { timeout: 60000 })
    check('after sign-up the buyer goes straight to checkout (no paywall, no dashboard)', true)
    const sess = (await (await fetch(`${STRIPE}/__control/sessions`)).json()).at(-1)
    check('checkout is a one-time payment for the course price, tied to the signed-in buyer',
      sess.mode === 'payment' && sess._price === 'price_test_course' && sess.metadata.kind === 'academy_course' && sess.client_reference_id === sess.metadata.user_id)
    parentId = sess.client_reference_id
    await page.click('#pay')
    await page.waitForURL(/\/learn\/build-a-better-baseball-swing\?/, { timeout: 60000 })
    await page.getByTestId('welcome').waitFor({ timeout: 60000 })
    check('exactly one checkout was started', (await (await fetch(`${STRIPE}/__control/sessions`)).json()).length === 1)
    check('after payment the parent lands in the course', true)
    let t = await state()
    const enr = t.academy_enrollments.find((e: any) => e.user_id === parentId)
    parentPi = enr?.stripe_payment_intent_id
    check('the webhook enrolled the parent once, as a purchase', t.academy_enrollments.filter((e: any) => e.user_id === parentId).length === 1 && enr.source === 'purchase' && enr.status === 'active')
    check('the parent has no subscription and no team', !t.coaches.find((c: any) => c.user_id === parentId)?.is_subscribed && !t.teams.some((x: any) => x.coach_id === t.coaches.find((c: any) => c.user_id === parentId)?.id))
    // Replay the same webhook event.
    const replay = await (await fetch(`${STRIPE}/__control/replay-last`)).json()
    t = await state()
    check('webhook replay is acknowledged and changes nothing', replay.status === 200 && t.academy_enrollments.filter((e: any) => e.user_id === parentId).length === 1 && t.academy_stripe_events.filter((e: any) => e.event_id === replay.id).length === 1)

    // Reading on a phone.
    await page.getByTestId('resume').click()
    await page.getByTestId('lesson-title').waitFor()
    check('Start the course opens the first page', /welcome/.test(page.url()))
    await page.goto(`${APP}/learn/${SLUG}/${lessons[0].key}`, { waitUntil: 'networkidle' })
    check('lesson page fits a 430px phone', await noOverflow(page))
    await page.getByTestId('drawer-open').click()
    await page.getByTestId('drawer').waitFor()
    check('the contents drawer opens and lists every lesson', (await page.getByTestId('drawer').locator('a[href*="/learn/"]').count()) >= course.lessons.length)
    await shot(page, 'drawer-430', false)
    await page.keyboard.press('Escape')
    check('Escape closes the drawer', (await page.getByTestId('drawer').count()) === 0)
    await page.getByTestId('complete').click()
    await page.getByText('Lesson complete', { exact: true }).waitFor({ timeout: 15000 })
    t = await state()
    check('marking complete saves reading progress', t.academy_lesson_progress.some((p: any) => p.user_id === parentId && p.lesson_key === lessons[0].key && p.completed_at),
      JSON.stringify(t.academy_lesson_progress.map((p: any) => [p.user_id?.slice(0, 8), p.lesson_key, !!p.completed_at])) + ` parent=${parentId.slice(0, 8)} lesson=${lessons[0].key}`)
    await page.getByTestId('next').click()
    await page.waitForURL(new RegExp(`/learn/${SLUG}/${lessons[1].key}$`))
    check('Next goes to the next lesson in order', true)
    const vlink = page.getByTestId('video-link')
    check('an approved video opens externally, credited, in a new tab', (await vlink.count()) === 1 && (await vlink.getAttribute('target')) === '_blank' && /noopener/.test((await vlink.getAttribute('rel')) || '') && /Test Creator/.test(await vlink.innerText()))
    await shot(page, 'lesson-430')
    await page.goto(`${APP}/learn/${SLUG}/${lessons[2].key}`, { waitUntil: 'networkidle' })
    check('a broken video shows a fallback and no link', (await page.getByTestId('video-broken').count()) === 1 && (await page.getByTestId('video-link').count()) === 0)
    await page.goto(`${APP}/dashboard`, { waitUntil: 'networkidle' })
    check('the course does not unlock the coach dashboard', /\/subscribe|\/onboarding/.test(page.url()), page.url())
    await page.goto(`${APP}/learn`, { waitUntil: 'networkidle' })
    check('My courses lists the course with progress', /1 of \d+ lessons read/.test(await page.getByTestId('my-course').innerText()))
    await ctx.close()
  }

  // ── 3. Mobile reading at 375, and screenshots at all three widths ──
  {
    for (const w of [375, 430, 1440]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w > 1000 ? 1000 : 812 }, isMobile: w < 1000 })
      const page = await ctx.newPage()
      await signIn(page, COACH, `/learn/${SLUG}`)
      await page.waitForURL(new RegExp(`/learn/${SLUG}$`), { timeout: 60000 })
      check(`${w}px: course overview fits`, await noOverflow(page))
      await shot(page, `overview-${w}`)
      await page.goto(`${APP}/learn/${SLUG}/${lessons[0].key}`, { waitUntil: 'networkidle' })
      check(`${w}px: lesson fits, text is at least 16px`, await noOverflow(page) && await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="lesson-body"] p')!).fontSize) >= 16))
      await shot(page, `lesson-${w}`)
      await page.goto(`${APP}/learn/${SLUG}/troubleshooting`, { waitUntil: 'networkidle' })
      check(`${w}px: troubleshooting table scrolls inside its box, not the page`, await noOverflow(page))
      await page.goto(`${APP}/learn/${SLUG}/checklist`, { waitUntil: 'networkidle' })
      check(`${w}px: printable checklist lists every lesson`, (await page.getByTestId('checklist').locator('li').count()) === lessons.length && await noOverflow(page))
      if (w === 1440) await shot(page, 'checklist-1440')
      await page.goto(`${APP}/academy/${SLUG}`, { waitUntil: 'networkidle' })
      check(`${w}px: sales page fits`, await noOverflow(page))
      if (w !== 1440) await shot(page, `sales-${w}`)
      await page.goto(`${APP}/academy/${SLUG}/preview`, { waitUntil: 'networkidle' })
      if (w !== 1440) await shot(page, `preview-${w}`)
      await ctx.close()
    }
  }

  // ── 4. Coach subscriber: same course surface, Academy in the dashboard nav ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await ctx.route(/\/api\/me(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner', can: { read: true, ask: true, record: true, decide: true, remember: true, own: true }, label: 'owner' }) }))
    await ctx.route(/\/api\/entitlements/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'coach', label: 'Coach', ai: true, teamFeatures: true, limits: { maxTeams: 5, maxPersonalPlayers: 5 }, usage: { teams: 1, personalPlayers: 0 }, workspaces: [{ id: TEAM, name: 'Sample Tigers 10U', kind: 'team' }], can: { addTeam: true, addPersonalPlayer: true }, purchasable: {}, plans: [] }) }))
    const page = await ctx.newPage()
    await signIn(page, COACH)
    await page.waitForURL(/\/dashboard/, { timeout: 60000 })
    const academyLink = page.locator('a[href="/learn"]').first()
    await academyLink.waitFor({ timeout: 30000 })
    check('dashboard nav has Academy, tooltip "Learn a skill"', (await academyLink.getAttribute('title')) === 'Learn a skill')
    check('Playbooks and Development Plans keep distinct tooltips',
      (await page.locator('a[title="Run a preset program"]').count()) > 0 && (await page.locator('a[title="Track this player\'s growth"]').count()) > 0)
    await academyLink.click()
    await page.waitForURL(/\/learn$/)
    await page.getByTestId('my-course').click()
    await page.goto(`${APP}/learn/${SLUG}/${lastLesson.key}`, { waitUntil: 'networkidle' })
    check('a subscriber gets the existing Development Plans as the next step', /Open Development Plans/.test(await page.getByTestId('course-handoff').innerText()))
    check('no unbuilt "Create My Swing Development Plan" button is offered', !/Create My Swing Development Plan/.test(await page.content()))
    await ctx.close()
  }

  // ── 5. Unauthorized access, and a return URL that proves nothing ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await signIn(page, OTHER, `/learn/${SLUG}/${paidLesson.key}`)
    await page.waitForURL(/\/academy\/build-a-better-baseball-swing\?access=required/, { timeout: 60000 })
    check('a signed-in non-buyer opening a paid lesson is sent to the course page', !(await page.content()).includes(paidSentence))
    check('progress API: 403 without an enrollment', (await status(page, '/api/academy/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ course: SLUG, lesson: lessons[0].key, action: 'complete' }) })) === 403)
    const parentSession = (await (await fetch(`${STRIPE}/__control/sessions`)).json()).find((s: any) => s.client_reference_id === parentId)
    check("confirming someone else's checkout session is 'not found'", (await status(page, '/api/academy/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: parentSession.id }) })) === 404)
    await page.goto(`${APP}/learn/${SLUG}?purchase=success&session_id=cs_test_made_up_123`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('purchase-confirm').waitFor()
    await page.waitForTimeout(4000)
    const t = await state()
    check('a made-up return URL grants nothing', !t.academy_enrollments.some((e: any) => e.user_id === OTHER.id) && !(await page.content()).includes(paidSentence))

    // Return URL with the webhook held back: the confirm path asks Stripe.
    await fetch(`${STRIPE}/__control/deliver?on=0`)
    await page.goto(`${APP}/academy/${SLUG}`, { waitUntil: 'networkidle' })
    await page.getByTestId('buy').first().click()
    await page.waitForURL(/12111\/pay\//, { timeout: 30000 })
    await page.click('#pay')
    await page.getByTestId('welcome').waitFor({ timeout: 60000 })
    await fetch(`${STRIPE}/__control/deliver?on=1`)
    check('with no webhook yet, the server-side confirm (asking Stripe) enrolls the payer', (await state()).academy_enrollments.some((e: any) => e.user_id === OTHER.id && e.status === 'active'))
    await ctx.close()
  }

  // ── 6. Revocation: full refund, and the owner's revoke ──
  {
    const r = await (await fetch(`${STRIPE}/__control/refund?pi=${parentPi}`)).json()
    let t = await state()
    check('a full refund webhook ends the parent\'s access', r.status === 200 && t.academy_enrollments.find((e: any) => e.user_id === parentId)?.status === 'refunded')
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
    const page = await ctx.newPage()
    await signIn(page, PARENT, `/learn/${SLUG}/${paidLesson.key}`)
    await page.waitForURL(/\/academy\/build-a-better-baseball-swing\?access=required/, { timeout: 60000 })
    check('after the refund the paid lesson is closed to them', !(await page.content()).includes(paidSentence))
    await ctx.close()

    const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const op = await octx.newPage()
    await signIn(op, OWNER, '/admin/academy')
    await op.waitForURL(/\/admin\/academy/, { timeout: 60000 })
    const post = (body: any) => op.evaluate(async b => { const r = await fetch('/api/academy/admin/enrollments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() } }, body)
    let res = await post({ course: SLUG, email: OTHER.email, action: 'revoke', reason: 'e2e' })
    t = await state()
    check('the owner can revoke an enrollment', res.status === 200 && t.academy_enrollments.find((e: any) => e.user_id === OTHER.id)?.status === 'revoked')
    res = await post({ course: SLUG, email: PARENT.email, action: 'grant' })
    t = await state()
    check('the owner can grant (comp) access', res.status === 200 && t.academy_enrollments.find((e: any) => e.user_id === parentId)?.status === 'active')
    await octx.close()
    const nctx = await browser.newContext()
    const np = await nctx.newPage()
    await signIn(np, OTHER)
    await np.waitForURL(/\/(dashboard|subscribe|onboarding)/, { timeout: 60000 })
    check('a non-owner cannot use the admin enrollment API', (await status(np, `/api/academy/admin/enrollments?course=${SLUG}`)) === 404)
    await nctx.close()
  }

  // ── 7. Not on sale / draft ──
  {
    await fetch(`${FIX}/rest/v1/academy_courses?id=eq.${COURSE_ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ price_cents: null, stripe_price_id: null }) })
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${APP}/academy/${SLUG}`, { waitUntil: 'networkidle' })
    check('a course without a price cannot be bought', (await page.getByTestId('buy-disabled').count()) > 0 && (await page.getByTestId('buy').count()) === 0)
    await fetch(`${FIX}/rest/v1/academy_courses?id=eq.${COURSE_ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'draft' }) })
    const r = await page.goto(`${APP}/academy/${SLUG}`)
    check('a draft course is not public', r?.status() === 404)
    await page.goto(`${APP}/academy`, { waitUntil: 'networkidle' })
    check('...and not in the catalog', (await page.getByTestId('course-card').count()) === 0)
    await ctx.close()
  }

  const t = await state()
  check('Academy analytics were recorded without personal data', t.user_events.some((e: any) => e.event_name === 'academy_landing_view') && t.user_events.every((e: any) => !JSON.stringify(e.metadata || {}).includes('@')))
  check('no coach subscription changed during the whole run', t.coaches.filter((c: any) => c.is_subscribed).length === 1)

  writeFileSync(path.join(OUT, 'results.txt'), lines.join('\n') + '\n')
  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
