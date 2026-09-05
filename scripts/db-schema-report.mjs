#!/usr/bin/env node
// What does this database actually contain, and how does it differ from the
// one we think we are copying?
//
//   npm run db:report                 # describe the current target
//   npm run db:report -- --snapshot   # record it as the expected surface
//   npm run db:report -- --compare    # diff the target against that record
//
// READ-ONLY. Every request is a schema request or a zero-row probe; no row is
// ever selected, counted, written or deleted. Safe to run against production,
// which is the point — the expected surface has to come from somewhere real.
//
// HOW IT SEES THE SCHEMA WITHOUT A POSTGRES CONNECTION
//
// Ports 5432 and 6543 are blocked from this sandbox, so pg_dump is not
// available and neither is information_schema. PostgREST publishes an OpenAPI
// document at /rest/v1/ that lists every table, view and function it exposes,
// with each column's type, format and nullability. That is enough to answer
// "does staging have the same tables and columns as production", which is the
// question staging readiness actually turns on.
//
// WHAT IT CANNOT SEE, AND WHY THAT MATTERS
//
// PostgREST describes the API surface, not the database. It does NOT show:
// indexes, RLS policies, triggers, check constraints, foreign keys, grants,
// sequences, storage buckets, or anything in a non-exposed schema (auth,
// storage, extensions). A staging project that passes --compare has the right
// SHAPE. It has not been shown to have the right SECURITY, and RLS is most of
// this application's security.
//
// So a clean report here is a necessary condition for staging, never a
// sufficient one. docs/ENVIRONMENTS.md says what closes the rest of the gap.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireTarget, describeTarget } from './lib/env-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = resolve(ROOT, 'docs/schema/expected-surface.json')

const args = process.argv.slice(2)
const DO_SNAPSHOT = args.includes('--snapshot')
const DO_COMPARE = args.includes('--compare')

const env = requireTarget({
  script: `db-schema-report${DO_SNAPSHOT ? ' --snapshot' : DO_COMPARE ? ' --compare' : ''}`,
  writes: false,
})

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.')
  process.exit(1)
}
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  console.error('HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not — fetch would be blocked and')
  console.error(`report a 403 that looks like bad credentials. Re-run with NODE_USE_ENV_PROXY=1.\n`)
  process.exit(1)
}

