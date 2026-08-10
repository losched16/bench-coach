#!/usr/bin/env node
// Does every drill library read stay inside one coach's world?
//
// drill_resources holds the curated library (created_by_coach_id IS NULL) and
// drills individual coaches wrote (created_by_coach_id set). Every API route
// reads it through the service role, which bypasses RLS — so the only thing
// keeping one coach's drills out of another coach's library is the filter in
// lib/drills.ts.
//
// A read that skips it does not throw, does not warn, and looks perfectly fine
// when you test with one account. It shows up months later as somebody else's
// drill in your practice plan. So: the build fails instead.
//
//   npm run verify:drills

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN = ['app', 'lib', 'components']

// Reads that fetch specific drills by id are already scoped by whatever
// produced those ids — a prescription the coach owns, a plan they can see.
// Adding the visibility filter there would be harmless but pointless, and
// pretending otherwise trains people to ignore this script.
//
// Every entry needs a reason. "It was failing" is not one.
const EXEMPT = new Map([
  ['lib/drills.ts',
   'owns the filter'],
  ['app/api/prescribe/step/route.ts',
   'fetches drills by id from a prescription the caller already passed authz for'],
  ['app/api/prescribe/drills/route.ts',
   'GET fetches by id off the prescription; the swap pool below it uses visibleDrills'],
  ['app/api/admin/verify-links/route.ts',
   'admin link checker, runs across the curated library on purpose'],
  ['lib/checkin.ts',
   'resolves drill names for ids already stored on the prescription'],
  ['app/api/development-plan/route.ts',
   'fetches by id from prescription.drill_ids, which the caller already owns'],
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

const files = SCAN.flatMap(d => {
  try { return walk(join(ROOT, d)) } catch { return [] }
})

const problems = []
let direct = 0
let viaHelper = 0
let exemptSeen = 0

for (const file of files) {
  const rel = relative(ROOT, file)
  const src = readFileSync(file, 'utf8')

  // Files that go through visibleDrills are safe by construction. Counting
  // them matters: without it this script reports "checked 1 file" once
  // everything has been migrated, which reads as the check having stopped
  // working rather than as everything being fine.
  // Exclude the definition itself by PATH — every consumer imports from
  // '@/lib/drills', so matching on the string would exclude all of them.
  if (rel !== 'lib/drills.ts' && /\bvisibleDrills\s*\(/.test(src)) viaHelper++

  if (!src.includes("from('drill_resources')")) continue

  if (EXEMPT.has(rel)) { exemptSeen++; continue }
  direct++

  // A write is fine — the routes that create a coach drill set
  // created_by_coach_id explicitly, which is the point.
  const reads = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) =>
      line.includes("from('drill_resources')") &&
      !/\.(insert|update|upsert|delete)\(/.test(line)
    )

  if (reads.length === 0) continue

  // The filter can arrive two ways: through the helper, or spelled out. Both
  // are acceptable; neither being present is not.
  const usesHelper = /\bvisibleDrills\s*\(/.test(src)
  const spellsItOut = src.includes('created_by_coach_id')

  if (!usesHelper && !spellsItOut) {
    for (const { n } of reads) {
      problems.push(
        `${rel}:${n} reads drill_resources without scoping it to a coach.\n` +
        `    Use visibleDrills(client, coachId) from lib/drills.ts. Without it ` +
        `this surface shows every coach's private drills to everybody.`
      )
    }
  }
}

if (problems.length > 0) {
  console.error('Drill scoping check FAILED:\n')
  for (const p of problems) console.error('  ' + p + '\n')
  console.error(
    `If a read genuinely does not need scoping — it fetches drills by id that ` +
    `the caller already owns — add it to EXEMPT in this script with the reason.`
  )
  process.exit(1)
}

console.log(
  `Drill library reads: ${viaHelper} via visibleDrills, ${direct} direct and ` +
  `scoped, ${exemptSeen} exempt (by-id lookups the caller already owns) — ` +
  `no path leaks one coach's drills to another.`
)
