// Does the instruction gate hold, and does the audit cover what it claims to?
//
// Two kinds of check live here, and they fail for different reasons.
//
// The first kind is about the RULE: a one-line drill has to fail, filler has to
// fail, a real drill has to pass, and a coach's own note has to be left alone.
// These run on fixtures because the point is the boundary, and a boundary is
// only testable with cases that sit either side of it on purpose.
//
// The second kind is about the LIBRARY: every schedulable curated row appears
// in the audit, demoted rows and duplicates do not, and nothing that the phase
// promised not to touch has been touched. These read the committed audit CSV
// and the pending fixture, so they fail when the data drifts rather than when
// somebody's opinion changes.
//
//   npm run test:instruction-quality
//
// No network. Everything it reads is committed.

import { readFileSync, existsSync } from 'fs'
import {
  describesAnActivity, describesAVideo, isInstructionReady, instructionTier,
  missingPieces, findBoilerplate, GateContext,
} from '../lib/drillInstructions'

const AUDIT = 'docs/audits/drill-instruction-quality.csv'
const FIXTURE = 'scripts/fixtures/drill-instructions.json'
const SNAPSHOT = 'scripts/fixtures/drill-library-snapshot.json'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** A real CSV parser. A split on commas would silently mis-column every quoted note. */
function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const header = rows.shift()!
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

console.log('\nTHE RULE\n')

// ── 4. a thin one-line curated activity fails ────────────────────────────────
// This is the shape the library was full of: a real sentence, correctly
// spelled, that tells a coach nothing they could act on.
const thin = {
  drill_name: 'High Tee',
  description: 'Tee set high to practice high-pitch swings.',
  ai_coaching_notes: 'Short, quick path.',
}
check('a one-line curated activity fails the gate', !isInstructionReady(thin))
check('and is tiered THIN', instructionTier(thin) === 'THIN')

// ── 6. filler does not pass ──────────────────────────────────────────────────
// Each of these is long enough to beat a naive character threshold, which is
// the whole reason the gate is not one.
const fillers = [
  'Work on proper batting stance fundamentals and technique for young players.',
  'Practice proper throwing mechanics with correct form and good fundamentals.',
  'Comprehensive instruction covering essential baseball hitting fundamentals.',
  'A drill for improving player performance.',
]
for (const description of fillers) {
  check(`filler rejected: "${description.slice(0, 42)}..."`,
    !describesAnActivity({ drill_name: 'X', description }))
}

// ── the description that only restates the title ─────────────────────────────
check('a description that is just the drill name restated fails',
  !describesAnActivity({
    drill_name: 'Outfield Drop Step Drill',
    description: 'The outfield drop step drill, for the outfield drop step.',
  }))

// ── 5. a meaningful description with coaching detail passes ──────────────────
const real = {
  drill_name: 'Protect the Castle',
  description:
    'A fielder stands in front of an object — a cone, a bucket, a helmet — that is their castle. ' +
    'The coach rolls ground balls to either side and the fielder moves laterally to field the ball ' +
    'before it reaches the castle. Scoring is obvious to a six-year-old and the fielding position ' +
    'takes care of itself, because a player defending something naturally gets low.',
  ai_coaching_notes:
    'Roll from about fifteen feet and alternate sides without announcing which. Keep score out loud.',
  success_markers: ['Gets the body in front rather than reaching sideways', 'Stays low between rolls'],
  regression_notes: 'Narrow the castle and roll slower.',
}
check('a real drill with cues and markers passes', isInstructionReady(real))
check('and reaches READY', instructionTier(real) === 'READY')

// ── 3 (rule side). video framing is rejected however concrete it is ──────────
const videoFramed = {
  drill_name: 'Throwing Progression',
  description:
    'Coach Duke and Coach Steve from Dominate the Diamond walk through the three-phase throwing ' +
    'progression: kneeling throw to isolate arm action, hip-width stance to add torso rotation, ' +
    'and full throw with stride. Endorsed by WYAA as a top youth throwing resource.',
  ai_coaching_notes: 'We build your throw in three steps, adding one piece at a time until it works together.',
}
check('prose about a video is rejected despite being long and concrete', !isInstructionReady(videoFramed))
check('and describesAVideo says why', describesAVideo(videoFramed))
check('missingPieces names the video framing specifically',
  missingPieces(videoFramed).some(p => p.includes('about the video')))

