// Demotion stops future recommendations. It must not break history.
//
// The failure this guards is quiet and slow: a coach finalizes a player report
// in 2026 naming four drills. In 2027 one of those rows is reclassified as a
// compilation. If the by-id read that renders the report had been "improved"
// to use schedulableDrills, the report would come back with three drills and
// nothing anywhere would say why.
//
// So this asserts, by reading the source, WHICH surfaces changed and which did
// not — because the distinction lives in the choice of helper at each call
// site, and nothing at runtime will ever complain about getting it wrong.
//
//   npm run test:canon-history

import { readFileSync } from 'fs'
import { loadDecisions, resourceKindFor, schedulableAfter } from './build-canon-audit'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
const src = (p: string) => readFileSync(p, 'utf8')

// ── discovery moved ────────────────────────────────────────────────────────
//
// "What should I run?" — every one of these must be on schedulableDrills.

const DISCOVERY: Array<[string, string]> = [
  ['lib/drillRetrieval.ts', 'the candidate pool behind every recommendation'],
  ['app/api/practice-plan/swap/route.ts', 'the swap candidate pool'],
  ['app/api/practice-plan/route.ts', 'the practice generator fallback pool'],
  ['app/api/prescribe/route.ts', 'the prescription fallback candidates'],
  ['app/dashboard/drills/page.tsx', 'the drill library a coach browses'],
  ['app/api/drills/route.ts', 'the Drill Finder / builder library listing'],
  ['lib/playerReportStore.ts', 'Player Report manual drill search'],
]

