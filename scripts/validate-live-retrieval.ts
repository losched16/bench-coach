// Does the ranking behave correctly against the REAL library?
//
// WHY THIS EXISTS SEPARATELY FROM eval:practice-plan
//
// The evaluator runs against scripts/fixtures/drill-library.json, a snapshot.
// A snapshot proves the ALGORITHM. It cannot prove that the rows a coach is
// actually served behave the same way, because the snapshot is by definition
// not those rows — and after a calibration migration that distinction is the
// whole question. "Migration applied" and "feature works" are different claims
// and this file exists to close the gap between them.
//
// So this reads the live library over HTTPS and runs the same rankDrills() the
// product runs.
//
// WHY IT IS SAFE
//
//   - READ ONLY. It issues GETs. There is no write path in this file.
//   - It uses the PUBLIC anon key, the one that ships in every page of the
//     deployed JavaScript bundle. It never touches the service role, so it
//     cannot see anything a logged-out visitor could not already see.
//   - drill_resources, problem_taxonomy and drill_problem_map are reference
//     data with "publicly readable" SELECT policies. No coach, player, team or
//     billing row is read, and none is reachable with this key.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npx tsx --tsconfig tsconfig.json scripts/validate-live-retrieval.ts
//
// Node 22's global fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1, and
// without it the requests fail with a transparent 403 that reads exactly like
// an auth error. The npm script sets it.

import { rankDrills, RetrievalConstraints, normalizeSkill } from '@/lib/drillRetrieval'
import { schedulePractice, computeBudget, estimateBlockCount, describeSchedule } from '@/lib/practiceScheduler'
import { describeStationGroup } from '@/lib/stationPlanner'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { DrillRecord } from '@/lib/drills'

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL_BASE || !ANON) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

async function get<T>(path: string): Promise<T[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
  })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
  return res.json() as Promise<T[]>
}

// Only the columns ranking reads. Narrow on purpose: this is a public-key
// request and there is no reason for it to pull more than it uses.
const FIELDS = [
  'id', 'drill_name', 'description', 'skill_category', 'primary_skill', 'secondary_skill',
  'tags', 'mechanic_focus', 'common_flaws_fixed', 'difficulty_level', 'progression_level',
  'min_age', 'max_age', 'equipment_needed', 'indoor_outdoor', 'space_required',
  'requires_partner', 'competition_level', 'status', 'created_by_coach_id',
  'youtube_video_id', 'est_duration_minutes', 'source',
  'activity_family_id', 'variation_type', 'activity_format', 'practice_roles',
  'min_players', 'max_players', 'ideal_group_size', 'min_coaches', 'station_friendly',
  'rep_density', 'idle_time_risk', 'engagement_level', 'competition_style',
  'instruction_complexity', 'throwing_load', 'physical_intensity', 'mixed_skill_friendly',
].join(',')

interface Scenario {
  name: string
  query: string
  categories: string[]
  constraints: Partial<RetrievalConstraints>
  minutes?: number
  expect: string
}

const SCENARIOS: Scenario[] = [
  // §12 — the retrieval matrix. A and B share an age and differ only in ability.
  {
    name: 'A. 8U beginner', query: 'ground balls and throwing for our 8U team',
    categories: ['Fielding (Infield)', 'Throwing'],
    constraints: { playerAge: 8, skillLevel: 'beginner' },
    expect: 'age-eligible, beginner-biased, nothing 13U-only',
  },
  {
    name: 'B. 8U advanced', query: 'ground balls and throwing for our 8U team',
    categories: ['Fielding (Infield)', 'Throwing'],
    constraints: { playerAge: 8, skillLevel: 'advanced' },
    expect: 'SAME age gate as A, materially harder ranking',
  },
  {
    name: 'C. 9U advanced', query: 'infield work for our 9 year olds',
    categories: ['Fielding (Infield)'],
    constraints: { playerAge: 9, skillLevel: 'advanced' },
    expect: 'advanced age-eligible drills surface; 13U-only advanced stays excluded',
  },
  {
    name: 'D. 9U beginner TRAVEL', query: 'hitting for our 9U travel team',
    categories: ['Hitting'],
    constraints: { playerAge: 9, skillLevel: 'beginner', competitionLevel: 'travel' },
    expect: 'travel must NOT force advanced recommendations',
  },
  {
    name: 'E. 9U advanced REC/all-star', query: 'hitting for our 9U rec all-star team',
    categories: ['Hitting'],
    constraints: { playerAge: 9, skillLevel: 'advanced', competitionLevel: 'rec' },
    expect: 'rec must NOT block advanced recommendations',
  },
  // §14 — the two originals, retrievable when the context fits.
  {
    name: 'F. 8U ground balls, make it fun', query: 'ground balls for 8 year olds, make it fun',
    categories: ['Fielding (Infield)'],
    constraints: { playerAge: 8, skillLevel: 'beginner', preferEngaging: true, expectedPlayers: 10, coachCount: 2 },
    expect: 'Protect the Castle eligible and well ranked',
  },
  {
    name: 'G. 9U advanced ground balls, add throwing',
    query: 'advanced ground balls with a throw for 9 year olds',
    categories: ['Fielding (Infield)'],
    constraints: { playerAge: 9, skillLevel: 'advanced', expectedPlayers: 12, coachCount: 2 },
    expect: 'Protect the Castle + Throw eligible',
  },
  // §11 / §15 / §16 — the regression cases. These know almost nothing.
  {
    name: 'H. Chat-shaped (no team context at all)', query: 'my son keeps dropping his back shoulder',
    categories: [], constraints: {},
    expect: 'NOTHING filtered — no age, no headcount, no coach count',
  },
  {
    name: 'I. Player-report-shaped (age + problem, no team)', query: 'slow transfer',
    categories: ['Fielding (Infield)'], constraints: { playerAge: 10 },
    expect: 'age only; player and coach gates must stay off',
  },
]

