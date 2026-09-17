// Turn the curated pathways into SQL — and refuse to, if they do not hold up.
//
//   npm run emit:pathways            writes migrations/070_pathway_content.sql
//   npm run audit:pathways           writes docs/audits/development-pathway-coverage.csv
//
// Read-only against production. Writes files, never rows.
//
// WHY THE EMITTER IS THE GATE
//
// Phase 2C established this shape and it earned its keep: the thing that
// generates the SQL is also the thing that refuses to generate it. A check that
// runs after the migration is written is a check somebody can decide to ignore.
//
// What it will not emit for:
//
//   * a drill name that does not resolve, or resolves to more than one row
//   * a drill that is not SCHEDULABLE — a stage may not recommend a source
//     collection, a tutorial or a true duplicate, and this is where that is
//     enforced rather than hoped for
//   * a taxonomy problem that does not exist
//   * a stage with no primary drill that is not marked for review
//   * a stage with no mastery signal that is not marked for review
//   * a rationale that is missing, too short, or says the category matched
//   * stage numbering that is not 1..n, or a duplicated key

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import { isSchedulable } from '../lib/drills'
import { PATHWAYS, PathwaySpec, StageSpec, StageDrillSpec } from './fixtures/development-pathways'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SQL_OUT = 'migrations/070_pathway_content.sql'
const CSV_OUT = 'docs/audits/development-pathway-coverage.csv'

const problems: string[] = []
const fail = (where: string, what: string) => problems.push(`${where}: ${what}`)

/** Single-quote escaping for SQL literals. The prose is full of apostrophes. */
const q = (v: string | null | undefined) =>
  v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const qArr = (v: string[]) =>
  v.length === 0 ? `'{}'` : `ARRAY[${v.map(q).join(', ')}]`

// A rationale has to say something. These are the shapes that say nothing —
// the exact failure the fixture's own header warns about.
//
// The first version of this list also held /^because /i, which flagged
// "Because the ball comes slowly there is time to coach the parts that get
// skipped at speed" — a rationale that explains itself perfectly well and
// happens to open with the word. Matching on an opening conjunction tests
// grammar, not content. The rule was wrong, not the row, so the rule changed.
const EMPTY_RATIONALE = [
  /\b(same|matching|right|correct)\s+(skill[_ ])?category\b/i,
  /\bcategory (matches|is the same|fits)\b/i,
  /\bbecause it is (a|an) \w+ drill\b/i,
  /^(it|this) (fits|works|is good|is useful|belongs)\b/i,
  /^good (drill|fit|option)\b/i,
  /^(a )?standard \w+ drill\.?$/i,
]

interface Resolved {
  spec: StageDrillSpec
  id: string
  name: string
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const mode = process.argv.includes('--audit') ? 'audit' : 'emit'
  const sb = createClient(URL, KEY)

  const { data: rows, error } = await sb.from('drill_resources').select('*')
    .is('created_by_coach_id', null)
  const { data: tax } = await sb.from('problem_taxonomy').select('slug')
  const { data: map } = await sb.from('drill_problem_map').select('drill_id, problem_slug')
  if (error || !rows) { console.error('Read failed.', error); process.exit(1) }

  const all = rows as any[]
  const schedulable = all.filter(d => isSchedulable(d))
  const knownProblems = new Set((tax || []).map((t: any) => t.slug))

  // Name -> rows, over the WHOLE curated library rather than the schedulable
  // subset, so "this drill exists but is a source collection" is a different
  // and more useful error than "no such drill".
  const byName = new Map<string, any[]>()
  for (const d of all) {
    const k = String(d.drill_name || '').trim().toLowerCase()
    byName.set(k, (byName.get(k) || []).concat([d]))
  }

  const problemsPerDrill = new Map<string, Set<string>>()
  for (const m of (map || []) as any[]) {
    const s = problemsPerDrill.get(m.drill_id) || new Set<string>()
    s.add(m.problem_slug)
    problemsPerDrill.set(m.drill_id, s)
  }

  // ── resolve and validate ──────────────────────────────────────────────────

  const resolve = (where: string, spec: StageDrillSpec): Resolved | null => {
    const key = spec.drill.trim().toLowerCase()
    const hits = byName.get(key) || []

    if (hits.length === 0) { fail(where, `no drill named "${spec.drill}"`); return null }
    if (hits.length > 1) {
      fail(where, `"${spec.drill}" matches ${hits.length} rows — name it unambiguously`)
      return null
    }
    const d = hits[0]
    if (!isSchedulable(d)) {
      fail(where,
        `"${spec.drill}" is not schedulable (resource_kind=${d.resource_kind}, ` +
        `duplicate_of=${d.duplicate_of_drill_id || 'null'}) — a stage may not recommend it`)
      return null
    }

    const r = String(spec.rationale || '').trim()
    if (r.length < 40) fail(where, `rationale for "${spec.drill}" is ${r.length} chars — say why it serves the objective`)
    else if (EMPTY_RATIONALE.some(re => re.test(r))) {
      fail(where, `rationale for "${spec.drill}" explains nothing: "${r.slice(0, 60)}…"`)
    }

    return { spec, id: d.id, name: d.drill_name }
  }

