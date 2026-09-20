// Phase 2H — the contract the player development surfaces depend on, against
// production.
//
//   npm run verify:player-pathways-prod
//
// Read-only. Exits non-zero if the UI's assumptions do not hold against live
// data; exits 0 with a clear notice if the tables are not there yet, because
// "not deployed" is a different answer from "wrong".
//
// STRUCTURAL, NOT NUMERIC — STILL THE 2F LESSON
//
// Phase 2F's verifier asserted `pathways.length === 4`, a number written when
// the brief asked for four. It PASSED at four of seven and FAILED at seven: a
// check that went green while the deployment was incomplete.
//
// So the counts below are PRINTED. The only numbers asserted are the ones where
// the number IS the invariant — zero stages with no objective, zero links that
// do not resolve — because zero stays right however much content is added.
//
// The one exception is the four speed metric presets, and it is asserted
// because it is a closed set the pathway names explicitly. If a fifth benchmark
// is ever added, this line is supposed to fail and be updated deliberately.

import { createClient } from '@supabase/supabase-js'
import { loadPathways, loadPathway, orderedStages } from '../lib/developmentPathways'
import { isSchedulable, DrillRecord } from '../lib/drills'
import { SPEED_METRIC_SLUGS } from '../lib/playerPathways'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SPEED_SLUG = 'speed-and-agility-development'

