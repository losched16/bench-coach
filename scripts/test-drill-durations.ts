// Does the duration model produce numbers a coach could plan a practice with,
// and does adding those numbers change anything about which drills come back?
//
// The second question is the important one. est_duration_minutes was already
// in DRILL_FIELDS before it held any values, so populating it puts a field
// that was uniformly null onto every scoring path at once. If a weight, a
// filter or a tiebreak reads it — now or by accident later — the whole
// retrieval surface shifts under a change that was supposed to be additive.
//
// So the invariance block below runs the twenty evaluation prompts against the
// library twice, once with durations and once without, and asserts the two
// runs are identical down to the score. It is the test that makes "this is a
// purely additive change" a fact rather than an intention.
//
//   npm run test:drill-durations

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
// @ts-ignore -- plain ESM, no types, deliberately runnable with bare node
import { estimateAll, totalReps, BUCKETS, CATEGORY_MODEL } from './estimate-drill-durations.mjs'

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
const DRILLS: any[] = FIX.drills
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

const { rows } = estimateAll(DRILLS)
const byId = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))

// ---------------------------------------------------------------------------
// 1. The rep parser
//
// These are the exact strings the library uses. Six of them originally parsed
// an order of magnitude low — "Pick 2 drills, 10 throws each" read as two reps
// — which is worth locking down, because the same 72 rows also set the
// category medians that the other 134 drills inherit.
// ---------------------------------------------------------------------------
eq('reps: sets of N', totalReps('3 sets of 8 bunts (sacrifice + for a hit)'), 24)
eq('reps: rounds of range', totalReps('4 rounds of 8-10 swings'), 36)
eq('reps: adjective between count and group', totalReps('2 situational rounds of 6 at-bat scenarios per session'), 12)
eq('reps: circuits counts as a group', totalReps('3 circuits of 3 balls per session'), 9)
eq('reps: N drills x M', totalReps('5 drills x 6 reps daily'), 30)
eq('reps: summed labelled terms', totalReps('3 rounds: 5 heavy + 5 light + 5 game-bat swings'), 45)
eq('reps: "each" multiplier', totalReps('Pick 2 drills, 10 throws each'), 20)
eq('reps: "each" after a walk-through', totalReps('Walk-through of 4 scenarios, then 2 live reps each'), 8)
eq('reps: bare range', totalReps('10-15 slides per session'), 12.5)
eq('reps: bare count', totalReps('10 secondary leads'), 10)
eq('reps: nothing to parse', totalReps(null), null)
eq('reps: prose with no number', totalReps('as many as the player can hold form for'), null)

// A hold cue is not a duration. This drill's reps_guidance says "freeze 2 sec
// on the stride" and its frequency_guidance says "5 min" — the seconds must be
// ignored and the minutes must win.
const stridePause = rows.find((r: any) => r.drill.drill_name === 'Stride Pause to Stride Swing Drill')
ok('the drill with both a seconds cue and a stated duration exists', !!stridePause)
eq('seconds cue is not read as a duration', stridePause?.est.minutes, 5)
eq('the stated duration is what makes it HIGH', stridePause?.est.confidence, 'HIGH')

// ---------------------------------------------------------------------------
// 2. Data quality — what the migration is about to write
// ---------------------------------------------------------------------------
eq('every drill gets a duration', rows.length, DRILLS.length)
ok('no nulls', rows.every((r: any) => r.est.minutes != null))
ok('no NaN', rows.every((r: any) => Number.isFinite(r.est.minutes)))
ok('all positive', rows.every((r: any) => r.est.minutes > 0))
ok('all integers', rows.every((r: any) => Number.isInteger(r.est.minutes)))
ok('all land in a declared bucket',
  rows.every((r: any) => BUCKETS.includes(r.est.minutes)),
  'a value outside BUCKETS means the rounding was bypassed')
ok('nothing absurdly long', rows.every((r: any) => r.est.minutes <= 20))
ok('nothing shorter than a water break', rows.every((r: any) => r.est.minutes >= 5))
ok('every drill id is unique', new Set(rows.map((r: any) => r.drill.id)).size === rows.length)

ok('every confidence is one of three',
  rows.every((r: any) => ['HIGH', 'MED', 'LOW'].includes(r.est.confidence)))
ok('every estimate carries its evidence',
  rows.every((r: any) => typeof r.est.evidence === 'string' && r.est.evidence.length > 10))

// The model must cover every category the library actually uses, or drills
// silently fall to a global default nobody chose for them.
const uncovered = Array.from(new Set(DRILLS.map(d => d.skill_category)))
  .filter(c => !(c in CATEGORY_MODEL))
ok('every skill_category has a model', uncovered.length === 0, `uncovered: ${uncovered.join(', ')}`)

// ---------------------------------------------------------------------------
// 3. Coherence
// ---------------------------------------------------------------------------

// A stated duration wins over anything computed.
for (const r of rows.filter((x: any) => x.est.confidence === 'HIGH')) {
  const stated = Number((r.est.evidence.match(/(\d+)/) || [])[1])
  ok(`stated duration respected: ${r.drill.drill_name.slice(0, 34)}`,
    Math.abs(r.est.minutes - stated) <= 3,
    `estimate ${r.est.minutes} vs stated ${stated}`)
}

