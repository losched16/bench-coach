// If a coach has fifty minutes, what actually fits?
//
// This is the question est_duration_minutes exists to answer, and until now
// nothing could ask it — the column was null on all 206 rows, so every surface
// that might have budgeted a practice instead just listed drills and left the
// arithmetic to a parent standing in a field.
//
// Nothing here writes anything or calls a model. It runs retrieval against the
// fixture, walks the ranked list until the budget is spent, and prints what a
// coach would be handed. The point is to see the durations under load: whether
// a sixty-minute practice comes back with four drills or fourteen, and whether
// the long ones crowd out everything else.
//
//   npm run sim:practice-budget
//   npm run sim:practice-budget -- --query "my hitter is lunging"
//   npm run sim:practice-budget -- --budget 60
//
// WHAT THIS DELIBERATELY DOES NOT MODEL
//
// Team size. A twelve-player team running one tee is not a three-player team
// running one tee, and the difference is a multiplier on reps, not on the
// drill. Base duration is what one group needs to run the drill once; scaling
// it for a roster is a separate decision with its own inputs (stations,
// coaches, whether the drill parallelises at all) and folding a guess about it
// into the stored number would make the stored number mean two things.

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
// @ts-ignore -- plain ESM, no types
import { estimateAll } from './estimate-drill-durations.mjs'

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

const { rows } = estimateAll(FIX.drills)
const DURATION = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))
const CONFIDENCE = new Map<string, string>(rows.map((r: any) => [r.drill.id, r.est.confidence]))
const DRILLS = FIX.drills.map((d: any) => ({ ...d, est_duration_minutes: DURATION.get(d.id) }))

const argv = process.argv.slice(2)
const optStr = (n: string, d: string) => {
  const i = argv.indexOf(n)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d
}
const optNum = (n: string, d: number | null) => {
  const i = argv.indexOf(n)
  return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : d
}

// The budgets a youth coach actually has. Thirty minutes is a backyard
// session before dinner; a hundred and twenty is a Saturday.
const ALL_BUDGETS = [30, 45, 60, 75, 90, 120]

// What a practice spends on things that are not drills: gathering eleven
// eight-year-olds, a water break, and the two minutes at the end where
// somebody cannot find their glove. Budgeting the whole session as drill time
// is how a plan ends up ten minutes long on paper and forty in reality.
const OVERHEAD_MIN = 8

const SCENARIOS = [
  { q: 'My hitter is lunging forward.', why: 'the most-mapped problem in the library' },
  { q: 'My 8-year-old keeps dropping his back shoulder when he swings.', why: 'the flagship taxonomy case' },
  { q: 'My shortstop has a slow transfer.', why: 'infield — mid-length drills' },
  { q: 'How do I get my team to stop making errors?', why: 'vague; pulls team defense, the expensive category' },
  { q: 'We have no field time this week, just a gym.', why: 'environment-constrained, no flaw' },
]

function plan(query: string, budgetMin: number) {
  const dx = diagnoseByAlias(query, PROBLEMS)
  const constraints: RetrievalConstraints = {
    ...constraintsFromText(query),
    playerAge: ageFromText(query),
  }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  // Ask for more than will fit: the budget is what truncates the list, not
  // the retrieval limit. Otherwise a 120-minute practice is capped at 12
  // drills for reasons that have nothing to do with time.
  const { scored } = rankDrills(DRILLS, mapRows, {
    query, slugs: dx.slugs, categories: dx.categories, constraints, limit: 40,
  })

  const drillBudget = budgetMin - OVERHEAD_MIN
  const chosen: any[] = []
  const skipped: any[] = []
  let spent = 0

  // Greedy in rank order, and it keeps looking after the first drill that does
  // not fit. A 15-minute drill blocking the 5-minute one behind it would make
  // the tail of a practice unreachable purely by ordering.
  for (const s of scored) {
    // A drill with no estimate is a bug in the estimator, not something to
    // quietly treat as zero minutes and pack into every practice.
    const mins = s.drill.est_duration_minutes
    if (typeof mins !== 'number') {
      throw new Error(`no duration estimate for "${s.drill.drill_name}" (${s.drill.id})`)
    }
    if (spent + mins <= drillBudget) {
      chosen.push(s)
      spent += mins
    } else {
      skipped.push(s)
    }
  }

  return { dx, scored, chosen, skipped, spent, drillBudget }
}

