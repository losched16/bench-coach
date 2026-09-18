// Phase 2G — the contract the pathway UI depends on, checked against production.
//
//   npm run verify:pathway-ui-prod
//
// Read-only. Exits non-zero if the UI's assumptions do not hold against live
// data; exits 0 with a clear notice if the pathway tables are not there at all,
// because "not deployed yet" is a different answer from "wrong".
//
// STRUCTURAL, NOT NUMERIC — THE 2F LESSON
//
// Phase 2F's verifier asserted `pathways.length === 4`, a number written when
// the brief asked for four pathways. Three more shipped and the assertion was
// never moved, so it PASSED at four of seven and FAILED at seven: a check that
// went green while the deployment was incomplete and red when it was finished.
//
// So this file asserts invariants that stay true as content grows:
//
//   - every published pathway has at least one stage        (not "70 stages")
//   - stage numbers start at 1 and are contiguous           (not "10 per pathway")
//   - every stage has an objective and a mastery signal     (not a count)
//   - every stage-drill link resolves to a schedulable row  (not "228 links")
//
// Today's counts are PRINTED for the operator and asserted only where the
// number is a deliberate invariant rather than a snapshot. The one count that
// is asserted is "zero pathways with zero stages", because zero is the
// invariant — a pathway a coach can pick and then find empty is a bug at any
// scale.

import { createClient } from '@supabase/supabase-js'
import { loadPathways, loadPathway, orderedStages, nextStage } from '../lib/developmentPathways'
import { isSchedulable, DrillRecord } from '../lib/drills'
import { stageDrillCount, stageBreadth, resolveStageNumber, neighbours } from '../lib/pathwayUi'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let failures = 0
function check(label: string, ok: boolean, evidence = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(62)} ${evidence}`)
  if (!ok) failures++
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const pathways = await loadPathways(sb)
  if (pathways.length === 0) {
    console.log('\nNo published pathways in production.')
    console.log('Either migrations 069/070 have not been applied, or every pathway is draft.')
    console.log('')
    process.exit(0)
  }

  // The drill pool the UI can reach, read the same way the app reads it.
  const { data: drillRows, error } = await sb
    .from('drill_resources').select('*').is('created_by_coach_id', null)
  if (error) { console.error(error.message); process.exit(1) }
  const drills = (drillRows || []) as DrillRecord[]
  const byId = new Map(drills.map(d => [d.id, d]))

  console.log(`\n${pathways.length} published pathways, ${drills.length} curated drills\n`)

  // ── the picker's own contract ────────────────────────────────────────────

  check('every published pathway has a slug and a name',
    pathways.every(p => !!p.slug?.trim() && !!p.name?.trim()),
    `${pathways.length} pathways`)
  check('slugs are unique',
    new Set(pathways.map(p => p.slug)).size === pathways.length)
  check('every pathway the picker lists carries a summary to list it by',
    pathways.every(p => !!(p.summary || '').trim()),
    pathways.filter(p => !(p.summary || '').trim()).map(p => p.slug).join(', ') || 'all present')
  check('every pathway has a skill category',
    pathways.every(p => !!(p.skill_category || '').trim()))

  let totalStages = 0
  let totalLinks = 0
  let emptyPathways = 0
  const focusedStages: string[] = []

  for (const meta of pathways) {
    const p = await loadPathway(sb, meta.slug)
    check(`${meta.slug}: loads through the same loader the UI uses`, !!p)
    if (!p) continue

    const stages = orderedStages(p)
    totalStages += stages.length
    if (stages.length === 0) emptyPathways++

    // A pathway a coach can pick and then find empty. Zero is the invariant.
    check(`${meta.slug}: has at least one stage`, stages.length > 0, `${stages.length} stages`)

    check(`${meta.slug}: stage numbers start at 1 and are contiguous`,
      stages.every((s, i) => s.stage_number === i + 1),
      stages.map(s => s.stage_number).join(','))

    check(`${meta.slug}: stage keys are unique`,
      new Set(stages.map(s => s.stage_key)).size === stages.length)

    // The picker renders these two on every stage. A stage missing either
    // renders an empty panel, which is the bug this catches.
    const noObjective = stages.filter(s => !(s.objective || '').trim())
    check(`${meta.slug}: every stage has an objective`,
      noObjective.length === 0, noObjective.map(s => s.stage_key).join(', ') || 'all present')

    const noSignals = stages.filter(s => !(s.mastery_signals || []).length)
    check(`${meta.slug}: every stage has at least one mastery signal`,
      noSignals.length === 0, noSignals.map(s => s.stage_key).join(', ') || 'all present')

    // Every link the picker's drill count is derived from must resolve, and
    // must resolve to something a practice may actually schedule.
    const unresolved: string[] = []
    const unschedulable: string[] = []
    for (const s of stages) {
      const links = p.linksByStage.get(s.id) || []
      totalLinks += links.length
      for (const l of links) {
        const d = byId.get(l.drill_id)
        if (!d) { unresolved.push(`${s.stage_key}/${l.drill_id.slice(0, 8)}`); continue }
        if (!isSchedulable(d)) unschedulable.push(`${s.stage_key}/${d.drill_name}`)
      }
      if (stageBreadth(stageDrillCount(p, s))) focusedStages.push(`${meta.slug}/${s.stage_key}`)
    }
    check(`${meta.slug}: every stage-drill link resolves to a real drill`,
      unresolved.length === 0, unresolved.join(', ') || 'all resolve')
    check(`${meta.slug}: nothing linked is a collection, tutorial or duplicate`,
      unschedulable.length === 0, unschedulable.join(', ') || 'all schedulable')

    // The navigator's two ends, against live data.
    const last = stages[stages.length - 1]
    check(`${meta.slug}: the final stage returns no next stage`,
      nextStage(p, last.stage_number) === null && neighbours(p, last.stage_number).next === null,
      `stage ${last.stage_number} is last`)
    check(`${meta.slug}: the first stage returns no previous stage`,
      neighbours(p, stages[0].stage_number).previous === null)

    // A stale stage number must not clamp a coach somewhere they did not pick.
    check(`${meta.slug}: a stage number past the end resolves to null, not the last stage`,
      resolveStageNumber(p, stages.length + 5) === null)
    check(`${meta.slug}: no stage asked for lands on stage 1`,
      resolveStageNumber(p, null) === stages[0].stage_number)
  }

  check('no published pathway is empty', emptyPathways === 0, `${emptyPathways} empty`)

  // ── printed, not asserted ────────────────────────────────────────────────
  //
  // These move as content is curated. An assertion on them is the 2F mistake.
  console.log(`
  ── today's shape, for the record (not asserted) ──
  published pathways   ${pathways.length}
  stages               ${totalStages}
  stage-drill links    ${totalLinks}
  focused stages       ${focusedStages.length}  (the picker labels these "Focused stage")
`)

  console.log(`${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