// ── boilerplate cues shared across a category do not count as cues ───────────
const shared = 'Cue: low hips, quiet head; field out front; quick exchange.'
const bodyText =
  'The coach rolls ground balls from about twenty feet and the fielder works around a cone, ' +
  'fields off the glove-side foot, and throws to a target at first base before the next rep starts.'
const a = { drill_name: 'A', description: bodyText, ai_coaching_notes: shared }
const b = { drill_name: 'B', description: bodyText, ai_coaching_notes: shared }
const ctx: GateContext = { boilerplate: findBoilerplate([a, b]) }
check('a cue copied onto two drills is detected as boilerplate', ctx.boilerplate!.has(shared))
check('a row whose only cue is boilerplate fails the gate', !isInstructionReady(a, ctx))
check('the same row passes when the cue is its own',
  isInstructionReady({ ...a, ai_coaching_notes: 'Roll from fifteen feet and alternate sides without saying which.' }, ctx))
check('boilerplate detection ignores a cue used only once',
  !findBoilerplate([a, { drill_name: 'C', description: bodyText, ai_coaching_notes: 'Something else entirely, said once.' }])
    .has('Something else entirely, said once.'))

// ── 7. coach-authored rows are exempt ────────────────────────────────────────
// A coach writing down their own station owes nobody a success marker. If this
// ever fails, the gate has started grading users' work instead of ours.
const coachDrill = {
  drill_name: 'Tuesday infield thing',
  description: 'the one where they line up',
  created_by_coach_id: '11111111-1111-1111-1111-111111111111',
}
check('a coach-authored drill is never blocked by the curated gate', isInstructionReady(coachDrill))
check('even when its description would otherwise fail outright',
  !describesAnActivity(coachDrill) && isInstructionReady(coachDrill))

// ── the vocabulary fixes, kept as regressions ────────────────────────────────
// Both of these were real false negatives. They are here so the list cannot
// quietly lose the words again.
check('"charge, field on the run, throw on the move" is recognised as an activity',
  describesAnActivity({
    drill_name: 'Three-Ball Slow Roller Drill',
    description:
      'Rapid-fire three-ball slow roller drill: charge, field on the run, and throw on the move ' +
      'under time pressure — the do-or-die play against fast runners.',
  }))
check('a conditioning routine is recognised as an activity',
  describesAnActivity({
    drill_name: 'Baseball Dynamic Stretches for Youth Players',
    description:
      'A moving warm-up built around leg swings forward and sideways, walking lunges with a trunk ' +
      'rotation, arm swings across the body, hip openers, and slow trunk twists, done over about ' +
      'fifteen yards each rather than held.',
  }))
check('a plural noun counts the same as its singular',
  describesAnActivity({
    drill_name: '4-Part Windup Drill',
    description:
      'The complete pitching motion is broken into four distinct parts. Pitchers perform each part ' +
      'in slow motion, stopping to check the balance point, the stride, the arm separation and the ' +
      'release before moving to the next one.',
  }))

console.log('\nTHE LIBRARY\n')

