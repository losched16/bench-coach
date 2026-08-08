// Does the plan stage correctly?
//
// The failure modes here are quiet ones. A progression that puts every drill in
// step 1 has silently become the flat list it replaced. A progression that
// renumbers itself after a drill swap moves the goalposts under a parent who
// was told yesterday that step 2 is front toss. A clamp that lets current_step
// run past the end parks someone on a step that does not exist and shows them
// nothing.
//
// None of those throw. All of them are wrong.
//
//   npm run test:progression

import {
  buildSteps, resolveSteps, clampStep, stageOf, describeProgress, ProgressionDrill,
} from '@/lib/progression'

let failures = 0

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`ok   ${label}`)
  } else {
    failures++
    console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`)
  }
}

const d = (
  id: string,
  progression_level: number | null,
  success_markers: string[] = [],
  difficulty_level: string | null = null,
): ProgressionDrill => ({ id, drill_name: id, progression_level, success_markers, difficulty_level })

// ── stageOf ────────────────────────────────────────────────────────────────

check('curated progression_level wins', stageOf(d('a', 1, [], 'advanced')) === 1)
check('difficulty is the fallback', stageOf(d('b', null, [], 'advanced')) === 3)
check('beginner falls back to step 1', stageOf(d('c', null, [], 'beginner')) === 1)
check(
  'an unlabelled drill lands in the middle, not at the start',
  stageOf(d('e', null, [], null)) === 2,
  'placing it at 1 would tell a parent to start with a drill nobody graded',
)
check('a level above 3 is clamped, not dropped', stageOf(d('f', 7)) === 3)

// ── buildSteps ─────────────────────────────────────────────────────────────

const threeStage = buildSteps([
  d('tee', 1, ['Balanced stride he can hold still']),
  d('soft-toss', 2, ['Lets the ball travel and squares it up']),
  d('front-toss', 3, ['Line drives up the middle at game speed']),
])

check('three levels make three steps', threeStage.length === 3)
check('steps are numbered from 1', threeStage[0].n === 1 && threeStage[2].n === 3)
check('step 1 is the level-1 drill', threeStage[0].drillIds[0] === 'tee')
check('step 1 carries its gate', threeStage[0].moveOnWhen.length === 1)
check(
  'the last step has no gate',
  threeStage[2].moveOnWhen.length === 0,
  '"move on when" on the final step is a promise the plan cannot keep',
)

const twoInOne = buildSteps([
  d('tee-a', 1, ['Same marker']),
  d('tee-b', 1, ['Same marker']),
  d('live', 3, ['Holds up live']),
])
check('empty levels are dropped, not left as gaps', twoInOne.length === 2)
check('remaining steps renumber contiguously', twoInOne[1].n === 2)
check(
  'a shared marker is not listed twice',
  twoInOne[0].moveOnWhen.length === 1,
  'telling a parent to watch for the same thing twice reads as a bug',
)

const allSame = buildSteps([d('x', 2), d('y', 2), d('z', 2)])
check('drills at one level make one honest step', allSame.length === 1)
check('no drills, no steps', buildSteps([]).length === 0)

const noMarkers = buildSteps([d('p', 1), d('q', 2)])
check(
  'a step with no curated marker gets an empty gate, not an invented one',
  noMarkers[0].moveOnWhen.length === 0,
)

// ── resolveSteps ───────────────────────────────────────────────────────────

const drills = [d('tee', 1, ['m1']), d('soft', 2, ['m2']), d('front', 3, ['m3'])]
const stored = buildSteps(drills)

check(
  'stored steps survive when the drills have not changed',
  resolveSteps(stored, drills)[0] === stored[0],
  'a coach told "step 2 is soft toss" must not find it renumbered',
)

const swapped = [d('tee', 1, ['m1']), d('other', 2, ['m9']), d('front', 3, ['m3'])]
check(
  'a swapped drill rebuilds the steps',
  resolveSteps(stored, swapped)[1].drillIds[0] === 'other',
)

check('no stored steps derives them', resolveSteps(null, drills).length === 3)
check('empty stored steps derive them', resolveSteps([], drills).length === 3)

const dropped = [d('tee', 1, ['m1']), d('soft', 2, ['m2'])]
check(
  'removing a drill rebuilds rather than leaving a step pointing at nothing',
  resolveSteps(stored, dropped).length === 2,
)

// ── clampStep ──────────────────────────────────────────────────────────────

check('a step past the end clamps to the last one', clampStep(9, stored) === 3)
check('zero and negatives clamp to 1', clampStep(0, stored) === 1 && clampStep(-4, stored) === 1)
check('null means step 1', clampStep(null, stored) === 1)
check('no steps still answers 1', clampStep(3, []) === 1)
check(
  'a plan swapped down to fewer steps does not strand the coach',
  clampStep(3, resolveSteps(stored, dropped)) === 2,
)

// ── describeProgress ───────────────────────────────────────────────────────

check(
  'progress reads as a sentence',
  describeProgress(stored, 2) === 'Step 2 of 3 — Make it stick',
  describeProgress(stored, 2),
)
check('progress handles an out-of-range step', describeProgress(stored, 99).startsWith('Step 3 of 3'))
check('no drills says so', describeProgress([], 1) === 'No drills attached.')

console.log('')
if (failures > 0) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL PASS')
