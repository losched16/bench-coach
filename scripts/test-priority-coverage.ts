// Does a practice honour the priorities the coach selected?
//
// Every assertion runs offline against the production fixture: no database,
// no API key, no network. What is being tested is a deterministic guarantee
// about a plan whose blocks are otherwise written by a model — that a
// selected focus area cannot end up with token coverage without the plan
// being repaired before anyone sees it — and that guarantee has to hold in
// CI, not only when a model happens to behave.
//
//   npm run test:priority-coverage

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints, ScoredDrill } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import { categoriesForPracticeFocus } from '@/lib/focusAreas'
import { computeBudget, schedulePractice, estimateBlockCount, fitBlocks } from '@/lib/practiceScheduler'
import {
  evaluatePriorityCoverage, blockPriorities, indexDrills, rotationMinutesOf,
  describeCoverage, UNDER_COVERED_SHARE, MIN_ABSOLUTE_MINUTES,
} from '@/lib/priorityCoverage'
import { repairPriorityCoverage, MAX_REPAIR_STEPS } from '@/lib/priorityRepair'
import { scheduleRows, equipmentChecklist, readPlan, flattenBlocks } from '@/lib/practicePlan'
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
const { rows } = estimateAll(FIX.drills)
const MINUTES = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))
const DRILLS = FIX.drills.map((d: any) => ({ ...d, est_duration_minutes: MINUTES.get(d.id) }))
const INDEX = indexDrills(DRILLS)

function retrieve(query: string, focus: string[], opts: Partial<RetrievalConstraints> = {}, limit = 30): ScoredDrill[] {
  const dx = diagnoseByAlias(query, PROBLEMS)
  const constraints: RetrievalConstraints = { ...constraintsFromText(query), playerAge: ageFromText(query), ...opts }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  const cats = categoriesForPracticeFocus(focus)
  return rankDrills(DRILLS, mapRows, {
    query, slugs: dx.slugs, categories: dx.categories.length ? dx.categories : cats, constraints, limit,
  }).scored
}

/** Category-only candidates for one priority, the way the route tops up a starved one. */
function candidatesFor(priority: string, opts: Partial<RetrievalConstraints> = {}): ScoredDrill[] {
  const cats = categoriesForPracticeFocus([priority]).filter(c => c !== 'warmup' && c !== 'athletic development')
  return rankDrills(DRILLS, [], {
    query: '', slugs: [], categories: cats,
    constraints: { ...opts }, limit: 12,
  }).scored
}

const byName = (name: string) => DRILLS.find((d: any) => d.drill_name === name)
const drillOf = (cat: string, not: string[] = []) =>
  DRILLS.find((d: any) => String(d.skill_category).toLowerCase() === cat && !not.includes(d.drill_name))
const block = (d: any, minutes: number, type = 'drill') => {
  return { type, title: d.drill_name, minutes, description: d.description, drill_name: d.drill_name }
}

