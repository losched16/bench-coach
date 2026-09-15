// Visible is not the same question as schedulable, and the day those two blur
// is the day a coach's finalized player report loses the drill it recommended.
//
//   VISIBLE      may this coach see and RESOLVE this row?
//   SCHEDULABLE  may this row be OFFERED as something to run?
//
// Demotion is about the future. A row reclassified as a compilation stops being
// suggested; it does not reach back into a plan somebody already printed or a
// report somebody already signed.
//
// These assert both halves, and the privacy boundary underneath both — because
// schedulableDrills narrowing visibleDrills is only safe if it cannot widen it.
//
//   npm run test:schedulable

import { createClient } from '@supabase/supabase-js'
import {
  visibleDrills, schedulableDrills, isSchedulable, schedulableKinds,
  RESOURCE_KINDS, NOT_SCHEDULABLE, DRILL_FIELDS,
} from '@/lib/drills'
import { readFileSync } from 'fs'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const COACH = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const sb: any = createClient('https://example.supabase.co', 'anon-key')
const urlOf = (q: any) => decodeURIComponent(String(q.url))

// ── 1-2. collections and tutorials cannot enter a candidate pool ────────────

const pool = urlOf(schedulableDrills(sb, COACH, 'id'))
check('a source_collection cannot enter the pool',
  !pool.includes('source_collection') || pool.includes('resource_kind.in.'),
  pool)
check('the filter names only the kinds that MAY be offered',
  pool.includes('resource_kind.in.(activity,practice_unit)'),
  pool)
check('source_collection is not among them', !pool.includes('in.(activity,practice_unit,source_collection'))
check('teaching_content is not among them', !/in\.\([^)]*teaching_content/.test(pool))

// The in-memory twin has to agree with the query, or a fixture-backed surface
// and a database-backed one disagree about the same drill.
check('a source_collection is not schedulable', !isSchedulable({ resource_kind: 'source_collection' }))
check('teaching_content is not schedulable', !isSchedulable({ resource_kind: 'teaching_content' }))
check('an activity is schedulable', isSchedulable({ resource_kind: 'activity' }))

// ── 3-4. canonical activities and legacy NULLs stay retrievable ─────────────

check('a canonical activity remains retrievable', isSchedulable({ resource_kind: 'activity' }))
check('a legacy NULL resource_kind remains retrievable', isSchedulable({ resource_kind: null }))
check('...and so does a row with no resource_kind key at all', isSchedulable({ drill_name: 'x' }))
check('...and an empty string, which is what a CSV round trip produces',
  isSchedulable({ resource_kind: '' }))
check('the QUERY keeps nulls too — an exclusion list alone would drop them',
  pool.includes('resource_kind.is.null'),
  'NOT IN (...) is NULL for a NULL column, so the null branch must be explicit')

// ── 5-6. the privacy boundary is narrowed, never widened ───────────────────

const vis = urlOf(visibleDrills(sb, COACH, 'id'))
const sched = urlOf(schedulableDrills(sb, COACH, 'id'))

check('schedulable carries the SAME ownership filter as visible',
  sched.includes(`or=(created_by_coach_id.is.null,created_by_coach_id.eq.${COACH})`))
check('...and the same status filter', sched.includes('or=(status.eq.approved,status.is.null)'))
check('schedulable is visible plus one more clause, never fewer',
  vis.split('&').every(part => sched.includes(part)),
  `visible: ${vis}\n       schedulable: ${sched}`)
check("another coach's id appears nowhere in the query",
  !sched.includes(OTHER))
check('a coach-authored drill (NULL kind) stays available to its owner',
  isSchedulable({ resource_kind: null, created_by_coach_id: COACH }))
check('an anonymous read is still curated-only',
  urlOf(schedulableDrills(sb, null, 'id')).includes('created_by_coach_id=is.null'))

// ── practice units ─────────────────────────────────────────────────────────

check('a practice_unit is schedulable by default', isSchedulable({ resource_kind: 'practice_unit' }))
check('...and excluded where a single drill is required',
  !isSchedulable({ resource_kind: 'practice_unit' }, { practiceUnits: false }))
check('the prescribe-shaped query drops practice units',
  !urlOf(schedulableDrills(sb, COACH, 'id', { practiceUnits: false })).includes('practice_unit'))

// ── the enum cannot drift away from the filter ─────────────────────────────
//
// Adding a kind in SQL without adding it here would silently drop every row of
// that kind out of the pool. This is the check that makes that a build failure.

const sqlSrc = readFileSync('migrations/062_resource_kind_and_media.sql', 'utf8')
const sqlKinds = (sqlSrc.match(/'activity',\s*'practice_unit',\s*'source_collection',\s*'teaching_content'/) || [])[0]
check('the SQL CHECK constraint lists exactly the kinds lib/drills.ts knows',
  !!sqlKinds && RESOURCE_KINDS.every(k => sqlKinds.includes(`'${k}'`)) &&
  (sqlKinds.match(/'/g) || []).length / 2 === RESOURCE_KINDS.length,
  `TS: ${RESOURCE_KINDS.join(',')}`)
check('every kind is either allowed or explicitly excluded — none is forgotten',
  RESOURCE_KINDS.every(k =>
    schedulableKinds().includes(k) || (NOT_SCHEDULABLE as readonly string[]).includes(k)))
check('a kind added to the enum is included by default, not silently dropped',
  schedulableKinds().length === RESOURCE_KINDS.length - NOT_SCHEDULABLE.length)

// ── DRILL_FIELDS carries the column, or every row reads as unclassified ────

check('DRILL_FIELDS selects resource_kind',
  DRILL_FIELDS.includes('resource_kind'),
  'without it every row arrives with kind undefined and nothing is ever filtered')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
