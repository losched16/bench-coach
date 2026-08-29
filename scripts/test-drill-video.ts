// Does a drill's video open where the drill actually is?
//
// Two different things are checked here and they must not be confused, because
// confusing them is how this phase could be declared finished when it is not:
//
//   THE MECHANISM — given a segment start, does every surface use it? This is
//   code, it is fully testable, and it is what this phase delivered.
//
//   THE DATA — do the drills actually have segment starts? This is curation,
//   it requires watching the videos, and it has NOT been done. The assertions
//   at the bottom record that as a measured fact rather than letting it pass
//   quietly.
//
// A test that says "the timestamp field exists" would pass today and mean
// nothing to a coach. So the data section asserts the CURRENT state out loud,
// and is written to fail the moment curation starts, forcing the numbers in
// the report to be updated with it.
//
//   npm run test:drill-video

import { readFileSync } from 'fs'
import {
  videoIdFor, parseVideoId, startSecondsFor, hasSegment, hasVideo,
  watchUrl, embedUrl, thumbnailUrl, formatTimestamp, parseTimestamp,
  parseStartFromUrl,
} from '@/lib/drillVideo'
import { rankDrills, RetrievalConstraints } from '@/lib/drillRetrieval'
import { diagnoseByAlias, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'
import { computeBudget, schedulePractice, estimateBlockCount, isRedundant } from '@/lib/practiceScheduler'
// @ts-ignore -- plain ESM, no types
import { estimateAll } from './estimate-drill-durations.mjs'

let passed = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, actual: any, expected: any) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings
const { rows } = estimateAll(FIX.drills)
const MINUTES = new Map<string, number>(rows.map((r: any) => [r.drill.id, r.est.minutes]))
const DRILLS = FIX.drills.map((d: any) => ({ ...d, est_duration_minutes: MINUTES.get(d.id) }))
const byName = (n: string) => DRILLS.find((d: any) => d.drill_name === n)

