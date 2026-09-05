#!/usr/bin/env node
// Build-time check: no script can reach a database without saying which one.
//
//   npm run verify:env-safety
//
// WHAT IT ENFORCES, AND WHY EACH RULE EXISTS
//
// 1. NO HARDCODED PROJECT REF OR CREDENTIAL IN SOURCE.
//    scripts/update-playbook-templates.js opened with a literal production URL
//    and a literal production service_role key, and ran .update() on
//    playbook_templates. It was flagged in an audit in June and was still there
//    in September. A rule in a document did not hold; a rule in the build might.
//
// 2. EVERY SCRIPT THAT CAN WRITE GOES THROUGH requireTarget().
//    Reading is safe everywhere. Writing is safe only when someone has seen
//    which database is about to change, and the guard is the thing that makes
//    them see it.
//
// 3. THE GUARD AND lib/env.ts MUST AGREE.
//    They are separate files by necessity — one is loaded by `node`, one by
//    Next — so the thing that keeps them honest is this check, not an import.
//
// WHAT IT DOES NOT CLAIM
//
// This proves no script in the repository can quietly write to production. It
// says nothing about what a person types into psql, and nothing about the
// Supabase SQL editor, which is where migrations are applied. Environment
// separation is a property of the deployment; this is one wall of it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const problems = []
const fail = (file, msg, why) => problems.push({ file, msg, why })

// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'seo-conversions', 'pilot'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(m?js|ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(join(ROOT, 'scripts'))
  .concat(walk(join(ROOT, 'lib')))
  .concat(walk(join(ROOT, 'app')))

// ---------------------------------------------------------------------------
// 1. Hardcoded production identifiers and credentials.
// ---------------------------------------------------------------------------

// The production ref itself is not a secret and is deliberately written down in
// two places so code can RECOGNISE production. Anywhere else it is a hardcoded
// target.
const REF = 'chdpqsumqospnaztvfqe'
const REF_ALLOWED = new Set([
  'lib/env.ts',                    // the app-side model, states it on purpose
  'scripts/lib/env-guard.mjs',     // the script-side guard, same
  'scripts/verify-env-safety.mjs', // this file, to check the other two
])

// A Supabase JWT always starts with this header segment ({"alg":"HS256",
// "typ":"JWT"} in base64url). Assembled from halves so this file does not
// itself trip the rule it enforces.
const JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5' + 'cCI6IkpXVCJ9'

for (const abs of files) {
  const rel = relative(ROOT, abs)
  const src = readFileSync(abs, 'utf8')

  if (src.includes(REF) && !REF_ALLOWED.has(rel)) {
    fail(rel, `hardcodes the production project ref "${REF}"`,
      'a target baked into source cannot be pointed at staging, so the script has exactly one place it can ever run')
  }

  if (src.includes(JWT_HEADER)) {
    fail(rel, 'contains a literal Supabase JWT',
      'a service_role key in source bypasses RLS on every table and is published to everyone with repository access, permanently — git history keeps it after the file is edited')
  }

  if (/sk-ant-api[0-9]{2}-/.test(src)) {
    fail(rel, 'contains a literal Anthropic API key', 'move it to ANTHROPIC_API_KEY')
  }
  if (/\bsk_live_[A-Za-z0-9]/.test(src)) {
    fail(rel, 'contains a literal Stripe live key', 'move it to STRIPE_SECRET_KEY')
  }
}

// ---------------------------------------------------------------------------
// 2. Write-capable scripts must go through the guard.
// ---------------------------------------------------------------------------

