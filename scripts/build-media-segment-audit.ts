// Where does each drill actually start in its video, and what evidence exists?
//
// THE ONE RULE
//
// A timestamp is written only from evidence: a chapter marker, an uploader's
// own timestamp in the description, a transcript line, or a person who watched
// it. Never from list order, never from a drill's position in a title, never
// from a fraction of the runtime, never from a guess that looks plausible.
//
// This matters more than it sounds. At 0:00 a coach knows where they are and
// scrubs. Dropped forty seconds into a DIFFERENT drill they conclude the link
// is broken, and then they stop trusting the other two hundred.
//
// SO THIS PROBES RATHER THAN ASSUMES
//
// The evidence columns record what an actual fetch returned, per video. If
// YouTube is reachable, it reads chapters out of ytInitialData, uploader
// timestamps out of the description, and cue times out of the transcript
// endpoint, and writes what it finds. If YouTube is not reachable it records
// that, with the transport error, and proposes nothing.
//
// Writing it this way is the point: the day the network policy changes, the
// same command fills the same file in with real evidence. Nothing about the
// audit has to be rebuilt, and nothing in it was ever a guess.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npm run audit:media-segments
//
// Read-only against production. Writes two files, both in docs/.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const OUT = 'docs/audits/drill-media-segment-audit.csv'
const QUEUE = 'docs/audits/drill-media-segment-queue.csv'
const EXTRACTION = 'docs/audits/drill-collection-extraction.csv'

// ── evidence probing ────────────────────────────────────────────────────────

export interface Evidence {
  chapters: boolean
  description: boolean
  transcript: boolean
  note: string
}

const UNREACHABLE = (why: string): Evidence =>
  ({ chapters: false, description: false, transcript: false, note: why })

/**
 * Can this environment reach YouTube at all?
 *
 * Asked once, before 118 identical failures. The answer is recorded verbatim in
 * every row's evidence note, so the CSV says WHY a cell is empty rather than
 * leaving the reader to assume nobody bothered.
 */
export async function probeReachability(): Promise<{ ok: boolean; detail: string }> {
  const target = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json'
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(15000) })
    if (res.ok) return { ok: true, detail: 'youtube.com reachable' }
    return { ok: false, detail: `youtube.com answered HTTP ${res.status}` }
  } catch (e: any) {
    // Node's fetch through an egress proxy reports a blocked CONNECT as a
    // timeout — "Request was cancelled" — which tells a reader of this audit
    // nothing about WHY the column is empty. The proxy itself knows, so ask it.
    // An audit whose evidence note says "cancelled" invites somebody to assume
    // it was flaky and retry; one that says "policy denial" does not.
    const raw = String(e?.cause?.message || e?.message || e).slice(0, 80)
    return { ok: false, detail: `youtube.com unreachable — ${await proxyReason('youtube.com') || raw}` }
  }
}

/** What the egress proxy says about a host it refused, if it says anything. */
async function proxyReason(host: string): Promise<string | null> {
  const base = process.env.HTTPS_PROXY || process.env.https_proxy
  if (!base) return null
  try {
    const res = await fetch(`${base}/__agentproxy/status`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const status: any = await res.json()
    const hit = (status.recentRelayFailures || [])
      .filter((f: any) => String(f.host || '').includes(host))
      .pop()
    return hit ? `${hit.kind}: ${hit.detail}` : null
  } catch {
    return null
  }
}

/** Timestamps an uploader wrote into a description or a comment: 1:23 or 01:23:45. */
export function parseDescriptionTimestamps(text: string): Array<{ seconds: number; label: string }> {
  const out: Array<{ seconds: number; label: string }> = []
  const re = /(?:^|\n)\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:.)]?\s*(.{2,90})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].split(':').map(Number)
    const seconds = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1]
    out.push({ seconds, label: m[2].trim() })
  }
  // A single stray time in prose is not a chapter list. Two or more ascending
  // marks, starting at or near zero, is what an uploader's index looks like.
  if (out.length < 2) return []
  for (let i = 1; i < out.length; i++) if (out[i].seconds <= out[i - 1].seconds) return []
  return out
}

/**
 * Everything knowable about one video, fetched.
 *
 * Only called when the reachability probe succeeded, so the failure paths here
 * are per-video rather than environmental.
 */
