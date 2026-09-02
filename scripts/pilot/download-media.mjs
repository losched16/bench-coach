// Task 3 — fetch each source's MP4 to pilot/media/<shortcode>/source.mp4.
//
// Instagram CDN URLs expire. An Apify export that is a day old may carry
// download links that no longer resolve, and a calibration that depends on
// re-fetching from the CDN every time is a calibration that stops working.
// So every video is copied locally once and every later step reads the copy.
//
// A failure is REPORTED, never papered over. If a URL 403s the record says
// 403 and the shortcode stays unretrieved; nothing substitutes a different
// video, because a frame analysis of the wrong reel is worse than none.
//
//   NODE_USE_ENV_PROXY=1 node scripts/pilot/download-media.mjs
//   NODE_USE_ENV_PROXY=1 node scripts/pilot/download-media.mjs DccQM89N1vx
//
// Apify fallback: if a download URL fails and APIFY_TOKEN is set, the record's
// key-value-store URL (if the export carries one) is tried through the Apify
// API. Without a token that path is reported as unavailable rather than
// attempted.

import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { readJson, writeJson, exists, fileSize, probeDurationSeconds, nowIso, P } from './lib.mjs'

async function fetchToFile(url, dest, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error('empty response body')
  writeFileSync(dest, buf)
  return buf.length
}

export async function downloadOne(source) {
  const dir = join(P.media, source.shortcode)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'source.mp4')
  const status = { shortcode: source.shortcode, attempted_at: nowIso(), attempts: [] }

  // Already have a good copy: keep it. Re-downloading a stable local file
  // against an expiring URL is how a working pilot breaks itself.
  if (exists(dest) && fileSize(dest) > 0 && probeDurationSeconds(dest)) {
    return { ...status, ok: true, local_path: dest, bytes: fileSize(dest),
             duration_seconds: probeDurationSeconds(dest), note: 'already present, not re-fetched' }
  }

  const url = source.media?.downloaded_video_url
  if (!url) {
    // Not a failed fetch — nothing was fetched. Kept distinct so a reviewer
    // reading the manifest does not mistake a missing export for a dead CDN.
    return { ...status, ok: false, attempted: false, error: 'no downloaded_video_url in the ingested record' }
  }

  // Attempt 1: the URL as given.
  try {
    const bytes = await fetchToFile(url, dest)
    const duration = probeDurationSeconds(dest)
    if (!duration) throw new Error(`downloaded ${bytes} bytes but ffmpeg cannot read a duration — not a valid video`)
    status.attempts.push({ method: 'direct', url, ok: true, bytes })
    return { ...status, ok: true, local_path: dest, bytes, duration_seconds: duration }
  } catch (e) {
    status.attempts.push({ method: 'direct', url, ok: false, error: String(e.message || e) })
  }

  // Attempt 2: Apify record store, only if configured.
  const token = process.env.APIFY_TOKEN
  const kvUrl = source.provenance?.apify_kv_url || source.media?.apify_kv_url
  if (token && kvUrl) {
    try {
      const bytes = await fetchToFile(kvUrl, dest, { Authorization: `Bearer ${token}` })
      const duration = probeDurationSeconds(dest)
      if (!duration) throw new Error('fetched but not a readable video')
      status.attempts.push({ method: 'apify-kv', url: kvUrl, ok: true, bytes })
      return { ...status, ok: true, local_path: dest, bytes, duration_seconds: duration }
    } catch (e) {
      status.attempts.push({ method: 'apify-kv', url: kvUrl, ok: false, error: String(e.message || e) })
    }
  } else {
    status.attempts.push({
      method: 'apify-kv', ok: false, skipped: true,
      error: !token ? 'APIFY_TOKEN not set' : 'no Apify key-value-store URL in the record',
    })
  }

  return { ...status, ok: false, error: status.attempts.map(a => `${a.method}: ${a.error}`).join(' | ') }
}

if (process.argv[1] && process.argv[1].endsWith('download-media.mjs')) {
  const only = process.argv[2]
  const input = readJson(P.input)
  const targets = only ? input.sources.filter(s => s.shortcode === only) : input.sources
  if (targets.length === 0) { console.error(`no source ${only}`); process.exit(1) }

  const results = []
  for (const s of targets) {
    const r = await downloadOne(s)
    results.push(r)
    console.log(
      `  ${r.shortcode}  ${r.ok ? 'OK' : 'FAILED'}  ` +
      (r.ok ? `${r.bytes} bytes, ${r.duration_seconds?.toFixed(1)}s${r.note ? ` (${r.note})` : ''}` : r.error)
    )
    // Status written per source so a partial run leaves an accurate record.
    writeJson(join(P.media, s.shortcode, 'download-status.json'), r)
    // And reflected back into the ingested input so the manifest can read it.
    s.media.local_path = r.ok ? `pilot/media/${s.shortcode}/source.mp4` : null
    s.media.retrieval_status = r.ok ? 'downloaded' : (r.attempted === false ? 'no-url' : 'failed')
    s.media.retrieval_error = r.ok ? null : r.error
    if (r.ok && s.media.duration_seconds == null) s.media.duration_seconds = r.duration_seconds
  }
  writeJson(P.input, input)

  const ok = results.filter(r => r.ok).length
  console.log(`\n${ok}/${results.length} downloaded. Status files under pilot/media/<shortcode>/download-status.json`)
  process.exit(ok === results.length ? 0 : 2)
}
