// Could a coach run each of these from the text alone?
//
// One row per schedulable curated activity, scored against lib/drillInstructions.ts.
// The gate lives there and not here on purpose: the audit, the readiness report
// and the tests all have to be asking the same question, and three copies of a
// rule drift into three rules.
//
//   npm run audit:instructions
//
// Read-only against production. Writes one file, in docs/.
//
// WHAT "editorial_action" IS FOR
//
// A count of failures tells an editor that something is wrong. It does not tell
// them what to type. So each row carries the specific thing it needs — REWRITE
// when the description is about a video, RECOVER when a hidden duplicate holds
// better text than the row coaches actually see, WRITE when there is nothing to
// work from. The order of the CSV is the order to work in.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { dirname } from 'path'
import {
  describesAnActivity, describesAVideo, isInstructionReady, instructionTier, missingPieces,
  findBoilerplate, GateContext,
} from '../lib/drillInstructions'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OUT = 'docs/audits/drill-instruction-quality.csv'
const FIXTURE = 'scripts/fixtures/drill-instructions.json'

/**
 * --pending scores the library as it WOULD be once the written instructions in
 * the fixture are applied, without applying them.
 *
 * Without it there is no way to see the work landing: production does not
 * change until the migration runs, so every rerun reports the same "before"
 * numbers and the only way to know whether the writing is finished is to ship
 * it and look. That is the wrong order.
 */
const PENDING = process.argv.includes('--pending')

const FIELDS =
  'id, drill_name, skill_category, resource_kind, variation_type, activity_family_id, ' +
  'duplicate_of_drill_id, created_by_coach_id, description, ai_coaching_notes, ' +
  'success_markers, equipment_needed, est_duration_minutes, min_age, max_age, age_range, ' +
  'difficulty_level, practice_roles, regression_notes, progression_notes, ' +
  'advanced_progression_notes, safety_notes'

/**
 * The order the brief asks for the work to be done in.
 *
 * It is not alphabetical and it is not by count. It is by how often a coach
 * lands on the category, which is why Soft Toss — one small category — is
 * first: it is the most-scheduled hitting station in the library and the
 * thinnest written.
 */
const PRIORITY = [
  'Soft Toss', 'Fielding (Infield)', 'Throwing', 'Hitting', 'Fielding (Fly Balls)', 'Bunting',
]

const text = (v: any) => String(v ?? '').trim()
const arr = (v: any) => (Array.isArray(v) ? v.filter(x => text(x)) : [])
const yn = (b: boolean) => (b ? 'yes' : 'no')

function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * What to do with this row, and how sure we are.
 *
 * RECOVER is the interesting one. Phase 2A picked canonical rows by which NAME
 * read cleanest, which turned out to be uncorrelated with which row had the
 * better writing behind it — so for some families the richer text went to the
 * duplicate and is now hidden from discovery. That is a self-inflicted wound
 * and it is cheap to reverse, so it is called out separately from rows that
 * genuinely need new prose.
 */
function editorialAction(d: any, richerDuplicate: any | null, ctx: GateContext): { action: string; confidence: string } {
  if (d.created_by_coach_id) return { action: 'NONE_COACH_AUTHORED', confidence: 'high' }
  if (describesAVideo(d)) return { action: 'REWRITE_VIDEO_FRAMING', confidence: 'high' }
  if (richerDuplicate) return { action: 'RECOVER_FROM_DUPLICATE', confidence: 'high' }
  if (ctx.boilerplate?.has(String(d.ai_coaching_notes ?? '').trim())) {
    return { action: 'REPLACE_BOILERPLATE_CUES', confidence: 'high' }
  }

  const tier = instructionTier(d, ctx)
  if (tier === 'THIN') return { action: 'WRITE_FULL', confidence: 'high' }
  if (tier === 'USABLE') return { action: 'COMPLETE_MISSING', confidence: 'medium' }
  return { action: 'NONE', confidence: 'high' }
}

/** How much written substance a row carries, across every field a coach reads. */
export function contentWeight(d: any): number {
  return text(d.description).length + text(d.ai_coaching_notes).length +
    arr(d.success_markers).join(' ').length + text(d.regression_notes).length +
    text(d.progression_notes).length + text(d.safety_notes).length
}

