// The pathway layer's rules, asserted.
//
//   npm run test:pathways
//
// Pure — no database, no network. The fixtures are shaped like production and
// deliberately include the rows a pathway must never recommend, so "duplicates
// are excluded" is proved by the code refusing them rather than by nobody
// offering one.
//
// Numbering follows the 24 conditions in the Phase 2E brief. The ones a unit
// test cannot reach — build, typecheck, production row counts — are checked by
// other scripts and named at the bottom rather than quietly skipped.

import {
  loadPathways, orderedStages, currentStage, nextStage, previousStage,
  stageByKey, isFinalStage, describeStage, feasible, stageCandidates,
  rankStageDrills, sequenceStage, practiceStepFor, getPathwayPracticeRecommendation,
  planPracticeBlock, PRACTICE_SEQUENCE,
  LoadedPathway, PathwayStage, StageDrillLink, StageCandidate,
} from '../lib/developmentPathways'
import { DrillRecord } from '../lib/drills'

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

const drill = (over: Partial<DrillRecord>): DrillRecord => ({
  id: String(over.id),
  drill_name: 'Unnamed',
  est_duration_minutes: 10,
  ...over,
} as DrillRecord)

const TEE = drill({
  id: 'd-tee', drill_name: 'Tee Work', progression_level: 1,
  practice_roles: ['teach', 'repetition'], min_age: 6, max_age: 12,
  indoor_outdoor: 'Both', space_required: 'Small', equipment_needed: ['Tee', 'Baseballs'],
})
const SOFT = drill({
  id: 'd-soft', drill_name: 'Soft Toss', progression_level: 2,
  practice_roles: ['repetition'], min_age: 6, max_age: 12,
  indoor_outdoor: 'Both', space_required: 'Small',
})
const FRONT = drill({
  id: 'd-front', drill_name: 'Front Toss', progression_level: null,
  practice_roles: ['progress'], min_age: 7, max_age: 12,
  indoor_outdoor: 'Outdoor', space_required: 'Medium', min_players: 2,
})
const GAME = drill({
  id: 'd-game', drill_name: 'Battle Round', progression_level: 4,
  practice_roles: ['competition', 'game_application'], min_age: 11, max_age: 16,
  indoor_outdoor: 'Outdoor', space_required: 'Full Field', min_players: 9, min_coaches: 2,
})
const EASY = drill({
  id: 'd-easy', drill_name: 'Stance Drill', progression_level: 1,
  practice_roles: ['teach'], min_age: 6, max_age: 14,
  indoor_outdoor: 'Both', space_required: 'Small',
})

// The three a pathway must never recommend.
const COLLECTION = drill({ id: 'd-coll', drill_name: 'Ten Best Hitting Drills', resource_kind: 'source_collection' })
const TEACHING = drill({ id: 'd-teach', drill_name: 'Why Hitting Matters', resource_kind: 'teaching_content' })
const DUPLICATE = drill({ id: 'd-dupe', drill_name: 'Tee Work Copy', duplicate_of_drill_id: 'd-tee' })
const PRACTICE_UNIT = drill({
  id: 'd-unit', drill_name: 'Full Warm-Up Routine', resource_kind: 'practice_unit',
  practice_roles: ['warmup'],
})

const POOL = [TEE, SOFT, FRONT, GAME, EASY, COLLECTION, TEACHING, DUPLICATE, PRACTICE_UNIT]

const stage = (n: number, key: string, over: Partial<PathwayStage> = {}): PathwayStage => ({
  id: `s-${key}`, pathway_id: 'p1', stage_number: n, stage_key: key,
  name: key, objective: `Does the ${key} thing reliably and on purpose.`,
  why_it_matters: 'It matters.',
  prerequisite_stage_id: n > 1 ? null : null,
  mastery_signals: [`${key} holds up`], common_failure_modes: [`${key} collapses`],
  estimated_practices_min: 1, estimated_practices_max: 2,
  ...over,
} as PathwayStage)

const link = (stageId: string, drillId: string, role: any, rank = 1): StageDrillLink => ({
  stage_id: stageId, drill_id: drillId, role, rank,
  rationale: 'A rationale long enough to be a real one, explaining the fit.',
})

const S1 = stage(1, 'stance')
const S2 = stage(2, 'contact')
const S3 = stage(3, 'game')