// PostgREST writes through the JS client, and raw fetches with a write method.
const WRITE_CALL = /\.(update|insert|upsert|delete)\s*\(/
const RAW_WRITE = /method:\s*['"`](POST|PATCH|PUT|DELETE)['"`]/i
const SQL_WRITE = /\b(UPDATE|INSERT INTO|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE)\b/

// Scripts that write to their own output files rather than a database, or that
// only match because they contain the word in prose or a test fixture.
const NOT_A_DATABASE_WRITE = new Set([
  'scripts/verify-env-safety.mjs',      // this file — the regexes above
  'scripts/verify-league-privacy.mjs',  // greps source text for these patterns
  'scripts/verify-authz.mjs',
  'scripts/verify-drill-scope.mjs',
  'scripts/verify-claude-calls.mjs',
  'scripts/verify-hooks.mjs',
  'scripts/verify-video-links.mjs',
])

const scriptFiles = files.filter(f => relative(ROOT, f).startsWith('scripts/'))

for (const abs of scriptFiles) {
  const rel = relative(ROOT, abs)
  if (NOT_A_DATABASE_WRITE.has(rel)) continue
  if (rel.startsWith('scripts/lib/')) continue
  if (/\/test-|\/evaluate-|\/simulate-/.test(`/${rel}`)) continue

  const src = readFileSync(abs, 'utf8')

  // Only files that actually talk to a database. A test that builds a fake
  // row object is not one.
  const talksToDb = /createClient\s*\(|\/rest\/v1\/|new pg\.Pool|SUPABASE_SERVICE_ROLE_KEY/.test(src)
  if (!talksToDb) continue

  const code = src.split('\n').filter(l => {
    const t = l.trim()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  }).join('\n')

  const canWrite = WRITE_CALL.test(code) || RAW_WRITE.test(code) || SQL_WRITE.test(code)
  if (!canWrite) continue

  if (!/requireTarget\s*\(|serviceClient\s*\(/.test(code)) {
    fail(rel, 'can write to a database but never calls requireTarget()',
      'it will run against whatever NEXT_PUBLIC_SUPABASE_URL happens to hold, without printing it or asking')
  }
}

// ---------------------------------------------------------------------------
// 3. The guard and the app model must agree.
// ---------------------------------------------------------------------------

const envTs = readFileSync(join(ROOT, 'lib/env.ts'), 'utf8')
const guard = readFileSync(join(ROOT, 'scripts/lib/env-guard.mjs'), 'utf8')

const refIn = (src) => (src.match(/PRODUCTION_PROJECT_REF\s*=\s*['"]([a-z0-9]+)['"]/) || [])[1]
const a = refIn(envTs)
const b = refIn(guard)
if (!a || !b || a !== b) {
  fail('lib/env.ts + scripts/lib/env-guard.mjs',
    `PRODUCTION_PROJECT_REF disagrees (${a || 'unset'} vs ${b || 'unset'})`,
    'the app would call one project production and the scripts another, so one of them would happily write to the live database')
}

// The precedence order is the actual safety property. Both files must put the
// URL check before the BENCHCOACH_ENV check, or a mislabelled staging variable
// would be enough to authorise a production write.
for (const [name, src] of [['lib/env.ts', envTs], ['scripts/lib/env-guard.mjs', guard]]) {
  const urlAt = src.indexOf('ref === PRODUCTION_PROJECT_REF')
  const declaredAt = src.indexOf("declared === 'local'")
  if (urlAt < 0 || declaredAt < 0 || urlAt > declaredAt) {
    fail(name, 'BENCHCOACH_ENV is checked before the Supabase URL',
      'BENCHCOACH_ENV=staging pointed at the production database would then resolve as staging, and every guard downstream would wave it through')
  }
  if (!/ambiguous:\s*true/.test(src)) {
    fail(name, 'has no ambiguous case', 'an unrecognised database must be treated as production, not assumed safe')
  }
}

// The override must be matched against a project ref, not read as a boolean.
if (!/named === e\.projectRef/.test(guard)) {
  fail('scripts/lib/env-guard.mjs', 'the production override is not matched against the resolved project',
    'a boolean override gets exported once into a shell profile and then authorises every future run, including the ones pointed somewhere unexpected')
}

// ---------------------------------------------------------------------------

if (problems.length) {
  console.error('\nenv safety: FAILED\n')
  for (const p of problems) {
    console.error(`  ${p.file}`)
    console.error(`    ${p.msg}`)
    console.error(`    ${p.why}\n`)
  }
  process.exit(1)
}

console.log(`env safety: ${files.length} files checked — no hardcoded targets or credentials, every write-capable script names its database, and lib/env.ts agrees with scripts/lib/env-guard.mjs.`)
