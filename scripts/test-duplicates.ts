// A duplicate disappears from discovery and stays resolvable by id.
//
// Those two halves are the whole feature, and they pull in opposite directions,
// which is why both are asserted here rather than one being assumed from the
// other. Hide it from history and a finalized player report loses the drill it
// recommended. Leave it in discovery and the coach sees "Front Toss" and
// "Front Toss Drill" side by side and wonders which one is the real one.
//
// The rule about WHAT may be marked matters as much as the mechanism: only a
// true duplicate. A variation and a progression are different activities, and
// marking either one deletes a choice the coach should be making.
//
//   npm run test:duplicates

import { createClient } from '@supabase/supabase-js'
import { visibleDrills, schedulableDrills, isSchedulable, DRILL_FIELDS } from '@/lib/drills'
import { loadDecisions } from './build-canon-audit'
import { readFileSync } from 'fs'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const COACH = '11111111-1111-1111-1111-111111111111'
const sb: any = createClient('https://example.supabase.co', 'anon-key')
const urlOf = (q: any) => decodeURIComponent(String(q.url))

// ── the query split ─────────────────────────────────────────────────────────

const vis = urlOf(visibleDrills(sb, COACH, 'id'))
const sch = urlOf(schedulableDrills(sb, COACH, 'id'))

check('schedulableDrills excludes duplicates',
  sch.includes('duplicate_of_drill_id=is.null'), sch)
check('visibleDrills does NOT — a stored id must still resolve',
  !vis.includes('duplicate_of_drill_id'), vis)
check('the ownership filter is still identical on both',
  sch.includes(`or=(created_by_coach_id.is.null,created_by_coach_id.eq.${COACH})`) &&
  vis.includes(`or=(created_by_coach_id.is.null,created_by_coach_id.eq.${COACH})`))
check('DRILL_FIELDS selects the column, or nothing can ever filter on it',
  DRILL_FIELDS.includes('duplicate_of_drill_id'))

// ── the in-memory twin agrees ───────────────────────────────────────────────

check('a duplicate is not schedulable',
  !isSchedulable({ resource_kind: 'activity', duplicate_of_drill_id: 'x' }))
check('...even though its own kind says activity',
  isSchedulable({ resource_kind: 'activity' }) &&
  !isSchedulable({ resource_kind: 'activity', duplicate_of_drill_id: 'x' }))
check('a canonical row is unaffected',
  isSchedulable({ resource_kind: 'activity', duplicate_of_drill_id: null }))
check('an unclassified row with no duplicate flag is still schedulable',
  isSchedulable({ resource_kind: null }))

// ── what may be marked, and what may not ────────────────────────────────────

const ALL = loadDecisions()
const byId = new Map(ALL.map(d => [d.drill_id, d]))
const snapshot: any[] = JSON.parse(readFileSync('scripts/fixtures/drill-library-snapshot.json', 'utf8'))

// The backfill rule: MERGE_INTO at high confidence, and nothing else.
const eligible = ALL.filter(d => d.disposition === 'MERGE_INTO' && d.confidence === 'high')
check('the backfill set is the high-confidence merges only', eligible.length === 20,
  `${eligible.length}`)

const wrongKind = ALL.filter(d =>
  ['VARIATION_OF', 'PROGRESSION_OF'].includes(d.disposition) &&
  eligible.some(e => e.drill_id === d.drill_id))
check('no variation or progression is in the backfill set', wrongKind.length === 0,
  'a variation is a DIFFERENT activity — marking it deletes a choice')

check('every duplicate points at a row that is itself canonical',
  eligible.every(d => {
    const t = byId.get(d.canonical_target_id)
    return t && t.disposition !== 'MERGE_INTO'
  }),
  'a chain makes "the real drill" an unbounded walk')

check('no duplicate points at itself',
  eligible.every(d => d.canonical_target_id !== d.drill_id))

check('no duplicate points at a demoted row',
  eligible.every(d => {
    const t = byId.get(d.canonical_target_id)!
    return !['SOURCE_COLLECTION', 'TEACHING_CONTENT'].includes(t.disposition)
  }),
  'that would send a coach from a real drill to a compilation')

