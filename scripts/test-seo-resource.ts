// The resource layer on an SEO page: does it degrade safely?
//
// These pages rank. Several of them are the reason anyone finds BenchCoach at
// all. So the interesting cases here are not the happy ones — they are the
// ones where a page carries a half-written or malformed resource block, and
// the only acceptable outcome is that it renders as the article it already
// was rather than as a wall of empty headings.
//
// The second thing under test is the no-invention rule. Every optional field
// must survive being absent, and nothing may be conjured to fill it.
//
//   npm run test:seo-resource

import {
  readResource, drillSlug, rowTimeLabel, rowMinutes, totalMinutes,
  equipmentChecklist, drillCategories, isDetailed,
} from '@/lib/seoResource'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

// ── the guarantee that protects the other ~76 pages ─────────────────────────

check('no content is no resource', readResource(undefined) === null)
check('an article with no block is no resource', readResource({ sections: [] }) === null)
check('a null block is no resource', readResource({ resource: null }) === null)
check('a string block is no resource', readResource({ resource: 'practice-plan' }) === null)
check('an unknown kind is refused', readResource({ resource: { kind: 'newsletter', objective: 'x' } }) === null,
  'a typo in `kind` must not render a half-page')
check('a kind with nothing under it is refused',
  readResource({ resource: { kind: 'practice-plan' } }) === null,
  'an empty block would render a header over nothing')

// ── the block reads ─────────────────────────────────────────────────────────

const plan = readResource({
  resource: {
    kind: 'practice-plan',
    meta: [{ label: 'Age', value: '7–8' }, { label: 'Length', value: '60 minutes' }],
    objective: 'High reps, short lines.',
    timeline: [
      { from: 0, to: 10, activity: 'Warmup', focus: 'Movement' },
      { from: 10, to: 25, activity: 'Throwing', focus: 'Arm care', drill: 'Knee Throws' },
      { from: 25, to: 60, activity: 'Stations' },
    ],
    drills: [{ name: 'Knee Throws', equipment: ['Baseballs'], skill: 'Throwing' }],
  },
})

check('a real block reads', plan !== null)
check('kind survives', plan?.kind === 'practice-plan')
check('meta survives', plan?.meta?.length === 2)
check('objective survives', plan?.objective === 'High reps, short lines.')
check('timeline survives', plan?.timeline?.length === 3)
check('a field nobody wrote stays undefined', plan?.rosterVariants === undefined,
  'absent must mean absent, not an empty array that renders a heading')
check('symptoms are absent on a practice plan', plan?.symptoms === undefined)

// ── malformed rows are dropped, not rendered ────────────────────────────────

const messy = readResource({
  resource: {
    kind: 'drill-library',
    drills: [
      { name: 'Good Drill' },
      { name: '   ' },                 // whitespace only
      { name: null },                  // no name at all
      { notName: 'High Tee' },         // wrong shape entirely
      'High Tee',                      // not an object
    ],
  },
})
check('a drill with no name is dropped', messy?.drills?.length === 1,
  `kept ${messy?.drills?.length ?? 0}, expected 1`)
check('the good drill survives the bad ones', messy?.drills?.[0].name === 'Good Drill')

const badRows = readResource({
  resource: {
    kind: 'practice-plan',
    timeline: [{ activity: 'Warmup' }, { focus: 'no activity' }, {}],
  },
})
check('a timeline row with no activity is dropped', badRows?.timeline?.length === 1)

check('a block whose every item was junk is null',
  readResource({ resource: { kind: 'drill-library', drills: [{ name: '' }] } }) === null,
  'dropping everything leaves an empty block, which is not a block')

// ── empty strings never reach the page ──────────────────────────────────────

const blanks = readResource({
  resource: { kind: 'practice-plan', objective: '   ', equipment: ['', '  '], timeline: [{ activity: 'Warmup' }] },
})
check('a whitespace objective is undefined', blanks?.objective === undefined)
check('a list of blanks is undefined', blanks?.equipment === undefined,
  'otherwise the equipment card renders with empty checkboxes')

// ── time labels ─────────────────────────────────────────────────────────────

