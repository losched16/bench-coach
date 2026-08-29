// What practice does a coach actually get?
//
// The test suite asserts the arithmetic. This shows the practice — the budget
// broken down, the drills in the order they would be run, what each one costs,
// where it came from, and which strong candidates were turned away and why.
// A coach can read down the list and say "no, that third one is wrong", which
// no assertion is going to catch.
//
// It also answers three questions the scheduler is the only thing positioned
// to answer:
//
//   - Is the new retrieval actually better than the legacy category query, or
//     just different? (--compare)
//   - Which weakly-estimated drills does the planner actually lean on, so that
//     rep-guidance curation can be aimed rather than sprayed across 134 rows?
//   - How many scheduled drills open a shared video at 0:00, which is what
//     decides whether timestamp segmentation is worth doing next?
//
//   npm run eval:practice-plan
//   npm run eval:practice-plan -- --compare
//   npm run eval:practice-plan -- --verbose
//
// Runs against scripts/fixtures/drill-library.json. No database, no API key,
// no network, and therefore no way to change anything in production.
// Diagnosis uses the alias fallback, which UNDERSTATES quality — see the note
// at the end of the output.

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import { categoriesForPracticeFocus } from '@/lib/focusAreas'
import {
  computeBudget, schedulePractice, estimateBlockCount, Schedule,
} from '@/lib/practiceScheduler'
// @ts-ignore -- plain ESM, no types
import { estimateAll } from './estimate-drill-durations.mjs'

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

const { rows } = estimateAll(FIX.drills)
const MINUTES = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))
const CONF = new Map<string, string>(rows.map((r: any) => [r.drill.id, r.est.confidence]))
const EVIDENCE = new Map<string, string>(rows.map((r: any) => [r.drill.id, r.est.evidence]))
const LOW_IDS = new Set<string>(
  rows.filter((r: any) => r.est.confidence === 'LOW').map((r: any) => String(r.drill.id))
)
const DRILLS = FIX.drills.map((d: any) => ({ ...d, est_duration_minutes: MINUTES.get(d.id) }))

const argv = process.argv.slice(2)
const VERBOSE = argv.includes('--verbose')
const COMPARE = argv.includes('--compare')

// Videos backing more than one drill. The number that decides whether
// timestamp segmentation is the next phase or merely library tidying.
const VIDEO_USE = new Map<string, number>()
for (const d of DRILLS) {
  if (d.youtube_video_id) VIDEO_USE.set(d.youtube_video_id, (VIDEO_USE.get(d.youtube_video_id) || 0) + 1)
}

interface Scenario {
  name: string
  query: string
  focus: string[]
  minutes: number
  constraints?: Partial<RetrievalConstraints>
  why: string
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Hitting fault', query: 'My 8-year-old keeps dropping his back shoulder when he swings.',
    focus: ['hitting'], minutes: 60,
    why: 'the flagship taxonomy case — should build around the curated tee sequence',
  },
  {
    name: 'Infield transfer', query: 'My shortstop has a slow transfer. He is 10.',
    focus: ['infield'], minutes: 75,
    why: 'fielding, not hitting — proves the diagnosis discriminates',
  },
  {
    name: 'Fly-ball confidence', query: 'My 8-year-old is scared of fly balls.',
    focus: ['outfield'], minutes: 45,
    why: 'a thin problem with few mapped drills, at a short-ish budget',
  },
  {
    name: 'Pitching goal', query: 'How do I help my 11-year-old pitcher throw harder?',
    focus: ['throwing'], minutes: 60,
    why: 'a GOAL, not a flaw. Must not force a taxonomy match — category/text should carry it',
  },
  {
    name: 'Indoor session', query: 'hitting practice indoors in the gym, small space, 9 year olds',
    focus: ['hitting'], minutes: 30,
    constraints: { indoorOutdoor: 'indoor', spaceAvailable: 'small' },
    why: 'environment-constrained and short',
  },
  {
    name: 'Backyard solo', query: 'I am on my own with my 8-year-old, a glove and baseballs, small yard.',
    focus: ['hitting', 'throwing'], minutes: 30,
    why: 'solo + equipment inventory + small space',
  },
  {
    name: 'Full team practice', query: 'general team practice for our 10U team',
    focus: ['hitting', 'infield', 'throwing'], minutes: 90,
    why: 'no flaw at all — needs candidate depth across categories',
  },
]

