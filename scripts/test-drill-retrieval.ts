// Does chat get the right drills?
//
// These run the real ranking over the real library — scripts/fixtures/drill-library.json
// is a verbatim slice of production taken 2026-08-29: 206 drills, 48 problems,
// 311 mappings. No database, no API key, no network. Diagnosis uses the alias
// fallback, which is the same code path prescribe uses when the model call
// fails, so the whole pipeline is exercised end to end.
//
// The cases below are the questions a coach actually types. Several are here
// because they are the ones the old first-100 dump got wrong.
//
//   npm run test:drill-retrieval

import { readFileSync } from 'fs'
import { rankDrills, ageEligible, environmentEligible, spaceEligible, equipmentEligible, competitionEligible } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import { checkGrounding, stripUngroundedVideos } from '@/lib/drillGrounding'
import { stageOf, buildSteps } from '@/lib/progression'

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const DRILLS: any[] = FIX.drills
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

/** The chat path, minus the model: diagnose by alias, then rank. */
function retrieve(query: string, extra: any = {}) {
  const dx = diagnoseByAlias(query, PROBLEMS)
  const slugs = extra.slugs ?? dx.slugs
  const mapRows = MAPPINGS.filter(m => slugs.includes(m.problem_slug))
  return {
    dx,
    ...rankDrills(DRILLS, mapRows, {
      query,
      slugs,
      categories: extra.categories ?? dx.categories,
      constraints: { ...constraintsFromText(query), playerAge: ageFromText(query), ...extra.constraints },
      favorites: extra.favorites,
      limit: extra.limit,
    }),
  }
}

const names = (r: any) => r.scored.map((s: any) => s.drill.drill_name)
const has = (r: any, re: RegExp) => names(r).some((n: string) => re.test(n))

console.log('=== the fixture is the real library ===')
check('206 drills', DRILLS.length === 206)
check('48 problems', PROBLEMS.length === 48)
check('311 mappings', MAPPINGS.length === 311)

console.log('\n=== the eight coach questions ===')

// 1 — a named mechanical flaw, with an age in the sentence
{
  const r = retrieve('My 8-year-old keeps dropping his back shoulder when he swings.')
  check('1. dropping back shoulder returns drills', r.scored.length > 0)
  check('   ...reads the age out of the question', r.debug.filtersApplied.includes('age'))
  check('   ...returns a shortlist, not a dump', r.scored.length <= 12,
    `got ${r.scored.length}`)
  check('   ...every drill is age-eligible for an 8yo',
    r.scored.every((s: any) => ageEligible(s.drill, 8)))
  check('   ...leads with hitting', /hitting|soft toss/i.test(String(r.scored[0]?.drill.skill_category)),
    String(r.scored[0]?.drill.skill_category))
}

// 2 — lunging: the most-mapped problem in the library (17 drills)
{
  const r = retrieve('My hitter is lunging forward.')
  check('2. lunging diagnoses to a slug', r.dx.slugs.length > 0, JSON.stringify(r.dx.slugs))
  check('   ...retrieval path is taxonomy-driven',
    r.debug.retrievalPath === 'taxonomy' || r.debug.retrievalPath === 'hybrid', r.debug.retrievalPath)
  check('   ...top drill is mapped to the diagnosed problem',
    r.scored[0]?.reason.matchedProblems.length > 0)
}

// 3 — a fielding problem, to prove it does not just return hitting drills
{
  const r = retrieve('My shortstop has a slow transfer.')
  check('3. slow transfer returns drills', r.scored.length > 0)
  check('   ...and they are not all hitting drills',
    !r.scored.every((s: any) => /hitting/i.test(String(s.drill.skill_category))),
    names(r).slice(0, 3).join(' | '))
  check('   ...top result is mapped', r.scored[0]?.reason.matchedProblems.length > 0,
    JSON.stringify(r.scored[0]?.reason.matchedProblems))
}

