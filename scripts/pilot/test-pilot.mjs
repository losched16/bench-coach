// Validation for the drill-intelligence pilot tooling.
//
// Two kinds of check, kept apart on purpose:
//
//   INFRASTRUCTURE — does each script do what it says, proven on a synthetic
//   fixture and a locally generated video. These pass with no network and no
//   Apify export, and they are what makes the pipeline trustworthy before the
//   real data lands.
//
//   PILOT STATE — what the pilot directory actually holds right now. These
//   report rather than assert, because "the five reels have not been
//   downloaded" is a true statement about a blocked network, not a bug.
//
//   node scripts/pilot/test-pilot.mjs

import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { readJson, exists, ffmpeg, ffmpegPath, P } from './lib.mjs'
import { ingest, normalizeRecord, emptyUnit, UNIT_TYPES, stubInput } from './ingest-apify.mjs'
import { planTimestamps, extractFor } from './extract-frames.mjs'
import { searchDrills } from './search-drills.mjs'

let passed = 0
const failures = []
const ok = (name, cond, detail = '') => { if (cond) passed++; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`) }
const eq = (name, a, b) => ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const EXPECTED_SHORTCODES = ['DZvJFoNgz8C', 'Dcrq_gmgUp5', 'DccQM89N1vx', 'Dcd4H4gIb6v', 'Dce5HRzxL8B']

// ---------------------------------------------------------------------------
// 1. Reference export (Task 1)
// ---------------------------------------------------------------------------
const refD = readJson(join(P.reference, 'drills.json'))
const refP = readJson(join(P.reference, 'problem_taxonomy.json'))
const refM = readJson(join(P.reference, 'drill_problem_map.json'))

eq('reference: drills count matches rows', refD.count, refD.rows.length)
eq('reference: 206 approved drills', refD.rows.filter(d => d.status === 'approved').length, 206)
eq('reference: no coach-authored drills in the system library', refD.rows.filter(d => d.created_by_coach_id).length, 0)
ok('reference: every drill has an id', refD.rows.every(d => typeof d.id === 'string' && d.id.length > 0))
ok('reference: ids are unique', new Set(refD.rows.map(d => d.id)).size === refD.rows.length)
ok('reference: the post-046 taxonomy is present (loses-posture)', refP.rows.some(p => p.slug === 'loses-posture'))
eq('reference: 49 taxonomy problems (post-046; brief expected the pre-046 48)', refP.count, 49)
eq('reference: 348 mappings (post-046; brief expected the pre-046 311)', refM.count, 348)
eq('reference: 75 curated mappings, unchanged by 046', refM.rows.filter(m => m.curated).length, 75)
ok('reference: every mapping points at an exported drill',
  refM.rows.every(m => refD.rows.some(d => d.id === m.drill_id)))
ok('reference: every mapping points at an exported problem',
  refM.rows.every(m => refP.rows.some(p => p.slug === m.problem_slug)))
ok('reference: carries the post-047 durations', refD.rows.every(d => typeof d.est_duration_minutes === 'number'))
ok('reference: carries the post-049 provenance column', 'youtube_start_source' in refD.rows[0])
ok('reference: is NOT the stale cowork snapshot',
  refD.exported_at && !refD.source.includes('cowork'), 'source should be a live PostgREST export')

// ---------------------------------------------------------------------------
// 2. Ingest schema (Task 2) — on the synthetic fixture
// ---------------------------------------------------------------------------
const fx = ingest('scripts/pilot/fixtures/apify-sample.json')
eq('ingest: two fixture records', fx.source_count, 2)
const a = fx.sources[0], b = fx.sources[1]
eq('ingest: platform is instagram', a.platform, 'instagram')
eq('ingest: shortCode -> shortcode', a.shortcode, 'FIXTURE0001')
eq('ingest: alternate "shortcode" field also read', b.shortcode, 'FIXTURE0002')
eq('ingest: inputUrl preserved', a.source_url, 'https://www.instagram.com/reel/FIXTURE0001/')
eq('ingest: creator username', a.creator.username, 'fixture_coach')
ok('ingest: caption preserved verbatim', a.caption.startsWith('Fixture caption.'))
ok('ingest: transcript preserved', a.transcript.startsWith('Fixture transcript.'))
eq('ingest: missing transcript is null, not empty string', b.transcript, null)
eq('ingest: ISO timestamp passes through', a.posted_at, '2026-08-20T14:03:00.000Z')
ok('ingest: unix timestamp converted', /^2025-08-20T/.test(b.posted_at), b.posted_at)
eq('ingest: downloadedVideo -> media url', a.media.downloaded_video_url, 'https://example.invalid/fixture0001.mp4')
eq('ingest: videoUrl also accepted', b.media.downloaded_video_url, 'https://example.invalid/fixture0002.mp4')
eq('ingest: videoDuration', a.media.duration_seconds, 42.5)
eq('ingest: "duration" also accepted', b.media.duration_seconds, 28)
eq('ingest: local_path starts null', a.media.local_path, null)
eq('ingest: retrieval starts pending', a.media.retrieval_status, 'pending')
ok('ingest: provenance records raw field names', a.provenance.raw_field_names.includes('downloadedVideo'))
eq('ingest: provenance records record index', b.provenance.apify_record_index, 1)
ok('ingest: extracted_units starts EMPTY (no AI conclusions)', Array.isArray(a.extracted_units) && a.extracted_units.length === 0)

// A bad shortcode must be refused, not turned into a directory name.
let threw = false
try { normalizeRecord({ shortCode: 'not a code' }, { ingestedAt: '', file: '', index: 0 }) } catch { threw = true }
ok('ingest: refuses a malformed shortcode', threw)

// ---------------------------------------------------------------------------
// 3. One source -> many intelligence units (Task 2, the DccQM89N1vx case)
// ---------------------------------------------------------------------------
const multi = { ...a, extracted_units: [] }
for (const [n, name] of ['Alpha Swings', 'Beta 45s', 'Gamma Backs', 'Delta Flips'].entries()) {
  multi.extracted_units.push(emptyUnit(multi.shortcode, n + 1, 'drill', name))
}
multi.extracted_units.push(emptyUnit(multi.shortcode, 5, 'coaching_insight', 'A cue, not a drill'))
multi.extracted_units.push(emptyUnit(multi.shortcode, 6, 'questionable', 'Unclear from the clip'))
eq('units: one source holds six units', multi.extracted_units.length, 6)
eq('units: four of them are drills', multi.extracted_units.filter(u => u.unit_type === 'drill').length, 4)
ok('units: unit ids are unique and source-prefixed',
  new Set(multi.extracted_units.map(u => u.unit_id)).size === 6 &&
  multi.extracted_units.every(u => u.unit_id.startsWith('FIXTURE0001-u')))
ok('units: all eight unit types are declared',
  ['drill', 'variation', 'progression', 'regression', 'coaching_insight', 'taxonomy_insight', 'questionable', 'reject']
    .every(t => UNIT_TYPES.includes(t)))
let badType = false
try { emptyUnit('X', 1, 'duplicate') } catch { badType = true }
ok('units: an undeclared unit_type is refused', badType)
const u = multi.extracted_units[0]
ok('units: judgement fields start empty',
  u.visual_notes === null && u.final_classification === null && u.human_decision === null &&
  u.benchcoach_candidates.length === 0)
ok('units: inferred_fields mirror drill_resources columns',
  ['skill_category', 'mechanic_focus', 'common_flaws_fixed', 'min_age', 'max_age', 'requires_partner']
    .every(k => k in u.inferred_fields))

// Zero units is also valid — a reel that is not a drill at all.
eq('units: zero units is a valid state', b.extracted_units.length, 0)

// ---------------------------------------------------------------------------
// 4. Frame planning and extraction (Task 4) — on a locally generated video
// ---------------------------------------------------------------------------
eq('frames: 30s reel plans ~9-10 stamps', planTimestamps(30).length, 9)
ok('frames: 164s source stays under 30 without scene changes', planTimestamps(164).length <= 30, String(planTimestamps(164).length))
ok('frames: opening frame always at 0', planTimestamps(30)[0] === 0)
ok('frames: final frame near the end', planTimestamps(30).at(-1) > 29)
ok('frames: scene changes are folded in', planTimestamps(30, [14.2]).some(t => Math.abs(t - 14.2) < 0.01))
ok('frames: a scene change within 1.5s of a cadence frame is absorbed by it', !planTimestamps(30, [13.3]).some(t => Math.abs(t - 13.3) < 0.01))
eq('frames: a scene change too close to a cadence frame is deduplicated', planTimestamps(30, [4.5]).length, 9)

let ffOk = false
try { ffmpegPath(); ffOk = true } catch {}
ok('frames: ffmpeg is resolvable', ffOk)

if (ffOk) {
  const dir = join(tmpdir(), `bc-pilot-test-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const video = join(dir, 'reel.mp4')
  // Twenty seconds, one hard cut at 12s.
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=duration=12:size=180x320:rate=15',
    '-f', 'lavfi', '-i', 'smptebars=duration=8:size=180x320:rate=15',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', video,
  ])
  const m = extractFor(video, join(dir, 'out'), 'TESTREEL000')
  ok('frames: duration probed', Math.abs(m.duration_seconds - 20) < 0.5, String(m.duration_seconds))
  ok('frames: 6-10 frames for a 20s clip', m.frame_count >= 6 && m.frame_count <= 10, String(m.frame_count))
  ok('frames: the cut at 12s was detected', m.scene_changes_detected >= 1, String(m.scene_changes_detected))
  ok('frames: a frame lands on the cut', m.frames.some(f => Math.abs(f.timestamp_seconds - 12) < 0.6))
  ok('frames: every listed file exists', m.frames.every(f => existsSync(join(dir, 'out', f.filename))))
  ok('frames: every frame has a timestamp', m.frames.every(f => typeof f.timestamp_seconds === 'number'))
  ok('frames: timestamps ascend', m.frames.every((f, i) => i === 0 || f.timestamp_seconds > m.frames[i - 1].timestamp_seconds))
  ok('frames: contact sheet written', existsSync(join(dir, 'out', 'contact-sheet.jpg')))
  ok('frames: frames.json written', existsSync(join(dir, 'out', 'frames.json')))
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 5. Candidate search (Task 6)
// ---------------------------------------------------------------------------
const r1 = searchDrills(refD.rows, ['tee', 'work'])
ok('search: finds Tee Work for "tee work"', r1.some(r => r.drill.drill_name === 'Tee Work'))
ok('search: every hit explains itself', r1.every(r => r.hits.length > 0))
ok('search: sorted by score', r1.every((r, i) => i === 0 || r.score <= r1[i - 1].score))
eq('search: nonsense finds nothing', searchDrills(refD.rows, ['zzqxv']).length, 0)
ok('search: age filter excludes out-of-range drills',
  searchDrills(refD.rows, ['tee'], { age: 6 }).every(r => (r.drill.min_age ?? 0) <= 6))
