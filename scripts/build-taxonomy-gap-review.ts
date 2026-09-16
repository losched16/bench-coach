// Which unmapped drills should be mapped to a problem, and which should stay unmapped?
//
// Writes docs/audits/drill-taxonomy-gap-review.csv and, with --sql, the
// migration body for the mappings it decided to add.
//
// THE CHECK THAT MATTERS
//
// The standing instruction on this library is that no problem may ever be taken
// to zero prescribable drills — coverage beats quality, because a coach typing
// a real complaint and getting nothing back is worse than getting something
// imperfect. So this simulates the taxonomy AFTER every proposed change,
// including the removal, and refuses to emit anything if a problem would end up
// with nothing a coach could be offered.
//
// It checks TWO pools, which is the part that is easy to miss. schedulableDrills
// includes practice units; /api/prescribe deliberately excludes them
// (app/api/prescribe/route.ts). A problem whose only remaining drill is a
// practice unit is starved where it actually matters, and a check that only
// looked at the wider pool would call that fine.
//
//   npm run audit:taxonomy-gaps
//   npm run audit:taxonomy-gaps -- --sql
//
// Read-only against production unless you pipe the SQL somewhere.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const DECISIONS = 'scripts/fixtures/taxonomy-gap-decisions.tsv'
const OUT = 'docs/audits/drill-taxonomy-gap-review.csv'
const EMIT_SQL = process.argv.includes('--sql')

/**
 * The known-bad mapping named in the Phase 2C brief.
 *
 * "How to Get a T-Baller to Catch a Ball" is a Catching row mapped to
 * plate-confidence, which is a Hitting problem about standing in against live
 * pitching. Nothing about catching a ball addresses it.
 */
const BAD_MAPPINGS = [
  { drill_id: '1b2f8b6e-0000-0000-0000-000000000000', problem_slug: 'plate-confidence', name: 'How to Get a T-Baller to Catch a Ball' },
]

const DEMOTED = ['source_collection', 'teaching_content']

export interface GapDecision {
  drill_id: string
  action: string
  problem_slug: string
  confidence: string
  rationale: string
}

export function loadGapDecisions(path: string = DECISIONS): GapDecision[] {
  const out: GapDecision[] = []
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.startsWith('#')) return
    const f = line.split('\t')
    if (f.length < 5) throw new Error(`${path}:${i + 1} has ${f.length} fields, expected 5`)
    const d: GapDecision = {
      drill_id: f[0].trim(), action: f[1].trim(), problem_slug: f[2].trim(),
      confidence: f[3].trim(), rationale: f.slice(4).join('\t').trim(),
    }
    if (!['ADD_MAPPING', 'NO_MAPPING_NEEDED', 'REVIEW'].includes(d.action)) {
      throw new Error(`${path}:${i + 1} unknown action "${d.action}"`)
    }
    if (d.action === 'ADD_MAPPING' && !d.problem_slug) {
      throw new Error(`${path}:${i + 1} ADD_MAPPING needs a problem_slug`)
    }
    if (d.action !== 'ADD_MAPPING' && d.problem_slug) {
      throw new Error(`${path}:${i + 1} ${d.action} must not name a problem_slug`)
    }
    if (!['high', 'medium', 'low'].includes(d.confidence)) {
      throw new Error(`${path}:${i + 1} confidence must be high/medium/low`)
    }
    if (!d.rationale) throw new Error(`${path}:${i + 1} has no rationale`)
    out.push(d)
  })
  return out
}

