// Phase 2H — the rules a coach's decisions are made under.
//
//   npm run test:player-pathways
//
// lib/playerPathways.ts is pure, so every guard can be asserted without a
// database. What needs a database — that RLS actually stops a contributor
// advancing a player — is scripts/test-migration-2h.sh, and it is not faked
// here.
//
// The two that matter most are the version-drift tests and the measurement
// direction tests. Every pathway in production is v1 today, so the stale-stage
// path CANNOT be exercised by real data; if it is not tested here it is not
// tested at all. And a sprint time that improves goes DOWN, so a summary that
// gets direction wrong turns every improvement into a regression on a child's
// page.

import {
  resolveStage, coachDecisions, validateMove, sessionCounts, checkedSignals,
  daysSince, describeDuration, describeEvent, summariseMeasurement,
  summariseSpeedMeasurements, formatChange, measurementsRecorded,
  staleStageMessage, SPEED_METRIC_SLUGS, planOutline, practiceRange,
  PlayerPathwayProgress, PlayerPathwayEvent,
} from '../lib/playerPathways'
import type { LoadedPathway, PathwayStage, Pathway } from '../lib/developmentPathways'
import type { MetricType, MetricReading } from '../lib/metrics'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

// ── fixtures ────────────────────────────────────────────────────────────────

const stage = (n: number, key: string, name: string): PathwayStage => ({
  id: `s-${key}`, pathway_id: 'p1', stage_number: n, stage_key: key, name,
  objective: `Does ${key}.`, mastery_signals: [`${key} holds`, `${key} repeats`],
  common_failure_modes: [], why_it_matters: null, coaching_emphasis: null,
} as any)

const P: LoadedPathway = {
  pathway: { id: 'p1', slug: 'speed-and-agility-development', name: 'Speed & Agility Development',
    skill_category: 'athleticism', status: 'published', version: 1 } as Pathway,
  stages: [
    stage(1, 'baseline-and-mechanics', 'Baseline & Running Mechanics'),
    stage(2, 'acceleration-position', 'Acceleration Position'),
    stage(3, 'first-step-explosion', 'First-Step Explosion'),
  ],
  linksByStage: new Map(),
  problemsByStage: new Map(),
}

const progress = (over: Partial<PlayerPathwayProgress> = {}): PlayerPathwayProgress => ({
  id: 'pp1', player_id: 'pl1', team_id: 't1', pathway_id: 'p1', pathway_version: 1,
  current_stage_key: 'acceleration-position', current_stage_number: 2,
  status: 'active', started_at: '2026-01-01T00:00:00Z', stage_started_at: '2026-01-10T00:00:00Z',
  completed_at: null, created_by: 'u1', ...over,
})

const ev = (over: Partial<PlayerPathwayEvent>): PlayerPathwayEvent => ({
  id: 'e', progress_id: 'pp1', event_type: 'session_logged', stage_key: 'acceleration-position',
  stage_number: 2, from_stage_key: null, to_stage_key: null, detail: {}, note: null,
  actor_user_id: 'u1', occurred_on: '2026-02-01', created_at: '2026-02-01T00:00:00Z', ...over,
})

// ── resolving a stage ───────────────────────────────────────────────────────

const r = resolveStage(P, progress())
check('a live stage resolves', r.ok && r.stage.stage_key === 'acceleration-position')
eq('and knows how many stages there are', r.total, 3)
eq('no pathway resolves to no_pathway',
  resolveStage(null, progress()), { ok: false, reason: 'no_pathway', total: 0 })
eq('no enrollment resolves to no_pathway',
  resolveStage(P, null), { ok: false, reason: 'no_pathway', total: 0 })
eq('a pathway with no stages says so',
  resolveStage({ ...P, stages: [] }, progress()), { ok: false, reason: 'no_stages', total: 0 })

// THE VERSION-DRIFT CASE. Every production pathway is v1, so this can only ever
// be tested here.
eq('a stage key the pathway no longer has does NOT silently become stage 1',
  resolveStage(P, progress({ current_stage_key: 'a-stage-that-was-removed' })),
  { ok: false, reason: 'stage_gone', total: 3 })
