// Task 5 — assemble pilot/calibration-manifest.json.
//
// The one file a reviewer opens. For every source: what Instagram said, what
// we fetched, where the frames are, and EMPTY slots for everything that is a
// judgement. Nothing here decides whether a reel is a new drill, a variation
// or a duplicate — that is the calibration step, and pre-filling it would
// bias the very thing being calibrated.
//
// Re-runnable. Existing judgement fields in a previous manifest are carried
// forward so a review in progress is not wiped by regenerating the scaffold.
//
//   node scripts/pilot/build-manifest.mjs

import { join } from 'path'
import { readJson, writeJson, exists, nowIso, P } from './lib.mjs'
import { emptyUnit, UNIT_TYPES } from './ingest-apify.mjs'

const input = readJson(P.input)
const previous = exists(P.manifest) ? readJson(P.manifest) : null
const prevBy = new Map((previous?.sources || []).map(s => [s.shortcode, s]))

const reference = {
  drills: exists(join(P.reference, 'drills.json')) ? readJson(join(P.reference, 'drills.json')) : null,
  problems: exists(join(P.reference, 'problem_taxonomy.json')) ? readJson(join(P.reference, 'problem_taxonomy.json')) : null,
  map: exists(join(P.reference, 'drill_problem_map.json')) ? readJson(join(P.reference, 'drill_problem_map.json')) : null,
}

const sources = input.sources.map(s => {
  const dir = join(P.media, s.shortcode)
  const framesJson = join(dir, 'frames.json')
  const frames = exists(framesJson) ? readJson(framesJson) : null
  const prev = prevBy.get(s.shortcode)

  return {
    shortcode: s.shortcode,
    platform: s.platform,
    creator: s.creator.username,
    source_url: s.source_url,
    posted_at: s.posted_at,
    caption: s.caption,
    transcript: s.transcript,
    duration_seconds: s.media.duration_seconds,

    media: {
      retrieval_status: s.media.retrieval_status,
      retrieval_error: s.media.retrieval_error ?? null,
      local_path: s.media.local_path,
      frames_dir: frames ? `pilot/media/${s.shortcode}/frames/` : null,
      frames_manifest: frames ? `pilot/media/${s.shortcode}/frames.json` : null,
      contact_sheet: frames ? `pilot/media/${s.shortcode}/contact-sheet.jpg` : null,
      frame_count: frames?.frame_count ?? 0,
    },

    // Deterministic from metadata only. The user-stated expectation that
    // DccQM89N1vx names four drills is a HINT for the reviewer, not a unit —
    // it is recorded so nobody has to remember it, and left unverified.
    hints: prev?.hints ?? (s.shortcode === 'DccQM89N1vx'
      ? { expected_named_drills: ['Split Grip Swings', 'Open 45s', 'Jump Backs', 'Side Flips'],
          note: 'stated in the pilot brief; verify against caption/transcript before extracting units' }
      : null),

    // Judgement fields. Carried forward if a previous manifest had them.
    extracted_units: prev?.extracted_units?.length ? prev.extracted_units : [],
    visual_notes: prev?.visual_notes ?? null,
    inferred_fields: prev?.inferred_fields ?? null,
    benchcoach_candidates: prev?.benchcoach_candidates ?? [],
    final_classification: prev?.final_classification ?? null,
    human_decision: prev?.human_decision ?? null,
  }
})

const manifest = {
  pilot: 'instagram-drill-intelligence-calibration',
  generated_at: nowIso(),
  ingested_at: input.ingested_at,
  apify_export_file: input.apify_export_file,

  reference_snapshot: {
    exported_at: reference.drills?.exported_at ?? null,
    drill_resources: reference.drills?.count ?? null,
    problem_taxonomy: reference.problems?.count ?? null,
    drill_problem_map: reference.map?.count ?? null,
    curated_mappings: reference.map ? reference.map.rows.filter(m => m.curated).length : null,
  },

  unit_types: UNIT_TYPES,
  unit_template: emptyUnit('SHORTCODE', 1),

  source_count: sources.length,
  media_summary: {
    downloaded: sources.filter(s => s.media.retrieval_status === 'downloaded').length,
    failed: sources.filter(s => s.media.retrieval_status === 'failed').length,
    pending: sources.filter(s => s.media.retrieval_status === 'pending').length,
    no_url: sources.filter(s => s.media.retrieval_status === 'no-url').length,
    with_frames: sources.filter(s => s.media.frame_count > 0).length,
  },
  sources,

  safety: 'Read-only pilot. No script under scripts/pilot/ writes to drill_resources, problem_taxonomy or drill_problem_map.',
}

writeJson(P.manifest, manifest)
console.log(`Manifest written: pilot/calibration-manifest.json`)
console.log(`  sources ${manifest.source_count}  downloaded ${manifest.media_summary.downloaded}  failed ${manifest.media_summary.failed}  no-url ${manifest.media_summary.no_url}  pending ${manifest.media_summary.pending}  with frames ${manifest.media_summary.with_frames}`)
console.log(`  reference: ${manifest.reference_snapshot.drill_resources} drills / ${manifest.reference_snapshot.problem_taxonomy} problems / ${manifest.reference_snapshot.drill_problem_map} mappings`)
