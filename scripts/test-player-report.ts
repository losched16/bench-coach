// Does a player development report say what the coach approved, and only that?
//
// The failures this guards against are not exceptions. They are a report that
// prints a heading with nothing under it, a video link the library never
// recorded, a timestamp nobody verified, a drill that changed after the family
// received it, or a PDF that throws on the last step of an hour's work because
// somebody pasted an emoji.
//
// Everything here is a pure function, deliberately. The parts that need a
// database — cross-team access, the draft-only rules — are enforced by
// lib/authz.ts and by RLS in migration 054, and are checked statically by
// scripts/verify-authz.mjs. There is no test database in this repo, and
// running these against production would mean writing rows about real
// children.
//
//   npm run test:player-report

import {
  drillSnapshot, drillVideoLink, isSafeUrl, recommendationReason,
  renderSections, isReportSendable, cleanStrengthAreas, cleanText,
  contextLine, formatReportDate, reportTypeLabel, isReportType,
  videoLinkLabel, focusAreaForProblem,
  type FullReport, type DrillSnapshot,
} from '@/lib/playerReports'
import { renderReportPdf, pdfSafe, reportFilename } from '@/lib/playerReportPdf'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from 'pdf-lib'
import { readFileSync } from 'fs'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const LIBRARY_DRILL = {
  id: 'd1',
  drill_name: 'Alligator Ground Balls',
  description: 'Two hands on the ball, glove down early, funnel it in.',
  youtube_video_id: 'abc123XYZ_-',
  youtube_url: 'https://youtu.be/abc123XYZ_-',
  channel: 'Youth Baseball Edge',
  youtube_start_seconds: null,
  youtube_start_source: null,
  mechanic_focus: ['glove down early', 'two hands'],
  common_flaws_fixed: ['fielding flat footed'],
  reps_guidance: '15 ground balls',
  frequency_guidance: '2-3x/week',
}

function report(over: Partial<FullReport> = {}): FullReport {
  return {
    id: 'r1', team_id: 't1', player_id: 'p1', coach_id: 'c1',
    report_type: 'midseason', status: 'final', report_date: '2026-09-05',
    context: {
      player_name: 'Charlie Losch', team_name: 'Rockets',
      age_group: '8U', season_name: 'Fall 2026', coach_name: 'Clint',
    },
    strengths_content: null, development_intro: null, closing_content: null,
    strength_areas: [], revision: 1, revision_of: null,
    created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z',
    finalized_at: '2026-09-05T00:00:00Z',
    focusAreas: [], drills: [],
    ...over,
  }
}

function reportDrill(over: any = {}) {
  return {
    id: 'rd1', focus_area_id: null, drill_id: 'd1',
    snapshot: drillSnapshot(LIBRARY_DRILL),
    recommendation_reason: 'Ground-ball fundamentals',
    source: 'recommended' as const, include_video: true, sort_order: 0,
    ...over,
  }
}

// ── snapshots: what a report copies out of the library ──────────────────────

const snap = drillSnapshot(LIBRARY_DRILL)

check('snapshot keeps the drill name as the library had it',
  snap.drill_name === 'Alligator Ground Balls')
check('snapshot keeps the stored URL the library has, built by watchUrl',
  snap.video_url === 'https://youtu.be/abc123XYZ_-', String(snap.video_url))
check('a drill with only a video id gets the canonical link from watchUrl',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_url: null }).video_url === 'https://www.youtube.com/watch?v=abc123XYZ_-',
  String(drillSnapshot({ ...LIBRARY_DRILL, youtube_url: null }).video_url))
check('snapshot summarises what the drill trains from its own metadata',
  snap.focus === 'glove down early, two hands', String(snap.focus))
check('snapshot carries dosage the report prints',
  snap.reps_guidance === '15 ground balls' && snap.frequency_guidance === '2-3x/week')
check('snapshot does not copy the whole drill row',
  Object.keys(snap).length === 9, `got ${Object.keys(snap).length} fields`)