// categoriesForPracticeFocus() returns [] for a focus it does not recognise,
// which reads downstream as "no category constraint" rather than as an error.
// That is the right runtime behaviour — absence is not a constraint — but in an
// evaluation harness it silently turns a fielding scenario into a library-wide
// one, which is exactly the false comparison this file exists to avoid. So the
// scenarios are checked against the real focus keys before anything runs.
for (const s of SCENARIOS) {
  const cats = categoriesForPracticeFocus(s.focus)
  if (cats.length === 0) {
    throw new Error(
      `Scenario "${s.name}" uses focus [${s.focus.join(', ')}], which maps to no drill ` +
      `category. The product's focus keys are hitting, throwing, catching, infield, ` +
      `outfield, baserunning, game iq, confidence, focus/behavior.`
    )
  }
}

function retrieveFor(s: Scenario) {
  const dx = diagnoseByAlias(s.query, PROBLEMS)
  const constraints: RetrievalConstraints = {
    ...constraintsFromText(s.query),
    playerAge: ageFromText(s.query),
    ...s.constraints,
  }
  const cats = categoriesForPracticeFocus(s.focus)
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  const out = rankDrills(DRILLS, mapRows, {
    query: s.query, slugs: dx.slugs,
    categories: dx.categories.length ? dx.categories : cats,
    constraints, limit: 30,
  })
  return { dx, ...out }
}

/**
 * The legacy path, reproduced offline.
 *
 * `skill_category ilike any(categoriesForPracticeFocus(focus))`, then
 * `.limit(45)` with no ordering — so the 45 were whichever 45 the database
 * returned first. Fixture order stands in for physical row order here, which
 * is the honest comparison: neither is meaningful, and that was the problem.
 */
function legacyFor(s: Scenario) {
  const cats = categoriesForPracticeFocus(s.focus).map(c => c.toLowerCase())
  const matched = DRILLS.filter((d: any) =>
    cats.length === 0 || cats.includes(String(d.skill_category || '').toLowerCase())
  )
  const pool = matched.length >= 8 ? matched : DRILLS
  return pool.slice(0, 45)
}

function schedule(s: Scenario): { sched: Schedule; ret: ReturnType<typeof retrieveFor> } {
  const ret = retrieveFor(s)
  const budget = computeBudget(s.minutes, { blockCount: estimateBlockCount(s.minutes) })
  return {
    sched: schedulePractice({ candidates: ret.scored, budget, lowConfidenceIds: LOW_IDS }),
    ret,
  }
}

function bar(label: string) {
  console.log('\n' + '='.repeat(80))
  console.log(label)
  console.log('='.repeat(80))
}

const lowUsage = new Map<string, { n: number; drill: any }>()
const selectedVideoStats = { total: 0, shared: 0, atZero: 0, sharedAtZero: 0 }