ok('search: category filter holds',
  searchDrills(refD.rows, ['drill'], { category: 'pitching' }).every(r => /pitching/i.test(r.drill.skill_category)))
eq('search: empty terms find nothing', searchDrills(refD.rows, []).length, 0)

// ---------------------------------------------------------------------------
// 6. Stub input (the five expected posts, pending)
// ---------------------------------------------------------------------------
const stub = stubInput(EXPECTED_SHORTCODES)
eq('stub: five sources', stub.source_count, 5)
ok('stub: flagged as a stub at top level and per source', stub.stub === true && stub.sources.every(s => s.provenance.stub))
ok('stub: nothing pretends to be evidence', stub.sources.every(s => s.caption === '' && s.transcript === null && s.media.downloaded_video_url === null))

// ---------------------------------------------------------------------------
// 6b. Deterministic caption seeding — the one allowed pre-population
//
// Asserted against the REAL manifest, because the behaviour only fires when
// the brief's expected names are all found verbatim in a real caption.
// ---------------------------------------------------------------------------
if (exists(P.manifest)) {
  const man = readJson(P.manifest)
  const dcc = man.sources.find(s => s.shortcode === 'DccQM89N1vx')
  if (dcc && !readJson(P.input).stub) {
    ok('seed: DccQM89N1vx hint is verified against the caption', dcc.hints?.verified_in_caption === true)
    eq('seed: all four names found', dcc.hints?.found?.length, 4)
    eq('seed: four units seeded', dcc.extracted_units.length, 4)
    ok('seed: every unit is marked as caption-parsed', dcc.extracted_units.every(u => u.seeded_by === 'caption-parse'))
    ok('seed: every unit carries its caption span', dcc.extracted_units.every(u => typeof u.source_evidence.caption_span === 'string' && u.source_evidence.caption_span.length > 10))
    ok('seed: nothing judgemental was filled in',
      dcc.extracted_units.every(u => u.final_classification === null && u.human_decision === null &&
        u.visual_notes === null && u.benchcoach_candidates.length === 0 && u.inferred_fields.skill_category === null))
    ok('seed: no other source was seeded', man.sources.filter(s => s.shortcode !== 'DccQM89N1vx').every(s => s.extracted_units.length === 0))
  }
}