check('a range labels as a range', rowTimeLabel({ from: 0, to: 10, activity: 'x' }) === '0–10')
check('an open end labels as open', rowTimeLabel({ from: 50, activity: 'x' }) === '50+')
check("the author's own label wins", rowTimeLabel({ from: 0, to: 10, time: 'First 10', activity: 'x' }) === 'First 10',
  'a coach who wrote "First 10" meant it')
check('no time at all is empty, not NaN', rowTimeLabel({ activity: 'x' }) === '')

check('minutes compute', rowMinutes({ from: 10, to: 25, activity: 'x' }) === 15)
check('a backwards row has no duration', rowMinutes({ from: 25, to: 10, activity: 'x' }) === null)
check('a free-text row has no duration', rowMinutes({ time: 'a while', activity: 'x' }) === null)

// ── totals: right, or absent ────────────────────────────────────────────────

check('a full timeline totals', totalMinutes([
  { from: 0, to: 10, activity: 'a' },
  { from: 10, to: 25, activity: 'b' },
]) === 25)
check('one uncomputable row makes the total null', totalMinutes([
  { from: 0, to: 10, activity: 'a' },
  { time: 'rest of practice', activity: 'b' },
]) === null,
  'printing "10 minutes" under a 60-minute plan is worse than printing nothing')
check('no timeline totals to null', totalMinutes([]) === null)
check('no timeline at all totals to null', totalMinutes(undefined) === null)

// ── equipment ───────────────────────────────────────────────────────────────

check('equipment is gathered from the drills', equipmentChecklist({
  kind: 'practice-plan',
  drills: [
    { name: 'a', equipment: ['Baseballs', 'Tee'] },
    { name: 'b', equipment: ['Baseballs', 'Cones'] },
  ],
}).length === 3, 'Baseballs appears twice and should be listed once')

check('case does not duplicate an item', equipmentChecklist({
  kind: 'practice-plan',
  drills: [{ name: 'a', equipment: ['Baseballs'] }, { name: 'b', equipment: ['baseballs'] }],
}).length === 1)

check("the author's own list wins outright", equipmentChecklist({
  kind: 'practice-plan',
  equipment: ['Whatever I say'],
  drills: [{ name: 'a', equipment: ['Baseballs', 'Tee', 'Cones'] }],
}).join() === 'Whatever I say',
  'an explicit list is the coach saying what to bring, including things no drill mentions')

check('nothing anywhere is an empty list', equipmentChecklist({ kind: 'drill-library' }).length === 0)

// ── jump-nav categories ─────────────────────────────────────────────────────

const cats = drillCategories([
  { name: 'a', skill: 'Balance' },
  { name: 'b', skill: 'Contact' },
  { name: 'c', skill: 'balance' },
  { name: 'd' },
])
check('categories group case-insensitively', cats.length === 2, `got ${cats.length}`)
check('first spelling is the one shown', cats[0].skill === 'Balance')
check('a drill with no skill joins no group', cats.reduce((n, c) => n + c.drills.length, 0) === 3,
  'the nav must never advertise a section the page does not have')
check('no drills is no categories', drillCategories(undefined).length === 0)

// ── anchors ─────────────────────────────────────────────────────────────────

check('a name slugifies', drillSlug({ name: 'Freeze After Contact' }) === 'freeze-after-contact')
check('an apostrophe does not become a dash', drillSlug({ name: "Coach's Toss" }) === 'coachs-toss',
  'coach-s-toss is an ugly anchor and a fragile one')
check('a stored slug wins over the name', drillSlug({ slug: 'high-tee', name: 'High Tee Drill' }) === 'high-tee',
  'renaming a drill must not break every link pointing at it')
check('punctuation does not leave trailing dashes', drillSlug({ name: 'Hit & Drop!' }) === 'hit-drop')

// ── which drills earn a full section ────────────────────────────────────────

check('a name alone is a table row, not a section', isDetailed({ name: 'High Tee' }) === false)
check('a setup earns a section', isDetailed({ name: 'x', setup: 'Tee at chest height' }) === true)
check('a cue alone earns a section', isDetailed({ name: 'x', coachingCues: ['Stay back'] }) === true)
check('an empty cue list does not', isDetailed({ name: 'x', coachingCues: [] }) === false)

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
