// Which BenchCoach am I talking to?
//
// Until now there was one answer to that question and it was always
// production. One Supabase project, one set of variables, and any script that
// read NEXT_PUBLIC_SUPABASE_URL got the live database holding real coaches'
// teams, players and notes. Testing the league layer meant creating test
// leagues in production, and the only thing standing between a curious script
// and real data was whoever happened to be reading the code.
//
// This module makes the target explicit and, more importantly, makes it
// SAYABLE — so a script can print where it is about to write, and refuse when
// that is production and nobody said so.
//
// THE RULE THAT MATTERS
//
// Ambiguity is production. If the environment cannot be determined, callers
// must treat it as the live database and refuse to write. A default of
// "probably staging" is how a test suite eventually truncates a real table.

export type BenchCoachEnv = 'local' | 'staging' | 'production'

/**
 * The Supabase project ref that holds real customer data.
 *
 * Written down so code can RECOGNISE production rather than infer it. This is
 * not a secret — it is the subdomain of a URL that appears in every browser
 * request — and having it here is what lets a script say "you are pointed at
 * production" instead of shrugging.
 */
export const PRODUCTION_PROJECT_REF = 'chdpqsumqospnaztvfqe'

/**
 * The project ref out of a Supabase URL, or null if it is not one.
 *
 * Parsed rather than pattern-matched against the whole string, because a
 * pattern anchored only at the front accepts
 * `https://<prod-ref>.supabase.co.somewhere-else.example` — which would then
 * be reported as the production project, and the production write override
 * (which works by naming a ref) would authorise a write to it. The host has to
 * END at supabase.co, not merely start with something that looks like it.
 */