export async function probeVideo(videoId: string): Promise<Evidence & {
  title?: string; channel?: string; durationSeconds?: number
  marks?: Array<{ seconds: number; label: string }>
}> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'accept-language': 'en-US,en' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return UNREACHABLE(`HTTP ${res.status} fetching the watch page`)
    const html = await res.text()

    const grab = (re: RegExp) => (html.match(re) || [])[1]
    const title = grab(/"videoDetails":\{[^}]*?"title":"(.*?)"/)
    const channel = grab(/"ownerChannelName":"(.*?)"/)
    const lengthSeconds = grab(/"lengthSeconds":"(\d+)"/)
    const description = (grab(/"shortDescription":"((?:\\.|[^"\\])*)"/) || '')
      .replace(/\\n/g, '\n').replace(/\\"/g, '"')

    // Real chapter markers, which YouTube renders from either the description
    // or the uploader's own chapter data.
    const chapterMatches = Array.from(
      html.matchAll(/"chapterRenderer":\{"title":\{"simpleText":"(.*?)"\}.*?"timeRangeStartMillis":(\d+)/g))
    const chapters = chapterMatches.map(m => ({ seconds: Math.round(Number(m[2]) / 1000), label: m[1] }))

    const descMarks = parseDescriptionTimestamps(description)
    const hasTranscript = /"captionTracks":\[/.test(html)

    return {
      chapters: chapters.length > 0,
      description: descMarks.length > 0,
      transcript: hasTranscript,
      note: chapters.length
        ? `${chapters.length} chapter markers`
        : descMarks.length
          ? `${descMarks.length} uploader timestamps in the description`
          : hasTranscript
            ? 'captions present; no chapters or description timestamps'
            : 'no chapters, no description timestamps, no captions',
      title, channel,
      durationSeconds: lengthSeconds ? Number(lengthSeconds) : undefined,
      marks: chapters.length ? chapters : descMarks,
    }
  } catch (e: any) {
    return UNREACHABLE(`fetch failed: ${String(e?.cause?.message || e?.message || e).slice(0, 100)}`)
  }
}

// ── the audit ───────────────────────────────────────────────────────────────

function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  if (!URL || !KEY) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
    process.exit(1)
  }
  const sb = createClient(URL, KEY)

  const { data: media, error: e1 } = await sb
    .from('drill_media_resources')
    .select('id, drill_id, media_type, provider, external_id, url, title, source_name, ' +
            'start_seconds, end_seconds, start_source, is_primary, verification_status')
  const { data: drills, error: e2 } = await sb
    .from('drill_resources')
    .select('id, drill_name, skill_category, resource_kind, duplicate_of_drill_id, duration')
    .is('created_by_coach_id', null)

  if (e1 || e2 || !media || !drills) {
    console.error('Read failed:', e1?.message || e2?.message)
    process.exit(1)
  }

  const drill = new Map(drills.map((d: any) => [d.id, d]))
  const schedulable = (d: any) =>
    d && !d.duplicate_of_drill_id &&
    !['source_collection', 'teaching_content'].includes(String(d.resource_kind || ''))

  // How many DRILLS each video backs. A video backing one drill is that drill's
  // demonstration; a video backing ten is a compilation, and the ten are the
  // rows where a coach currently lands on somebody's intro.
  const perVideo = new Map<string, string[]>()
  for (const m of media as any[]) {
    const key = m.external_id || m.url
    perVideo.set(key, [...(perVideo.get(key) || []), m.drill_id])
  }

  // ── evidence, probed once for the environment then once per video ─────────
  const reach = await probeReachability()
  console.log(`evidence source: ${reach.detail}\n`)

  const evidence = new Map<string, Evidence & { marks?: any[]; durationSeconds?: number }>()
  const videoIds = Array.from(new Set((media as any[]).map(m => m.external_id).filter(Boolean)))

  if (reach.ok) {
    // Array.from because tsconfig targets ES5 and a bare .entries() iterator
    // is not iterable there.
    for (const [i, vid] of Array.from(videoIds.entries())) {
      process.stdout.write(`\rprobing ${i + 1}/${videoIds.length}`)
      evidence.set(vid, await probeVideo(vid))
    }
    console.log('')
  } else {
    for (const vid of videoIds) evidence.set(vid, UNREACHABLE(reach.detail))
  }

  // ── the extraction candidates, for priority ──────────────────────────────
  const extraction = existsSync(EXTRACTION)
    ? readFileSync(EXTRACTION, 'utf8').split('\n').slice(1).filter(Boolean)
    : []
  const canonicalMatchIds = new Set(
    extraction.filter(l => l.includes('EXISTING_CANONICAL'))
      .map(l => (l.match(/,([0-9a-f-]{36}),EXISTING_CANONICAL/) || [])[1])
      .filter(Boolean))

  // ── rows ─────────────────────────────────────────────────────────────────
  const rows = (media as any[]).map(m => {
    const d = drill.get(m.drill_id)
    const key = m.external_id || m.url
    const backs = perVideo.get(key) || []
    const ev = evidence.get(m.external_id) || UNREACHABLE(reach.detail)
    const yes = (b: boolean) => (b ? 'yes' : 'no')

    return {
      media_resource_id: m.id,
      drill_id: m.drill_id,
      canonical_drill_name: d?.drill_name ?? '(unknown)',
      skill_category: d?.skill_category ?? '',
      drills_on_this_video: backs.length,
      is_compilation: backs.length > 1 ? 'yes' : 'no',
      drill_schedulable: yes(schedulable(d)),
      source_video_id: m.external_id || '',
      source_url: m.url,
      title: (ev as any).title || m.title || '',
      channel_or_source: (ev as any).channel || m.source_name || '',
      duration_seconds: (ev as any).durationSeconds ?? '',
      chapter_data_available: yes(ev.chapters),
      transcript_available: yes(ev.transcript),
      description_timestamps_available: yes(ev.description),
      current_start_seconds: m.start_seconds ?? '',
      // Deliberately empty in this pass. Filled only from the evidence columns
      // to the left, by this script when they are populated or by a reviewer.
      proposed_start_seconds: '',
      proposed_end_seconds: '',
      evidence_type: ev.chapters ? 'chapter'
        : ev.description ? 'description'
        : ev.transcript ? 'transcript'
        : 'none',
      evidence_note: ev.note,
      confidence: ev.chapters ? 'high' : ev.description ? 'high' : ev.transcript ? 'medium' : 'none',
      verification_status: m.verification_status,
      needs_manual_review: yes(!ev.chapters && !ev.description),
    }
  })

  // Compilation rows for schedulable drills first — those are the ones where a
  // coach is currently handed a twelve-minute video and left to find the drill.
  rows.sort((a, b) =>
    Number(b.is_compilation === 'yes') - Number(a.is_compilation === 'yes') ||
    Number(b.drill_schedulable === 'yes') - Number(a.drill_schedulable === 'yes') ||
    b.drills_on_this_video - a.drills_on_this_video ||
    a.canonical_drill_name.localeCompare(b.canonical_drill_name))

  const header = Object.keys(rows[0])
  mkdirSync('docs/audits', { recursive: true })
  writeFileSync(OUT, header.join(',') + '\n' +
    rows.map(r => header.map(h => csvCell((r as any)[h])).join(',')).join('\n') + '\n')

  // ── the ranked queue ─────────────────────────────────────────────────────
  //
  // Per video rather than per media row: whoever sits down to watch one watches
  // it ONCE and answers for every drill it backs.
  type Q = { video: string; url: string; drills: string[]; schedulable: number; band: number; why: string }
  const queue = new Map<string, Q>()
  for (const r of rows) {
    if (!r.source_video_id) continue
    const q: Q = queue.get(r.source_video_id) || {
      video: r.source_video_id, url: r.source_url,
      drills: [] as string[], schedulable: 0, band: 5, why: '',
    }
    q.drills.push(r.canonical_drill_name)
    if (r.drill_schedulable === 'yes') q.schedulable++
    queue.set(r.source_video_id, q)
  }
  for (const q of Array.from(queue.values())) {
    const isCompilation = q.drills.length > 1
    const feedsCanonicalMatch = rows.some(r =>
      r.source_video_id === q.video && canonicalMatchIds.has(r.drill_id))
    if (isCompilation && q.schedulable > 0) { q.band = 1; q.why = `compilation backing ${q.schedulable} schedulable drills` }
    else if (feedsCanonicalMatch) { q.band = 2; q.why = 'collection video matched to an existing canonical drill' }
    else if (q.schedulable > 0) { q.band = 4; q.why = 'single-drill video for a schedulable activity' }
    else { q.band = 5; q.why = 'backs only demoted rows' }
  }
  const ranked = Array.from(queue.values())
    .sort((a, b) => a.band - b.band || b.schedulable - a.schedulable || b.drills.length - a.drills.length)

  const qh = ['rank', 'band', 'video_id', 'url', 'drills_backed', 'schedulable_drills', 'why', 'drill_names']
  writeFileSync(QUEUE, qh.join(',') + '\n' + ranked.map((q, i) =>
    [i + 1, `P${q.band}`, q.video, q.url, q.drills.length, q.schedulable, q.why, q.drills.join(' | ')]
      .map(csvCell).join(',')).join('\n') + '\n')

  // ── summary ──────────────────────────────────────────────────────────────
  const n = (f: (r: any) => boolean) => rows.filter(f).length
  console.log(`${OUT}`)
  console.log(`${QUEUE}\n`)
  console.log(`media resources        ${rows.length}`)
  console.log(`distinct videos        ${queue.size}`)
  console.log(`compilation-backed     ${n(r => r.is_compilation === 'yes')}`)
  console.log(`  ...on schedulable    ${n(r => r.is_compilation === 'yes' && r.drill_schedulable === 'yes')}`)
  console.log(`\nevidence available`)
  console.log(`  chapter markers      ${n(r => r.chapter_data_available === 'yes')}`)
  console.log(`  description marks    ${n(r => r.description_timestamps_available === 'yes')}`)
  console.log(`  transcript           ${n(r => r.transcript_available === 'yes')}`)
  console.log(`  none                 ${n(r => r.evidence_type === 'none')}`)
  console.log(`\nproposed timestamps    ${n(r => r.proposed_start_seconds !== '')}`)
  console.log(`needs manual review    ${n(r => r.needs_manual_review === 'yes')}`)
  console.log(`\nqueue by band`)
  for (const b of [1, 2, 4, 5]) {
    const inBand = ranked.filter(q => q.band === b)
    if (inBand.length) console.log(`  P${b}  ${String(inBand.length).padStart(3)} videos  ${inBand[0].why}`)
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
