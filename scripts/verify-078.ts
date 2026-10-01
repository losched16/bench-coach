// Did migrations 078 and 079 land, and only where they should?
//
//   npm run verify:078
//
// Read-only, with the public key. The drill ids and videos are parsed out of
// migrations/078_drill_video_link_repair.sql and 079_drill_video_replacements.sql
// rather than repeated here, so the files and this check cannot drift apart.
//
// Before they are applied this fails on every drill they name — that is the
// expected "not yet" answer, not a fault.

import { createClient } from '@supabase/supabase-js'
// Names the database before touching it. See scripts/lib/env-guard.mjs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requireTarget } = require('./lib/env-guard.mjs')
import * as fs from 'fs'
import * as path from 'path'
import { mediaForDrill } from '../lib/drillMedia'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SQL = fs.readFileSync(path.join(__dirname, '..', 'migrations', '078_drill_video_link_repair.sql'), 'utf8')
const SQL_079 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '079_drill_video_replacements.sql'), 'utf8')

const DEAD = ['3Xqb7j2BYTU', '9EAbFFMBBGE', '3NqJh3hfYZc', 'k8Lzh6YJLUE']
const HIGH_TEE = 'iKX-qxQ1X5g'

let failures = 0
function check(label: string, ok: boolean, evidence = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(64)} ${evidence}`)
  if (!ok) failures++
}

// ('<uuid>'[::uuid], '<video>', ...) rows in each VALUES block.
function rows(block: string): Array<{ id: string; video?: string }> {
  const out: Array<{ id: string; video?: string }> = []
  const re = /\('([0-9a-f-]{36})'(?:::uuid)?(?:,\s*'([A-Za-z0-9_-]{11})')?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) out.push({ id: m[1], video: m[2] })
  return out
}

async function main() {
  if (!URL || !KEY) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'); process.exit(1) }
  requireTarget({ script: 'verify-078', writes: false })
  const sb = createClient(URL, KEY)

  const [removeBlock, retargetBlock] = SQL.split('-- ── 3.')
  const removed = rows(removeBlock)
  const retargeted = rows(retargetBlock).filter(r => !r.video)
  // 079's VALUES block: the drills that get a replacement, and which one.
  const replaced = new Map(rows(SQL_079.split('eligible AS')[0]).map(r => [r.id, r.video!]))
  check('parsed the drills 078 and 079 name', removed.length === 12 && retargeted.length === 2 && replaced.size === 6,
    `${removed.length} removed, ${retargeted.length} retargeted, ${replaced.size} replaced`)

  const { data: drills, error } = await sb.from('drill_resources')
    .select('id, drill_name, youtube_video_id, youtube_url, thumbnail_url, youtube_start_seconds')
    .is('created_by_coach_id', null).limit(2000)
  const { data: media, error: mErr } = await sb.from('drill_media_resources')
    .select('id, drill_id, media_type, external_id, url, is_primary, verification_status, start_seconds, title, source_name, thumbnail_url')
    .limit(5000)
  check('library and media reads succeed', !error && !mErr && !!drills && !!media,
    error?.message || mErr?.message || `${drills?.length} drills, ${media?.length} media rows`)
  if (!drills || !media) process.exit(1)

  const byId = new Map(drills.map(d => [d.id, d]))
  const mediaOf = (id: string) => media.filter(m => m.drill_id === id)

  for (const r of removed) {
    const d = byId.get(r.id)
    if (!d) { check(`drill ${r.id} exists`, false, 'missing'); continue }
    const shown = mediaForDrill(d as any, mediaOf(r.id) as any)
    const stillShown = shown.some(s => s.url.includes(r.video!))
    const want = replaced.get(r.id) ?? null
    const ok = !stillShown && d.youtube_video_id === want &&
      (want ? shown[0]?.url.includes(want) === true : shown.length === 0)
    check(`${d.drill_name.slice(0, 60)}`, ok,
      stillShown ? `still shows ${r.video}` : `was ${r.video}, now ${d.youtube_video_id ?? 'no video'}${want ? ` (want ${want})` : ''}`)
  }

  for (const r of retargeted) {
    const d = byId.get(r.id)
    if (!d) { check(`drill ${r.id} exists`, false, 'missing'); continue }
    const first = mediaForDrill(d as any, mediaOf(r.id) as any)[0]
    check(`${d.drill_name.slice(0, 60)}`,
      d.youtube_video_id === HIGH_TEE && !!first && first.url.includes(HIGH_TEE),
      `legacy ${d.youtube_video_id}, shown ${first?.url ?? 'nothing'}`)
  }

  const deadAnywhere = drills.filter(d => DEAD.includes(String(d.youtube_video_id)))
  const deadMedia = media.filter(m => DEAD.includes(String(m.external_id)) && m.verification_status !== 'rejected')
  check('no drill anywhere still carries a dead video', deadAnywhere.length === 0 && deadMedia.length === 0,
    `${deadAnywhere.length} drill rows, ${deadMedia.length} live media rows`)

  const onePrimary = new Map<string, number>()
  for (const m of media) if (m.is_primary) onePrimary.set(m.drill_id, (onePrimary.get(m.drill_id) || 0) + 1)
  check('no drill has two primary videos', Array.from(onePrimary.values()).every(n => n === 1))

  const withVideo = drills.filter(d => d.youtube_video_id)
  console.log(`\n     drills with a video: ${withVideo.length}; distinct videos: ${new Set(withVideo.map(d => d.youtube_video_id)).size}`)
  console.log(failures ? `\nFAIL — ${failures} check(s)` : '\nPASS — 0 failures')
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