check('and the coach is told what happened, in words',
  /updated since this player started/.test(staleStageMessage('Speed & Agility Development')) &&
  /history is kept/.test(staleStageMessage('Speed & Agility Development')))

// ── the decisions a coach is offered ────────────────────────────────────────

const mid = coachDecisions(P, progress())
eq('a middle stage can advance', mid.advance?.stage.stage_key, 'first-step-explosion')
eq('and the button names where it goes', mid.advance?.label,
  'Advance to Stage 3 — First-Step Explosion')
eq('a middle stage can go back', mid.regress?.stage.stage_key, 'baseline-and-mechanics')
eq('and that button names where it goes too', mid.regress?.label,
  'Go back to Stage 1 — Baseline & Running Mechanics')
check('a middle stage cannot complete the pathway', mid.canComplete === false)

const first = coachDecisions(P, progress({ current_stage_key: 'baseline-and-mechanics', current_stage_number: 1 }))
eq('THE FIRST STAGE CANNOT GO BACK', first.regress, null)
check('the first stage can still advance', first.advance !== null)

const last = coachDecisions(P, progress({ current_stage_key: 'first-step-explosion', current_stage_number: 3 }))
eq('THE FINAL STAGE CANNOT ADVANCE', last.advance, null)
check('the final stage is where completing lives', last.canComplete === true)
check('the final stage can still go back', last.regress !== null)

const done = coachDecisions(P, progress({ status: 'completed', completed_at: '2026-03-01T00:00:00Z' }))
eq('a completed plan offers no moves', [done.advance, done.regress, done.canComplete],
  [null, null, false])
check('and says it is completed', done.isCompleted === true)

eq('a stale stage key offers no moves at all',
  coachDecisions(P, progress({ current_stage_key: 'gone' })),
  { advance: null, regress: null, canComplete: false, isCompleted: false })

// ── the guard the route runs, which is the one that counts ──────────────────

check('advancing from the middle is allowed',
  validateMove(P, progress(), 'advance', 'first-step-explosion').ok)
check('advancing past the final stage is refused',
  !validateMove(P, progress({ current_stage_key: 'first-step-explosion' }), 'advance').ok)
check('and says why', /final stage/.test(
  (validateMove(P, progress({ current_stage_key: 'first-step-explosion' }), 'advance') as any).error))
check('regressing before the first stage is refused',
  !validateMove(P, progress({ current_stage_key: 'baseline-and-mechanics' }), 'regress').ok)
check('and says why', /first stage/.test(
  (validateMove(P, progress({ current_stage_key: 'baseline-and-mechanics' }), 'regress') as any).error))

// A stale tab is the realistic attack on this, not a malicious one.
check('a move that disagrees with the server is refused rather than guessed at',
  !validateMove(P, progress(), 'advance', 'baseline-and-mechanics').ok)
check('and tells the coach to reload', /[Rr]eload/.test(
  (validateMove(P, progress(), 'advance', 'baseline-and-mechanics') as any).error))

check('completing is only allowed from the final stage',
  !validateMove(P, progress(), 'complete').ok &&
  validateMove(P, progress({ current_stage_key: 'first-step-explosion' }), 'complete').ok)
check('nothing may be changed on a completed plan',
  !validateMove(P, progress({ status: 'completed', completed_at: 'x' }), 'advance').ok &&
  !validateMove(P, progress({ status: 'completed', completed_at: 'x' }), 'complete').ok &&
  !validateMove(P, progress({ status: 'completed', completed_at: 'x' }), 'pause').ok)
check('a paused plan may be resumed and not re-paused',
  validateMove(P, progress({ status: 'paused' }), 'resume').ok &&
  !validateMove(P, progress({ status: 'paused' }), 'pause').ok)
check('an active plan may not be resumed',
  !validateMove(P, progress(), 'resume').ok)
check('nothing can be moved without an enrollment',
  !validateMove(P, null, 'advance').ok)
check('nothing can be moved without a pathway',
  !validateMove(null, progress(), 'advance').ok)

