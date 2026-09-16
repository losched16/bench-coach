// Turn the written instructions into a migration, and refuse if they are not good enough.
//
// scripts/fixtures/drill-instructions.json holds the editorial work: for each
// drill, the fields being rewritten and a one-line note on where the content
// came from. This reads it, merges each entry onto the live row, runs the merged
// result through the SAME gate the audit uses, and only then emits SQL.
//
//   npx tsx scripts/emit-instruction-updates.ts > migrations/067_instruction_quality.sql
//
// WHY IT CHECKS BEFORE IT WRITES
//
// The failure mode this is guarding against is subtle and I nearly shipped it:
// writing 140 descriptions, feeling done, and finding out after the migration
// landed that thirty of them still fail — because a long paragraph that never
// mentions a coach, a ball or a rep reads fine to the person who just wrote it.
// The gate is not a formality applied to somebody else's work. It is applied
// here, to mine, before anything reaches production.
//
// It also refuses to make a row WORSE. A fixture that overwrites a strong
// existing field with a thinner one is almost always a copy-paste error, and
// there is no reason the tool should carry it through silently.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import {
  isInstructionReady, instructionTier, missingPieces, findBoilerplate,
  describesAVideo, GateContext,
} from '../lib/drillInstructions'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const FIXTURE = 'scripts/fixtures/drill-instructions.json'

/** Only fields a coach reads. Nothing here touches media, timestamps or taxonomy. */
const TEXT_FIELDS = [
  'description', 'ai_coaching_notes', 'regression_notes', 'progression_notes',
  'advanced_progression_notes', 'safety_notes', 'reps_guidance',
] as const
const ARRAY_FIELDS = ['success_markers', 'equipment_needed', 'practice_roles'] as const
const WRITABLE = [...TEXT_FIELDS, ...ARRAY_FIELDS] as readonly string[]

export interface InstructionEntry {
  drill_id: string
  drill_name: string
  source: string
  description?: string
  ai_coaching_notes?: string
  success_markers?: string[]
  equipment_needed?: string[]
  practice_roles?: string[]
  regression_notes?: string
  progression_notes?: string
  advanced_progression_notes?: string
  safety_notes?: string
  reps_guidance?: string
}

const text = (v: any) => String(v ?? '').trim()
const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`
const pgArray = (xs: string[]) => `ARRAY[${xs.map(q).join(', ')}]::text[]`
const say = (m: string) => console.error(m)

export function loadFixture(path: string = FIXTURE): InstructionEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array`)

  const seen = new Set<string>()
  for (const e of raw as InstructionEntry[]) {
    if (!e.drill_id) throw new Error(`${path}: an entry has no drill_id`)
    if (seen.has(e.drill_id)) throw new Error(`${path}: ${e.drill_id} appears twice`)
    seen.add(e.drill_id)
    // Provenance is required because the whole claim of this phase is "nothing
    // was invented". An entry that cannot say where its content came from is
    // exactly the entry that needs to say it.
    if (!text(e.source)) throw new Error(`${path}: ${e.drill_name || e.drill_id} has no source note`)
    for (const k of Object.keys(e)) {
      if (['drill_id', 'drill_name', 'source'].includes(k)) continue
      if (!WRITABLE.includes(k)) throw new Error(`${path}: ${e.drill_name} sets "${k}", which this tool does not write`)
    }
  }
  return raw as InstructionEntry[]
}

/** The row as it would be after the fixture is applied. */
export function merged(live: any, e: InstructionEntry): any {
  const out = { ...live }
  for (const f of WRITABLE) if ((e as any)[f] !== undefined) out[f] = (e as any)[f]
  return out
}