const PATHWAY: LoadedPathway = {
  pathway: { id: 'p1', slug: 'build-the-swing', name: 'Build the Swing', skill_category: 'hitting', status: 'published' },
  stages: [S1, S2, S3],
  linksByStage: new Map([
    ['s-stance', [link('s-stance', 'd-easy', 'primary'), link('s-stance', 'd-unit', 'reinforcement')]],
    ['s-contact', [
      link('s-contact', 'd-tee', 'primary'),
      link('s-contact', 'd-soft', 'reinforcement'),
      link('s-contact', 'd-front', 'progression'),
      // The three that must not come out, offered on purpose.
      link('s-contact', 'd-coll', 'reinforcement'),
      link('s-contact', 'd-teach', 'reinforcement'),
      link('s-contact', 'd-dupe', 'reinforcement'),
    ]],
    ['s-game', [link('s-game', 'd-game', 'primary'), link('s-game', 'd-front', 'regression')]],
  ]),
  problemsByStage: new Map([
    ['s-stance', ['lunging']],
    ['s-contact', ['inconsistent-contact', 'casting']],
    ['s-game', ['two-strike-approach']],
  ]),
}

const cands = (s: PathwayStage, f = {}) => stageCandidates(PATHWAY, s, POOL, f)

// ── 1-2. pathways and stages are ordered and unique ─────────────────────────

eq('1. stages come back in order', orderedStages(PATHWAY).map(s => s.stage_number), [1, 2, 3])
check('1. order does not depend on input order', (() => {
  const shuffled: LoadedPathway = { ...PATHWAY, stages: [S3, S1, S2] }
  return orderedStages(shuffled).map(s => s.stage_number).join() === '1,2,3'
})())
check('2. stage numbers are unique', new Set(orderedStages(PATHWAY).map(s => s.stage_number)).size === 3)
check('2. stage keys are unique', new Set(orderedStages(PATHWAY).map(s => s.stage_key)).size === 3)
eq('2. a stage resolves by key', stageByKey(PATHWAY, 'contact')?.stage_number, 2)
eq('2. an unknown key resolves to null', stageByKey(PATHWAY, 'nope'), null)

// ── 3-7. what a stage may and may not recommend ─────────────────────────────

const contact = cands(S2)
eq('3. every candidate resolves to a supplied drill',
  contact.every(c => POOL.some(d => d.id === c.drill.id)), true)
check('4. recommendations use schedulable rows only',
  contact.every(c => !['d-coll', 'd-teach', 'd-dupe'].includes(c.drill.id)),
  contact.map(c => c.drill.id).join(', '))
check('5. duplicates are excluded', !contact.some(c => c.drill.id === 'd-dupe'))
check('6. source_collection is excluded', !contact.some(c => c.drill.id === 'd-coll'))
check('7. teaching_content is excluded', !contact.some(c => c.drill.id === 'd-teach'))
check('4. ...and the excluded ones WERE offered to the surface',
  (PATHWAY.linksByStage.get('s-contact') || []).length === 6,
  'if the fixture stopped offering them the test would prove nothing')

// practice_unit follows the caller's option, the same as everywhere else.
check('4. a practice_unit is included by default',
  cands(S1).some(c => c.drill.id === 'd-unit'))
check('4. ...and excluded when the caller says so',
  !stageCandidates(PATHWAY, S1, POOL, {}, { practiceUnits: false })
    .some(c => c.drill.id === 'd-unit'))

// ── 8-9. several roles, and regressions stay selectable ─────────────────────

eq('8. a stage supports several legitimate roles',
  Array.from(new Set(contact.map(c => c.role))).sort(), ['primary', 'progression', 'reinforcement'])
check('9. a schedulable regression remains selectable',
  cands(S3).some(c => c.role === 'regression' && c.drill.id === 'd-front'))

// ── 10. video is not required ───────────────────────────────────────────────

check('10. a drill with no video is still recommended',
  contact.every(c => !c.drill.youtube_video_id) && contact.length > 0,
  'no fixture has a video and the stage still returns candidates')

// ── 11-13. navigation ───────────────────────────────────────────────────────

