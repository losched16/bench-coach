// Turn the Speed & Agility fixture into SQL — and refuse to, if it does not
// hold up.
//
//   npm run emit:speed-pathway     writes migrations/074_speed_agility_pathway.sql
//
// Read-only against production. Writes a file, never a row.
//
// Same shape as scripts/emit-pathways.ts, and the same reason: the thing that
// generates the SQL is also the thing that refuses to generate it. A check that
// runs after the migration is written is a check somebody can decide to ignore.
//
// WHAT IS DIFFERENT HERE
//
// 070's emitter could assume every drill already existed. This one cannot — the
// library holds almost no movement content (see the Phase 2H audit), so stages
// 1-7 bring their own drills. That means a name in the fixture may resolve
// either to a production row or to a row this migration is about to create, and
// both have to be checked differently:
//
//   an EXISTING name    must resolve to exactly one schedulable production row
//   a NEW name          must NOT already exist under that name, or we are
//                       inserting a duplicate into a library that has spent
//                       four phases removing them
//
// It also refuses on the vocabulary that got 071 rejected by production:
// practice_roles, activity_format, space, and the rest are CHECK-constrained,
// and 'prepare' is a pathway sequence word that is not a drill role.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { isSchedulable } from '../lib/drills'
import type { StageDrillRole } from '../lib/developmentPathways'
import { NEW_DRILLS, SPEED_PATHWAY, NewDrillSpec } from './fixtures/speed-agility'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OUT = 'migrations/074_speed_agility_pathway.sql'

const problems: string[] = []
const fail = (where: string, what: string) => problems.push(`${where}: ${what}`)

const q = (v: string | null | undefined) =>
  v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const qArr = (v: string[] | undefined) =>
  !v || v.length === 0 ? `'{}'` : `ARRAY[${v.map(q).join(', ')}]`

/**
 * A stable UUID for a new drill, derived from its name.
 *
 * RFC 4122 v5 against a fixed namespace, so re-running the emitter produces the
 * same ids and the migration stays idempotent through ON CONFLICT (id). A
 * random id would make every regeneration insert the library again.
 */
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8' // the DNS namespace
function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const s = h.subarray(0, 16).toString('hex')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

// The CHECK-constrained vocabularies, copied from production. 071 shipped
// practice_roles = {teach,prepare} past a constraint-free local stub and was
// rejected on the first production apply.
const ROLES = ['warmup', 'teach', 'isolate', 'repetition', 'progress', 'decision',
  'competition', 'game_application', 'team_execution', 'assessment', 'finish']

// AND THE OTHER ONE. These two lists overlap at 'assessment' and
// 'game_application' and diverge everywhere else, which is what makes them easy
// to mix up: 'competition' is a legitimate practice_role and NOT a stage-drill
// role, exactly as 'prepare' is a legitimate pathway step and not a practice
// role. Both mistakes have now been made once. Source of truth is
// lib/developmentPathways.StageDrillRole and the CHECK in migration 069.
const STAGE_DRILL_ROLES: StageDrillRole[] =
  ['primary', 'regression', 'reinforcement', 'progression', 'assessment', 'game_application']
const FORMATS = ['individual', 'partner', 'small_group', 'station', 'full_team', 'game']
const SPACES = ['Small', 'Medium', 'Large', 'Full Field']
const LEVELS = ['low', 'medium', 'high']

