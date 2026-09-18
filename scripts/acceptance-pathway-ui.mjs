// Phase 2G browser acceptance — the pathway picker in a real browser.
//
//   npm run accept:pathway-ui
//
// Drives app/dev/pathway-harness, which mounts the REAL <PathwayPicker> and
// <PathwayContextCard> over a fixture. The component, the stage navigation,
// the focused-stage wording and the DOM are the ones that ship; only the data
// loader is replaced.
//
// Run at 1440, 430 and 390. The mobile requirements are not a separate feature;
// they are the same conditions, on a phone, one-handed.
//
// WHAT THIS CANNOT DO
//
// It cannot prove the picker renders on heydelco… on mybenchcoach.com behind a
// login. That gap is named in the closeout rather than papered over.

import { chromium } from 'playwright'

const BASE = process.env.HARNESS_URL || 'http://127.0.0.1:3113/dev/pathway-harness'

let pass = 0, fail = 0
const results = []
const record = (n, name, ok, evidence) => {
  if (ok) { pass++; results.push([n, name, 'PASS', evidence]) }
  else { fail++; results.push([n, name, 'FAIL', evidence]) }
}

const state = async (page) => JSON.parse(await page.locator('#state').textContent())
const bodyText = async (page) => page.evaluate(() => document.body.innerText)

