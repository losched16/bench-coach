// Does a practice fit in the time the coach asked for?
//
// Every assertion here runs offline against the production fixture. There is
// no database and no API key, which matters more than usual for this module:
// the thing being tested is an arithmetic guarantee about a surface whose
// output is otherwise written by a model, and a guarantee you can only check
// by calling an API is not a guarantee you can check in CI.
//
//   npm run test:practice-scheduler

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints, ScoredDrill } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import { stageOf } from '@/lib/progression'
import {
  computeBudget, schedulePractice, fitBlocks, isRedundant, describeSchedule,
  estimateBlockCount, defaultNonDrillMinutes, TRANSITION_MINUTES,
} from '@/lib/practiceScheduler'
// @ts-ignore -- plain ESM, no types
import { estimateAll } from './estimate-drill-durations.mjs'

let passed = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, actual: any, expected: any) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

// Durations come from the Phase 2B estimator, exactly as migration 047 writes
// them, so the scheduler is tested against the numbers production will hold.
const { rows } = estimateAll(FIX.drills)
const MINUTES = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))
const LOW_IDS = new Set<string>(
  rows.filter((r: any) => r.est.confidence === 'LOW').map((r: any) => String(r.drill.id))
)
const DRILLS = FIX.drills.map((d: any) => ({ ...d, est_duration_minutes: MINUTES.get(d.id) }))

function retrieve(query: string, opts: Partial<RetrievalConstraints> = {}, limit = 30) {
  const dx = diagnoseByAlias(query, PROBLEMS)
  const constraints: RetrievalConstraints = {
    ...constraintsFromText(query), playerAge: ageFromText(query), ...opts,
  }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  return rankDrills(DRILLS, mapRows, {
    query, slugs: dx.slugs, categories: dx.categories, constraints, limit,
  })
}

function planFor(query: string, minutes: number, opts: Partial<RetrievalConstraints> = {}) {
  const { scored } = retrieve(query, opts)
  const budget = computeBudget(minutes, { blockCount: estimateBlockCount(minutes) })
  return schedulePractice({ candidates: scored, budget, lowConfidenceIds: LOW_IDS })
}

// ---------------------------------------------------------------------------
// 1. The time contract
// ---------------------------------------------------------------------------
for (const m of [20, 30, 45, 60, 75, 90, 120]) {
  const b = computeBudget(m, { blockCount: estimateBlockCount(m) })
  eq(`budget ${m}: accounted minutes reconcile`,
    b.nonDrill + b.transitions + b.drillBudget, m)
  ok(`budget ${m}: drill budget is positive`, b.drillBudget > 0, `got ${b.drillBudget}`)
  ok(`budget ${m}: non-drill time is reserved`, b.nonDrill > 0)
  ok(`budget ${m}: transitions scale with blocks`,
    b.transitions === (estimateBlockCount(m) - 1) * TRANSITION_MINUTES)
}

// A longer practice must buy meaningfully more drill time, not just longer
// warm-ups — otherwise "90 minutes" is a worse deal than "60".
for (const [a, b] of [[20, 30], [30, 45], [45, 60], [60, 75], [75, 90], [90, 120]] as const) {
  ok(`a ${b}-minute practice has more drill time than a ${a}-minute one`,
    computeBudget(b).drillBudget > computeBudget(a).drillBudget)
}
ok('non-drill overhead scales with session length',
  defaultNonDrillMinutes(20) < defaultNonDrillMinutes(120))

// ---------------------------------------------------------------------------
// 2. No plan exceeds its budget — the headline acceptance constraint
// ---------------------------------------------------------------------------
const SCENARIOS: Array<{ q: string; opts?: Partial<RetrievalConstraints>; why: string }> = [
  { q: 'My 8-year-old keeps dropping his back shoulder when he swings.', why: 'flagship taxonomy case' },
  { q: 'My shortstop has a slow transfer.', why: 'infield' },
  { q: 'My 8-year-old is scared of fly balls.', why: 'thin problem' },
  { q: 'How do I help my pitcher throw harder?', why: 'a goal, no taxonomy match' },
  { q: 'hitting indoors in a small space', opts: { indoorOutdoor: 'indoor', spaceAvailable: 'small' }, why: 'indoor' },
  { q: 'I am on my own with one kid and a bucket of balls.', why: 'solo' },
  { q: 'general team practice', why: 'no flaw at all' },
]

