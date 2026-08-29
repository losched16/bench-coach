// Which drills need a segment start, in the order worth doing them.
//
// 103 of the 206 drills share a video with at least one other, and one video
// backs nineteen separate drills. Every one of them currently opens at 0:00,
// so a coach tapping "Low Tee" gets a twelve-minute compilation from its
// opening titles and has to go find the bit you meant. That is the moment a
// recommendation stops feeling like a recommendation.
//
// WHY THIS IS A WORKSHEET AND NOT AN AUTOMATED FILL
//
// There is no timestamp evidence anywhere in this library and none reachable
// from here. Checked, exhaustively: youtube_start_seconds is 0/206, the
// duration column is empty on every row, no drill's description, coaching
// notes, reps guidance or safety notes contain a time of any format, no stored
// youtube_url carries a t= or start= parameter, and YouTube itself is blocked
// by this environment's network policy, so chapter markers and descriptions
// cannot be fetched either.
//
// A timestamp invented without watching the video would be a fabrication, and
// specifically the damaging kind: a WRONG segment start is worse than no
// segment start. At 0:00 a coach knows where they are and scrubs. Dropped
// forty seconds into a different drill, they conclude the link is broken and
// stop trusting the others.
//
// So this script does the half that can be done rigorously — work out exactly
// which drills need a timestamp and in what order — and produces a worksheet
// for someone who can actually watch the video. `ingest` then turns their
// answers into a migration, with provenance, and refuses anything malformed.
//
//   node scripts/curate-video-segments.mjs audit        the priority breakdown
//   node scripts/curate-video-segments.mjs worksheet    CSV to fill in
//   node scripts/curate-video-segments.mjs ingest <csv> emit migration 050
//
// Reads a drill export from disk. Writes nothing to the database, ever.

import { readFileSync, writeFileSync } from 'fs'

const SRC = process.env.DRILL_EXPORT || 'docs/audits/drill-library-production.json'

// Drills the Phase 2C evaluation actually schedules. These are the ones a
// coach meets first, which is what makes them P0 rather than merely shared.
const SCHEDULED_IN_2C = new Set([
  'Tee Work', 'Low Tee', 'Line Drive Pro / Visual Feedback Swing Drill',
  'One-Hand Tee Drill (Top Hand)',
  'The Hands Routine — Infield Fielding Drill', 'Infield Throwing Drill',
  'Groundball Transfer Catch', '4 High-Energy Infield Drills',
  '3 Great Outfield Drills for Youth Players', 'Outfield Drop Step Drill',
  '8 Baseball Warm-Up Exercises You Must Do',
  'Throwing Progression for Youth Players', 'Post-Throwing Recovery Routine',
  'Crow Hop — Arm Strength and Outfield Throwing',
  'Stride Pause to Stride Swing Drill', 'Tee Work — Ball Out In Front',
  '5 Essential Hitting Drills for Youth Baseball',
  'Stance & Athletic Position Drill', 'Little League Cuts & Relays System',
  'Indoor Team Pitching Drills', 'Youth Infield Drill (Practice Anywhere)',
  'Bunting with Lacrosse Stick', 'The Best Youth Infield Drill',
  'Selfies Solo Rebounder — Build Reps Without a Partner',
  'Sliding Practice Stations',
])

function load() {
  const raw = JSON.parse(readFileSync(SRC, 'utf8'))
  const drills = (Array.isArray(raw) ? raw : raw.drills)
    .filter(d => d.status === 'approved' || d.status == null)

  let curatedIds = new Set()
  try {
    const map = JSON.parse(readFileSync('docs/audits/drill-problem-map-production.json', 'utf8'))
    const rows = Array.isArray(map) ? map : (map.rows || map.mappings || [])
    curatedIds = new Set(rows.filter(r => r.curated).map(r => r.drill_id))
  } catch {
    // The map export is optional; without it P1 collapses into P2, which the
    // audit says out loud rather than silently mislabelling.
  }
  return { drills, curatedIds }
}

function analyse() {
  const { drills, curatedIds } = load()

  const byVideo = new Map()
  for (const d of drills) {
    if (!d.youtube_video_id) continue
    if (!byVideo.has(d.youtube_video_id)) byVideo.set(d.youtube_video_id, [])
    byVideo.get(d.youtube_video_id).push(d)
  }

  const rows = []
  for (const d of drills) {
    const vid = d.youtube_video_id
    const siblings = vid ? byVideo.get(vid).length : 0
    const shared = siblings > 1
    const atZero = !d.youtube_start_seconds
    const scheduled = SCHEDULED_IN_2C.has(d.drill_name)
    const curated = curatedIds.has(d.id)

    let priority
    if (!vid) priority = 'none'
    else if (shared && atZero && scheduled) priority = 'P0'
    else if (shared && atZero && curated) priority = 'P1'
    else if (shared && atZero) priority = 'P2'
    else if (atZero) priority = 'P3'
    else priority = 'done'

    rows.push({ drill: d, vid, siblings, shared, atZero, scheduled, curated, priority })
  }

  return { drills, byVideo, rows, haveCurated: curatedIds.size > 0 }
}