  interface StageResolved { stage: StageSpec; drills: Resolved[] }
  interface PathwayResolved { pathway: PathwaySpec; stages: StageResolved[] }

  const resolved: PathwayResolved[] = []

  for (const p of PATHWAYS) {
    const where0 = p.slug
    const keys = new Set<string>()
    const stages: StageResolved[] = []

    p.stages.forEach((s, i) => {
      const where = `${where0}/${s.key}`
      if (keys.has(s.key)) fail(where, 'duplicate stage key')
      keys.add(s.key)

      if (!s.objective || s.objective.trim().length < 20) {
        fail(where, 'objective is missing or too short to test a drill against')
      }

      for (const slug of s.problems) {
        if (!knownProblems.has(slug)) fail(where, `unknown taxonomy problem "${slug}"`)
      }

      const drills = s.drills
        .map(d => resolve(where, d))
        .filter((d): d is Resolved => d !== null)

      const hasPrimary = drills.some(d => d.spec.role === 'primary')
      if (!hasPrimary && !s.review) fail(where, 'no primary drill and no review note')
      if (s.masterySignals.length === 0 && !s.review) fail(where, 'no mastery signal and no review note')
      if (s.commonFailureModes.length === 0 && !s.review) fail(where, 'no failure modes and no review note')

      // The same drill twice in the same role inside one stage is what the
      // database's UNIQUE would reject; catching it here names the stage.
      const seen = new Set<string>()
      for (const d of drills) {
        const k = `${d.id}:${d.spec.role}`
        if (seen.has(k)) fail(where, `"${d.name}" appears twice as ${d.spec.role}`)
        seen.add(k)
      }

      stages.push({ stage: s, drills })
    })

    resolved.push({ pathway: p, stages })
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) — nothing written.\n`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('')
    process.exit(1)
  }

  // ── the coverage audit ────────────────────────────────────────────────────

  const count = (s: StageResolved, role: string) =>
    s.drills.filter(d => d.spec.role === role).length

  /**
   * How well the library actually serves this stage.
   *
   * Deliberately not a score out of ten. Four states a curator can act on:
   * READY means run it, THIN means it works but the library is short, GAP means
   * something is missing that a coach would notice, NEEDS_EDITORIAL_REVIEW
   * means the fixture itself says so.
   */
  const statusOf = (s: StageResolved): string => {
    if (s.stage.review) {
      return /^GAP/.test(s.stage.review) ? 'GAP'
        : /^THIN/.test(s.stage.review) ? 'THIN'
        : 'NEEDS_EDITORIAL_REVIEW'
    }
    const primary = count(s, 'primary')
    if (primary === 0) return 'GAP'
    if (s.stage.masterySignals.length === 0) return 'NEEDS_EDITORIAL_REVIEW'
    if (s.drills.length < 3) return 'THIN'
    return 'READY'
  }

  /**
   * How much independent evidence supports this stage's drill choices.
   *
   * A stage whose drills are all mapped to the problems the stage claims to
   * address is a stage two separate curation efforts agree about. One whose
   * drills share none of them may still be right, and is worth a second look.
   */
  const evidenceOf = (s: StageResolved): string => {
    if (s.drills.length === 0) return 'none'
    const claimed = new Set(s.stage.problems)
    const agreeing = s.drills.filter(d =>
      Array.from(problemsPerDrill.get(d.id) || []).some(p => claimed.has(p))).length
    const share = agreeing / s.drills.length
    return share >= 0.6 ? 'strong' : share >= 0.25 ? 'moderate' : 'weak'
  }

  /**
   * Why this stage is not READY, in words, always.
   *
   * "No silent gaps" has to include the ones the emitter worked out for itself.
   * A stage marked THIN by a drill count with an empty notes column is exactly
   * the silent gap the brief forbids — the reader sees a flag and no reason.
   */
  const notesFor = (s: StageResolved, status: string): string => {
    if (s.stage.review) return s.stage.review
    if (status === 'READY') return ''

    const primary = count(s, 'primary')
    const roles = Array.from(new Set(s.drills.map(d => d.spec.role))).sort()
    if (primary === 0) {
      return 'GAP. No drill in the library teaches this objective, and none has been ' +
        'attached as primary. Computed, not declared — the fixture did not flag it.'
    }
    if (s.stage.masterySignals.length === 0) {
      return 'NEEDS_EDITORIAL_REVIEW. No mastery signal, so a coach has no gate for ' +
        'advancing. Computed, not declared.'
    }
    return `THIN. Only ${s.drills.length} drill(s) serve this stage ` +
      `(roles: ${roles.join(', ')}), so a coach running it twice runs the same ` +
      'session twice. The library, not the sequence, is what is short here. ' +
      'Computed, not declared.'
  }

  const csvRows = resolved.flatMap(p => p.stages.map((s, i) => ({
    pathway: p.pathway.slug,
    stage_number: i + 1,
    stage_name: s.stage.name,
    stage_objective: s.stage.objective,
    primary_drill_count: count(s, 'primary'),
    regression_count: count(s, 'regression'),
    reinforcement_count: count(s, 'reinforcement'),
    progression_count: count(s, 'progression'),
    assessment_count: count(s, 'assessment'),
    game_application_count: count(s, 'game_application'),
    taxonomy_problem_count: s.stage.problems.length,
    mastery_signal_present: s.stage.masterySignals.length > 0 ? 'yes' : 'no',
    evidence_strength: evidenceOf(s),
    status: statusOf(s),
    gap_notes: notesFor(s, statusOf(s)),
  })))

  mkdirSync('docs/audits', { recursive: true })
  const head = Object.keys(csvRows[0])
  const cell = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  writeFileSync(CSV_OUT, head.join(',') + '\n' +
    csvRows.map(r => head.map(h => cell((r as any)[h])).join(',')).join('\n') + '\n')

  // ── report ───────────────────────────────────────────────────────────────

  console.log(`\n${resolved.length} pathways · ${csvRows.length} stages · ` +
    `${resolved.reduce((n, p) => n + p.stages.reduce((m, s) => m + s.drills.length, 0), 0)} stage-drill links\n`)
  console.log('pathway                 stages  READY  THIN  GAP  REVIEW  drills  problems')
  console.log('─'.repeat(80))
  for (const p of resolved) {
    const rs = csvRows.filter(r => r.pathway === p.pathway.slug)
    const drills = new Set(p.stages.flatMap(s => s.drills.map(d => d.id)))
    const probs = new Set(p.stages.flatMap(s => s.stage.problems))
    console.log(
      p.pathway.slug.padEnd(24) +
      String(rs.length).padStart(5) +
      String(rs.filter(r => r.status === 'READY').length).padStart(7) +
      String(rs.filter(r => r.status === 'THIN').length).padStart(6) +
      String(rs.filter(r => r.status === 'GAP').length).padStart(5) +
      String(rs.filter(r => r.status === 'NEEDS_EDITORIAL_REVIEW').length).padStart(8) +
      String(drills.size).padStart(8) +
      String(probs.size).padStart(10))
  }
  console.log('─'.repeat(80))

  const flagged = csvRows.filter(r => r.status !== 'READY')
  if (flagged.length) {
    console.log(`\n${flagged.length} stage(s) not READY — no silent gaps:`)
    for (const r of flagged) {
      console.log(`  ${r.status.padEnd(22)} ${r.pathway}/${r.stage_name}`)
      if (r.gap_notes) console.log(`      ${r.gap_notes.split('.')[0]}.`)
    }
  }

  const used = new Set(resolved.flatMap(p => p.stages.flatMap(s => s.drills.map(d => d.id))))
  console.log(`\nlibrary reach            ${used.size} of ${schedulable.length} schedulable drills appear in a pathway`)
  console.log(`${CSV_OUT}`)

  if (mode === 'audit') return

  // ── the migration ────────────────────────────────────────────────────────

  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('-- ============================================================================')
  w('-- Migration 070: the first four pathways')
  w('-- ============================================================================')
  w('-- GENERATED by scripts/emit-pathways.ts from')
  w('-- scripts/fixtures/development-pathways.ts. Edit the fixture, not this file.')
  w('--')
  w('-- The emitter refuses to produce this file if any drill name fails to resolve,')
  w('-- resolves to more than one row, or resolves to a row that is not schedulable;')
  w('-- if a taxonomy problem does not exist; if a stage has no primary drill or no')
  w('-- mastery signal without being marked for review; or if a rationale says')
  w('-- nothing. So every INSERT below has already been checked against production.')
  w('--')
  w('-- Idempotent. Re-running replaces the pathway content and nothing else: each')
  w('-- pathway is deleted by slug first, which cascades to its own stages and')
  w('-- links and reaches nothing outside them.')
  w('--')
  w('-- ZERO rows in drill_resources, problem_taxonomy or drill_problem_map are')
  w('-- created, modified or deleted by this migration.')
  w('-- ============================================================================')
  w()
  w('BEGIN;')
  w()

  for (const { pathway, stages } of resolved) {
    w(`-- ── ${pathway.name} ${'─'.repeat(Math.max(0, 66 - pathway.name.length))}`)
    w(`DELETE FROM public.development_pathways WHERE slug = ${q(pathway.slug)};`)
    w()
    w('INSERT INTO public.development_pathways')
    w('  (slug, name, skill_category, summary, applicability, min_age, max_age, version, status, provenance)')
    w('VALUES (')
    w(`  ${q(pathway.slug)}, ${q(pathway.name)}, ${q(pathway.skillCategory)},`)
    w(`  ${q(pathway.summary)},`)
    w(`  ${q(pathway.applicability)},`)
    w(`  ${pathway.minAge ?? 'NULL'}, ${pathway.maxAge ?? 'NULL'}, 1, 'published',`)
    w(`  ${q(pathway.provenance)}`)
    w(');')
    w()

    stages.forEach(({ stage, drills }, i) => {
      const n = i + 1
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
      w(`FROM public.development_pathways p WHERE p.slug = ${q(pathway.slug)};`)
      w()

      for (const d of drills) {
        w('INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)')
        w(`SELECT s.id, ${q(d.id)}, ${q(d.spec.role)}, ${d.spec.rank ?? 1},`)
        w(`  ${q(d.spec.rationale)}`)
        w('FROM public.development_pathway_stages s')
        w('JOIN public.development_pathways p ON p.id = s.pathway_id')
        w(`WHERE p.slug = ${q(pathway.slug)} AND s.stage_key = ${q(stage.key)};`)
        w(`-- ${d.name}`)
      }
      w()

      for (const slug of stage.problems) {
        w('INSERT INTO public.development_pathway_stage_problems (stage_id, problem_slug)')
        w(`SELECT s.id, ${q(slug)}`)
        w('FROM public.development_pathway_stages s')
        w('JOIN public.development_pathways p ON p.id = s.pathway_id')
        w(`WHERE p.slug = ${q(pathway.slug)} AND s.stage_key = ${q(stage.key)};`)
      }
      w()
    })

    // Prerequisites, after every stage of this pathway exists. Stage n requires
    // stage n-1: the sequence IS the prerequisite chain, and writing it as data
    // means a reader does not have to infer it from the numbering.
    w('-- prerequisites: each stage requires the one before it')
    w('UPDATE public.development_pathway_stages s')
    w('   SET prerequisite_stage_id = prev.id')
    w('  FROM public.development_pathway_stages prev, public.development_pathways p')
    w(' WHERE s.pathway_id = p.id AND prev.pathway_id = p.id')
    w(`   AND p.slug = ${q(pathway.slug)}`)
    w('   AND prev.stage_number = s.stage_number - 1;')
    w()
  }

  // ── verification ──────────────────────────────────────────────────────────
  const totalStages = resolved.reduce((n, p) => n + p.stages.length, 0)
  const totalLinks = resolved.reduce((n, p) => n + p.stages.reduce((m, s) => m + s.drills.length, 0), 0)
  const totalProblems = resolved.reduce((n, p) => n + p.stages.reduce((m, s) => m + s.stage.problems.length, 0), 0)

  w('-- ---------------------------------------------------------------------------')
  w('-- Verification')
  w('-- ---------------------------------------------------------------------------')
  w(`-- Expect ${resolved.length} pathways, ${totalStages} stages, ${totalLinks} stage-drill links,`)
  w(`-- ${totalProblems} stage-problem links, and the drill library unchanged.`)
  w('SELECT')
  w('  (SELECT count(*) FROM public.development_pathways)                  AS pathways,')
  w('  (SELECT count(*) FROM public.development_pathway_stages)            AS stages,')
  w('  (SELECT count(*) FROM public.development_pathway_stage_drills)      AS stage_drills,')
  w('  (SELECT count(*) FROM public.development_pathway_stage_problems)    AS stage_problems,')
  w('  (SELECT count(*) FROM public.development_pathway_stages')
  w('     WHERE prerequisite_stage_id IS NULL)                             AS first_stages,')
  w('  (SELECT count(*) FROM public.drill_resources)                       AS drills_untouched,')
  w('  (SELECT count(*) FROM public.drill_problem_map)                     AS mappings_untouched;')
  w()
  w('COMMIT;')
  w()

  writeFileSync(SQL_OUT, lines.join('\n'))
  console.log(`${SQL_OUT}  (${totalStages} stages, ${totalLinks} drill links, ${totalProblems} problem links)`)
}

main().catch(e => { console.error(e); process.exit(1) })