// ---------------------------------------------------------------------------
// 1. Exposure: sequential blocks, station rotations, and what does not count
// ---------------------------------------------------------------------------
{
  const tee = drillOf('hitting')
  const gb = drillOf('fielding (infield)')
  const thr = drillOf('throwing')
  ok('fixture has one drill per priority', Boolean(tee && gb && thr))

  const plan = [
    { type: 'warmup', title: 'Dynamic Stretch + dry swings', minutes: 10, description: 'swings and throws to warm up' },
    block(tee, 12), block(gb, 14), block(thr, 12),
    { type: 'game', title: 'Two-Ball Ground Ball Race', minutes: 10, description: 'a competitive fielding game' },
    { type: 'cooldown', title: 'Recap', minutes: 4 },
  ]
  const cov = evaluatePriorityCoverage(plan, ['throwing', 'hitting', 'infield'], { drills: INDEX })
  const row = (p: string) => cov.priorities.find(r => r.priority === p)!
  eq('warm-up mentioning swings credits hitting nothing', row('hitting').exposure_minutes, 12)
  eq('a competitive fielding game credits infield', row('infield').exposure_minutes, 24)
  eq('throwing gets its block', row('throwing').exposure_minutes, 12)
  eq('meaningful minutes exclude warm-up and cool-down', cov.meaningful_minutes, 48)
  eq('total minutes are the whole plan', cov.total_minutes, 62)
  ok('all three are covered', cov.balanced, describeCoverage(cov))

  // A 24-minute, three-station rotation gives each priority 8 minutes, not 24.
  const rotation = {
    type: 'station', title: '3-Station Rotation', minutes: 24, groups: 3, rotation_minutes: 8,
    stations: [block(tee, 8), block(gb, 8), block(thr, 8)],
  }
  const cov2 = evaluatePriorityCoverage([plan[0], rotation, plan[5]], ['throwing', 'hitting', 'infield'], { drills: INDEX })
  for (const p of ['throwing', 'hitting', 'infield']) {
    eq(`station exposure for ${p} is one rotation`, cov2.priorities.find(r => r.priority === p)!.exposure_minutes, 8)
    eq(`station exposure for ${p} is counted as station minutes`, cov2.priorities.find(r => r.priority === p)!.station_exposure_minutes, 8)
  }
  eq('the rotation counts once on the clock', cov2.total_minutes, 38)
  ok('rotation minutes are approximate by nature', cov2.approximate)
  eq('rotation length is read from the block', rotationMinutesOf(rotation), 8)
  eq('rotation length is derived when absent', rotationMinutesOf({ ...rotation, rotation_minutes: undefined }), 7)

  // Mentioned is not covered: a fungo drill is fielding, a throwing drill with
  // an offence tag is throwing, dry swings in a warm-up are a warm-up.
  const fungo = { ...gb, drill_name: 'Coach Fungo Ground Balls', tags: ['bat', 'offense'] }
  eq('a fungo drill is not hitting', blockPriorities(block(fungo, 10), ['hitting', 'infield'], indexDrills([fungo])).join(','), 'infield')
  const tagged = { ...thr, tags: ['offense', 'hitting'] }
  eq('a throwing drill with an offence tag is throwing', blockPriorities(block(tagged, 10), ['hitting', 'throwing'], indexDrills([tagged])).join(','), 'throwing')
  eq('a warm-up never counts', blockPriorities({ type: 'warmup', title: 'Tee swings warm-up', minutes: 8 }, ['hitting']).length, 0)
  eq('an unlinked block reads its title', blockPriorities({ type: 'drill', title: 'Front Toss Rounds', minutes: 10 }, ['hitting', 'infield']).join(','), 'hitting')
  eq('a coaching-point mention in the description does not outrank the title',
    blockPriorities({ type: 'drill', title: 'Four Corners Throwing', minutes: 10, description: 'remind hitters to load' }, ['hitting', 'throwing']).join(','), 'throwing')
  eq('a stamped block is trusted for selected keys only',
    blockPriorities({ type: 'drill', title: 'x', minutes: 10, skills: ['catching', 'hitting'] }, ['hitting']).join(','), 'hitting')
}