// Named routines and progressions are blocks of work, never five minutes.
const BLOCKY = /\b(routine|program|series|system|package|progression|circuit)\b/i
for (const r of rows.filter((x: any) => BLOCKY.test(x.drill.drill_name))) {
  ok(`block-shaped drill is not trivially short: ${r.drill.drill_name.slice(0, 34)}`,
    r.est.minutes >= 10, `got ${r.est.minutes}`)
}

// Duplicate entries of the same drill must agree with each other.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
let dupPairs = 0
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j]
    if (!a.drill.youtube_video_id || a.drill.youtube_video_id !== b.drill.youtube_video_id) continue
    const na = norm(a.drill.drill_name), nb = norm(b.drill.drill_name)
    if (!(na.includes(nb) || nb.includes(na))) continue
    dupPairs++
    ok(`duplicates agree: "${a.drill.drill_name.slice(0, 26)}" / "${b.drill.drill_name.slice(0, 26)}"`,
      a.est.minutes === b.est.minutes, `${a.est.minutes} vs ${b.est.minutes}`)
  }
}
ok('duplicate pairs were actually found', dupPairs > 0, 'the coherence check matched nothing')

// A whole-team rep costs more than a swing off a tee. If this inverts, the
// per-rep constants have drifted into nonsense.
const medianFor = (cat: string) => {
  const v = rows.filter((r: any) => r.drill.skill_category === cat)
    .map((r: any) => r.est.minutes).sort((a: number, b: number) => a - b)
  return v[Math.floor(v.length / 2)]
}
ok('team defense costs more than hitting', medianFor('Team Defense') > medianFor('Hitting'),
  `${medianFor('Team Defense')} vs ${medianFor('Hitting')}`)
ok('a warmup is the short end', medianFor('Warmup') <= medianFor('Fielding (Infield)'))

// ---------------------------------------------------------------------------
// 4. Retrieval invariance
//
// The claim under test: populating est_duration_minutes is purely additive.
// Same drills, same order, same scores, same eligibility — before and after.
// ---------------------------------------------------------------------------
const PROMPTS = [
  'My 8-year-old keeps dropping his back shoulder when he swings.',
  'My hitter is lunging forward.',
  'My shortstop has a slow transfer.',
  'My 8-year-old is scared of fly balls.',
  'How do I help my pitcher throw harder?',
  'Need an indoor throwing drill for an 8-year-old.',
  'What can we work on in the backyard with a glove and baseballs?',
  'My player keeps stepping in the bucket.',
  'He casts his hands away from his body.',
  'My catcher can not block balls in the dirt.',
  'The kids throw sidearm and it looks awful.',
  'My son is afraid of getting hit by the pitch.',
  'We have no field time this week, just a gym.',
  'How do I teach a 7-year-old to slide?',
  'My outfielders take terrible routes to the ball.',
  'He has a really long swing path.',
  'What should we do for arm care before games?',
  'I am on my own with one kid and a bucket of balls.',
  'How do I get my team to stop making errors?',
  'What is a good drill for bunting?',
]

// The same library, with durations filled in. Everything else byte-identical.
const WITH_DURATION = DRILLS.map(d => ({ ...d, est_duration_minutes: byId.get(d.id) }))

ok('the with-duration library is fully populated',
  WITH_DURATION.every(d => typeof d.est_duration_minutes === 'number'))
ok('the baseline library has no durations',
  DRILLS.every(d => d.est_duration_minutes == null),
  'the fixture already carries durations — the invariance test would be vacuous')

function retrieveFor(library: any[], q: string) {
  const dx = diagnoseByAlias(q, PROBLEMS)
  const constraints: RetrievalConstraints = { ...constraintsFromText(q), playerAge: ageFromText(q) }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  return rankDrills(library, mapRows, {
    query: q, slugs: dx.slugs, categories: dx.categories, constraints, limit: 12,
  })
}

for (const q of PROMPTS) {
  const before = retrieveFor(DRILLS, q)
  const after = retrieveFor(WITH_DURATION, q)
  const label = q.slice(0, 40)

  eq(`invariant ids+order: "${label}"`,
    after.scored.map((s: any) => s.drill.id).join('|'),
    before.scored.map((s: any) => s.drill.id).join('|'))

  eq(`invariant scores: "${label}"`,
    after.scored.map((s: any) => s.reason.score.toFixed(4)).join('|'),
    before.scored.map((s: any) => s.reason.score.toFixed(4)).join('|'))

  eq(`invariant eligibility: "${label}"`,
    after.debug.candidateCountAfterFilters, before.debug.candidateCountAfterFilters)

  eq(`invariant path: "${label}"`, after.debug.retrievalPath, before.debug.retrievalPath)

  eq(`invariant filters: "${label}"`,
    after.debug.filtersApplied.join(','), before.debug.filtersApplied.join(','))
}

// And the durations do arrive on the returned records — invariance would also
// be satisfied by the field being dropped, which is not what we want.
const sample = retrieveFor(WITH_DURATION, 'My hitter is lunging forward.')
ok('retrieved drills carry their duration',
  sample.scored.length > 0 && sample.scored.every((s: any) => typeof s.drill.est_duration_minutes === 'number'))

// ---------------------------------------------------------------------------
console.log(`\ndrill durations: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