// ── history ─────────────────────────────────────────────────────────────────

const events: PlayerPathwayEvent[] = [
  ev({ event_type: 'enrolled', stage_key: 'baseline-and-mechanics' }),
  ev({ stage_key: 'baseline-and-mechanics' }),
  ev({ stage_key: 'baseline-and-mechanics' }),
  ev({ event_type: 'advanced', from_stage_key: 'baseline-and-mechanics', to_stage_key: 'acceleration-position' }),
  ev({}), ev({}), ev({}),
]
eq('sessions are counted across the whole plan', sessionCounts(events, 'acceleration-position').total, 5)
eq('and separately at the current stage',
  sessionCounts(events, 'acceleration-position').atCurrentStage, 3)
eq('no events is zero, not a crash', sessionCounts(null, 'x'), { total: 0, atCurrentStage: 0 })

// Unticking has to stick, which a union of every observation could never do.
const obs: PlayerPathwayEvent[] = [
  ev({ event_type: 'mastery_recorded', detail: { signals: ['a', 'b', 'c'] }, created_at: '2026-02-01T00:00:00Z' }),
  ev({ event_type: 'mastery_recorded', detail: { signals: ['a'] }, created_at: '2026-02-08T00:00:00Z' }),
]
eq('the LATEST observation wins, so a coach can untick a signal',
  Array.from(checkedSignals(obs, 'acceleration-position')), ['a'])
eq('observations for another stage are ignored',
  Array.from(checkedSignals(obs, 'first-step-explosion')), [])
eq('a malformed detail blob yields nothing rather than throwing',
  Array.from(checkedSignals([ev({ event_type: 'mastery_recorded', detail: { signals: 'nope' } as any })],
    'acceleration-position')), [])
eq('non-string signals are dropped',
  Array.from(checkedSignals([ev({ event_type: 'mastery_recorded', detail: { signals: ['a', 7, null] } })],
    'acceleration-position')), ['a'])

const NOW = new Date('2026-02-01T00:00:00Z')
eq('days since is whole days', daysSince('2026-01-25T00:00:00Z', NOW), 7)
eq('a missing date is null, not zero', daysSince(null, NOW), null)
eq('a nonsense date is null', daysSince('not-a-date', NOW), null)
eq('today reads as today', describeDuration(0), 'today')
eq('a week reads in days', describeDuration(7), '7 days ago')
eq('a month reads in weeks', describeDuration(30), '4 weeks ago')
eq('a season reads in months', describeDuration(120), '4 months ago')

const name = (k: string | null) => P.stages.find(s => s.stage_key === k)?.name || 'a stage'
check('an advance reads as a movement between two named stages',
  describeEvent(ev({ event_type: 'advanced', from_stage_key: 'baseline-and-mechanics',
    to_stage_key: 'acceleration-position' }), name) ===
  'Advanced from Baseline & Running Mechanics to Acceleration Position')
check('a session with minutes says so',
  /for 25 minutes/.test(describeEvent(ev({ detail: { minutes: 25 } }), name)))
check('a session without minutes does not invent any',
  !/minutes/.test(describeEvent(ev({}), name)))
for (const t of ['enrolled', 'session_logged', 'mastery_recorded', 'advanced', 'regressed',
  'completed', 'paused', 'resumed'] as const) {
  const line = describeEvent(ev({ event_type: t, from_stage_key: 'baseline-and-mechanics',
    to_stage_key: 'acceleration-position' }), name)
  check(`'${t}' renders a real sentence`, line.length > 8 && line !== 'Something changed')
}

// ── measurements ────────────────────────────────────────────────────────────

const mt = (slug: string, unit: string, direction: 'higher' | 'lower'): MetricType => ({
  id: `mt-${slug}`, coach_id: null, slug, label: slug, unit, shape: 'measurement',
  direction, default_attempts: null, hint: null, sort_order: 1,
})
const rd = (typeId: string, value: number, on: string): MetricReading => ({
  id: `r-${typeId}-${on}`, metric_type_id: typeId, metric: '', value, unit: null,
  attempts: null, successes: null, measured_on: on, note: null,
})

