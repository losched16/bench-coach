// Zero current media may be lost, and no timestamp may be invented.
//
// Those are the two promises the media layer makes, and both fail silently when
// broken: a dropped video is a drill card with no link, and an invented 0 is a
// twelve-minute compilation that opens on somebody's intro instead of the drill.
// Neither throws. So they are asserted here against the REAL library snapshot —
// all 208 curated rows as production holds them — rather than against a fixture
// chosen to pass.
//
//   npm run test:drill-media

import {
  pickPrimary, toPlayable, legacyPlayable, mediaForDrill, primaryMediaFor,
  hasAnyMedia, DrillMedia,
} from '@/lib/drillMedia'
import { mediaRowFor } from './backfill-drill-media'
import { videoIdFor } from '@/lib/drillVideo'
import { readFileSync } from 'fs'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const LIBRARY: any[] = JSON.parse(readFileSync('scripts/fixtures/drill-library-snapshot.json', 'utf8'))

// ── 12-14. the backfill loses nothing and invents nothing ──────────────────

const withVideo = LIBRARY.filter(d => videoIdFor(d) || d.youtube_url)
const built = LIBRARY.map(mediaRowFor).filter(Boolean) as any[]

check('every drill that has a video produces exactly one media row',
  built.length === withVideo.length,
  `${built.length} rows for ${withVideo.length} drills with video`)

const lostIds = withVideo.filter(d => {
  const row = built.find(r => r.drill_id === d.id)
  return !row || (videoIdFor(d) && row.external_id !== videoIdFor(d))
})
check('every YouTube id survives the backfill unchanged', lostIds.length === 0,
  lostIds.map(d => d.drill_name).join(', '))

const urlLost = withVideo.filter(d => {
  const row = built.find(r => r.drill_id === d.id)
  const id = videoIdFor(d)
  return !row || !String(row.url || '').includes(String(id || d.youtube_url))
})
check('every URL still points at the same video', urlLost.length === 0,
  urlLost.map(d => d.drill_name).slice(0, 5).join(', '))

const startWrong = withVideo.filter(d => {
  const row = built.find(r => r.drill_id === d.id)!
  const want = d.youtube_start_seconds == null ? null : Number(d.youtube_start_seconds)
  return (row.start_seconds ?? null) !== want
})
check('start_seconds is preserved exactly, null included', startWrong.length === 0,
  startWrong.map(d => d.drill_name).slice(0, 5).join(', '))

const provWrong = withVideo.filter(d => {
  const row = built.find(r => r.drill_id === d.id)!
  return (row.start_source ?? null) !== (d.youtube_start_source ?? null)
})
check('timestamp provenance is preserved exactly', provWrong.length === 0)

// The specific mistake the brief names. Today the whole library is null here,
// so this is the assertion that catches a "sensible default" being added later.
const invented = built.filter(r => r.start_seconds === 0)
// Number(null) is 0, so this has to test the raw value, not a coercion of it.
// Getting that wrong here would have asserted that 208 null starts were zeros
// and quietly passed a backfill that invented 208 timestamps.
const sourceZeros = LIBRARY.filter(d =>
  d.youtube_start_seconds !== null && d.youtube_start_seconds !== undefined &&
  Number(d.youtube_start_seconds) === 0).length
check('no timestamp is invented — a null start never becomes 0',
  invented.length === sourceZeros,
  `${invented.length} rows start at 0 but only ${sourceZeros} source rows do`)

check('...and the library today has no timestamps at all, so none may appear',
  sourceZeros === 0 && invented.length === 0,
  `${sourceZeros} source zeros, ${invented.length} written`)

check('a timestamp is never mistaken for a verified timestamp',
  built.every(r => r.verification_status === 'unverified'),
  'having a number is not the same as somebody having checked it')

check('every backfilled row is its drill\'s primary', built.every(r => r.is_primary === true))

const dupKeys = built.map(r => `${r.drill_id}|${r.url}|${r.start_seconds ?? -1}`)
check('the backfill produces no duplicate attachment',
  new Set(dupKeys).size === dupKeys.length,
  'the unique index would reject these on a second run')

// ── 16. a drill with no media still works ──────────────────────────────────

const noMedia = LIBRARY.filter(d => !videoIdFor(d) && !d.youtube_url)
check('the library really does contain drills with no video at all',
  noMedia.length > 0, `${noMedia.length}`)
check('a drill with no media produces no media row',
  noMedia.every(d => mediaRowFor(d) === null))
check('...and still renders, as a drill with nothing to watch',
  noMedia.every(d => mediaForDrill(d, []).length === 0 && primaryMediaFor(d, []) === null))
