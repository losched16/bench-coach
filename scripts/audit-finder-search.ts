// Does the Drill Finder's search answer what a coach actually types?
//
//   npm run audit:finder-search
//
// Read-only. Writes docs/audits/drill-finder-search.csv and exits non-zero if
// any of the reference queries comes back empty.
//
// WHY THIS IS A SCRIPT AND NOT A UNIT TEST
//
// The unit tests prove the ranking rule. They cannot prove the rule reaches the
// library, because that depends on 49 problems, 393 mappings and 154 rows of
// prose that live in the database and change without the code changing. The
// first version of this search matched whole phrases against aliases and
// scored 3 of 10 on the list below — the rule was defensible and the answer was
// useless, and only a live measurement said so.
//
// The queries are the ones named in the Phase 2D brief, verbatim, plus a few
// that probe the specific failure this replaces: searching for a channel name.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import { buildFinderIndex, searchDrills, Match } from '../lib/drillFinder'
import { isSchedulable } from '../lib/drills'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OUT = 'docs/audits/drill-finder-search.csv'

/** What a volunteer coach types. From the brief, unedited. */
const QUERIES = [
  'dropping hands',
  'afraid of fly balls',
  'throwing accuracy',
  'quick hands',
  'first base decision',
  'two strike',
  'bad hops',
  'footwork',
  'warmup',
  'no equipment',
]

/**
 * Searches that must come back EMPTY.
 *
 * A channel name is the one the redesign is specifically closing: 140 of 154
 * rows carry a `channel`, a handful of channels cover most of the library, and
 * ranking it at all would let "rebellion" return thirty unrelated activities.
 */
const MUST_BE_EMPTY = ['rebellion', 'youtube', 'hqdefault']

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: drills, error } = await sb.from('drill_resources').select('*')
    .is('created_by_coach_id', null)
  const { data: tax } = await sb.from('problem_taxonomy')
    .select('slug, label, aliases, skill_category')
  const { data: map } = await sb.from('drill_problem_map').select('drill_id, problem_slug')

  if (error || !drills) { console.error('Read failed.', error); process.exit(1) }

  const schedulable = (drills as any[]).filter(d => isSchedulable(d))
  const idx = buildFinderIndex(tax as any[], map as any[])

  console.log(`${schedulable.length} schedulable activities · ${(tax || []).length} problems · ${(map || []).length} mappings\n`)

  const rows: any[] = []
  let empty = 0

  const describe = (q: string, hits: Match[]) => {
    const byTier = [1, 2, 3, 4, 5].map(t => hits.filter(h => h.tier === t).length)
    const top = hits.slice(0, 3).map(h => `${h.drill.drill_name} (t${h.tier})`).join(' · ')
    return { q, total: hits.length, byTier, top }
  }

  console.log('query                    hits   t1  t2  t3  t4  t5   top results')
  console.log('─'.repeat(110))

  for (const q of QUERIES) {
    const hits = searchDrills(schedulable, q, idx)
    const d = describe(q, hits)
    if (hits.length === 0) empty++
    console.log(
      q.padEnd(24) + String(d.total).padStart(5) + '  ' +
      d.byTier.map(n => String(n).padStart(3)).join(' ') + '   ' + d.top.slice(0, 80))

    rows.push({
      query: q,
      hits: hits.length,
      tier1: d.byTier[0], tier2: d.byTier[1], tier3: d.byTier[2],
      tier4: d.byTier[3], tier5: d.byTier[4],
      best_tier: hits.length ? hits[0].tier : '',
      top_result: hits.length ? hits[0].drill.drill_name : '',
      matched_problem: hits.length && hits[0].via ? hits[0].via.slug : '',
    })
  }

  console.log('')
  let leaked = 0
  for (const q of MUST_BE_EMPTY) {
    const hits = searchDrills(schedulable, q, idx)
    if (hits.length > 0) leaked++
    console.log(`must be empty: "${q}" -> ${hits.length}${hits.length ? '  ← ' + hits.slice(0, 3).map(h => h.drill.drill_name).join(', ') : ''}`)
    rows.push({
      query: q, hits: hits.length, tier1: '', tier2: '', tier3: '', tier4: '', tier5: '',
      best_tier: '', top_result: hits.length ? hits[0].drill.drill_name : '', matched_problem: '',
    })
  }

  // Every drill has to be reachable by its own name, or it is in the library
  // and not in the product.
  const unreachable = schedulable.filter(d => {
    const hits = searchDrills(schedulable, d.drill_name, idx)
    return !hits.some(h => h.drill.id === d.id)
  })

  mkdirSync('docs/audits', { recursive: true })
  const head = Object.keys(rows[0])
  const cell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  writeFileSync(OUT, head.join(',') + '\n' +
    rows.map(r => head.map(h => cell(r[h])).join(',')).join('\n') + '\n')

  console.log(`\nfound by its own name    ${schedulable.length - unreachable.length} of ${schedulable.length}`)
  if (unreachable.length) console.log('  missing: ' + unreachable.map(d => d.drill_name).join(', '))
  console.log(`empty coach queries      ${empty} of ${QUERIES.length}`)
  console.log(`channel/media leaks      ${leaked} of ${MUST_BE_EMPTY.length}`)
  console.log(`\n${OUT}`)

  if (empty || leaked || unreachable.length) {
    console.log('\nFAIL')
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch(e => { console.error(e); process.exit(1) })
