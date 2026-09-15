// Every curated drill, with the decision taken about it, in one file.
//
// The decision lives in scripts/fixtures/drill-canon-decisions.tsv and is
// editorial. This is only the join: it reads the live library, matches each row
// to its decision by id, and writes docs/audits/drill-canonicalization-decisions.csv.
//
// WHY THE JOIN IS THE CHECK
//
// The brief's rule is "zero rows may disappear from this audit". A hand-written
// CSV cannot hold that — a row dropped while editing looks exactly like a row
// that was never there. So the CSV is generated, and this script exits non-zero
// if the library holds an id the decisions file does not, or the decisions file
// holds an id the library does not. Every curated row is accounted for because
// the build fails otherwise, not because somebody counted carefully.
//
// Read-only against production. It writes one file, in docs/.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npm run audit:canon

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const DECISIONS = 'scripts/fixtures/drill-canon-decisions.tsv'
const SNAPSHOT = 'scripts/fixtures/drill-library-snapshot.json'
const OUT = 'docs/audits/drill-canonicalization-decisions.csv'

/**
 * What each disposition means for resource_kind, and therefore for whether the
 * row may still be offered as something to run.
 *
 * REVIEW_REQUIRED maps to NULL deliberately. An unreviewed row stays usable:
 * demoting on uncertainty would silently shrink the library, which is the
 * failure mode the drill-audit standing instruction exists to prevent
 * ("coverage beats quality"). Unknown is not a reason to take a drill away.
 */
const KIND: Record<string, string> = {
  KEEP_CANONICAL: 'activity',
  MERGE_INTO: 'activity',
  VARIATION_OF: 'activity',
  PROGRESSION_OF: 'activity',
  PRACTICE_UNIT: 'practice_unit',
  SOURCE_COLLECTION: 'source_collection',
  TEACHING_CONTENT: 'teaching_content',
  REVIEW_REQUIRED: '',
}

export interface Decision {
  drill_id: string
  disposition: string
  canonical_target_id: string
  family_slug: string
  variation_type: string
  confidence: string
  requires_manual_review: string
  rationale: string
}

/** The decisions file, parsed. Exported so the tests can assert on it. */
export function loadDecisions(path: string = DECISIONS): Decision[] {
  const out: Decision[] = []
  const lines = readFileSync(path, 'utf8').split('\n')

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.startsWith('#')) return

    const f = line.split('\t')
    if (f.length < 8) {
      throw new Error(`${path}:${i + 1} has ${f.length} tab-separated fields, expected 8`)
    }
    const d: Decision = {
      drill_id: f[0].trim(),
      disposition: f[1].trim(),
      canonical_target_id: f[2].trim(),
      family_slug: f[3].trim(),
      variation_type: f[4].trim(),
      confidence: f[5].trim(),
      requires_manual_review: f[6].trim(),
      rationale: f.slice(7).join('\t').trim(),
    }

    if (!(d.disposition in KIND)) {
      throw new Error(`${path}:${i + 1} unknown disposition "${d.disposition}"`)
    }
    if (!['high', 'medium', 'low'].includes(d.confidence)) {
      throw new Error(`${path}:${i + 1} confidence must be high/medium/low, got "${d.confidence}"`)
    }
    if (!['yes', 'no'].includes(d.requires_manual_review)) {
      throw new Error(`${path}:${i + 1} review must be yes/no, got "${d.requires_manual_review}"`)
    }
    // A merge with nowhere to merge into is a decision that cannot be carried
    // out, and it reads as complete until somebody tries.
    if (['MERGE_INTO', 'VARIATION_OF', 'PROGRESSION_OF'].includes(d.disposition) && !d.canonical_target_id) {
      throw new Error(`${path}:${i + 1} ${d.disposition} needs a canonical_target_id`)
    }
    if (!d.rationale) throw new Error(`${path}:${i + 1} has no rationale`)
    out.push(d)
  })

  return out
}

export function resourceKindFor(disposition: string): string {
  return KIND[disposition] ?? ''
}

/**
 * The kind a row should actually carry, once a merge is taken into account.
 *
 * A MERGE_INTO row is THE SAME ACTIVITY as its target, so it is the same KIND
 * of thing. Without this, the knee/hip/full throwing progression lands as one
 * practice_unit and two activities — three rows describing one three-phase
 * sequence, disagreeing about what a sequence is. Nothing would break; the
 * library would just quietly hold a contradiction about itself.
 *
 * Only MERGE_INTO inherits. A VARIATION_OF or PROGRESSION_OF is a DIFFERENT
 * activity in the same family, and a variation of a routine is not obliged to
 * be a routine.
 */
export function effectiveKind(d: Decision, all: Decision[]): string {
  if (d.disposition !== 'MERGE_INTO') return resourceKindFor(d.disposition)
  const target = all.find(x => x.drill_id === d.canonical_target_id)
  return target ? resourceKindFor(target.disposition) : resourceKindFor(d.disposition)
}

/** Everything but source collections and teaching content may still be run. */
export function schedulableAfter(disposition: string): boolean {
  const k = resourceKindFor(disposition)
  return k !== 'source_collection' && k !== 'teaching_content'
}