async function openapi() {
  const res = await fetch(`${URL_}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} reading the schema: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/**
 * Reduce the OpenAPI document to the parts that describe shape.
 *
 * Deliberately narrow: table name, column name, type, format, nullability.
 * Descriptions are dropped because they carry PostgREST's own commentary and
 * change between versions, which would make every diff noisy and therefore
 * unread.
 */
function surfaceOf(doc) {
  const tables = {}
  for (const [name, def] of Object.entries(doc.definitions || {})) {
    const required = new Set(def.required || [])
    tables[name] = Object.fromEntries(
      Object.entries(def.properties || {}).sort(([a], [b]) => a.localeCompare(b))
        .map(([col, p]) => [col, {
          type: p.type || 'unknown',
          format: p.format || null,
          required: required.has(col),
        }])
    )
  }
  const rpcs = Object.keys(doc.paths || {})
    .filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort()
  return { tables, rpcs }
}

// ---------------------------------------------------------------------------

const doc = await openapi()
const surface = surfaceOf(doc)
const tableNames = Object.keys(surface.tables).sort()
const columnCount = tableNames.reduce((n, t) => n + Object.keys(surface.tables[t]).length, 0)

console.log(`  ${tableNames.length} tables/views, ${columnCount} columns, ${surface.rpcs.length} exposed functions\n`)

// ---------------------------------------------------------------------------
// Which migrations look applied?
//
// Inferred from the objects they create, not from a ledger — this project has
// no migrations table, and inventing one retroactively would record a guess as
// a fact. "Looks applied" is the honest strength of this claim.
// ---------------------------------------------------------------------------
const MIGRATION_MARKERS = [
  ['001_prescription_engine', ['problem_taxonomy', 'drill_problem_map']],
  ['010_scouting_reports', ['opponent_teams', 'opponent_players', 'scouting_entries', 'matchups', 'pitch_count_rules']],
  ['012_activity_log', ['entries', 'observations', 'prescriptions', 'player_metrics', 'roster_name_mappings']],
  ['014_checkins', ['checkins']],
  ['016_game_notes_and_quick_counts', ['pitch_count_sessions']],
  ['017_scouting_analysis', ['opponent_analyses']],
  ['019_metrics', ['metric_types']],
  ['028_live_lineup', ['game_participation', 'game_position_log']],
  ['030_scorebook', ['game_events']],
  ['031_half_innings_and_eligibility', ['game_position_eligibility']],
  ['032_opponent_lineup', ['game_opponent_lineup']],
  ['035_plan_sessions', ['plan_session_log']],
  ['041_coach_drills_and_favorites', ['drill_favorites']],
  ['050_league_layer', ['leagues', 'league_members', 'league_licenses', 'league_invitations', 'league_divisions', 'league_seasons']],
]

const RPC_MARKERS = [
  ['034_staff_access', ['bc_team_at_least', 'bc_rank', 'bc_team_role']],
  ['050_league_layer (functions)', ['bc_league_at_least', 'bc_claim_league_seat', 'bc_in_league_team']],
  ['051_provision_league_atomically', ['bc_provision_league']],
]

// Columns a migration adds to a table that already existed. This is the only
// way to see the ALTER-only migrations, which are most of them.
//
// Every entry here is the literal column named in the migration's ADD COLUMN.
// Guessing a plausible name instead produces confident MISSING lines for
// migrations that are in fact applied, which is worse than no check.
const COLUMN_MARKERS = [
  ['037_journal_into_entries', 'entries', 'legacy_journal_id'],
  ['038_practice_recap_columns', 'practice_sessions', 'what_worked'],
  ['039_practice_schedule', 'practice_plans', 'scheduled_for'],
  ['042_pitching_line', 'opponent_appearances', 'pitching_line'],
  ['049_video_segment_provenance', 'drill_resources', 'youtube_start_source'],
]

// 044 adds no column — it drops a NOT NULL so anonymous SEO events can be
// written without a user. PostgREST lists a NOT NULL column without a default
// as "required", so its absence from that list is the applied state.
const NULLABILITY_MARKERS = [
  ['044_anonymous_seo_events', 'user_events', 'user_id'],
]

// Migrations that change only ROWS. Nothing in the schema moves, so this
// script cannot see them and must not imply otherwise — a MISSING line for a
// data migration would send someone to re-run an UPDATE that already ran.
const DATA_ONLY = [
  ['046_taxonomy_coverage', 'seeds problem_taxonomy rows and curated drill_problem_map entries'],
  ['047_drill_durations', 'populates drill_resources.est_duration_minutes'],
  ['048_normalize_operational_metadata', 'normalises space_required and indoor_outdoor values'],
]

const has = (t) => !!surface.tables[t]
const hasCol = (t, c) => !!surface.tables[t]?.[c]

console.log('  migrations, inferred from the objects they create')
console.log('  (no migrations table exists in this project, so this is evidence, not a ledger)\n')

const report = (label, present, total, missing) => {
  const mark = present === total ? 'applied  ' : present === 0 ? 'MISSING  ' : 'PARTIAL  '
  console.log(`    ${mark}${label}${present === total ? '' : `  — missing ${missing.join(', ')}`}`)
}

for (const [name, tables] of MIGRATION_MARKERS) {
  const missing = tables.filter(t => !has(t))
  report(name, tables.length - missing.length, tables.length, missing)
}
for (const [name, rpcs] of RPC_MARKERS) {
  const missing = rpcs.filter(r => !surface.rpcs.includes(r))
  report(name, rpcs.length - missing.length, rpcs.length, missing)
}
for (const [name, table, col] of COLUMN_MARKERS) {
  const present = hasCol(table, col)
  console.log(`    ${present ? 'applied  ' : 'MISSING  '}${name}  — ${table}.${col}`)
}
for (const [name, table, col] of NULLABILITY_MARKERS) {
  const stillRequired = (doc.definitions?.[table]?.required || []).includes(col)
  console.log(`    ${stillRequired ? 'MISSING  ' : 'applied  '}${name}  — ${table}.${col} is ${stillRequired ? 'still NOT NULL' : 'nullable'}`)
}

console.log('')
console.log('  data-only migrations — this script cannot see these')
console.log('  (they change rows, not schema; verify with the SELECT at the bottom of each file)\n')
for (const [name, what] of DATA_ONLY) console.log(`    unknown  ${name}  — ${what}`)

// ---------------------------------------------------------------------------
// The gap that matters most.
// ---------------------------------------------------------------------------
const NOT_IN_ANY_MIGRATION = [
  'coaches', 'teams', 'players', 'team_members', 'team_players', 'games',
  'drill_resources', 'seo_pages', 'playbook_templates', 'practice_sessions',
  'practice_plans', 'chat_threads', 'chat_messages', 'seasons',
]
const foundling = NOT_IN_ANY_MIGRATION.filter(has)

console.log('')
console.log('  tables this database has that NO migration in this repo creates')
console.log('  (created by hand in the dashboard; they cannot be rebuilt from the repo)\n')
console.log(`    ${foundling.length} of ${NOT_IN_ANY_MIGRATION.length} checked: ${foundling.join(', ')}`)

const unaccounted = tableNames.filter(t =>
  !NOT_IN_ANY_MIGRATION.includes(t) &&
  !MIGRATION_MARKERS.some(([, ts]) => ts.includes(t)))
console.log(`\n    a further ${unaccounted.length} tables are in neither list:`)
console.log(`    ${unaccounted.join(', ')}`)

// ---------------------------------------------------------------------------

if (DO_SNAPSHOT) {
  mkdirSync(dirname(SNAPSHOT), { recursive: true })
  writeFileSync(SNAPSHOT, JSON.stringify({
    // Recorded so a diff can never be silently taken against the wrong source.
    recordedFrom: { env: env.env, projectRef: env.projectRef },
    recordedAt: new Date().toISOString().slice(0, 10),
    note: 'Shape only — no rows, no policies, no indexes. See the header of scripts/db-schema-report.mjs.',
    ...surface,
  }, null, 2) + '\n')
  console.log(`\n  wrote ${SNAPSHOT.replace(ROOT + '/', '')} — ${tableNames.length} tables, ${surface.rpcs.length} functions`)
}

if (DO_COMPARE) {
  if (!existsSync(SNAPSHOT)) {
    console.error(`\nNo expected surface at ${SNAPSHOT.replace(ROOT + '/', '')}. Record one first:`)
    console.error('  npm run db:report -- --snapshot   (against production, read-only)')
    process.exit(1)
  }
  const want = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  console.log(`\n  comparing ${describeTarget(env)}`)
  console.log(`  against the surface recorded from ${want.recordedFrom?.env || 'unknown'} on ${want.recordedAt}\n`)

  const missingTables = Object.keys(want.tables).filter(t => !surface.tables[t]).sort()
  const extraTables = tableNames.filter(t => !want.tables[t])
  const missingRpcs = want.rpcs.filter(r => !surface.rpcs.includes(r))

  const missingCols = []
  for (const [t, cols] of Object.entries(want.tables)) {
    if (!surface.tables[t]) continue
    for (const [c, spec] of Object.entries(cols)) {
      const got = surface.tables[t][c]
      if (!got) missingCols.push(`${t}.${c} (absent)`)
      else if (got.format !== spec.format) missingCols.push(`${t}.${c} (${spec.format} → ${got.format})`)
    }
  }

  const show = (label, items, why) => {
    if (!items.length) return false
    console.log(`  ${label} (${items.length})`)
    console.log(`    ${why}`)
    for (const i of items.slice(0, 40)) console.log(`      ${i}`)
    if (items.length > 40) console.log(`      … and ${items.length - 40} more`)
    console.log('')
    return true
  }

  let bad = false
  bad = show('MISSING TABLES', missingTables,
    'code that reads these gets data:null from supabase-js rather than an exception, so the app degrades silently') || bad
  bad = show('MISSING COLUMNS OR CHANGED TYPES', missingCols,
    'a select naming one of these fails the whole query, not just the column') || bad
  bad = show('MISSING FUNCTIONS', missingRpcs,
    'an absent RPC returns PGRST202, which routes tend to treat as a transient error') || bad
  show('EXTRA TABLES', extraTables,
    'present here but not in the recorded surface — usually fine, occasionally a leftover')

  if (!bad) {
    console.log('  Shape matches the recorded surface.')
    console.log('')
    console.log('  This says nothing about RLS policies, indexes, triggers or grants,')
    console.log('  which PostgREST does not expose and which are most of the security.')
  } else {
    console.log('  Shape does NOT match. See docs/ENVIRONMENTS.md.')
    process.exit(1)
  }
}

console.log('\n  Read-only. Nothing was written, and no row was read.\n')
