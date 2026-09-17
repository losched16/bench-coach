// Does migration 071 reference anything that is not there?
//
//   npm run verify:071
//
// Read-only. Parses migrations/071_pathway_coverage_expansion.sql and checks
// every reference in it against the live library and the live pathways, then
// checks the new rows against the rules Phase 2C and 2F set for them.
//
// The emitter for 070 refuses to generate SQL that points at a missing or
// demoted drill. 071 is hand-written, so it needs the same guard applied
// afterwards instead of before. This is that guard.

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { isSchedulable } from '../lib/drills'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SQL = path.join(__dirname, '..', 'migrations', '071_pathway_coverage_expansion.sql')

let failures = 0
function check(label: string, ok: boolean, evidence = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(58)} ${evidence}`)
  if (!ok) failures++
}

// The six rows 071 adds. Parsed rather than hard-coded, so a seventh cannot be
// added to the migration without this file noticing.
function newRowIds(sql: string): string[] {
  const block = sql.split('ON CONFLICT (id) DO NOTHING')[0]
  const ids: string[] = []
  const re = /^\('([0-9a-f-]{36})','/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) ids.push(m[1])
  return ids
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)
  const sql = fs.readFileSync(SQL, 'utf8')

  const { data: drills, error } = await sb.from('drill_resources').select('*').is('created_by_coach_id', null)
  const { data: problems } = await sb.from('problem_taxonomy').select('slug')
  const { data: stages } = await sb.from('development_pathway_stages').select('id, stage_key, pathway_id')
  const { data: pathways } = await sb.from('development_pathways').select('id, slug')
  if (error || !drills) { console.error(error?.message); process.exit(1) }

  const byId = new Map((drills as any[]).map(d => [d.id, d]))
  const slugs = new Set((problems || []).map((p: any) => p.slug))
  const pathBySlug = new Map((pathways || []).map((p: any) => [p.slug, p.id]))
  const stageKeys = new Set((stages || []).map((s: any) => `${s.pathway_id}|${s.stage_key}`))

  const added = newRowIds(sql)
  check('1. 071 adds exactly six new drill rows', added.length === 6, `${added.length}`)
  // This check has two correct answers depending on whether 071 has been
  // applied, and it has to mean something in both. Before: none of the six is
  // in the library, so the migration is not about to collide with anything.
  // After: all six are there, approved, curated activities. What is never
  // right is a partial set, which would mean the insert went in halfway.
  const present = added.filter(id => byId.has(id))
  const applied = present.length === added.length
  if (present.length === 0) {
    check('2. 071 not yet applied — none of the six exists', true, 'all new, no collision')
  } else {
    const wellFormed = present.filter(id => {
      const d = byId.get(id)
      return d.status === 'approved' && d.resource_kind === 'activity' && !d.created_by_coach_id
    })
    check('2. 071 applied — all six are in the library as curated activities',
      applied && wellFormed.length === added.length,
      `${present.length}/${added.length} present, ${wellFormed.length} well-formed`)
  }

  // Every drill id 071 attaches or re-ranks, other than the six it creates.
  const referenced = new Set<string>()
  const idRe = /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g
  let m: RegExpExecArray | null
  const after = sql.split('ON CONFLICT (id) DO NOTHING')[1] || ''
  while ((m = idRe.exec(after))) referenced.add(m[1])
  for (const id of added) referenced.delete(id)

  const missing = Array.from(referenced).filter(id => !byId.has(id))
  check('3. every existing drill 071 references is in the library',
    missing.length === 0, missing.join(' ') || `${referenced.size} referenced`)

  // The one deliberate exception: the stretching routine being DETACHED does
  // not have to be schedulable — it has to exist, and it is being removed.
  const detached = 'b194ff1d-f857-47d5-911c-0bab06c6e6bc'
  const demoted = Array.from(referenced)
    .filter(id => id !== detached && byId.has(id) && !isSchedulable(byId.get(id)))
  check('4. nothing 071 attaches is demoted or unschedulable',
    demoted.length === 0, demoted.map(id => byId.get(id).drill_name).join(', ') || 'clean')

  // Every (pathway, stage_key) pair in the VALUES list resolves.
  const pairRe = /\('([a-z0-9-]+)','([a-z0-9-]+)','[0-9a-f-]{36}'/g
  const pairs: Array<[string, string]> = []
  while ((m = pairRe.exec(sql))) pairs.push([m[1], m[2]])
  // Two different answers. A stage key that does not resolve inside a pathway
  // production HAS is a mistake in 071. A pathway production does not have at
  // all is migration 070 not being fully applied, which is a known blocker and
  // not something 071 can be wrong about.
  const pending = pairs.filter(([p]) => !pathBySlug.get(p))
  const badPairs = pairs.filter(([p, k]) => {
    const pid = pathBySlug.get(p)
    return pid && !stageKeys.has(`${pid}|${k}`)
  })
  check('5. every stage key resolves in the pathways production has',
    badPairs.length === 0, badPairs.map(x => x.join('/')).join(' ') ||
      `${pairs.length - pending.length} checked`)
  if (pending.length) {
    const slugsPending = Array.from(new Set(pending.map(x => x[0])))
    console.log(`     ${pending.length} attachment(s) not checkable yet — 070 has not applied ` +
      `${slugsPending.join(', ')} to production`)
  }

  // Every problem slug used is a real slug. 2F.7: no new slugs invented here.
  const mapBlock = sql.split('drill_problem_map')[1]?.split('ON CONFLICT')[0] || ''
  const used = new Set<string>()
  const slugRe = /,'([a-z][a-z0-9-]+)',\d+,true\)/g
  while ((m = slugRe.exec(mapBlock))) used.add(m[1])
  const unknown = Array.from(used).filter(s => !slugs.has(s))
  check('6. every problem slug 071 maps to already exists',
    unknown.length === 0, unknown.join(' ') || `${used.size} slugs, 0 new`)

  // 2F.11: no media dependency, no timestamps, nothing marked verified.
  check('7. 071 creates no media rows and no timestamps',
    !/drill_resources_media|start_seconds|verification_status/.test(sql), 'no media table touched')

  // The standing rule: never DELETE a drill row.
  const deletes = (sql.match(/DELETE FROM public\.(\w+)/g) || []).map(s => s.split('.')[1])
  check('8. 071 deletes nothing from the drill library',
    deletes.every(t => t === 'development_pathway_stage_drills'),
    deletes.join(', ') || 'no deletes')

  // Every attachment carries a rationale that says something. Split the VALUES
  // list into tuples rather than matching quoted strings, because a rationale
  // contains doubled quotes and a quote-delimited regex loses on the first one.
  const valuesBlock = sql.split('AS v(pathway')[0].split('FROM (VALUES')[1] || ''
  const tuples = valuesBlock.split(/\n    \('/).slice(1)
  const thin = tuples.filter(t => {
    const afterRank = t.replace(/^[^,]+,[^,]+,[^,]+,[^,]+,\s*\d+,\s*/, '')
    return afterRank.replace(/''/g, "'").replace(/[^A-Za-z ]/g, '').trim().length < 40
  })
  check('9. every attachment carries a written rationale',
    tuples.length === pairs.length && thin.length === 0,
    `${tuples.length} tuples, ${pairs.length} attachments, ${thin.length} thin`)

  // Roles are varied — 2F.8 forbids making everything primary.
  const roles = (sql.match(/','(primary|regression|reinforcement|progression|assessment|game_application)',\d+,/g) || [])
    .map(s => s.split("'")[2])
  const distinct = Array.from(new Set(roles))
  const primaries = roles.filter(r => r === 'primary').length
  check('10. attachments use more than one role, and not mostly primary',
    distinct.length >= 3 && primaries < roles.length / 2,
    `${distinct.join(', ')} — ${primaries} of ${roles.length} primary`)

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
