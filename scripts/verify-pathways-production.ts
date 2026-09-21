// Are the pathways right in production, and did adding them change anything?
//
//   npm run verify:pathways-prod
//
// Read-only. Exits non-zero if anything is wrong; exits 0 with a clear notice
// if migrations 069/070 have not been applied yet, because "not there yet" is a
// different answer from "wrong".
//
// This covers the acceptance conditions a unit test cannot: that the stages in
// production resolve to real, schedulable drills, that the drill library is
// exactly as it was, and that a recommendation built from live data obeys the
// rules. scripts/test-pathways.ts proves the logic; this proves the content.

import { createClient } from '@supabase/supabase-js'
import { isSchedulable, DrillRecord } from '../lib/drills'
import {
  loadPathways, loadPathway, orderedStages, currentStage, nextStage,
  stageCandidates, getPathwayPracticeRecommendation, planPracticeBlock,
} from '../lib/developmentPathways'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// FLOORS, not equalities — and the history of this constant is the argument.
//
// Phase 2D left 220/154/49/393. Phase 2E moved none of it. Migration 071 added
// six drills and seven mappings. Phase 2H then added the 9U Speed & Agility
// pathway and its drills, taking the library to 245/179/49/403 — and this
// assertion was not moved, so it sat red against healthy production for three
// days. The pathway count below rotted the same way once already: written as
// four, three more were curated, and it was never updated.
//
// Twice is a design fault, not an oversight. An exact equality against a
// library that is *meant* to grow fails every time content ships, and a check
// that is expected to be red is a check nobody reads. The thing actually worth
// catching is LOSS — a curated drill deleted, demoted or unpublished outside a
// migration, quietly dropping coverage a pathway depends on. So growth is
// reported and passes; shrinkage fails.
//
// problems STAYS AN EXACT EQUALITY. 2F.7 promised no new problem slug would be
// invented as a side effect of adding drills, so movement in either direction
// is a broken promise and has to fail. That is a real invariant; the other
// three were only ever a snapshot.
const FLOOR = { curated: 245, schedulable: 179, mappings: 403 }
const EXPECTED = { problems: 49 }
/** Pathways published as of Phase 2H. Fewer means one stopped publishing. */
const PATHWAY_FLOOR = 8

