// What does this drill actually TEACH? — the evidence a pathway is built from.
//
//   npm run dump:pathway -- Hitting 'Soft Toss' Bunting
//   npm run dump:pathway -- --ids <uuid> <uuid>
//
// Read-only. Writes nothing.
//
// WHY THIS IS NOT dump-instruction-batch
//
// That one exists to WRITE a drill's instructions and prints everything a row
// holds. This one exists to ORDER drills into a teaching sequence, which is a
// different question and needs a different shape: what movement does it train,
// what problem is it mapped to fix, what does it ask a player to already be
// able to do, and what does mastery look like.
//
// Phase 2E's rule is that a drill belongs to a stage because it teaches or
// tests the stage objective — not because its category matches. So this prints
// the fields that can justify that claim and leaves out the ones that cannot.
// skill_category is printed last and deliberately small.

import { createClient } from '@supabase/supabase-js'
import { isSchedulable } from '../lib/drills'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const text = (v: any) => String(v ?? '').trim()
const list = (v: any) => (Array.isArray(v) ? v.filter(Boolean) : [])
const clip = (v: any, n: number) => {
  const s = text(v).replace(/\s+/g, ' ')
  return s.length <= n ? s : s.slice(0, n).replace(/\s\S*$/, '') + '…'
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data, error } = await sb.from('drill_resources').select('*').is('created_by_coach_id', null)
  const { data: map } = await sb.from('drill_problem_map').select('drill_id, problem_slug')
  const { data: fams } = await sb.from('drill_activity_families').select('id, slug, name')
  if (error || !data) { console.error(error?.message); process.exit(1) }

  const problems = new Map<string, string[]>()
  for (const m of (map || []) as any[]) {
    problems.set(m.drill_id, (problems.get(m.drill_id) || []).concat([m.problem_slug]))
  }
  const famSlug = new Map((fams || []).map((f: any) => [f.id, f.slug]))

  const args = process.argv.slice(2)
  const byIds = args[0] === '--ids'
  const want = byIds ? args.slice(1) : args
  if (want.length === 0) { console.error('Name a category, or --ids.'); process.exit(1) }

  // The pool a pathway may draw from is the schedulable pool and nothing else.
  // A stage that recommends a source collection is a stage that recommends a
  // twelve-minute compilation, which is the thing two phases were spent on.
  const pool = (data as any[]).filter(d => isSchedulable(d))

  const rows = byIds
    ? pool.filter(d => want.indexOf(d.id) >= 0)
    : pool.filter(d => want.some(w => text(d.skill_category).toLowerCase() === w.toLowerCase()))

  // Ordered by the library's own curated progression, then by name, because
  // that is the closest thing to a prior the data already carries — and seeing
  // it laid out is how you find out whether it agrees with the teaching order
  // or not. It frequently does not, which is the whole reason 2E exists.
  rows.sort((a, b) =>
    (Number(a.progression_level) || 99) - (Number(b.progression_level) || 99) ||
    text(a.drill_name).localeCompare(text(b.drill_name)))

  console.log(`\n${rows.length} schedulable drills in ${byIds ? 'the id list' : want.join(', ')}\n`)

  for (const d of rows) {
    const fam = d.activity_family_id ? famSlug.get(d.activity_family_id) : null
    console.log('─'.repeat(100))
    console.log(`${d.drill_name}`)
    console.log(`  ${d.id}`)
    console.log(`  level ${d.progression_level ?? '–'} · ${d.difficulty_level || '–'} · ages ${d.age_range || '–'} · ${d.est_duration_minutes || '–'}min` +
      `${fam ? ` · family ${fam}/${d.variation_type || '?'}` : ''}`)
    console.log(`  roles    ${list(d.practice_roles).join(', ') || '–'}`)
    console.log(`  trains   ${list(d.mechanic_focus).join(', ') || '–'}`)
    console.log(`  fixes    ${(problems.get(d.id) || []).join(', ') || '– NONE MAPPED'}`)
    console.log(`  what     ${clip(d.description, 300)}`)
    if (text(d.ai_coaching_notes)) console.log(`  cues     ${clip(d.ai_coaching_notes, 240)}`)
    if (list(d.success_markers).length) console.log(`  mastery  ${list(d.success_markers).map((s: any) => clip(s, 90)).join(' | ')}`)
    if (text(d.regression_notes)) console.log(`  easier   ${clip(d.regression_notes, 140)}`)
    if (text(d.progression_notes)) console.log(`  harder   ${clip(d.progression_notes, 140)}`)
    console.log(`  kit      ${list(d.equipment_needed).join(', ') || '–'}   [${d.skill_category}]`)
  }
  console.log('─'.repeat(100))
}

main().catch(e => { console.error(e); process.exit(1) })
