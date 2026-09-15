// Emit the Hitting / Infield / Throwing pilot as SQL, from the audit itself.
//
// Same reasoning as scripts/emit-media-backfill.ts: the decisions file is the
// source of truth, so the statements that reach production are generated from
// it rather than retyped. Retyping is where a disposition and a write quietly
// stop agreeing.
//
// Prints a checksum of what it intends, so the same checksum can be computed
// from the database afterwards and the two compared. A write nobody verified
// is a write nobody can trust.
//
//   npx tsx scripts/emit-canon-pilot.ts

import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { loadDecisions, effectiveKind } from './build-canon-audit'
import { PILOT_CATEGORIES, FAMILY_NAMES } from './apply-canon-pilot'

const LIB: any[] = JSON.parse(readFileSync('scripts/fixtures/drill-library-snapshot.json', 'utf8'))
const cat = new Map(LIB.map(d => [d.id, d.skill_category]))
const q = (v: string) => `'${v.replace(/'/g, "''")}'`

const ALL = loadDecisions()
const pilot = ALL.filter(d => PILOT_CATEGORIES.includes(String(cat.get(d.drill_id))))

const slugs = Array.from(new Set(pilot.map(d => d.family_slug).filter(Boolean)))
const newSlugs = slugs.filter(s => s in FAMILY_NAMES)

console.log(`-- Pilot: ${PILOT_CATEGORIES.join(' / ')}`)
console.log(`-- ${pilot.length} rows, ${newSlugs.length} new families. No deletes, no video columns touched.`)
console.log('')
for (const s of newSlugs) {
  const m = FAMILY_NAMES[s]
  console.log(`insert into drill_activity_families (slug, name, primary_skill) values (${q(s)}, ${q(m.name)}, ${q(m.skill)}) on conflict (slug) do nothing;`)
}
console.log('')

const lines: string[] = []
for (const d of pilot) {
  const kind = effectiveKind(d, ALL)
  const sets: string[] = []
  if (kind) sets.push(`resource_kind = ${q(kind)}`)
  if (d.family_slug) sets.push(`activity_family_id = (select id from drill_activity_families where slug = ${q(d.family_slug)})`)
  if (d.variation_type) sets.push(`variation_type = ${q(d.variation_type)}`)
  if (!sets.length) continue
  console.log(`update drill_resources set ${sets.join(', ')} where id = ${q(d.drill_id)};`)
  lines.push(`${d.drill_id}|${kind}|${d.family_slug}|${d.variation_type}`)
}

console.error(`rows written: ${lines.length}`)
console.error(`checksum: ${createHash('md5').update(lines.slice().sort().join('\n')).digest('hex')}`)
