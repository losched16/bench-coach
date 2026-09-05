#!/usr/bin/env node
// Read-only export of the drill library, for audit.
//
// WHY THIS EXISTS
//
// The drill library lives in Supabase, not in the repo. Every question worth
// asking about it — how many drills have coaching cues, which problems have no
// drills mapped, whether the tags are consistent — needs the actual rows. The
// repo can tell you the schema and every line of code that reads it; it cannot
// tell you what is in it.
//
// So this pulls the real records out and writes them where a human (or another
// model) can read them, alongside the counts that answer the audit questions.
//
// IT WRITES NOTHING TO THE DATABASE. Every query here is a SELECT. There is no
// UPDATE, INSERT or DELETE anywhere in this file, and that is deliberate: this
// is the discovery pass, and the decisions it informs have not been made yet.
//
// COMMANDS
//   export     docs/audits/drill-library-current-state.{csv,json}
//   taxonomy   the category / tag / age / difficulty counts
//   coverage   per-field completeness, plus duplicate detection
//   all        all three
//
// CREDENTIALS
//   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//
//   The scoped benchcoach_seo role from migration 045 CANNOT be used here — it
//   is granted seo_pages only, by design. This reads different tables and
//   needs its own credential. Given it only ever SELECTs, a read-only role
//   would be the right long-term answer; the service key works today.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { requireTarget } from './lib/env-guard.mjs'

const OUT_DIR = 'docs/audits'

// Node's global fetch ignores HTTPS_PROXY. curl honours it, so in a proxied
// sandbox curl reaches Supabase and this script gets a 403 from a transparent
// block — which reads like a credentials problem and is not one. Node 22
// gained NODE_USE_ENV_PROXY to opt in; it must be set before startup, so the
// script cannot set it for itself and says so instead of failing obscurely.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  console.error(
    '\nHTTPS_PROXY is set but NODE_USE_ENV_PROXY is not, so fetch would bypass\n' +
    'the proxy and be blocked. Re-run as:\n\n' +
    `  NODE_USE_ENV_PROXY=1 node ${process.argv[1]} ${process.argv.slice(2).join(' ')}\n`
  )
  process.exit(1)
}

function die(msg) { console.error(`\n${msg}\n`); process.exit(1) }

function need(name) {
  const v = process.env[name]
  if (!v) die(`${name} is not set.`)
  return v
}

const db = () => createClient(
  need('NEXT_PUBLIC_SUPABASE_URL'),
  need('SUPABASE_SERVICE_ROLE_KEY')
)

/** Everything, in pages — Supabase caps a single select at 1000 rows. */
async function fetchAll(client, table, select = '*') {
  const rows = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await client.from(table).select(select).range(from, from + size - 1)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        console.warn(`  (${table}: ${error.message} — skipping)`)
        return null
      }
      throw new Error(`${table}: ${error.message}`)
    }
    rows.push(...(data || []))
    if (!data || data.length < size) break
  }
  return rows
}

