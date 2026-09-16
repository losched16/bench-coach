// Show me everything currently written about these drills, so I can write the
// rest without inventing any of it.
//
// The editorial work in Phase 2C is not "make up a drill". It is "say plainly
// what this row already half-says, plus what the family it belongs to and the
// duplicate hidden behind it already establish". That only works if all of
// that is on one screen, which is what this prints.
//
//   npx tsx scripts/dump-instruction-batch.ts 'Fielding (Infield)' Throwing
//   npx tsx scripts/dump-instruction-batch.ts --ids <uuid> <uuid>
//
// Read-only. Writes nothing.

import { createClient } from '@supabase/supabase-js'
import { instructionTier, describesAVideo, findBoilerplate, GateContext } from '../lib/drillInstructions'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const FIELDS =
  'id, drill_name, skill_category, resource_kind, variation_type, activity_family_id, ' +
  'duplicate_of_drill_id, description, ai_coaching_notes, success_markers, equipment_needed, ' +
  'est_duration_minutes, min_age, max_age, age_range, difficulty_level, practice_roles, ' +
  'regression_notes, progression_notes, advanced_progression_notes, safety_notes, ' +
  'mechanic_focus, common_flaws_fixed, tags, reps_guidance, throwing_load, ' +
  'min_players, max_players, station_friendly, youtube_url'

const text = (v: any) => String(v ?? '').trim()

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)
  const { data, error } = await sb.from('drill_resources').select(FIELDS).is('created_by_coach_id', null)
  if (error || !data) { console.error(error?.message); process.exit(1) }
  const all = data as any[]

  const args = process.argv.slice(2)
  const byIds = args[0] === '--ids'
  const want = byIds ? args.slice(1) : args

  const schedulableAll = all.filter(d =>
    !d.duplicate_of_drill_id &&
    !['source_collection', 'teaching_content'].includes(text(d.resource_kind)))
  const ctx: GateContext = { boilerplate: findBoilerplate(schedulableAll) }

  let rows = all.filter(d =>
    !d.duplicate_of_drill_id &&
    !['source_collection', 'teaching_content'].includes(text(d.resource_kind)))
  rows = byIds
    ? rows.filter(d => want.includes(d.id))
    : rows.filter(d => want.includes(text(d.skill_category)))

  // Thinnest first — that is the order the work should be done in, and it puts
  // the rows that most need a decision at the top rather than buried.
  const weight = (d: any) => text(d.description).length + text(d.ai_coaching_notes).length
  rows.sort((a, b) => weight(a) - weight(b))

  for (const d of rows) {
    const tier = instructionTier(d, ctx)
    if (tier === 'READY' && !describesAVideo(d)) continue

    console.log(`\n━━━ ${d.drill_name}`)
    console.log(`    ${d.id}  [${d.skill_category}]  ${tier}${describesAVideo(d) ? '  VIDEO-FRAMED' : ''}`)
    if (d.activity_family_id) console.log(`    family ${d.activity_family_id}  variation=${d.variation_type || '-'}`)
    for (const f of ['description', 'ai_coaching_notes', 'regression_notes', 'progression_notes',
                     'advanced_progression_notes', 'safety_notes', 'reps_guidance', 'mechanic_focus']) {
      if (text(d[f])) console.log(`    ${f}: ${text(d[f])}`)
    }
    for (const f of ['success_markers', 'equipment_needed', 'practice_roles', 'common_flaws_fixed', 'tags']) {
      const v = d[f]
      if (Array.isArray(v) && v.length) console.log(`    ${f}: ${JSON.stringify(v)}`)
    }
    const meta = [
      d.est_duration_minutes ? `${d.est_duration_minutes}min` : null,
      d.age_range ? `ages ${d.age_range}` : null,
      d.difficulty_level,
      d.throwing_load ? `load=${d.throwing_load}` : null,
      d.station_friendly != null ? `station=${d.station_friendly}` : null,
      d.min_players ? `${d.min_players}-${d.max_players || '?'} players` : null,
    ].filter(Boolean)
    if (meta.length) console.log(`    meta: ${meta.join('  ')}`)

    // The duplicate is the point: its text is already curated and already
    // approved, and it is the cheapest correct source there is.
    for (const dup of all.filter(x => x.duplicate_of_drill_id === d.id)) {
      console.log(`    ┌ HIDDEN DUPLICATE "${dup.drill_name}" ${dup.id}`)
      for (const f of ['description', 'ai_coaching_notes', 'regression_notes', 'progression_notes', 'safety_notes']) {
        if (text(dup[f])) console.log(`    │ ${f}: ${text(dup[f])}`)
      }
      for (const f of ['success_markers', 'equipment_needed', 'practice_roles']) {
        if (Array.isArray(dup[f]) && dup[f].length) console.log(`    │ ${f}: ${JSON.stringify(dup[f])}`)
      }
      console.log(`    └`)
    }
  }
  console.log(`\n${rows.filter(d => instructionTier(d, ctx) !== 'READY' || describesAVideo(d)).length} rows needing work.`)
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
