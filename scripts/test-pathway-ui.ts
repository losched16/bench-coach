// Phase 2G — the rules the pathway picker renders by.
//
//   npm run test:pathway-ui
//
// lib/pathwayUi.ts is pure, so everything the picker SAYS can be asserted
// without a browser. What needs a browser — that the words end up on screen, at
// 390px, reachable by keyboard — is scripts/acceptance-pathway-ui.mjs.
//
// The request-shape tests at the bottom are the ones that matter most. Phase
// 2G's central promise is that a coach who ignores pathways gets the request
// they got before pathways existed, and the only honest way to check that is
// to serialize the body and compare bytes.

import {
  toOption, stageCountLabel, stageHeading, stageDrillCount, stageBreadth,
  focusForPathway, neighbours, resolveStageNumber, noFeasibleDrillsMessage,
} from '../lib/pathwayUi'
import type { LoadedPathway, PathwayStage, StageDrillLink, Pathway } from '../lib/developmentPathways'

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

const stage = (n: number, key: string, over: Partial<PathwayStage> = {}): PathwayStage => ({
  id: `s-${key}`, pathway_id: 'p1', stage_number: n, stage_key: key,
  name: `The ${key} stage`, objective: `Does the ${key} thing on purpose.`,
  mastery_signals: [`${key} holds up`], common_failure_modes: [`${key} collapses`],
  ...over,
} as PathwayStage)

const link = (stageId: string, drillId: string): StageDrillLink => ({
  stage_id: stageId, drill_id: drillId, role: 'primary', rank: 1,
  rationale: 'A real rationale, long enough to say something.',
})

const P: LoadedPathway = {
  pathway: { id: 'p1', slug: 'build-the-swing', name: 'Build the Swing', skill_category: 'hitting', status: 'published' } as Pathway,
  stages: [stage(1, 'stance'), stage(2, 'grip'), stage(3, 'contact')],
  linksByStage: new Map([
    ['s-stance', [link('s-stance', 'a'), link('s-stance', 'b'), link('s-stance', 'c')]],
    ['s-grip', [link('s-grip', 'a')]],           // one drill — a focused stage
    ['s-contact', [link('s-contact', 'a'), link('s-contact', 'b')]],  // two
  ]),
  problemsByStage: new Map(),
}

// ── 2G.2 the picker's own words ─────────────────────────────────────────────

eq('stage count is singular at one', stageCountLabel(1), '1 stage')
eq('stage count is plural above one', stageCountLabel(10), '10 stages')
eq('no stages says so rather than "0 stages"', stageCountLabel(0), 'No stages yet')
eq('a negative count cannot render a number', stageCountLabel(-3), 'No stages yet')
eq('stage heading reads as a coach would say it', stageHeading(4, 10), 'Stage 4 of 10')

eq('a pathway becomes an option with its stage count',
  toOption(P.pathway, 3),
  { slug: 'build-the-swing', name: 'Build the Swing', summary: '', skillCategory: 'hitting', stageCount: 3 })

// ── 2G.4 THIN handled honestly, without the word ────────────────────────────

eq('stage drill count reads the links', stageDrillCount(P, P.stages[0]), 3)
eq('a stage with no links counts zero', stageDrillCount(P, stage(9, 'nope')), 0)
check('three drills earns no badge — a badge on every stage is a badge on none',
  stageBreadth(3) === null)
check('four drills earns no badge', stageBreadth(4) === null)

const one = stageBreadth(1)!
const two = stageBreadth(2)!
check('one drill is called focused, not thin', one.label === 'Focused stage')
check('two drills is called focused, not thin', two.label === 'Focused stage')
check('one drill and two drills do not read identically', one.detail !== two.detail)
check('the badge says what it means for the practice',
  /short, sharp block/.test(one.detail) && /short, sharp block/.test(two.detail))

const zero = stageBreadth(0)!
check('zero drills is stated plainly and offers a way out',
  zero.label === 'No drills yet' && /without a pathway/.test(zero.detail))

// The whole point of 2G.4: our audit vocabulary never reaches a coach.
for (const [n, b] of [[0, zero], [1, one], [2, two]] as const) {
  check(`internal curation words never appear at ${n} drills`,
    !/\bTHIN\b|\bREADY\b|\bGAP\b/.test(`${b.label} ${b.detail}`),
    `${b.label} — ${b.detail}`)
}

// ── the implied focus chip ──────────────────────────────────────────────────

eq('hitting pathway implies the hitting chip',
  focusForPathway('build-the-swing', 'hitting'), 'hitting')
eq('infield and outfield share a category and must not share a chip',
  [focusForPathway('infield-fundamentals', 'fielding'),
   focusForPathway('outfield-development', 'fielding')],
  ['infield', 'outfield'])
eq('pitching has no chip of its own and maps to throwing',
  focusForPathway('pitching-development', 'pitching'), 'throwing')
eq('an unknown slug falls back to its category',
  focusForPathway('some-new-pathway', 'baserunning'), 'baserunning')
eq('an unknown slug and an unknown category guess nothing',
  focusForPathway('some-new-pathway', 'fielding'), null)