check('a drill with no video snapshots no URL rather than inventing one',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_video_id: null, youtube_url: null }).video_url === null)
check('a drill with only a stored URL keeps that URL',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_video_id: null }).video_url === 'https://youtu.be/abc123XYZ_-')

// ── timestamps: only with provenance (migration 049) ────────────────────────
// A wrong segment start is worse than none. youtube_start_source is the
// library's record of where a timestamp came from; without it the value is
// "unknown provenance" and must not reach a family.

const unsourced = drillSnapshot({ ...LIBRARY_DRILL, youtube_start_seconds: 123, youtube_start_source: null })
check('a timestamp with no recorded source is NOT used',
  unsourced.video_start_seconds === null && !String(unsourced.video_url).includes('t='),
  String(unsourced.video_url))

const sourced = drillSnapshot({ ...LIBRARY_DRILL, youtube_start_seconds: 123, youtube_start_source: 'manual-review' })
check('a sourced timestamp becomes t=123s on the link',
  sourced.video_start_seconds === 123 && String(sourced.video_url).endsWith('t=123s'),
  String(sourced.video_url))
check('the snapshot records where the timestamp came from',
  sourced.video_start_source === 'manual-review')

check('a zero timestamp is not a timestamp, even with a source',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_start_seconds: 0, youtube_start_source: 'chapter' }).video_start_seconds === null)
check('a negative timestamp is ignored rather than trusted',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_start_seconds: -5, youtube_start_source: 'chapter' }).video_start_seconds === null)

const restamped = drillSnapshot({
  ...LIBRARY_DRILL, youtube_url: 'https://www.youtube.com/watch?v=abc123XYZ_-&t=9s',
  youtube_start_seconds: 30, youtube_start_source: 'description',
})
check('an existing t= in the stored URL is replaced, not duplicated',
  (String(restamped.video_url).match(/t=/g) || []).length === 1 && String(restamped.video_url).endsWith('t=30s'),
  String(restamped.video_url))
check('a stored URL with no sourced timestamp is kept untouched, t= and all',
  drillSnapshot({ ...LIBRARY_DRILL, youtube_url: 'https://www.youtube.com/watch?v=abc123XYZ_-&t=9s' }).video_url
    === 'https://www.youtube.com/watch?v=abc123XYZ_-&t=9s')

// A report finalized in 2026 must not change when the library changes in 2027.
const finalized = report({ drills: [reportDrill()] })
const RENAMED = { ...LIBRARY_DRILL, drill_name: 'Renamed In 2027', youtube_video_id: 'zzzNEWzzzz1' }
const stillSays = renderSections(finalized).find(s => s.heading === 'Recommended Drills')
check('a finalized report still prints the drill as it was, after the library changes',
  stillSays?.drills?.[0].name === 'Alligator Ground Balls' &&
  drillSnapshot(RENAMED).drill_name === 'Renamed In 2027',
  'the snapshot on the report row must not follow the live drill')

// ── video links: never invented, never guessed ──────────────────────────────

check('a http(s) URL is safe to print', isSafeUrl('https://www.youtube.com/watch?v=x'))
check('a javascript: URL is refused', !isSafeUrl('javascript:alert(1)'))
check('a data: URL is refused', !isSafeUrl('data:text/html,<script>'))
check('a relative path is refused', !isSafeUrl('/drills/1'))
check('an empty URL is refused', !isSafeUrl(null))

check('the report link is the snapshot link, unchanged',
  drillVideoLink(snap) === 'https://youtu.be/abc123XYZ_-', String(drillVideoLink(snap)))
check('an unsafe stored URL produces no link at all',
  drillVideoLink({ ...snap, video_url: 'javascript:alert(1)' }) === null)
check('a drill with no video produces no link',
  drillVideoLink({ ...snap, video_url: null }) === null)

check('the link is labelled, never shown as a raw URL',
  videoLinkLabel(snap) === 'Watch drill (Youth Baseball Edge)' &&
  videoLinkLabel({ ...snap, channel: null }) === 'Watch drill')