check('...and hasAnyMedia says so rather than throwing',
  noMedia.every(d => hasAnyMedia(d, null) === false))

// ── 15. multiple media can attach to one drill ─────────────────────────────

const DRILL = { id: 'd1', drill_name: 'Front Toss', youtube_video_id: 'q7CPS0RYDPM', youtube_url: null }
const many: DrillMedia[] = [
  { drill_id: 'd1', media_type: 'article', url: 'https://example.com/a', id: 'm3' },
  { drill_id: 'd1', media_type: 'youtube', url: 'https://youtu.be/q7CPS0RYDPM', external_id: 'q7CPS0RYDPM', id: 'm1', is_primary: true },
  { drill_id: 'd1', media_type: 'instagram', url: 'https://instagram.com/p/x', id: 'm2' },
  { drill_id: 'd1', media_type: 'illustration', url: 'https://example.com/i.png', id: 'm4' },
]
const rendered = mediaForDrill(DRILL, many)
check('one drill can carry youtube, instagram, article and illustration at once',
  rendered.length === 4,
  `${rendered.length}: ${rendered.map(r => r.media_type).join(', ')}`)
check('the primary leads the list', rendered[0].media_type === 'youtube')
check('...and primaryMediaFor agrees with it',
  primaryMediaFor(DRILL, many)?.url === rendered[0].url)
check('the legacy video is not appended a second time',
  rendered.filter(r => r.url.includes('q7CPS0RYDPM')).length === 1,
  'a backfilled drill would otherwise show its one video twice')

// ── choosing is deterministic ──────────────────────────────────────────────

const shuffled = [many[3], many[0], many[1], many[2]]
check('pickPrimary does not depend on row order',
  pickPrimary(many)?.id === pickPrimary(shuffled)?.id)
check('a verified row beats an unverified one',
  pickPrimary([
    { drill_id: 'd', media_type: 'youtube', url: 'https://a', id: 'a' },
    { drill_id: 'd', media_type: 'youtube', url: 'https://b', id: 'b', verification_status: 'verified' },
  ])?.id === 'b')
check('a rejected link is never chosen over a working one',
  pickPrimary([
    { drill_id: 'd', media_type: 'youtube', url: 'https://a', id: 'a', is_primary: true, verification_status: 'rejected' },
    { drill_id: 'd', media_type: 'article', url: 'https://b', id: 'b' },
  ])?.id === 'b')
check('a drill whose only link is rejected shows nothing, not the bad link',
  pickPrimary([{ drill_id: 'd', media_type: 'youtube', url: 'https://a', id: 'a', verification_status: 'rejected' }]) === null)

// ── YouTube URL construction is not duplicated ─────────────────────────────

const timed = toPlayable({ drill_id: 'd', media_type: 'youtube', url: 'https://www.youtube.com/watch?v=abc12345678', external_id: 'abc12345678', start_seconds: 95 })
// `!!timed &&` rather than `timed?.` — an optional chain on a null would make
// this pass by returning undefined, which is a test that cannot fail.
check('a segment start reaches the link', !!timed && timed.url.includes('t=95s'), timed?.url)
check('...and there is only ever one t= parameter',
  (timed?.url.match(/[?&]t=/g) || []).length === 1,
  'YouTube honours the first, so a second is a silent wrong answer')
const untimed = toPlayable({ drill_id: 'd', media_type: 'youtube', url: 'https://www.youtube.com/watch?v=abc12345678', external_id: 'abc12345678' })
check('no start means no time parameter at all', !untimed?.url.includes('t='), untimed?.url)
check('a null start stays null on the way out, never 0', untimed?.start_seconds === null)

const article = toPlayable({ drill_id: 'd', media_type: 'article', url: 'https://example.com/x?t=5' })
check('a non-YouTube url is used exactly as stored',
  article?.url === 'https://example.com/x?t=5')

// ── the legacy fallback keeps Player Reports clickable ─────────────────────

const legacyDrill = LIBRARY.find(d => videoIdFor(d))!
const lp = legacyPlayable(legacyDrill)
check('a drill with no media rows still yields a clickable link from the legacy columns',
  !!lp && lp.url.startsWith('http') && lp.legacy === true, lp?.url)
check('...carrying the channel as its source', lp?.source_name === (legacyDrill.channel ?? null))
check('...and 0-or-absent reported as unknown rather than as a start time',
  lp?.start_seconds === null)
check('mediaForDrill falls back to it when there are no media rows',
  mediaForDrill(legacyDrill, []).length === 1 &&
  mediaForDrill(legacyDrill, null)[0].legacy === true)

console.log(`\n${LIBRARY.length} curated rows, ${withVideo.length} with video, ${noMedia.length} without.`)
console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