const ORDER = ['P0', 'P1', 'P2', 'P3', 'done', 'none']

function audit() {
  const { drills, byVideo, rows, haveCurated } = analyse()
  const shared = Array.from(byVideo.entries()).filter(([, v]) => v.length > 1)

  console.log(`Video segment audit — ${drills.length} approved drills\n`)
  console.log(`  unique videos ................. ${byVideo.size}`)
  console.log(`  shared videos (>1 drill) ...... ${shared.length}`)
  console.log(`  drills on a shared video ...... ${shared.reduce((s, [, v]) => s + v.length, 0)}`)
  console.log(`  single-drill videos ........... ${Array.from(byVideo.values()).filter(v => v.length === 1).length}`)
  console.log(`  drills with no video .......... ${drills.filter(d => !d.youtube_video_id).length}`)
  console.log(`  timestamps set ................ ${drills.filter(d => d.youtube_start_seconds).length}`)
  if (!haveCurated) {
    console.log('\n  NOTE: drill-problem-map export not found, so P1 (curated) could not be')
    console.log('  distinguished and those drills appear as P2.')
  }

  console.log('\nPriority queue:')
  const counts = {}
  for (const r of rows) counts[r.priority] = (counts[r.priority] || 0) + 1
  const LABEL = {
    P0: 'scheduled in Phase 2C AND shared video at 0:00',
    P1: 'taxonomy-curated AND shared video at 0:00',
    P2: 'other shared-video drills at 0:00',
    P3: 'single-drill videos at 0:00',
    done: 'already has a timestamp',
    none: 'no video',
  }
  for (const p of ORDER) {
    if (!counts[p]) continue
    console.log(`  ${p.padEnd(5)} ${String(counts[p]).padStart(3)}   ${LABEL[p]}`)
  }

  console.log('\nShared videos, worst first (drills that would all open at 0:00):')
  shared.sort((a, b) => b[1].length - a[1].length)
  for (const [vid, arr] of shared) {
    const zero = arr.filter(d => !d.youtube_start_seconds).length
    const cats = Array.from(new Set(arr.map(d => d.skill_category))).join('/')
    console.log(`\n  ${vid}  ${arr.length} drills, ${zero} at 0:00  [${cats}]`)
    console.log(`  https://www.youtube.com/watch?v=${vid}`)
    for (const d of arr) {
      const r = rows.find(x => x.drill.id === d.id)
      console.log(
        `     ${r.priority.padEnd(4)} ${d.drill_name.slice(0, 52).padEnd(54)}` +
        `${d.youtube_start_seconds ? String(d.youtube_start_seconds) + 's' : '0:00'}`
      )
    }
  }

  console.log(`
NOTHING HERE CAN BE FILLED IN AUTOMATICALLY.

There is no timestamp evidence in this library and none reachable from this
environment: youtube_start_seconds is 0/206, the duration column is empty on
every row, no description / coaching note / reps guidance / safety note
contains a time in any format, no stored URL carries t= or start=, and YouTube
is blocked by the network policy so chapters and descriptions cannot be read.

A guessed timestamp is worse than none. Dropped into the wrong drill a coach
concludes the link is broken; at 0:00 they simply scrub.

  node scripts/curate-video-segments.mjs worksheet > segments.csv

Fill in the start column while watching, then:

  node scripts/curate-video-segments.mjs ingest segments.csv > migrations/050_video_segments.sql
`)
}

function worksheet() {
  const { rows } = analyse()
  const queue = rows
    .filter(r => ['P0', 'P1', 'P2', 'P3'].includes(r.priority))
    .sort((a, b) =>
      ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority) ||
      b.siblings - a.siblings ||
      String(a.vid).localeCompare(String(b.vid)) ||
      a.drill.drill_name.localeCompare(b.drill.drill_name))

  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  console.log('priority,video_id,drills_on_video,drill_id,drill_name,skill_category,video_url,start,source,notes')
  for (const r of queue) {
    console.log([
      r.priority, r.vid, r.siblings, r.drill.id, esc(r.drill.drill_name),
      esc(r.drill.skill_category),
      `https://www.youtube.com/watch?v=${r.vid}`,
      '', // start — "4:12" or a number of seconds. Blank means leave at 0:00.
      '', // source — chapter | description | manual-review
      '',
    ].join(','))
  }
}

