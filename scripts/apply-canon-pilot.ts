// The Phase 1 production write: Hitting, Infield and Throwing only.
//
// WHAT IT WRITES
//
//   drill_resources.resource_kind        the classification from the audit
//   drill_resources.activity_family_id   family membership, via a slug
//   drill_resources.variation_type       where in the family a row sits
//   drill_activity_families              rows for any new family slug
//
// WHAT IT NEVER WRITES
//
//   nothing is deleted, ever
//   no video column is touched — not the id, url, timestamp or provenance
//   no drill_name, description or coaching field is edited
//   nothing outside Hitting / Fielding (Infield) / Throwing
//
// WHY ONLY THREE CATEGORIES
//
// Classifying 208 rows in one write means 208 chances to be wrong at once, and
// a demotion that is wrong is a drill a coach can no longer find. The three
// categories here are the ones the audit reached high confidence on and the
// ones the brief named. The other 97 rows keep resource_kind NULL and behave
// exactly as they do today.
//
// THE COVERAGE FLOOR — read this before changing MIN_SURVIVING
//
// Demoting a drill removes it from the prescription pool. problem_taxonomy maps
// problems to drills, and the standing rule for this library is that no problem
// may reach zero prescribable drills: coverage beats quality, because a coach
// asking for help and being told nothing is the worst outcome available.
//
// So this script computes, for every problem slug, how many drills would SURVIVE
// the demotions it is about to make. If any slug would fall below MIN_SURVIVING
// it writes NOTHING and prints the slugs. That is a refusal, not a warning — a
// check that can be scrolled past is not a control.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npm run apply:canon-pilot -- --apply
//
// Without --apply it prints the whole plan and touches nothing.

import { createClient } from '@supabase/supabase-js'
import { loadDecisions, effectiveKind, schedulableAfter } from './build-canon-audit'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

/**
 * Phase 1's pilot. Kept as a named constant because the tests assert that the
 * pilot wrote these three and nothing else.
 */
export const PILOT_CATEGORIES = ['Hitting', 'Fielding (Infield)', 'Throwing']

/**
 * Every skill_category in the library, in the order Phase 2A works through
 * them. Catching and Fly Balls lead because they carry the coverage blockers.
 *
 * Which ones a run actually touches comes from --categories on the command
 * line, defaulting to the pilot. One batch at a time is the whole safety
 * model: a demotion that starves a problem stops that batch, and the batches
 * before it stay written.
 */
export const ALL_CATEGORIES = [
  'Catching', 'Fielding (Fly Balls)', 'Pitching', 'Baserunning', 'Bunting',
  'Team Defense', 'Soft Toss', 'Warmup', 'Arm Care', 'Athletic Development',
  ...PILOT_CATEGORIES,
]

/** Categories this run is allowed to write, from --categories or the pilot. */
export function requestedCategories(argv: string[] = process.argv): string[] {
  const flag = argv.find(a => a.startsWith('--categories='))
  if (!flag) return PILOT_CATEGORIES
  const raw = flag.slice('--categories='.length)
  if (raw === 'all') return ALL_CATEGORIES
  const asked = raw.split('|').map(s => s.trim()).filter(Boolean)
  const unknown = asked.filter(c => !ALL_CATEGORIES.includes(c))
  if (unknown.length) {
    console.error(`Unknown skill_category: ${unknown.join(', ')}`)
    console.error(`Known: ${ALL_CATEGORIES.join(' | ')}`)
    process.exit(1)
  }
  return asked
}

/**
 * The fewest drills a taxonomy problem may be left with.
 *
 * One, not two: the rule is that no problem reaches ZERO. Setting it higher
 * would be a stricter quality bar than the library can currently meet and would
 * block the whole pilot over problems that were already thin before this change.
 */
export const MIN_SURVIVING = 1

