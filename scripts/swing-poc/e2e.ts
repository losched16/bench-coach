// Swing mechanics POC — end-to-end proof in a real browser.
//
//   bash scripts/swing-poc/run-e2e.sh
//
// Real: the Next.js routes and pages, lib/authz.ts, the private store, the
// Python worker, MediaPipe on every frame, the canvas overlay and the 3D view.
// Stand-ins: the database (scripts/browser/fixture-supabase.mjs, seeded with a
// synthetic coach, team, player and two library drills) and the video — the
// synthetic fixture built from MediaPipe's public test image, NOT a swing.
// This proves the pipeline and the sync; it validates no swing mechanic.

import { chromium, type Page } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://127.0.0.1:3100'
const FIX = process.env.FIXTURE_URL || 'http://127.0.0.1:54321'
const OUT = process.env.OUT || 'analyzer/out/e2e'
const VIDEO = process.env.VIDEO || 'analyzer/fixtures/moving.mp4'
const CONTACT_FRAME = Number(process.env.CONTACT_FRAME || 50)

const COACH = { id: '11111111-1111-4111-8111-111111111111', email: 'coach@example.test', password: 'fixture-password' }
const OTHER = { id: '99999999-9999-4999-8999-999999999999', email: 'other@example.test', password: 'fixture-password' }
const TEAM = '22222222-2222-4222-8222-222222222222'
const TEAM_B = '88888888-8888-4888-8888-888888888888'
const PLAYER = '33333333-3333-4333-8333-333333333333'

let failures = 0
const results: string[] = []
function check(label: string, ok: boolean, detail = '') {
  const line = `${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`
  console.log(line)
  results.push(line)
  if (!ok) failures++
}

async function reset() {
  const drill = (id: string, name: string, video: string | null) => ({
    id, drill_name: name, description: `${name} (synthetic library row for the POC test)`, skill_category: 'Hitting',
    created_by_coach_id: null, resource_kind: 'activity', duplicate_of_drill_id: null, status: 'approved',
    youtube_video_id: video, youtube_url: video ? `https://www.youtube.com/watch?v=${video}` : null,
  })
  await fetch(`${FIX}/__fixture/reset`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      users: {
        [COACH.email]: COACH,
        [OTHER.email]: OTHER,
      },
      tables: {
        coaches: [
          { id: 'coach-1', user_id: COACH.id, is_subscribed: true, display_name: 'Sample Coach' },
          { id: 'coach-2', user_id: OTHER.id, is_subscribed: true, display_name: 'Other Coach' },
        ],
        teams: [
          { id: TEAM, coach_id: 'coach-1', name: 'Sample Tigers 10U', age_group: '10U', workspace_kind: 'team' },
          { id: TEAM_B, coach_id: 'coach-2', name: 'Other Hawks', age_group: '10U', workspace_kind: 'team' },
        ],
        team_members: [],
        team_players: [{ id: 'tp-1', team_id: TEAM, player_id: PLAYER, player: { name: 'Sam Carter', jersey_number: '7' } }],
        players: [{ id: PLAYER, name: 'Sam Carter', jersey_number: '7', coach_id: 'coach-1' }],
        problem_taxonomy: [
          { slug: 'stepping-in-bucket', label: 'Steps in the bucket', skill_category: 'Hitting', aliases: [] },
          { slug: 'lunging', label: 'Lunging / poor balance', skill_category: 'Hitting', aliases: [] },
        ],
        drill_resources: [drill('d-stride', 'Stride Line Drill', 'AAAAAAAAAA1'), drill('d-balance', 'Balance Stride Drill', null)],
        drill_problem_map: [
          { drill_id: 'd-stride', problem_slug: 'stepping-in-bucket', curated: true, sort_order: 1 },
          { drill_id: 'd-balance', problem_slug: 'lunging', curated: true, sort_order: 1 },
        ],
        user_ui_prefs: [], practice_plans: [], team_notes: [], player_metrics: [], prescriptions: [],
      },
    }),
  })
}

async function signIn(page: Page, who: typeof COACH) {
  await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, { timeout: 60000 })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard/, { timeout: 60000 })
}

async function stubs(ctx: any) {
  await ctx.route(/\/api\/me(\?|$)/, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner', can: { read: true, ask: true, record: true, decide: true, remember: true, own: true }, label: 'owner' }) }))
  await ctx.route(/\/api\/entitlements/, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'coach', label: 'Coach', ai: true, teamFeatures: true, limits: { maxTeams: 5, maxPersonalPlayers: 5 }, usage: { teams: 1, personalPlayers: 0 }, workspaces: [{ id: TEAM, name: 'Sample Tigers 10U', kind: 'team' }], can: { addTeam: true, addPersonalPlayer: true }, purchasable: {}, plans: [] }) }))
  await ctx.route(/\/api\/track/, (r: any) => r.fulfill({ status: 200, body: '{}' }))
}