// ---------------------------------------------------------------------------
// 7. Production untouched — the reference export IS the check
// ---------------------------------------------------------------------------
ok('safety: no pilot script imports a Supabase write path', (() => {
  const files = readdirSync('scripts/pilot').filter(f => f.endsWith('.mjs'))
  return files.every(f => {
    const src = readFileSync(join('scripts/pilot', f), 'utf8')
    return !/\.(insert|update|upsert|delete|rpc)\(/.test(src) && !/method:\s*['"](POST|PATCH|PUT|DELETE)['"]/i.test(src)
  })
})())

// ---------------------------------------------------------------------------
// 8. Pilot state — REPORTED, not asserted
// ---------------------------------------------------------------------------
console.log('\nPILOT STATE (reported, not asserted):')
if (exists(P.input)) {
  const input = readJson(P.input)
  console.log(`  input        : ${input.source_count} source(s)${input.stub ? '  [STUB — no Apify export ingested yet]' : `  from ${input.apify_export_file}`}`)
  for (const s of input.sources) {
    const dir = join(P.media, s.shortcode)
    const fj = join(dir, 'frames.json')
    const frames = exists(fj) ? readJson(fj).frame_count : 0
    console.log(`    ${s.shortcode}  media ${s.media.retrieval_status.padEnd(10)}  frames ${String(frames).padStart(2)}  ${EXPECTED_SHORTCODES.includes(s.shortcode) ? '' : '(unexpected shortcode)'}`)
  }
  const missing = EXPECTED_SHORTCODES.filter(c => !input.sources.some(s => s.shortcode === c))
  console.log(`  expected five: ${missing.length === 0 ? 'all present' : 'MISSING ' + missing.join(', ')}`)
} else {
  console.log('  input        : none — run ingest-apify.mjs')
}
console.log(`  manifest     : ${exists(P.manifest) ? 'present' : 'none — run build-manifest.mjs'}`)

console.log(`\npilot tooling: ${passed} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log('  FAIL  ' + f); process.exit(1) }