// §13 — practice composition, where the counts actually change the plan.
const PRACTICES = [
  { name: '1. 8U · 12 players · 3 coaches · 90 min · fun',
    query: 'ground balls, throwing accuracy and hitting, make it fun',
    categories: ['Fielding (Infield)', 'Throwing', 'Hitting'], minutes: 90,
    constraints: { playerAge: 8, expectedPlayers: 12, coachCount: 3, preferEngaging: true, preferStations: true } },
  { name: '2. THE SAME PRACTICE WITH ONE COACH',
    query: 'ground balls, throwing accuracy and hitting, make it fun',
    categories: ['Fielding (Infield)', 'Throwing', 'Hitting'], minutes: 90,
    constraints: { playerAge: 8, expectedPlayers: 12, coachCount: 1, preferEngaging: true, preferStations: true } },
  { name: '3. 9U advanced · double-play footwork',
    query: 'double play footwork and feeds',
    categories: ['Fielding (Infield)'], minutes: 75,
    constraints: { playerAge: 9, skillLevel: 'advanced', expectedPlayers: 12, coachCount: 2 } },
  { name: '4. 9U · game tomorrow · keep throwing light',
    query: 'game tomorrow, keep their arms fresh',
    categories: ['Hitting', 'Fielding (Infield)'], minutes: 60,
    constraints: { playerAge: 9, expectedPlayers: 12, coachCount: 2, limitThrowing: true } },
  { name: '5. 10U · indoor · small space · 2 coaches',
    query: 'indoor practice in the gym, not much room',
    categories: ['Hitting', 'Throwing'], minutes: 60,
    constraints: { playerAge: 10, expectedPlayers: 12, coachCount: 2, indoorOutdoor: 'indoor', spaceAvailable: 'small' } },
]

const bar = (s: string) => { console.log('\n' + '='.repeat(78)); console.log(s); console.log('='.repeat(78)) }

