// What has to be true of a timestamp before anyone can trust it.
//
// Phase 2B wrote no timestamps, because no evidence was reachable. These are
// the rules that will govern the ones written when it is — asserted now, while
// the column is still empty, because a rule added after the data is a rule
// somebody has to retro-fit against rows that already broke it.
//
// The failure being guarded is specific and quiet. A WRONG segment start is
// worse than no segment start: at 0:00 a coach knows where they are and
// scrubs; dropped forty seconds into a different drill they conclude the link
// is broken and stop trusting the other two hundred.
//
//   npm run test:media-segments

import {
  pickPrimary, toPlayable, legacyPlayable, mediaForDrill, primaryMediaFor,
  hasAnyMedia, DrillMedia,
} from '@/lib/drillMedia'
import { parseDescriptionTimestamps } from './build-media-segment-audit'
import { readFileSync, existsSync } from 'fs'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const AUDIT = 'docs/audits/drill-media-segment-audit.csv'
const SEG = (over: Partial<DrillMedia> = {}): DrillMedia =>
  ({ drill_id: 'd', media_type: 'youtube', url: 'https://www.youtube.com/watch?v=abc12345678',
     external_id: 'abc12345678', ...over })

// ── a verified timestamp requires provenance ───────────────────────────────
//
// verification_status = 'verified' with no start_source says "somebody checked
// this" and does not say who, when, or against what. That is the shape of a
// claim nobody can audit, and this library has spent three phases avoiding it.

export function segmentIsTrustworthy(m: DrillMedia): { ok: boolean; why: string } {
  const hasStart = m.start_seconds !== null && m.start_seconds !== undefined
  if (m.verification_status === 'verified') {
    if (!hasStart) return { ok: false, why: 'verified with no start_seconds — verified WHAT?' }
    if (!m.start_source) return { ok: false, why: 'verified with no start_source — no provenance' }
  }
  if (hasStart && Number(m.start_seconds) < 0) return { ok: false, why: 'negative start' }
  if (hasStart && !m.start_source && m.verification_status === 'verified') {
    return { ok: false, why: 'timestamp without provenance' }
  }
  const hasEnd = m.end_seconds !== null && m.end_seconds !== undefined
  if (hasEnd && !hasStart) return { ok: false, why: 'end without a start' }
  if (hasEnd && hasStart && Number(m.end_seconds) <= Number(m.start_seconds)) {
    return { ok: false, why: 'end at or before start' }
  }
  return { ok: true, why: '' }
}

check('a verified segment must carry start_source',
  !segmentIsTrustworthy(SEG({ start_seconds: 95, verification_status: 'verified' })).ok)
check('...and is fine once it does',
  segmentIsTrustworthy(SEG({ start_seconds: 95, start_source: 'chapter', verification_status: 'verified' })).ok)
check('verified with no timestamp at all is rejected',
  !segmentIsTrustworthy(SEG({ verification_status: 'verified' })).ok,
  'verified what, exactly?')
check('an UNVERIFIED row may carry a timestamp with no source',
  segmentIsTrustworthy(SEG({ start_seconds: 95 })).ok,
  'a proposed timestamp is allowed to be provisional; a verified one is not')

// ── null is a valid answer, and 0 is not a substitute for it ───────────────

check('a null timestamp is valid', segmentIsTrustworthy(SEG()).ok)
check('...and stays null through the render', toPlayable(SEG())?.start_seconds === null)
check('...and produces no time parameter', !toPlayable(SEG())?.url.includes('t='))

check('0 is a real value, not a stand-in for unknown',
  toPlayable(SEG({ start_seconds: 0 }))?.start_seconds === 0)
check('...and 0 still produces no time parameter, because 0:00 IS the start',
  !toPlayable(SEG({ start_seconds: 0 }))?.url.includes('t='))
check('a real start reaches the link',
  toPlayable(SEG({ start_seconds: 95 }))?.url.includes('t=95s') === true)

// The legacy column is where 0 and null genuinely blur, so it collapses both
// to null rather than reporting a start nobody curated.
check('a legacy 0 is reported as unknown, not as a start time',
  legacyPlayable({ youtube_video_id: 'abc12345678', youtube_start_seconds: 0 })?.start_seconds === null)
check('a legacy null is reported as unknown',
  legacyPlayable({ youtube_video_id: 'abc12345678', youtube_start_seconds: null })?.start_seconds === null)

// ── an end must not cut off the instruction ────────────────────────────────

check('an end at or before the start is rejected',
  !segmentIsTrustworthy(SEG({ start_seconds: 95, end_seconds: 95 })).ok)
check('an end with no start is rejected',
  !segmentIsTrustworthy(SEG({ end_seconds: 95 })).ok)
check('a sane segment passes',
  segmentIsTrustworthy(SEG({ start_seconds: 95, end_seconds: 160, start_source: 'chapter' })).ok)
check('a negative start is rejected', !segmentIsTrustworthy(SEG({ start_seconds: -5 })).ok)

// ── one video, several canonical drills ────────────────────────────────────
//
// This is the whole point of the media table. The same compilation backs ten
// drills; each needs its own segment, and they must not collide.