eq('11. the current stage resolves', currentStage(PATHWAY, 2)?.stage_key, 'contact')
eq('11. no stage number means the first', currentStage(PATHWAY, null)?.stage_number, 1)
eq('11. a stage number past the end clamps', currentStage(PATHWAY, 99)?.stage_number, 3)
eq('11. a nonsense stage number means the first', currentStage(PATHWAY, -4)?.stage_number, 1)
eq('12. the next stage resolves', nextStage(PATHWAY, 1)?.stage_key, 'contact')
eq('13. the final stage has no next stage', nextStage(PATHWAY, 3), null)
check('13. ...and says so', isFinalStage(PATHWAY, 3))
check('13. a middle stage is not final', !isFinalStage(PATHWAY, 2))
eq('13. the first stage has no previous stage', previousStage(PATHWAY, 1), null)
eq('12. a middle stage can regress', previousStage(PATHWAY, 2)?.stage_key, 'stance')
eq('11. the position reads correctly', describeStage(PATHWAY, 2), 'Stage 2 of 3 — contact')

// ── 14-15. feasibility is a TRUE filter ─────────────────────────────────────

check('14. an age outside the band excludes', !feasible(GAME, { playerAge: 8 }))
check('14. an age inside the band keeps', feasible(GAME, { playerAge: 12 }))
check('14. an unknown age keeps everything', feasible(GAME, {}))
check('14. a drill with no age band is never excluded by age',
  feasible(drill({ id: 'x' }), { playerAge: 8 }))
check('15. too few players excludes', !feasible(GAME, { playerCount: 6 }))
check('15. enough players keeps', feasible(GAME, { playerCount: 12 }))
check('15. too few coaches excludes', !feasible(GAME, { coachCount: 1 }))
check('15. a drill with no min_coaches is never excluded by coaches',
  feasible(TEE, { coachCount: 1 }))
check('15. indoor excludes an outdoor-only drill', !feasible(FRONT, { environment: 'indoor' }))
check('15. indoor keeps a Both drill', feasible(TEE, { environment: 'indoor' }))
check('15. a small space excludes a full-field drill', !feasible(GAME, { space: 'small' }))
check('15. equipment the coach lacks excludes', !feasible(TEE, { equipment: ['Gloves'] }))
check('15. equipment the coach has keeps', feasible(TEE, { equipment: ['Tee', 'Baseballs'] }))

// Regression, found by this test rather than by a reader. spaceEligible ranked
// 'outfield/large' and 'field' and had no row for 'full field' — which is the
// commonest large value in the library, on 18 of the 154 schedulable drills. An
// unrecognised value falls through "unknown passes", so a coach with a corner
// of a gym was still being offered the Base Running Circuit.
//
// Asserted against the values PRODUCTION holds, not against the lookup table,
// so the next forgotten spelling fails here instead of passing silently.
const PRODUCTION_SPACE_VALUES: Array<[string, boolean]> = [
  // value as stored            may a small-space coach run it?
  ['Small', true],
  ['Medium', false],
  ['Medium-large', false],
  ['Full Field', false],
  ['Full field', false],
  ['Outfield/large', false],
]
for (const [value, smallOk] of PRODUCTION_SPACE_VALUES) {
  check(`15. "${value}" is ${smallOk ? 'runnable' : 'excluded'} in a small space`,
    feasible(drill({ id: 's', space_required: value }), { space: 'small' }) === smallOk,
    `spaceEligible does not recognise "${value}"`)
}
check('15. a medium space allows medium but not a full field',
  feasible(drill({ id: 's', space_required: 'Medium' }), { space: 'medium' }) &&
  !feasible(drill({ id: 's', space_required: 'Full Field' }), { space: 'medium' }))
check('15. a genuinely unknown space value still passes',
  feasible(drill({ id: 's', space_required: 'the moon' }), { space: 'small' }))

eq('15. feasibility narrows a stage rather than emptying it',
  cands(S2, { environment: 'indoor' }).map(c => c.drill.id).sort(), ['d-soft', 'd-tee'])

// ── 16. difficulty ranks, it does not exclude ───────────────────────────────

const mixed = cands(S3, {})
check('16. an advanced drill is not excluded by difficulty',
  mixed.some(c => c.drill.id === 'd-game'),
  'progression_level 4 must still be offered')
check('16. difficulty orders within a role', (() => {
  const same: StageCandidate[] = [
    { drill: GAME, role: 'reinforcement', rank: 1, rationale: 'x', difficulty: 3 },
    { drill: TEE, role: 'reinforcement', rank: 1, rationale: 'x', difficulty: 1 },
  ]
  return rankStageDrills(same)[0].drill.id === 'd-tee'
})())
check('16. role outranks difficulty', (() => {
  const same: StageCandidate[] = [
    { drill: TEE, role: 'progression', rank: 1, rationale: 'x', difficulty: 1 },
    { drill: GAME, role: 'primary', rank: 1, rationale: 'x', difficulty: 3 },
  ]
  return rankStageDrills(same)[0].role === 'primary'
})())
check('16. ranking is stable between identical calls',
  JSON.stringify(cands(S2).map(c => c.drill.id)) ===
  JSON.stringify(cands(S2).map(c => c.drill.id)))