async function overlayPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="overlay"]') as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  await reset()
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await stubs(ctx)
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') console.log('  [browser]', m.text().slice(0, 200)) })
  await signIn(page, COACH)

  await page.goto(`${APP}/dashboard/roster/${PLAYER}/swing-poc?teamId=${TEAM}`, { waitUntil: 'networkidle' })
  check('the POC page renders behind the flag', await page.getByText('Swing mechanics (POC)').waitFor({ timeout: 30000 }).then(() => true, () => false))

  const t0 = Date.now()
  await page.setInputFiles('[data-testid="upload-input"]', VIDEO)
  await page.getByTestId('swing-video').waitFor({ timeout: 60000 })
  await page.waitForFunction(() => (document.querySelector('[data-testid="swing-video"]') as HTMLVideoElement)?.readyState >= 2, null, { timeout: 30000 })
  const readout = await page.getByTestId('frame-readout').innerText()
  check('upload is stored privately and frame times are read', /frame 1 \/ \d+/.test(readout), readout)

  // Step to the contact frame with the scrubber, then mark it.
  await page.locator('input[type=range]').fill(String(CONTACT_FRAME))
  await page.waitForFunction((f) => document.querySelector('[data-testid="frame-readout"]')?.textContent?.includes(`frame ${f + 1} /`), CONTACT_FRAME, { timeout: 10000 })
  await page.getByTestId('mark-contact').click()
  await page.getByText(/Contact: .*\(frame \d+\)/).waitFor({ timeout: 10000 })
  check('contact is marked at the chosen frame', await page.getByText(`(frame ${CONTACT_FRAME + 1})`).count() > 0)

  // Analyse: the request returns at once and the page polls.
  const tAnalyze = Date.now()
  await page.getByTestId('analyze').click()
  await page.getByTestId('job-state').filter({ hasText: /Queued|Analysing/ }).waitFor({ timeout: 10000 })
  check('analysis is queued asynchronously (no long request)', Date.now() - tAnalyze < 10000)
  await page.getByTestId('job-state').filter({ hasText: /^(Analysed|Analysis failed)$/ }).waitFor({ timeout: 180000 })
  const analyseMs = Date.now() - tAnalyze
  const state = await page.getByTestId('job-state').innerText()
  const alert = state.includes('failed') ? await page.getByRole('alert').allInnerTexts() : []
  check('the worker analysed the clip', state.trim() === 'Analysed', `${(analyseMs / 1000).toFixed(1)} s from click to result ${alert.join(' | ')}`)
  if (state.trim() !== 'Analysed') { await browser.close(); process.exit(1) }

  const prov = await page.getByTestId('provenance').innerText()
  check('provenance shows model, frames and timing', /mediapipe/.test(prov) && /Analysed:/.test(prov), prov.replace(/\s+/g, ' ').slice(0, 220))

  // Sync: at the contact frame the drawn pose must be the pose for that frame.
  await page.locator('input[type=range]').fill(String(CONTACT_FRAME))
  await page.waitForTimeout(600)
  const ro = await page.getByTestId('frame-readout').innerText()
  const frameT = /· ([\d.]+) s/.exec(ro)?.[1]
  const poseT = /pose @ ([\d.]+) ms/.exec(ro)?.[1]
  check('the drawn pose is the analysed frame on screen', !!poseT && !!frameT && Math.abs(Number(poseT) - Number(frameT) * 1000) < 17, ro)
  const px = await overlayPixels(page)
  check('the skeleton is drawn over the video', px > 200, `${px} painted pixels`)
  await page.screenshot({ path: path.join(OUT, 'review-1440.png'), fullPage: true })
  await page.locator('[data-testid="swing-video"]').screenshot({ path: path.join(OUT, 'overlay-contact.png') })
  await page.getByTestId('pose-3d').screenshot({ path: path.join(OUT, 'pose-3d.png') })

  // Evidence buttons seek to their frame.
  const fs = page.getByTestId('obs-lead_foot_movement').getByRole('button', { name: /foot strike/ })
  if (await fs.count()) {
    const label = await fs.first().innerText()
    await fs.first().click()
    await page.waitForTimeout(500)
    const want = Number(/([\d.]+)s/.exec(label)?.[1])
    const got = await page.evaluate(() => (document.querySelector('[data-testid="swing-video"]') as HTMLVideoElement).currentTime)
    check('an evidence button seeks the video to that frame', Math.abs(got - want) < 0.02, `want ${want}s got ${got.toFixed(3)}s`)
    await page.locator('[data-testid="swing-video"]').screenshot({ path: path.join(OUT, 'overlay-foot-strike.png') })
  } else {
    check('an evidence button seeks the video to that frame', false, 'no foot strike evidence button')
  }

  const hs = await page.getByTestId('obs-hip_shoulder_separation').innerText()
  check('hip–shoulder separation is shown as not assessable, not a number', /Not assessable/.test(hs))
  const all = await page.locator('section').last().innerText()
  const badges = await page.getByTestId('validation-badge').allInnerTexts()
  check('every finding is labelled unvalidated or feasibility-only', badges.length === 3 && badges.every(b => b === 'unvalidated' || b === 'feasibility check'), badges.join(', '))
  check('no score, rating or ideal-swing language', !/\b(score|rating|grade)\s*[:=]?\s*\d|\b(elite|ideal swing|good swing|bad swing)\b/i.test(all))

  // Coach review → drills.
  await page.getByTestId('find-drills').click()
  await page.getByText('Accept or edit a finding first').waitFor({ timeout: 10000 })
  check('no drills are offered before the coach accepts a finding', true)
  await page.getByTestId('accept-lead_foot_movement').click()
  await page.getByTestId('review-lead_foot_movement').filter({ hasText: 'accepted' }).waitFor({ timeout: 10000 })
  check('the coach can accept a finding', true)
  await page.getByTestId('find-drills').click()
  await page.getByTestId('drill-list').waitFor({ timeout: 20000 })
  const list = await page.getByTestId('drill-list').innerText()
  const links = await page.getByTestId('drill-list').locator('a').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).href))
  check('library drills come back for the accepted finding', list.includes('Stride Line Drill'), list.replace(/\s+/g, ' ').slice(0, 160))
  check('every video link is the one stored on the drill row', links.every(h => h === 'https://www.youtube.com/watch?v=AAAAAAAAAA1'), links.join(', '))
  check('"Add to plan" is a proposal and writes nothing', /proposal only/i.test(await page.getByTestId('plan-proposal').innerText()))
  const writes = await (await fetch(`${FIX}/__fixture/state`).catch(() => null))?.json().catch(() => null)
  if (writes?.tables) {
    check('no player measurement, priority or plan row was written',
      (writes.tables.player_metrics || []).length === 0 && (writes.tables.prescriptions || []).length === 0)
  }
  await page.screenshot({ path: path.join(OUT, 'review-accepted-1440.png'), fullPage: true })

  // Coach corrects foot strike → re-analysis uses it.
  await page.locator('input[type=range]').fill('38')
  await page.waitForFunction(() => document.querySelector('[data-testid="frame-readout"]')?.textContent?.includes('frame 39 /'), null, { timeout: 10000 })
  await page.locator('li', { hasText: 'Foot strike' }).getByRole('button', { name: 'Set to this frame' }).click()
  await page.getByText(/re-analyse to use it/).waitFor({ timeout: 10000 })
  check('a coach foot-strike mark is saved and flagged as not yet used', true)
  await page.getByTestId('analyze').click()
  await page.getByText('your mark (used in this analysis)').waitFor({ timeout: 180000 })
  const lf2 = await page.getByTestId('obs-lead_foot_movement').innerText()
  check('re-analysis measures the stride to the coach\'s foot strike', /foot strike \(coach-marked\)/.test(lf2))
  check('a re-analysis clears earlier review decisions', /Your review: pending/.test(lf2))

  // Mobile layout.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  check('no horizontal overflow at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: path.join(OUT, 'review-390.png'), fullPage: true })

  // Cross-team: another coach cannot open the capture, its video, or its list.
  const capId = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="swing-video"]') as HTMLVideoElement
    return /captures\/([0-9a-f-]{36})\/video/.exec(v.src)?.[1] || ''
  })
  const videoSrc = await page.evaluate(() => (document.querySelector('[data-testid="swing-video"]') as HTMLVideoElement).src)
  const other = await browser.newContext()
  await stubs(other)
  const op = await other.newPage()
  await signIn(op, OTHER)
  const st = async (u: string, init?: any) => (await op.evaluate(async ([u, init]) => (await fetch(u as string, init as any)).status, [u, init]))
  check('another team\'s coach gets 404 for the capture', (await st(`/api/swing-poc/captures/${capId}`)) === 404)
  check('...and for its video, even with the signed link', (await st(videoSrc.replace(APP, ''))) === 404)
  check('...and cannot list this player\'s captures', [403, 404].includes(await st(`/api/swing-poc/captures?teamId=${TEAM}&playerId=${PLAYER}`)))
  check('...or review a finding', (await st(`/api/swing-poc/captures/${capId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ findingId: 'forward_move', state: 'rejected' }) })) === 404)
  // The owner's own link, tampered or reused after expiry, fails.
  const tampered = videoSrc.replace(/token=[^&]+/, 'token=9999999999.AAAA')
  check('a tampered video token is refused', (await page.evaluate(async u => (await fetch(u)).status, tampered)) === 403)
  await other.close()

  writeFileSync(path.join(OUT, 'e2e-results.txt'), results.join('\n') + `\n\ntotal ${(Date.now() - t0) / 1000}s\n`)
  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