function render(s: Scenario) {
  const { sched, ret } = schedule(s)
  const b = sched.budget

  bar(`${s.name.toUpperCase()} — ${s.minutes} min`)
  console.log(`query      : "${s.query}"`)
  console.log(`why        : ${s.why}`)
  console.log(`focus      : ${s.focus.join(', ')}`)
  console.log(`diagnosis  : ${ret.dx.slugs.length ? ret.dx.slugs.join(', ') : '(no taxonomy match — goal or unrecognised)'}`)
  console.log(`path       : ${ret.debug.retrievalPath}`)
  console.log(`filters    : applied [${ret.debug.filtersApplied.join(', ') || '—'}]  skipped [${ret.debug.filtersSkipped.join(', ') || '—'}]`)
  console.log(`pool       : ${ret.debug.candidateCountBeforeFilters} library -> ${ret.debug.candidateCountAfterFilters} eligible -> ${ret.debug.returned} retrieved`)
  console.log('')
  console.log(`requested          ${String(b.requested).padStart(4)} min`)
  console.log(`  non-drill blocks ${String(b.nonDrill).padStart(4)} min   (warm-up, game, cool-down)`)
  console.log(`  transitions      ${String(b.transitions).padStart(4)} min   (${estimateBlockCount(s.minutes) - 1} seams)`)
  console.log(`  drill budget     ${String(b.drillBudget).padStart(4)} min`)
  console.log(`scheduled drills   ${String(sched.scheduledMinutes).padStart(4)} min   (${sched.items.length} drills)`)
  console.log(`total scheduled    ${String(sched.scheduledMinutes + b.nonDrill + b.transitions).padStart(4)} min`)
  console.log(`slack              ${String(sched.slack).padStart(4)} min`)

  if (sched.items.length === 0) {
    console.log('\n  (nothing scheduled — no candidate fit the budget)')
    return
  }

  console.log('\n  #   min  stage  score   drill')
  sched.items.forEach((it, i) => {
    const d = it.drill
    const conf = CONF.get(d.id) || '?'
    console.log(
      `  ${String(i + 1).padStart(2)}  ${String(it.minutes).padStart(3)}  ` +
      `   ${it.stage}   ${String(it.score.toFixed(1)).padStart(6)}   ` +
      `${d.drill_name.slice(0, 44).padEnd(46)}${String(d.skill_category).slice(0, 18).padEnd(20)}${conf}`
    )
    // A drill with no video has no shared-video problem, so an absent id
    // counts as zero uses rather than being looked up.
    const videoUses = d.youtube_video_id ? (VIDEO_USE.get(d.youtube_video_id) ?? 0) : 0
    console.log(
      `          via ${it.reason}` +
      ` · L${d.progression_level ?? '-'} ${d.difficulty_level || '?'}` +
      ` · ${d.indoor_outdoor || '?'} · ${d.space_required || '?'} space` +
      (videoUses > 1 ? ` · SHARED VIDEO (${videoUses} drills)` : '')
    )
    if (VERBOSE) console.log(`          duration: ${EVIDENCE.get(d.id)}`)

    // Roll up the two library-debt questions.
    if (LOW_IDS.has(String(d.id))) {
      const cur = lowUsage.get(String(d.id)) || { n: 0, drill: d }
      cur.n++
      lowUsage.set(String(d.id), cur)
    }
    selectedVideoStats.total++
    const startsAtZero = !d.youtube_start_seconds
    if (videoUses > 1) selectedVideoStats.shared++
    if (startsAtZero) selectedVideoStats.atZero++
    if (videoUses > 1 && startsAtZero) selectedVideoStats.sharedAtZero++
  })

  const notable = sched.rejected
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
  if (notable.length) {
    console.log('\n  turned away:')
    for (const r of notable) {
      console.log(`    ${String(r.score.toFixed(1)).padStart(6)}  ${r.drill.drill_name.slice(0, 40).padEnd(42)} ${r.reason} — ${r.detail}`)
    }
  }
}

function compare() {
  bar('LEGACY VS NEW — SAME SCENARIOS, BOTH CANDIDATE POOLS')
  console.log(`
Legacy: skill_category ilike any(focus categories), then .limit(45) with no
ordering, so WHICH 45 was down to physical row order. New: shared retrieval —
taxonomy first, then category, then text, with age and operational filtering.

The question is not whether the lists differ. It is whether the new one is
more principled without losing useful breadth.
`)
  for (const s of SCENARIOS) {
    const legacy = legacyFor(s)
    const { sched, ret } = schedule(s)
    const newTop = sched.items.map(i => i.drill)
    const legacyIds = new Set(legacy.map((d: any) => d.id))
    const newIds = new Set(newTop.map((d: any) => d.id))

    console.log(`\n--- ${s.name} (${s.minutes} min) ---`)
    console.log(`  legacy pool      : ${legacy.length} drills, unordered, first ${Math.min(45, legacy.length)} of ${legacy.length} by row order`)
    console.log(`  legacy first 5   : ${legacy.slice(0, 5).map((d: any) => d.drill_name.slice(0, 28)).join(' | ')}`)
    console.log(`  new retrieved    : ${ret.scored.length} ranked, ${sched.items.length} scheduled`)
    console.log(`  new scheduled    : ${newTop.map((d: any) => d.drill_name.slice(0, 28)).join(' | ')}`)
    const surfaced = newTop.filter((d: any) => !legacyIds.has(d.id))
    const dropped = legacy.slice(0, 8).filter((d: any) => !newIds.has(d.id))
    console.log(`  newly reachable  : ${surfaced.length ? surfaced.map((d: any) => d.drill_name.slice(0, 30)).join(', ') : '(none — same drills, better ordered)'}`)
    console.log(`  legacy-early now unselected: ${dropped.length} of the first 8 (they remain eligible, they simply rank lower)`)
    console.log(`  taxonomy used    : ${ret.dx.slugs.join(', ') || 'none — fell through to category/text, as intended for a goal'}`)
  }
}

