// Age and ability are different questions, and three stations cost the time of
// one.
//
// WHAT THIS PROTECTS
//
// Two claims that are easy to state and easy to break silently.
//
// The first is that a nine-year-old on an advanced team can be given an
// advanced drill, and a thirteen-and-up drill can never reach them however
// advanced they are. Age is a hard gate about development; difficulty is a
// preference about ability; conflating them is how a library ends up believing
// that every advanced drill is for older kids.
//
// The second is that a station group takes rotationMinutes × groups. Get that
// wrong and the scheduler either refuses a practice that fits or throws away
// two thirds of it.
//
//   npm run test:drill-intelligence

import {
  normalizeSkill, skillAffinity, playerCountEligible, coachCountEligible,
  groupSizeAffinity, engagementAffinity, throwingAffinity, stationAffinity,
  competitionEligible, competitionAffinity, ageEligible, rankDrills,
} from '@/lib/drillRetrieval'
import {
  planStationGroup, assessStations, supportedGroupCount,
  MIN_STATION_GROUP, MIN_ROTATION_MINUTES,
} from '@/lib/stationPlanner'
import { schedulePractice, computeBudget, isRedundant } from '@/lib/practiceScheduler'
import type { ScoredDrill } from '@/lib/drillRetrieval'
// @ts-ignore -- plain ESM, no types
import { parseCalibration, parseNewDrills } from './parse-calibration.mjs'
import { DrillRecord } from '@/lib/drills'

let passed = 0
const failures: string[] = []
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name: string, a: any, b: any) =>
  ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const drill = (over: Partial<DrillRecord> & { id: string }): DrillRecord =>
  ({ drill_name: `drill ${over.id}`, ...over }) as DrillRecord

// ---------------------------------------------------------------------------
// 1. Vocabulary
//
// Three stores disagree about the middle rung and always will: the library
// says `intermediate`, teams say `mixed` (production's CHECK constraint), the
// product says `developing`. Normalising here is what lets all three coexist
// without migrating either column.
// ---------------------------------------------------------------------------
eq('library "intermediate" is developing', normalizeSkill('intermediate'), 'developing')
eq('team "mixed" is developing', normalizeSkill('mixed'), 'developing')
eq('product "developing" is itself', normalizeSkill('developing'), 'developing')
eq('"easy" is beginner', normalizeSkill('easy'), 'beginner')
eq('"Advanced" is case-insensitive', normalizeSkill('Advanced'), 'advanced')
eq('unknown stays unknown', normalizeSkill('spicy'), null)
eq('null stays null', normalizeSkill(null), null)
eq('empty stays null', normalizeSkill(''), null)

// ---------------------------------------------------------------------------
// 2. AGE AND DIFFICULTY ARE INDEPENDENT
//
// The claim this whole phase exists to make true.
// ---------------------------------------------------------------------------
const advanced9to12 = drill({ id: 'a', min_age: 9, max_age: 12, difficulty_level: 'advanced' })
const advanced13plus = drill({ id: 'b', min_age: 13, max_age: 18, difficulty_level: 'advanced' })
const beginner9to12 = drill({ id: 'c', min_age: 9, max_age: 12, difficulty_level: 'beginner' })

ok('a 9-year-old is age-eligible for a 9–12 advanced drill', ageEligible(advanced9to12, 9))
ok('a 9-year-old is NOT age-eligible for a 13+ advanced drill',
  !ageEligible(advanced13plus, 9),
  'difficulty must never widen the age gate — this is the failure that puts a 13U drill in front of a nine-year-old')
ok('and being an advanced team does not change that',
  !ageEligible(advanced13plus, 9) && skillAffinity(advanced13plus, 'advanced') > 0,
  'the drill scores well on ability and is still excluded on age, which is the correct combination')

ok('an advanced team prefers the advanced age-eligible drill',
  skillAffinity(advanced9to12, 'advanced') > skillAffinity(beginner9to12, 'advanced'))
ok('a beginner team prefers the beginner one',
  skillAffinity(beginner9to12, 'beginner') > skillAffinity(advanced9to12, 'beginner'))

// Asymmetry: too hard is worse than too easy.
ok('too-hard is penalised harder than too-easy',
  skillAffinity(advanced9to12, 'beginner') < skillAffinity(beginner9to12, 'advanced'),
  'a beginner team cannot run an advanced drill at all; an advanced team running a beginner drill is merely easy')

// But it is a preference, not a gate.
ok('a developing drill is still reachable for an advanced team',
  skillAffinity(drill({ id: 'd', difficulty_level: 'intermediate' }), 'advanced') > -10,
  'the correct teaching step is often a rung below the team — a filter here would remove progressions')
