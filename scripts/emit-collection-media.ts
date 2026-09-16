// Attach each collection's video to the canonical drill it actually contains.
//
// docs/audits/drill-collection-extraction.csv found 27 cases where a demoted
// source collection demonstrates a drill the library ALREADY holds as its own
// canonical row. The collection stays demoted — it is still not a drill — but
// its video becomes a second piece of media on the real activity.
//
// WHY THIS IS WORTH DOING WITH NO TIMESTAMP
//
// It is not a timestamp substitute and it does not pretend to be. What it does
// is put the row in place: when evidence finally arrives for video X, the
// segment is written onto an attachment that already exists on the right drill,
// rather than somebody having to work out the mapping again from a CSV.
//
// So every row here is is_primary FALSE and verification_status 'unverified',
// with start_seconds NULL. The drill's own demonstration keeps the primary
// slot; this sits behind it as "the other video that shows this", which is
// exactly what it is.
//
// A drill that already carries this video is skipped: the unique attachment
// index would reject it anyway, and saying so out loud is better than relying
// on a constraint to be silent about it.
//
//   npx tsx scripts/emit-collection-media.ts

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`
const say = (m: string) => console.error(m)

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...rest] = rows
  return rest.filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

async function main() {
  if (!URL || !KEY) { say('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: media } = await sb.from('drill_media_resources').select('drill_id, external_id, url')
  const { data: drills } = await sb.from('drill_resources')
    .select('id, drill_name, resource_kind, duplicate_of_drill_id').is('created_by_coach_id', null)

  const byId = new Map((drills || []).map((d: any) => [d.id, d]))
  const attached = new Set((media || []).map((m: any) => `${m.drill_id}|${m.external_id || m.url}`))

  const rows = parseCsv(readFileSync('docs/audits/drill-collection-extraction.csv', 'utf8'))
    .filter(r => r.action === 'EXISTING_CANONICAL' && r.canonical_match_id && r.source_video)

  say(`EXISTING_CANONICAL matches in the extraction audit: ${rows.length}`)

  const out: string[] = []
  let already = 0, badTarget = 0
  const seen = new Set<string>()

  for (const r of rows) {
    const target = byId.get(r.canonical_match_id)
    if (!target) { say(`  ! canonical not found: ${r.candidate_canonical_match}`); badTarget++; continue }

    // Never attach to a demoted row or a duplicate — the point is to enrich the
    // activity a coach can actually be offered.
    if (['source_collection', 'teaching_content'].includes(String(target.resource_kind)) ||
        target.duplicate_of_drill_id) {
      say(`  ! target is not schedulable: ${target.drill_name}`); badTarget++; continue
    }

    const key = `${r.canonical_match_id}|${r.source_video}`
    if (seen.has(key)) continue
    seen.add(key)
    if (attached.has(key)) { already++; continue }

    const url = `https://www.youtube.com/watch?v=${r.source_video}`
    // 14 values for 14 columns: drill_id, media_type, provider, external_id,
    // url, title, source_name, thumbnail_url, start_seconds, end_seconds,
    // start_source, is_primary, verification_status, notes.
    out.push(`(${q(r.canonical_match_id)}::uuid,'youtube','youtube',${q(r.source_video)},${q(url)},` +
      `${q(r.collection_name)},NULL,NULL,NULL,NULL,NULL,false,'unverified',` +
      `${q(`Collection video that also demonstrates this drill, as "${r.candidate_activity_name}". ` +
           `Attached by Phase 2B from the collection extraction audit. No segment: no timestamp evidence was reachable.`)})`)
  }

  say(`already attached      : ${already}`)
  say(`unusable target       : ${badTarget}`)
  say(`new attachments       : ${out.length}`)

  if (!out.length) { say('\nNothing to write.'); return }

  console.log('-- Collection videos attached to the canonical drills they demonstrate.')
  console.log('-- is_primary false, unverified, start_seconds NULL. No drill row is modified.')
  console.log('insert into drill_media_resources')
  console.log('  (drill_id, media_type, provider, external_id, url, title, source_name,')
  console.log('   thumbnail_url, start_seconds, end_seconds, start_source, is_primary,')
  console.log('   verification_status, notes)')
  console.log('values')
  console.log(out.join(',\n'))
  console.log('on conflict do nothing;')
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