const SHARED = 'https://www.youtube.com/watch?v=gOE484Meo_o'
const threeDrills: DrillMedia[] = [
  { drill_id: 'tee',  media_type: 'youtube', url: SHARED, external_id: 'gOE484Meo_o', start_seconds: 30, start_source: 'chapter', verification_status: 'verified' },
  { drill_id: 'toss', media_type: 'youtube', url: SHARED, external_id: 'gOE484Meo_o', start_seconds: 145, start_source: 'chapter', verification_status: 'verified' },
  { drill_id: 'game', media_type: 'youtube', url: SHARED, external_id: 'gOE484Meo_o', start_seconds: 300, start_source: 'chapter', verification_status: 'verified' },
]
check('one source video can back three canonical drills at three segments',
  new Set(threeDrills.map(m => m.drill_id)).size === 3 &&
  new Set(threeDrills.map(m => m.start_seconds)).size === 3)
check('...and each renders its own time parameter',
  threeDrills.every(m => toPlayable(m)!.url.includes(`t=${m.start_seconds}s`)))
check('...and all three are trustworthy by the rule above',
  threeDrills.every(m => segmentIsTrustworthy(m).ok))

// The unique attachment index is (drill_id, url, coalesce(start_seconds,-1)):
// the same drill and video at a DIFFERENT segment is a legitimate second row.
const keys = threeDrills.map(m => `${m.drill_id}|${m.url}|${m.start_seconds ?? -1}`)
check('no two attachments collide on the unique index',
  new Set(keys).size === keys.length)

// ── a drill may have several media, or none ───────────────────────────────

const DRILL = { id: 'd1', drill_name: 'Front Toss', youtube_video_id: 'q7CPS0RYDPM', youtube_url: null }
const many: DrillMedia[] = [
  { drill_id: 'd1', media_type: 'youtube', url: 'https://youtu.be/q7CPS0RYDPM', external_id: 'q7CPS0RYDPM', id: 'm1', is_primary: true, start_seconds: 12, start_source: 'chapter', verification_status: 'verified' },
  { drill_id: 'd1', media_type: 'youtube', url: SHARED, external_id: 'gOE484Meo_o', id: 'm2' },
  { drill_id: 'd1', media_type: 'article', url: 'https://example.com/a', id: 'm3' },
]
check('a drill can carry its own video, a collection video and an article',
  mediaForDrill(DRILL, many).length === 3)
check('the verified primary leads', primaryMediaFor(DRILL, many)?.start_seconds === 12)
check('an unverified alternate sits behind it, not in front',
  mediaForDrill(DRILL, many)[1].verification_status === 'unverified')
check('a canonical drill with NO media still works',
  mediaForDrill({ id: 'x', drill_name: 'Protect the Castle' }, []).length === 0 &&
  hasAnyMedia({ id: 'x', drill_name: 'Protect the Castle' }, null) === false)

// ── the evidence parser only fires on a real uploader index ───────────────

check('an ascending list of uploader timestamps is read',
  parseDescriptionTimestamps('0:00 Intro\n1:30 Tee Work\n4:05 Soft Toss').length === 3)
check('a single stray time in prose is NOT a chapter list',
  parseDescriptionTimestamps('Filmed in 2024. See 1:30 for details.').length === 0,
  'one timestamp is a sentence, not an index')
check('a non-ascending list is rejected',
  parseDescriptionTimestamps('0:00 Intro\n4:05 Soft Toss\n1:30 Tee Work').length === 0,
  'out of order means it is not a running index')
check('hours are parsed',
  parseDescriptionTimestamps('0:00 Intro\n1:02:03 Later')[1].seconds === 3723)
check('nothing is invented from empty text', parseDescriptionTimestamps('').length === 0)

// ── the audit itself claims nothing it cannot support ─────────────────────

/**
 * A real CSV reader, because a naive split on ',' shifts every column after the
 * first quoted cell that contains one — and drill names and evidence notes
 * both do. The first version of this test failed for that reason and not
 * because anything was wrong with the audit.
 */
function readCsv(text: string): Record<string, string>[] {
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

if (existsSync(AUDIT)) {
  const rows = readCsv(readFileSync(AUDIT, 'utf8').trim())

  check('the audit has a row per media resource', rows.length > 0, `${rows.length}`)
  check('every row parses to the full column set',
    rows.every(r => 'evidence_note' in r && 'evidence_type' in r))
  check('no row proposes a timestamp without an evidence type',
    rows.every(r => !r.proposed_start_seconds || r.evidence_type !== 'none'),
    'a proposal with no evidence is a guess wearing a column heading')
  check('no row claims verified without evidence',
    rows.every(r => r.verification_status !== 'verified' || r.evidence_type !== 'none'))
  check('every row states WHY its evidence columns are empty',
    rows.every(r => (r.evidence_note || '').trim() !== ''),
    'an empty cell with no reason reads as nobody having looked')
  check('...and the reason names a cause, not just a failure',
    rows.every(r => r.evidence_type !== 'none' || /unreachable|no chapters|HTTP|policy/i.test(r.evidence_note)),
    'a note like "cancelled" invites a pointless retry')
} else {
  check('the media segment audit exists', false, `${AUDIT} not found — run npm run audit:media-segments`)
}

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