eq('unknown difficulty is neutral, never penalised',
  skillAffinity(drill({ id: 'e' }), 'advanced'), 0)
eq('unknown team level is neutral', skillAffinity(advanced9to12, null), 0)

// ---------------------------------------------------------------------------
// 3. Rec/travel is context, not ability
// ---------------------------------------------------------------------------
ok('a travel drill is no longer excluded for a rec team',
  competitionEligible(drill({ id: 'f', competition_level: 'travel' }), 'rec'),
  'an advanced 9U all-star side plays rec and needs those drills')
ok('travel does not imply advanced: the two signals are separate',
  skillAffinity(drill({ id: 'g', competition_level: 'travel', difficulty_level: 'beginner' }), 'beginner') > 0,
  'a beginner travel team should still be offered beginner drills')
ok('rec does not imply beginner',
  skillAffinity(drill({ id: 'h', competition_level: 'rec', difficulty_level: 'advanced' }), 'advanced') > 0)
ok('context still nudges ranking',
  competitionAffinity(drill({ id: 'i', competition_level: 'rec' }), 'rec') >
  competitionAffinity(drill({ id: 'j', competition_level: 'travel' }), 'rec'))

// ---------------------------------------------------------------------------
// 4. Feasibility — hard where it must be, inert where it is unknown
// ---------------------------------------------------------------------------
const needs6 = drill({ id: 'k', min_players: 6 })
const needs3coaches = drill({ id: 'l', min_coaches: 3 })

ok('6-player drill rejected for 4 players', !playerCountEligible(needs6, 4))
ok('6-player drill accepted for 12', playerCountEligible(needs6, 12))
ok('3-coach drill rejected for 1 coach', !coachCountEligible(needs3coaches, 1))
ok('3-coach drill accepted for 3', coachCountEligible(needs3coaches, 3))

// The rule the whole codebase runs on.
ok('UNKNOWN player count gates nothing', playerCountEligible(needs6, null))
ok('UNKNOWN coach count gates nothing', coachCountEligible(needs3coaches, null))
ok('a drill with no declared minimum is always eligible',
  playerCountEligible(drill({ id: 'm' }), 1) && coachCountEligible(drill({ id: 'm' }), 0),
  '206 rows declare nothing; if silence excluded them the library would look empty')

// The regression this most protects against.
{
  const pool = [needs6, needs3coaches, drill({ id: 'plain' })]
  const survivors = pool.filter(d => playerCountEligible(d, null) && coachCountEligible(d, null))
  eq('an uncalibrated library is untouched by feasibility', survivors.length, 3)
}

// Soft: group size shapes, never rejects.
ok('exact group size is preferred', groupSizeAffinity(drill({ id: 'n', ideal_group_size: 4 }), 4) > 0)
ok('being one off is tolerated', groupSizeAffinity(drill({ id: 'o', ideal_group_size: 4 }), 5) >= 0,
  'ideal_group_size 4 with 5 players is still runnable')
eq('unknown ideal size is neutral', groupSizeAffinity(drill({ id: 'p' }), 4), 0)

// ---------------------------------------------------------------------------
// 5. Preference signals only fire when asked for
// ---------------------------------------------------------------------------
const fun = drill({ id: 'q', engagement_level: 'high', idle_time_risk: 'low', rep_density: 'high', competition_style: 'game' })
const dull = drill({ id: 'r', engagement_level: 'low', idle_time_risk: 'high', rep_density: 'low', competition_style: 'none' })

eq('no fun request, no engagement signal', engagementAffinity(fun, false), 0)
ok('fun requested: the game outranks the queue', engagementAffinity(fun, true) > engagementAffinity(dull, true))
eq('unknown engagement metadata is neutral', engagementAffinity(drill({ id: 's' }), true), 0)

eq('no throwing limit, no signal', throwingAffinity(drill({ id: 't', throwing_load: 'high' }), false), 0)
ok('game tomorrow: light beats heavy',
  throwingAffinity(drill({ id: 'u', throwing_load: 'low' }), true) >
  throwingAffinity(drill({ id: 'v', throwing_load: 'high' }), true))

eq('no station request, no signal', stationAffinity(drill({ id: 'w', station_friendly: true }), false), 0)
ok('stations requested: station-friendly wins',
  stationAffinity(drill({ id: 'x', station_friendly: true }), true) >
  stationAffinity(drill({ id: 'y', station_friendly: false }), true))

