// One line per schedulable drill: what it trains, what it fixes, what family
// it belongs to.
//
//   npm run index:library
//   npm run index:library -- Pitching Catching
//
// Read-only. Writes nothing.
//
// WHY THIS EXISTS SEPARATELY FROM dump:pathway
//
// dump:pathway prints a drill in full so a stage can be justified from the
// evidence. This prints the WHOLE pool at a glance, because the Phase 2F
// question is the opposite one: before a new canonical row is proposed, is
// there already something in the library doing that teaching job? That
// question cannot be answered from a handful of drills — it needs the list.
//
// So: name, the movement it trains, the problems it is mapped to, its family,
// and nothing else. Enough to spot a duplicate, not enough to hide one.

import { createClient } from '@supabase/supabase-js'
import { isSchedulable } from '../lib/drills'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const text = (v: any) => String(v ?? '').trim()
const list = (v: any) => (Array.isArray(v) ? v.filter(Boolean) : [])

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data, error } = await sb.from('drill_resources').select('*').is('created_by_coach_id', null)
  const { data: map } = await sb.from('drill_problem_map').select('drill_id, problem_slug')
  const { data: fams } = await sb.from('drill_activity_families').select('id, slug')
  if (error || !data) { console.error(error?.message); process.exit(1) }

  const problems = new Map<string, string[]>()
  for (const m of (map || []) as any[]) {
    problems.set(m.drill_id, (problems.get(m.drill_id) || []).concat([m.problem_slug]))
  }
  const famSlug = new Map((fams || []).map((f: any) => [f.id, f.slug]))

  const want = process.argv.slice(2).map(s => s.toLowerCase())
  const pool = (data as any[]).filter(d => isSchedulable(d))
    .filter(d => want.length === 0 || want.indexOf(text(d.skill_category).toLowerCase()) >= 0)
    .sort((a, b) => text(a.skill_category).localeCompare(text(b.skill_category))
      || text(a.drill_name).localeCompare(text(b.drill_name)))

  let cat = ''
  for (const d of pool) {
    const c = text(d.skill_category)
    if (c !== cat) { cat = c; console.log(`\n=== ${c} ===`) }
    const trains = list(d.mechanic_focus).join('/') || '—'
    const fixes = (problems.get(d.id) || []).join('/') || '—'
    const fam = famSlug.get(d.activity_family_id)
    console.log(`${text(d.drill_name)}
    trains ${trains}
    fixes  ${fixes}${fam ? `   [family ${fam}]` : ''}`)
  }
  console.log(`\n${pool.length} schedulable drills${want.length ? ` in ${want.join(', ')}` : ''}`)
}

main()