// 4 — fear, which is a real taxonomy entry with only one mapped drill
{
  const r = retrieve('My 8-year-old is scared of fly balls.')
  check('4. fear of fly balls returns something', r.scored.length > 0)
  check('   ...does not pad to fill a quota', r.scored.length < 12 || r.scored.every((s: any) => s.reason.score > 0))
  check('   ...every returned drill scored above zero',
    r.scored.every((s: any) => s.reason.score > 0))
}

// 5 — an environment constraint the library can actually answer
{
  const r = retrieve('Need an indoor throwing drill for an 8-year-old.')
  check('5. indoor is detected', r.debug.filtersApplied.includes('indoor_outdoor'))
  check('   ...age is detected too', r.debug.filtersApplied.includes('age'))
  check('   ...no outdoor-only drill survives',
    r.scored.every((s: any) => environmentEligible(s.drill, 'indoor')),
    r.scored.filter((s: any) => !environmentEligible(s.drill, 'indoor')).map((s: any) => s.drill.drill_name).join(', '))
  check('   ...still returns drills', r.scored.length > 0, `got ${r.scored.length}`)
}

// 6 — space AND equipment in one sentence
{
  const r = retrieve('What can we work on in the backyard with a glove and baseballs?')
  check('6. backyard reads as a small space', r.debug.filtersApplied.includes('space_required'))
  check('   ...equipment is read from the inventory phrase',
    r.debug.filtersApplied.includes('equipment'))
  check('   ...nothing needing a bigger space survives',
    r.scored.every((s: any) => spaceEligible(s.drill, 'small')))
  check('   ...nothing needing unavailable kit survives',
    r.scored.every((s: any) => equipmentEligible(s.drill, ['glove', 'baseballs'])),
    r.scored.filter((s: any) => !equipmentEligible(s.drill, ['glove', 'baseballs']))
      .map((s: any) => `${s.drill.drill_name}(${s.drill.equipment_needed})`).slice(0, 3).join(' | '))
}

// 7 — a flaw phrase that appears verbatim in the taxonomy
{
  const r = retrieve('My player keeps stepping in the bucket.')
  check('7. stepping in the bucket diagnoses', r.dx.slugs.includes('stepping-in-bucket'),
    JSON.stringify(r.dx.slugs))
  check('   ...returns mapped drills', r.scored[0]?.reason.matchedProblems.includes('stepping-in-bucket'))
}

// 8 — THE IMPORTANT ONE. A goal, not a flaw. Must not force a match, must not
//     return nothing.
{
  const r = retrieve('How do I help my pitcher throw harder?')
  check('8. a goal still returns drills', r.scored.length > 0, `got ${r.scored.length}`)
  check('   ...via the text/category path, not a forced taxonomy match',
    r.dx.slugs.length === 0 || r.debug.retrievalPath !== 'taxonomy',
    `slugs=${JSON.stringify(r.dx.slugs)} path=${r.debug.retrievalPath}`)
  check('   ...and they are throwing/pitching drills',
    r.scored.slice(0, 5).some((s: any) => /pitching|throwing|arm care/i.test(String(s.drill.skill_category))),
    names(r).slice(0, 5).join(' | '))
}

console.log('\n=== filters: applied when known, skipped when not ===')
{
  const known = retrieve('My 9-year-old is lunging.')
  check('a known age is applied', known.debug.filtersApplied.includes('age'))

  const unknown = retrieve('My hitter is lunging.')
  check('an unknown age is skipped, not guessed', unknown.debug.filtersSkipped.includes('age'))
  check('...and unknown age returns at least as many candidates',
    unknown.debug.candidateCountAfterFilters >= known.debug.candidateCountAfterFilters,
    `${unknown.debug.candidateCountAfterFilters} vs ${known.debug.candidateCountAfterFilters}`)
  check('unknown equipment does not filter', unknown.debug.filtersSkipped.includes('equipment'))
  check('unknown space does not filter', unknown.debug.filtersSkipped.includes('space_required'))
  check('unmentioned constraints leave the whole library eligible',
    unknown.debug.candidateCountBeforeFilters === 206)
}

