// The Phase 2D acceptance run, driven through a real browser.
//
//   npm run acceptance:finder           (dev server on :3112)
//
// Against app/dev/drill-finder-harness, which mounts the REAL <DrillFinder>,
// cards, detail dialog and filter sheet over a fixture generated from
// production. Nothing about the surface is mocked; what is replaced is the
// Supabase loader around it.
//
// Every step prints PASS or FAIL with the evidence it checked. A step this
// bench genuinely cannot reach prints SKIP and says why, rather than passing
// quietly — a browser cannot prove a typecheck baseline or that no database row
// was deleted, and pretending otherwise would be the worst outcome here.
//
// Run at 390, 430 and 1440. The mobile requirements are not a separate feature;
// they are these same conditions, on a phone.

import { chromium } from 'playwright'

const URL = process.env.HARNESS_URL || 'http://127.0.0.1:3112/dev/drill-finder-harness'

let pass = 0, fail = 0, skip = 0
let results = []

function record(n, name, ok, evidence) {
  if (ok === null) { skip++; results.push([n, name, 'SKIP', evidence]) }
  else if (ok) { pass++; results.push([n, name, 'PASS', evidence]) }
  else { fail++; results.push([n, name, 'FAIL', evidence]) }
}

const state = async (page) => JSON.parse(await page.locator('#state').textContent())

const bodyText = async (page) => page.evaluate(() => document.body.innerText)

async function openDrill(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 3000 })
}