// A CSV line reader that survives quoted fields containing commas, which drill
// names do ("Crow Hop — Arm Strength and Outfield Throwing" is fine, but
// "Tee Work, Ball Out In Front" would not be).
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

/** "4:12" -> 252. "252" -> 252. null for anything not understood. */
function parseTimestamp(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  if (sec > 59 || (m[1] && min > 59)) return null
  return h * 3600 + min * 60 + sec
}

const VALID_SOURCES = new Set(['chapter', 'description', 'manual-review', 'imported'])

function ingest(path) {
  const { drills } = load()
  const byId = new Map(drills.map(d => [d.id, d]))

  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim())
  const header = parseCsvLine(lines[0]).map(h => h.trim())
  const col = n => header.indexOf(n)
  for (const need of ['drill_id', 'start', 'source']) {
    if (col(need) === -1) throw new Error(`worksheet is missing a "${need}" column`)
  }

  const accepted = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i])
    const id = (f[col('drill_id')] || '').trim()
    const rawStart = (f[col('start')] || '').trim()
    const source = (f[col('source')] || '').trim() || 'manual-review'
    const name = (f[col('drill_name')] || '').trim()

    if (!rawStart) continue // left blank on purpose: stays at 0:00

    if (!byId.has(id)) { errors.push(`line ${i + 1}: unknown drill id ${id} (${name})`); continue }
    const seconds = parseTimestamp(rawStart)
    if (seconds == null) { errors.push(`line ${i + 1}: cannot read start "${rawStart}" for ${name}`); continue }
    if (seconds <= 0) { errors.push(`line ${i + 1}: start must be > 0, got ${seconds} for ${name}`); continue }
    if (seconds > 6 * 3600) { errors.push(`line ${i + 1}: start ${seconds}s is over six hours — typo? (${name})`); continue }
    if (!VALID_SOURCES.has(source)) {
      errors.push(`line ${i + 1}: source "${source}" is not one of ${Array.from(VALID_SOURCES).join(', ')} (${name})`)
      continue
    }
    accepted.push({ id, seconds, source, name })
  }

  if (errors.length > 0) {
    // Refuse the whole file. A partial application would leave the library in a
    // state nobody chose, and the fix is one line in a spreadsheet.
    console.error(`\nRefusing to emit a migration — ${errors.length} problem(s):\n`)
    for (const e of errors) console.error('  ' + e)
    console.error('')
    process.exit(1)
  }

  if (accepted.length === 0) {
    console.error('\nNo rows had a start time filled in. Nothing to emit.\n')
    process.exit(1)
  }

  const values = accepted
    .map(a => `  ('${a.id}', ${a.seconds}, '${a.source}')`)
    .join(',\n')

  console.log(`-- 050_video_segments.sql
--
-- Where each drill actually starts in its video.
--
-- Generated from a curation worksheet by
-- scripts/curate-video-segments.mjs ingest. Every value here was produced by a
-- person who watched the video; nothing in this file was inferred, because
-- there is no evidence in the library to infer it from and a wrong segment
-- start is worse than none.
--
-- ${accepted.length} drills.
--
-- Matched on drill id, never on title: drills share videos and several share a
-- name prefix, so a title match would hit the wrong row.
--
-- Only fills rows that have no timestamp yet, so re-running cannot undo a
-- later correction.

BEGIN;

UPDATE drill_resources AS d
SET youtube_start_seconds = v.start_seconds,
    youtube_start_source  = v.source
FROM (VALUES
${values}
) AS v(id, start_seconds, source)
WHERE d.id = v.id::uuid
  AND d.youtube_start_seconds IS NULL;

COMMIT;

-- Verification. Expect ${accepted.length} rows with a start and a source.
-- SELECT count(*) FILTER (WHERE youtube_start_seconds IS NOT NULL) AS with_start,
--        count(*) FILTER (WHERE youtube_start_seconds IS NOT NULL
--                           AND youtube_start_source IS NULL)      AS unsourced
--   FROM drill_resources WHERE status = 'approved';`)

  console.error(`\nEmitted ${accepted.length} segment starts.`)
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'worksheet') worksheet()
else if (cmd === 'ingest') {
  if (!arg) { console.error('usage: ingest <worksheet.csv>'); process.exit(1) }
  ingest(arg)
} else audit()