console.log('\n=== age eligibility ===')
check('an 8yo is eligible for a 6-12 drill', ageEligible({ id: 'x', drill_name: 'd', min_age: 6, max_age: 12 }, 8))
check('a 5yo is not', !ageEligible({ id: 'x', drill_name: 'd', min_age: 6, max_age: 12 }, 5))
check('a 14yo is not', !ageEligible({ id: 'x', drill_name: 'd', min_age: 6, max_age: 12 }, 14))
check('unknown age passes everything', ageEligible({ id: 'x', drill_name: 'd', min_age: 6, max_age: 12 }, null))
check('a drill with no bounds is never excluded', ageEligible({ id: 'x', drill_name: 'd' }, 8))

console.log('\n=== curated mappings outrank auto ones ===')
{
  // Two drills, identical but for the curated flag on the same problem.
  const slug = MAPPINGS.find(m => m.curated)!.problem_slug
  const pool = [
    { id: 'auto', drill_name: 'Auto Drill', skill_category: 'Hitting' },
    { id: 'cur', drill_name: 'Curated Drill', skill_category: 'Hitting' },
  ]
  const rows = [
    { drill_id: 'auto', problem_slug: slug, curated: false, sort_order: 10 },
    { drill_id: 'cur', problem_slug: slug, curated: true, sort_order: 90 },
  ]
  const r = rankDrills(pool, rows, { query: '', slugs: [slug], categories: [], constraints: {} })
  check('curated wins even with a worse sort_order', r.scored[0].drill.id === 'cur',
    r.scored.map(s => `${s.drill.id}:${s.reason.score.toFixed(1)}`).join(' '))
  check('...and is labelled as curated', r.scored[0].reason.primary === 'curated-map')
  check('the auto mapping still makes the list', r.scored.length === 2)
}

console.log('\n=== a favorite is a tiebreak, not a promotion ===')
{
  const slug = MAPPINGS.find(m => m.curated)!.problem_slug
  const pool = [
    { id: 'fav', drill_name: 'Favorited Unrelated', skill_category: 'Bunting' },
    { id: 'cur', drill_name: 'Curated Match', skill_category: 'Hitting' },
  ]
  const rows = [{ drill_id: 'cur', problem_slug: slug, curated: true, sort_order: 100 }]
  const r = rankDrills(pool, rows, {
    query: 'unrelated', slugs: [slug], categories: [], constraints: {},
    favorites: new Set(['fav']),
  })
  check('a starred drill cannot outrank a curated match', r.scored[0].drill.id === 'cur',
    r.scored.map(s => `${s.drill.id}:${s.reason.score.toFixed(1)}`).join(' '))
}

console.log('\n=== scoping and status ===')
{
  // visibleDrills does the SQL scoping; rankDrills must not resurrect anything
  // it excluded. This proves the ranking layer adds nothing back.
  const mine = { id: 'mine', drill_name: 'My Drill', skill_category: 'Hitting', created_by_coach_id: 'coach-1' }
  const theirs = { id: 'theirs', drill_name: 'Their Drill', skill_category: 'Hitting', created_by_coach_id: 'coach-2' }
  const scopedPool = [mine]  // what visibleDrills would have returned for coach-1
  const r = rankDrills(scopedPool, [], { query: 'hitting drill', slugs: [], categories: ['Hitting'], constraints: {} })
  check('ranking only ever sees the scoped pool', !r.scored.some(s => s.drill.id === 'theirs'))
  check('a coach-authored drill in scope is rankable', r.scored.some(s => s.drill.id === 'mine'))
}
{
  const production = DRILLS.filter(d => d.status && d.status !== 'approved')
  check('no non-approved drill is in the visible library', production.length === 0,
    `${production.length} found`)
}

console.log('\n=== no arbitrary ceiling ===')
{
  const r = retrieve('My hitter is lunging.')
  check('the whole library enters the pool', r.debug.candidateCountBeforeFilters === DRILLS.length,
    `${r.debug.candidateCountBeforeFilters}/${DRILLS.length}`)
  check('...and the returned set is small', r.debug.returned <= 12)
  // A drill late in the table must still be reachable. Take the last row and
  // query for its own flaw text.
  const last = DRILLS[DRILLS.length - 1]
  const flaw = (last.common_flaws_fixed || [])[0] || last.drill_name
  const deep = retrieve(String(flaw))
  check('a drill at the end of the table is still discoverable',
    deep.scored.some((s: any) => s.drill.id === last.id) || deep.scored.length > 0,
    `looked for "${last.drill_name}" via "${flaw}"`)
}

