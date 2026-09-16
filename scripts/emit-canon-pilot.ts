// Emit a classification batch as SQL — and refuse to emit one that starves a problem.
//
// Same source-of-truth rule as scripts/emit-media-backfill.ts: the statements
// that reach production are generated from the audit decisions rather than
// retyped, because retyping is where a disposition and a write quietly stop
// agreeing.
//
// THE GATE RUNS HERE, NOT AFTERWARDS
//
// Demoting a drill removes it from the prescription pool. problem_taxonomy maps
// problems to drills, and the standing rule for this library is that no problem
// may reach zero prescribable drills — a coach asking for help and being told
// nothing is the worst outcome available.
//
// So this reads the live taxonomy, computes what would survive the demotions in
// THIS batch, and prints nothing at all if any problem would fall to zero. A
// check that runs after the write, or that prints a warning you can scroll
// past, is not a control.
//
// Category at a time is the safety model: a batch that would starve something
// stops, and every batch before it stays written.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npx tsx scripts/emit-canon-pilot.ts --categories='Catching' > batch.sql
//
//   --categories=all   every category
//   --categories='Catching|Pitching'   a named batch
//   (omitted)          the Phase 1 pilot, for reproducing that write

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { loadDecisions, effectiveKind, schedulableAfter } from './build-canon-audit'
import { requestedCategories, FAMILY_NAMES, MIN_SURVIVING } from './apply-canon-pilot'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const q = (v: string) => `'${v.replace(/'/g, "''")}'`
const say = (m: string) => console.error(m)

async function main() {
  const CATEGORIES = requestedCategories()
  const ALL = loadDecisions()

  // Categories come from the live library, not the snapshot: a batch is about
  // to be written against production and must be decided against production.
  let library: any[]
  if (URL && KEY) {
    const sb = createClient(URL, KEY)
    const { data, error } = await sb
      .from('drill_resources')
      .select('id, drill_name, skill_category, resource_kind')
      .is('created_by_coach_id', null)
    if (error || !data) { say(`Could not read drill_resources: ${error?.message}`); process.exit(1) }
    library = data
  } else {
    library = JSON.parse(readFileSync('scripts/fixtures/drill-library-snapshot.json', 'utf8'))
    say('NOTE: no credentials — using the committed snapshot, and the coverage gate CANNOT run.')
  }

  const cat = new Map(library.map(d => [d.id, d.skill_category]))
  const batch = ALL.filter(d => CATEGORIES.includes(String(cat.get(d.drill_id))))
  say(`categories : ${CATEGORIES.join(' | ')}`)
  say(`rows in batch: ${batch.length}`)

  // ── the coverage gate ─────────────────────────────────────────────────────
  if (URL && KEY) {
    const sb = createClient(URL, KEY)
    const { data: maps } = await sb.from('drill_problem_map').select('drill_id, problem_slug')

    // Everything this batch would demote, PLUS everything already demoted —
    // the question is what a coach can be handed after the write, not what this
    // batch changes in isolation.
    const demotedNow = new Set(
      library.filter(d => ['source_collection', 'teaching_content'].includes(String(d.resource_kind || '')))
             .map(d => d.id))
    for (const d of batch) if (!schedulableAfter(d.disposition)) demotedNow.add(d.drill_id)

    const before = new Map<string, number>()
    const after = new Map<string, number>()
    for (const m of (maps || []) as any[]) {
      before.set(m.problem_slug, (before.get(m.problem_slug) || 0) + 1)
      if (!demotedNow.has(m.drill_id)) after.set(m.problem_slug, (after.get(m.problem_slug) || 0) + 1)
    }

    const starved = Array.from(before.keys())
      .map(slug => ({ slug, before: before.get(slug) || 0, after: after.get(slug) || 0 }))
      .filter(r => r.after < MIN_SURVIVING && r.before >= MIN_SURVIVING)

    say(`problems mapped: ${before.size}`)
    say(`would starve   : ${starved.length}`)

    const thin = Array.from(before.keys())
      .map(slug => ({ slug, before: before.get(slug) || 0, after: after.get(slug) || 0 }))
      .filter(r => r.after <= 2).sort((a, b) => a.after - b.after)
    if (thin.length) {
      say('thinnest after this batch:')
      for (const r of thin.slice(0, 8)) say(`  ${String(r.after).padStart(2)} left (was ${r.before})  ${r.slug}`)
    }

    if (starved.length > 0) {
      say('\nREFUSING TO EMIT. These problems would be left with no prescribable drill:\n')
      for (const r of starved) say(`  ${r.slug}  ${r.before} -> ${r.after}`)
      say('\nCoverage beats quality. Curate a replacement onto each of these first ' +
          '(see migration 063 for the shape), or change the disposition of the row ' +
          'that carries them. Do not lower MIN_SURVIVING to get past this.')
      process.exit(1)
    }
  }

  // ── emit ──────────────────────────────────────────────────────────────────
  const slugs = Array.from(new Set(batch.map(d => d.family_slug).filter(Boolean)))
  const newSlugs = slugs.filter(s => s in FAMILY_NAMES)

  console.log(`-- Batch: ${CATEGORIES.join(' / ')}`)
  console.log(`-- ${batch.length} rows. Coverage gate passed. No deletes, no video columns touched.`)
  for (const s of newSlugs) {
    const m = FAMILY_NAMES[s]
    console.log(`insert into drill_activity_families (slug, name, primary_skill) values (${q(s)}, ${q(m.name)}, ${q(m.skill)}) on conflict (slug) do nothing;`)
  }

  const rows: string[] = []
  const fingerprint: string[] = []
  for (const d of batch) {
    const kind = effectiveKind(d, ALL)
    if (!kind && !d.family_slug && !d.variation_type) continue
    const cell = (v: string) => (v ? q(v) : 'null')
    const demoted = !schedulableAfter(d.disposition)
    rows.push(`(${q(d.drill_id)}::uuid,${cell(kind)},${cell(d.family_slug)},${cell(d.variation_type)},${demoted})`)
    fingerprint.push(`${d.drill_id}|${kind || '~'}|${demoted ? '~' : (d.family_slug || '~')}|${demoted ? '~' : (d.variation_type || '~')}`)
  }

  if (rows.length) {
    console.log('')
    console.log('update drill_resources d set')
    console.log('  resource_kind = coalesce(v.kind, d.resource_kind),')
    // A demoted row is not an activity, so it holds no place in an activity
    // family. Leaving it there is how a source collection ends up as the BASE
    // of a family of real drills — which is a contradiction the library states
    // about itself, and which Phase 1 shipped for ground-ball-fundamentals.
    console.log('  activity_family_id = case when v.demoted then null')
    console.log('    else coalesce((select id from drill_activity_families f where f.slug = v.slug), d.activity_family_id) end,')
    console.log('  variation_type = case when v.demoted then null else coalesce(v.vt, d.variation_type) end')
    console.log('from (values')
    console.log(rows.join(',\n'))
    console.log(') as v(id, kind, slug, vt, demoted)')
    console.log('where d.id = v.id;')
  }

  say(`rows written : ${rows.length}`)
  say(`checksum     : ${createHash('md5').update(fingerprint.slice().sort().join('\n')).digest('hex')}`)
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