for (const [file, what] of DISCOVERY) {
  check(`${what} goes through schedulableDrills`,
    /\bschedulableDrills(Safe)?\s*\(/.test(src(file)), file)
}

// ── history did not ────────────────────────────────────────────────────────
//
// Each of these resolves something ALREADY CHOSEN — a stored id, a stored name.

const store = src('lib/playerReportStore.ts')
const loadSelectable = store.slice(store.indexOf('export async function loadSelectableDrills'),
                                  store.indexOf('export async function', store.indexOf('export async function loadSelectableDrills') + 10))
check('Player Report loadSelectableDrills still resolves stored ids via visibleDrills',
  loadSelectable.includes('visibleDrills(') && !loadSelectable.includes('schedulableDrills('),
  'a finalized report must still render a drill demoted after it was signed')

const plan = src('app/api/practice-plan/route.ts')
const picked = plan.slice(plan.indexOf('const picked = await'), plan.indexOf('const picked = await') + 400)
check('drills the coach explicitly picked are fetched by id via visibleDrillsSafe',
  picked.includes('visibleDrillsSafe(') && !picked.includes('schedulableDrillsSafe('),
  'asking for a drill by id is not asking the library what to run')

const drillsApi = src('app/api/drills/route.ts')
const byName = drillsApi.slice(0, drillsApi.indexOf('// Get all drills'))
check('the by-name lookups in /api/drills still use visibleDrills',
  (byName.match(/visibleDrills\(/g) || []).length === 2 && !byName.includes('schedulableDrills('),
  'they resolve a name a saved plan already contains')

check('/api/drills can still return the demoted rows for resolution',
  drillsApi.includes("include") && drillsApi.includes('visibleDrills'),
  'two of the fifteen production plans name a row this change demotes')

const hook = src('lib/useDrillResources.ts')
check('the client caches every visible drill, not just the schedulable ones',
  hook.includes("'/api/drills?include=all'"))
check('...and findDrill searches that full set, so a saved plan still resolves',
  hook.includes('for (const drill of allDrills)'))
check('...while the browse list is filtered to what may be offered',
  (hook.match(/allDrills\.filter\(d => isSchedulable\(d\)\)/g) || []).length === 3,
  'every place `drills` is set must filter, or one path leaks collections into the picker')

// Surfaces the brief names as by-id and which must not have been touched.
for (const [file, what] of [
  ['lib/checkin.ts', 'check-ins resolving stored prescription ids'],
  ['app/api/development-plan/route.ts', 'development-plan stored drill ids'],
  ['app/api/prescribe/step/route.ts', 'prescription stored drill ids'],
  ['app/api/admin/verify-links/route.ts', 'the admin link checker'],
] as Array<[string, string]>) {
  check(`${what} is untouched by this change`,
    !/\bschedulableDrills(Safe)?\s*\(/.test(src(file)), file)
}

// The link checker must keep seeing the WHOLE library — a demoted row's video
// can still rot, and a checker that stops looking at it is worse than useless.
check('the admin link checker still scans demoted rows too',
  src('app/api/admin/verify-links/route.ts').includes("from('drill_resources')"))

// ── the audit itself ───────────────────────────────────────────────────────

const decisions = loadDecisions()
const snapshotRows: any[] = JSON.parse(src('scripts/fixtures/drill-library-snapshot.json'))

// Compared to the library rather than to a number. Phase 2A added twelve
// activities, and a hardcoded 208 would have had to be edited on every
// legitimate addition — which is how a completeness check quietly becomes a
// number somebody updates to make the test pass.
check('every curated row has a decision',
  decisions.length === snapshotRows.length,
  `${decisions.length} decisions for ${snapshotRows.length} rows`)
check('no drill id is decided twice',
  new Set(decisions.map(d => d.drill_id)).size === decisions.length)

const csv = src('docs/audits/drill-canonicalization-decisions.csv').trim().split('\n')
check('the generated CSV holds every row and a header',
  csv.length === snapshotRows.length + 1, `${csv.length} lines for ${snapshotRows.length} rows`)
check('every CSV row claims its video is preserved',
  csv.slice(1).every(l => l.includes(',yes,')),
  'preserve_current_video is yes on all 208')

// A merge target that is itself demoted would send a coach from a real drill to
// a compilation — the exact inversion of the point.
const kind = new Map(decisions.map(d => [d.drill_id, resourceKindFor(d.disposition)]))
const badTargets = decisions.filter(d =>
  d.canonical_target_id && !schedulableAfter(
    decisions.find(x => x.drill_id === d.canonical_target_id)?.disposition || 'KEEP_CANONICAL'))
check('no row is merged into a demoted row', badTargets.length === 0,
  badTargets.map(d => d.drill_id).join(', '))

const selfTarget = decisions.filter(d => d.canonical_target_id === d.drill_id)
check('no row is its own canonical target', selfTarget.length === 0)

const unknownTarget = decisions.filter(d =>
  d.canonical_target_id && !decisions.some(x => x.drill_id === d.canonical_target_id))
check('every canonical target is itself a row in the audit', unknownTarget.length === 0,
  unknownTarget.map(d => d.canonical_target_id).join(', '))

// Phase 1 classified three categories and left the rest NULL. Phase 2A finished
// the job, so the invariant to hold now is the opposite one: every row carries a
// classification EXCEPT the ones deliberately left for a human.
const unclassified = snapshotRows.filter(d => !d.resource_kind)
const reviewRequired = decisions.filter(d => d.disposition === 'REVIEW_REQUIRED')
check('every row is classified except those marked REVIEW_REQUIRED',
  unclassified.length === reviewRequired.length,
  `${unclassified.length} unclassified, ${reviewRequired.length} awaiting review`)
check('...and they are the same rows',
  unclassified.every(d => reviewRequired.some(r => r.drill_id === d.id)),
  'a row is unclassified for a reason nobody wrote down')

// Uncertainty must not have demoted anything: an unreviewed row stays usable.
check('an unreviewed row is still offerable',
  unclassified.every(d => !d.duplicate_of_drill_id),
  'REVIEW_REQUIRED means unknown, and unknown is not a reason to take a drill away')

// Every demoted row must have left its activity family — a source collection is
// not a member of a family of real drills.
const demotedInFamily = snapshotRows.filter(d =>
  ['source_collection', 'teaching_content'].includes(String(d.resource_kind)) && d.activity_family_id)
check('no demoted row still holds a place in an activity family',
  demotedInFamily.length === 0,
  demotedInFamily.map(d => d.drill_name).join(', '))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