async function main() {
  if (!URL || !KEY) { say('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data, error } = await sb.from('drill_resources')
    .select('id, drill_name, skill_category, resource_kind, duplicate_of_drill_id, ' +
            'created_by_coach_id, description, ai_coaching_notes, success_markers, ' +
            'equipment_needed, est_duration_minutes, min_age, max_age, age_range, ' +
            'difficulty_level, practice_roles, regression_notes, progression_notes, ' +
            'advanced_progression_notes, safety_notes, reps_guidance')
    .is('created_by_coach_id', null)
  if (error || !data) { say(`Could not read drill_resources: ${error?.message}`); process.exit(1) }

  const all = data as any[]
  const byId = new Map(all.map(d => [d.id, d]))
  const entries = loadFixture()

  // ── every entry has to point at a real, schedulable, curated row ──────────
  const problems: string[] = []
  const mergedRows: { e: InstructionEntry; live: any; next: any }[] = []

  for (const e of entries) {
    const live = byId.get(e.drill_id)
    if (!live) { problems.push(`${e.drill_name || e.drill_id}: not a curated drill`); continue }
    if (live.duplicate_of_drill_id) {
      problems.push(`${live.drill_name}: is a duplicate of ${live.duplicate_of_drill_id} — write the canonical row instead`)
      continue
    }
    if (['source_collection', 'teaching_content'].includes(text(live.resource_kind))) {
      problems.push(`${live.drill_name}: is a ${live.resource_kind}, which is not something a coach runs`)
      continue
    }
    if (e.drill_name && e.drill_name !== live.drill_name) {
      // A stale name in the fixture means the entry was written against a row
      // that has since been renamed, and the content may no longer be about it.
      problems.push(`${e.drill_id}: fixture says "${e.drill_name}", production says "${live.drill_name}"`)
      continue
    }
    mergedRows.push({ e, live, next: merged(live, e) })
  }

  if (problems.length) {
    say('FIXTURE DOES NOT MATCH PRODUCTION — nothing emitted.\n')
    for (const p of problems) say(`  ${p}`)
    process.exit(1)
  }

  // ── the merged library, scored the way the audit scores it ────────────────
  const nextAll = all
    .filter(d => !d.duplicate_of_drill_id &&
                 !['source_collection', 'teaching_content'].includes(text(d.resource_kind)))
    .map(d => { const m = mergedRows.find(x => x.live.id === d.id); return m ? m.next : d })
  const ctx: GateContext = { boilerplate: findBoilerplate(nextAll) }

  const fails: string[] = []
  const regressions: string[] = []

  for (const { e, live, next } of mergedRows) {
    if (!isInstructionReady(next, ctx)) {
      fails.push(`${live.drill_name}: still fails — ${missingPieces(next, ctx).join('; ')}`)
    }
    if (describesAVideo(next)) {
      fails.push(`${live.drill_name}: rewritten description is still about a video`)
    }
    for (const f of TEXT_FIELDS) {
      const before = text(live[f]), after = text(next[f])
      if (before && after.length < before.length * 0.6) {
        regressions.push(`${live.drill_name}.${f}: ${before.length} chars replaced by ${after.length}`)
      }
    }
    for (const f of ARRAY_FIELDS) {
      const before = (live[f] || []).length, after = (next[f] || []).length
      if (before > after) regressions.push(`${live.drill_name}.${f}: ${before} entries replaced by ${after}`)
    }
  }

  if (fails.length || regressions.length) {
    say('WRITTEN CONTENT DOES NOT CLEAR THE GATE — nothing emitted.\n')
    for (const f of fails) say(`  FAIL  ${f}`)
    for (const r of regressions) say(`  LOSS  ${r}`)
    process.exit(1)
  }

  // ── the migration ─────────────────────────────────────────────────────────
  const tiers = { READY: 0, USABLE: 0, THIN: 0 } as Record<string, number>
  for (const { next } of mergedRows) tiers[instructionTier(next, ctx)]++

  const out: string[] = []
  out.push('-- ============================================================================')
  out.push('-- 067 — Written instructions, so the drill works without the video')
  out.push('-- ============================================================================')
  out.push('--')
  out.push('-- GENERATED by scripts/emit-instruction-updates.ts from')
  out.push('-- scripts/fixtures/drill-instructions.json. Edit the fixture, not this file.')
  out.push('--')
  out.push('-- Phase 2B established that no timestamp evidence is reachable from this')
  out.push('-- environment, which left the media half of the Drill Finder stuck. The drill')
  out.push('-- is the product and the media supports it, so this improves the half that is')
  out.push('-- not blocked: what a coach reads when they open the activity.')
  out.push('--')
  out.push(`-- ${mergedRows.length} rows updated. Text fields only: description, coaching notes,`)
  out.push('-- success markers, equipment, practice roles, regression/progression, safety,')
  out.push('-- reps guidance. NOTHING here touches media, timestamps, taxonomy mappings,')
  out.push('-- canonicalization, resource_kind or duplicate_of_drill_id, and nothing is')
  out.push('-- deleted — every statement is an UPDATE of an existing row.')
  out.push('--')
  out.push(`-- After this migration these ${mergedRows.length} rows score:`)
  out.push(`--   READY ${tiers.READY}   USABLE ${tiers.USABLE}   THIN ${tiers.THIN}`)
  out.push('--')
  out.push('-- Every statement is idempotent: re-running sets the same values again.')
  out.push('-- ============================================================================')
  out.push('')
  out.push('BEGIN;')
  out.push('')

  for (const { e, live, next } of mergedRows) {
    const sets: string[] = []
    for (const f of TEXT_FIELDS) {
      if ((e as any)[f] === undefined) continue
      sets.push(`  ${f} = ${q(text((e as any)[f]))}`)
    }
    for (const f of ARRAY_FIELDS) {
      if ((e as any)[f] === undefined) continue
      sets.push(`  ${f} = ${pgArray((e as any)[f])}`)
    }
    if (!sets.length) continue

    out.push(`-- ${live.drill_name}  [${live.skill_category}]  → ${instructionTier(next, ctx)}`)
    out.push(`-- source: ${e.source}`)
    out.push(`UPDATE public.drill_resources SET`)
    out.push(sets.join(',\n') + ',')
    out.push(`  updated_at = now()`)
    out.push(`WHERE id = '${live.id}';`)
    out.push('')
  }

  out.push('COMMIT;')
  console.log(out.join('\n'))

  say(`${mergedRows.length} rows → READY ${tiers.READY}, USABLE ${tiers.USABLE}, THIN ${tiers.THIN}`)
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