async function main() {
  if (!URL || !KEY) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data, error } = await sb.from('drill_resources').select(FIELDS).is('created_by_coach_id', null)
  if (error || !data) { console.error('Could not read drill_resources:', error?.message); process.exit(1) }
  let all = data as any[]

  if (PENDING && existsSync(FIXTURE)) {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as any[]
    const patch = new Map(fixture.map(e => [e.drill_id, e]))
    all = all.map(d => {
      const e = patch.get(d.id)
      if (!e) return d
      const { drill_id, drill_name, source, ...fields } = e
      return { ...d, ...fields }
    })
    console.log(`scoring with ${fixture.length} pending instruction rewrites applied (nothing written)\n`)
  }

  const schedulable = all.filter(d =>
    !d.duplicate_of_drill_id &&
    !['source_collection', 'teaching_content'].includes(text(d.resource_kind)))

  // Which canonical rows are outscored by a duplicate that coaches can no
  // longer reach. Whole-row weight, not per field: a canonical with one strong
  // field and four empty ones is still the thinner row.
  const richerDupe = new Map<string, any>()
  for (const dup of all.filter(d => d.duplicate_of_drill_id)) {
    const canon = all.find(x => x.id === dup.duplicate_of_drill_id)
    if (!canon) continue
    if (contentWeight(dup) <= contentWeight(canon)) continue
    const held = richerDupe.get(canon.id)
    if (!held || contentWeight(dup) > contentWeight(held)) richerDupe.set(canon.id, dup)
  }

  // Computed over the schedulable set, because a cue shared with a demoted row
  // is not the failure being looked for — a coach never sees both.
  const ctx: GateContext = { boilerplate: findBoilerplate(schedulable) }

  const rank = (c: string) => { const i = PRIORITY.indexOf(c); return i === -1 ? PRIORITY.length : i }
  const rows = schedulable.slice().sort((a, b) =>
    rank(a.skill_category) - rank(b.skill_category) ||
    String(a.skill_category).localeCompare(String(b.skill_category)) ||
    contentWeight(a) - contentWeight(b) ||
    String(a.drill_name).localeCompare(String(b.drill_name)))

  const header = [
    'drill_id', 'drill_name', 'skill_category', 'resource_kind', 'variation_type',
    'activity_family_id', 'description_length', 'has_description', 'has_coaching_notes',
    'has_success_markers', 'has_equipment', 'has_duration', 'has_age_fit', 'has_difficulty',
    'has_practice_role', 'has_regression', 'has_progression', 'has_safety_notes',
    'instruction_minimum_pass', 'instruction_quality_tier', 'editorial_action',
    'confidence', 'notes',
  ]

  const lines = rows.map(d => {
    const dupe = richerDupe.get(d.id) || null
    const { action, confidence } = editorialAction(d, dupe, ctx)
    const gaps = missingPieces(d, ctx)
    // The note has to be actionable on its own, because this CSV is the working
    // document and nobody should have to hold the rule in their head to use it.
    const note = [
      dupe ? `duplicate ${dupe.id} ("${dupe.drill_name}") carries ${contentWeight(dupe)} chars vs ${contentWeight(d)} here` : '',
      gaps.join('; '),
    ].filter(Boolean).join(' — ')

    return [
      d.id,
      d.drill_name,
      d.skill_category,
      d.resource_kind || '',
      d.variation_type || '',
      d.activity_family_id || '',
      text(d.description).length,
      // has_description is the QUALITY question, not the populated question:
      // the brief's "do not equate field populated with field correct".
      yn(describesAnActivity(d)),
      yn(text(d.ai_coaching_notes).length >= 40 && !ctx.boilerplate!.has(text(d.ai_coaching_notes))),
      yn(arr(d.success_markers).length > 0),
      yn(arr(d.equipment_needed).length > 0),
      yn(!!d.est_duration_minutes),
      yn(!!d.min_age || !!text(d.age_range)),
      yn(!!text(d.difficulty_level)),
      yn(arr(d.practice_roles).length > 0),
      yn(!!text(d.regression_notes)),
      yn(!!text(d.progression_notes)),
      yn(!!text(d.safety_notes)),
      yn(isInstructionReady(d, ctx)),
      instructionTier(d, ctx),
      action,
      confidence,
      note,
    ].map(csvCell).join(',')
  })

  // --pending must never overwrite the audit of record; it is a progress view.
  if (!PENDING) {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, header.join(',') + '\n' + lines.join('\n') + '\n')
    console.log(`${OUT}\n`)
  }

  // ── what it found ─────────────────────────────────────────────────────────
  const tiers = { READY: 0, USABLE: 0, THIN: 0 } as Record<string, number>
  for (const d of rows) tiers[instructionTier(d, ctx)]++
  const pass = rows.filter(d => isInstructionReady(d, ctx)).length

  console.log(`${all.length} curated rows, ${rows.length} schedulable and in scope.\n`)
  console.log(`  READY   ${String(tiers.READY).padStart(3)}   ${'█'.repeat(Math.ceil(tiers.READY / 3))}`)
  console.log(`  USABLE  ${String(tiers.USABLE).padStart(3)}   ${'█'.repeat(Math.ceil(tiers.USABLE / 3))}`)
  console.log(`  THIN    ${String(tiers.THIN).padStart(3)}   ${'█'.repeat(Math.ceil(tiers.THIN / 3))}`)
  console.log(`\n  minimum-pass ${pass}/${rows.length} (${Math.round((pass / rows.length) * 100)}%)\n`)

  const cats = Array.from(new Set(rows.map(d => String(d.skill_category))))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  console.log('  category               n   READY  USABLE  THIN   pass')
  for (const c of cats) {
    const inCat = rows.filter(d => String(d.skill_category) === c)
    const t = { READY: 0, USABLE: 0, THIN: 0 } as Record<string, number>
    for (const d of inCat) t[instructionTier(d, ctx)]++
    const p = inCat.filter(x => isInstructionReady(x, ctx)).length
    console.log(
      `  ${c.padEnd(22)} ${String(inCat.length).padStart(2)}   ` +
      `${String(t.READY).padStart(4)}  ${String(t.USABLE).padStart(5)}  ` +
      `${String(t.THIN).padStart(4)}   ${String(p).padStart(3)}/${inCat.length}`)
  }

  if (PENDING) {
    console.log('\n  not yet READY')
    for (const d of rows) {
      const t = instructionTier(d, ctx)
      if (t === 'READY') continue
      console.log(`    ${t.padEnd(7)} ${String(d.skill_category).padEnd(22)} ${d.drill_name}`)
      console.log(`            ${d.id}  ${missingPieces(d, ctx).join('; ')}`)
    }
  }

  const actions = new Map<string, number>()
  for (const d of rows) {
    const a = editorialAction(d, richerDupe.get(d.id) || null, ctx).action
    actions.set(a, (actions.get(a) || 0) + 1)
  }
  console.log('\n  editorial work')
  for (const [a, n] of Array.from(actions.entries()).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${a.padEnd(24)} ${String(n).padStart(3)}`)
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
