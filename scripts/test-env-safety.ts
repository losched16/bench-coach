// Which database am I about to write to, and who said I could?
//
// WHAT THIS PROTECTS
//
// Every script in this repo used to answer the first question the same way:
// whatever NEXT_PUBLIC_SUPABASE_URL happened to hold, which was always
// production. Now there is meant to be a staging project, so the answer varies
// — and a resolution function that gets it wrong is worse than no resolution
// at all, because it prints a confident "STAGING" over a production write.
//
// So the cases below are mostly about being wrong in the safe direction. An
// unknown database resolves to production. A URL that says production beats a
// variable that says staging. An override that names the wrong project does
// not apply. None of these are the happy path; all of them are the ones that
// matter at 11pm.
//
//   npm run test:env-safety

import { readFileSync } from 'fs'
import {
  resolveEnv, checkEnv, projectRef, isProductionUrl, describeTarget,
  PRODUCTION_PROJECT_REF, ENV_SPEC,
} from '../lib/env'

// The guard is .mjs on purpose (see its header) — imported here so both
// implementations are exercised by the same cases.
const guard = require('./lib/env-guard.mjs')

let passed = 0
const failures: string[] = []
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name: string, a: any, b: any) =>
  ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const PROD = `https://${PRODUCTION_PROJECT_REF}.supabase.co`
const STAGING = 'https://abcdefghijklmnopqrst.supabase.co'

// ---------------------------------------------------------------------------
// 1. Reading a Supabase URL
// ---------------------------------------------------------------------------
eq('project ref out of a production URL', projectRef(PROD), PRODUCTION_PROJECT_REF)
eq('project ref out of a URL with a path', projectRef(`${PROD}/rest/v1/drills`), PRODUCTION_PROJECT_REF)
eq('a localhost URL has no project ref', projectRef('http://localhost:54321'), null)
eq('an empty URL has no project ref', projectRef(''), null)
eq('undefined has no project ref', projectRef(undefined), null)

ok('the production URL is recognised as production', isProductionUrl(PROD))
ok('a different project is not production', !isProductionUrl(STAGING))
ok('an http:// production URL is still not matched as https production',
  !isProductionUrl(PROD.replace('https:', 'http:')),
  'the client only ever speaks https to Supabase; an http URL is a misconfiguration, not a production connection')

// A lookalike host must not be mistaken for the real project.
ok('a lookalike domain is not production',
  !isProductionUrl(`https://${PRODUCTION_PROJECT_REF}.supabase.co.evil.example`),
  'the anchored pattern is what stops a suffix from passing')

// ---------------------------------------------------------------------------
// 2. Resolution — the precedence that matters
// ---------------------------------------------------------------------------
for (const [impl, resolve] of [['ts', resolveEnv], ['mjs', guard.resolveEnv]] as const) {
  const r = (env: Record<string, string | undefined>) => resolve(env as any)

  eq(`[${impl}] production URL resolves to production`,
    r({ NEXT_PUBLIC_SUPABASE_URL: PROD }).env, 'production')

  // THE ONE THAT MATTERS MOST.
  const mislabelled = r({ NEXT_PUBLIC_SUPABASE_URL: PROD, BENCHCOACH_ENV: 'staging' })
  eq(`[${impl}] a production URL labelled staging is still production`, mislabelled.env, 'production')
  ok(`[${impl}] and it says the label was ignored`, /ignored/.test(mislabelled.reason),
    'silently overruling a variable leaves someone convinced they are on staging')

  eq(`[${impl}] a declared staging is staging`,
    r({ NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'staging' }).env, 'staging')
  ok(`[${impl}] declared staging is not production`,
    !r({ NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'staging' }).isProduction)

  eq(`[${impl}] a localhost URL is local without any declaration`,
    r({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }).env, 'local')
  eq(`[${impl}] 127.0.0.1 is local too`,
    r({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }).env, 'local')

  // An unlabelled hosted project. Probably staging. Not good enough.
  const unknown = r({ NEXT_PUBLIC_SUPABASE_URL: STAGING })
  eq(`[${impl}] an unlabelled hosted project resolves to production`, unknown.env, 'production')
  ok(`[${impl}] and is flagged ambiguous`, unknown.ambiguous,
    'the caller has to be able to tell "known production" from "no idea", because only one of them can be overridden')

  const nothing = r({})
  eq(`[${impl}] no configuration at all resolves to production`, nothing.env, 'production')
  ok(`[${impl}] no configuration is ambiguous`, nothing.ambiguous)
  ok(`[${impl}] no configuration is isProduction`, nothing.isProduction)

  eq(`[${impl}] BENCHCOACH_ENV is case-insensitive`,
    r({ NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'STAGING' }).env, 'staging')
  eq(`[${impl}] a nonsense BENCHCOACH_ENV does not become staging`,
    r({ NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'stagng' }).env, 'production')

  ok(`[${impl}] every resolution states a reason`,
    [mislabelled, unknown, nothing].every(x => x.reason && x.reason.length > 10))
}