// ---------------------------------------------------------------------------
// 2. The threshold: derived from the drill budget, not invented
// ---------------------------------------------------------------------------
{
  const tee = drillOf('hitting'); const gb = drillOf('fielding (infield)'); const thr = drillOf('throwing')
  const gb2 = drillOf('fielding (infield)', [gb.drill_name]); const thr2 = drillOf('throwing', [thr.drill_name])
  // The real case: 90 minutes, one 10-minute tee block, infield and throwing everywhere else.
  const real = [
    { type: 'warmup', title: 'Dynamic Stretch', minutes: 10 },
    block(tee, 10), block(gb, 14), block(thr, 12), block(gb2, 12), block(thr2, 12),
    { type: 'game', title: 'Infield Relay Race', minutes: 12 },
    { type: 'cooldown', title: 'Huddle', minutes: 5 },
  ]
  const cov = evaluatePriorityCoverage(real, ['throwing', 'hitting', 'infield'], { drills: INDEX })
  const hitting = cov.priorities.find(r => r.priority === 'hitting')!
  eq('real case: hitting is under-covered', hitting.status, 'under_covered')
  ok('real case: the minimum is 60% of a fair share of the meaningful minutes',
    hitting.minimum_minutes === Math.round(Math.max(MIN_ABSOLUTE_MINUTES, (72 / 3) * UNDER_COVERED_SHARE)),
    `minimum ${hitting.minimum_minutes}`)
  // A short session: the minimum can never exceed the share itself.
  const short = evaluatePriorityCoverage([block(tee, 8), block(thr, 7)], ['hitting', 'throwing'], { drills: INDEX })
  ok('a short session never demands more than the fair share', short.priorities.every(r => r.minimum_minutes <= 8), describeCoverage(short))
  ok('real case: infield is strong', cov.priorities.find(r => r.priority === 'infield')!.status === 'strong')
  ok('real case: the plan is not balanced', !cov.balanced)
  ok('real case: the explanation names the rule', cov.explain.some(e => /hitting.*below the .*minimum/i.test(e)), cov.explain.join(' | '))

  // Sixteen minutes of hitting against thirty of infield is allowed to lead.
  const led = [real[0], block(tee, 16), block(gb, 16), block(thr, 16), block(gb2, 12),
               { type: 'game', title: 'Baserunning Relay', minutes: 10 }, real[7]]
  const cov2 = evaluatePriorityCoverage(led, ['throwing', 'hitting', 'infield'], { drills: INDEX })
  ok('one priority may lead without another being flagged', cov2.balanced, describeCoverage(cov2))
  eq('the leading priority is strong', cov2.priorities.find(r => r.priority === 'infield')!.status, 'strong')

  // Ten against forty is flagged by the dominance rule even with a small floor.
  const dominated = [real[0], block(tee, 10), block(gb, 20), block(gb2, 20), block(thr, 10), real[7]]
  const cov3 = evaluatePriorityCoverage(dominated, ['throwing', 'hitting', 'infield'], { drills: INDEX })
  ok('ten minutes against forty is under-covered', cov3.under_covered.includes('hitting') && cov3.under_covered.includes('throwing'), describeCoverage(cov3))

  // A single selected priority is never under-covered against itself.
  const solo = evaluatePriorityCoverage([real[0], block(tee, 15), block(tee, 12), real[7]], ['hitting'], { drills: INDEX })
  ok('a single priority dominates and is strong', solo.balanced && solo.priorities[0].status === 'strong')

  // Explicit weights change the share; the floor stays.
  const weighted = evaluatePriorityCoverage(dominated, ['throwing', 'hitting', 'infield'], { drills: INDEX, weights: { infield: 3, hitting: 1, throwing: 1 } })
  const wh = weighted.priorities.find(r => r.priority === 'hitting')!
  ok('a weighted minority priority has a smaller minimum', wh.minimum_minutes < hitting.minimum_minutes, `min ${wh.minimum_minutes}`)
}