async function open(page, scenario = 'ok') {
  await page.goto(`${BASE}?scenario=${scenario}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#state', { timeout: 5000 })
}

async function run(browser, viewport, label) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()

  // ── 1-3. open, see pathways, choose one ───────────────────────────────────
  await open(page)
  let txt = await bodyText(page)
  record(1, `${label}: the pathway option is offered`,
    /Working on something specific/i.test(txt), 'picker heading present')

  record(2, `${label}: published pathways are listed with summary and stage count`,
    /Build the Swing/.test(txt) && /10 stages/.test(txt) && /hitting/i.test(txt),
    'name, category and stage count all render')

  await page.getByRole('button', { name: /Build the Swing/ }).first().click()
  await page.waitForTimeout(200)
  let s = await state(page)
  record(3, `${label}: choosing Build the Swing selects it and lands on stage 1`,
    s.slug === 'build-the-swing' && s.stageNumber === 1, `stage ${s.stageNumber}`)

  // ── 4-6. stage, objective, mastery signals ────────────────────────────────
  txt = await bodyText(page)
  record(4, `${label}: the stage heading reads "Stage 1 of 10"`,
    /Stage 1 of 10/.test(txt), 'heading present')
  record(5, `${label}: the stage objective renders`,
    /Create a repeatable/i.test(txt), 'objective present')
  record(6, `${label}: mastery signals render`,
    /controlled weight shift/i.test(txt) && /head stays quiet/i.test(txt),
    'both signals present')

  // ── 7-8. next and previous ────────────────────────────────────────────────
  await page.getByRole('button', { name: /^Next stage:/ }).click()
  await page.waitForTimeout(150)
  s = await state(page)
  record(7, `${label}: next moves to stage 2`,
    s.stageNumber === 2 && s.stageKey === 'grip', `stage ${s.stageNumber} (${s.stageKey})`)

  await page.getByRole('button', { name: /^Previous stage:/ }).click()
  await page.waitForTimeout(150)
  s = await state(page)
  record(8, `${label}: previous moves back to stage 1`,
    s.stageNumber === 1, `stage ${s.stageNumber}`)

  // ── the ends: no invented next stage ──────────────────────────────────────
  record(9, `${label}: previous is disabled on the first stage`,
    await page.getByRole('button', { name: 'No previous stage' }).isDisabled(),
    'disabled at stage 1')

  await page.locator('#pathway-stage-jump').selectOption('10')
  await page.waitForTimeout(150)
  s = await state(page)
  record(10, `${label}: jumping straight to a stage works`,
    s.stageNumber === 10, `stage ${s.stageNumber}`)
  record(11, `${label}: NEXT IS DISABLED ON THE FINAL STAGE — no invented stage 11`,
    await page.getByRole('button', { name: 'No next stage' }).isDisabled(),
    'disabled at stage 10')

  // ── 2G.4 a focused stage is usable and is not called THIN ─────────────────
  await page.locator('#pathway-stage-jump').selectOption('2')
  await page.waitForTimeout(150)
  txt = await bodyText(page)
  s = await state(page)
  record(12, `${label}: a one-drill stage says "Focused stage" and stays usable`,
    s.drillCount === 1 && /Focused stage/.test(txt) && /short, sharp block/.test(txt),
    `${s.drillCount} drill`)
  record(13, `${label}: internal curation words never reach the screen`,
    !/\bTHIN\b|\bREADY\b|\bGAP\b/.test(txt), 'no THIN/READY/GAP in the DOM')

  await page.locator('#pathway-stage-jump').selectOption('1')
  await page.waitForTimeout(150)
  txt = await bodyText(page)
  record(14, `${label}: a three-drill stage carries no badge`,
    !/Focused stage/.test(txt), 'no badge at 3 drills')

  // ── analytics ─────────────────────────────────────────────────────────────
  s = await state(page)
  const names = s.events.map(e => e.event)
  record(15, `${label}: selection and stage changes are tracked`,
    names.includes('pathway_selected') && names.includes('pathway_stage_selected'),
    names.join(', '))
  const sel = s.events.find(e => e.event === 'pathway_stage_selected')
  record(16, `${label}: stage events carry slug, number and key — and no names`,
    !!sel && sel.metadata.pathway_slug === 'build-the-swing' &&
    typeof sel.metadata.stage_number === 'number' && !!sel.metadata.stage_key &&
    !JSON.stringify(sel.metadata).match(/player|email|name"\s*:\s*"[A-Z]/),
    JSON.stringify(sel?.metadata))

  // ── clearing returns to normal planning ───────────────────────────────────
  await page.getByRole('button', { name: /Clear/ }).click()
  await page.waitForTimeout(150)
  s = await state(page)
  txt = await bodyText(page)
  record(17, `${label}: clearing the pathway returns to the unselected picker`,
    s.slug === null && s.stageNumber === null && /Working on something specific/i.test(txt),
    'back to the list')

  // ── 2G.13 keyboard ────────────────────────────────────────────────────────
  await open(page)
  // Tab until the first pathway button has focus, then choose it with the
  // keyboard alone. A picker a coach cannot reach without a mouse is not done.
  let focusedName = ''
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    focusedName = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 40) || '')
    if (/Build the Swing/.test(focusedName)) break
  }
  const reached = /Build the Swing/.test(focusedName)
  if (reached) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
  }
  s = await state(page)
  record(18, `${label}: the picker is operable by keyboard alone`,
    reached && s.slug === 'build-the-swing', `focused "${focusedName}"`)

  const visibleFocus = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return false
    const st = getComputedStyle(el)
    return st.outlineStyle !== 'none' || !!st.boxShadow
  })
  record(19, `${label}: the focused control is visibly focused`, visibleFocus, 'outline or ring')

  // ── 2G.11 failure states ──────────────────────────────────────────────────
  await open(page, 'list-error')
  txt = await bodyText(page)
  record(20, `${label}: a failed load says it failed and does not claim emptiness`,
    /Couldn't load|Couldn’t load/.test(txt) && !/No development pathways are published/.test(txt),
    'error copy, not empty copy')
  record(21, `${label}: a failed load still offers normal planning and a retry`,
    /still build the practice normally/i.test(txt) && /Try again/.test(txt),
    'both present')

  await open(page, 'no-pathways')
  txt = await bodyText(page)
  record(22, `${label}: genuinely no pathways reads differently from a failure`,
    /No development pathways are published/.test(txt) && !/Couldn't load|Couldn’t load/.test(txt),
    'empty copy, not error copy')

  await open(page, 'stage-error')
  await page.getByRole('button', { name: /Build the Swing/ }).first().click()
  await page.waitForTimeout(200)
  txt = await bodyText(page)
  record(23, `${label}: stages failing to load is reported on the chosen pathway`,
    /Couldn't load the stages|Couldn’t load the stages/.test(txt), 'stage error copy')

  await open(page)
  await page.getByRole('button', { name: /Empty Pathway/ }).first().click()
  await page.waitForTimeout(200)
  txt = await bodyText(page)
  record(24, `${label}: a pathway with no stages says so and offers a way out`,
    /no stages yet/i.test(txt) && /build normally/i.test(txt), 'empty-stage copy')

  // ── the generated-plan context card ───────────────────────────────────────
  await open(page, 'context')
  txt = await bodyText(page)
  record(25, `${label}: the generated plan shows the development focus`,
    /Development focus/i.test(txt) && /Build the Swing/.test(txt) &&
    /4 of 10/.test(txt) && /Front foot lands/.test(txt),
    'pathway, stage and objective all render')

  await open(page, 'context-warning')
  txt = await bodyText(page)
  record(26, `${label}: a zero-feasible warning is shown, not swallowed`,
    /can run in the space you have/i.test(txt), 'warning rendered')

  await open(page, 'context-none')
  const slotText = (await page.locator('#context-slot').textContent()).trim()
  record(27, `${label}: a plan built with NO pathway renders no context card at all`,
    slotText === '', `slot contained "${slotText.slice(0, 40)}"`)

  // ── 2G.14 mobile ──────────────────────────────────────────────────────────
  await open(page)
  await page.getByRole('button', { name: /Build the Swing/ }).first().click()
  await page.waitForTimeout(200)
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record(28, `${label}: no horizontal scrolling`, overflow <= 0, `${overflow}px overflow`)

  const tap = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, select'))
      .filter(e => e.getBoundingClientRect().height > 0)
    const small = els.filter(e => e.getBoundingClientRect().height < 32)
    return { total: els.length, small: small.length,
             names: small.map(e => (e.textContent || '').trim().slice(0, 20)) }
  })
  record(29, `${label}: tap targets are at least 32px tall`,
    tap.small === 0, `${tap.small} of ${tap.total} too short: ${tap.names.join(', ')}`)

  const clipped = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('p, button, option'))
    return els.filter(e => e.scrollWidth > e.clientWidth + 1)
      .map(e => (e.textContent || '').trim().slice(0, 30))
  })
  record(30, `${label}: no pathway or stage name is clipped`,
    clipped.length === 0, clipped.join(' | ') || 'none clipped')

  await ctx.close()
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})
for (const [vp, label] of [
  [{ width: 1440, height: 900 }, '1440'],
  [{ width: 430, height: 932 }, ' 430'],
  [{ width: 390, height: 844 }, ' 390'],
]) {
  await run(browser, vp, label)
}
await browser.close()

for (const [n, name, verdict, evidence] of results) {
  console.log(`${verdict === 'PASS' ? ' PASS' : ' FAIL'}  ${String(n).padStart(2)}. ${name.padEnd(74)} ${evidence}`)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