// The two implementations must agree case for case, not just in spirit.
for (const env of [
  { NEXT_PUBLIC_SUPABASE_URL: PROD },
  { NEXT_PUBLIC_SUPABASE_URL: PROD, BENCHCOACH_ENV: 'staging' },
  { NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'staging' },
  { NEXT_PUBLIC_SUPABASE_URL: STAGING },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' },
  {},
]) {
  const a = resolveEnv(env as any)
  const b = guard.resolveEnv(env)
  eq(`ts and mjs agree on env for ${JSON.stringify(env)}`, a.env, b.env)
  eq(`ts and mjs agree on ambiguity for ${JSON.stringify(env)}`, a.ambiguous, b.ambiguous)
  eq(`ts and mjs agree on the reason for ${JSON.stringify(env)}`, a.reason, b.reason)
}

eq('the two files name the same production project',
  PRODUCTION_PROJECT_REF, guard.PRODUCTION_PROJECT_REF)

// ---------------------------------------------------------------------------
// 3. A direct Postgres connection string
//
// seo-convert.mjs prefers SEO_DATABASE_URL, so a guard that only looked at the
// PostgREST URL would announce the wrong target.
// ---------------------------------------------------------------------------
const cs = (s: string) => guard.resolveEnvFromConnectionString(s, {})

eq('a direct connection to the production project is production',
  cs(`postgresql://postgres:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`).env, 'production')
