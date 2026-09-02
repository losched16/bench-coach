// Task 2 — turn an Apify Instagram export into pilot/input/instagram-calibration.json.
//
// THE DATA MODEL, AND WHY IT IS SHAPED THIS WAY
//
// One Instagram post is not one drill. A 30-second reel might be one drill, a
// variation of one the library already has, a four-drill circuit, a coaching
// cue with no drill at all, or content that should be rejected. So a source
// carries a LIST of extracted intelligence units — zero, one or many — and
// each unit is classified independently. Shortcode DccQM89N1vx is the reason
// this matters: it names at least four drills in one post, and a model that
// forced it into one row would lose three of them.
//
// Units are NOT populated here. This script records what Instagram said —
// caption, transcript, creator, timing, media URL — and leaves every
// judgement field empty for the review layer. The one exception is provenance,
// which is deterministic and written in full so any later conclusion can be
// traced back to a raw record.
//
//   node scripts/pilot/ingest-apify.mjs <apify-export.json>
//
// Tolerant of the field-name variants Apify's Instagram actors use
// (shortCode / shortcode / code, videoUrl / downloadedVideo, timestamp /
// takenAtTimestamp) and records which raw field names were actually present.

import { basename } from 'path'
import { readJson, writeJson, nowIso, assertShortcode, P } from './lib.mjs'

export const UNIT_TYPES = [
  'drill', 'variation', 'progression', 'regression',
  'coaching_insight', 'taxonomy_insight', 'questionable', 'reject',
]

// The first present, non-empty value among several possible field names.
function pick(rec, ...names) {
  for (const n of names) {
    const v = rec?.[n]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

function toIso(v) {
  if (v == null) return null
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString()
}

/** One raw Apify record -> one pilot source. */
export function normalizeRecord(rec, ctx) {
  const shortcode = assertShortcode(pick(rec, 'shortCode', 'shortcode', 'code'))
  const sourceUrl =
    pick(rec, 'inputUrl', 'url', 'postUrl') || `https://www.instagram.com/p/${shortcode}/`

  const rawDuration = pick(rec, 'videoDuration', 'duration', 'video_duration')
  const duration = rawDuration == null ? null : Number(rawDuration)

  return {
    platform: 'instagram',
    platform_content_id: shortcode,
    shortcode,
    source_url: sourceUrl,
    creator: {
      username: pick(rec, 'ownerUsername', 'owner_username', 'username'),
      full_name: pick(rec, 'ownerFullName', 'owner_full_name'),
      id: pick(rec, 'ownerId', 'owner_id'),
    },
    caption: pick(rec, 'caption', 'text') ?? '',
    transcript: pick(rec, 'transcript', 'transcription', 'audioTranscript') ?? null,
    posted_at: toIso(pick(rec, 'timestamp', 'takenAtTimestamp', 'taken_at', 'postedAt')),
    media: {
      type: pick(rec, 'type', 'productType', 'mediaType'),
      downloaded_video_url: pick(rec, 'downloadedVideo', 'downloadedVideoUrl', 'videoUrl', 'video_url'),
      display_url: pick(rec, 'displayUrl', 'thumbnailUrl'),
      duration_seconds: Number.isFinite(duration) ? duration : null,
      // Filled in by download-media.mjs. Never trusted from the export.
      local_path: null,
      retrieval_status: 'pending',
    },
    engagement: {
      likes: pick(rec, 'likesCount', 'likes'),
      comments: pick(rec, 'commentsCount', 'comments'),
      views: pick(rec, 'videoViewCount', 'videoPlayCount', 'views'),
    },
    hashtags: Array.isArray(rec.hashtags) ? rec.hashtags : [],
    provenance: {
      ingested_at: ctx.ingestedAt,
      apify_export_file: ctx.file,
      apify_record_index: ctx.index,
      apify_record_id: pick(rec, 'id', 'pk'),
      raw_field_names: Object.keys(rec).sort(),
    },
    // Zero, one or many. Populated by the review layer, never here.
    extracted_units: [],
  }
}

/** The shape of one intelligence unit, so every producer agrees on it. */
export function emptyUnit(shortcode, n, unitType = null, name = null) {
  if (unitType != null && !UNIT_TYPES.includes(unitType)) {
    throw new Error(`unknown unit_type "${unitType}"; expected one of ${UNIT_TYPES.join(', ')}`)
  }
  return {
    unit_id: `${shortcode}-u${n}`,
    unit_type: unitType,
    name,
    source_evidence: { caption_span: null, transcript_span: null, frame_refs: [] },
    visual_notes: null,
    inferred_fields: {
      skill_category: null, primary_skill: null, mechanic_focus: [],
      common_flaws_fixed: [], equipment_needed: [], min_age: null, max_age: null,
      difficulty_level: null, indoor_outdoor: null, space_required: null,
      requires_partner: null,
    },
    benchcoach_candidates: [],
    final_classification: null,
    human_decision: null,
  }
}

export function ingest(exportPath) {
  const raw = readJson(exportPath)
  const records = Array.isArray(raw) ? raw : (raw.items || raw.data || raw.results || [])
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${exportPath}: no records found (expected a JSON array or {items:[...]})`)
  }

  const ingestedAt = nowIso()
  const file = basename(exportPath)
  const sources = records.map((rec, index) => normalizeRecord(rec, { ingestedAt, file, index }))

  // Two records for one post would double-count everything downstream.
  const seen = new Set()
  for (const s of sources) {
    if (seen.has(s.shortcode)) throw new Error(`duplicate shortcode in export: ${s.shortcode}`)
    seen.add(s.shortcode)
  }

  return {
    pilot: 'instagram-drill-intelligence-calibration',
    ingested_at: ingestedAt,
    apify_export_file: file,
    unit_types: UNIT_TYPES,
    source_count: sources.length,
    sources,
  }
}

/**
 * A placeholder input from shortcodes alone, for when the Apify export has not
 * arrived yet. Every source is marked as a stub with no caption, transcript
 * or media URL, so the manifest can show the five expected posts as PENDING
 * rather than the pilot having no shape at all. Replaced wholesale by a real
 * ingest; nothing downstream treats a stub as evidence of anything.
 */
export function stubInput(shortcodes) {
  const ingestedAt = nowIso()
  const sources = shortcodes.map((sc, index) => {
    const shortcode = assertShortcode(sc)
    return {
      platform: 'instagram',
      platform_content_id: shortcode,
      shortcode,
      source_url: `https://www.instagram.com/p/${shortcode}/`,
      creator: { username: null, full_name: null, id: null },
      caption: '',
      transcript: null,
      posted_at: null,
      media: { type: null, downloaded_video_url: null, display_url: null,
               duration_seconds: null, local_path: null, retrieval_status: 'pending' },
      engagement: { likes: null, comments: null, views: null },
      hashtags: [],
      provenance: {
        ingested_at: ingestedAt, apify_export_file: null, apify_record_index: index,
        apify_record_id: null, raw_field_names: [],
        stub: true,
        stub_note: 'Shortcode supplied by the pilot brief. No Apify export was available; re-run ingest with the real file.',
      },
      extracted_units: [],
    }
  })
  return {
    pilot: 'instagram-drill-intelligence-calibration',
    ingested_at: ingestedAt,
    apify_export_file: null,
    stub: true,
    unit_types: UNIT_TYPES,
    source_count: sources.length,
    sources,
  }
}