async function load() {
  // Re-run the reports against an earlier export instead of the database.
  //
  //   node scripts/drill-audit.mjs taxonomy --from docs/audits/drill-library-current-state.json
  //
  // Useful for iterating on the analysis without re-reading production, and
  // for anyone reviewing the audit who has the file but not the credentials.
  const fromArg = process.argv.indexOf('--from')
  if (fromArg !== -1) {
    const path = process.argv[fromArg + 1]
    if (!path) die('--from needs a path to an exported JSON file.')
    const snap = JSON.parse(readFileSync(path, 'utf8'))
    console.log(`Reading ${path} (exported ${snap.exported_at || 'unknown'})`)
    return {
      drills: snap.drills || [],
      problems: snap.problem_taxonomy || [],
      // Mappings were flattened onto each drill at export time; rebuild the
      // rows the reports expect.
      map: (snap.drills || []).flatMap(d =>
        (d._joined_problem_curated || []).map(entry => {
          const [problem_slug, kind, sort_order] = String(entry).split(':')
          return { drill_id: d.id, problem_slug, curated: kind === 'curated', sort_order: Number(sort_order) }
        })
      ),
    }
  }

  const client = db()
  console.log('Reading drill_resources...')
  const drills = await fetchAll(client, 'drill_resources')
  if (!drills) die('drill_resources could not be read.')
  console.log(`  ${drills.length} drills`)

  console.log('Reading drill_problem_map...')
  const map = await fetchAll(client, 'drill_problem_map') || []
  console.log(`  ${map.length} mappings`)

  console.log('Reading problem_taxonomy...')
  const problems = await fetchAll(client, 'problem_taxonomy') || []
  console.log(`  ${problems.length} problems`)

  return { drills, map, problems }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Arrays become pipe-joined, objects become JSON, nulls become empty.
 *
 * Pipes rather than commas because several of these fields (equipment,
 * coaching cues) contain commas of their own, and a CSV that needs quoting
 * rules explained is a CSV nobody opens twice.
 */
function cell(v) {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' | ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function csvEscape(s) {
  const t = String(s)
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

function toCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')]
  for (const r of rows) lines.push(columns.map(c => csvEscape(cell(r[c]))).join(','))
  return lines.join('\n') + '\n'
}

/** --prefix production  ->  drill-library-production.{csv,json} */
function outPrefix() {
  const i = process.argv.indexOf('--prefix')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'current-state'
}

async function exportLibrary({ drills, map, problems }) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const prefix = outPrefix()

  // Problem mappings attached per drill, so a reviewer can see what each drill
  // is claimed to fix without joining two files by hand. Marked as JOINED in
  // the column names — it is not a column on drill_resources.
  const byDrill = new Map()
  for (const m of map) {
    if (!byDrill.has(m.drill_id)) byDrill.set(m.drill_id, [])
    byDrill.get(m.drill_id).push(m)
  }
  const problemLabel = new Map(problems.map(p => [p.slug, p.label]))

  const enriched = drills.map(d => {
    const mine = byDrill.get(d.id) || []
    return {
      ...d,
      _joined_problem_slugs: mine.map(m => m.problem_slug),
      _joined_problem_labels: mine.map(m => problemLabel.get(m.problem_slug) || m.problem_slug),
      _joined_problem_curated: mine.map(m => `${m.problem_slug}:${m.curated ? 'curated' : 'auto'}:${m.sort_order}`),
      _joined_problem_count: mine.length,
    }
  })

  // Union of every key any row actually has, so a column added by a migration
  // nobody documented still shows up.
  const columns = Array.from(
    enriched.reduce((set, d) => { Object.keys(d).forEach(k => set.add(k)); return set }, new Set())
  ).sort((a, b) => {
    // id and name first; joined columns last. Everything else alphabetical.
    const rank = k => (k === 'id' ? 0 : k === 'drill_name' ? 1 : k.startsWith('_joined') ? 3 : 2)
    return rank(a) - rank(b) || a.localeCompare(b)
  })

  writeFileSync(`${OUT_DIR}/drill-library-${prefix}.csv`, toCsv(enriched, columns))
  writeFileSync(
    `${OUT_DIR}/drill-library-${prefix}.json`,
    JSON.stringify({
      exported_at: new Date().toISOString(),
      note: 'Verbatim from drill_resources. Keys prefixed _joined are from drill_problem_map / problem_taxonomy, not columns on the drill.',
      counts: { drills: drills.length, mappings: map.length, problems: problems.length },
      columns_present: columns.filter(c => !c.startsWith('_joined')),
      drills: enriched,
      problem_taxonomy: problems,
    }, null, 2)
  )

  // The two joined tables, verbatim and unflattened. The per-drill _joined_*
  // keys above are a convenience view; these are the rows as stored, with
  // every column they actually have — which is what a mapping-coverage
  // analysis needs and what the flattened form loses.
  writeFileSync(
    `${OUT_DIR}/problem-taxonomy-${prefix}.json`,
    JSON.stringify({
      exported_at: new Date().toISOString(),
      source: 'problem_taxonomy',
      count: problems.length,
      columns_present: Array.from(problems.reduce((set, p) => {
        Object.keys(p).forEach(k => set.add(k)); return set
      }, new Set())).sort(),
      rows: problems,
    }, null, 2)
  )
  writeFileSync(
    `${OUT_DIR}/drill-problem-map-${prefix}.json`,
    JSON.stringify({
      exported_at: new Date().toISOString(),
      source: 'drill_problem_map',
      count: map.length,
      columns_present: Array.from(map.reduce((set, m) => {
        Object.keys(m).forEach(k => set.add(k)); return set
      }, new Set())).sort(),
      curated: map.filter(m => m.curated === true).length,
      not_curated: map.filter(m => m.curated !== true).length,
      rows: map,
    }, null, 2)
  )

  console.log(`\nWrote ${OUT_DIR}/drill-library-${prefix}.csv  (${enriched.length} rows, ${columns.length} columns)`)
  console.log(`Wrote ${OUT_DIR}/drill-library-${prefix}.json`)
  console.log(`Wrote ${OUT_DIR}/problem-taxonomy-${prefix}.json  (${problems.length} rows)`)
  console.log(`Wrote ${OUT_DIR}/drill-problem-map-${prefix}.json  (${map.length} rows)`)
}