async function main() {
  const ref = new URL(URL_BASE!).hostname.split('.')[0]
  console.log(`\n  live retrieval validation`)
  console.log(`  target:  ${ref}.supabase.co  (READ ONLY, public anon key)`)

  const [drillsRaw, problems, mappings] = await Promise.all([
    get<any>(`drill_resources?select=${FIELDS}&limit=1000`),
    get<any>('problem_taxonomy?select=*&limit=500'),
    get<any>('drill_problem_map?select=drill_id,problem_slug,curated,sort_order&limit=2000'),
  ])
  const drills = drillsRaw as DrillRecord[]

  const calibrated = drills.filter(d => d.station_friendly != null).length
  const families = new Set(drills.map(d => d.activity_family_id).filter(Boolean)).size
  console.log(`  library: ${drills.length} drills · ${calibrated} calibrated · ${drills.length - calibrated} untouched · ${families} families in use`)
  console.log(`  taxonomy: ${problems.length} problems · ${mappings.length} mappings`)

  // ---------------------------------------------------------------------
  bar('RETRIEVAL')
  const pools = new Map<string, number>()
  for (const s of SCENARIOS) {
    const dx = diagnoseByAlias(s.query, problems as TaxonomyRow[])
    const slugs = dx.slugs
    const rows = mappings.filter((m: any) => slugs.includes(m.problem_slug))
    const { scored, debug } = rankDrills(drills, rows, {
      query: s.query, slugs,
      categories: s.categories.length ? s.categories : dx.categories,
      constraints: s.constraints as RetrievalConstraints, limit: 8,
    })
    pools.set(s.name, debug.candidateCountAfterFilters)

    console.log(`\n${s.name}`)
    console.log(`  expect   : ${s.expect}`)
    console.log(`  filters  : applied [${debug.filtersApplied.join(', ') || '—'}]`)
    console.log(`  pool     : ${debug.candidateCountBeforeFilters} -> ${debug.candidateCountAfterFilters} eligible`)
    scored.slice(0, 5).forEach((sc, i) => {
      const d = sc.drill
      console.log(
        `   ${i + 1}. ${String(sc.reason.score.toFixed(1)).padStart(6)}  ${d.drill_name.slice(0, 44).padEnd(46)}` +
        `${(d.difficulty_level || '?').padEnd(13)}${d.min_age ?? '-'}-${d.max_age ?? '-'}  via ${sc.reason.primary}`
      )
    })
    // Age is a hard gate and this is the assertion that matters most.
    const leaks = scored.filter(sc =>
      s.constraints.playerAge != null &&
      sc.drill.min_age != null && sc.drill.min_age > (s.constraints.playerAge as number))
    console.log(`  age leak : ${leaks.length === 0 ? 'none' : `*** ${leaks.length}: ${leaks.map(l => l.drill.drill_name).join(', ')}`}`)
  }

  console.log('\n--- the claim, stated as numbers ---')
  const a = pools.get('A. 8U beginner'), b = pools.get('B. 8U advanced')
  console.log(`  8U beginner eligible pool : ${a}`)
  console.log(`  8U advanced eligible pool : ${b}`)
  console.log(`  identical                 : ${a === b ? 'YES — the age gate is the same, only ranking differs' : '*** NO'}`)

  // ---------------------------------------------------------------------
  bar('PRACTICE COMPOSITION')
  for (const p of PRACTICES) {
    const dx = diagnoseByAlias(p.query, problems as TaxonomyRow[])
    const rows = mappings.filter((m: any) => dx.slugs.includes(m.problem_slug))
    const { scored, debug } = rankDrills(drills, rows, {
      query: p.query, slugs: dx.slugs,
      categories: p.categories, constraints: p.constraints as RetrievalConstraints, limit: 30,
    })
    const budget = computeBudget(p.minutes, { blockCount: estimateBlockCount(p.minutes) })
    const sched = schedulePractice({
      candidates: scored, budget,
      expectedPlayers: (p.constraints as any).expectedPlayers ?? null,
      coachCount: (p.constraints as any).coachCount ?? null,
    })

    console.log(`\n${p.name}`)
    console.log(`  pool     : ${debug.candidateCountBeforeFilters} -> ${debug.candidateCountAfterFilters} eligible`)
    console.log(`  budget   : ${budget.drillBudget} min of drills · scheduled ${sched.scheduledMinutes} · slack ${sched.slack}`)
    sched.items.forEach((it, i) => {
      const d = it.drill
      console.log(
        `   ${i + 1}. ${String(it.minutes).padStart(2)}min  ${d.drill_name.slice(0, 44).padEnd(46)}` +
        `throw=${(d.throwing_load ?? '?').padEnd(7)}engage=${(d.engagement_level ?? '?').padEnd(7)}coaches=${d.min_coaches ?? '?'}`
      )
    })
    if (sched.stations) {
      console.log('  STATIONS:')
      console.log('  ' + describeStationGroup(sched.stations).split('\n').join('\n  '))
      const need = sched.stations.stations.reduce((n, s) => n + (s.drill.min_coaches ?? 0), 0)
      const have = (p.constraints as any).coachCount
      console.log(`  staffing : needs ${need} coach-led stations, ${have} coaches present` +
        (need > have ? '   *** OVERCOMMITTED' : '   ok'))
    } else {
      console.log('  STATIONS: none proposed')
    }
    // §17 asks the question that separates "right answer" from "right answer
    // for the right reason": a plan with no high-throwing blocks proves nothing
    // if the drills in it never declared a throwing load at all.
    const heavy = sched.items.filter(i => i.drill.throwing_load === 'high').length
    const unknownThrow = sched.items.filter(i => i.drill.throwing_load == null)
    console.log(
      `  throwing : ${heavy} high of ${sched.items.length} blocks · ` +
      `${unknownThrow.length} have NO throwing_load at all` +
      (unknownThrow.length === sched.items.length
        ? '   *** the signal did not participate — this outcome is under-determined'
        : '')
    )
  }

  console.log('\nRead only. Nothing in this file writes.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
