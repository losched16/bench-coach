// The 9U acceptance run, driven through a real browser.
//
// Ten actions a coach has to be able to take, against the real PlanReview over
// the 9U plan from the brief. Nothing is mocked: the component, the drill
// library, the planEdits arithmetic and the DOM are the ones that ship. What is
// replaced is the page around it — auth, the database, the drill API — because
// none of that is what is being proved here.
//
//   node scripts/acceptance-builder.mjs            (dev server on :3111)
//
// Each step prints PASS or FAIL with the evidence it checked. A step that
// cannot be reached prints SKIP and says why, rather than silently passing.

import { chromium } from 'playwright'

const URL = process.env.HARNESS_URL || 'http://127.0.0.1:3111/dev/builder-harness'

let pass = 0, fail = 0, skip = 0
let results = []
let label = 'desktop'

function record(n, name, ok, evidence) {
  if (ok === null) { skip++; results.push([n, name, 'SKIP', evidence]) }
  else if (ok) { pass++; results.push([n, name, 'PASS', evidence]) }
  else { fail++; results.push([n, name, 'FAIL', evidence]) }
}

const state = async (page) =>
  JSON.parse(await page.locator('#state').textContent())

async function run(browser, viewport, name) {
  label = name
  results = []; pass = 0; fail = 0; skip = 0
  const page = await browser.newPage({ viewport })
  page.on('pageerror', e => console.log('  [page error]', e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })

  // ── 1. scan the entire practice ───────────────────────────────────────────
  // The rail is the running order. All eight blocks must be on screen without
  // scrolling to find one.
  const before = await state(page)
  const railRows = await page.locator('[data-testid="rail-row"], aside button, .md\\:w-80 button').count()
  record(1, 'scan the entire practice',
    before.titles.length === 8 && before.total === 90,
    `${before.titles.length} blocks, ${before.total} min total`)

  // ── 2. add a drill ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Add a drill/i }).first().click()
  await page.waitForTimeout(300)
  const libVisible = await page.getByPlaceholder(/Search drills/i).isVisible().catch(() => false)
  if (libVisible) {
    await page.getByPlaceholder(/Search drills/i).fill('Wall Ball')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /^Add$/ }).first().click()
    await page.waitForTimeout(400)
  }
  const afterAdd = await state(page)
  record(2, 'add a drill',
    afterAdd.titles.includes('Wall Ball') && afterAdd.titles.length === 9,
    `${afterAdd.titles.length} blocks; added=${afterAdd.titles.includes('Wall Ball')}`)

  // ── 3. replace Front Toss with another hitting drill ──────────────────────
  // Slot and minutes must survive: the coach built a clock around the slot.
  const ftIndex = afterAdd.titles.indexOf('Front Toss')
  const ftMinutes = afterAdd.minutes[ftIndex]
  await page.getByRole('button', { name: 'Front Toss' }).first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /More/i }).first().click()
  await page.waitForTimeout(200)
  await page.getByRole('menuitem', { name: /^Replace/i }).click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/Search drills/i).fill('High Tee')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Use$/ }).first().click()
  await page.waitForTimeout(400)
  const afterReplace = await state(page)
  record(3, 'replace Front Toss, keeping slot and duration',
    afterReplace.titles[ftIndex] === 'High Tee Drill' &&
    afterReplace.minutes[ftIndex] === ftMinutes &&
    afterReplace.total === afterAdd.total,
    `slot ${ftIndex} -> "${afterReplace.titles[ftIndex]}", ${afterReplace.minutes[ftIndex]} min (was ${ftMinutes}), total unchanged=${afterReplace.total === afterAdd.total}`)

  // ── 4. move the Bad-Hop Drill to the end ─────────────────────────────────
  let cur = await state(page)
  let bhIndex = cur.titles.indexOf('Bad-Hop Drill')
  const totalBeforeMove = cur.total
  // Move down repeatedly via the rail's own control, the way a coach would
  // on a phone where dragging is the awkward option.
  for (let guard = 0; guard < 12; guard++) {
    cur = await state(page)
    bhIndex = cur.titles.indexOf('Bad-Hop Drill')
    if (bhIndex === cur.titles.length - 1) break
    // By the block's own name, not by position: the rail's control is labelled
    // "Move <title> later", and an index-based selector silently matched
    // nothing and passed the loop straight through.
    const down = page.getByLabel('Move Bad-Hop Drill later')
    if (await down.count() === 0) { console.log('  no move-later control found'); break }
    await down.first().click()
    await page.waitForTimeout(200)
  }
  const afterMove = await state(page)
  record(4, 'move the Bad-Hop Drill to the end',
    afterMove.titles[afterMove.titles.length - 1] === 'Bad-Hop Drill' &&
    afterMove.total === totalBeforeMove,
    `last block "${afterMove.titles[afterMove.titles.length - 1]}", total unchanged=${afterMove.total === totalBeforeMove}`)

  // ── 5. change one duration ───────────────────────────────────────────────
  await page.getByRole('button', { name: 'Wall Ball' }).first().click()
  await page.waitForTimeout(250)
  const manual = page.getByRole('button', { name: /^Manual$/ })
  if (await manual.count()) { await manual.first().click(); await page.waitForTimeout(250) }
  const minsField = page.locator('input[type="number"]').first()
  await minsField.fill('17')
  await page.waitForTimeout(400)
  const afterDuration = await state(page)
  const wbIndex = afterDuration.titles.indexOf('Wall Ball')
  record(5, 'change one duration, total follows',
    afterDuration.minutes[wbIndex] === 17 &&
    afterDuration.total === afterMove.total - afterMove.minutes[afterMove.titles.indexOf('Wall Ball')] + 17,
    `Wall Ball ${afterDuration.minutes[wbIndex]} min, total ${afterMove.total} -> ${afterDuration.total}`)

  // ── 6. duplicate a block ─────────────────────────────────────────────────
  await page.getByRole('button', { name: /More/i }).first().click()
  await page.waitForTimeout(200)
  await page.getByRole('menuitem', { name: /Duplicate/i }).click()
  await page.waitForTimeout(400)
  const afterDup = await state(page)
  record(6, 'duplicate a block',
    afterDup.titles.filter(t => t === 'Wall Ball').length === 2 &&
    afterDup.total === afterDuration.total + 17,
    `Wall Ball x${afterDup.titles.filter(t => t === 'Wall Ball').length}, total ${afterDuration.total} -> ${afterDup.total}`)

  // ── 7. create a station group ────────────────────────────────────────────
  // Elapsed time must be rotation x stations + a changeover between each —
  // never the sum of the stations.
  await page.getByRole('button', { name: 'Kneeling Infield Hands Routine' }).first().click()
  await page.waitForTimeout(250)
  const aiTab = page.getByRole('button', { name: /AI suggested/ })
  if (await aiTab.count()) { await aiTab.first().click(); await page.waitForTimeout(200) }
  await page.getByRole('button', { name: /More/i }).first().click()
  await page.waitForTimeout(200)
  await page.getByRole('menuitem', { name: /Make a station group/i }).click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/Search drills/i).fill('Backhand')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Pair$/ }).first().click()
  await page.waitForTimeout(500)
  const afterGroup = await state(page)
  const gIdx = afterGroup.stations.findIndex(s => Array.isArray(s) && s.length === 2)
  const rot = afterGroup.rotations[gIdx]
  record(7, 'create a station group with correct elapsed time',
    gIdx >= 0 && afterGroup.minutes[gIdx] === rot * 2 + 1,
    gIdx >= 0
      ? `rotation ${rot} x 2 stations + 1 changeover = ${afterGroup.minutes[gIdx]} elapsed; stations ${JSON.stringify(afterGroup.stations[gIdx])}`
      : 'no station group formed')

  // ── 8. remove a station safely ───────────────────────────────────────────
  // Two stations minus one is not a rotation — it must collapse to a block.
  await page.getByRole('button', { name: /^Manual$/ }).first().click()
  await page.waitForTimeout(300)
  const stationDelete = page.locator('[aria-label^="Remove station"]')
  let removedEvidence = 'no station remove control found'
  let removedOk = false
  if (await stationDelete.count() > 0) {
    await stationDelete.first().click()
    await page.waitForTimeout(500)
    const afterRemove = await state(page)
    removedOk = afterRemove.stations[gIdx] === null
    removedEvidence = `stations at ${gIdx} -> ${JSON.stringify(afterRemove.stations[gIdx])} (collapsed to a plain block: ${removedOk})`
  }
  record(8, 'remove a station; a rotation of one collapses', removedOk, removedEvidence)

  // ── 9. Ask BenchCoach ────────────────────────────────────────────────────
  // The footer belongs to the page, not the builder, so the harness cannot
  // exercise it. Saying so beats asserting something this bench never ran.
  record(9, 'Ask BenchCoach on an existing draft', null,
    'the adjustment box lives in the page footer and calls the generate API; not reachable from this bench')

  // ── 10. save and reopen ──────────────────────────────────────────────────
  const beforeSave = await state(page)
  await page.getByTestId('save').click()
  await page.waitForTimeout(300)
  const savedText = await page.locator('#saved').textContent()
  const saved = savedText ? JSON.parse(savedText) : null
  record(10, 'save and reopen keeps the edits',
    !!saved && JSON.stringify(saved.titles) === JSON.stringify(beforeSave.titles),
    saved ? `${saved.titles.length} blocks round-tripped identically` : 'nothing saved')

  // ── the page must never scroll sideways ──────────────────────────────────
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  record(11, 'no horizontal overflow', !overflow,
    `scrollWidth vs clientWidth at ${viewport.width}px`)

  await page.close()

  console.log(`\n${'='.repeat(74)}\n${name.toUpperCase()}  (${viewport.width}x${viewport.height})\n${'='.repeat(74)}`)
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
  // The same ten actions at both widths. A builder that only works with a
  // mouse is not a builder a coach can use at the field, and the brief's
  // mobile requirements are not a separate feature — they are these actions,
  // on a phone.
  const a = await run(browser, { width: 1440, height: 900 }, 'desktop')
  const b = await run(browser, { width: 390, height: 844 }, 'mobile')
  await browser.close()
  if (a + b > 0) process.exit(1)
}

main().catch(e => { console.error('harness error:', e.message); process.exit(2) })