// ---------------------------------------------------------------------------
// 3. Repair: the real 9U case, before and after, inside the clock
// ---------------------------------------------------------------------------
function realPlan(): any[] {
  const tee = byName('High Tee Drill') || drillOf('hitting')
  const gb = drillOf('fielding (infield)'); const thr = drillOf('throwing')
  const gb2 = drillOf('fielding (infield)', [gb.drill_name]); const thr2 = drillOf('throwing', [thr.drill_name])
  return [
    { type: 'warmup', title: 'Dynamic Stretch + Partner Catch', minutes: 10 },
    block(tee, 10), block(gb, 14), block(thr, 12), block(gb2, 12), block(thr2, 12),
    { type: 'game', title: 'Infield Relay Race', minutes: 12, description: 'ground balls under pressure' },
    { type: 'cooldown', title: 'Huddle', minutes: 5 },
  ]
}
const REAL_FOCUS = ['throwing', 'hitting', 'infield']
function candidateMap(focus: string[], opts: Partial<RetrievalConstraints> = {}) {
  return Object.fromEntries(focus.map(p => [p, candidatesFor(p, opts).map(c => ({ drill: c.drill, score: c.reason.score }))]))
}
{
  const before = evaluatePriorityCoverage(realPlan(), REAL_FOCUS, { drills: INDEX })
  ok('9U real case: hitting is under-covered before repair', before.under_covered.includes('hitting'))
  const total = realPlan().reduce((n, b) => n + b.minutes, 0)

  const r = repairPriorityCoverage(realPlan(), REAL_FOCUS, candidateMap(REAL_FOCUS, { playerAge: 9 }), {
    drills: INDEX, envelope: { playerAge: 9, expectedPlayers: 12, coachCount: 3 },
  })
  ok('9U real case: repaired', r.coverage.balanced, describeCoverage(r.coverage) + '\n' + r.steps.map(s => s.detail).join('\n'))
  ok('9U real case: at least one step was taken', r.steps.length >= 1)
  ok('9U real case: bounded', r.steps.length <= MAX_REPAIR_STEPS)
  eq('9U real case: total minutes unchanged', r.blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0), total)
  ok('9U real case: the competitive game survives the repair', r.blocks.some(b => b.type === 'game'))
  const after = r.coverage.priorities.find(p => p.priority === 'hitting')!
  ok('9U real case: hitting is no longer a single ten-minute block',
    after.exposure_minutes >= after.minimum_minutes && after.exposure_minutes > 10, `${after.exposure_minutes} min`)
  ok('9U real case: infield and throwing still meaningfully covered',
    r.coverage.priorities.every(p => p.status !== 'missing' && p.status !== 'under_covered'))
  ok('9U real case: no block dropped below the floor',
    r.blocks.filter(b => b.type === 'drill').every(b => (Number(b.minutes) || 0) >= 6))
  ok('9U real case: repair steps are explainable', r.steps.every(s => s.detail.length > 20 && s.priority === 'hitting'))
  // Age gate: every drill the repair brought in is eligible for a nine-year-old.
  const brought = r.blocks.flatMap(b => [b, ...((b.stations as any[]) || [])]).map(b => INDEX.get(String(b.drill_name || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim())).filter(Boolean) as any[]
  ok('9U real case: every drill in the repaired plan is age-eligible',
    brought.every(d => d.min_age == null || d.max_age == null || (9 >= d.min_age && 9 <= d.max_age)))
  console.log('\n9U / 90 min / Throwing + Hitting + Infield — before:\n' + describeCoverage(before))
  console.log('after:\n' + describeCoverage(r.coverage))
  console.log('steps:\n  ' + r.steps.map(s => `${s.strategy}: ${s.detail} (${s.before}→${s.after} min)`).join('\n  '))

  // The same case with one coach: the repair must not build a station group
  // that needs three adults, and must still balance.
  const solo = repairPriorityCoverage(realPlan(), REAL_FOCUS, candidateMap(REAL_FOCUS, { playerAge: 9 }), {
    drills: INDEX, envelope: { playerAge: 9, expectedPlayers: 12, coachCount: 1 },
  })
  ok('9U with one coach: still repaired', solo.coverage.balanced, describeCoverage(solo.coverage))
  const stationBlocks = solo.blocks.filter(b => Array.isArray(b.stations))
  ok('9U with one coach: any rotation is staffable', stationBlocks.every(b => {
    const needing = (b.stations as any[]).filter(s => (INDEX.get(String(s.drill_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())?.min_coaches ?? 0) > 0).length
    return needing <= 1
  }))

  // Nothing to repair with: no candidates means the plan is left alone and
  // the priority is reported unresolved, never padded.
  const none = repairPriorityCoverage(realPlan(), REAL_FOCUS, { hitting: [], throwing: [], infield: [] }, {
    drills: INDEX, envelope: { playerAge: 9 },
  })
  ok('no candidates: rebalance still moves minutes onto the existing hitting block',
    none.coverage.priorities.find(p => p.priority === 'hitting')!.exposure_minutes > 10)
  eq('no candidates: total minutes unchanged', none.blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0), total)

  // Throwing load: with a game tomorrow, a high-load drill never comes in.
  const heavy = candidateMap(REAL_FOCUS, { playerAge: 9 })
  heavy.hitting = heavy.hitting.map(c => ({ ...c, drill: { ...c.drill, throwing_load: 'high' } }))
  const gameTomorrow = repairPriorityCoverage(realPlan(), REAL_FOCUS, heavy, {
    drills: INDEX, envelope: { playerAge: 9, expectedPlayers: 12, coachCount: 3, limitThrowing: true },
  })
  const heavyNames = new Set(heavy.hitting.map(c => c.drill.drill_name))
  ok('game tomorrow: no high-throwing-load drill is brought in',
    !gameTomorrow.steps.some(s => Array.from(heavyNames).some(n => s.detail.includes(`"${n}"`) && s.strategy !== 'rebalance')))
}