export function projectRef(url: string | undefined | null): string | null {
  let host: string
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

export function isProductionUrl(url: string | undefined | null): boolean {
  return projectRef(url) === PRODUCTION_PROJECT_REF
}

export interface EnvResolution {
  env: BenchCoachEnv
  /** How we decided. Printed by scripts so the answer is auditable. */
  reason: string
  supabaseUrl: string | null
  projectRef: string | null
  /** True when the target is, or might be, the live database. */
  isProduction: boolean
  /** True when we could not tell — which is treated as production. */
  ambiguous: boolean
}

/**
 * Work out which environment this process is pointed at.
 *
 * Precedence, and the reasoning for it:
 *
 *   1. The Supabase URL matching the known production ref. A declared
 *      BENCHCOACH_ENV=staging pointed at the production database is a
 *      mislabelled production, not a staging — the data does not care what the
 *      variable says, so the URL wins.
 *   2. An explicit BENCHCOACH_ENV.
 *   3. A localhost Supabase URL, which is unambiguously local.
 *   4. Nothing → ambiguous → treated as production.
 */
export function resolveEnv(source: Record<string, string | undefined> = process.env): EnvResolution {
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
      env: declared as BenchCoachEnv,
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

  // Some other hosted project, unlabelled. It is probably staging. "Probably"
  // is not good enough to authorise a write.
  return {
    env: 'production',
    reason: url
      ? `BENCHCOACH_ENV is not set and ${ref || 'the Supabase URL'} is not recognised — treating as production`
      : 'no NEXT_PUBLIC_SUPABASE_URL and no BENCHCOACH_ENV — treating as production',
    supabaseUrl: url, projectRef: ref, isProduction: true, ambiguous: true,
  }
}

// ---------------------------------------------------------------------------
// Required configuration
// ---------------------------------------------------------------------------

export interface EnvVarSpec {
  name: string
  required: boolean
  browser: boolean
  purpose: string
  /** What happens without it, so a missing optional is a known trade-off. */
  ifMissing?: string
}

/**
 * Every variable the app reads, what it is for, and whether the app can start
 * without it.
 *
 * Split by `required` deliberately: a staging environment for league testing
 * should not need a production Stripe key or a real Anthropic key, and saying
 * so here is what stops someone pasting production credentials into staging to
 * make a build go green.
 */
export const ENV_SPEC: EnvVarSpec[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, browser: true,
    purpose: 'Which Supabase project. Also how every script identifies the environment.' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, browser: true,
    purpose: 'Browser client. RLS applies to everything it does.' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, browser: false,
    purpose: 'Server-only. Bypasses RLS — never expose to the browser.' },
  { name: 'ADMIN_EMAIL', required: true, browser: false,
    purpose: 'Who may reach /api/admin/*. Must match a real signed-in account.',
    ifMissing: 'every admin route returns 404, including league provisioning' },
  { name: 'NEXT_PUBLIC_ADMIN_EMAIL', required: false, browser: true,
    purpose: 'Which account the admin PAGES render for. requireAdmin() falls back to it.',
    ifMissing: 'the admin page hides itself; the API still works off ADMIN_EMAIL' },
  { name: 'NEXT_PUBLIC_APP_URL', required: false, browser: true,
    purpose: 'Absolute URLs in invitations and emails.',
    ifMissing: 'links fall back to relative paths, which break outside the browser' },
  { name: 'ANTHROPIC_API_KEY', required: false, browser: false,
    purpose: 'Chat, practice plans, drill diagnosis.',
    ifMissing: 'AI surfaces fail at request time. League provisioning and invites are unaffected.' },
  { name: 'STRIPE_SECRET_KEY', required: false, browser: false,
    purpose: 'Individual coach subscriptions.',
    ifMissing: 'checkout fails. League-sponsored coaches never reach it, so league testing is unaffected.' },
  { name: 'STRIPE_WEBHOOK_SECRET', required: false, browser: false, purpose: 'Verifies Stripe webhooks.' },
  { name: 'STRIPE_PRICE_ID', required: false, browser: false, purpose: 'The individual plan price.' },
  { name: 'CRON_SECRET', required: false, browser: false,
    purpose: 'Authenticates the weekly check-in cron.',
    ifMissing: 'the cron endpoint refuses, which is the safe direction' },
  { name: 'NEXT_PUBLIC_SWING_ANALYZER_URL', required: false, browser: true, purpose: 'Swing analysis service.' },
  { name: 'GHL_API_KEY', required: false, browser: false, purpose: 'GoHighLevel marketing sync.' },
  { name: 'GHL_LOCATION_ID', required: false, browser: false, purpose: 'GoHighLevel location.' },
  { name: 'BENCHCOACH_ENV', required: false, browser: false,
    purpose: 'local | staging | production. Declares intent; the Supabase URL still overrules it.',
    ifMissing: 'scripts treat an unrecognised database as production and refuse to write' },
]

export interface EnvCheck {
  env: EnvResolution
  missingRequired: EnvVarSpec[]
  missingOptional: EnvVarSpec[]
  ok: boolean
}

export function checkEnv(source: Record<string, string | undefined> = process.env): EnvCheck {
  const present = (n: string) => !!(source[n] && String(source[n]).trim())
  const missingRequired = ENV_SPEC.filter(s => s.required && !present(s.name))
  const missingOptional = ENV_SPEC.filter(s => !s.required && !present(s.name))
  return {
    env: resolveEnv(source),
    missingRequired,
    missingOptional,
    ok: missingRequired.length === 0,
  }
}

/**
 * A one-line description of the target, safe to print anywhere.
 *
 * Never includes a key. The project ref is public — it is in every request URL
 * the browser makes — and printing it is the entire point: somebody reading a
 * script's output should be able to see which database is about to change.
 */
export function describeTarget(e: EnvResolution = resolveEnv()): string {
  const where = e.projectRef ? `${e.projectRef}.supabase.co` : (e.supabaseUrl || '(no Supabase URL)')
  const flag = e.isProduction ? (e.ambiguous ? '  ⚠ AMBIGUOUS — TREATED AS PRODUCTION' : '  ⚠ PRODUCTION') : ''
  return `${e.env.toUpperCase()}  ${where}${flag}\n    ${e.reason}`
}