for (const s of SCENARIOS) {
  for (const m of [20, 30, 45, 60, 75, 90, 120]) {
    const p = planFor(s.q, m, s.opts)
    ok(`never over budget: ${m}min "${s.q.slice(0, 30)}"`,
      p.scheduledMinutes <= p.budget.drillBudget,
      `${p.scheduledMinutes} > ${p.budget.drillBudget}`)
    ok(`total fits the request: ${m}min "${s.q.slice(0, 30)}"`,
      p.scheduledMinutes + p.budget.nonDrill + p.budget.transitions <= m)
    ok(`every scheduled drill has a positive duration: ${m}min "${s.q.slice(0, 26)}"`,
      p.items.every(i => typeof i.minutes === 'number' && i.minutes > 0))
  }
}

// ---------------------------------------------------------------------------
// 3. Short practices are focused, not truncated team practices
// ---------------------------------------------------------------------------
for (const m of [20, 30, 45]) {
  const p = planFor('My 8-year-old keeps dropping his back shoulder when he swings.', m)
  ok(`${m}-minute session returns drills at all`, p.items.length > 0)
  ok(`${m}-minute session is not a six-block team practice`, p.items.length <= 6, `got ${p.items.length}`)
}
const twenty = planFor('My hitter is lunging forward.', 20)
ok('a 20-minute session still gets 1-4 drills',
  twenty.items.length >= 1 && twenty.items.length <= 4, `got ${twenty.items.length}`)

// ---------------------------------------------------------------------------
// 4. Longer practices buy more practice
// ---------------------------------------------------------------------------
const sixty = planFor('My hitter is lunging forward.', 60)
const oneTwenty = planFor('My hitter is lunging forward.', 120)
ok('120 minutes schedules more drills than 60',
  oneTwenty.items.length > sixty.items.length,
  `${oneTwenty.items.length} vs ${sixty.items.length}`)
ok('120 minutes schedules more drill minutes than 60',
  oneTwenty.scheduledMinutes > sixty.scheduledMinutes)
ok('the longer plan does not repeat itself',
  new Set(oneTwenty.items.map(i => i.drill.id)).size === oneTwenty.items.length)

// ---------------------------------------------------------------------------
// 5. Redundancy — conservative on purpose
// ---------------------------------------------------------------------------
const byName = (n: string) => DRILLS.find((d: any) => d.drill_name === n)

ok('long-form and short-form of one drill are redundant',
  isRedundant(byName('High Tee Drill — Hitting Up in the Zone'), byName('High Tee')))
ok('a drill is redundant with itself',
  isRedundant(byName('Tee Work'), byName('Tee Work')))

// The expensive mistake would be suppressing a real progression. Tee Work,
// Low Tee and Line Drive Pro come off the same film and are three different
// drills a coach would run in sequence.
ok('a genuine progression sharing a video is NOT suppressed (Tee Work / Low Tee)',
  !isRedundant(byName('Tee Work'), byName('Low Tee')))
ok('a genuine progression sharing a video is NOT suppressed (Low Tee / Line Drive Pro)',
  !isRedundant(byName('Low Tee'), byName('Line Drive Pro / Visual Feedback Swing Drill')))
ok('unrelated drills are not redundant',
  !isRedundant(byName('Tee Work'), byName('Wall Ball')))

for (const s of SCENARIOS) {
  const p = planFor(s.q, 120)
  for (let i = 0; i < p.items.length; i++) {
    for (let j = i + 1; j < p.items.length; j++) {
      ok(`no redundant pair scheduled: "${p.items[i].drill.drill_name.slice(0, 22)}" / "${p.items[j].drill.drill_name.slice(0, 22)}"`,
        !isRedundant(p.items[i].drill, p.items[j].drill))
    }
  }
}