// The pairs the brief names, spelled out so a silent re-classification shows up.
const NAMED: Array<[string, string]> = [
  ['Front Toss Drill', 'Front Toss'],
  ['Tee Drill', 'Tee Work'],
  ['Crow Hop Drill', 'Crow Hop — Arm Strength and Outfield Throwing'],
  ['Funnel Drill', 'Funnel Drill — Correct Arm Path Out of the Glove'],
]
const nameOf = new Map(snapshot.map(d => [d.id, d.drill_name]))
for (const [dupName, canonName] of NAMED) {
  const dup = eligible.find(d => nameOf.get(d.drill_id) === dupName)
  check(`"${dupName}" is a duplicate of "${canonName}"`,
    !!dup && nameOf.get(dup.canonical_target_id) === canonName,
    dup ? `points at ${nameOf.get(dup.canonical_target_id)}` : 'not in the backfill set')
}

// And the pairs the brief says must NOT be merged.
const KEPT_APART: Array<[string, string]> = [
  ['Quick Hands Drill', 'Quick Hands Quick Feet — Fast Transfer Drill'],
  ['Long Toss', 'Long Toss Progression — Building Arm Strength Safely'],
  ['Wall Ball', 'Wall Ball Solo Drill — Partner-Free Mechanics Builder'],
]
for (const [a, b] of KEPT_APART) {
  const ids = snapshot.filter(d => [a, b].includes(d.drill_name)).map(d => d.id)
  const marked = ids.filter(id => eligible.some(e => e.drill_id === id))
  check(`"${a}" and "${b}" are NOT collapsed into one`, marked.length === 0,
    'related is not the same as duplicate')
}

// ── historical resolution, explicitly ───────────────────────────────────────
//
// The failure being guarded is a stored id that stops resolving. A duplicate is
// invisible to discovery by design, so the only thing standing between it and a
// blank in somebody's finalized report is that the by-id path never learned
// about the column.

const HISTORY_SURFACES: Array<[string, string]> = [
  ['lib/playerReportStore.ts', 'Player Report snapshot + stored ids'],
  ['app/api/practice-plan/route.ts', 'coach-picked drill ids'],
  ['lib/checkin.ts', 'check-ins resolving prescription ids'],
  ['app/api/development-plan/route.ts', 'development-plan stored ids'],
  ['app/api/prescribe/step/route.ts', 'prescription stored ids'],
]
for (const [file, what] of HISTORY_SURFACES) {
  const src = readFileSync(file, 'utf8')
  check(`${what} never filters on duplicate_of_drill_id`,
    !src.includes('duplicate_of_drill_id'),
    `${file} — a duplicate must still resolve by id`)
}

// /api/drills is checked by SECTION rather than by file: it legitimately
// SELECTS the column for ?include=all (asserted below), and a whole-file match
// would fail on that. What matters is that the two by-name lookups — which
// resolve a name a saved plan already contains — do not filter on it.
const drillsApi = readFileSync('app/api/drills/route.ts', 'utf8')
const byNameSection = drillsApi.slice(0, drillsApi.indexOf('// Get all drills'))
check('the by-name lookups never filter on duplicate_of_drill_id',
  !byNameSection.includes('duplicate_of_drill_id') && !byNameSection.includes('schedulableDrills('),
  'a plan block naming a duplicate must still find its video')

const store = readFileSync('lib/playerReportStore.ts', 'utf8')
const loadSel = store.slice(store.indexOf('export async function loadSelectableDrills'),
  store.indexOf('export async function', store.indexOf('export async function loadSelectableDrills') + 10))
check('loadSelectableDrills still goes through visibleDrills, which ignores the column',
  loadSel.includes('visibleDrills(') && !loadSel.includes('schedulableDrills('))

const hook = readFileSync('lib/useDrillResources.ts', 'utf8')
check('the client still caches duplicates so findDrill resolves a saved plan',
  hook.includes("'/api/drills?include=all'") && hook.includes('for (const drill of allDrills)'))
check('...while the browse list filters them out through isSchedulable',
  hook.includes('allDrills.filter(d => isSchedulable(d))'))

const api = readFileSync('app/api/drills/route.ts', 'utf8')
check('?include=all ships the column so the client can tell them apart',
  api.includes("resource_kind, duplicate_of_drill_id"))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