// ---------------------------------------------------------------------------
// 6. TAXONOMY DOMINANCE
//
// Every preference above is deliberately small. This proves the arithmetic:
// no combination of them can lift a drill over a curated taxonomy match.
// ---------------------------------------------------------------------------
{
  const curatedButDull = drill({
    id: 'curated', skill_category: 'Hitting',
    difficulty_level: 'beginner', engagement_level: 'low',
    idle_time_risk: 'high', rep_density: 'low', throwing_load: 'high',
    station_friendly: false, competition_level: 'travel',
  })
  const funButUnmapped = drill({
    id: 'funny', skill_category: 'Hitting',
    difficulty_level: 'advanced', engagement_level: 'high',
    idle_time_risk: 'low', rep_density: 'high', throwing_load: 'low',
    station_friendly: true, competition_level: 'rec',
  })

  const { scored } = rankDrills(
    [curatedButDull, funButUnmapped],
    [{ drill_id: 'curated', problem_slug: 'uppercutting', curated: true, sort_order: 1 }],
    {
      query: 'hitting', slugs: ['uppercutting'], categories: ['Hitting'],
      constraints: {
        skillLevel: 'advanced', preferEngaging: true, limitThrowing: true,
        preferStations: true, competitionLevel: 'rec',
      },
    } as any
  )
  eq('a curated mapping outranks every preference signal combined',
    scored[0].drill.id, 'curated')
  ok('and the margin is not close',
    scored[0].reason.score - scored[1].reason.score > 50,
    'if this narrows, a preference is too heavy and relevance is no longer dominant')
}

// ---------------------------------------------------------------------------
// 7. STATION TIMING — the arithmetic the brief names explicitly
// ---------------------------------------------------------------------------
const stationable = (id: string, coaches = 0) =>
  drill({ id, station_friendly: true, min_coaches: coaches, ideal_group_size: 4 })

{
  // 12 players, 3 coaches, 24 minutes available.
  const g = planStationGroup({
    candidates: [stationable('s1', 1), stationable('s2', 1), stationable('s3', 1), stationable('s4', 1)]
      .map(d => ({ drill: d, reason: { score: 10 } })) as any,
    expectedPlayers: 12, coachCount: 3, availableMinutes: 24,
  })
  ok('12 players / 3 coaches produces a station group', g != null)
  if (g) {
    eq('three groups', g.groups, 3)
    eq('every player is placed', g.stations.reduce((n, s) => n + s.groupSize, 0), 12)
    eq('four to a station', g.stations[0].groupSize, 4)
    ok('elapsed time is rotations, not the sum of stations',
      g.totalMinutes <= 24,
      `${g.totalMinutes} min for ${g.groups} stations of ${g.rotationMinutes} — the sum would be ${g.groups * g.rotationMinutes * g.groups}`)
    eq('total = rotation × groups + seams',
      g.totalMinutes, g.rotationMinutes * g.groups + g.rotationTransitions)
    ok('a rotation is long enough to be worth running', g.rotationMinutes >= MIN_ROTATION_MINUTES)
  }
}

{
  // THE ONE-COACH CASE. Same players, same time, one adult.
  const coachHungry = [stationable('c1', 1), stationable('c2', 1), stationable('c3', 1)]
  const g = planStationGroup({
    candidates: coachHungry.map(d => ({ drill: d, reason: { score: 10 } })) as any,
    expectedPlayers: 12, coachCount: 1, availableMinutes: 24,
  })
  ok('one coach cannot staff three coach-dependent stations',
    g == null || g.groups < 3,
    g ? `built ${g.groups} groups needing ${g.stations.reduce((n, s) => n + (s.drill.min_coaches ?? 0), 0)} coaches` : '')
}

{
  // ...but one coach CAN run stations when the activities run themselves.
  const selfRunning = [stationable('r1', 0), stationable('r2', 0), stationable('r3', 1)]
  const g = planStationGroup({
    candidates: selfRunning.map(d => ({ drill: d, reason: { score: 10 } })) as any,
    expectedPlayers: 12, coachCount: 1, availableMinutes: 24,
  })
  ok('one coach plus self-running activities can still run stations', g != null,
    'refusing all stations for a solo coach would be as wrong as ignoring the constraint')
  if (g) {
    const needed = g.stations.reduce((n, s) => n + (s.drill.min_coaches ?? 0), 0)
    ok('and never asks for more adults than are present', needed <= 1, `needs ${needed}`)
  }
}