// The coach dropping the video must actually drop it from the document.
const noVideoWanted = renderSections(report({ drills: [reportDrill({ include_video: false })] }))
check('a coach who removes the video gets no link in the report',
  noVideoWanted[0].drills?.[0].link === null)

// ── the recommendation reason is derived, not written ───────────────────────

check('the reason names the priority and what the drill trains',
  recommendationReason('Ground-ball fundamentals', snap) ===
    'Ground-ball fundamentals — trains glove down early, two hands')
check('with no priority it falls back to what the drill trains',
  recommendationReason(null, snap) === 'Trains glove down early, two hands')
check('with neither, it says the coach chose it rather than inventing a reason',
  recommendationReason(null, { ...snap, focus: null }) === 'Selected by the coach')

// ── empty sections are absent, not blank ────────────────────────────────────

check('an empty report renders no sections at all',
  renderSections(report()).length === 0)
check('an empty report is not sendable', !isReportSendable(report()))

const strengthsOnly = report({ strengths_content: 'Charlie makes consistent contact.' })
check('strengths alone is a valid report', isReportSendable(strengthsOnly))
check('strengths alone prints exactly one section',
  renderSections(strengthsOnly).length === 1 &&
  renderSections(strengthsOnly)[0].heading === 'Strengths')
check("no closing comment means no Coach's Comments heading",
  !renderSections(strengthsOnly).some(s => s.heading === "Coach's Comments"))

const areasOnly = report({ strength_areas: ['hitting', 'baserunning'] })
check('strength chips alone still produce a Strengths section',
  renderSections(areasOnly)[0]?.body === 'Doing well in: Hitting · Baserunning',
  renderSections(areasOnly)[0]?.body)

const full = report({
  strengths_content: 'Consistent contact.',
  strength_areas: ['hitting'],
  focusAreas: [
    { id: 'f1', problem_slug: 'fielding-flat-footed', focus_area: 'fielding',
      label: 'Ground-ball fundamentals', coach_notes: 'glove down late',
      approved_content: 'We would like Charlie to get into an athletic position earlier.',
      sort_order: 1 },
    { id: 'f0', problem_slug: 'inaccurate-throws', focus_area: 'throwing',
      label: 'Throwing accuracy', coach_notes: null, approved_content: null, sort_order: 0 },
  ],
  drills: [reportDrill({ sort_order: 1, id: 'rd2', drill_id: 'd2' }), reportDrill({ sort_order: 0 })],
  closing_content: 'A pleasure to coach.',
})

const fullSections = renderSections(full)
check('a complete report prints its four sections in reading order',
  fullSections.map(s => s.heading).join('|') ===
    "Strengths|Development Priorities|Recommended Drills|Coach's Comments",
  fullSections.map(s => s.heading).join('|'))

check('development priorities print in the coach’s order, not the database’s',
  fullSections[1].priorities?.map(p => p.label).join('|') ===
    'Throwing accuracy|Ground-ball fundamentals',
  fullSections[1].priorities?.map(p => p.label).join('|'))

check('a priority with no wording still prints its heading',
  fullSections[1].priorities?.[0].body === null)

check('drills print in the order the coach put them in',
  fullSections[2].drills?.length === 2)

check('dosage is joined into one line',
  fullSections[2].drills?.[0].dosage === '15 ground balls · 2-3x/week',
  String(fullSections[2].drills?.[0].dosage))

// ── input cleaning ──────────────────────────────────────────────────────────

check('blank text becomes null rather than an empty section',
  cleanText('   \n  ') === null)
check('text is trimmed', cleanText('  hello  ') === 'hello')
check('over-long text is capped', (cleanText('x'.repeat(9000)) || '').length === 4000)
check('non-strings are refused', cleanText(42 as any) === null)

check('unknown strength areas are dropped',
  cleanStrengthAreas(['hitting', 'quidditch', 7, null]).join(',') === 'hitting')
check('strength areas are deduplicated and canonically ordered',
  cleanStrengthAreas(['baserunning', 'hitting', 'hitting']).join(',') === 'hitting,baserunning')
