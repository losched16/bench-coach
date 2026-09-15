// Every video the library already has, moved into drill_media_resources.
//
// NOTHING IS LOST AND NOTHING IS INVENTED
//
// The legacy youtube_* columns on drill_resources are NOT cleared, NOT dropped
// and NOT modified. This only adds rows. If it produced a bad row, the fix is
// to delete that row; the drill still renders from the columns underneath it,
// because lib/drillMedia.ts falls back to them.
//
// The one judgement call, made explicitly:
//
//   youtube_start_seconds is NULL on all 205 curated rows that carry a video.
//   NULL is copied as NULL. A 0 would read as "this drill starts at the first
//   frame", and for the twelve-minute compilations in this library that is a
//   confident wrong answer rather than a missing one.
//
//   Every backfilled row is verification_status 'unverified' — including rows
//   that DO carry a timestamp. Having a number is not the same as somebody
//   having checked that the number points at the drill. Treating "has a
//   timestamp" as "verified timestamp" is the specific mistake the brief names.
//
// IDEMPOTENT
//
// The unique index (drill_id, url, COALESCE(start_seconds,-1)) makes a second
// run a no-op rather than a duplicate. This upserts against it and reports how
// many rows were new, so running it twice is safe and visibly boring.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npm run backfill:drill-media -- --apply
//
// Without --apply it prints exactly what it would write and touches nothing.

import { createClient } from '@supabase/supabase-js'
import { videoIdFor, watchUrl } from '../lib/drillVideo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

if (!URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

/**
 * One drill row turned into the media row that represents its current video.
 *
 * Exported and pure so scripts/test-drill-media.ts can assert the preservation
 * rules against fixtures without a database — which is the only way to prove
 * "zero current media may be lost" before running it against production.
 */
export function mediaRowFor(d: any): Record<string, any> | null {
  const id = videoIdFor(d)
  const stored = String(d?.youtube_url || '').trim()
  if (!id && !stored) return null

  // The canonical link, built by the one function in this codebase that knows
  // how to stamp a time onto a YouTube URL. Not rebuilt here.
  const url = watchUrl(d)
  if (!url) return null

  const rawStart = d?.youtube_start_seconds
  const start = rawStart == null ? null : Number(rawStart)

  return {
    drill_id: d.id,
    media_type: 'youtube',
    provider: 'youtube',
    external_id: id,
    url,
    title: null,
    source_name: d.channel ?? null,
    thumbnail_url: d.thumbnail_url ?? null,
    // Copied exactly. null stays null; a real 0 stays 0.
    start_seconds: start,
    end_seconds: null,
    // Provenance copied exactly too — whatever the library said, or nothing.
    start_source: d.youtube_start_source ?? null,
    // This is the drill's only video, so it is the one a surface shows.
    is_primary: true,
    verification_status: 'unverified',
    notes: 'Backfilled from drill_resources.youtube_* by migration 062.',
  }
}

async function main() {
  const sb = createClient(URL!, KEY!, { auth: { persistSession: false } })

  const { data: drills, error } = await sb
    .from('drill_resources')
    .select('id, drill_name, youtube_video_id, youtube_url, youtube_start_seconds, ' +
            'youtube_start_source, channel, thumbnail_url')

  if (error || !drills) {
    console.error('Could not read drill_resources:', error?.message)
    process.exit(1)
  }

  const rows = drills.map(mediaRowFor).filter((r): r is Record<string, any> => r !== null)
  const withVideo = drills.filter((d: any) => videoIdFor(d) || d.youtube_url).length
  const withStart = rows.filter(r => r.start_seconds != null).length

  console.log(`${drills.length} drills`)
  console.log(`${withVideo} carry a video`)
  console.log(`${rows.length} media rows to write`)
  console.log(`${withStart} of them carry a timestamp (all 'unverified' regardless)`)

  // Every drill with a video must produce exactly one row. If those two numbers
  // ever disagree, something was dropped, and that is the failure this whole
  // script exists to not have.
  if (rows.length !== withVideo) {
    console.error(`\nREFUSING: ${withVideo} drills carry a video but only ${rows.length} rows were built.`)
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.')
    for (const r of rows.slice(0, 3)) console.log('  ', JSON.stringify(r))
    return
  }

  const before = await sb.from('drill_media_resources').select('id', { count: 'exact', head: true })

  // onConflict names the unique index, so a re-run updates the row in place
  // instead of failing or duplicating.
  const { error: writeErr } = await sb
    .from('drill_media_resources')
    .upsert(rows, { onConflict: 'drill_id,url,start_seconds', ignoreDuplicates: true })

  if (writeErr) {
    console.error('Backfill failed:', writeErr.message)
    process.exit(1)
  }

  const after = await sb.from('drill_media_resources').select('id', { count: 'exact', head: true })
  console.log(`\nmedia rows: ${before.count ?? '?'} -> ${after.count ?? '?'}`)

  // ── the proof, read back from the database ──────────────────────────────
  const { data: check } = await sb
    .from('drill_media_resources')
    .select('drill_id, external_id, start_seconds, start_source, verification_status')

  const byDrill = new Map((check || []).map((m: any) => [m.drill_id, m]))
  let lost = 0
  for (const d of drills as any[]) {
    const id = videoIdFor(d)
    if (!id && !d.youtube_url) continue
    const m = byDrill.get(d.id)
    if (!m) { console.error(`LOST: ${d.drill_name} has a video and no media row`); lost++; continue }
    if (id && m.external_id !== id) { console.error(`CHANGED id: ${d.drill_name}`); lost++ }
    const want = d.youtube_start_seconds == null ? null : Number(d.youtube_start_seconds)
    if ((m.start_seconds ?? null) !== want) { console.error(`CHANGED start: ${d.drill_name}`); lost++ }
    if ((m.start_source ?? null) !== (d.youtube_start_source ?? null)) {
      console.error(`CHANGED provenance: ${d.drill_name}`); lost++
    }
  }

  console.log(lost === 0
    ? 'Every video preserved: id, timestamp and provenance all match the source columns.'
    : `${lost} discrepancies — see above.`)
  if (lost) process.exit(1)
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