const sprint = mt('sprint_10y', 'sec', 'lower')
const jump = mt('broad_jump', 'in', 'higher')

// THE ONE THAT MATTERS. 2.14 → 2.03 is eleven hundredths FASTER.
const faster = summariseMeasurement(sprint, [
  rd('mt-sprint_10y', 2.14, '2026-01-05'),
  rd('mt-sprint_10y', 2.09, '2026-02-05'),
  rd('mt-sprint_10y', 2.03, '2026-03-05'),
])
eq('baseline is the first reading, not the lowest', faster.baseline?.value, 2.14)
eq('latest is the most recent', faster.latest?.value, 2.03)
eq('previous is the one before latest', faster.previous?.value, 2.09)
eq('the change keeps its real sign — the time went DOWN', faster.change, -0.11)
check('and a falling sprint time counts as toward better', faster.towardBetter === true)
eq('the change renders signed and in units', formatChange(faster), '-0.11 sec')

const slower = summariseMeasurement(sprint, [
  rd('mt-sprint_10y', 2.03, '2026-01-05'), rd('mt-sprint_10y', 2.14, '2026-03-05')])
check('a rising sprint time is NOT toward better', slower.towardBetter === false)
eq('and renders with a plus', formatChange(slower), '+0.11 sec')

const higher = summariseMeasurement(jump, [
  rd('mt-broad_jump', 48, '2026-01-05'), rd('mt-broad_jump', 53, '2026-03-05')])
check('on a jump, a bigger number IS toward better', higher.towardBetter === true)
eq('and the sign is still the real one', formatChange(higher), '+5 in')

// A single reading is not a comparison and must not be dressed up as one.
const one = summariseMeasurement(sprint, [rd('mt-sprint_10y', 2.14, '2026-01-05')])
eq('one reading has a baseline and a latest', [one.baseline?.value, one.latest?.value], [2.14, 2.14])
eq('but no previous', one.previous, null)
eq('and NO change — never invent improvement', one.change, null)
eq('which renders as nothing at all', formatChange(one), '')
check('and is not called better or worse', one.towardBetter === null)

const none = summariseMeasurement(sprint, [])
eq('no readings gives all nulls',
  [none.baseline, none.latest, none.previous, none.change, none.towardBetter],
  [null, null, null, null, null])

const flat = summariseMeasurement(sprint, [
  rd('mt-sprint_10y', 2.10, '2026-01-05'), rd('mt-sprint_10y', 2.10, '2026-03-05')])
eq('an unchanged number is zero', flat.change, 0)
check('and is not called an improvement', flat.towardBetter === null)

// Readings arriving out of order must not change which is the baseline.
const shuffled = summariseMeasurement(sprint, [
  rd('mt-sprint_10y', 2.03, '2026-03-05'),
  rd('mt-sprint_10y', 2.14, '2026-01-05'),
  rd('mt-sprint_10y', 2.09, '2026-02-05'),
])
eq('rows in any order still give the earliest as baseline', shuffled.baseline?.value, 2.14)
eq('and the most recent as latest', shuffled.latest?.value, 2.03)

// Legacy rows written before metric_type_id existed carry the slug in `metric`.
const legacy = summariseMeasurement(sprint, [{
  ...rd('', 2.20, '2026-01-01'), metric_type_id: null, metric: 'sprint_10y',
}])
eq('a legacy row matched by slug is still found', legacy.latest?.value, 2.20)

// Another metric's readings must never leak in.
const mixed = summariseMeasurement(sprint, [
  rd('mt-sprint_10y', 2.14, '2026-01-05'), rd('mt-broad_jump', 48, '2026-02-05')])
eq('another metric does not contaminate the summary', mixed.latest?.value, 2.14)

const all = summariseSpeedMeasurements(
  [sprint, jump, mt('home_to_first', 'sec', 'lower'), mt('sprint_20y', 'sec', 'lower')],
  [rd('mt-sprint_10y', 2.14, '2026-01-05'), rd('mt-broad_jump', 48, '2026-01-05')])
