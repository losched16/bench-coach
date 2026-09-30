// The pure rules behind "Record on players' plans" (migration 077).
//
//   npm run test:practice-plan-link
//
// The route is exercised through the real authorization path in
// test:player-scope; this is the arithmetic both it and the practice page use.

import {
  practiceLink, linkColumns, isMissingLinkColumns, practiceDrillIds,
  practiceSessionDate, practiceMinutes, recordedFor, defaultSelection,
} from '../lib/practicePlanLink'

let passed = 0
const failures: string[] = []
const eq = (name: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// practiceLink
eq('no link on a practice built without a plan', practiceLink({ pathway_slug: null }), null)
eq('no link on a blank slug', practiceLink({ pathway_slug: '  ' }), null)
eq('no link on a practice saved before 077', practiceLink({} as any), null)
eq('slug and stage', practiceLink({ pathway_slug: 'build-the-arm', pathway_stage_number: 3 }), { slug: 'build-the-arm', stageNumber: 3 })
eq('a nonsense stage reads as unknown', practiceLink({ pathway_slug: 'x', pathway_stage_number: 0 }), { slug: 'x', stageNumber: null })

// linkColumns
eq('nothing to save without a pathway', linkColumns(null, 3), {})
eq('pathway and stage saved', linkColumns('build-the-arm', 2), { pathway_slug: 'build-the-arm', pathway_stage_number: 2 })
eq('pathway without a stage', linkColumns('build-the-arm', null), { pathway_slug: 'build-the-arm', pathway_stage_number: null })

// isMissingLinkColumns — the fallback that keeps saving working before 077 runs
eq('PostgREST unknown column', isMissingLinkColumns({ code: 'PGRST204', message: "Could not find the 'pathway_slug' column" }), true)
eq('Postgres undefined column', isMissingLinkColumns({ code: '42703', message: 'column does not exist' }), true)
eq('an unrelated error is not swallowed', isMissingLinkColumns({ code: '42501', message: 'permission denied for table practice_plans' }), false)
eq('no error', isMissingLinkColumns(null), false)

// practiceDrillIds
const content = { blocks: [
  { title: 'Warm-up' }, { title: 'A', drill_id: 'd1' },
  { title: 'Stations', stations: [{ title: 's1', drill_id: 'd2' }, { title: 's2', drill_id: 'd1' }] },
  { title: 'Coach block', drill_id: '' },
] }
eq('drill ids, stations included, first order, no repeats', practiceDrillIds(content), ['d1', 'd2'])
eq('old bare-array practices', practiceDrillIds([{ drill_id: 'd9' }]), ['d9'])
eq('capped', practiceDrillIds({ blocks: Array.from({ length: 60 }, (_, i) => ({ drill_id: `d${i}` })) }).length, 40)
eq('no content', practiceDrillIds(null), [])

// practiceSessionDate
eq('a past practice keeps its date', practiceSessionDate('2026-09-20', '2026-09-30'), '2026-09-20')
eq('today is today', practiceSessionDate('2026-09-30', '2026-09-30'), '2026-09-30')
eq('a future practice is never dated in the future', practiceSessionDate('2026-10-02', '2026-09-30'), null)
eq('undated practice', practiceSessionDate(null, '2026-09-30'), null)
eq('malformed date', practiceSessionDate('soon', '2026-09-30'), null)

// practiceMinutes
eq('a real length', practiceMinutes(90), 90)
eq('no length is not invented', practiceMinutes(null), null)
eq('absurd length refused', practiceMinutes(900), null)

// recordedFor
eq('recorded', recordedFor([{ event_type: 'session_logged', detail: { practice_plan_id: 'p1' } }], 'p1'), true)
eq('a hand-recorded session is not this practice', recordedFor([{ event_type: 'session_logged', detail: {} }], 'p1'), false)
eq('another event type is not a session', recordedFor([{ event_type: 'mastery_recorded', detail: { practice_plan_id: 'p1' } }], 'p1'), false)

// defaultSelection
const rows = [
  { id: 'at-stage', status: 'active', current_stage_number: 2 },
  { id: 'other-stage', status: 'active', current_stage_number: 3 },
  { id: 'paused', status: 'paused', current_stage_number: 2 },
  { id: 'done-already', status: 'active', current_stage_number: 2, already_recorded: true },
]
eq('ticks only active plans at the stage not yet recorded', Array.from(defaultSelection(rows, 2)), ['at-stage'])
eq('no stage known: every active plan not yet recorded', Array.from(defaultSelection(rows, null)).sort(), ['at-stage', 'other-stage'])

console.log(`practice plan link: ${passed} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