// ---------------------------------------------------------------------------
// 6. The strongest coaching match survives the arithmetic
// ---------------------------------------------------------------------------
const flagship = planFor('My 8-year-old keeps dropping his back shoulder when he swings.', 60)
const names = flagship.items.map(i => i.drill.drill_name)
ok('the top curated taxonomy match is scheduled', names.includes('Tee Work'),
  `got: ${names.join(', ')}`)
ok('a second curated match from the same sequence is scheduled',
  names.includes('Low Tee') || names.includes('Line Drive Pro / Visual Feedback Swing Drill'),
  `got: ${names.join(', ')}`)

// The failure this guards against: filling the clock tightly with several weak
// short drills instead of building around the curated sequence.
const topScore = Math.max(...flagship.items.map(i => i.score))
const retrievedTop = retrieve('My 8-year-old keeps dropping his back shoulder when he swings.').scored[0]
eq('the single best-ranked candidate is in the plan', topScore, retrievedTop.reason.score)

// ---------------------------------------------------------------------------
// 7. Progression ordering
// ---------------------------------------------------------------------------
for (const s of SCENARIOS) {
  const p = planFor(s.q, 90)
  const stages = p.items.map(i => i.stage)
  ok(`stages are non-decreasing: "${s.q.slice(0, 34)}"`,
    stages.every((v, i) => i === 0 || stages[i - 1] <= v), stages.join(','))
}

// Phase 1's mapping must not have been quietly reverted to Math.min(3, level).
const l4 = DRILLS.filter((d: any) => d.progression_level === 4)
ok('production still has level-4 drills to protect', l4.length > 0)
ok('every level-4 drill is stage 3', l4.every((d: any) => stageOf(d) === 3))
eq('level 3 is stage 2', stageOf({ progression_level: 3 } as any), 2)
eq('level 2 is stage 2', stageOf({ progression_level: 2 } as any), 2)
eq('level 1 is stage 1', stageOf({ progression_level: 1 } as any), 1)

// ---------------------------------------------------------------------------
// 8. Operational constraints
// ---------------------------------------------------------------------------
const indoor = planFor('hitting indoors in a small space', 60,
  { indoorOutdoor: 'indoor', spaceAvailable: 'small' })
ok('indoor request excludes outdoor-only drills',
  indoor.items.every(i => !/^outdoor$/i.test(String(i.drill.indoor_outdoor || ''))),
  indoor.items.map(i => i.drill.indoor_outdoor).join(','))
ok('small-space request excludes full-field drills',
  indoor.items.every(i => !/full field|outfield/i.test(String(i.drill.space_required || ''))))
ok('indoor plan is not empty', indoor.items.length > 0)

const solo = planFor('I am on my own with one kid and a bucket of balls.', 30)
ok('solo plan is not empty', solo.items.length > 0)

// Absence is not a constraint — the governing rule from Phase 1.
const unknown = planFor('general team practice', 60)
const outdoorOnly = unknown.items.filter(i => /outdoor/i.test(String(i.drill.indoor_outdoor || '')))
ok('unknown location does not filter out outdoor drills', outdoorOnly.length > 0,
  'every scheduled drill avoided outdoor despite no stated location')

// Age filtering still applies through retrieval.
const young = planFor('My 8-year-old keeps dropping his back shoulder when he swings.', 60)
ok('age-filtered plan excludes drills the player is too young for',
  young.items.every(i => (i.drill.min_age ?? 0) <= 8))

// ---------------------------------------------------------------------------
// 9. Scoping and approval — nothing gets in through the scheduler
// ---------------------------------------------------------------------------
for (const s of SCENARIOS) {
  const p = planFor(s.q, 120)
  ok(`approved only: "${s.q.slice(0, 30)}"`,
    p.items.every(i => i.drill.status === 'approved' || i.drill.status == null))
  ok(`no other coach's drill: "${s.q.slice(0, 30)}"`,
    p.items.every(i => i.drill.created_by_coach_id == null))
}