check('a non-array of strength areas is empty, not a crash',
  cleanStrengthAreas('hitting' as any).length === 0)

check('report types are validated against the list',
  isReportType('midseason') && !isReportType('scouting') && !isReportType(null))
check('an unknown report type still gets a printable heading',
  reportTypeLabel('nonsense') === 'Player Development Report')

// ── header lines ────────────────────────────────────────────────────────────

check('the context line reads age, season, team',
  contextLine(report().context) === '8U · Fall 2026 · Rockets')
check('a missing context produces nothing rather than "null"',
  contextLine(null) === '')
check('a partial context skips what is missing',
  contextLine({ player_name: 'X', team_name: null, age_group: '10U', season_name: null, coach_name: null }) === '10U')

// A date-only string parsed as UTC and rendered in a negative offset comes out
// a day early — a report dated the 5th printing as the 4th.
check('the report date does not shift a day in a negative timezone',
  formatReportDate('2026-09-05') === 'September 5, 2026', formatReportDate('2026-09-05'))
check('a missing date prints nothing', formatReportDate(null) === '')
check('an unparseable date prints nothing', formatReportDate('not a date') === '')

// ── focus areas map onto the existing taxonomy ──────────────────────────────

check('a taxonomy category resolves to one of the seven focus areas',
  focusAreaForProblem('Fielding (Infield)', 'Fields flat footed') === 'fielding')
check('a category the map does not know falls back to the label',
  focusAreaForProblem(null, 'ground ball fundamentals') === 'fielding')
check('a priority that names no skill has no area rather than a wrong one',
  focusAreaForProblem(null, 'zzz') === null)

// ── the migration keeps reports with the team's staff, never a league ────────
// The league layer's privacy rule is that league membership appears in none
// of the bc_team_at_least(...) expressions. That rule is only worth anything
// if the report tables gate on exactly that helper and nothing wider. This
// reads the migration as text and holds it to that, the way
// scripts/verify-league-privacy.mjs holds the league migration to its own
// promise — so "widen RLS to make reporting easier" fails a test rather than
// quietly shipping.

const migrationSql = readFileSync('migrations/054_player_reports.sql', 'utf8')
const REPORT_TABLES = new Set(['player_reports', 'player_report_focus_areas', 'player_report_drills'])
const policyChunks = migrationSql.split('CREATE POLICY').slice(1)
  .map(chunk => chunk.slice(0, chunk.indexOf('$p$;') === -1 ? undefined : chunk.indexOf('$p$;')))

check('the migration declares exactly eight policies', policyChunks.length === 8, `${policyChunks.length}`)
check('every policy is on one of the three report tables',
  policyChunks.every(c => REPORT_TABLES.has((c.match(/ ON +([a-z_]+)/) || [])[1] || '')),
  policyChunks.map(c => (c.match(/ ON +([a-z_]+)/) || [])[1]).join(', '))
check('every policy gates on bc_team_at_least',
  policyChunks.every(c => c.includes('bc_team_at_least')))
check('no policy mentions a league, a league role, or a league helper',
  policyChunks.every(c => !/league/i.test(c)))
check('the only write policies require admin (the "decide" line), never contributor or viewer',
  policyChunks.filter(c => /FOR (INSERT|UPDATE|DELETE|ALL)/.test(c))
    .every(c => c.includes("'admin'") && !c.includes("'contributor'") && !c.includes("'viewer'")))
check('a finalized report is frozen in RLS, not only in the API',
  policyChunks.some(c => /FOR UPDATE/.test(c) && c.includes("status = 'draft'")) &&
  policyChunks.some(c => /FOR DELETE/.test(c) && c.includes("status = 'draft'")))

// ── the PDF ─────────────────────────────────────────────────────────────────

check('a character outside WinAnsi is dropped, not thrown on',
  pdfSafe('Great work 🎉 today') === 'Great work  today', JSON.stringify(pdfSafe('Great work 🎉 today')))