eq('all four benchmarks are summarised, present or not', all.length, 4)
eq('in the order the pathway asks for them',
  all.map(s => s.type.slug), Array.from(SPEED_METRIC_SLUGS))
eq('and only the recorded ones count as recorded', measurementsRecorded(all), 2)
eq('a metric type that does not exist yet is skipped, not faked',
  summariseSpeedMeasurements([sprint], []).length, 1)

// ── the plan overview ───────────────────────────────────────────────────────
//
// "What is coming up and when." The second half is where this can go wrong:
// the only unit available is PRACTICES, because nothing records how often a
// team practises. These assert that estimates stay estimates, that real
// history beats them wherever it exists, and that a regression does not make
// the map lie about where the player has been.

const withEst = (n: number, key: string, name: string, min: number, max: number): PathwayStage => ({
  ...stage(n, key, name), estimated_practices_min: min, estimated_practices_max: max,
} as any)

const PE: LoadedPathway = {
  ...P,
  stages: [
    withEst(1, 'baseline-and-mechanics', 'Baseline', 2, 4),
    withEst(2, 'acceleration-position', 'Acceleration', 2, 4),
    withEst(3, 'first-step-explosion', 'First Step', 3, 5),
  ],
}

const journey: PlayerPathwayEvent[] = [
  ev({ event_type: 'enrolled', stage_key: 'baseline-and-mechanics', occurred_on: '2026-01-05', created_at: '2026-01-05T00:00:00Z' }),
  ev({ stage_key: 'baseline-and-mechanics', created_at: '2026-01-06T00:00:00Z' }),
  ev({ stage_key: 'baseline-and-mechanics', created_at: '2026-01-13T00:00:00Z' }),
  ev({ event_type: 'advanced', from_stage_key: 'baseline-and-mechanics', to_stage_key: 'acceleration-position',
      stage_key: 'acceleration-position', occurred_on: '2026-01-20', created_at: '2026-01-20T00:00:00Z' }),
  ev({ stage_key: 'acceleration-position', created_at: '2026-01-27T00:00:00Z' }),
]

const O = planOutline(PE, progress(), journey)!
eq('the outline covers every stage', O.total, 3)
eq('and knows which one they are on', O.currentIndex, 1)
eq('a stage already run is marked visited', O.stages[0].state, 'visited')
eq('the stage they are on is marked current', O.stages[1].state, 'current')
eq('a stage not yet reached is marked ahead', O.stages[2].state, 'ahead')

// Facts for the past.
eq('a past stage reports the sessions ACTUALLY logged there', O.stages[0].sessions, 2)
eq('and the real day they moved on', O.stages[0].leftOn, '2026-01-20')
eq('the current stage reports its own sessions', O.stages[1].sessions, 1)
eq('and when they arrived', O.stages[1].arrivedOn, '2026-01-20')
eq('a stage never visited has no history to report',
  [O.stages[2].sessions, O.stages[2].leftOn, O.stages[2].arrivedOn], [0, null, null])
eq('sessions across the whole plan are counted once', O.sessionsSoFar, 3)

// Estimates for the future, and only for the future.
eq('the whole plan totals its stage estimates', [O.totalMin, O.totalMax], [7, 13])
eq('REMAINING counts from where they stand, not from stage 1',
  [O.remainingMin, O.remainingMax], [5, 9])
eq('a completed plan has nothing remaining',
  (() => { const c = planOutline(PE, progress({ status: 'completed', completed_at: 'x' }), journey)!
    return [c.remainingMin, c.remainingMax] })(), [0, 0])
check('a completed plan says so', planOutline(PE, progress({ status: 'completed', completed_at: 'x' }), journey)!.isCompleted)

// THE REGRESSION CASE. A player sent back to stage 1 has still BEEN to stage 2,
// and a map that called it "ahead" would be telling the coach they had never
// run it.
const afterRegress = [...journey, ev({
  event_type: 'regressed', from_stage_key: 'acceleration-position',
  to_stage_key: 'baseline-and-mechanics', stage_key: 'baseline-and-mechanics',
  occurred_on: '2026-02-03', created_at: '2026-02-03T00:00:00Z' })]