// ---------------------------------------------------------------------------
// 4. Scenarios A–E through the proposal and the repair
// ---------------------------------------------------------------------------
interface Scenario { name: string; age: number; minutes: number; focus: string[]; players?: number; coaches?: number; limitThrowing?: boolean; expectStations?: boolean }
const SCENARIOS: Scenario[] = [
  { name: 'A: 8U 90 Hitting+Infield+Throwing, 3 coaches, 12 players', age: 8, minutes: 90, focus: ['hitting', 'infield', 'throwing'], players: 12, coaches: 3, expectStations: true },
  { name: 'B: 8U 60 Hitting+Fielding, 1 coach, 12 players', age: 8, minutes: 60, focus: ['hitting', 'infield'], players: 12, coaches: 1 },
  { name: 'C: 10U 90 Hitting+Baserunning+Team Defense, 2 coaches', age: 10, minutes: 90, focus: ['hitting', 'baserunning', 'game iq'], coaches: 2 },
  { name: 'D: 9U 75 Hitting only', age: 9, minutes: 75, focus: ['hitting'] },
  { name: 'E: 9U 90 Infield+Throwing, game tomorrow', age: 9, minutes: 90, focus: ['infield', 'throwing'], limitThrowing: true, players: 12, coaches: 2 },
]
for (const s of SCENARIOS) {
  const opts: Partial<RetrievalConstraints> = { playerAge: s.age, expectedPlayers: s.players ?? null, coachCount: s.coaches ?? null, limitThrowing: s.limitThrowing ?? null }
  const scored = retrieve(`${s.age} year olds, general team practice`, s.focus, opts)
  const budget = computeBudget(s.minutes, { blockCount: estimateBlockCount(s.minutes) })
  const byPriority = candidateMap(s.focus, opts)
  const sched = schedulePractice({
    candidates: scored, budget, expectedPlayers: s.players ?? null, coachCount: s.coaches ?? null,
    priorities: s.focus, candidatesByPriority: byPriority as any,
  })
  const proposal = sched.items.map(i => ({ type: 'drill', title: i.drill.drill_name, minutes: i.minutes, drill_name: i.drill.drill_name }))
  const cov = evaluatePriorityCoverage(proposal, s.focus, { drills: INDEX })
  ok(`${s.name}: every selected priority appears in the proposal`,
    cov.priorities.every(p => p.meaningful_blocks >= 1), describeCoverage(cov))
  ok(`${s.name}: proposal reserves each priority its minimum`,
    cov.priorities.every(p => p.status !== 'missing' && p.status !== 'under_covered'), describeCoverage(cov))
  ok(`${s.name}: proposal fits the drill budget`, sched.scheduledMinutes <= budget.drillBudget)
  if (s.expectStations) {
    ok(`${s.name}: stations are on offer with 12 players and 3 coaches`, sched.stations != null && sched.stations.stations.length >= 2,
      sched.stations ? '' : 'no station group proposed')
  }
  if (s.coaches === 1 && sched.stations) {
    ok(`${s.name}: one coach never staffs two coach-led stations`,
      sched.stations.stations.filter(x => (x.drill.min_coaches ?? 0) > 0).length <= 1)
  }
  if (s.focus.length === 1) {
    // The rest of the proposal is warm-up and athletic-development work the
    // focus map always adds; no diversity requirement is imposed.
    ok(`${s.name}: a single priority owns the practice`,
      cov.balanced && cov.priorities[0].exposure_minutes >= 0.6 * cov.meaningful_minutes, describeCoverage(cov))
  }
  if (s.limitThrowing) {
    ok(`${s.name}: throwing still gets real reps on a game week`,
      cov.priorities.find(p => p.priority === 'throwing')!.exposure_minutes >= MIN_ABSOLUTE_MINUTES)
  }

  // A model that ignores the proposal and starves the first priority is repaired.
  const starved = proposal.map((b, i) => (i > 0 && blockPriorities(b, s.focus, INDEX)[0] === s.focus[0]) ? { ...b, minutes: 5 } : b)
  const skeleton = [{ type: 'warmup', title: 'Warm-up', minutes: 8 }, ...starved, { type: 'cooldown', title: 'Recap', minutes: 4 }]
  const fitted = fitBlocks(skeleton, s.minutes).blocks
  const covS = evaluatePriorityCoverage(fitted, s.focus, { drills: INDEX })
  const r = repairPriorityCoverage(fitted, s.focus, byPriority as any, {
    drills: INDEX, envelope: { playerAge: s.age, expectedPlayers: s.players, coachCount: s.coaches, limitThrowing: s.limitThrowing },
  })
  ok(`${s.name}: no priority disappears after repair`, r.coverage.priorities.every(p => p.status !== 'missing'), describeCoverage(r.coverage))
  ok(`${s.name}: repair never exceeds the requested minutes`,
    r.blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0) <= s.minutes)
  ok(`${s.name}: repair never lengthens the plan`,
    r.blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0) <= fitted.reduce((n, b) => n + (Number(b.minutes) || 0), 0))
  if (!covS.balanced) {
    ok(`${s.name}: an under-covered priority is repaired or reported`, r.coverage.balanced || r.unresolved.length > 0)
  }
}