function debtReport() {
  bar('DURATION DEBT — WHICH WEAK ESTIMATES THE PLANNER ACTUALLY LEANS ON')
  console.log(`
134 of 206 drills have a LOW-confidence duration, inherited from their
category median because they state no rep count. Curating all 134 blind is
the wrong order of work. These are the ones the evaluation scenarios actually
schedule, so these are the ones worth writing reps_guidance for first.
`)
  const ranked = Array.from(lowUsage.values()).sort((a, b) => b.n - a.n)
  if (ranked.length === 0) {
    console.log('  (no LOW-confidence drill was scheduled)')
    return
  }
  console.log('  used  min  category              drill')
  for (const { n, drill } of ranked) {
    console.log(
      `  ${String(n).padStart(4)}  ${String(MINUTES.get(drill.id)).padStart(3)}  ` +
      `${String(drill.skill_category).slice(0, 20).padEnd(22)}${drill.drill_name.slice(0, 44)}`
    )
  }
  console.log(`\n  ${ranked.length} distinct LOW-confidence drills scheduled across ${SCENARIOS.length} scenarios.`)
  console.log('  Why LOW: no reps_guidance, so the estimate is the category median rep count.')
}

function videoReport() {
  bar('YOUTUBE SEGMENTATION — IS IT THE NEXT PHASE?')
  const s = selectedVideoStats
  console.log(`
Of ${s.total} scheduled drill slots across the ${SCENARIOS.length} scenarios:

  open a video at 0:00 .................... ${s.atZero}
  are backed by a video shared with other drills .... ${s.shared}
  BOTH shared AND opening at 0:00 ................... ${s.sharedAtZero}

A shared video opening at 0:00 is the case that actually hurts: the coach taps
a drill called "Low Tee" and gets a twelve-minute compilation starting at the
introduction. They have to find the segment themselves, which is the moment the
recommendation stops feeling like a recommendation.

${s.sharedAtZero === 0
  ? 'Nothing scheduled here has that problem.'
  : `${s.sharedAtZero} of ${s.total} scheduled slots (${Math.round(100 * s.sharedAtZero / s.total)}%) have it.`}
`)
}

function main() {
  console.log(`Practice plan evaluation — ${DRILLS.length} drills, ${PROBLEMS.length} problems, ${MAPPINGS.length} mappings`)
  console.log('Source: scripts/fixtures/drill-library.json (production slice, read-only)')
  console.log('Diagnosis: alias fallback (no API key needed)')

  for (const s of SCENARIOS) render(s)
  if (COMPARE) compare()
  debtReport()
  videoReport()

  bar('READ THIS OUTPUT LIKE SO')
  console.log(`
A good result has the diagnosis naming the problem you would have named, the
first two or three drills being ones you would actually run, and the total
scheduled minutes at or just under the request.

Worth flagging when you see it:
  - a drill ranked on text alone sitting above a curated taxonomy match
  - slack above ~10 min at a long budget (retrieval ran out of candidates)
  - zero drills scheduled at 30 min (estimates too long to be usable)
  - two drills in one plan that are obviously the same activity
  - stages going backwards down the list

WITHOUT A LIVE MODEL THIS UNDERSTATES QUALITY. The alias fallback only matches
literal substrings of a taxonomy label or alias, so a question phrased in words
nobody wrote into the aliases column diagnoses to nothing and drops to the text
path — the weakest one. Read a bad result twice: once as "retrieval is wrong",
once as "the aliases do not cover how a coach says this". The second is a data
fix and is usually the answer.

Nothing here writes to the database.`)
}

main()
