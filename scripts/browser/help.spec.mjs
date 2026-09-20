// Phase 2I closeout — the help and onboarding surfaces, in a real browser.
//
//   npm run test:browser
//
// WHAT THIS PROVES AND WHAT IT DOES NOT
//
// Real Chromium, real Next.js, real React, the real components. What is NOT
// real is the backend: Supabase is scripts/browser/fixture-supabase.mjs, an
// in-memory stand-in this process owns, and /api/me is stubbed per-case to
// choose a role. So every result below is a statement about THE APP'S OWN
// BEHAVIOUR — focus handling, dismissal persistence, layout, what renders when
// a query fails — and none of it is a statement about production data,
// production RLS, or production auth.
//
// Authentication is not bypassed. Each case signs in through the real login
// page and gets a real session cookie written by the real Supabase client;
// the real middleware then decides whether the dashboard renders.
//
// The two together are the point: the unit suites check the rules, this checks
// that a browser actually does them.

import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://127.0.0.1:3100'
const FIXTURE = process.env.FIXTURE_URL || 'http://127.0.0.1:54321'

const TEAM = '22222222-2222-4222-8222-222222222222'
const PLAYER = '33333333-3333-4333-8333-333333333333'
const USER = '11111111-1111-4111-8111-111111111111'

let passed = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

// ── fixture control ────────────────────────────────────────────────────────

const COACH = 'coach-1'
// coach_id is what the sidebar filters teams by; without it the layout decides
// this coach has no teams and sends them to /onboarding.
const team = {
  id: TEAM, coach_id: COACH, name: 'Wildcats 9U', age_group: '9U',
  workspace_kind: 'team', season: null, created_at: '2026-01-01T00:00:00Z',
}

async function seed({ players = 0, plans = 0, prefs = [], failing = {} } = {}) {
  const body = {
    failing,
    tables: {
      // The dashboard layout sends anyone without a subscribed coach row to
      // /onboarding, so this row is the price of reaching the page at all.
      coaches: [{ id: COACH, user_id: USER, is_subscribed: true }],
      teams: [team],
      team_members: [],
      team_players: Array.from({ length: players }, (_, i) => ({
        id: `p${i}`, team_id: TEAM, name: `Player ${i}`,
      })),
      practice_plans: Array.from({ length: plans }, (_, i) => ({
        id: `plan${i}`, team_id: TEAM, name: `Practice ${i}`,
        created_at: '2026-09-01T00:00:00Z',
      })),
      team_notes: [],
      user_ui_prefs: prefs,
    },
  }
  const r = await fetch(`${FIXTURE}/__fixture/reset`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('could not reset the fixture')
}

async function fixtureState() {
  return (await fetch(`${FIXTURE}/__fixture/state`)).json()
}

// ── a signed-in page ───────────────────────────────────────────────────────

async function signedIn(browser, { role = 'owner', viewport } = {}) {
  const context = await browser.newContext(
    viewport ? { viewport } : { viewport: { width: 1440, height: 900 } })

  // Registered on the CONTEXT, before any page exists, and matched with a
  // regex. A '**/api/me*' glob silently fails to match a URL with a query
  // string, which made every role case quietly run as the default owner —
  // a passing-looking test that tested nothing.
  //
  // The role comes from /api/me, which reads real staff rows server-side.
  // Stubbing it here is how a case picks a role; it is called out in the
  // report as mocked rather than integrated.
  await context.route(/\/api\/me(\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      role,
      can: {
        read: true, ask: true,
        record: role !== 'viewer',
        decide: role === 'owner' || role === 'admin',
        remember: role === 'owner' || role === 'admin',
        own: role === 'owner',
      },
      label: role,
    }),
  }))
  // Billing. The fixture has no Stripe, so a coach would land on the upgrade
  // wall instead of the practice builder. Entitlement behaviour is not what
  // this suite is about, so it is stubbed to "paid" and said so in the report.
  await context.route(/\/api\/entitlements/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      tier: 'coach', label: 'Coach',
      ai: true, teamFeatures: true,
      limits: { maxTeams: 5, maxPersonalPlayers: 5 },
      usage: { teams: 1, personalPlayers: 0 },
      workspaces: [{ id: TEAM, name: 'Wildcats 9U', kind: 'team' }],
      can: { addTeam: true, addPersonalPlayer: true },
      purchasable: {}, plans: [],
    }),
  }))

  // Telemetry has nowhere to go here and its failures are noisy.
  await context.route(/\/api\/track/, route => route.fulfill({ status: 200, body: '{}' }))

  const page = await context.newPage()

  await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
  // Clicking before React hydrates submits the form natively, which reloads
  // the login page with an empty query string and looks exactly like a failed
  // sign-in. Wait for the handler to be attached.
  await page.waitForFunction(() => {
    const f = document.querySelector('form')
    return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps'))
  }, { timeout: 15000 })
  await page.fill('input[type="email"]', 'coach@example.test')
  await page.fill('input[type="password"]', 'fixture-password')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
  return { context, page }
}