let failures = 0
function check(label: string, ok: boolean, evidence: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(54)} ${evidence}`)
  if (!ok) failures++
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: rows } = await sb.from('drill_resources').select('*').is('created_by_coach_id', null)
  const { data: tax } = await sb.from('problem_taxonomy').select('slug')
  const { data: map } = await sb.from('drill_problem_map').select('drill_id')
  const pool = (rows || []) as DrillRecord[]
  const schedulable = pool.filter(d => isSchedulable(d))

  console.log('')
  // ── the drill library is untouched ────────────────────────────────────────
  /**
   * Passes at or above the floor. Says how far above when it has grown, and
   * how many are MISSING when it has not — the failing line is the one that
   * has to be readable, so it does not print "+-1".
   */
  const atLeast = (label: string, actual: number, floor: number) => {
    const d = actual - floor
    check(label, d >= 0,
      d === 0 ? `${actual}`
        : d > 0 ? `${actual} (floor ${floor}, +${d})`
          : `${actual} — ${-d} MISSING against floor ${floor}`)
  }

  atLeast('24. curated drills not lost', pool.length, FLOOR.curated)
  atLeast('24. schedulable drills not lost', schedulable.length, FLOOR.schedulable)
  // Exact, deliberately — see the note on EXPECTED.
  check('24. taxonomy unchanged', (tax || []).length === EXPECTED.problems,
    `${(tax || []).length} problems (expected exactly ${EXPECTED.problems})`)
  atLeast('24. drill-problem mappings not lost', (map || []).length, FLOOR.mappings)

  // ── are the pathways there? ───────────────────────────────────────────────
  const pathways = await loadPathways(sb)
  if (pathways.length === 0) {
    console.log('\nNo published pathways in production.')
    console.log('Migrations 069 and 070 have not been applied yet — apply them, then re-run.')
    console.log('')
    process.exit(failures > 0 ? 1 : 0)
  }

  // A floor for the same reason as the library counts above: this was written
  // as four, went to seven, then to eight with Phase 2H, and was never moved
  // either time. What matters is that none of them STOPS publishing — a
  // pathway a coach was working through disappearing mid-season is the failure
  // this is here to catch. Every pathway found is checked in full below, so a
  // new one cannot arrive unexamined just because the count is a floor.
  check('1. pathways load', pathways.length >= PATHWAY_FLOOR,
    pathways.length === PATHWAY_FLOOR
      ? `${pathways.length} published`
      : `${pathways.length} published (floor ${PATHWAY_FLOOR}, +${pathways.length - PATHWAY_FLOOR})`)

  let totalStages = 0
  let totalLinks = 0

  for (const meta of pathways) {
    const p = await loadPathway(sb, meta.slug)
    if (!p) { check(`${meta.slug} loads`, false, 'null'); continue }

    const stages = orderedStages(p)
    totalStages += stages.length

    // 2. ordered and unique
    const numbers = stages.map(s => s.stage_number)
    const contiguous = numbers.every((n, i) => n === i + 1)
    check(`2. ${meta.slug}: stages are 1..n`, contiguous, numbers.join(','))
    check(`2. ${meta.slug}: stage keys unique`,
      new Set(stages.map(s => s.stage_key)).size === stages.length, `${stages.length} stages`)

    // 11-13. navigation
    check(`11. ${meta.slug}: the first stage resolves`, currentStage(p, 1) !== null,
      currentStage(p, 1)?.name || '-')
    check(`13. ${meta.slug}: the final stage has no next`,
      nextStage(p, stages.length) === null, `stage ${stages.length}`)

    // 3-7. every link is real and schedulable
    let unresolved = 0
    let unschedulable = 0
    let noRationale = 0
    for (const s of stages) {
      for (const l of p.linksByStage.get(s.id) || []) {
        totalLinks++
        const d = pool.find(x => x.id === l.drill_id)
        if (!d) { unresolved++; continue }
        if (!isSchedulable(d)) unschedulable++
        if (!l.rationale || l.rationale.trim().length < 40) noRationale++
      }
    }
    check(`3. ${meta.slug}: every stage drill resolves`, unresolved === 0, `${unresolved} unresolved`)
    check(`4-7. ${meta.slug}: every stage drill is schedulable`, unschedulable === 0,
      `${unschedulable} would recommend a demoted row`)
    check(`${meta.slug}: every link carries a rationale`, noRationale === 0, `${noRationale} thin`)

    // 18. every stage a coach can be on has a gate to leave it
    const noMastery = stages.filter(s => (s.mastery_signals || []).length === 0)
    check(`18. ${meta.slug}: every stage has a mastery signal`, noMastery.length === 0,
      noMastery.length ? noMastery.map(s => s.name).join(', ') : `${stages.length}/${stages.length}`)

    // 8. more than one role somewhere, or the pathway is a playlist
    const roles = new Set<string>()
    for (const s of stages) for (const l of p.linksByStage.get(s.id) || []) roles.add(l.role)
    check(`8. ${meta.slug}: several roles in use`, roles.size >= 3,
      Array.from(roles).sort().join(', '))

    // A live recommendation obeys the rules.
    const mid = Math.max(1, Math.ceil(stages.length / 2))
    const rec = getPathwayPracticeRecommendation({ pathway: p, currentStage: mid, pool })
    check(`${meta.slug}: stage ${mid} recommends something`,
      !!rec && rec.recommended.length > 0,
      rec ? `${rec.recommended.length} drills, ${rec.recommended.map(r => r.step).join(' → ')}` : 'null')
    check(`4. ${meta.slug}: nothing recommended is demoted`,
      !!rec && rec.recommended.every(r => {
        const d = pool.find(x => x.id === r.drillId)
        return !!d && isSchedulable(d)
      }), 'checked against the live library')

    // 16. difficulty ranks rather than excludes — an advanced drill anywhere
    // in the pathway must still be reachable.
    const advanced = stages.flatMap(s =>
      stageCandidates(p, s, pool).filter(c => c.difficulty >= 3))
    check(`16. ${meta.slug}: advanced drills remain selectable`, advanced.length > 0,
      `${advanced.length} candidates at the top difficulty band`)

    // 14-15. a real feasibility squeeze narrows without emptying the pathway.
    const squeezed = stages.map(s =>
      stageCandidates(p, s, pool, { space: 'small', coachCount: 1, playerAge: 9 }).length)
    check(`14-15. ${meta.slug}: a one-coach small-space team still has work`,
      squeezed.some(n => n > 0),
      `${squeezed.filter(n => n > 0).length} of ${stages.length} stages runnable`)

    // 17. a three-practice block does not repeat itself where it need not.
    const block = planPracticeBlock(p, 1, 3, pool, {}, 2)
    const allIds = block.flatMap(b => b.drills.map(d => d.drillId))
    check(`17. ${meta.slug}: a 3-practice block avoids needless repetition`,
      new Set(allIds).size === allIds.length || block.some(b => /repeated/.test(b.note)),
      `${new Set(allIds).size} distinct of ${allIds.length}`)
  }

  check('the pathway layer reaches a real part of the library',
    totalLinks >= 100, `${totalLinks} stage-drill links across ${totalStages} stages`)

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`)
  if (failures) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
