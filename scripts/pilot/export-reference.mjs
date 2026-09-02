// Task 1 — export the CURRENT production drill library, read-only.
//
// Writes pilot/reference/{drills,problem_taxonomy,drill_problem_map}.json.
//
// This exists because cowork-expansion/existing_drills.json is a snapshot
// from August 5th that predates everything since — the taxonomy coverage
// migration, the durations, the metadata normalization. Comparing Instagram
// discoveries against a stale snapshot would produce "new drill" verdicts for
// things that are already in the library.
//
//   NODE_USE_ENV_PROXY=1 node scripts/pilot/export-reference.mjs
//
// SELECT only. Nothing here can write to production.

import { join } from 'path'
import { selectAll, writeJson, nowIso, P } from './lib.mjs'

const drills = await selectAll('drill_resources', 'id.asc')
const problems = await selectAll('problem_taxonomy', 'slug.asc')
const map = await selectAll('drill_problem_map', 'drill_id.asc,problem_slug.asc')

const exported_at = nowIso()
const wrap = (table, rows) => ({
  exported_at,
  source: `supabase ${table} via PostgREST, SELECT only`,
  project_ref: 'chdpqsumqospnaztvfqe',
  count: rows.length,
  rows,
})

writeJson(join(P.reference, 'drills.json'), wrap('drill_resources', drills))
writeJson(join(P.reference, 'problem_taxonomy.json'), wrap('problem_taxonomy', problems))
writeJson(join(P.reference, 'drill_problem_map.json'), wrap('drill_problem_map', map))

const byStatus = {}
for (const d of drills) byStatus[d.status || 'null'] = (byStatus[d.status || 'null'] || 0) + 1

console.log(`Exported at ${exported_at}`)
console.log(`  drill_resources    ${drills.length}  by status ${JSON.stringify(byStatus)}  coach-authored ${drills.filter(d => d.created_by_coach_id).length}`)
console.log(`  problem_taxonomy   ${problems.length}`)
console.log(`  drill_problem_map  ${map.length}  curated ${map.filter(m => m.curated).length}  auto ${map.filter(m => !m.curated).length}`)
console.log(`  drill columns      ${drills.length ? Object.keys(drills[0]).length : 0}`)
console.log(`\nWritten to pilot/reference/. Nothing was modified in production.`)