const R = planOutline(PE, progress({ current_stage_key: 'baseline-and-mechanics', current_stage_number: 1 }), afterRegress)!
eq('after a regression the player is back on stage 1', R.currentIndex, 0)
eq('and stage 1 is current, not merely visited', R.stages[0].state, 'current')
eq('STAGE 2 IS STILL MARKED VISITED — they have run it', R.stages[1].state, 'visited')
eq('and the day they left it is the regression date', R.stages[1].leftOn, '2026-02-03')
eq('remaining counts the whole road again from stage 1',
  [R.remainingMin, R.remainingMax], [7, 13])

eq('no pathway has no outline', planOutline(null, progress(), journey), null)
eq('a pathway with no stages has no outline',
  planOutline({ ...PE, stages: [] }, progress(), journey), null)
const noEvents = planOutline(PE, progress(), [])!
eq('with no events recorded nothing is claimed about the past',
  noEvents.stages.map(s => s.sessions), [0, 0, 0])
eq('but the current stage is still known from the enrollment row',
  noEvents.stages[1].state, 'current')

const counts = new Map([['first-step-explosion', 4]])
eq('drill counts are carried through when the caller has them',
  planOutline(PE, progress(), journey, counts)!.stages[2].drillCount, 4)
eq('and are null rather than zero when it does not',
  planOutline(PE, progress(), journey)!.stages[2].drillCount, null)

eq('a range reads as a range', practiceRange(3, 5), '3–5 practices')
eq('a single number does not pretend to be one', practiceRange(4, 4), '4 practices')
eq('one practice is singular', practiceRange(1, 1), '1 practice')
eq('a stage with no estimate says nothing at all', practiceRange(null, null), '')
check('NOTHING in the outline is expressed as a date or a week',
  !/week|month|day|date/i.test(practiceRange(3, 5)))

// ── the media contract this page leans on ───────────────────────────────────
//
// The development plan page shows a video when one exists, and every word
// around it comes from describeMedia. That function is tested thoroughly in
// test-drill-finder; these assert the specific promises THIS surface depends
// on, so a change to it that quietly turned "somewhere inside a compilation"
// into "watch this drill" fails here as well as there.
//
// The state of the library makes this concrete: of the 44 drill slots in the
// speed pathway, 10 carry a video and NONE of those is verified.

import { describeMedia } from '../lib/drillFinder'
import type { PlayableMedia } from '../lib/drillMedia'

const media = (over: Partial<PlayableMedia> = {}): PlayableMedia => ({
  media_type: 'youtube', url: 'https://www.youtube.com/watch?v=abc', title: null,
  source_name: null, thumbnail_url: null, start_seconds: null,
  verification_status: 'unverified', legacy: false, ...over,
} as PlayableMedia)

check('an unverified video is never offered as a demonstration of the drill',
  describeMedia(media(), 1).label === 'Supporting video')
check('a verified, timestamped video may be — and says where to jump to',
  /^Jump to the drill \(/.test(describeMedia(
    media({ verification_status: 'verified', start_seconds: 252 }), 1).label))
check('a TIMESTAMP ALONE does not earn the claim — somebody has to have checked it',
  describeMedia(media({ start_seconds: 252 }), 1).label === 'Supporting video')
check('a video covering several drills is called a source, not a drill video',
  describeMedia(media(), 10).label === 'Source video')
check('and says how many, so a coach landing at 0:00 was warned',
  /10 drills/.test(describeMedia(media(), 10).note || ''))
check('a shared video outranks verification in how it is described',
  describeMedia(media({ verification_status: 'verified' }), 10).label === 'Source video')
check('an article is never described as something to watch',
  describeMedia(media({ media_type: 'article' }), 1).label === 'Read the article')

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
Checked elsewhere, deliberately not faked here:
  RLS actually stops a contributor    npm run test:migration-2h
  the pathway content is real         npm run verify:player-pathways-prod
  the picker and stage nav            npm run test:pathway-ui
`)