// Not enough people.
eq('six players is two groups of three', supportedGroupCount(6, 2, [stationable('a'), stationable('b')]), 2)
eq('five players cannot make two groups of three', supportedGroupCount(5, 2, [stationable('a')]), 0)
ok('unknown player count means no stations',
  assessStations({ candidates: [stationable('a')], expectedPlayers: null, coachCount: 3, availableMinutes: 30 }).feasible === false,
  'stations need a headcount; guessing one would be inventing the practice')

// Not enough time.
ok('four minutes cannot hold three rotations',
  assessStations({
    candidates: [stationable('a'), stationable('b'), stationable('c')],
    expectedPlayers: 12, coachCount: 3, availableMinutes: 4,
  }).feasible === false)

// A drill that says it cannot be a station is not made one.
{
  const g = planStationGroup({
    candidates: [
      drill({ id: 'no1', station_friendly: false }),
      drill({ id: 'no2', station_friendly: false }),
      stationable('yes'),
    ].map(d => ({ drill: d, reason: { score: 10 } })) as any,
    expectedPlayers: 12, coachCount: 3, availableMinutes: 24,
  })
  ok('station_friendly=false is respected',
    g == null || g.stations.every(s => s.drill.station_friendly !== false))
}

// ---------------------------------------------------------------------------
// 8. THE SCHEDULER'S STATION SUGGESTION
//
// The integration, not the unit. The claim being defended is that a stations
// note can never cost the practice time it did not already have — the
// suggestion is drawn from drills the plan had already committed to, and the
// window is exactly the minutes those drills were holding.
// ---------------------------------------------------------------------------
{
  const budget = computeBudget(90)
  const cand = (id: string, minutes: number, stage: string): ScoredDrill =>
    ({
      drill: drill({
        id, est_duration_minutes: minutes, station_friendly: true, min_coaches: 0,
        skill_category: 'Fielding', progression_level: stage === 'early' ? 1 : 3,
      }),
      reason: { score: 20 },
    }) as any

  const withPeople = schedulePractice({
    candidates: [
      cand('p1', 10, 'early'), cand('p2', 10, 'early'),
      cand('p3', 10, 'early'), cand('p4', 12, 'late'),
    ],
    budget, expectedPlayers: 12, coachCount: 2,
  })

  ok('a 12-player practice gets a stations suggestion', withPeople.stations != null)
  if (withPeople.stations) {
    const g = withPeople.stations
    const heldMinutes = withPeople.items
      .filter(i => g.stations.some(s => s.drill.id === i.drill.id))
      .reduce((n, i) => n + i.minutes, 0)
    ok('the suggestion never costs more than those drills already held',
      g.totalMinutes <= heldMinutes,
      `${g.totalMinutes} min proposed against ${heldMinutes} min already budgeted`)
    ok('every station is a drill that is actually in the plan',
      g.stations.every(s => withPeople.items.some(i => i.drill.id === s.drill.id)))
    ok('stations are drawn from one point in the practice',
      new Set(g.stations.map(s =>
        withPeople.items.find(i => i.drill.id === s.drill.id)!.stage)).size === 1,
      'a warm-up and a game-speed drill running in parallel is two practices, not a rotation')
    eq('total is still rotation × groups + seams',
      g.totalMinutes, g.rotationMinutes * g.groups + g.rotationTransitions)
  }

  const noHeadcount = schedulePractice({
    candidates: [cand('p1', 10, 'early'), cand('p2', 10, 'early'), cand('p3', 10, 'early')],
    budget,
  })
  eq('unknown headcount proposes no stations', noHeadcount.stations, null)
  ok('and the plan itself is unchanged by that', noHeadcount.items.length > 0)

  const tooFew = schedulePractice({
    candidates: [cand('p1', 10, 'early'), cand('p2', 10, 'early'), cand('p3', 10, 'early')],
    budget, expectedPlayers: 5, coachCount: 2,
  })
  eq('five players proposes no stations', tooFew.stations, null)
}

// Family-aware redundancy: same rung is a duplicate, different rungs are a
// progression and must both survive.
{
  const fam = '11111111-1111-1111-1111-111111111111'
  const base1 = drill({ id: 'f1', drill_name: 'Protect the Castle', activity_family_id: fam, variation_type: 'base' })
  const base2 = drill({ id: 'f2', drill_name: 'Guard the Cones', activity_family_id: fam, variation_type: 'base' })
  const prog = drill({ id: 'f3', drill_name: 'Protect the Castle + Throw', activity_family_id: fam, variation_type: 'progression' })

  ok('two base entries of one family are the same activity', isRedundant(base1, base2),
    'names share nothing, so only the family can catch this')
  ok('base and progression of one family are a progression, not a duplicate',
    !isRedundant(base1, prog),
    'suppressing this would delete the exact thing families were added to represent')
  ok('an unclassified pair is still judged on names alone',
    !isRedundant(drill({ id: 'g1', drill_name: 'Wall Ball' }), drill({ id: 'g2', drill_name: 'Tee Work' })))
}