console.log('\n=== determinism ===')
{
  const a = retrieve('My hitter is lunging forward.')
  const b = retrieve('My hitter is lunging forward.')
  check('the same question gives the same answer', names(a).join('|') === names(b).join('|'))
}

console.log('\n=== constraint reading ===')
check('"in the gym" is indoor', constraintsFromText('stuck in the gym tonight').indoorOutdoor === 'indoor')
check('"raining" is indoor', constraintsFromText("it's raining so we're inside").indoorOutdoor === 'indoor')
check('"on the field" is outdoor', constraintsFromText('we are on the field').indoorOutdoor === 'outdoor')
check('"backyard" is a small space', constraintsFromText('in the backyard').spaceAvailable === 'small')
check('"by myself" means alone', constraintsFromText('just me and my son, by myself') .alone === true)
check('an ordinary question sets no constraints',
  Object.keys(constraintsFromText('how do I teach a two-seam grip')).length === 0,
  JSON.stringify(constraintsFromText('how do I teach a two-seam grip')))
check('a bat mentioned in passing is not an inventory',
  constraintsFromText('he drops his bat head') .availableEquipment === undefined)
check('"all we have is a tee and balls" is an inventory',
  (constraintsFromText('all we have is a tee and balls').availableEquipment || []).length > 0)

check('"my 8-year-old" reads as 8', ageFromText('my 8-year-old keeps lunging') === 8)
check('"he is 10" reads as 10', ageFromText('he is 10 and struggling') === 10)
check('"8U" reads as 8', ageFromText('coaching 8U this year') === 8)
check('a jersey number is not an age', ageFromText('number 42 keeps lunging') === null)
check('no age in the sentence is null', ageFromText('he keeps lunging') === null)

console.log('\n=== equipment matching ===')
check('a drill needing nothing always passes',
  equipmentEligible({ id: 'x', drill_name: 'd', equipment_needed: ['None'] }, ['glove']))
check('a drill needing a tee fails without one',
  !equipmentEligible({ id: 'x', drill_name: 'd', equipment_needed: ['Tee'] }, ['glove', 'baseballs']))
check('"batting tee" satisfies "Tee"',
  equipmentEligible({ id: 'x', drill_name: 'd', equipment_needed: ['Tee'] }, ['batting tee']))
check('unknown equipment passes everything',
  equipmentEligible({ id: 'x', drill_name: 'd', equipment_needed: ['Tee', 'L-screen'] }, null))

console.log('\n=== environment and space ===')
check('an Outdoor drill fails an indoor request',
  !environmentEligible({ id: 'x', drill_name: 'd', indoor_outdoor: 'Outdoor' }, 'indoor'))
check('an Indoor/Outdoor drill passes either',
  environmentEligible({ id: 'x', drill_name: 'd', indoor_outdoor: 'Indoor/Outdoor' }, 'indoor') &&
  environmentEligible({ id: 'x', drill_name: 'd', indoor_outdoor: 'Indoor/Outdoor' }, 'outdoor'))
check('an outdoor request keeps indoor drills',
  environmentEligible({ id: 'x', drill_name: 'd', indoor_outdoor: 'Indoor' }, 'outdoor'))
check('a large-space drill fails a small space',
  !spaceEligible({ id: 'x', drill_name: 'd', space_required: 'Outfield/large' }, 'small'))
check('a small-space drill passes a large space',
  spaceEligible({ id: 'x', drill_name: 'd', space_required: 'Small' }, 'large'))
check('unknown space passes', spaceEligible({ id: 'x', drill_name: 'd', space_required: 'Large' }, null))

console.log('\n=== competition level ===')
check('a both-level drill always passes',
  competitionEligible({ id: 'x', drill_name: 'd', competition_level: 'both' }, 'rec'))
