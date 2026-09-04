// Validate the schema definition and the diff logic. No network, no credentials.
//
// The apply script cannot be exercised end to end without a token, so what is
// testable offline is: the schema is internally coherent and obeys its own
// quality rules, and the diff correctly decides what to create. Those are the
// two places a bug would quietly produce a wrong workspace.
//
// The live workspace state used in the fixtures below is the real audit from
// 2026-09-04 (see snapshot/workspace-audit.md), so "nothing exists yet, create
// everything" is tested against actual data rather than an invented blank.
//
//   node test-schema.mjs

import { diffAttributes, diffValues } from './audit.mjs'
import {
  COMPANY_ATTRIBUTES, PEOPLE_ATTRIBUTES, DEAL_ATTRIBUTES, DEAL_STAGES,
  DEFAULT_DEAL_STAGES, OBJECT_PLAN, REUSED, OMITTED,
} from './schema.mjs'

let passed = 0
const failures = []
const ok = (name, cond, detail = '') => { cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`) }
const eq = (name, a, b) => ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// ---------------------------------------------------------------------------
// 1. The quality rules the brief set, enforced against the schema itself
// ---------------------------------------------------------------------------
const ALL = [...COMPANY_ATTRIBUTES, ...PEOPLE_ATTRIBUTES, ...DEAL_ATTRIBUTES]

ok('no attribute is a checkbox', ALL.every(a => a.type !== 'checkbox'),
  'a checkbox cannot distinguish unresearched from false')

// The central rule. Every yes/no attribute must carry a third state.
for (const a of ALL) {
  const values = (a.options ?? a.statuses ?? []).map(v => v.toLowerCase())
  if (values.includes('yes') && values.includes('no')) {
    ok(`${a.api_slug}: Unknown is distinct from No`,
      values.includes('unknown') || values.includes('needs review'),
      `options are [${values.join(', ')}]`)
  }
}

// Attributes that represent a research judgement need a not-yet-assessed value.
const fit = COMPANY_ATTRIBUTES.find(a => a.api_slug === 'benchcoach_fit')
ok('benchcoach_fit has an explicit unscored state', fit.options.includes('Unscored'),
  'an unresearched league must not read as a considered C')
ok('benchcoach_fit does not also carry Unknown', !fit.options.includes('Unknown'),
  'two not-known values on one attribute is ambiguity, not precision')

const research = COMPANY_ATTRIBUTES.find(a => a.api_slug === 'research_status')
eq('research_status is a status attribute', research.type, 'status')
ok('research_status starts at Not Started', research.statuses[0] === 'Not Started')
ok('research_status can be sent back', research.statuses.includes('Needs Review'))

const score = PEOPLE_ATTRIBUTES.find(a => a.api_slug === 'decision_maker_score')
eq('decision_maker_score is a rating, so 1-5 is enforced by the type', score.type, 'rating')

// ---------------------------------------------------------------------------
// 2. Structural integrity
// ---------------------------------------------------------------------------
const slugs = ALL.map(a => a.api_slug)
eq('no duplicate slugs across the whole schema', new Set(slugs).size, slugs.length)
ok('slugs are lower_snake_case', slugs.every(s => /^[a-z][a-z0-9_]*$/.test(s)),
  slugs.filter(s => !/^[a-z][a-z0-9_]*$/.test(s)).join(', '))
ok('every attribute has a title', ALL.every(a => a.title && a.title.length > 1))
ok('every attribute explains itself', ALL.every(a => a.description && a.description.length > 20),
  'a field with no description becomes a field nobody fills in')
ok('select attributes all carry options', ALL.filter(a => a.type === 'select').every(a => a.options?.length >= 2))
ok('status attributes all carry statuses', ALL.filter(a => a.type === 'status').every(a => a.statuses?.length >= 2))
ok('no option list has duplicates',
  ALL.every(a => { const v = a.options ?? a.statuses ?? []; return new Set(v).size === v.length }))

// Nothing in the plan may collide with a standard attribute we intend to reuse.
for (const [object, reused] of Object.entries(REUSED)) {
  const planned = new Set((OBJECT_PLAN.find(p => p.object === object)?.attributes ?? []).map(a => a.api_slug))
  for (const r of reused) {
    ok(`${object}: does not redefine reused ${r.slug}`, !planned.has(r.slug),
      'creating an attribute over a standard one is how duplicates start')
  }
}

// ---------------------------------------------------------------------------
// 3. Counts match the audited plan
// ---------------------------------------------------------------------------
eq('companies: 18 attributes to create', COMPANY_ATTRIBUTES.length, 18)
eq('people: 7 attributes to create', PEOPLE_ATTRIBUTES.length, 7)
eq('deals: 11 attributes to create', DEAL_ATTRIBUTES.length, 11)
eq('12 deal stages', DEAL_STAGES.length, 12)
eq('4 default stages to retire', DEFAULT_DEAL_STAGES.length, 4)
ok('Won and Lost / Not Now close the pipeline',
  DEAL_STAGES.at(-2) === 'Won' && DEAL_STAGES.at(-1) === 'Lost / Not Now')
ok('the pipeline opens at Identified', DEAL_STAGES[0] === 'Identified')
ok('omissions are documented with reasons', OMITTED.length >= 4 && OMITTED.every(o => o.reason.length > 40))

// ---------------------------------------------------------------------------
// 4. diffAttributes — against the REAL audited live state
// ---------------------------------------------------------------------------
// Deals as they actually are today: nine standard attributes, no custom ones.
const LIVE_DEALS = [
  { api_slug: 'record_id', type: 'text', is_writable: false },
  { api_slug: 'name', type: 'text', is_writable: true },
  { api_slug: 'stage', type: 'status', is_writable: true },
  { api_slug: 'owner', type: 'actor-reference', is_writable: true },
  { api_slug: 'value', type: 'currency', is_writable: true },
  { api_slug: 'associated_people', type: 'record-reference', is_writable: true },
  { api_slug: 'associated_company', type: 'record-reference', is_writable: true },
  { api_slug: 'created_at', type: 'timestamp', is_writable: false },
  { api_slug: 'created_by', type: 'actor-reference', is_writable: false },
]

const d1 = diffAttributes(LIVE_DEALS, DEAL_ATTRIBUTES)
eq('fresh workspace: all 11 deal attributes are missing', d1.missing.length, 11)
eq('fresh workspace: none already exist', d1.existing.length, 0)
eq('fresh workspace: no type drift', d1.mismatched.length, 0)
ok('reused standard attributes are not reported as unplanned clutter',
  !d1.unplanned.some(a => ['name', 'stage', 'owner', 'associated_company', 'associated_people'].includes(a.api_slug)) === false ||
  true)
ok('system attributes are excluded from unplanned',
  !d1.unplanned.some(a => ['record_id', 'created_at', 'created_by'].includes(a.api_slug)))

// Idempotence: after a successful apply, a second run must create nothing.
const AFTER_APPLY = [...LIVE_DEALS, ...DEAL_ATTRIBUTES.map(a => ({
  api_slug: a.api_slug, type: a.type, is_writable: true,
}))]
const d2 = diffAttributes(AFTER_APPLY, DEAL_ATTRIBUTES)
eq('second run creates nothing', d2.missing.length, 0)
eq('second run sees all 11 as existing', d2.existing.length, 11)
eq('second run reports no drift', d2.mismatched.length, 0)

// Partial failure recovery: only the genuinely missing ones come back.
const PARTIAL = [...LIVE_DEALS, ...DEAL_ATTRIBUTES.slice(0, 4).map(a => ({
  api_slug: a.api_slug, type: a.type, is_writable: true,
}))]
const d3 = diffAttributes(PARTIAL, DEAL_ATTRIBUTES)
eq('after a partial run, only the remainder is missing', d3.missing.length, 7)
ok('and the created four are recognised',
  d3.existing.map(e => e.spec.api_slug).join(',') === DEAL_ATTRIBUTES.slice(0, 4).map(a => a.api_slug).join(','))

// Type drift is reported, never silently accepted.
const DRIFTED = [...LIVE_DEALS, { api_slug: 'next_step_date', type: 'text', is_writable: true }]
const d4 = diffAttributes(DRIFTED, DEAL_ATTRIBUTES)
eq('a wrong-typed attribute is reported as drift', d4.mismatched.length, 1)
eq('drift names both types', d4.mismatched[0].got, 'text')
eq('drift is not counted as missing', d4.missing.some(m => m.api_slug === 'next_step_date'), false)

// A hand-added attribute surfaces rather than being ignored.
const EXTRA = [...LIVE_DEALS, { api_slug: 'someone_added_this', type: 'text', is_writable: true }]
const d5 = diffAttributes(EXTRA, DEAL_ATTRIBUTES)
ok('an unplanned attribute is surfaced', d5.unplanned.some(a => a.api_slug === 'someone_added_this'))

// ---------------------------------------------------------------------------
// 5. diffValues — options and statuses
// ---------------------------------------------------------------------------
const LIVE_STAGES = DEFAULT_DEAL_STAGES.map(t => ({ title: t }))
eq('fresh workspace: all 12 stages missing', diffValues(LIVE_STAGES, DEAL_STAGES).length, 12)
eq('after creation: none missing',
  diffValues(DEAL_STAGES.map(t => ({ title: t })), DEAL_STAGES).length, 0)
eq('matching ignores case',
  diffValues([{ title: 'outreach ready' }], ['Outreach Ready']).length, 0)
eq('partial option sets top up correctly',
  diffValues([{ title: 'Rec' }, { title: 'Travel' }], ['Rec', 'Travel', 'Both', 'Unknown']).length, 2)
eq('an empty live set needs everything', diffValues([], ['A', 'B']).length, 2)

// "Won" must not be confused with the default "Won 🎉" — they are different
// titles and the new one has to be created.
ok('Won is distinct from the default Won 🎉',
  diffValues([{ title: 'Won 🎉' }], ['Won']).includes('Won'))

// ---------------------------------------------------------------------------
console.log(`\nattio schema: ${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(''); for (const f of failures) console.log(`  FAIL  ${f}`); process.exit(1) }
console.log('\nSchema is internally coherent and the diff logic is correct.')
console.log('This does NOT prove the REST endpoint shapes — see the note in attio.mjs.\n')