// ── 1. every schedulable curated row is in the audit ─────────────────────────
if (!existsSync(AUDIT)) {
  check('the instruction audit exists', false, `${AUDIT} not found — run npm run audit:instructions`)
} else {
  const audit = readCsv(readFileSync(AUDIT, 'utf8'))
  check('the audit has one row per schedulable curated activity', audit.length === 154,
    `${audit.length} rows`)

  const ids = new Set(audit.map(r => r.drill_id))
  check('no drill appears twice in the audit', ids.size === audit.length)

  // ── 2. demoted kinds are excluded ──────────────────────────────────────────
  const demoted = audit.filter(r =>
    r.resource_kind === 'source_collection' || r.resource_kind === 'teaching_content')
  check('no source_collection or teaching_content row is held to the instruction target',
    demoted.length === 0, `${demoted.length} found`)

  // ── 3. true duplicates are excluded ────────────────────────────────────────
  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as any[]
    const dupes = snap.filter(d => d.duplicate_of_drill_id)
    const leaked = dupes.filter(d => ids.has(d.id))
    check('no true duplicate appears in the discovery target', leaked.length === 0,
      leaked.map(d => d.drill_name).join(', '))
    check('the snapshot still holds every curated row', snap.length === 220, `${snap.length} rows`)

    // ── 12. nothing was deleted ─────────────────────────────────────────────
    const demotedInSnap = snap.filter(d =>
      ['source_collection', 'teaching_content'].includes(String(d.resource_kind || ''))).length
    check('demoted rows still exist rather than having been removed', demotedInSnap > 0,
      `${demotedInSnap} demoted rows retained`)
    check('schedulable + demoted + duplicates accounts for the whole library',
      154 + demotedInSnap + dupes.length === snap.length,
      `154 + ${demotedInSnap} + ${dupes.length} vs ${snap.length}`)

    // ── 10. media columns are untouched by this phase ───────────────────────
    const withVideo = snap.filter(d => d.youtube_video_id).length
    check('videos are still on file and untouched by the instruction work', withVideo > 0,
      `${withVideo} rows carry a video`)
    const anyTimestamp = snap.filter(d => d.youtube_start_seconds != null).length
    check('no drill gained a timestamp in this phase', anyTimestamp === 0,
      `${anyTimestamp} rows carry a start time`)
  } else {
    check('the library snapshot exists', false, `${SNAPSHOT} not found`)
  }
}

// ── the written work itself ──────────────────────────────────────────────────
if (!existsSync(FIXTURE)) {
  check('the instruction fixture exists', false, `${FIXTURE} not found`)
} else {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as any[]
  check('every written entry records where its content came from',
    fixture.every(e => String(e.source || '').trim()),
    fixture.filter(e => !String(e.source || '').trim()).map(e => e.drill_name).join(', '))

  const seen = new Set<string>()
  const dup = fixture.filter(e => seen.size === seen.add(e.drill_id).size)
  check('no drill is written twice in the fixture', dup.length === 0,
    dup.map(e => e.drill_name).join(', '))

  // The fixture is allowed to write text and nothing else. A media or taxonomy
  // key appearing here would be applied by the emitter without further comment.
  const ALLOWED = new Set([
    'drill_id', 'drill_name', 'source', 'description', 'ai_coaching_notes',
    'success_markers', 'equipment_needed', 'practice_roles', 'regression_notes',
    'progression_notes', 'advanced_progression_notes', 'safety_notes', 'reps_guidance',
  ])
  const strayKeys = fixture.flatMap(e => Object.keys(e).filter(k => !ALLOWED.has(k)).map(k => `${e.drill_name}.${k}`))
  check('the fixture writes no field outside the agreed text set', strayKeys.length === 0,
    strayKeys.join(', '))

  // Nothing written may be a restatement of another row's text — that is how
  // boilerplate gets reintroduced by the same process that removed it.
  const cues = fixture.map(e => String(e.ai_coaching_notes || '').trim()).filter(Boolean)
  const cueDupes = cues.filter((c, i) => cues.indexOf(c) !== i)
  check('no coaching cue is reused across written rows', cueDupes.length === 0,
    `${cueDupes.length} repeated`)

  const descs = fixture.map(e => String(e.description || '').trim()).filter(Boolean)
  const descDupes = descs.filter((d, i) => descs.indexOf(d) !== i)
  check('no description is reused across written rows', descDupes.length === 0,
    `${descDupes.length} repeated`)

  // ── 8 (phase claim). no timestamp or media language snuck into the writing ─
  const fabricated = fixture.filter(e =>
    /\b\d+:\d\d\b/.test(String(e.description || '') + String(e.ai_coaching_notes || '')))
  check('no written instruction contains a video timestamp', fabricated.length === 0,
    fabricated.map(e => e.drill_name).join(', '))
}

console.log(`\n${passed} passed, ${failures.length} failed\n`)
if (failures.length) { for (const f of failures) console.log(`  ${f}`); process.exit(1) }