let failures = 0
function check(label: string, ok: boolean, evidence = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(64)} ${evidence}`)
  if (!ok) failures++
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  // ── is 072 there at all ───────────────────────────────────────────────────
  const { error: tableErr } = await sb
    .from('player_pathway_progress').select('id').limit(1)
  if (tableErr && /does not exist|schema cache/i.test(tableErr.message)) {
    console.log('\nMigration 072 has not been applied to this database.')
    console.log('Player development tracking is not deployed yet — nothing to verify.\n')
    process.exit(0)
  }

  console.log('')

  // ── the tables are private ───────────────────────────────────────────────
  //
  // This is the most important check in the file. The pathway tables in 069 are
  // deliberately world-readable because a curriculum is not private. These two
  // hold named children and must behave the opposite way. The anon key is
  // exactly the credential an unauthenticated visitor would have.
  const { data: leaked, error: rlsErr } = await sb
    .from('player_pathway_progress').select('id, player_id').limit(5)
  check('an anonymous caller reads NO player enrollments',
    (leaked || []).length === 0,
    rlsErr ? `blocked: ${rlsErr.message.slice(0, 40)}` : `${(leaked || []).length} rows visible`)

  const { data: leakedEvents } = await sb
    .from('player_pathway_events').select('id').limit(5)
  check('an anonymous caller reads NO player history',
    (leakedEvents || []).length === 0, `${(leakedEvents || []).length} rows visible`)

  // ── the speed benchmarks ─────────────────────────────────────────────────
  const { data: metrics } = await sb
    .from('metric_types').select('slug, label, unit, direction, coach_id')
    .is('coach_id', null).in('slug', SPEED_METRIC_SLUGS as unknown as string[])
  const bySlug = new Map((metrics || []).map((m: any) => [m.slug, m]))

  check('all four speed benchmarks exist as system presets',
    SPEED_METRIC_SLUGS.every(s => bySlug.has(s)),
    SPEED_METRIC_SLUGS.filter(s => !bySlug.has(s)).join(', ') || 'all present')

  check('each appears exactly once',
    (metrics || []).length === SPEED_METRIC_SLUGS.length,
    `${(metrics || []).length} rows for ${SPEED_METRIC_SLUGS.length} slugs`)

  // Direction is load-bearing: get it wrong and every improvement on a child's
  // page renders as a regression.
  for (const [slug, want] of [
    ['sprint_10y', 'lower'], ['sprint_20y', 'lower'],
    ['home_to_first', 'lower'], ['broad_jump', 'higher'],
  ] as const) {
    const m = bySlug.get(slug)
    check(`${slug} reads '${want} is better'`, m?.direction === want, m?.direction || 'missing')
  }

  // ── the speed pathway ────────────────────────────────────────────────────
  const pathways = await loadPathways(sb)
  const speedMeta = pathways.find(p => p.slug === SPEED_SLUG)
  check('the Speed & Agility pathway is published', !!speedMeta,
    speedMeta ? `v${(speedMeta as any).version ?? 1}` : 'not found')

  const { data: drillRows } = await sb
    .from('drill_resources').select('*').is('created_by_coach_id', null)
  const drills = (drillRows || []) as DrillRecord[]
  const byId = new Map(drills.map(d => [d.id, d]))

  let speedStages = 0
  let speedLinks = 0
  let movementDrills = 0

  if (speedMeta) {
    const p = await loadPathway(sb, SPEED_SLUG)
    check('it loads through the same loader the UI uses', !!p)

    if (p) {
      const stages = orderedStages(p)
      speedStages = stages.length

      check('it has at least one stage', stages.length > 0, `${stages.length} stages`)
      check('stage numbers start at 1 and are contiguous',
        stages.every((s, i) => s.stage_number === i + 1),
        stages.map(s => s.stage_number).join(','))
      check('stage keys are unique',
        new Set(stages.map(s => s.stage_key)).size === stages.length)

      // A stage_key is the durable identity a player's progress row points at.
      // An empty or whitespace key would make that pointer meaningless.
      check('every stage key is a real, non-empty identifier',
        stages.every(s => !!(s.stage_key || '').trim()))

      const noObjective = stages.filter(s => !(s.objective || '').trim())
      check('every stage has an objective',
        noObjective.length === 0, noObjective.map(s => s.stage_key).join(', ') || 'all present')

      // The detail page renders these as checkboxes. A stage with none gives a
      // coach no way to record an observation at all.
      const noSignals = stages.filter(s => !(s.mastery_signals || []).length)
      check('every stage has at least one mastery signal',
        noSignals.length === 0, noSignals.map(s => s.stage_key).join(', ') || 'all present')

      const unresolved: string[] = []
      const unschedulable: string[] = []
      const noPrimary: string[] = []
      for (const s of stages) {
        const links = p.linksByStage.get(s.id) || []
        speedLinks += links.length
        if (!links.some(l => l.role === 'primary')) noPrimary.push(s.stage_key)
        for (const l of links) {
          const d = byId.get(l.drill_id)
          if (!d) { unresolved.push(`${s.stage_key}/${l.drill_id.slice(0, 8)}`); continue }
          if (!isSchedulable(d)) unschedulable.push(`${s.stage_key}/${d.drill_name}`)
        }
      }
      check('every stage-drill link resolves to a real drill',
        unresolved.length === 0, unresolved.join(', ') || 'all resolve')
      check('nothing linked is a collection, tutorial or duplicate',
        unschedulable.length === 0, unschedulable.join(', ') || 'all schedulable')
      check('every stage has something to teach with',
        noPrimary.length === 0, noPrimary.join(', ') || 'all have a primary')

      // The retest is the point of stage 10. If the assessment drill were to
      // fall off, the pathway would end without measuring anything.
      const last = stages[stages.length - 1]
      const lastLinks = p.linksByStage.get(last.id) || []
      check('the final stage carries an assessment drill',
        lastLinks.some(l => l.role === 'assessment'),
        `stage ${last.stage_number}: ${lastLinks.map(l => l.role).join(', ')}`)
    }
  }

  // ── the movement drills ──────────────────────────────────────────────────
  const movement = drills.filter(d => d.skill_category === 'Athletic Development')
  movementDrills = movement.length

  // Not "19 exist" — that is a snapshot and curation will move it. What must
  // stay true is that the library HAS movement content, which it did not before.
  check('the library holds movement drills', movement.length > 0, `${movement.length} rows`)

  const noInstructions = movement.filter(d =>
    !(d.description || '').trim() || !(d.ai_coaching_notes || '').trim())
  check('every movement drill can be run from its written instructions',
    noInstructions.length === 0,
    noInstructions.map(d => d.drill_name).join(', ') || 'all have both')

  // No media dependency. The pathway must work with video absent, and nothing
  // in 2H was allowed to invent a URL or a timestamp.
  const withUrls = movement.filter(d =>
    /https?:\/\//i.test(`${d.description || ''} ${d.ai_coaching_notes || ''}`))
  check('no movement drill carries a URL in its instructions',
    withUrls.length === 0, withUrls.map(d => d.drill_name).join(', ') || 'none')

  const noThrow = movement.every((d: any) => !d.throwing_load || d.throwing_load === 'none')
  check('no movement drill adds throwing load to a young arm', noThrow)

  // ── printed, not asserted ────────────────────────────────────────────────
  console.log(`
  ── today's shape, for the record (not asserted) ──
  published pathways      ${pathways.length}
  speed pathway stages    ${speedStages}
  speed stage-drill links ${speedLinks}
  movement drills         ${movementDrills}
  curated drills          ${drills.length}
`)

  console.log(`${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