/** Family display names for the slugs the pilot introduces. */
export const FAMILY_NAMES: Record<string, { name: string; skill: string }> = {
  'hitting-front-toss': { name: 'Front Toss', skill: 'hitting' },
  'hitting-high-tee': { name: 'High Tee', skill: 'hitting' },
  'hitting-one-hand': { name: 'One-Hand Hitting', skill: 'hitting' },
  'hitting-stance': { name: 'Stance and Athletic Position', skill: 'hitting' },
  'throwing-crow-hop': { name: 'Crow Hop', skill: 'throwing' },
  'throwing-first-catch': { name: 'First Catch Fundamentals', skill: 'throwing' },
  'throwing-funnel': { name: 'Funnel', skill: 'throwing' },
  'throwing-long-toss': { name: 'Long Toss', skill: 'throwing' },
  'throwing-knee-hip-full': { name: 'Knee, Hip, Full Throwing Progression', skill: 'throwing' },
}

async function main() {
  if (!URL || !KEY) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } })

  const decisions = loadDecisions()
  const byId = new Map(decisions.map(d => [d.drill_id, d]))

  const { data: drills, error } = await sb
    .from('drill_resources')
    .select('id, drill_name, skill_category, resource_kind, activity_family_id, variation_type')
    .is('created_by_coach_id', null)
  if (error || !drills) {
    console.error('Could not read drill_resources:', error?.message)
    process.exit(1)
  }

  const CATEGORIES = requestedCategories()
  const inPilot = (drills as any[]).filter(d => CATEGORIES.includes(d.skill_category))
  console.log(`categories this run: ${CATEGORIES.join(' | ')}`)
  console.log(`${drills.length} curated rows, ${inPilot.length} in scope.\n`)

  // ── what would change ─────────────────────────────────────────────────────
  const { data: families } = await sb.from('drill_activity_families').select('id, slug')
  const familyId = new Map((families || []).map((f: any) => [f.slug, f.id]))

  const newFamilies = Array.from(new Set(
    inPilot.map(d => byId.get(d.id)?.family_slug).filter(Boolean) as string[]
  )).filter(slug => !familyId.has(slug))

  const updates: Array<{ id: string; name: string; patch: Record<string, any> }> = []
  for (const d of inPilot) {
    const dec = byId.get(d.id)
    if (!dec) { console.error(`No decision for ${d.id} — run npm run audit:canon first.`); process.exit(1) }

    const patch: Record<string, any> = {}
    const kind = effectiveKind(dec, decisions)
    // REVIEW_REQUIRED maps to '' and must stay NULL: an unreviewed row keeps
    // working. Writing nothing is the decision, not an omission.
    if (kind && d.resource_kind !== kind) patch.resource_kind = kind
    if (dec.family_slug) patch.activity_family_id = dec.family_slug   // resolved below
    if (dec.variation_type) patch.variation_type = dec.variation_type

    if (Object.keys(patch).length) updates.push({ id: d.id, name: d.drill_name, patch })
  }

  const demoting = inPilot.filter(d => {
    const dec = byId.get(d.id)!
    return !schedulableAfter(dec.disposition)
  })

  console.log(`families to create : ${newFamilies.length}${newFamilies.length ? ' — ' + newFamilies.join(', ') : ''}`)
  console.log(`rows to update     : ${updates.length}`)
  console.log(`rows demoted       : ${demoting.length}`)
  console.log(`rows deleted       : 0 (this script has no delete path)\n`)

  // ── the coverage floor ────────────────────────────────────────────────────
  const demotedIds = new Set(demoting.map(d => d.id))
  const { data: maps } = await sb.from('drill_problem_map').select('drill_id, problem_slug')

  const total = new Map<string, number>()
  const surviving = new Map<string, number>()
  for (const m of (maps || []) as any[]) {
    total.set(m.problem_slug, (total.get(m.problem_slug) || 0) + 1)
    if (!demotedIds.has(m.drill_id)) {
      surviving.set(m.problem_slug, (surviving.get(m.problem_slug) || 0) + 1)
    }
  }

  const starved = Array.from(total.keys())
    .map(slug => ({ slug, before: total.get(slug) || 0, after: surviving.get(slug) || 0 }))
    .filter(r => r.after < MIN_SURVIVING)
    .sort((a, b) => a.after - b.after || b.before - a.before)

  // Already-empty problems are not this change's doing and must not block it.
  const causedByUs = starved.filter(r => r.before >= MIN_SURVIVING)

  console.log(`taxonomy problems mapped: ${total.size}`)
  console.log(`would fall below ${MIN_SURVIVING}   : ${causedByUs.length}`)
  const thin = Array.from(total.keys())
    .map(slug => ({ slug, before: total.get(slug) || 0, after: surviving.get(slug) || 0 }))
    .filter(r => r.after !== r.before)
    .sort((a, b) => a.after - b.after)
  if (thin.length) {
    console.log(`\nproblems that lose drills (${thin.length}), thinnest first:`)
    for (const r of thin.slice(0, 15)) {
      console.log(`  ${String(r.after).padStart(3)} left (was ${String(r.before).padStart(3)})  ${r.slug}`)
    }
    if (thin.length > 15) console.log(`  ... and ${thin.length - 15} more`)
  }

  if (causedByUs.length > 0) {
    console.error(`\nREFUSING TO WRITE. These problems would be left with no prescribable drill:\n`)
    for (const r of causedByUs) console.error(`  ${r.slug}  ${r.before} -> ${r.after}`)
    console.error(
      `\nCoverage beats quality. Either curate a replacement drill onto each of ` +
      `these problems first, or change the disposition of the row that carries ` +
      `them in scripts/fixtures/drill-canon-decisions.tsv. Do not lower ` +
      `MIN_SURVIVING to get past this.`
    )
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.')
    for (const u of updates.slice(0, 8)) console.log('  ', u.name, JSON.stringify(u.patch))
    if (updates.length > 8) console.log(`   ... and ${updates.length - 8} more`)
    return
  }

  // ── write ────────────────────────────────────────────────────────────────
  for (const slug of newFamilies) {
    const meta = FAMILY_NAMES[slug]
    if (!meta) { console.error(`No display name for family "${slug}" — add it to FAMILY_NAMES.`); process.exit(1) }
    const { data, error: e } = await sb
      .from('drill_activity_families')
      .insert({ slug, name: meta.name, primary_skill: meta.skill })
      .select('id, slug')
      .single()
    if (e || !data) { console.error(`Could not create family ${slug}:`, e?.message); process.exit(1) }
    familyId.set(data.slug, data.id)
    console.log(`family created: ${slug}`)
  }

  let written = 0
  for (const u of updates) {
    const patch = { ...u.patch }
    if (patch.activity_family_id) {
      const id = familyId.get(patch.activity_family_id)
      if (!id) { console.error(`Unknown family slug ${patch.activity_family_id}`); process.exit(1) }
      patch.activity_family_id = id
    }
    const { error: e } = await sb.from('drill_resources').update(patch).eq('id', u.id)
    if (e) { console.error(`Failed on ${u.name}:`, e.message); process.exit(1) }
    written++
  }

  console.log(`\n${written} rows updated, 0 deleted.`)

  // ── read back ────────────────────────────────────────────────────────────
  const { data: after } = await sb
    .from('drill_resources')
    .select('id, skill_category, resource_kind')
    .is('created_by_coach_id', null)

  const tally = new Map<string, number>()
  for (const d of (after || []) as any[]) {
    const k = d.resource_kind || '(unclassified)'
    tally.set(k, (tally.get(k) || 0) + 1)
  }
  console.log(`\nlibrary now:`)
  for (const [k, n] of Array.from(tally.entries()).sort()) console.log(`  ${k.padEnd(18)} ${n}`)
  console.log(`  total              ${after?.length ?? 0}`)
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