const EMPTY_RATIONALE = [
  /\b(same|matching|right|correct)\s+(skill[_ ])?category\b/i,
  /\bcategory (matches|is the same|fits)\b/i,
  /\bbecause it is (a|an) \w+ drill\b/i,
  /^(it|this) (fits|works|is good|is useful|belongs)\b/i,
  /^good (drill|fit|option)\b/i,
]

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: drillRows, error } = await sb
    .from('drill_resources').select('*').is('created_by_coach_id', null)
  if (error) { console.error(error.message); process.exit(1) }
  const existing = drillRows || []

  const { data: probRows } = await sb.from('problem_taxonomy').select('slug')
  const knownProblems = new Set((probRows || []).map((p: any) => p.slug))

  // ── the new drills ────────────────────────────────────────────────────────

  const byName = new Map<string, any[]>()
  for (const d of existing) {
    const k = d.drill_name.trim().toLowerCase()
    byName.set(k, [...(byName.get(k) || []), d])
  }

  const newIds = new Map<string, string>()
  for (const d of NEW_DRILLS) {
    const key = d.name.trim().toLowerCase()
    if (byName.has(key)) {
      fail(d.name, 'already exists in the library — this would be a duplicate row, not a new drill')
      continue
    }
    newIds.set(key, uuidv5(d.name))

    // Vocabulary, before production gets a chance to reject it.
    for (const r of d.practiceRoles) {
      if (!ROLES.includes(r)) fail(d.name, `practice_role '${r}' is not in the CHECK constraint`)
    }
    if (!FORMATS.includes(d.activityFormat)) fail(d.name, `activity_format '${d.activityFormat}' invalid`)
    if (!SPACES.includes(d.space)) fail(d.name, `space_required '${d.space}' invalid`)
    for (const [label, v] of [['rep_density', d.repDensity], ['idle_time_risk', d.idleRisk],
      ['engagement_level', d.engagement], ['physical_intensity', d.physicalIntensity],
      ['instruction_complexity', d.instructionComplexity]] as const) {
      if (!LEVELS.includes(v)) fail(d.name, `${label} '${v}' invalid`)
    }
    if (d.minAge > d.maxAge) fail(d.name, 'min_age is above max_age')
    if (d.minPlayers < 1) fail(d.name, 'min_players must be at least 1')

    // Instruction quality, matching the Phase 2C bar. A drill nobody can run
    // from the text is a drill that needs a video, and this pathway is not
    // allowed to depend on one.
    if (d.description.length < 200) fail(d.name, 'description is too short to run the drill from')
    if (d.coachingNotes.length < 200) fail(d.name, 'coaching notes are too thin')
    if (d.successMarkers.length < 2) fail(d.name, 'needs at least two success markers')
    if (!d.repsGuidance.trim()) fail(d.name, 'no reps guidance — youth speed work lives or dies on volume')
    if (!d.regression.trim()) fail(d.name, 'no regression')
    if (!d.progression.trim()) fail(d.name, 'no progression')

    for (const p of d.problems || []) {
      if (!knownProblems.has(p)) fail(d.name, `problem slug '${p}' is not in problem_taxonomy`)
    }

    // No invented media, ever.
    const blob = JSON.stringify(d)
    if (/youtube|youtu\.be|https?:\/\//i.test(blob)) {
      fail(d.name, 'contains a URL — media is attached through the media system, never inline')
    }
  }

  // ── resolve every drill the pathway names ─────────────────────────────────

  interface Resolved { id: string; spec: any; isNew: boolean }
  const stages = SPEED_PATHWAY.stages.map((stage, i) => {
    const n = i + 1
    const where = `${SPEED_PATHWAY.slug}/stage ${n}`

    for (const p of stage.problems) {
      if (!knownProblems.has(p)) fail(where, `problem slug '${p}' is not in problem_taxonomy`)
    }
    if (stage.masterySignals.length === 0 && !stage.review) {
      fail(where, 'no mastery signal and not marked for review — a coach has no gate for advancing')
    }

    const drills: Resolved[] = []
    for (const spec of stage.drills) {
      const key = spec.drill.trim().toLowerCase()

      if (!STAGE_DRILL_ROLES.includes(spec.role)) {
        fail(where, `'${spec.drill}' has stage-drill role '${spec.role}', which is not one of ` +
          `${STAGE_DRILL_ROLES.join(', ')} — that word belongs to practice_roles, not here`)
      }

      if (!spec.rationale || spec.rationale.trim().length < 40) {
        fail(where, `rationale for '${spec.drill}' is missing or too short to say anything`)
      } else if (EMPTY_RATIONALE.some(re => re.test(spec.rationale))) {
        fail(where, `rationale for '${spec.drill}' says nothing: "${spec.rationale}"`)
      }

      if (newIds.has(key)) { drills.push({ id: newIds.get(key)!, spec, isNew: true }); continue }

      const matches = byName.get(key) || []
      if (matches.length === 0) { fail(where, `drill '${spec.drill}' does not exist`); continue }
      if (matches.length > 1) { fail(where, `drill '${spec.drill}' is ambiguous (${matches.length} rows)`); continue }
      if (!isSchedulable(matches[0])) {
        fail(where, `drill '${spec.drill}' is not schedulable (resource_kind=${matches[0].resource_kind})`)
        continue
      }
      drills.push({ id: matches[0].id, spec, isNew: false })
    }

    if (!drills.some(d => d.spec.role === 'primary') && !stage.review) {
      fail(where, 'no primary drill and not marked for review')
    }
    // A drill may hold more than one role in a stage, but not the same role twice.
    const seen = new Set<string>()
    for (const d of drills) {
      const k = `${d.id}|${d.spec.role}`
      if (seen.has(k)) fail(where, `'${d.spec.drill}' appears twice in the same role`)
      seen.add(k)
    }

    return { stage, n, drills }
  })

  const keys = SPEED_PATHWAY.stages.map(s => s.key)
  if (new Set(keys).size !== keys.length) fail(SPEED_PATHWAY.slug, 'duplicate stage key')

  // ── refuse, or emit ───────────────────────────────────────────────────────

  if (problems.length) {
    console.error(`\nREFUSING TO EMIT — ${problems.length} problem(s):\n`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('')
    process.exit(1)
  }

  const reused = new Set(stages.flatMap(s => s.drills.filter(d => !d.isNew).map(d => d.id)))
  const created = new Set(stages.flatMap(s => s.drills.filter(d => d.isNew).map(d => d.id)))
  const unusedNew = NEW_DRILLS.filter(d => !created.has(newIds.get(d.name.trim().toLowerCase())!))
  if (unusedNew.length) {
    console.error(`\nREFUSING TO EMIT — ${unusedNew.length} new drill(s) are written but never used by a stage:`)
    for (const d of unusedNew) console.error(`  ✗ ${d.name}`)
    console.error('\nA canonical drill added for a pathway that does not reference it is library debt.\n')
    process.exit(1)
  }

  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('-- ============================================================================')
  w('-- Migration 074: Speed & Agility Development')
  w('-- ============================================================================')
  w('-- GENERATED by scripts/emit-speed-pathway.ts from')
  w('-- scripts/fixtures/speed-agility.ts. Edit the fixture, not this file.')
  w('--')
  w('-- The emitter refuses to produce this file if a drill name does not resolve,')
  w('-- resolves to more than one row, resolves to something unschedulable, or')
  w('-- names a drill it is also creating (a duplicate); if a taxonomy problem does')
  w('-- not exist; if a stage has no primary drill or no mastery signal; if a')
  w('-- rationale says nothing; if a new drill breaks one of the CHECK-constrained')
  w('-- vocabularies; or if any field contains a URL.')
  w('--')
  w(`-- ${NEW_DRILLS.length} new canonical drills. The library holds almost no movement`)
  w('-- content — two rows under Athletic Development, one of which is a stretching')
  w('-- routine — so stages 1-7 could not be built from it. Stages 8-10 are built')
  w(`-- entirely from drills that already existed: ${reused.size} of them.`)
  w('--')
  w('-- NO EXISTING DRILL ROW IS MODIFIED OR DELETED. No media is attached, no')
  w('-- timestamp is written, and nothing is marked verified.')
  w('--')
  w('-- Idempotent. The drills insert ON CONFLICT (id) DO NOTHING with ids derived')
  w('-- from their names; the pathway is deleted by slug first, which cascades to')
  w('-- its own stages and links and reaches nothing outside them.')
  w('-- ============================================================================')
  w()
  w('BEGIN;')
  w()
  w('-- ── 1. the drills the library did not have ──────────────────────────────')
  w()
  w('INSERT INTO public.drill_resources (')
  w('  id, drill_name, skill_category, primary_skill, secondary_skill,')
  w('  description, ai_coaching_notes, safety_notes, success_markers,')
  w('  reps_guidance, regression_notes, progression_notes,')
  w('  mechanic_focus, common_flaws_fixed, tags,')
  w('  age_range, min_age, max_age, difficulty_level, progression_level,')
  w('  competition_level, equipment_needed, indoor_outdoor, space_required,')
  w('  requires_partner, est_duration_minutes, activity_format, practice_roles,')
  w('  min_players, max_players, ideal_group_size, min_coaches, station_friendly,')
  w('  rep_density, idle_time_risk, engagement_level, competition_style,')
  w('  instruction_complexity, throwing_load, physical_intensity,')
  w('  mixed_skill_friendly, resource_kind, status, source, created_by_coach_id')
  w(') VALUES')

  const drillValues = NEW_DRILLS.map((d: NewDrillSpec) => {
    const id = newIds.get(d.name.trim().toLowerCase())!
    return '(' + [
      q(id), q(d.name), q(d.skillCategory), q(d.primarySkill), q(d.secondarySkill),
      q(d.description), q(d.coachingNotes), q(d.safetyNotes ?? null), qArr(d.successMarkers),
      q(d.repsGuidance), q(d.regression), q(d.progression),
      qArr(d.mechanicFocus), qArr(d.commonFlaws), qArr(d.tags),
      q(`${d.minAge}-${d.maxAge}`), d.minAge, d.maxAge, q(d.difficulty),
      d.progressionLevel ?? 'NULL',
      q('both'), qArr(d.equipment), q(d.indoorOutdoor), q(d.space),
      d.requiresPartner, d.minutes, q(d.activityFormat), qArr(d.practiceRoles),
      d.minPlayers, 'NULL', d.idealGroupSize, d.minCoaches, d.stationFriendly,
      q(d.repDensity), q(d.idleRisk), q(d.engagement), q(d.competitionStyle),
      q(d.instructionComplexity), q('none'), q(d.physicalIntensity),
      d.mixedSkillFriendly, q('activity'), q('approved'), q('benchcoach_original'), 'NULL',
    ].join(',') + ')'
  })
  drillValues.forEach((v, i) => {
    w(`-- ${NEW_DRILLS[i].name}`)
    w(v + (i === drillValues.length - 1 ? '' : ','))
  })
  w('ON CONFLICT (id) DO NOTHING;')
  w()

  const mappings = NEW_DRILLS.flatMap(d =>
    (d.problems || []).map(p => ({ id: newIds.get(d.name.trim().toLowerCase())!, p })))
  if (mappings.length) {
    w('-- ── 2. taxonomy mappings ────────────────────────────────────────────────')
    w('--')
    w('-- Deliberately few. A drill mapped to a problem it only half answers makes')
    w('-- retrieval worse for the problem, not better for the drill. Only the')
    w('-- first-step drills map, because slow-first-step is the one existing slug')
    w('-- these genuinely answer. No new problem slug is proposed here.')
    w('INSERT INTO public.drill_problem_map (drill_id, problem_slug, sort_order, curated) VALUES')
    mappings.forEach((m, i) =>
      w(`  (${q(m.id)}, ${q(m.p)}, 5, true)${i === mappings.length - 1 ? '' : ','}`))
    w('ON CONFLICT DO NOTHING;')
    w()
  }

  w('-- ── 3. the pathway ──────────────────────────────────────────────────────')
  w(`DELETE FROM public.development_pathways WHERE slug = ${q(SPEED_PATHWAY.slug)};`)
  w()
  w('INSERT INTO public.development_pathways')
  w('  (slug, name, skill_category, summary, applicability, min_age, max_age, version, status, provenance)')
  w('VALUES (')
  w(`  ${q(SPEED_PATHWAY.slug)}, ${q(SPEED_PATHWAY.name)}, ${q(SPEED_PATHWAY.skillCategory)},`)
  w(`  ${q(SPEED_PATHWAY.summary)},`)
  w(`  ${q(SPEED_PATHWAY.applicability)},`)
  w(`  ${SPEED_PATHWAY.minAge ?? 'NULL'}, ${SPEED_PATHWAY.maxAge ?? 'NULL'}, 1, 'published',`)
  w(`  ${q(SPEED_PATHWAY.provenance)}`)
  w(');')
  w()

  for (const { stage, n, drills } of stages) {
    w(`-- stage ${n}: ${stage.name}`)
    w('INSERT INTO public.development_pathway_stages')
    w('  (pathway_id, stage_number, stage_key, name, objective, why_it_matters,')
    w('   mastery_signals, common_failure_modes, coaching_emphasis,')
    w('   estimated_practices_min, estimated_practices_max, notes)')
    w('SELECT p.id,')
    w(`  ${n}, ${q(stage.key)}, ${q(stage.name)},`)
    w(`  ${q(stage.objective)},`)
    w(`  ${q(stage.whyItMatters)},`)
    w(`  ${qArr(stage.masterySignals)},`)
    w(`  ${qArr(stage.commonFailureModes)},`)
    w(`  ${q(stage.coachingEmphasis ?? null)},`)
    w(`  ${stage.practicesMin ?? 'NULL'}, ${stage.practicesMax ?? 'NULL'},`)
    w(`  ${q(stage.review ?? null)}`)
    w(`FROM public.development_pathways p WHERE p.slug = ${q(SPEED_PATHWAY.slug)};`)
    w()
    for (const d of drills) {
      w('INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)')
      w(`SELECT s.id, ${q(d.id)}, ${q(d.spec.role)}, ${d.spec.rank ?? 1},`)
      w(`  ${q(d.spec.rationale)}`)
      w('FROM public.development_pathway_stages s')
      w('JOIN public.development_pathways p ON p.id = s.pathway_id')
      w(`WHERE p.slug = ${q(SPEED_PATHWAY.slug)} AND s.stage_key = ${q(stage.key)};`)
      w()
    }
    for (const slug of stage.problems) {
      w('INSERT INTO public.development_pathway_stage_problems (stage_id, problem_slug)')
      w(`SELECT s.id, ${q(slug)}`)
      w('FROM public.development_pathway_stages s')
      w('JOIN public.development_pathways p ON p.id = s.pathway_id')
      w(`WHERE p.slug = ${q(SPEED_PATHWAY.slug)} AND s.stage_key = ${q(stage.key)};`)
      w()
    }
  }

  w('COMMIT;')
  w()
  w('-- ── verification ────────────────────────────────────────────────────────')
  w('SELECT')
  w(`  (SELECT count(*) FROM public.development_pathways WHERE slug = ${q(SPEED_PATHWAY.slug)})    AS pathway,`)
  w('  (SELECT count(*) FROM public.development_pathway_stages s')
  w('     JOIN public.development_pathways p ON p.id = s.pathway_id')
  w(`     WHERE p.slug = ${q(SPEED_PATHWAY.slug)})                                                  AS stages,`)
  w('  (SELECT count(*) FROM public.development_pathway_stage_drills sd')
  w('     JOIN public.development_pathway_stages s ON s.id = sd.stage_id')
  w('     JOIN public.development_pathways p ON p.id = s.pathway_id')
  w(`     WHERE p.slug = ${q(SPEED_PATHWAY.slug)})                                                  AS stage_drills,`)
  w(`  (SELECT count(*) FROM public.drill_resources WHERE source = 'benchcoach_original'`)
  w(`     AND skill_category = 'Athletic Development')                                            AS movement_drills,`)
  w('  (SELECT count(*) FROM public.drill_resources)                                              AS drills_total;')

  writeFileSync(OUT, lines.join('\n') + '\n')

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`\n${SPEED_PATHWAY.name} — ${stages.length} stages\n`)
  console.log('  #  stage                            drills  new  reused  primary')
  console.log('  ' + '─'.repeat(66))
  for (const { stage, n, drills } of stages) {
    console.log(
      '  ' + String(n).padStart(2) + '  ' + stage.name.slice(0, 32).padEnd(33) +
      String(drills.length).padStart(5) +
      String(drills.filter(d => d.isNew).length).padStart(5) +
      String(drills.filter(d => !d.isNew).length).padStart(8) +
      String(drills.filter(d => d.spec.role === 'primary').length).padStart(9))
  }
  console.log('  ' + '─'.repeat(66))
  console.log(`\n  ${created.size} drills created, ${reused.size} existing drills reused`)
  console.log(`  ${stages.reduce((n, s) => n + s.drills.length, 0)} stage-drill links`)
  const thin = stages.filter(s => s.drills.length < 3)
  console.log(thin.length
    ? `  ${thin.length} stage(s) under 3 drills: ${thin.map(s => s.stage.key).join(', ')}`
    : '  every stage has at least 3 drills')
  console.log(`\n  ${OUT}\n`)
}

main()