// ---------------------------------------------------------------------------
// 10. Determinism
// ---------------------------------------------------------------------------
for (const s of SCENARIOS) {
  const a = planFor(s.q, 75)
  const b = planFor(s.q, 75)
  eq(`deterministic ids: "${s.q.slice(0, 34)}"`,
    a.items.map(i => i.drill.id).join('|'), b.items.map(i => i.drill.id).join('|'))
  eq(`deterministic minutes: "${s.q.slice(0, 34)}"`, a.scheduledMinutes, b.scheduledMinutes)
}

// ---------------------------------------------------------------------------
// 11. Degenerate inputs
// ---------------------------------------------------------------------------
const noCandidates = schedulePractice({ candidates: [], budget: computeBudget(60) })
eq('no candidates schedules nothing', noCandidates.items.length, 0)
eq('no candidates spends nothing', noCandidates.scheduledMinutes, 0)

// A drill with no duration cannot be placed against a clock, and is reported
// rather than assumed to take zero minutes and packed into every practice.
const durationless = schedulePractice({
  candidates: [{
    drill: { id: 'x', drill_name: 'Undated Drill' },
    reason: { score: 99, primary: 'curated-map', matchedProblems: [], curated: true, textScore: 0, notes: [] },
  } as unknown as ScoredDrill],
  budget: computeBudget(60),
})
eq('a drill with no duration is not scheduled', durationless.items.length, 0)
eq('and is reported as such', durationless.rejected[0]?.reason, 'no-duration')

// A single drill longer than the whole budget must not be forced in.
const tiny = schedulePractice({
  candidates: retrieve('My hitter is lunging forward.').scored,
  budget: { requested: 10, nonDrill: 6, transitions: 2, drillBudget: 2 },
})
eq('nothing fits a 2-minute drill budget', tiny.items.length, 0)
ok('and the reason is recorded', tiny.rejected.every(r => r.reason === 'over-budget' || r.reason === 'redundant'))

// ---------------------------------------------------------------------------
// 12. LOW-confidence durations are allowed, and observable
// ---------------------------------------------------------------------------
const lowUse = planFor('My hitter is lunging forward.', 90)
ok('LOW-confidence durations do not block scheduling',
  lowUse.items.some(i => LOW_IDS.has(String(i.drill.id))),
  'no LOW-confidence drill was scheduled, so the allowance is untested')
ok('LOW-confidence selections are reported',
  lowUse.lowConfidenceDrillIds.length > 0 &&
  lowUse.lowConfidenceDrillIds.every(id => LOW_IDS.has(id)))

// ---------------------------------------------------------------------------
// 13. fitBlocks — the enforcement that makes the guarantee real
// ---------------------------------------------------------------------------
const over = [
  { type: 'warmup', title: 'Warm-up', minutes: 10 },
  { type: 'drill', title: 'Tee Work', minutes: 20 },
  { type: 'drill', title: 'Low Tee', minutes: 20 },
  { type: 'game', title: 'Game', minutes: 15 },
  { type: 'cooldown', title: 'Cool-down', minutes: 7 },
]
const fitted = fitBlocks(over, 60)
eq('an over-length plan is brought inside the budget', fitted.total <= 60, true)
ok('proportional trim keeps every block', fitted.blocks.length === over.length,
  `${fitted.blocks.length} of ${over.length}`)
ok('trimming is recorded', fitted.adjustments.length > 0)
ok('no block is trimmed out of existence', fitted.blocks.every(b => (b.minutes ?? 0) >= 3))
ok('block order and titles survive',
  fitted.blocks.map(b => b.title).join('|') === over.map(b => b.title).join('|'))

const under = [{ type: 'drill', title: 'A', minutes: 20 }, { type: 'drill', title: 'B', minutes: 20 }]
const untouched = fitBlocks(under, 60)
eq('an under-length plan is left alone', untouched.total, 40)
eq('and nothing is recorded as adjusted', untouched.adjustments.length, 0)

const exact = fitBlocks([{ title: 'A', minutes: 30 }, { title: 'B', minutes: 30 }], 60)
eq('an exactly-fitting plan is untouched', exact.total, 60)
eq('exact fit records no adjustment', exact.adjustments.length, 0)