const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`
function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function page(sb: any, table: string, cols: string): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as any[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const problems = await page(sb, 'problem_taxonomy', 'slug,label,skill_category')
  const mappings = await page(sb, 'drill_problem_map', 'drill_id,problem_slug,curated')
  const drills = await page(sb, 'drill_resources',
    'id,drill_name,skill_category,resource_kind,duplicate_of_drill_id,created_by_coach_id')

  const byId = new Map(drills.map(d => [d.id, d]))
  const slugs = new Set(problems.map(p => p.slug))
  const decisions = loadGapDecisions()

  // Resolve the bad mapping by name, because its id is not worth hard-coding
  // wrongly and a silent miss would let it survive the cleanup.
  const bad = BAD_MAPPINGS.map(b => {
    const row = drills.find(d => d.drill_name === b.name)
    return row ? { ...b, drill_id: row.id, found: true } : { ...b, found: false }
  })

  // ── the decisions have to be about real rows and real problems ────────────
  const problemsFound: string[] = []
  const unmapped = drills.filter(d => !d.created_by_coach_id && !mappings.some(m => m.drill_id === d.id))
  const decided = new Set(decisions.map(d => d.drill_id))

  for (const d of unmapped) if (!decided.has(d.id)) problemsFound.push(`no decision for ${d.drill_name} (${d.id})`)
  for (const d of decisions) {
    if (!byId.has(d.drill_id)) problemsFound.push(`decision for ${d.drill_id}, which is not a drill`)
    if (d.problem_slug && !slugs.has(d.problem_slug)) problemsFound.push(`unknown problem "${d.problem_slug}"`)
  }
  for (const b of bad) if (!b.found) problemsFound.push(`could not find the row named "${b.name}"`)

  if (problemsFound.length) {
    console.error('GAP REVIEW INCOMPLETE — not writing.\n')
    for (const p of problemsFound) console.error(`  ${p}`)
    process.exit(1)
  }

  // ── simulate the taxonomy after the change ────────────────────────────────
  const adds = decisions.filter(d => d.action === 'ADD_MAPPING')
  const removeKeys = new Set(bad.map(b => `${b.drill_id}|${b.problem_slug}`))
  const after = [
    ...mappings.filter(m => !removeKeys.has(`${m.drill_id}|${m.problem_slug}`)),
    ...adds.map(a => ({ drill_id: a.drill_id, problem_slug: a.problem_slug, curated: true })),
  ]

  const schedulable = (d: any) =>
    !!d && !d.duplicate_of_drill_id && !DEMOTED.includes(String(d.resource_kind || ''))
  // What /api/prescribe can actually offer: practice units are excluded there.
  const prescribable = (d: any) => schedulable(d) && d.resource_kind !== 'practice_unit'

  const count = (set: any[], slug: string, f: (d: any) => boolean) =>
    set.filter(m => m.problem_slug === slug && f(byId.get(m.drill_id))).length

  const starvedBefore = problems.filter(p => count(mappings, p.slug, schedulable) === 0)
  const starvedAfter = problems.filter(p => count(after, p.slug, schedulable) === 0)
  const presBefore = problems.filter(p => count(mappings, p.slug, prescribable) === 0)
  const presAfter = problems.filter(p => count(after, p.slug, prescribable) === 0)

  const newlyStarved = [
    ...starvedAfter.filter(p => !starvedBefore.some(x => x.slug === p.slug)).map(p => `${p.slug} (schedulable)`),
    ...presAfter.filter(p => !presBefore.some(x => x.slug === p.slug)).map(p => `${p.slug} (prescribable)`),
  ]
  if (newlyStarved.length) {
    console.error('THIS CHANGE WOULD STARVE A PROBLEM — nothing emitted.\n')
    for (const s of newlyStarved) console.error(`  ${s}`)
    process.exit(1)
  }

  // ── the CSV ───────────────────────────────────────────────────────────────
  const header = ['drill_id', 'drill_name', 'category', 'schedulable', 'current_problem_count',
                  'proposed_problem_slug', 'action', 'confidence', 'rationale']
  const lines = decisions
    .slice()
    .sort((a, b) => {
      const da = byId.get(a.drill_id)!, db = byId.get(b.drill_id)!
      return String(da.skill_category).localeCompare(String(db.skill_category)) ||
             String(da.drill_name).localeCompare(String(db.drill_name))
    })
    .map(d => {
      const row = byId.get(d.drill_id)!
      return [
        d.drill_id, row.drill_name, row.skill_category,
        schedulable(row) ? 'yes' : 'no',
        mappings.filter(m => m.drill_id === d.drill_id).length,
        d.problem_slug, d.action, d.confidence, d.rationale,
      ].map(csvCell).join(',')
    })

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, header.join(',') + '\n' + lines.join('\n') + '\n')

  if (EMIT_SQL) {
    const sql: string[] = []
    for (const b of bad) {
      sql.push(`-- ${b.name} is a Catching row mapped to a Hitting problem about`)
      sql.push(`-- standing in against live pitching. Nothing about catching addresses it.`)
      sql.push(`-- plate-confidence keeps "Turn and Take It", so it does not go to zero.`)
      sql.push(`DELETE FROM public.drill_problem_map`)
      sql.push(` WHERE drill_id = '${b.drill_id}' AND problem_slug = ${q(b.problem_slug)};`)
      sql.push('')
    }
    for (const a of adds) {
      const row = byId.get(a.drill_id)!
      sql.push(`-- ${row.drill_name} → ${a.problem_slug}  (${a.confidence})`)
      sql.push(`-- ${a.rationale}`)
      sql.push(`INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated)`)
      sql.push(`VALUES ('${a.drill_id}', ${q(a.problem_slug)}, 100, true)`)
      sql.push(`ON CONFLICT DO NOTHING;`)
      sql.push('')
    }
    console.log(sql.join('\n'))
  }

  // ── what it found ─────────────────────────────────────────────────────────
  const say = EMIT_SQL ? console.error : console.log
  say(`${OUT}\n`)
  say(`${unmapped.length} curated drills map to no problem.`)
  say(`  ${decisions.filter(d => d.action === 'NO_MAPPING_NEEDED').length} correctly unmapped (demoted rows a coach is never offered)`)
  say(`  ${adds.length} mappings to add, across ${new Set(adds.map(a => a.drill_id)).size} drills`)
  say(`  ${decisions.filter(d => d.action === 'REVIEW').length} left for review — no existing problem fits`)
  say(`  ${bad.length} bad mapping removed`)
  say(`\nstarved problems   before ${starvedBefore.length}   after ${starvedAfter.length}   (schedulable pool)`)
  say(`                   before ${presBefore.length}   after ${presAfter.length}   (prescribe pool, no practice units)`)
  const stillUnmapped = unmapped.filter(d => !adds.some(a => a.drill_id === d.id)).length
  say(`\nunmapped after this change: ${stillUnmapped}`)

  // A problem hanging on by one drill is not starved, but it is one
  // reclassification away from being starved, and that is worth saying.
  const thin = problems
    .map(p => ({ slug: p.slug, n: count(after, p.slug, prescribable) }))
    .filter(p => p.n === 1)
  if (thin.length) {
    say(`\n${thin.length} problem(s) left with exactly one prescribable drill — one reclassification from starved:`)
    for (const t of thin) say(`  ${t.slug}`)
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