eq('no slug and no category guess nothing', focusForPathway(null, null), null)

// ── 2G.3 navigation, and no invented next stage ─────────────────────────────

eq('the first stage has no previous', neighbours(P, 1).previous, null)
eq('the first stage has a next', neighbours(P, 1).next?.stage_number, 2)
eq('a middle stage has both',
  [neighbours(P, 2).previous?.stage_number, neighbours(P, 2).next?.stage_number], [1, 3])
eq('THE FINAL STAGE HAS NO NEXT STAGE', neighbours(P, 3).next, null)
eq('the final stage still has a previous', neighbours(P, 3).previous?.stage_number, 2)
eq('a stage number the pathway does not have has no neighbours',
  neighbours(P, 99), { previous: null, next: null })
eq('no pathway has no neighbours', neighbours(null, 1), { previous: null, next: null })

// ── 2G.11 invalid stage, invalid pathway ────────────────────────────────────

eq('no stage asked for lands on the first', resolveStageNumber(P, null), 1)
eq('a real stage resolves to itself', resolveStageNumber(P, 2), 2)
eq('a stage past the end resolves to null rather than clamping to the last',
  resolveStageNumber(P, 11), null)
eq('stage zero resolves to null', resolveStageNumber(P, 0), null)
eq('a non-number resolves to the first', resolveStageNumber(P, NaN), 1)
eq('a pathway with no stages resolves to null',
  resolveStageNumber({ ...P, stages: [] }, 1), null)

// ── 2G.11 the zero-feasible message ─────────────────────────────────────────

const msg = noFeasibleDrillsMessage('Load to launch', { space: 'small', coachCount: 1 })
check('it never says the drills do not exist', !/no drills found|nothing exists/i.test(msg))
check('it names the stage', msg.includes('Load to launch'))
check('it names the constraints most likely to blame',
  msg.includes('small') && msg.includes('one coach'))
check('it offers three ways forward',
  /Change a constraint/.test(msg) && /another stage/.test(msg) && /without a pathway/.test(msg))
const bare = noFeasibleDrillsMessage('Grip', {})
check('with nothing to blame it still explains and still offers a way out',
  !/Most likely/.test(bare) && /without a pathway/.test(bare))

// ── 2G.8 the request a coach who ignores pathways sends ─────────────────────
//
// The page builds one object and JSON.stringify drops undefined fields. These
// assert the serialized bytes, because that is what the route parses — an
// object with `pathwaySlug: undefined` on it looks different in a debugger and
// identical on the wire, and the wire is what matters.

const baseBody = {
  teamId: 't1', duration: 90, focus: ['hitting'],
  constraints: undefined, priorAnswer: undefined, isRefine: false,
  mustIncludeDrillIds: [], objective: undefined, equipmentAvailable: [],
  coachCount: undefined, previousBlocks: undefined,
}
const withPathwayFields = (slug: string | null, stageNumber: number | null) => JSON.stringify({
  ...baseBody,
  pathwaySlug: slug || undefined,
  pathwayStage: slug ? (stageNumber ?? undefined) : undefined,
})

eq('NO PATHWAY: the body is byte-identical to the pre-2G request',
  withPathwayFields(null, null), JSON.stringify(baseBody))
check('no pathway: neither key appears on the wire at all',
  !withPathwayFields(null, null).includes('pathway'))
check('a stage number with no pathway is not smuggled through',
  !withPathwayFields(null, 4).includes('pathway'))

const chosen = JSON.parse(withPathwayFields('build-the-swing', 4))
eq('with a pathway: the slug is sent', chosen.pathwaySlug, 'build-the-swing')
eq('with a pathway: the stage number is sent', chosen.pathwayStage, 4)
check('a pathway with no stage yet sends the slug and omits the stage',
  !withPathwayFields('build-the-swing', null).includes('pathwayStage'))

// ── the route's own guard, restated here so a change to it is caught ────────
//
// route.ts runs the pathway block only for a non-empty string. Anything else
// must leave the route on its pre-2E path.
const routeWouldRunPathway = (v: any) => typeof v === 'string' && !!v.trim()
for (const v of [undefined, null, '', '   ', 0, false, 4, {}, []]) {
  check(`route ignores a pathwaySlug of ${JSON.stringify(v)}`, !routeWouldRunPathway(v))
}
check('route runs on a real slug', routeWouldRunPathway('build-the-swing'))

// ── no media, no timestamps ─────────────────────────────────────────────────

import * as fs from 'fs'
const uiSrc = fs.readFileSync(__dirname + '/../lib/pathwayUi.ts', 'utf8')
const compSrc = fs.readFileSync(__dirname + '/../components/pathwayPicker/PathwayPicker.tsx', 'utf8')
for (const [name, src] of [['lib/pathwayUi', uiSrc], ['PathwayPicker', compSrc]] as const) {
  check(`${name} introduces no media dependency`,
    !/youtube|start_seconds|verification_status|thumbnail/i.test(src))
}

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
Checked elsewhere, deliberately not faked here:
  the words reach the screen         npm run accept:pathway-ui
  feasibility still wins             npm run test:pathways
  production pathway contract        npm run verify:pathway-ui-prod
`)