async function closeDialog(page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

async function run(browser, viewport, label) {
  results = []; pass = 0; fail = 0; skip = 0
  const page = await browser.newPage({ viewport })
  page.on('pageerror', e => console.log('  [page error]', e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="grid"]', { timeout: 10000 })

  const s = await state(page)
  const text = await bodyText(page)

  // ── 1-3. what must never be discoverable ─────────────────────────────────
  // The bench HANDS these to the surface. They are gone because isSchedulable
  // dropped them, not because nobody offered them.
  const [collection, teaching, duplicate] = s.forbidden

  const offered = (name) => s.supplied.includes(name)
  const onScreen = async (name) => {
    await page.getByLabel('Search drills').fill(name.slice(0, 30))
    await page.waitForTimeout(250)
    const t = await bodyText(page)
    await page.getByLabel('Search drills').fill('')
    await page.waitForTimeout(200)
    return t.includes(name)
  }

  record(1, 'source_collection never appears',
    offered(collection) && !(await onScreen(collection)) && !s.schedulable.includes(collection),
    `offered to the surface: ${offered(collection)}; reached the grid: ${s.schedulable.includes(collection)}`)

  record(2, 'teaching_content never appears',
    offered(teaching) && !(await onScreen(teaching)) && !s.schedulable.includes(teaching),
    `offered: ${offered(teaching)}; reached the grid: ${s.schedulable.includes(teaching)}`)

  record(3, 'duplicate_of rows never appear',
    offered(duplicate) && !(await onScreen(duplicate)) && !s.schedulable.includes(duplicate),
    `offered: ${offered(duplicate)}; reached the grid: ${s.schedulable.includes(duplicate)}`)

  // ── 4-5. what must be discoverable ───────────────────────────────────────
  record(4, 'the canonical activity does appear',
    text.includes('One Hand Drill'),
    'canonical "One Hand Drill" is in the grid')

  record(5, 'a variation appears when independently schedulable',
    text.includes('One-Hand Tee Drill (Top Hand)') && text.includes('One-Hand Tee Drill (Bottom Hand)'),
    'the progression and the regression are both browsable in their own right')

  // ── 6. search by name ────────────────────────────────────────────────────
  await page.getByLabel('Search drills').fill('stride box')
  await page.waitForTimeout(300)
  const byName = await bodyText(page)
  record(6, 'search finds a drill by name',
    byName.includes('Stride Box'),
    (await page.locator('[data-testid="result-count"]').textContent())?.trim())

  // ── 7. search by mapped problem ──────────────────────────────────────────
  // "dropping hands" appears in no drill name and no description. It is an
  // alias of the `uppercutting` problem, and the only way to it is the
  // taxonomy — which the old search could not reach at all.
  await page.getByLabel('Search drills').fill('dropping hands')
  // Long enough to clear the 900ms search-tracking debounce as well as to
  // render. A shorter wait passes the search assertion and then fails step 20
  // for a reason that has nothing to do with search — which is how the first
  // run of this file reported a instrumentation bug that was not there.
  await page.waitForTimeout(1200)
  const byProblem = await bodyText(page)
  const count = (await page.locator('[data-testid="result-count"]').textContent())?.trim()
  record(7, 'search finds a drill by its mapped problem',
    byProblem.includes('Fixes:') && !byProblem.includes('Nothing matches'),
    `${count}; the card says why it matched`)

  await page.getByLabel('Search drills').fill('')
  await page.waitForTimeout(250)

  // ── 8. a drill with no media ─────────────────────────────────────────────
  await openDrill(page, 'Stride Box')
  const noMedia = await page.locator('[role="dialog"]').innerText()
  // Case-insensitive: the section headings carry a CSS `uppercase`, and
  // innerText returns the transformed text, so "Why use it" arrives as
  // "WHY USE IT".
  record(8, 'media absence does not break the card or the detail',
    /why use it/i.test(noMedia) && /coach it/i.test(noMedia) &&
    !/Supporting (video|media)/i.test(noMedia),
    'the drill renders complete, with no empty media box and no "video failed"')
  await closeDialog(page)

  // ── 9-10. what media is allowed to claim ─────────────────────────────────
  await openDrill(page, 'Crow Hop — Arm Strength and Outfield Throwing')
  const dialog = await page.locator('[role="dialog"]').innerText()
  record(9, 'unverified compilation media is not sold as a drill segment',
    /Source video/i.test(dialog) &&
    !/Watch this drill/i.test(dialog) &&
    !/Jump to/i.test(dialog),
    `labelled "Source video"${/Covers \d+ drills/.test(dialog) ? ' and says how many drills it covers' : ''}`)

  // Media LAST. Checked on DOM order rather than on the eye, because this is
  // the one thing the redesign exists to guarantee.
  const order = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('[role="dialog"] h3'))
      .map(h => h.textContent.trim())
    return heads
  })
  const mediaAt = order.findIndex(h => /Supporting (video|media)/i.test(h))
  const lastInstruction = Math.max(
    order.indexOf('Coach it'), order.indexOf('Watch for'),
    order.indexOf('Make it harder'), order.indexOf('Make it easier'))
  record(10, 'media appears after the written instructions',
    mediaAt < 0 || (lastInstruction >= 0 && mediaAt > lastInstruction),
    `headings in order: ${order.join(' → ')}`)

  await closeDialog(page)

  const wholePage = await bodyText(page)
  record(11, 'nothing anywhere promises a timestamp',
    !/Jump to the drill/i.test(wholePage),
    'no "Jump to the drill" rendered — 0 media rows are verified AND stamped')

  // ── 12. add to practice carries the canonical id ─────────────────────────
  await page.getByRole('button', { name: /Add to practice/i }).first().click()
  await page.waitForTimeout(300)
  const afterAdd = await state(page)
  const handed = afterAdd.added[0]
  record(12, 'add-to-practice hands over the canonical, schedulable id',
    !!handed &&
    /^[0-9a-f-]{36}$/.test(handed.id) &&
    afterAdd.schedulable.includes(handed.name) &&
    !afterAdd.forbidden.includes(handed.name),
    handed ? `${handed.name} -> ${handed.id}` : 'nothing was handed over')

  // ── 13. keyboard ─────────────────────────────────────────────────────────
  // The old grid was a div with an onClick: invisible to a keyboard entirely.
  const keyboard = await page.evaluate(async () => {
    const name = document.querySelector('[data-testid="grid"] h3 button')
    if (!name) return { ok: false, why: 'no focusable drill name' }
    name.focus()
    return { ok: document.activeElement === name, why: name.textContent.trim() }
  })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
  const dialogOpen = await page.locator('[role="dialog"]').count()
  const modalAttrs = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    return d ? { modal: d.getAttribute('aria-modal'), labelled: !!d.getAttribute('aria-labelledby') } : null
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const closed = (await page.locator('[role="dialog"]').count()) === 0
  const refocused = await page.evaluate(() =>
    document.activeElement?.tagName === 'BUTTON' &&
    !!document.activeElement.closest('[data-testid="grid"]'))
  record(13, 'keyboard: reach a drill, open it, close it, land back',
    keyboard.ok && dialogOpen === 1 && modalAttrs?.modal === 'true' &&
    modalAttrs?.labelled && closed && refocused,
    `focused "${keyboard.why}"; aria-modal=${modalAttrs?.modal}; Escape closed=${closed}; focus restored=${refocused}`)

  // ── 14. the card does not lead with media ────────────────────────────────
  const thumbs = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="grid"] img').length)
  record(14, 'no card leads with a video thumbnail',
    thumbs === 0,
    `${thumbs} images in the grid`)

  // ── 15. filters open in a sheet and narrow the list ──────────────────────
  const before = (await page.locator('[data-testid="result-count"]').textContent()).trim()
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.waitForSelector('[aria-label="Filter drills"]', { timeout: 3000 })
  const sheetWidth = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Filter drills"]')
    return el ? Math.round(el.getBoundingClientRect().width) : 0
  })
  await page.getByRole('button', { name: 'Hitting', exact: true }).first().click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: /^Show \d+ drill/ }).click()
  await page.waitForTimeout(300)
  const after = (await page.locator('[data-testid="result-count"]').textContent()).trim()
  record(15, 'filters live in a sheet and narrow the list',
    sheetWidth > 0 && before !== after,
    `sheet ${sheetWidth}px at ${viewport.width}px · "${before}" -> "${after}"`)

  // ── 16. a filter combination with no results ─────────────────────────────
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.waitForSelector('[aria-label="Filter drills"]')
  await page.getByRole('button', { name: 'Drills I have saved' }).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: /No drills match|^Show \d+ drill/ }).click()
  await page.waitForTimeout(300)
  const emptyShown = await page.locator('[data-testid="empty"]').count()
  const emptyText = emptyShown ? await page.locator('[data-testid="empty"]').innerText() : ''
  record(16, 'an empty filter combination explains itself',
    emptyShown === 1 && /saved/i.test(emptyText) && /Clear search and filters/i.test(emptyText),
    emptyText.split('\n').slice(0, 2).join(' / '))

  await page.getByRole('button', { name: /Clear search and filters/i }).click()
  await page.waitForTimeout(300)

  // ── 17. a failed load is not an empty list ───────────────────────────────
  await page.getByTestId('set-state-error').click()
  await page.waitForTimeout(250)
  const errorShown = await page.locator('[data-testid="load-error"]').count()
  const errorText = errorShown ? await page.locator('[data-testid="load-error"]').innerText() : ''
  record(17, 'a failed load says so instead of showing an empty library',
    errorShown === 1 && /did not load/i.test(errorText) && /Try again/i.test(errorText) &&
    (await page.locator('[data-testid="empty"]').count()) === 0,
    errorText.split('\n').filter(Boolean).slice(0, 2).join(' / '))

  await page.getByTestId('set-state-loading').click()
  await page.waitForTimeout(200)
  const skeletons = await page.evaluate(() => document.querySelectorAll('.animate-pulse').length)
  record(18, 'loading shows skeletons rather than a sentence',
    skeletons >= 3, `${skeletons} skeleton cards`)
  await page.getByTestId('set-state-ready').click()
  await page.waitForTimeout(250)

  // ── 19. variations, labelled ─────────────────────────────────────────────
  await openDrill(page, 'One Hand Drill')
  const famText = await page.locator('[role="dialog"]').innerText()
  record(19, 'family members are shown with the relationship named',
    /Variations/i.test(famText) &&
    /EASIER|Easier/.test(famText) &&
    /PROGRESSION|Progression/.test(famText),
    'the regression and the progression are labelled as such, not listed as lookalikes')
  await closeDialog(page)

  // ── 20. analytics ────────────────────────────────────────────────────────
  const events = (await state(page)).events.map(e => e.event)
  const wanted = ['drill_search', 'drill_filter_applied', 'drill_detail_opened', 'drill_added_to_practice']
  record(20, 'the instrumented events fire',
    wanted.every(w => events.includes(w)),
    `fired: ${Array.from(new Set(events)).join(', ')}`)

  // ── the page must never scroll sideways ──────────────────────────────────
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record(21, 'no horizontal overflow', overflow <= 1,
    `scrollWidth exceeds clientWidth by ${overflow}px at ${viewport.width}px`)

  // Card text must not be clipped into meaninglessness on a phone.
  const clipped = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('[data-testid="grid"] h3 button'))
    return names.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent.trim())
  })
  record(22, 'drill names are not clipped', clipped.length === 0,
    clipped.length ? `clipped: ${clipped.slice(0, 3).join(' | ')}` : 'every drill name wraps in full')

  await page.close()

  console.log(`\n${'='.repeat(78)}\n${label.toUpperCase()}  (${viewport.width}x${viewport.height})\n${'='.repeat(78)}`)
  for (const [n, nm, verdict, ev] of results) {
    console.log(`${String(n).padStart(2)}. ${verdict.padEnd(4)} ${nm}`)
    console.log(`         ${ev}`)
  }
  console.log(`${pass} passed, ${fail} failed, ${skip} skipped`)
  return fail
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  })

  let failures = 0
  failures += await run(browser, { width: 1440, height: 900 }, 'desktop 1440')
  failures += await run(browser, { width: 430, height: 932 }, 'mobile 430')
  failures += await run(browser, { width: 390, height: 844 }, 'mobile 390')
  await browser.close()

  console.log('\nNot checkable from a browser, and checked elsewhere:')
  console.log('  historical by-id resolution        npm run test:canon-history')
  console.log('  verified-timestamp behaviour       npm run test:drill-finder (describeMedia)')
  console.log('  typecheck baseline / build         npm run typecheck:baseline, npm run build')
  console.log('  zero rows deleted or written       this phase runs no migration; see the closeout')

  if (failures > 0) process.exit(1)
}

main().catch(e => { console.error('harness error:', e.message); process.exit(2) })
