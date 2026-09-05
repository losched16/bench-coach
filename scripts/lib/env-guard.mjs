// The thing that stands between a script and the live database.
//
// WHAT THIS IS FOR
//
// Scripts in this repo read NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY and start writing. Historically that was fine
// because there was exactly one database, so "which one?" had a single answer.
// Now there is meant to be a staging project, which means the question is real
// and a script that does not ask it will eventually ask it once, loudly, in
// production.
//
// So every script that can write goes through requireTarget() first. It:
//
//   1. loads .env.local the same way the rest of the repo does,
//   2. works out which environment the URL points at,
//   3. PRINTS that, always, whether it is about to write or not,
//   4. refuses to continue if the target is production — or unknown — unless
//      the caller has named the production project on purpose.
//
// THE OVERRIDE IS A NAME, NOT A FLAG
//
// A boolean override (ALLOW_PRODUCTION=1) gets pasted into a shell profile
// once and then it is on forever, including the day you are pointed somewhere
// you did not expect. So the override is:
//
//   BENCHCOACH_ALLOW_PRODUCTION_WRITE=<project ref>
//
// and it must MATCH the project the script actually resolved. Naming
// chdpqsumqospnaztvfqe while pointed at a staging project is harmless; being
// pointed at production while the variable names staging is refused. And when
// the environment is ambiguous enough that there is no ref to name, nothing
// can authorise the write, which is the correct outcome — you cannot consent
// to a destination you cannot identify.
//
// KEPT IN STEP WITH lib/env.ts BY TEST, NOT BY IMPORT
//
// lib/env.ts is the app-side model of the same idea. This file deliberately
// does not import it: these scripts run as plain `node scripts/x.mjs` on a
// laptop, and making the safety guard depend on a TypeScript loader is how the
// safety guard ends up commented out. The two are held together by
// scripts/test-env-safety.ts, which reads both files and fails if they
// disagree about the production project or the precedence rules.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The Supabase project holding real customer data.
 *
 * MUST equal PRODUCTION_PROJECT_REF in lib/env.ts. Not a secret — it is the
 * subdomain of every request the browser makes — and writing it down is what
 * lets a script recognise production instead of guessing.
 */
export const PRODUCTION_PROJECT_REF = 'chdpqsumqospnaztvfqe'

/** The env var that authorises a production write, by naming the project. */
export const PRODUCTION_OVERRIDE_VAR = 'BENCHCOACH_ALLOW_PRODUCTION_WRITE'

// ---------------------------------------------------------------------------

/**
 * Load .env.local into process.env without overwriting anything already set.
 *
 * Same precedence as the rest of the repo: a variable exported in the shell
 * beats the file, so `BENCHCOACH_ENV=staging node scripts/...` works even when
 * .env.local says otherwise.
 */