// Far too many blocks for the clock: trimming alone cannot get there without
// shredding them, so blocks come off the back.
const crowded = Array.from({ length: 8 }, (_, n) => ({ title: `B${n}`, minutes: 10 }))
const squeezed = fitBlocks(crowded, 20)
ok('an impossible block count is reduced', squeezed.blocks.length < crowded.length)
ok('and the result still fits', squeezed.total <= 20, `got ${squeezed.total}`)
ok('dropping is recorded', squeezed.adjustments.some(a => a.includes('dropped')))

// Malformed input must not produce NaN minutes in a coach's plan.
const malformed = fitBlocks(
  [{ title: 'A', minutes: undefined as any }, { title: 'B', minutes: 'x' as any }], 30)
ok('non-numeric block minutes become zero, not NaN',
  malformed.blocks.every(b => Number.isFinite(b.minutes)))

// ---------------------------------------------------------------------------
// 14. Metadata variant equivalence (migration 048 regression)
//
// The variants normalized by 048 must behave identically before and after, so
// the migration cannot quietly change which drills are eligible.
// ---------------------------------------------------------------------------
function variantPlan(mutate: (d: any) => any, query: string, opts: Partial<RetrievalConstraints>) {
  const lib = DRILLS.map(mutate)
  const dx = diagnoseByAlias(query, PROBLEMS)
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  const { scored } = rankDrills(lib, mapRows, {
    query, slugs: dx.slugs, categories: dx.categories,
    constraints: { ...constraintsFromText(query), ...opts }, limit: 30,
  })
  return scored.map(s => s.drill.id).join('|')
}
const q = 'hitting drills'
const spaceOpts = { spaceAvailable: 'medium' as const }
eq('"Full field" and "Full Field" are equally eligible',
  variantPlan((d: any) => ({ ...d, space_required: d.space_required === 'Full Field' ? 'Full field' : d.space_required }), q, spaceOpts),
  variantPlan((d: any) => ({ ...d, space_required: d.space_required === 'Full field' ? 'Full Field' : d.space_required }), q, spaceOpts))

const envOpts = { indoorOutdoor: 'indoor' as const }
eq('"Both" and "Indoor/Outdoor" are equally eligible',
  variantPlan((d: any) => ({ ...d, indoor_outdoor: d.indoor_outdoor === 'Indoor/Outdoor' ? 'Both' : d.indoor_outdoor }), q, envOpts),
  variantPlan((d: any) => ({ ...d, indoor_outdoor: d.indoor_outdoor === 'Both' ? 'Indoor/Outdoor' : d.indoor_outdoor }), q, envOpts))

// ---------------------------------------------------------------------------
// 15. The guidance handed to the generator
// ---------------------------------------------------------------------------
const guidance = describeSchedule(flagship)
ok('guidance states the requested duration', guidance.includes('60-minute'))
ok('guidance states the drill budget', guidance.includes(String(flagship.budget.drillBudget)))
ok('guidance names the scheduled drills', guidance.includes('Tee Work'))
ok('guidance gives each drill its minutes', /\d+ min,/.test(guidance))

// ---------------------------------------------------------------------------
// 16. Practice Plan actually uses shared retrieval
// ---------------------------------------------------------------------------
const routeSrc = readFileSync('app/api/practice-plan/route.ts', 'utf8')
// Comment lines stripped: the file explains the old query in prose, and an
// assertion that cannot tell a description of the bug from the bug is worse
// than no assertion.
const routeCode = routeSrc
  .split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n')

ok('the route imports shared retrieval', routeCode.includes("from '@/lib/drillRetrieval'"))
ok('the route calls retrieveDrills', /retrieveDrills\(/.test(routeCode))
ok('the route enforces the budget on the model output', /fitBlocks\(/.test(routeCode))
ok('the legacy ilike category query is gone', !routeCode.includes('skill_category.ilike'))
ok('the 45-row ceiling is gone', !/\.limit\(45\)/.test(routeCode))

// ---------------------------------------------------------------------------
console.log(`\npractice scheduler: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