// ── sequence intelligence ───────────────────────────────────────────────────

eq('sequence steps are the ones the brief names', PRACTICE_SEQUENCE,
  ['prepare', 'teach', 'isolate', 'repeat', 'progress', 'decide', 'compete', 'apply'])
eq('a warmup practice_role maps to prepare',
  practiceStepFor({ drill: PRACTICE_UNIT, role: 'reinforcement', rank: 1, rationale: 'x', difficulty: 1 }),
  'prepare')
eq('a drill with no practice_roles falls back to its stage role',
  practiceStepFor({ drill: drill({ id: 'y' }), role: 'progression', rank: 1, rationale: 'x', difficulty: 1 }),
  'progress')
check('a stage sequences teach before progress', (() => {
  const steps = sequenceStage(cands(S2)).map(s => s.step)
  return steps.indexOf('teach') < steps.indexOf('progress')
})())
check('a drill holding two roles appears once', (() => {
  const twoRoles: LoadedPathway = {
    ...PATHWAY,
    linksByStage: new Map([['s-contact', [
      link('s-contact', 'd-tee', 'primary'),
      link('s-contact', 'd-tee', 'assessment'),
    ]]]),
  }
  return sequenceStage(stageCandidates(twoRoles, S2, POOL)).length === 1
})())

// ── 17-18. the recommendation ───────────────────────────────────────────────

const rec = getPathwayPracticeRecommendation({ pathway: PATHWAY, currentStage: 2, pool: POOL })!
check('the recommendation names the stage and objective',
  rec.stage.name === 'contact' && rec.stage.objective.length > 20)
eq('the recommendation reports position', [rec.stage.number, rec.stage.total], [2, 3])
check('the recommendation returns drill ids and roles',
  rec.recommended.length === 3 && rec.recommended.every(r => !!r.drillId && !!r.role))
check('every recommended drill carries its reason',
  rec.recommended.every(r => r.rationale.length > 20))
check('18. every READY stage carries a mastery signal',
  rec.assessment.masterySignals.length > 0)
check('the recommendation names the next stage', rec.nextStage?.key === 'game')
check('the recommendation names what to regress to', rec.regressTo?.key === 'stance')
check('the final stage recommends no next stage',
  getPathwayPracticeRecommendation({ pathway: PATHWAY, currentStage: 3, pool: POOL })!.nextStage === null)
check('the rationale is plain language',
  rec.rationale.includes('Build the Swing') && rec.rationale.includes('teaching order'))
check('nothing recommended is unschedulable',
  rec.recommended.every(r => !['d-coll', 'd-teach', 'd-dupe'].includes(r.drillId)))

const tight = getPathwayPracticeRecommendation({
  pathway: PATHWAY, currentStage: 2, pool: POOL, durationMinutes: 15,
})!
check('a time budget trims from the end',
  tight.recommended.length < rec.recommended.length && tight.recommended.length >= 1)
check('...and says how many were left out',
  tight.warnings.some(w => /left out to fit/.test(w)))
check('a time budget never returns an empty stage',
  getPathwayPracticeRecommendation({
    pathway: PATHWAY, currentStage: 2, pool: POOL, durationMinutes: 1,
  })!.recommended.length === 1)

const impossible = getPathwayPracticeRecommendation({
  pathway: PATHWAY, currentStage: 3, pool: POOL, playerCount: 2, coachCount: 1, space: 'small',
})!
check('an unrunnable stage says so rather than returning nothing',
  impossible.warnings.some(w => /ruled out/.test(w)) || impossible.recommended.length > 0)

const mismatched = getPathwayPracticeRecommendation({
  pathway: PATHWAY, currentStage: 1, pool: POOL, currentProblems: ['two-strike-approach'],
})!
check('a problem addressed by another stage is flagged',
  mismatched.warnings.some(w => /addressed by stage 3/.test(w)),
  mismatched.warnings.join(' | '))
const unknownProblem = getPathwayPracticeRecommendation({
  pathway: PATHWAY, currentStage: 1, pool: POOL, currentProblems: ['no-changeup'],
})!
check('a problem on no stage of this pathway is flagged',
  unknownProblem.warnings.some(w => /not addressed anywhere/.test(w)))