// ---------------------------------------------------------------------------
// 5. Plan helpers understand station groups
// ---------------------------------------------------------------------------
{
  const tee = drillOf('hitting'); const gb = drillOf('fielding (infield)')
  const plan = readPlan({
    blocks: [
      { type: 'warmup', title: 'Warm-up', minutes: 8 },
      { type: 'station', title: '2-Station Rotation', minutes: 17, groups: 2, rotation_minutes: 8,
        stations: [{ ...block(tee, 8), equipment: ['Tee', 'Baseballs'], coaching_cues: ['Hands inside'] },
                   { ...block(gb, 8), equipment: ['Gloves'], coaching_cues: ['Glove out front'] }] },
    ],
    priority_coverage: { priorities: [{ priority: 'hitting', label: 'Hitting', exposure_minutes: 8 }] },
  })
  const rows = scheduleRows(plan.blocks, '5:30pm')
  eq('a rotation is one row on the clock', rows.length, 2)
  eq('the rotation row spans its elapsed time', `${rows[1].from}–${rows[1].to}`, '5:38–5:55')
  eq('the rotation row lists its stations', rows[1].stations.length, 2)
  ok('station lines carry the rotation length', rows[1].stations[0].endsWith('— 8 min'), rows[1].stations[0])
  ok('equipment reaches the checklist from inside the rotation', equipmentChecklist(plan.blocks).some(e => /tee/i.test(e)))
  eq('flattenBlocks lists parent then children', flattenBlocks(plan.blocks).length, 4)
  ok('stored coverage is read back', plan.priority_coverage?.priorities?.[0]?.priority === 'hitting')
  ok('a bare-array plan has no coverage and does not crash', readPlan([{ type: 'drill', title: 'x', minutes: 5 }]).priority_coverage === null)
}

// ---------------------------------------------------------------------------
// 6. The route runs the check before the plan is shown
// ---------------------------------------------------------------------------
{
  const src = readFileSync('app/api/practice-plan/route.ts', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  ok('route evaluates coverage', src.includes('evaluatePriorityCoverage('))
  ok('route repairs before the skeleton is sent',
    src.indexOf('repairPriorityCoverage(') < src.indexOf("send({ type: 'skeleton'"))
  ok('route re-fits the clock after a repair', src.indexOf('fitBlocks(repaired.blocks') > 0)
  ok('route reserves priorities in the proposal', src.includes('priorities,') && src.includes('candidatesByPriority'))
  ok('route sends the coverage with the plan', src.includes('priority_coverage: priorityCoverage'))
  const prompt = readFileSync('lib/anthropic.ts', 'utf8')
  ok('the skeleton prompt asks for real reps per focus area', prompt.includes('EVERY FOCUS AREA THE COACH SELECTED GETS REAL REPS'))
  ok('the skeleton prompt defines a station block as one block', prompt.includes('STATION ROTATIONS ARE ONE BLOCK'))
}

console.log(`\npriority coverage: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
if (failures.length) process.exit(1)