if (process.argv[1] && process.argv[1].endsWith('ingest-apify.mjs')) {
  const args = process.argv.slice(2)
  if (args[0] === '--stub') {
    const codes = args.slice(1)
    if (codes.length === 0) { console.error('usage: --stub <shortcode> [...]'); process.exit(1) }
    const out = stubInput(codes)
    writeJson(P.input, out)
    console.log(`Wrote STUB input for ${out.source_count} shortcode(s) -> pilot/input/instagram-calibration.json`)
    console.log('No caption, transcript or media. Re-run with the real Apify export to replace it.')
    process.exit(0)
  }
  const file = args[0]
  if (!file) {
    console.error('usage: node scripts/pilot/ingest-apify.mjs <apify-export.json>')
    console.error('       node scripts/pilot/ingest-apify.mjs --stub <shortcode> [...]')
    process.exit(1)
  }
  const out = ingest(file)
  writeJson(P.input, out)
  console.log(`Ingested ${out.source_count} source(s) from ${out.apify_export_file} -> pilot/input/instagram-calibration.json`)
  for (const s of out.sources) {
    console.log(
      `  ${s.shortcode}  @${s.creator.username ?? '?'}  ` +
      `${s.media.duration_seconds != null ? s.media.duration_seconds + 's' : 'duration ?'}  ` +
      `caption ${s.caption.length} chars  transcript ${s.transcript ? s.transcript.length + ' chars' : 'none'}  ` +
      `video ${s.media.downloaded_video_url ? 'url present' : 'NO URL'}`
    )
  }
}