eq('a POOLED connection to the production project is production too',
  cs(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`).env,
  'production')
eq('a local Postgres is local',
  cs('postgresql://postgres:pw@localhost:5432/postgres').env, 'local')
eq('an unrecognised host is production',
  cs('postgresql://postgres:pw@db.someoneelse.supabase.co:5432/postgres').env, 'production')
ok('an unrecognised host is ambiguous',
  cs('postgresql://postgres:pw@db.someoneelse.supabase.co:5432/postgres').ambiguous)
eq('an unparseable connection string is production',
  cs('not a url at all').env, 'production')

ok('a connection string is never echoed back',
  !JSON.stringify(cs('postgresql://postgres:hunter2@db.someoneelse.supabase.co:5432/postgres')).includes('hunter2'),
  'the resolution gets printed; a password in it would end up in a terminal and a CI log')

// ---------------------------------------------------------------------------
// 4. The production override
// ---------------------------------------------------------------------------
const prodEnv = guard.resolveEnv({ NEXT_PUBLIC_SUPABASE_URL: PROD })
const V = guard.PRODUCTION_OVERRIDE_VAR

ok('naming the resolved project authorises the write',
  guard.productionWriteAuthorised(prodEnv, { [V]: PRODUCTION_PROJECT_REF }))
ok('naming a DIFFERENT project does not',
  !guard.productionWriteAuthorised(prodEnv, { [V]: 'abcdefghijklmnopqrst' }),
  'otherwise an override left over from staging work would authorise a production write')
ok('a bare truthy value does not authorise',
  !guard.productionWriteAuthorised(prodEnv, { [V]: '1' }),
  'a boolean override gets exported into a shell profile once and then never turns off')
ok('yes does not authorise', !guard.productionWriteAuthorised(prodEnv, { [V]: 'yes' }))
ok('an absent override does not authorise',
  !guard.productionWriteAuthorised(prodEnv, {}))
ok('an empty override does not authorise',
  !guard.productionWriteAuthorised(prodEnv, { [V]: '   ' }))

// The ambiguous case can never be authorised — there is no ref to name.
const ambiguous = guard.resolveEnv({})
ok('an ambiguous target cannot be authorised at all',
  !guard.productionWriteAuthorised(ambiguous, { [V]: PRODUCTION_PROJECT_REF }),
  'you cannot consent to a destination you cannot identify')
ok('...not even by naming production',
  !guard.productionWriteAuthorised(ambiguous, { [V]: 'anything' }))

// ---------------------------------------------------------------------------
// 5. What gets printed
// ---------------------------------------------------------------------------
const prodLine = describeTarget(resolveEnv({ NEXT_PUBLIC_SUPABASE_URL: PROD } as any))
ok('the production banner says PRODUCTION', /PRODUCTION/.test(prodLine))
ok('the production banner shows the project', prodLine.includes(PRODUCTION_PROJECT_REF))

const ambLine = guard.describeTarget(guard.resolveEnv({}))
ok('an ambiguous banner says so explicitly', /AMBIGUOUS/.test(ambLine),
  '"PRODUCTION" on an unknown database is a lie in the safe direction; saying which it is costs nothing')

const stagingLine = guard.describeTarget(
  guard.resolveEnv({ NEXT_PUBLIC_SUPABASE_URL: STAGING, BENCHCOACH_ENV: 'staging' }))
ok('a staging banner carries no warning flag', !/⚠/.test(stagingLine),
  'a warning on every run is a warning nobody reads')

// A banner must never be able to carry a key.
for (const line of [prodLine, ambLine, stagingLine]) {
  ok('no banner contains a JWT', !/eyJ[A-Za-z0-9_-]{10,}/.test(line))
}

// ---------------------------------------------------------------------------
// 6. Required configuration
// ---------------------------------------------------------------------------
const REQUIRED = ENV_SPEC.filter(s => s.required).map(s => s.name)
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL']) {
  ok(`${name} is required`, REQUIRED.includes(name))
}
for (const name of ['STRIPE_SECRET_KEY', 'ANTHROPIC_API_KEY']) {
  ok(`${name} is NOT required`, !REQUIRED.includes(name),
    'staging must be able to exist without a production billing or AI credential')
}
ok('every spec entry explains what it is for', ENV_SPEC.every(s => s.purpose.length > 15))
ok('every optional entry that can break something says what',
  ENV_SPEC.filter(s => !s.required && /ADMIN|APP_URL|ANTHROPIC|STRIPE_SECRET|CRON/.test(s.name))
    .every(s => !!s.ifMissing))
ok('no spec entry is a secret with browser: true',
  !ENV_SPEC.some(s => s.browser && /SERVICE_ROLE|SECRET|_KEY$/.test(s.name) && !s.name.startsWith('NEXT_PUBLIC_')),
  'anything marked browser is compiled into the bundle and is therefore public')

const full = {
  NEXT_PUBLIC_SUPABASE_URL: STAGING, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc', ADMIN_EMAIL: 'a@b.co', BENCHCOACH_ENV: 'staging',
}
ok('a complete staging config passes', checkEnv(full as any).ok)
eq('a missing admin email fails the check',
  checkEnv({ ...full, ADMIN_EMAIL: '' } as any).ok, false)
eq('and names exactly what is missing',
  checkEnv({ ...full, ADMIN_EMAIL: '' } as any).missingRequired.map(s => s.name).join(','), 'ADMIN_EMAIL')
eq('whitespace does not count as set',
  checkEnv({ ...full, SUPABASE_SERVICE_ROLE_KEY: '   ' } as any).ok, false)
ok('a passing check still reports the environment',
  checkEnv(full as any).env.env === 'staging')

// ---------------------------------------------------------------------------
// 7. The scripts themselves
//
// Asserted against source because the property is "this file cannot be run
// against production by accident", and that is a property of the file.
// ---------------------------------------------------------------------------
const src = (p: string) => readFileSync(p, 'utf8')

const playbook = src('scripts/update-playbook-templates.mjs')
ok('update-playbook-templates no longer hardcodes a URL',
  !/https:\/\/[a-z0-9]+\.supabase\.co/.test(playbook))
ok('update-playbook-templates goes through the guard',
  playbook.includes('serviceClient(') || playbook.includes('requireTarget('))
ok('update-playbook-templates declares that it writes',
  /writes:\s*!DRY_RUN/.test(playbook))
ok('update-playbook-templates has a dry run',
  playbook.includes('--dry-run'),
  'it overwrites a JSON column wholesale with generated prose; being able to look first is worth a flag')

const seo = src('scripts/seo-convert.mjs')
ok('seo-convert guards before dispatching a command', seo.includes('requireTarget('))
ok('seo-convert treats apply/restore/auto/pilot as writes',
  ['apply', 'restore', 'auto', 'pilot'].every(c => new RegExp(`'${c}'`).test(seo)))
ok('seo-convert resolves against SEO_DATABASE_URL when that is what it will use',
  seo.includes('resolveEnvFromConnectionString'),
  'checking a different variable than the one the connection is made from is theatre')

// verify-env.mjs runs before any TypeScript is compiled, so it repeats the
// required list as a literal. This is the thing that keeps the repetition
// honest — a variable added to ENV_SPEC but not to the build check would be
// required by the app and unchecked by the deployment.
const buildCheck = src('scripts/verify-env.mjs')
for (const name of REQUIRED) {
  ok(`verify-env.mjs checks ${name}`, buildCheck.includes(`'${name}'`),
    'it is required by the app but the build would not notice it missing')
}
const checkedInBuild = Array.from(buildCheck.matchAll(/\['([A-Z0-9_]+)',/g)).map(m => m[1])
for (const name of checkedInBuild.filter(n => buildCheck.indexOf(`['${n}',`) < buildCheck.indexOf('const OPTIONAL'))) {
  ok(`${name} is required in verify-env.mjs and in ENV_SPEC`, REQUIRED.includes(name),
    'the build would block on a variable the app does not actually need')
}
ok('the build check never prints a value',
  !/console\.(log|error)\([^)]*process\.env\[/.test(buildCheck),
  'a build log is not a private place')

const links = src('scripts/verify-drill-links.mjs')
ok('verify-drill-links guards only its --write path',
  /writes:\s*WRITE/.test(links),
  'the read-only check is useful against production and must stay usable there')

const seed = src('scripts/seed-staging.mjs')
ok('seeding has no production override at all',
  /neverProduction:\s*true/.test(seed),
  'seeding upserts 600 rows over the live drill library; nobody should be one typo from that')
ok('seeding refuses anything that identifies a person',
  seed.includes('assertImpersonal'),
  'the export is regenerated from a live database by whoever runs it next, so "it was clean when I looked" is not a property the seed can rely on')
ok('seeding does not create coaches, teams, players or games',
  !/from\(['"](coaches|teams|players|games|entries|observations|player_notes)['"]\)/.test(seed),
  'those rows are real families’ records, and staging is the environment with looser access and credentials in more places')
ok('seeding covers exactly the three reference tables',
  ['problem_taxonomy', 'drill_resources', 'drill_problem_map'].every(t => seed.includes(t)))

// ---------------------------------------------------------------------------
// 8. An optional integration must not be able to fail the build
//
// The three Stripe routes each built their client at module scope with a `!`
// on an unset variable. `new Stripe(undefined)` throws, module scope runs
// while `next build` collects page data, and so the ENTIRE build failed —
// every page — because one optional integration had no key. That made a
// staging environment need a production billing credential in order to exist.
// ---------------------------------------------------------------------------
for (const route of ['checkout', 'portal', 'webhook']) {
  const s = src(`app/api/stripe/${route}/route.ts`)
  const code = s.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  ok(`stripe/${route} does not construct Stripe at module scope`,
    !/^const stripe = new Stripe\(/m.test(code),
    'it throws on load with no key, and module load happens during next build')
  ok(`stripe/${route} builds the client per request`,
    code.includes('getStripe()'))
  ok(`stripe/${route} answers 503 rather than crashing when Stripe is absent`,
    code.includes('stripeUnavailable()'),
    'nothing is broken — the capability is absent, and 503 says which')
}
ok('the Stripe helper returns null rather than throwing',
  /return null/.test(src('lib/stripe.ts')),
  'a caller has to be able to decide what a missing integration means for it')

const guardSrc = src('scripts/lib/env-guard.mjs')
ok('the neverProduction refusal does not advertise the override',
  guardSrc.indexOf('has no production override') > 0 &&
  guardSrc.indexOf('has no production override') < guardSrc.indexOf('If you genuinely mean it'),
  'a message offering an escape hatch the caller then ignores is worse than no message')

// ---------------------------------------------------------------------------
console.log(`\nenv safety: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('\nAmbiguity resolves to production, a URL beats a label, and the override')
console.log('has to name the project it is authorising.\n')
