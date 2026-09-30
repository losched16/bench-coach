// Captures the development-plan screenshot used on the leagues page
// (public/screenshots/league-development-plan.png).
//
// The REAL plan page renders it; only its data is synthetic. The one API call
// the page makes for the plan (GET /api/player-pathways/[id]) is answered with
// a sample player on the real Throwing Development pathway — the stage text
// comes from scripts/fixtures/development-pathways.ts and the two drills from
// the drill library as published. No real player, coach or team appears.
//
// Run it against the browser harness (fixture Supabase + a dev server), e.g.:
//
//   node scripts/browser/fixture-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
//   SUPABASE_SERVICE_ROLE_KEY=fixture-service-key npx next dev -p 3100 &
//   npx tsx scripts/browser/capture-league-screens.ts

import { chromium } from 'playwright'
import { PATHWAYS } from '../fixtures/development-pathways'

const APP = process.env.APP_URL || 'http://127.0.0.1:3100'
const FIXTURE = process.env.FIXTURE_URL || 'http://127.0.0.1:54321'
const OUT = process.env.OUT || 'public/screenshots/league-development-plan.png'

const USER = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'
const PLAYER = '33333333-3333-4333-8333-333333333333'
const PROGRESS = '55555555-5555-4555-8555-555555555555'
const PATHWAY_ID = '66666666-6666-4666-8666-666666666666'
const COACH = 'coach-1'

const spec = PATHWAYS.find(p => p.slug === 'throwing-development')!
const stageId = (key: string) => `stage-${key}`
const stages = spec.stages.map((s, i) => ({
  id: stageId(s.key), pathway_id: PATHWAY_ID, stage_number: i + 1, stage_key: s.key, name: s.name,
  objective: s.objective, why_it_matters: s.whyItMatters,
  prerequisite_stage_id: i > 0 ? stageId(spec.stages[i - 1].key) : null,
  mastery_signals: s.masterySignals, common_failure_modes: s.commonFailureModes,
  coaching_emphasis: s.coachingEmphasis || null,
  estimated_practices_min: s.practicesMin ?? null, estimated_practices_max: s.practicesMax ?? null, notes: null,
}))
const CURRENT = 'direction'
const current = stages.find(s => s.stage_key === CURRENT)!

// Two drills the pathway attaches to this stage, as the library publishes them.
const drill = (id: string, d: Record<string, any>) => ({
  id, space_required: 'Small', indoor_outdoor: 'Both', requires_partner: true, min_players: null,
  ideal_group_size: null, age_range: '6-10', difficulty_level: 'Beginner', reps_guidance: null,
  regression_notes: null, progression_notes: null, common_flaws_fixed: null, safety_notes: null, media: [], ...d,
})
const drillPool = {
  'drill-point-and-go': drill('drill-point-and-go', {
    drill_name: 'Point-and-Go Glove Drill — Align Your Body to the Target', est_duration_minutes: 5,
    equipment_needed: ['Baseball', 'glove'],
    description: 'Players point their glove elbow directly at their target before and during the throw. This simple point-and-go system automatically aligns the hips, shoulders, and chest toward the target, dramatically improving direction and accuracy for all age groups.',
    ai_coaching_notes: 'Point your glove at your target, then throw. Your glove arm shows your body where to go.',
    success_markers: ['Glove elbow points at the target before the arm comes through', 'Chest finishes facing the target rather than falling off to the side'],
  }),
  'drill-simple-progressions': drill('drill-simple-progressions', {
    drill_name: 'Simple Throwing Progressions', est_duration_minutes: 8, space_required: 'Medium',
    equipment_needed: ['baseballs'],
    description: 'A deliberately short throwing sequence: grip the ball across four seams, point the glove at the target, step and throw. Partners work at twenty feet and do a set of ten throws at each step.',
    ai_coaching_notes: 'Resist adding a fourth thing. If the throws are going sideways, it is almost always the step or the glove.',
    success_markers: ['Four-seam grip appears without the coach asking for it', 'Throws are noticeably straighter by the third set'],
  }),
}
const stageDrills = {
  [CURRENT]: [
    { id: 'drill-point-and-go', role: 'primary', step: 'teach', rationale: 'The glove arm as the aiming device, which aligns hips, shoulders and chest in one movement a young player can copy.' },
    { id: 'drill-simple-progressions', role: 'reinforcement', step: 'reps', rationale: 'Two of its three steps — point the glove, step at the target — are this stage, so it doubles as a low-effort refresher.' },
  ],
}