export function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const f of files) {
    const p = resolve(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

/**
 * The project ref out of a Supabase URL, or null if it is not one.
 *
 * Parsed rather than pattern-matched against the whole string: a pattern
 * anchored only at the front accepts
 * `https://<prod-ref>.supabase.co.somewhere-else.example`, which would be
 * reported as the production project — and since the write override works by
 * naming a ref, it would then authorise a write to that host. The host has to
 * END at supabase.co. Mirrors projectRef() in lib/env.ts.
 */
export function projectRef(url) {
  let host
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:') return null
    host = u.hostname.toLowerCase()
  } catch {
    return null
  }
  const m = host.match(/^([a-z0-9]+)\.supabase\.(co|in)$/)
  return m ? m[1] : null
}

/**
 * Which environment is this process pointed at?
 *
 * Precedence — identical to resolveEnv() in lib/env.ts:
 *   1. A URL matching the production ref. A declared BENCHCOACH_ENV=staging
 *      pointed at the production database is a mislabelled production; the
 *      data does not care what the variable says.
 *   2. An explicit BENCHCOACH_ENV.
 *   3. A localhost URL.
 *   4. Nothing recognisable → ambiguous → treated as production.
 */
export function resolveEnv(source = process.env) {
  const url = source.NEXT_PUBLIC_SUPABASE_URL || null
  const ref = projectRef(url)
  const declared = (source.BENCHCOACH_ENV || '').trim().toLowerCase()

  if (ref === PRODUCTION_PROJECT_REF) {
    return {
      env: 'production',
      reason: declared && declared !== 'production'
        ? `NEXT_PUBLIC_SUPABASE_URL is the production project (${ref}) — BENCHCOACH_ENV=${declared} is ignored, the database is what it is`
        : `NEXT_PUBLIC_SUPABASE_URL is the production project (${ref})`,
      supabaseUrl: url, projectRef: ref, isProduction: true, ambiguous: false,
    }
  }

  if (declared === 'local' || declared === 'staging' || declared === 'production') {
    return {
      env: declared,
      reason: `BENCHCOACH_ENV=${declared}`,
      supabaseUrl: url, projectRef: ref,
      isProduction: declared === 'production',
      ambiguous: false,
    }
  }

  if (url && /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/i.test(url)) {
    return {
      env: 'local', reason: 'NEXT_PUBLIC_SUPABASE_URL points at localhost',
      supabaseUrl: url, projectRef: null, isProduction: false, ambiguous: false,
    }
  }

  return {
    env: 'production',
    reason: url
      ? `BENCHCOACH_ENV is not set and ${ref || 'the Supabase URL'} is not recognised — treating as production`
      : 'no NEXT_PUBLIC_SUPABASE_URL and no BENCHCOACH_ENV — treating as production',
    supabaseUrl: url, projectRef: ref, isProduction: true, ambiguous: true,
  }
}

/**
 * Which environment a raw Postgres connection string points at.
 *
 * Needed because not everything goes through PostgREST — seo-convert.mjs
 * prefers a scoped SEO_DATABASE_URL, and a guard that only ever looks at
 * NEXT_PUBLIC_SUPABASE_URL would happily announce "STAGING" while a direct
 * connection rewrote production.
 *
 * Supabase puts the project ref in the host either way (`db.<ref>.supabase.co`
 * direct, `postgres.<ref>@...pooler.supabase.com` pooled), so the ref is found
 * by looking for it rather than by parsing a shape that has changed before.
 *
 * NEVER returns or prints the string — it contains a password.
 */
export function resolveEnvFromConnectionString(cs, source = process.env) {
  const s = String(cs || '')
  let host = '(unparseable connection string)'
  try { host = new URL(s).hostname } catch { /* keep the placeholder */ }

  if (s.includes(PRODUCTION_PROJECT_REF)) {
    return {
      env: 'production',
      reason: `the connection string names the production project (${PRODUCTION_PROJECT_REF})`,
      supabaseUrl: host, projectRef: PRODUCTION_PROJECT_REF,
      isProduction: true, ambiguous: false,
    }
  }

  if (/^(localhost|127\.0\.0\.1|host\.docker\.internal)$/i.test(host)) {
    return {
      env: 'local', reason: 'the connection string points at localhost',
      supabaseUrl: host, projectRef: null, isProduction: false, ambiguous: false,
    }
  }

  const m = host.match(/(?:^db\.|^)([a-z0-9]{20})\.supabase\.co$/i)
  const ref = m ? m[1] : null
  const declared = (source.BENCHCOACH_ENV || '').trim().toLowerCase()
  if (declared === 'local' || declared === 'staging') {
    return {
      env: declared, reason: `BENCHCOACH_ENV=${declared}, and the connection string is not production`,
      supabaseUrl: host, projectRef: ref, isProduction: false, ambiguous: false,
    }
  }

  return {
    env: 'production',
    reason: `BENCHCOACH_ENV is not set and ${host} is not a recognised environment — treating as production`,
    supabaseUrl: host, projectRef: ref, isProduction: true, ambiguous: true,
  }
}

/**
 * A one-line description of the target, safe to print anywhere.
 *
 * Never contains a key. The project ref is public; printing it is the point.
 */
export function describeTarget(e = resolveEnv()) {
  const where = e.projectRef ? `${e.projectRef}.supabase.co` : (e.supabaseUrl || '(no Supabase URL)')
  const flag = e.isProduction ? (e.ambiguous ? '  ⚠ AMBIGUOUS — TREATED AS PRODUCTION' : '  ⚠ PRODUCTION') : ''
  return `${e.env.toUpperCase()}  ${where}${flag}`
}

/**
 * True when the caller has explicitly authorised writing to THIS project.
 *
 * The override names a project ref and has to match the one resolved. An
 * ambiguous environment has no ref to match, so it can never be satisfied.
 */
export function productionWriteAuthorised(e = resolveEnv(), source = process.env) {
  const named = (source[PRODUCTION_OVERRIDE_VAR] || '').trim()
  if (!named) return false
  if (!e.projectRef) return false
  return named === e.projectRef
}

// ---------------------------------------------------------------------------

/**
 * Announce the target and, for a writing script, refuse an unsafe one.
 *
 * @param {object}  opts
 * @param {string}  opts.script       What is running, for the banner.
 * @param {boolean} opts.writes       True if this run can modify the database.
 * @param {string}  [opts.what]       One line on what it will change.
 * @param {object}  [opts.resolution] A resolution worked out by the caller —
 *                  used when the target is not NEXT_PUBLIC_SUPABASE_URL, e.g.
 *                  a direct Postgres connection string.
 * @returns the resolution, so the caller can branch on it.
 */
export function requireTarget({ script, writes, what = '', resolution = null }) {
  loadEnvFiles()
  const e = resolution || resolveEnv()

  console.log('')
  console.log(`  ${script}`)
  console.log(`  target:  ${describeTarget(e)}`)
  console.log(`  because: ${e.reason}`)
  console.log(`  mode:    ${writes ? `WRITE${what ? ` — ${what}` : ''}` : 'read-only'}`)
  console.log('')

  if (!writes || !e.isProduction) return e

  if (productionWriteAuthorised(e)) {
    console.log(`  ${PRODUCTION_OVERRIDE_VAR} names ${e.projectRef}. Proceeding against production.`)
    console.log('')
    return e
  }

  const named = (process.env[PRODUCTION_OVERRIDE_VAR] || '').trim()

  console.error('REFUSING TO WRITE.')
  console.error('')
  if (e.ambiguous) {
    console.error('  The environment could not be identified, so it is treated as production.')
    console.error('  There is no way to authorise a write to a database you cannot name.')
    console.error('')
    console.error('  Point this at a known environment first:')
    console.error('    BENCHCOACH_ENV=staging  with the staging NEXT_PUBLIC_SUPABASE_URL')
    console.error('    BENCHCOACH_ENV=local    with a local Supabase')
  } else if (named && named !== e.projectRef) {
    console.error(`  ${PRODUCTION_OVERRIDE_VAR} names "${named}" but this run resolved to`)
    console.error(`  "${e.projectRef}". Those are different databases, so the override does not apply.`)
  } else {
    console.error('  This is the production database — real coaches, real teams, real players.')
    console.error('')
    console.error('  If you genuinely mean it, name the project you are about to change:')
    console.error(`    ${PRODUCTION_OVERRIDE_VAR}=${e.projectRef} npm run <script>`)
  }
  console.error('')
  process.exit(1)
}

/**
 * A service-role Supabase client, but only after requireTarget() has approved.
 *
 * Bundled together on purpose: the credential and the permission to use it are
 * the same decision, and separating them is how a script ends up holding a
 * service-role key it was never cleared to use.
 */
export async function serviceClient(opts) {
  const e = requireTarget(opts)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.')
    console.error('Put them in .env.local. Never in a source file — see docs/ENVIRONMENTS.md.')
    process.exit(1)
  }

  // Node 22's global fetch ignores HTTPS_PROXY unless told otherwise, and the
  // failure looks like a 403 from Supabase rather than a proxy problem.
  if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
    console.warn('HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not — requests may fail as 403.')
    console.warn('Re-run with NODE_USE_ENV_PROXY=1 if that happens.\n')
  }

  const { createClient } = await import('@supabase/supabase-js')
  return { db: createClient(url, key, { auth: { persistSession: false } }), env: e }
}