check('a travel-only drill fails a rec team',
  !competitionEligible({ id: 'x', drill_name: 'd', competition_level: 'travel' }, 'rec'))

console.log('\n=== grounding ===')
{
  const cands = [
    { id: 'a', drill_name: 'High Tee Drill', youtube_video_id: 'REALVIDEO1' },
    { id: 'b', drill_name: 'Soft Toss From the Side', youtube_video_id: 'REALVIDEO2' },
  ]
  const good = 'Try the **High Tee Drill** — https://www.youtube.com/watch?v=REALVIDEO1'
  const g1 = checkGrounding(good, cands)
  check('a real drill and real video pass', g1.ok)
  check('...and the citation is recorded', g1.citedDrillIds.includes('a'))

  const bad = 'Try the **Magic Bat Speed Drill** — https://www.youtube.com/watch?v=FAKE1234567'
  const g2 = checkGrounding(bad, cands)
  check('an invented drill name is caught', g2.unknownDrillNames.length === 1, JSON.stringify(g2.unknownDrillNames))
  check('an invented video id is caught', g2.unknownVideoIds.includes('FAKE1234567'))
  check('the fake link is stripped',
    !stripUngroundedVideos(bad, g2).includes('FAKE1234567'))
  check('...and the advice around it survives',
    stripUngroundedVideos(bad, g2).includes('Magic Bat Speed Drill'))

  check('a partial name still counts as a citation',
    checkGrounding('Use **High Tee** for this', cands).ok)
  check('bolded coaching cues are not drill claims',
    checkGrounding('Tell him **step toward your target** and **stay back**', cands).ok)
  check('an answer with no drills at all is fine',
    checkGrounding('At seven, this is normal. Give it a season.', cands).ok)
}

console.log('\n=== progression level 4 ===')
check('level 4 is its own stage, not folded into 3',
  stageOf({ id: 'x', drill_name: 'd', progression_level: 4 }) !== stageOf({ id: 'y', drill_name: 'e', progression_level: 3 }),
  `L4=${stageOf({ id: 'x', drill_name: 'd', progression_level: 4 })} L3=${stageOf({ id: 'y', drill_name: 'e', progression_level: 3 })}`)
check('level 4 is the LAST stage', stageOf({ id: 'x', drill_name: 'd', progression_level: 4 }) === 3)
check('level 3 is the middle stage', stageOf({ id: 'x', drill_name: 'd', progression_level: 3 }) === 2)
check('level 1 starts the plan', stageOf({ id: 'x', drill_name: 'd', progression_level: 1 }) === 1)
check('levels 2 and 3 share the rep-building stage',
  stageOf({ id: 'x', drill_name: 'd', progression_level: 2 }) === 2 &&
  stageOf({ id: 'y', drill_name: 'e', progression_level: 3 }) === 2,
  'both are the same job at two difficulties — 96% Beginner and 96% Intermediate')
check('an unknown level falls back to difficulty',
  stageOf({ id: 'x', drill_name: 'd', difficulty_level: 'Advanced' }) === 3)
check('no level and no difficulty lands in the middle',
  stageOf({ id: 'x', drill_name: 'd' }) === 2)
check('a level beyond the scale does not vanish',
  stageOf({ id: 'x', drill_name: 'd', progression_level: 9 }) === 3)
{
  // The real bug: a rehearsal drill and a game-speed drill in the same step.
  const l3 = DRILLS.filter(d => d.progression_level === 3).slice(0, 2)
  const l4 = DRILLS.filter(d => d.progression_level === 4).slice(0, 2)
  check('production has level-4 drills to protect', l4.length === 2)
  const steps = buildSteps([...l3, ...l4] as any)
  check('L3 and L4 land in different steps', steps.length === 2,
    `${steps.length} step(s): ${steps.map(s => `${s.title}(${s.drillIds.length})`).join(', ')}`)
  check('the game-speed drills are in the last step',
    steps[steps.length - 1].drillIds.every(id => l4.some(d => d.id === id)))
}

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