// ---------------------------------------------------------------------------
// 9. THE CALIBRATION MIGRATION IS STILL READABLE
//
// The offline evaluator overlays migration 058's values onto its fixture by
// parsing them straight out of the SQL, so the migration is the only place they
// are written. That only holds while the parse works. An edit to 058 that
// breaks the shape must fail HERE, loudly, rather than silently handing the
// evaluator an empty overlay and making the whole calibration half of the phase
// invisible while every number still looks plausible.
// ---------------------------------------------------------------------------
{
  const rows = parseCalibration()
  const created = parseNewDrills()

  ok('058 still parses to a full calibration set', rows.length >= 40, `parsed ${rows.length}`)
  eq('and to the two original activities', created.length, 2)
  ok('Protect the Castle is one of them',
    created.some((d: any) => d.drill_name === 'Protect the Castle'))

  // §19's one genuinely unrepresentable case before this phase.
  const ptcThrow = created.find((d: any) => d.drill_name === 'Protect the Castle + Throw')
  ok('an Advanced drill now reaches an eight-year-old',
    !!ptcThrow && String(ptcThrow.difficulty_level).toLowerCase() === 'advanced' && ptcThrow.min_age <= 8,
    ptcThrow ? `${ptcThrow.difficulty_level} at ${ptcThrow.min_age}+` : 'missing')

  // Every value must be inside the vocabulary 056's CHECK constraints allow,
  // because a migration that fails on production at 3am is not a data problem.
  const VOCAB: Record<string, string[]> = {
    variation_type: ['base','regression','progression','advanced','game','competitive','equipment_variant','space_variant'],
    activity_format: ['individual','partner','small_group','station','full_team','game'],
    rep_density: ['low','medium','high'],
    idle_time_risk: ['low','medium','high'],
    engagement_level: ['low','medium','high'],
    competition_style: ['none','scored','head_to_head','team_vs_team','game'],
    instruction_complexity: ['low','medium','high'],
    throwing_load: ['none','low','medium','high'],
    physical_intensity: ['low','medium','high'],
  }
  const ROLES = ['warmup','teach','isolate','repetition','progress','decision',
    'competition','game_application','team_execution','assessment','finish']

  let vocabViolations = 0
  let roleViolations = 0
  let countViolations = 0
  for (const r of [...rows, ...created] as any[]) {
    for (const [col, allowed] of Object.entries(VOCAB)) {
      if (r[col] != null && !allowed.includes(r[col])) {
        vocabViolations++
        failures.push(`058 "${r.drill_name}": ${col}="${r[col]}" is not in the 056 vocabulary`)
      }
    }
    for (const role of r.practice_roles ?? []) {
      if (!ROLES.includes(role)) {
        roleViolations++
        failures.push(`058 "${r.drill_name}": practice_role "${role}" is not allowed`)
      }
    }
    if (r.min_players != null && r.min_players < 1) countViolations++
    if (r.min_coaches != null && r.min_coaches < 0) countViolations++
  }
  ok('every calibrated value is inside 056\'s vocabulary', vocabViolations === 0)
  ok('every practice_role is one 056 allows', roleViolations === 0)
  ok('no calibrated count violates the CHECK constraints', countViolations === 0)

  // The claim that makes the whole set safe: calibration never shrinks what a
  // normal team can be offered.
  const excludedFromTen = (rows as any[]).filter(r => r.min_players != null && r.min_players > 10)
  eq('nothing calibrated is put out of reach of a 10-player team', excludedFromTen.length, 0)

  // Families must hold progressions, not duplicates of one rung — except where
  // the rows genuinely ARE duplicates, which is the point.
  const byFamily = new Map<string, any[]>()
  for (const r of rows as any[]) {
    if (!r.family_slug) continue
    if (!byFamily.has(r.family_slug)) byFamily.set(r.family_slug, [])
    byFamily.get(r.family_slug)!.push(r)
  }
  ok('families were actually used', byFamily.size >= 5, `${byFamily.size} families`)
  for (const [slug, members] of byFamily) {
    ok(`family "${slug}" has more than one member`, members.length >= 2,
      'a family of one groups nothing')
  }
}

// ---------------------------------------------------------------------------
console.log(`\ndrill & station intelligence: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('\nAge gates on development, difficulty ranks on ability, and three')
console.log('stations cost the time of one.\n')