// ── 17. a three-practice block avoids needless repetition ───────────────────

const block = planPracticeBlock(PATHWAY, 2, 3, POOL, {}, 1)
eq('17. a three-practice block returns three practices', block.length, 3)
check('17. consecutive practices use different drills where alternatives exist', (() => {
  const inStage2 = block.filter(b => b.stageNumber === 2)
  const ids = inStage2.flatMap(b => b.drills.map(d => d.drillId))
  return new Set(ids).size === ids.length
})(), JSON.stringify(block.map(b => b.drills.map(d => d.drillName))))
check('17. a stage with one option repeats it and says so', (() => {
  const thin: LoadedPathway = {
    ...PATHWAY,
    stages: [stage(1, 'only', { estimated_practices_min: 3 })],
    linksByStage: new Map([['s-only', [link('s-only', 'd-tee', 'primary')]]]),
    problemsByStage: new Map(),
  }
  const b = planPracticeBlock(thin, 1, 3, POOL, {}, 1)
  return b.length === 3 && b.slice(1).some(x => /repeated/.test(x.note))
})())
check('17. a block advances through stages rather than parking',
  new Set(planPracticeBlock(PATHWAY, 1, 6, POOL, {}, 1).map(b => b.stageNumber)).size > 1)
check('17. a block never advances past the final stage',
  planPracticeBlock(PATHWAY, 1, 12, POOL, {}, 1).every(b => b.stageNumber <= 3))

// ── 2E.8's six questions ────────────────────────────────────────────────────

check('what stage are we on?', describeStage(PATHWAY, 2).startsWith('Stage 2 of 3'))
check('what should we teach next?', nextStage(PATHWAY, 2)?.objective !== undefined)
check('which drills reinforce it?', cands(S2).some(c => c.role === 'reinforcement'))
check('how do we assess mastery?', (PATHWAY.stages[1].mastery_signals || []).length > 0)
check('when should we advance?', rec.assessment.masterySignals.length > 0)
check('what do we regress to?', rec.regressTo !== null)

// ── 19-21. nothing else changes ─────────────────────────────────────────────
//
// These are the "no regression" conditions. Two of them are about code that is
// not imported here at all, which is the strongest form of the guarantee: the
// pathway layer cannot change Practice Plan's behaviour because Practice Plan
// does not call it unless asked.

check('19. this module writes nothing', (() => {
  const src = require('fs').readFileSync(__dirname + '/../lib/developmentPathways.ts', 'utf8')
  return !/\.(insert|update|upsert|delete)\s*\(/.test(src)
})(), 'lib/developmentPathways.ts contains an insert/update/delete call')

check('20. a missing pathway returns null rather than throwing', (() => {
  return currentStage(null, 1) === null && nextStage(null, 1) === null
})())
check('20. an empty pathway recommends nothing rather than crashing', (() => {
  const empty: LoadedPathway = {
    pathway: PATHWAY.pathway, stages: [], linksByStage: new Map(), problemsByStage: new Map(),
  }
  return getPathwayPracticeRecommendation({ pathway: empty, pool: POOL }) === null
})())
check('21. a stage with no drills yields a warning, not an exception', (() => {
  const bare: LoadedPathway = {
    ...PATHWAY, linksByStage: new Map(), problemsByStage: new Map(),
  }
  const r = getPathwayPracticeRecommendation({ pathway: bare, currentStage: 1, pool: POOL })!
  return r.recommended.length === 0 && r.warnings.length > 0
})())

// loadPathways swallows a missing table the way the media layer does.
;(async () => {
  const brokenClient = { from() { throw new Error('relation does not exist') } }
  const got = await loadPathways(brokenClient as any)
  check('20. a database without migration 069 costs the feature, not the page',
    Array.isArray(got) && got.length === 0)

  console.log(`\n${passed} passed, ${failures.length} failed\n`)
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`)
    console.log('')
    process.exit(1)
  }
  console.log('Checked elsewhere, deliberately not faked here:')
  console.log('  3. stage refs resolve to real rows   npm run test:migration-070')
  console.log('  19. historical plans still resolve   npm run test:canon-history')
  console.log('  22. build passes                     npm run build')
  console.log('  23. typecheck baseline               npm run typecheck:baseline')
  console.log('  24. zero drill rows deleted          npm run verify:pathways-prod')
  console.log('')
})()