const day = (d: string) => `2026-${d}T17:30:00Z`
let n = 0
const ev = (type: string, date: string, extra: Record<string, any> = {}) => ({
  id: `ev-${++n}`, progress_id: PROGRESS, team_id: TEAM, event_type: type,
  stage_key: CURRENT, stage_number: current.stage_number, from_stage_key: null, to_stage_key: null,
  detail: {}, note: null, actor_user_id: USER, occurred_on: date.slice(0, 10), created_at: day(date.slice(5)), ...extra,
})
const events = [
  ev('enrolled', '2026-09-08', { stage_key: 'grip-and-release', stage_number: 1 }),
  ev('advanced', '2026-09-15', { from_stage_key: 'arm-action', to_stage_key: CURRENT }),
  ev('note', '2026-09-16', { note: 'Throws sailing wide to the arm side. Front foot is landing across his body.' }),
  ev('session_logged', '2026-09-18', { detail: { minutes: 75, drill_ids: ['drill-point-and-go'], practice_plan_id: 'plan-1' } }),
  ev('session_logged', '2026-09-23', { detail: { minutes: 60, drill_ids: ['drill-point-and-go', 'drill-simple-progressions'], practice_plan_id: 'plan-2' } }),
  ev('mastery_recorded', '2026-09-23', { detail: { signals: ['Glove elbow points at the target before the arm comes through'] } }),
  ev('note', '2026-09-25', { note: 'Assistant at the throwing station: straighter when he points the glove first. Still falls off to the side on longer throws.' }),
  ev('session_logged', '2026-09-27', { detail: { minutes: 75, drill_ids: ['drill-point-and-go'], practice_plan_id: 'plan-3' } }),
].reverse()

const detail = {
  progress: {
    id: PROGRESS, player_id: PLAYER, team_id: TEAM, pathway_id: PATHWAY_ID, pathway_version: 1,
    current_stage_key: CURRENT, current_stage_number: current.stage_number, status: 'active',
    started_at: day('09-08'), stage_started_at: day('09-15'), completed_at: null,
    pathway: { slug: spec.slug, name: spec.name, skill_category: spec.skillCategory, version: 1 },
  },
  player: { id: PLAYER, name: 'Sam Carter' },
  events,
  pathway: {
    slug: spec.slug, name: spec.name, skill_category: spec.skillCategory, stages,
    drillCounts: Object.fromEntries(spec.stages.map(s => [s.key, s.drills.length])),
  },
  drillPool, stageDrills, stageMissing: false,
}

async function main() {
  const team = { id: TEAM, coach_id: COACH, name: 'Sample Tigers 10U', age_group: '10U', skill_level: 'Intermediate', workspace_kind: 'team' }
  await fetch(`${FIXTURE}/__fixture/reset`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tables: {
        coaches: [{ id: COACH, user_id: USER, is_subscribed: true, display_name: 'Sample Coach' }],
        teams: [team], team_members: [],
        team_players: [{ id: 'tp-1', team_id: TEAM, player_id: PLAYER, player: { name: 'Sam Carter', jersey_number: '7' } }],
        players: [{ id: PLAYER, name: 'Sam Carter', jersey_number: '7' }],
        user_ui_prefs: [], practice_plans: [], team_notes: [],
      },
    }),
  })

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1.5 })
  await context.route(/\/api\/me(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ role: 'owner', can: { read: true, ask: true, record: true, decide: true, remember: true, own: true }, label: 'owner' }) }))
  await context.route(/\/api\/entitlements/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ tier: 'coach', label: 'Coach', ai: true, teamFeatures: true, limits: { maxTeams: 5, maxPersonalPlayers: 5 },
      usage: { teams: 1, personalPlayers: 0 }, workspaces: [{ id: TEAM, name: team.name, kind: 'team' }],
      can: { addTeam: true, addPersonalPlayer: true }, purchasable: {}, plans: [] }) }))
  await context.route(/\/api\/track/, r => r.fulfill({ status: 200, body: '{}' }))
  await context.route(/\/api\/metrics/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ metrics: [], types: [] }) }))
  await context.route(new RegExp(`/api/player-pathways/${PROGRESS}(\\?|$)`), r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }))

  const page = await context.newPage()
  await page.goto(`${APP}/auth/login`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => { const f = document.querySelector('form'); return !!f && !!Object.keys(f).find(k => k.startsWith('__reactProps')) }, { timeout: 30000 })
  await page.fill('input[type="email"]', 'coach@example.test')
  await page.fill('input[type="password"]', 'fixture-password')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard/, { timeout: 30000 })

  await page.goto(`${APP}/dashboard/roster/${PLAYER}/development/${PROGRESS}?teamId=${TEAM}`, { waitUntil: 'networkidle' })
  await page.getByText(current.name).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  // From the stage card down to the coaches' notes: the stage, what good looks
  // like, the drills and the staff's observations. The app header, the long
  // history and the empty measurements card are left out.
  const top = await page.getByText(`Stage ${current.stage_number} of ${stages.length}`).first().boundingBox()
  const end = await page.getByText('The whole plan').first().boundingBox()
  if (!top || !end) throw new Error('could not find the plan sections to crop to')
  const vw = page.viewportSize()!.width
  await page.screenshot({ path: OUT, fullPage: true, clip: { x: 0, y: top.y - 36, width: vw, height: end.y - top.y + 8 } })
  console.log(`wrote ${OUT}`)
  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