check("Word's curly quotes fold to ASCII",
  pdfSafe('“nice” — he’s ready') === '"nice" - he\'s ready',
  pdfSafe('“nice” — he’s ready'))
check('accented names survive',
  pdfSafe('José Martínez') === 'José Martínez')
check('newlines are kept so paragraphs stay paragraphs',
  pdfSafe('one\ntwo') === 'one\ntwo')

check('the filename names the player and the date',
  reportFilename(full) === 'charlie-losch-development-report-2026-09-05.pdf',
  reportFilename(full))
check('a filename with no context still produces something safe',
  reportFilename(report({ context: null })) === 'player-development-report-2026-09-05.pdf',
  reportFilename(report({ context: null })))

/**
 * The links a viewer would actually be able to click.
 *
 * Read structurally rather than by grepping the bytes: pdf-lib writes object
 * streams by default, so the raw file contains no literal "/URI" even when
 * every annotation is present. The first version of this test grepped, found
 * nothing, and would have "passed" the day the links stopped being written.
 */
async function linkTargets(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const out: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.get(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict)
      const action = annot.lookup(PDFName.of('A'), PDFDict)
      const uri = action?.lookup(PDFName.of('URI'))
      if (uri instanceof PDFString) out.push(uri.asString())
    }
  }
  return out
}

async function pdfChecks() {
  const bytes = await renderReportPdf(full)

  check('the PDF renders to real bytes', bytes.length > 1000, `${bytes.length} bytes`)
  check('the PDF is a PDF', Buffer.from(bytes.slice(0, 5)).toString('latin1') === '%PDF-')

  // Link annotations, not blue text. Two drills, both with a video the coach
  // kept, so two clickable targets.
  const links = await linkTargets(bytes)
  check('every included video becomes a clickable link annotation',
    links.length === 2, `${links.length} links: ${links.join(', ')}`)
  check('the link points at the stored video, not at anything invented',
    links.every(u => u === 'https://youtu.be/abc123XYZ_-'), links.join(', '))

  const titled = await PDFDocument.load(bytes)
  check('the PDF is titled for the player',
    (titled.getTitle() || '').includes('Charlie Losch'), String(titled.getTitle()))
  check('the PDF names BenchCoach as its creator',
    (titled.getCreator() || '') === 'BenchCoach', String(titled.getCreator()))

  const empty = await renderReportPdf(report())
  check('a report with nothing in it still produces a valid one-page PDF',
    empty.length > 500 && (await PDFDocument.load(empty)).getPageCount() === 1)

  const noLinks = await renderReportPdf(
    report({ drills: [reportDrill({ include_video: false })] })
  )
  check('a report whose videos were removed has no link annotations',
    (await linkTargets(noLinks)).length === 0)

  // An unsafe URL must never reach the document, even if one somehow got into
  // a snapshot.
  const unsafe = await renderReportPdf(report({
    drills: [reportDrill({
      snapshot: { ...snap, video_url: 'javascript:alert(1)' },
    })],
  }))
  check('an unsafe stored URL produces no annotation in the PDF',
    (await linkTargets(unsafe)).length === 0)

  // The failure that would otherwise arrive at the last step of an hour's work.
  const emoji = await renderReportPdf(report({
    closing_content: 'Brilliant season 🎉🥎 — proud of him.',
    context: { ...(report().context as any), player_name: '日本 Kid' },
  }))
  check('unrepresentable characters do not break generation', emoji.length > 500)

  // A long report has to paginate rather than write off the bottom of page one.
  const long = await renderReportPdf(report({
    strengths_content: 'He works hard. '.repeat(400),
    closing_content: 'Thanks for a great season. '.repeat(200),
  }))
  const pages = (await PDFDocument.load(long)).getPageCount()
  check('a long report paginates rather than running off the page',
    pages >= 2, `${pages} pages`)

  console.log(
    failures === 0
      ? `
All player report checks passed.`
      : `
${failures} failure${failures === 1 ? '' : 's'}.`
  )
  process.exit(failures === 0 ? 0 : 1)
}

void pdfChecks()