// ---------------------------------------------------------------------------
// 1. Video identity
// ---------------------------------------------------------------------------
eq('id from the column', videoIdFor({ youtube_video_id: 'dQw4w9WgXcQ' }), 'dQw4w9WgXcQ')
eq('id from a watch URL', parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
eq('id from a watch URL with params first', parseVideoId('https://www.youtube.com/watch?feature=x&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
eq('id from a short URL', parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=30'), 'dQw4w9WgXcQ')
eq('id from an embed URL', parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
eq('id from a shorts URL', parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
eq('no id from nothing', parseVideoId(null), null)
eq('no id from a non-YouTube URL', parseVideoId('https://vimeo.com/12345'), null)
eq('id falls back to the URL', videoIdFor({ youtube_url: 'https://youtu.be/dQw4w9WgXcQ' }), 'dQw4w9WgXcQ')
eq('no drill, no id', videoIdFor(null), null)
ok('hasVideo is true with an id', hasVideo({ youtube_video_id: 'dQw4w9WgXcQ' }))
ok('hasVideo is false with nothing', !hasVideo({}))

// ---------------------------------------------------------------------------
// 2. Segment start normalization
//
// Everything unusable must collapse to 0. A negative or non-finite value in a
// start= parameter does not degrade gracefully — YouTube fails the entire
// embed rather than ignoring it, so the player goes blank.
// ---------------------------------------------------------------------------
eq('a real start', startSecondsFor({ youtube_start_seconds: 252 }), 252)
eq('null is the beginning', startSecondsFor({ youtube_start_seconds: null }), 0)
eq('undefined is the beginning', startSecondsFor({}), 0)
eq('zero is the beginning', startSecondsFor({ youtube_start_seconds: 0 }), 0)
eq('negative is the beginning', startSecondsFor({ youtube_start_seconds: -30 }), 0)
eq('NaN is the beginning', startSecondsFor({ youtube_start_seconds: NaN }), 0)
eq('Infinity is the beginning', startSecondsFor({ youtube_start_seconds: Infinity }), 0)
eq('a fraction is floored', startSecondsFor({ youtube_start_seconds: 252.7 }), 252)
ok('hasSegment is false at zero', !hasSegment({ youtube_start_seconds: 0 }))
ok('hasSegment is true past zero', hasSegment({ youtube_start_seconds: 1 }))

// ---------------------------------------------------------------------------
// 3. URL construction
// ---------------------------------------------------------------------------
eq('watch URL from an id',
  watchUrl({ youtube_video_id: 'abc12345678' }), 'https://www.youtube.com/watch?v=abc12345678')
eq('watch URL carries the segment',
  watchUrl({ youtube_video_id: 'abc12345678', youtube_start_seconds: 252 }),
  'https://www.youtube.com/watch?v=abc12345678&t=252s')
eq('a stored URL gains the segment',
  watchUrl({ youtube_url: 'https://youtu.be/abc12345678', youtube_start_seconds: 90 }),
  'https://youtu.be/abc12345678?t=90s')
eq('a stored URL with no segment is untouched',
  watchUrl({ youtube_url: 'https://youtu.be/abc12345678?t=45s' }),
  'https://youtu.be/abc12345678?t=45s')
eq('an existing t= is replaced, not duplicated',
  watchUrl({ youtube_url: 'https://www.youtube.com/watch?v=abc12345678&t=10s', youtube_start_seconds: 252 }),
  'https://www.youtube.com/watch?v=abc12345678&t=252s')
ok('never two time parameters',
  (watchUrl({ youtube_url: 'https://www.youtube.com/watch?v=abc12345678&t=10s', youtube_start_seconds: 252 })!
    .match(/[?&]t=/g) || []).length === 1)
eq('no video, no URL', watchUrl({}), null)

eq('embed URL from an id',
  embedUrl({ youtube_video_id: 'abc12345678' }),
  'https://www.youtube-nocookie.com/embed/abc12345678?rel=0')
eq('embed URL carries the segment',
  embedUrl({ youtube_video_id: 'abc12345678', youtube_start_seconds: 252 }),
  'https://www.youtube-nocookie.com/embed/abc12345678?rel=0&start=252')
eq('embed URL with autoplay',
  embedUrl({ youtube_video_id: 'abc12345678', youtube_start_seconds: 252 }, { autoplay: true }),
  'https://www.youtube-nocookie.com/embed/abc12345678?rel=0&start=252&autoplay=1')
ok('a bad start never reaches the embed',
  !embedUrl({ youtube_video_id: 'abc12345678', youtube_start_seconds: -5 })!.includes('start='))
eq('no video, no embed', embedUrl({}), null)

eq('thumbnail from an id',
  thumbnailUrl({ youtube_video_id: 'abc12345678' }), 'https://img.youtube.com/vi/abc12345678/hqdefault.jpg')
eq('stored thumbnail wins',
  thumbnailUrl({ youtube_video_id: 'abc12345678', thumbnail_url: 'https://cdn/x.jpg' }), 'https://cdn/x.jpg')

// ---------------------------------------------------------------------------
// 4. Timestamps in and out of URLs and human input
// ---------------------------------------------------------------------------
eq('t= in seconds', parseStartFromUrl('https://youtu.be/abc12345678?t=252'), 252)
eq('t= with an s suffix', parseStartFromUrl('https://youtu.be/abc12345678?t=252s'), 252)
eq('t= in m/s form', parseStartFromUrl('https://youtu.be/abc12345678?t=4m12s'), 252)
eq('t= in h/m/s form', parseStartFromUrl('https://youtu.be/abc12345678?t=1h2m5s'), 3725)
eq('start= is read too', parseStartFromUrl('https://youtu.be/abc12345678?start=90'), 90)
eq('no time parameter', parseStartFromUrl('https://youtu.be/abc12345678'), 0)
eq('no URL at all', parseStartFromUrl(null), 0)

eq('format m:ss', formatTimestamp(252), '4:12')
eq('format h:mm:ss', formatTimestamp(3725), '1:02:05')
eq('format zero', formatTimestamp(0), '0:00')
eq('format null', formatTimestamp(null), '0:00')

eq('parse m:ss', parseTimestamp('4:12'), 252)
eq('parse h:mm:ss', parseTimestamp('1:02:05'), 3725)
eq('parse bare seconds', parseTimestamp('252'), 252)
eq('parse a number', parseTimestamp(252), 252)
eq('refuse a typo rather than guess', parseTimestamp('4:1x'), null)
eq('refuse impossible seconds', parseTimestamp('4:75'), null)
eq('refuse empty', parseTimestamp(''), null)
ok('round trip', parseTimestamp(formatTimestamp(3725)) === 3725)

// ---------------------------------------------------------------------------
// 5. THE MECHANISM: drills sharing a video may open in different places
//
// This is the property the whole phase exists to make possible. Asserted
// against the real production rows for the curated hitting progression, with
// timestamps applied in memory.
// ---------------------------------------------------------------------------
// A correction to the Phase 2C write-up, which said this progression all came
// off one film. It does not: Tee Work and Low Tee share q7CPS0RYDPM, and Line
// Drive Pro is on UeJpXF55kvs. The pair is what matters for this test, and the
// third is kept because the practice a coach gets contains all three.
const PROGRESSION = ['Tee Work', 'Low Tee', 'Line Drive Pro / Visual Feedback Swing Drill']
const prog = PROGRESSION.map(byName)
ok('the curated hitting progression is in the library', prog.every(Boolean))
eq('Tee Work and Low Tee share a video',
  prog[0].youtube_video_id, prog[1].youtube_video_id)
ok('Line Drive Pro is on a different video',
  prog[2].youtube_video_id !== prog[0].youtube_video_id)

// Illustrative values only — NOT written to the library, NOT a curation claim.
const HYPOTHETICAL = [61, 184, 297]
const segmented = prog.map((d: any, i: number) => ({ ...d, youtube_start_seconds: HYPOTHETICAL[i] }))

const watchUrls = segmented.map(d => watchUrl(d))
const embeds = segmented.map(d => embedUrl(d))
eq('the three scheduled drills produce three distinct watch URLs',
  new Set(watchUrls).size, 3)
eq('and three distinct embeds', new Set(embeds).size, 3)
ok('each carries its own second count',
  watchUrls.every((u, i) => u!.includes(`t=${HYPOTHETICAL[i]}s`)))
ok('none of them opens at 0:00', watchUrls.every(u => !u!.endsWith('t=0s') && u!.includes('t=')))

// The pair sharing a video is the real test: undated, two DIFFERENT drills are
// the same URL. That is the current production state and the reason the phase
// exists — a coach tapping Low Tee and a coach tapping Tee Work go to the same
// place, at the same second, in a compilation containing both.
eq('undated, Tee Work and Low Tee are indistinguishable by URL',
  new Set([watchUrl(prog[0]), watchUrl(prog[1])]).size, 1)
eq('dated, they are not',
  new Set([watchUrl(segmented[0]), watchUrl(segmented[1])]).size, 2)

// The 19-drill compilation is the worst case in the library.
const nineteen = DRILLS.filter((d: any) => d.youtube_video_id === '4NOo7JSK6eA')
eq('one video really does back 19 drills', nineteen.length, 19)
eq('undated they share a single URL',
  new Set(nineteen.map((d: any) => watchUrl(d))).size, 1)
eq('dated, all 19 are distinct',
  new Set(nineteen.map((d: any, i: number) =>
    watchUrl({ ...d, youtube_start_seconds: 30 + i * 40 }))).size, 19)

// ---------------------------------------------------------------------------
// 6. Null/zero preserves the old behaviour exactly
// ---------------------------------------------------------------------------
for (const d of DRILLS.slice(0, 40)) {
  if (!d.youtube_video_id) continue
  const expected = d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`
  eq(`unsegmented drill links exactly as before: ${d.drill_name.slice(0, 30)}`,
    watchUrl(d), expected)
}

// ---------------------------------------------------------------------------
// 7. Chat and Practice Plan share the helper
// ---------------------------------------------------------------------------
const chatSrc = readFileSync('components/ChatMessageContent.tsx', 'utf8')
const planSrc = readFileSync('components/PlanCards.tsx', 'utf8')
const videoSrc = readFileSync('components/DrillVideo.tsx', 'utf8')
ok('chat imports the shared helper', chatSrc.includes("from '@/lib/drillVideo'"))
ok('chat builds its embed with it', /embedUrl\(/.test(chatSrc))
ok('chat reads the timestamp out of the URL it was given', /parseStartFromUrl\(/.test(chatSrc))
ok('practice plan cards import the shared helper', planSrc.includes("from '@/lib/drillVideo'"))
ok('practice plan links through it', /watchUrl\(/.test(planSrc))
ok('the video component builds through it', /embedUrl\(/.test(videoSrc))
ok('the video component no longer parses URLs itself',
  !videoSrc.includes('function extractVideoId'),
  'a second URL parser will drift from the first')

// ---------------------------------------------------------------------------
// 8. Retrieval and scheduling are untouched by any of this
//
// Same construction as the Phase 2B invariance test: run the library with and
// without segment starts and assert nothing about relevance or scheduling
// moves. A timestamp is presentation, and it must not become a ranking signal
// by accident.
// ---------------------------------------------------------------------------
const PROMPTS = [
  'My 8-year-old keeps dropping his back shoulder when he swings.',
  'My hitter is lunging forward.',
  'My shortstop has a slow transfer.',
  'How do I help my pitcher throw harder?',
  'general team practice',
  'hitting indoors in a small space',
]

// Every drill given a segment, so the field is uniformly populated rather than
// sparsely — the strongest version of the test.
const SEGMENTED = DRILLS.map((d: any, i: number) => ({
  ...d, youtube_start_seconds: 30 + (i % 17) * 11,
}))

function retrieveFor(library: any[], q: string) {
  const dx = diagnoseByAlias(q, PROBLEMS)
  const constraints: RetrievalConstraints = { ...constraintsFromText(q), playerAge: ageFromText(q) }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  return rankDrills(library, mapRows, {
    query: q, slugs: dx.slugs, categories: dx.categories, constraints, limit: 30,
  })
}

for (const q of PROMPTS) {
  const before = retrieveFor(DRILLS, q)
  const after = retrieveFor(SEGMENTED, q)
  const label = q.slice(0, 34)

  eq(`retrieval ids+order unchanged: "${label}"`,
    after.scored.map((s: any) => s.drill.id).join('|'),
    before.scored.map((s: any) => s.drill.id).join('|'))
  eq(`retrieval scores unchanged: "${label}"`,
    after.scored.map((s: any) => s.reason.score.toFixed(4)).join('|'),
    before.scored.map((s: any) => s.reason.score.toFixed(4)).join('|'))
  eq(`eligibility unchanged: "${label}"`,
    after.debug.candidateCountAfterFilters, before.debug.candidateCountAfterFilters)

  for (const minutes of [30, 60, 90]) {
    const budget = computeBudget(minutes, { blockCount: estimateBlockCount(minutes) })
    const a = schedulePractice({ candidates: before.scored, budget })
    const b = schedulePractice({ candidates: after.scored, budget })
    eq(`schedule unchanged at ${minutes}min: "${label}"`,
      b.items.map(i => i.drill.id).join('|'), a.items.map(i => i.drill.id).join('|'))
    eq(`scheduled minutes unchanged at ${minutes}min: "${label}"`, b.scheduledMinutes, a.scheduledMinutes)
  }
}

// Duplicate suppression must not start keying on the timestamp: two entries of
// the same drill are still the same drill whatever second they open at.
ok('redundancy is unaffected by segments',
  isRedundant(
    { ...byName('High Tee Drill — Hitting Up in the Zone'), youtube_start_seconds: 10 },
    { ...byName('High Tee'), youtube_start_seconds: 400 }
  ),
  'a duplicate pair stopped being detected once they had different start times')
ok('a real progression is still not suppressed',
  !isRedundant(
    { ...byName('Tee Work'), youtube_start_seconds: 61 },
    { ...byName('Low Tee'), youtube_start_seconds: 184 }
  ))

// ---------------------------------------------------------------------------
// 9. THE DATA: what the library actually holds today
//
// Deliberately asserted as the CURRENT state, so this fails the moment
// curation begins and the report numbers have to be updated with it. Passing
// here is not success — it is an accurate measurement of an unfinished job.
// ---------------------------------------------------------------------------
const withVideo = DRILLS.filter((d: any) => d.youtube_video_id)
const videoUse = new Map<string, number>()
for (const d of withVideo) videoUse.set(d.youtube_video_id, (videoUse.get(d.youtube_video_id) || 0) + 1)
const sharedAtZero = withVideo.filter((d: any) => (videoUse.get(d.youtube_video_id) || 0) > 1 && !hasSegment(d))

eq('library size', DRILLS.length, 206)
eq('drills with a video', withVideo.length, 205)
eq('unique videos', videoUse.size, 118)
eq('videos backing more than one drill', Array.from(videoUse.values()).filter(n => n > 1).length, 16)
eq('drills sharing a video', Array.from(videoUse.values()).filter(n => n > 1).reduce((s, n) => s + n, 0), 103)
eq('MEASURED: drills with a curated segment start', DRILLS.filter((d: any) => hasSegment(d)).length, 0)
eq('MEASURED: shared-video drills still opening at 0:00', sharedAtZero.length, 103)

// ---------------------------------------------------------------------------
console.log(`\ndrill video: ${passed} passed, ${failures.length} failed`)
console.log(
  `\n  mechanism: every surface applies youtube_start_seconds.\n` +
  `  data:      ${DRILLS.filter((d: any) => hasSegment(d)).length}/206 drills have one; ` +
  `${sharedAtZero.length} shared-video drills still open at 0:00.\n` +
  `  A coach does not benefit until that second number falls.`
)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  FAIL  ' + f)
  process.exit(1)
}