// ── counting helpers ────────────────────────────────────────────────────────

function tally(rows, fn) {
  const counts = new Map()
  for (const r of rows) {
    for (const v of [].concat(fn(r) ?? [])) {
      if (v === null || v === undefined || v === '') continue
      const k = String(v)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function printTally(title, entries, { showEmpty = 0 } = {}) {
  console.log(`\n${title}  (${entries.length} distinct)`)
  if (entries.length === 0) { console.log('  (none)'); return }
  for (const [k, n] of entries) console.log(`  ${String(n).padStart(4)}  ${k}`)
  if (showEmpty) console.log(`  ${String(showEmpty).padStart(4)}  (empty/null)`)
}

const isEmpty = v =>
  v === null || v === undefined || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'string' && v.trim() === '')

// ── taxonomy ────────────────────────────────────────────────────────────────

function taxonomyReport({ drills, map, problems }) {
  console.log('\n' + '='.repeat(70))
  console.log('TAXONOMY')
  console.log('='.repeat(70))

  printTally('skill_category', tally(drills, d => d.skill_category),
    { showEmpty: drills.filter(d => isEmpty(d.skill_category)).length })

  // Case and whitespace variants of the same category. The practice planner
  // matches these with ilike specifically because they are inconsistent, so
  // knowing the real spread matters.
  const norm = new Map()
  for (const [cat, n] of tally(drills, d => d.skill_category)) {
    const k = cat.toLowerCase().trim()
    if (!norm.has(k)) norm.set(k, [])
    norm.get(k).push([cat, n])
  }
  const variants = Array.from(norm.entries()).filter(([, v]) => v.length > 1)
  if (variants.length) {
    console.log('\nCategories differing only by case/whitespace:')
    for (const [k, v] of variants) console.log(`  "${k}" <- ${v.map(([c, n]) => `"${c}"(${n})`).join(', ')}`)
  } else {
    console.log('\nNo case/whitespace variants among categories.')
  }

  printTally('difficulty_level', tally(drills, d => d.difficulty_level),
    { showEmpty: drills.filter(d => isEmpty(d.difficulty_level)).length })
  printTally('progression_level', tally(drills, d => d.progression_level),
    { showEmpty: drills.filter(d => isEmpty(d.progression_level)).length })
  printTally('competition_level', tally(drills, d => d.competition_level))
  printTally('status', tally(drills, d => d.status),
    { showEmpty: drills.filter(d => isEmpty(d.status)).length })

  console.log('\n--- age representation ---')
  console.log(`  min_age present:        ${drills.filter(d => !isEmpty(d.min_age)).length}/${drills.length}`)
  console.log(`  max_age present:        ${drills.filter(d => !isEmpty(d.max_age)).length}/${drills.length}`)
  console.log(`  BOTH min and max:       ${drills.filter(d => !isEmpty(d.min_age) && !isEmpty(d.max_age)).length}/${drills.length}`)
  console.log('  (the prescribe age filter only applies when BOTH bounds exist — see app/api/prescribe/route.ts)')
  printTally('age_range (free text)', tally(drills, d => d.age_range),
    { showEmpty: drills.filter(d => isEmpty(d.age_range)).length })
  printTally('age_relevance[]', tally(drills, d => d.age_relevance))

  console.log('\n--- the retrieval tags ---')
  console.log('These two arrays ARE the tag system. There is no separate tags column.')
  const flaws = tally(drills, d => d.common_flaws_fixed)
  const mech = tally(drills, d => d.mechanic_focus)
  printTally('common_flaws_fixed[] values', flaws)
  printTally('mechanic_focus[] values', mech)

  const once = flaws.filter(([, n]) => n === 1)
  console.log(`\ncommon_flaws_fixed values used exactly once: ${once.length}/${flaws.length}`)
  const mechOnce = mech.filter(([, n]) => n === 1)
  console.log(`mechanic_focus values used exactly once:    ${mechOnce.length}/${mech.length}`)

  // Case-variant tags, which the token scorer in lib/analysis.ts will treat as
  // unrelated strings.
  for (const [label, entries] of [['common_flaws_fixed', flaws], ['mechanic_focus', mech]]) {
    const m = new Map()
    for (const [t, n] of entries) {
      const k = t.toLowerCase().trim()
      if (!m.has(k)) m.set(k, [])
      m.get(k).push([t, n])
    }
    const dupes = Array.from(m.entries()).filter(([, v]) => v.length > 1)
    console.log(`\n${label}: ${dupes.length} value(s) differing only by case/whitespace`)
    for (const [k, v] of dupes) console.log(`  "${k}" <- ${v.map(([t, n]) => `"${t}"(${n})`).join(', ')}`)
  }

  console.log('\n--- tag density ---')
  const density = tally(drills, d => `${(d.common_flaws_fixed || []).length} flaws`)
  printTally('drills by common_flaws_fixed count', density)
  console.log(`  drills with NO common_flaws_fixed: ${drills.filter(d => isEmpty(d.common_flaws_fixed)).length}`)
  console.log(`  drills with NO mechanic_focus:     ${drills.filter(d => isEmpty(d.mechanic_focus)).length}`)

  console.log('\n--- problem taxonomy ---')
  printTally('problems by skill_category', tally(problems, p => p.skill_category))
  const mapped = new Set(map.map(m => m.drill_id))
  console.log(`\n  drills mapped to >=1 problem: ${mapped.size}/${drills.length}`)
  console.log(`  drills mapped to NO problem:  ${drills.length - mapped.size}`)

  const approvedIds = new Set(drills.filter(d => d.status === 'approved' || d.status == null).map(d => d.id))
  const perProblem = new Map(problems.map(p => [p.slug, { total: 0, approved: 0, curated: 0 }]))
  for (const m of map) {
    const e = perProblem.get(m.problem_slug)
    if (!e) continue
    e.total++
    if (approvedIds.has(m.drill_id)) e.approved++
    if (m.curated && approvedIds.has(m.drill_id)) e.curated++
  }
  const zero = Array.from(perProblem.entries()).filter(([, v]) => v.approved === 0)
  console.log(`\n  PROBLEMS WITH ZERO APPROVED DRILLS: ${zero.length}`)
  for (const [slug] of zero) console.log(`    ${slug}`)
  const thin = Array.from(perProblem.entries()).filter(([, v]) => v.approved > 0 && v.approved < 2)
  console.log(`\n  problems with exactly 1 approved drill: ${thin.length}`)
  for (const [slug] of thin) console.log(`    ${slug}`)
}

// ── coverage ────────────────────────────────────────────────────────────────

// Every audited concept, mapped to the column that holds it — or to null,
// meaning the concept has no home in the current schema. The nulls are the
// interesting half.
const CONCEPTS = [
  ['description', 'description'],
  ['instructions (step by step)', null],
  ['slug', null],
  ['sport', null],
  ['sub-skill', null],
  ['primary skill trained', 'skill_category'],
  ['secondary skills trained', null],
  ['specific problem addressed', 'common_flaws_fixed'],
  ['game situation', null],
  ['min age', 'min_age'],
  ['max age', 'max_age'],
  ['age group (text)', 'age_range'],
  ['age relevance (array)', 'age_relevance'],
  ['skill level / difficulty', 'difficulty_level'],
  ['progression level', 'progression_level'],
  ['prerequisite skills', null],
  ['individual/partner/group/team', null],
  ['min players', null],
  ['max players', null],
  ['ideal player count', null],
  ['coaches required', null],
  ['equipment', 'equipment_needed'],
  ['space requirements', null],
  ['indoor/outdoor', null],
  ['duration (minutes)', 'est_duration_minutes'],
  ['reps', 'reps_guidance'],
  ['sets', null],
  ['work/rest structure', null],
  ['frequency', 'frequency_guidance'],
  ['practice-plan role (warmup/station/game...)', null],
  ['coaching cues', 'ai_coaching_notes'],
  ['teaching points', null],
  ['common mistakes', null],
  ['corrections', null],
  ['progressions (to next drill)', null],
  ['regressions (to easier drill)', null],
  ['safety notes', 'safety_notes'],
  ['use when', null],
  ['avoid when', 'do_not_coach_note'],
  ['success markers', 'success_markers'],
  ['mechanic focus', 'mechanic_focus'],
  ['tags (dedicated)', null],
  ['keywords / search terms', null],
  ['embedding text', null],
  ['vector id', null],
  ['recommendation weight', null],
  ['related drills', null],
  ['competition level', 'competition_level'],
  ['source', 'source'],
  ['status', 'status'],
]

function coverageReport({ drills, map, problems }) {
  console.log('\n' + '='.repeat(70))
  console.log('COVERAGE')
  console.log('='.repeat(70))
  const n = drills.length
  console.log(`\nTotal drills: ${n}`)

  console.log('\nConcept -> column -> how many drills have a value')
  console.log('(NO COLUMN = the concept is not represented in the schema at all)\n')
  for (const [concept, col] of CONCEPTS) {
    if (!col) {
      console.log(`  ${concept.padEnd(44)} NO COLUMN`)
      continue
    }
    const have = drills.filter(d => !isEmpty(d[col])).length
    const pct = n ? Math.round((have / n) * 100) : 0
    console.log(`  ${concept.padEnd(44)} ${col.padEnd(22)} ${String(have).padStart(4)}/${n}  ${String(pct).padStart(3)}%`)
  }

  console.log('\n--- duplicates ---')
  const byName = new Map()
  for (const d of drills) {
    const k = String(d.drill_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!k) continue
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(d)
  }
  const exact = Array.from(byName.entries()).filter(([, v]) => v.length > 1)
  console.log(`\nIdentical normalised names: ${exact.length} group(s)`)
  for (const [k, v] of exact) console.log(`  "${k}" x${v.length}  ids: ${v.map(d => d.id).join(', ')}`)

  // Same video, different drill record. Not necessarily wrong — one video can
  // legitimately teach two things — but it is where near-duplicates hide.
  const byVideo = new Map()
  for (const d of drills) {
    if (!d.youtube_video_id) continue
    if (!byVideo.has(d.youtube_video_id)) byVideo.set(d.youtube_video_id, [])
    byVideo.get(d.youtube_video_id).push(d)
  }
  const sharedVideo = Array.from(byVideo.entries()).filter(([, v]) => v.length > 1)
  console.log(`\nShared youtube_video_id: ${sharedVideo.length} group(s)`)
  for (const [vid, v] of sharedVideo.slice(0, 40)) {
    console.log(`  ${vid} x${v.length}: ${v.map(d => d.drill_name).join(' | ')}`)
  }
  if (sharedVideo.length > 40) console.log(`  ... and ${sharedVideo.length - 40} more`)

  console.log('\n--- drills with lots of records but weak metadata ---')
  const weak = d =>
    [isEmpty(d.common_flaws_fixed), isEmpty(d.mechanic_focus), isEmpty(d.est_duration_minutes),
     isEmpty(d.equipment_needed), isEmpty(d.min_age) || isEmpty(d.max_age), isEmpty(d.ai_coaching_notes)]
      .filter(Boolean).length
  const byCat = new Map()
  for (const d of drills) {
    const c = d.skill_category || '(none)'
    if (!byCat.has(c)) byCat.set(c, { n: 0, weak: 0 })
    const e = byCat.get(c)
    e.n++
    if (weak(d) >= 4) e.weak++
  }
  console.log('\n  category                      drills  >=4 of 6 key fields missing')
  for (const [c, e] of Array.from(byCat.entries()).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${c.padEnd(30)} ${String(e.n).padStart(5)}  ${String(e.weak).padStart(5)}`)
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const command = (process.argv[2] || 'all').replace(/^--.*/, 'all')

// Read-only, so nothing here can be refused — but an audit report is a claim
// about a specific database, and printing which one turns "206 drills" into a
// statement someone can check.
requireTarget({ script: `drill-audit ${command}`, writes: false })

const data = await load().catch(e => die(e.message))

if (command === 'export' || command === 'all') await exportLibrary(data)
if (command === 'taxonomy' || command === 'all') taxonomyReport(data)
if (command === 'coverage' || command === 'all') coverageReport(data)

if (!['export', 'taxonomy', 'coverage', 'all'].includes(command)) {
  die(`Unknown command "${command}". Use: export | taxonomy | coverage | all`)
}

console.log('\nRead-only. Nothing was written to the database.\n')