function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The curated library, live if credentials are present and from the committed
 * snapshot otherwise.
 *
 * The snapshot exists because the audit has to be reproducible by anyone
 * reading the CSV — including on a machine with no database credentials at all,
 * and in CI. It is a read-only copy of exactly the columns below, refreshed by
 * running this with credentials. Drift between it and production is itself
 * worth knowing about, so the script says which source it used, every time.
 */
async function loadLibrary(): Promise<{ rows: any[]; source: string }> {
  const COLS =
    'id, drill_name, skill_category, youtube_video_id, youtube_url, ' +
    'youtube_start_seconds, youtube_start_source, activity_family_id, ' +
    'variation_type, created_by_coach_id, status'

  if (URL && KEY) {
    const sb = createClient(URL, KEY)
    // CURATED rows only. A coach's own drill is explicitly out of scope — it is
    // their writing, and classifying it is not ours to do.
    const { data, error } = await sb.from('drill_resources').select(COLS).is('created_by_coach_id', null)
    if (error || !data) {
      console.error('Could not read drill_resources:', error?.message)
      process.exit(1)
    }
    writeFileSync(SNAPSHOT, JSON.stringify(data, null, 1))
    return { rows: data, source: 'live (snapshot refreshed)' }
  }

  return { rows: JSON.parse(readFileSync(SNAPSHOT, 'utf8')), source: SNAPSHOT }
}

async function main() {
  const { rows: drills, source } = await loadLibrary()
  const decisions = loadDecisions()
  const byId = new Map(decisions.map(d => [d.drill_id, d]))
  const live = new Map(drills.map((d: any) => [d.id, d]))

  // ── the completeness check ────────────────────────────────────────────────
  const undecided = drills.filter((d: any) => !byId.has(d.id))
  const phantom = decisions.filter(d => !live.has(d.drill_id))
  const dupes = decisions.length - byId.size

  if (undecided.length || phantom.length || dupes) {
    console.error('AUDIT INCOMPLETE — not writing the CSV.\n')
    for (const d of undecided) {
      console.error(`  no decision for ${d.id}  ${d.drill_name} (${d.skill_category})`)
    }
    for (const d of phantom) {
      console.error(`  decision for ${d.drill_id}, which is not in the curated library`)
    }
    if (dupes) console.error(`  ${dupes} duplicate id(s) in ${DECISIONS}`)
    console.error(
      `\n${drills.length} curated rows, ${byId.size} distinct decisions. ` +
      `Every curated row needs one.`
    )
    process.exit(1)
  }

  // ── the CSV ───────────────────────────────────────────────────────────────
  const header = [
    'drill_id', 'current_name', 'skill_category', 'disposition',
    'canonical_target_name', 'canonical_target_id', 'proposed_family_slug',
    'proposed_variation_type', 'proposed_resource_kind', 'schedulable_after',
    'preserve_current_video', 'source_video_id', 'source_video_url',
    'confidence', 'rationale', 'requires_manual_review',
  ]

  const rows = drills
    .slice()
    .sort((a: any, b: any) =>
      String(a.skill_category).localeCompare(String(b.skill_category)) ||
      String(a.drill_name).localeCompare(String(b.drill_name)))
    .map((d: any) => {
      const dec = byId.get(d.id)!
      const target = dec.canonical_target_id ? live.get(dec.canonical_target_id) : null
      return [
        d.id,
        d.drill_name,
        d.skill_category,
        dec.disposition,
        target ? target.drill_name : '',
        dec.canonical_target_id,
        dec.family_slug,
        dec.variation_type,
        effectiveKind(dec, decisions),
        schedulableAfter(dec.disposition) ? 'yes' : 'no',
        // Nothing in this phase touches a video. Stated per row so the claim is
        // checkable against the file rather than against a paragraph.
        'yes',
        d.youtube_video_id || '',
        d.youtube_url || '',
        dec.confidence,
        dec.rationale,
        dec.requires_manual_review,
      ].map(csvCell).join(',')
    })

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, header.join(',') + '\n' + rows.join('\n') + '\n')

  // ── counts ────────────────────────────────────────────────────────────────
  const tally = new Map<string, number>()
  for (const d of decisions) tally.set(d.disposition, (tally.get(d.disposition) || 0) + 1)

  console.log(`${OUT}`)
  console.log(`library read from: ${source}\n`)
  console.log(`${drills.length} curated rows, all accounted for.\n`)
  const order = Object.keys(KIND)
  for (const k of order) {
    const n = tally.get(k) || 0
    console.log(`  ${k.padEnd(18)} ${String(n).padStart(3)}   ${n ? '█'.repeat(Math.ceil(n / 2)) : ''}`)
  }

  const sched = decisions.filter(d => schedulableAfter(d.disposition)).length
  console.log(`\n  schedulable after   ${sched}`)
  console.log(`  demoted             ${decisions.length - sched}`)
  console.log(`  manual review       ${decisions.filter(d => d.requires_manual_review === 'yes').length}`)
  const withVideo = drills.filter((d: any) => d.youtube_video_id).length
  console.log(`\n  videos on file      ${withVideo} (every one preserved; this phase writes no media)`)
}

// Importing this module for its parser must not fire a network read.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
