// Can the Drill Finder be redesigned without exposing weak media?
//
// The redesign puts the activity first and the media second. That is the right
// shape, and it only helps if the media behind it is worth showing. A card that
// leads with "Watch demonstration" and drops a coach at 0:00 of a twelve-minute
// compilation is a worse experience than the list it replaced, because it
// promised something.
//
// So this measures the 154 schedulable activities on the five things the
// redesign would surface, and breaks them down by category — because the answer
// is not one number. Hitting may be ready while Catching is not.
//
//   npm run audit:finder-readiness
//
// Read-only. Writes one file, in docs/.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OUT = 'docs/audits/drill-finder-readiness.csv'

/**
 * Does this row carry enough written detail to lead a card with?
 *
 * The redesign shows the activity first: a name, a purpose, and what happens.
 * A row whose description is one thin line has nothing to put under the name,
 * and no amount of media fixes that.
 */
export function instructionsComplete(d: any): boolean {
  const desc = String(d.description || '').trim()
  return desc.length >= 120 && (
    !!String(d.ai_coaching_notes || '').trim() ||
    (Array.isArray(d.success_markers) && d.success_markers.length > 0)
  )
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: drills } = await sb.from('drill_resources')
    .select('id, drill_name, skill_category, resource_kind, duplicate_of_drill_id, ' +
            'description, ai_coaching_notes, success_markers, youtube_video_id, youtube_url')
    .is('created_by_coach_id', null)
  const { data: media } = await sb.from('drill_media_resources')
    .select('drill_id, external_id, url, start_seconds, verification_status, is_primary')

  if (!drills || !media) { console.error('Read failed.'); process.exit(1) }

  const schedulable = (drills as any[]).filter(d =>
    !d.duplicate_of_drill_id &&
    !['source_collection', 'teaching_content'].includes(String(d.resource_kind || '')))

  const byDrill = new Map<string, any[]>()
  for (const m of media as any[]) byDrill.set(m.drill_id, [...(byDrill.get(m.drill_id) || []), m])

  // A video backing more than one drill is a compilation, and landing on it
  // with no timestamp is the specific weak case the redesign would expose.
  const perVideo = new Map<string, Set<string>>()
  for (const m of media as any[]) {
    const k = m.external_id || m.url
    perVideo.set(k, (perVideo.get(k) || new Set()).add(m.drill_id))
  }

  const rows = schedulable.map(d => {
    const mine = byDrill.get(d.id) || []
    const primary = mine.find(m => m.is_primary) || mine[0] || null
    const key = primary ? (primary.external_id || primary.url) : null
    const shared = key ? (perVideo.get(key)?.size || 0) : 0
    return {
      drill_id: d.id,
      drill_name: d.drill_name,
      skill_category: d.skill_category,
      instructions_complete: instructionsComplete(d) ? 'yes' : 'no',
      primary_media_present: primary ? 'yes' : 'no',
      primary_media_verified: primary?.verification_status === 'verified' ? 'yes' : 'no',
      specific_timestamp: primary && primary.start_seconds != null ? 'yes' : 'no',
      generic_compilation: primary && shared > 1 && primary.start_seconds == null ? 'yes' : 'no',
      no_media: mine.length === 0 ? 'yes' : 'no',
      media_count: mine.length,
      drills_sharing_primary_video: shared,
    }
  })

  mkdirSync('docs/audits', { recursive: true })
  const head = Object.keys(rows[0])
  const cell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  writeFileSync(OUT, head.join(',') + '\n' +
    rows.map(r => head.map(h => cell((r as any)[h])).join(',')).join('\n') + '\n')

  // ── by category ──────────────────────────────────────────────────────────
  const cats = Array.from(new Set(rows.map(r => r.skill_category))).sort()
  const pct = (n: number, of: number) => of === 0 ? '  -' : `${String(Math.round(n / of * 100)).padStart(3)}%`
  const count = (rs: any[], f: (r: any) => boolean) => rs.filter(f).length

  console.log(`${OUT}\n`)
  console.log(`${rows.length} schedulable activities\n`)
  console.log('category                  n   instr   media   verif   stamp   compil  none')
  console.log('─'.repeat(78))
  const line = (label: string, rs: any[]) => {
    const n = rs.length
    console.log(
      label.padEnd(24) + String(n).padStart(3) + '   ' +
      pct(count(rs, r => r.instructions_complete === 'yes'), n) + '    ' +
      pct(count(rs, r => r.primary_media_present === 'yes'), n) + '    ' +
      pct(count(rs, r => r.primary_media_verified === 'yes'), n) + '    ' +
      pct(count(rs, r => r.specific_timestamp === 'yes'), n) + '    ' +
      pct(count(rs, r => r.generic_compilation === 'yes'), n) + '   ' +
      pct(count(rs, r => r.no_media === 'yes'), n))
  }
  for (const c of cats) line(c, rows.filter(r => r.skill_category === c))
  console.log('─'.repeat(78))
  line('ALL', rows)

  // ── the verdict ──────────────────────────────────────────────────────────
  const verified = count(rows, r => r.primary_media_verified === 'yes')
  const stamped = count(rows, r => r.specific_timestamp === 'yes')
  const compilation = count(rows, r => r.generic_compilation === 'yes')
  const noMedia = count(rows, r => r.no_media === 'yes')

  console.log(`\nverified primary media   ${verified} of ${rows.length}`)
  console.log(`specific timestamp       ${stamped} of ${rows.length}`)
  console.log(`generic compilation      ${compilation} of ${rows.length}`)
  console.log(`no media at all          ${noMedia} of ${rows.length}`)

  const verdict = stamped === 0 ? 'NOT READY'
    : compilation / rows.length > 0.2 ? 'PARTIAL'
    : 'READY'
  console.log(`\nDrill Finder: ${verdict}`)
  if (verdict === 'NOT READY') {
    console.log(`  Not one schedulable activity has a curated timestamp, and ${compilation} would`)
    console.log('  open a coach on a compilation. Leading a card with media would promise')
    console.log('  something the library cannot yet deliver.')
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