function render(query: string, why: string, budgets: number[]) {
  console.log('\n' + '='.repeat(78))
  console.log(`"${query}"`)
  console.log(why)
  console.log('='.repeat(78))

  for (const b of budgets) {
    const { dx, chosen, spent, drillBudget } = plan(query, b)
    const slack = drillBudget - spent
    console.log(
      `\n  ${String(b).padStart(3)} min practice` +
      `  (${OVERHEAD_MIN} overhead, ${drillBudget} for drills)` +
      `  ->  ${chosen.length} drills, ${spent} min used, ${slack} min slack` +
      (dx.slugs.length ? `   [${dx.slugs.join(', ')}]` : '   [no taxonomy match]')
    )
    for (const s of chosen) {
      const d = s.drill
      console.log(
        `      ${String(d.est_duration_minutes).padStart(2)}m  ` +
        `${d.drill_name.slice(0, 46).padEnd(48)}` +
        `${String(d.skill_category || '').slice(0, 18).padEnd(20)}` +
        `${CONFIDENCE.get(d.id)}`
      )
    }
    if (chosen.length === 0) console.log('      (nothing fits — every candidate is longer than the budget)')
  }
}

function distribution() {
  console.log('\n' + '='.repeat(78))
  console.log('WHAT THE BUDGETS BUY, ACROSS ALL FIVE SCENARIOS')
  console.log('='.repeat(78))
  console.log('\n  budget   drills   min used   slack   avg drill')
  for (const b of ALL_BUDGETS) {
    const runs = SCENARIOS.map(s => plan(s.q, b))
    const n = runs.reduce((a, r) => a + r.chosen.length, 0) / runs.length
    const used = runs.reduce((a, r) => a + r.spent, 0) / runs.length
    const slack = runs.reduce((a, r) => a + (r.drillBudget - r.spent), 0) / runs.length
    console.log(
      `  ${String(b).padStart(6)}   ${n.toFixed(1).padStart(6)}   ${used.toFixed(1).padStart(8)}   ` +
      `${slack.toFixed(1).padStart(5)}   ${(used / Math.max(n, 1)).toFixed(1).padStart(9)}`
    )
  }

  const mins = rows.map((r: any) => r.est.minutes).sort((a: number, b: number) => a - b)
  const total = mins.reduce((a: number, b: number) => a + b, 0)
  console.log(`\n  Library: ${mins.length} drills, ${total} min end to end, median ${mins[Math.floor(mins.length / 2)]} min`)
  console.log(`  Shortest ${mins[0]} min, longest ${mins[mins.length - 1]} min`)

  console.log(`
  READ IT LIKE SO

  Slack near zero at every budget means the durations are doing their job —
  the plan fills the time. Large slack at 90 and 120 means retrieval runs out
  of relevant drills before the clock runs out, which is a coverage problem,
  not a duration problem. Zero drills at 30 minutes would mean the estimates
  are too long to be usable for a backyard session.

  Team size is not modelled here. See the header.`)
}

function main() {
  const q = optStr('--query', '')
  const b = optNum('--budget', null)
  const budgets = b ? [b] : ALL_BUDGETS

  console.log(`Practice budget simulation — ${DRILLS.length} drills with estimated durations`)
  console.log('Source: scripts/fixtures/drill-library.json + scripts/estimate-drill-durations.mjs')
  console.log('Read-only. No database, no model, no network.')

  if (q) {
    render(q, 'ad-hoc query', budgets)
    return
  }
  for (const s of SCENARIOS) render(s.q, s.why, budgets)
  distribution()
}

main()