// The panel slides in. Measuring geometry mid-flight reports whatever the
// animation happened to be doing, so wait for it to land first.
async function settle(locator) {
  await locator.evaluate(el => Promise.all(
    el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))))
}

const dash = p => `${APP}/dashboard?teamId=${TEAM}`
const help = (qs = '') => `${APP}/dashboard/help?teamId=${TEAM}${qs}`

// ── the run ────────────────────────────────────────────────────────────────

// This machine ships a Chromium build that does not match the revision the
// installed playwright package expects, and there is no network to fetch the
// matching one. Pointing at the one that is here is the difference between
// browser evidence and another "could not be verified" line in the report.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
})
const errors = []

try {
  // ══ 1. THE CHECKLIST ════════════════════════════════════════════════════
  console.log('\nThe first-practice checklist')

  {
    // A brand new coach: no roster, no plans.
    await seed({ players: 0, plans: 0 })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    const list = page.getByTestId('first-practice-checklist')
    check('a new coach with no roster sees the checklist', await list.isVisible())
    check('the roster step is marked optional, because the builder works without one',
      (await list.textContent()).includes('Optional'))
    check('it names the real save control rather than "Save"',
      (await list.textContent()).includes('Use this plan'))
    eq('and onboarding_started is recorded once',
      (await fixtureState()).tables.user_ui_prefs.length, 1)
    await context.close()
  }

  {
    // The failure case that started this closeout: the roster count errors.
    await seed({ players: 0, plans: 0, failing: { team_players: 500 } })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('A FAILED ROSTER COUNT HIDES THE CHECKLIST rather than reading as zero',
      !(await page.getByTestId('first-practice-checklist').isVisible()))
    eq('and nothing at all is recorded about onboarding',
      (await fixtureState()).tables.user_ui_prefs.length, 0)
    await context.close()
  }

  {
    await seed({ players: 3, plans: 0, failing: { practice_plans: 500 } })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('a failed plan count hides it too',
      !(await page.getByTestId('first-practice-checklist').isVisible()))
    await context.close()
  }

  {
    // An established coach. Nothing to onboard.
    await seed({ players: 12, plans: 4 })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('a coach who already has plans is not shown a get-started checklist',
      !(await page.getByTestId('first-practice-checklist').isVisible()))
    eq('and is not counted as a new coach',
      (await fixtureState()).tables.user_ui_prefs.length, 0)
    await context.close()
  }

  {
    // A contributor cannot create plans, so is not offered the checklist.
    await seed({ players: 0, plans: 0 })
    const { context, page } = await signedIn(browser, { role: 'contributor' })
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('an assistant coach is not offered a checklist they cannot complete',
      !(await page.getByTestId('first-practice-checklist').isVisible()))
    await context.close()
  }

  // ══ 2. DISMISSAL, RELOAD, REOPEN ════════════════════════════════════════
  console.log('\nDismissing and getting it back')

  {
    await seed({ players: 0, plans: 0 })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Skip this' }).click()
    check('skipping hides it immediately',
      !(await page.getByTestId('first-practice-checklist').isVisible()))

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('AND IT STAYS HIDDEN ACROSS A RELOAD — the preference round-tripped',
      !(await page.getByTestId('first-practice-checklist').isVisible()))

    await page.goto(help(), { waitUntil: 'networkidle' })
    const resume = page.getByTestId('resume-onboarding')
    check('the Help Center offers a way back', await resume.isVisible())
    eq('and the button says so', (await resume.textContent()).trim(), 'Show it again')
    await resume.click()
    await page.waitForURL(/\/dashboard\?/, { timeout: 10000 })
    await page.waitForTimeout(800)
    check('REOPENING BRINGS IT BACK',
      await page.getByTestId('first-practice-checklist').isVisible())

    const prefs = (await fixtureState()).tables.user_ui_prefs
    const v = prefs[0]?.value || {}
    check('reopening did not invent completion',
      !v.completedAt, JSON.stringify(v))
    await context.close()
  }

  {
    // A coach who finished long ago asks to see it again.
    await seed({
      players: 9, plans: 2,
      prefs: [{
        user_id: USER, key: 'onboarding.first-practice',
        value: { startedAt: 't0', completedAt: 't1' },
      }],
    })
    const { context, page } = await signedIn(browser)
    await page.goto(help(), { waitUntil: 'networkidle' })
    const resume = page.getByTestId('resume-onboarding')
    check('a finished coach is told they already have a plan',
      (await resume.locator('..').textContent()).includes('already saved a practice plan'))
    await resume.click()
    await page.waitForURL(/\/dashboard\?/, { timeout: 10000 })
    await page.waitForTimeout(800)
    const list = page.getByTestId('first-practice-checklist')
    check('reopening shows it, already done', await list.isVisible())
    check('and says so honestly',
      (await list.textContent()).includes('You have your first practice plan'))
    const v = (await fixtureState()).tables.user_ui_prefs[0].value
    eq('the original completion timestamp is untouched, so it is not counted twice',
      v.completedAt, 't1')
    await context.close()
  }

  {
    // Account change on a shared phone: the second coach must not inherit the
    // first coach's dismissal. This is the thing RLS cannot prove.
    await seed({
      players: 0, plans: 0,
      prefs: [{
        user_id: 'someone-else', key: 'onboarding.first-practice',
        value: { skipped: true },
      }],
    })
    const { context, page } = await signedIn(browser)
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check('ANOTHER ACCOUNT\'S DISMISSAL IS NOT INHERITED',
      await page.getByTestId('first-practice-checklist').isVisible())
    await context.close()
  }

  // ══ 3. THE HELP PANEL ═══════════════════════════════════════════════════
  console.log('\nThe help panel')

  {
    await seed({ players: 5, plans: 1 })
    const { context, page } = await signedIn(browser)
    await page.goto(`${APP}/dashboard/roster?teamId=${TEAM}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)

    const opener = page.getByRole('button', { name: /How to use this|Show me how/ }).first()
    check('there is an in-page way into the guide', await opener.isVisible())
    await opener.focus()
    await opener.press('Enter')

    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    check('it opens a dialog', await dialog.isVisible())
    eq('marked modal for a screen reader',
      await dialog.getAttribute('aria-modal'), 'true')
    check('and labelled by its own heading',
      !!(await dialog.getAttribute('aria-labelledby')))

    check('FOCUS MOVES INTO THE PANEL',
      await dialog.evaluate(d => d.contains(document.activeElement)))

    // Tab all the way round and confirm we never escape the panel.
    let escaped = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      if (!await dialog.evaluate(d => d.contains(document.activeElement))) {
        escaped = true; break
      }
    }
    check('TAB IS TRAPPED — thirty presses never leave it', !escaped)

    escaped = false
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Shift+Tab')
      if (!await dialog.evaluate(d => d.contains(document.activeElement))) {
        escaped = true; break
      }
    }
    check('and shift-tab is trapped backwards too', !escaped)

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })
    check('ESCAPE CLOSES IT', !(await dialog.isVisible()))
    check('AND FOCUS GOES BACK TO WHAT OPENED IT',
      await opener.evaluate(b => b === document.activeElement))
    await context.close()
  }

  {
    // THE REASON THE PANEL IS NOT A ROUTE: it must not take the page down
    // with it, so nothing a coach has half-done is lost by reading the help.
    //
    // Checked by NODE IDENTITY rather than by typing into a field, for a
    // reason worth recording: on both integrated surfaces the only free-text
    // forms live inside modals — the practice builder, Add Player — that
    // cover the help button, so there is no inline input a coach could be
    // typing into while the help entry point is reachable. Marking a live DOM
    // node and finding the same node afterwards proves the stronger thing
    // anyway: React did not remount the page, so no page state was lost,
    // form fields included.
    await seed({ players: 5, plans: 1 })
    const { context, page } = await signedIn(browser)
    await page.goto(`${APP}/dashboard/practice?teamId=${TEAM}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    const opener = page.getByRole('button', { name: /How to use this|Show me how/ }).first()
    await opener.waitFor({ state: 'visible', timeout: 15000 })

    // Mark every heading on the page. A remount recreates these nodes and the
    // marks go with them.
    const marked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('h1, h2, h3'))
      els.forEach(el => { el.setAttribute('data-survived-help', 'yes') })
      return els.length
    })
    check('the practice page rendered something to mark', marked > 0)

    await opener.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    eq('the page behind the panel is still the same live document',
      await page.locator('[data-survived-help]').count(), marked)

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })
    eq('OPENING AND CLOSING HELP DOES NOT REMOUNT THE PAGE — every marked ' +
      'node survived, so nothing held in the page was lost',
      await page.locator('[data-survived-help]').count(), marked)
    await context.close()
  }

  {
    // Dismissing the first-use card leaves the guide reachable forever after.
    await seed({ players: 5, plans: 1 })
    const { context, page } = await signedIn(browser)
    await page.goto(`${APP}/dashboard/roster?teamId=${TEAM}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const dismiss = page.getByRole('button', { name: 'Dismiss this tip' }).first()
    if (await dismiss.count() > 0) {
      await dismiss.click()
      await page.waitForTimeout(400)
      check('dismissing the card leaves a "How to use this" button behind',
        await page.getByRole('button', { name: 'How to use this' }).first().isVisible())
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(700)
      check('and the card stays dismissed after a reload',
        !(await page.getByText('Dismiss this tip').count()))
    } else {
      check('a first-use card was present to dismiss', false, 'card not found')
    }
    await context.close()
  }

  // ══ 4. DEEP LINKS, HISTORY, CONTEXT ═════════════════════════════════════
  console.log('\nArticles, history and context')

  {
    await seed({ players: 5, plans: 1 })
    const { context, page } = await signedIn(browser)

    await page.goto(help('&article=roster'), { waitUntil: 'networkidle' })
    check('a deep-linked article opens directly',
      (await page.locator('h1').textContent()).length > 0)

    await page.goto(help(`&playerId=${PLAYER}&article=player-development`),
      { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)

    const action = page.getByRole('link', { name: 'Open this player' }).first()
    check('an article opened from a player offers that player',
      await action.count() > 0)
    check('and the action points at that player, not back at the roster',
      (await action.getAttribute('href')).includes(PLAYER))

    // The "Related" list, by position rather than by title, so renaming a
    // guide does not silently turn this case into a no-op.
    const related = page.locator('section', { hasText: 'Related' })
      .last().getByRole('link').first()
    check('the article offers related reading', await related.count() > 0)
    const relatedHref = await related.getAttribute('href')
    check('THE PLAYER IS ALREADY IN THE RELATED LINK',
      relatedHref.includes(`playerId=${PLAYER}`), relatedHref)

    await related.click()
    await page.waitForTimeout(800)
    check('AND SURVIVES THE HOP TO THAT ARTICLE',
      page.url().includes(`playerId=${PLAYER}`), page.url())

    await page.goBack({ waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    check('BROWSER BACK RETURNS TO THE PREVIOUS ARTICLE',
      page.url().includes('article=player-development'), page.url())
    check('still carrying the player', page.url().includes(`playerId=${PLAYER}`))
    await page.goForward({ waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    check('and forward returns to the related one',
      page.url().includes('article=') &&
      !page.url().includes('article=player-development'), page.url())

    await page.goto(help(), { waitUntil: 'networkidle' })
    await page.fill('input[type="search"]', 'screenshot')
    await page.waitForTimeout(400)
    check('searching a word that is in no title still finds the article',
      (await page.locator('button:has-text("Roster")').count()) > 0)

    await page.fill('input[type="search"]', 'qwertyuiop')
    await page.waitForTimeout(400)
    check('a hopeless search offers a way out rather than a dead end',
      await page.getByRole('button', { name: 'Clear the search' }).isVisible())

    const body = await page.locator('body').textContent()
    check('and the page invents no support address',
      !/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body || ''))
    await context.close()
  }

  // ══ 5. LAYOUT ═══════════════════════════════════════════════════════════
  console.log('\nLayout')

  for (const [label, viewport] of [
    ['375px (iPhone SE)', { width: 375, height: 667 }],
    ['430px (iPhone Pro Max)', { width: 430, height: 932 }],
    ['1440px (laptop)', { width: 1440, height: 900 }],
  ]) {
    await seed({ players: 0, plans: 0 })
    const { context, page } = await signedIn(browser, { viewport })
    await page.goto(dash(), { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`no sideways scroll on the dashboard at ${label}`, overflow <= 1,
      `overflows by ${overflow}px`)

    await page.goto(`${APP}/dashboard/roster?teamId=${TEAM}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const opener = page.getByRole('button', { name: /How to use this|Show me how/ }).first()
    if (await opener.count() > 0) {
      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ state: 'visible', timeout: 5000 })
      await settle(dialog)
      const box = await dialog.boundingBox()
      check(`the help panel fits the viewport at ${label}`,
        box && box.width <= viewport.width + 1,
        `panel ${box?.width}px in a ${viewport.width}px window`)
      // Width alone is not enough. A full-width panel that starts at x=160 is
      // still half off the screen with its text cut down the middle, and the
      // width check passes happily.
      check(`the help panel starts on screen at ${label}`,
        box && box.x >= -1, `panel starts at x=${box?.x}`)
      check(`AND ITS RIGHT EDGE IS ON SCREEN at ${label}`,
        box && box.x + box.width <= viewport.width + 1,
        `panel spans ${box?.x}..${Math.round((box?.x || 0) + (box?.width || 0))} ` +
        `in a ${viewport.width}px window — text is cut off`)
      // Nothing inside it may be clipped either.
      const clipped = await dialog.evaluate((el, vw) => {
        const bad = []
        for (const n of Array.from(el.querySelectorAll('h2, h3, p, li, a, button'))) {
          const r = n.getBoundingClientRect()
          if (r.width > 0 && r.right > vw + 1) {
            bad.push(`${n.tagName}:${Math.round(r.right)} "${(n.textContent || '').trim().slice(0, 28)}"`)
          }
        }
        return bad.slice(0, 3)
      }, viewport.width)
      check(`no text inside the panel runs off the screen at ${label}`,
        clipped.length === 0, clipped.join(' | '))
      const panelOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check(`and opening it causes no sideways scroll at ${label}`, panelOverflow <= 1,
        `overflows by ${panelOverflow}px`)
      await page.screenshot({
        path: `docs/audits/phase2i-${viewport.width}px.png`, fullPage: false,
      })
    }
    await context.close()
  }
} catch (e) {
  errors.push(e)
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (errors.length) {
  console.log('\nThe run itself broke:')
  for (const e of errors) console.log(`  ${e.stack || e}`)
}
if (failures.length || errors.length) {
  if (failures.length) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  ✗ ${f}`)
  }
  process.exit(1)
}
console.log(`
Real browser, real app, fixture backend. Not covered: production data,
production RLS, and whether the prose reads well to a coach.
`)
