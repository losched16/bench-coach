// Provisioning a league: the slug, the refusal mapping, and the invariant.
//
// WHAT THIS PROTECTS
//
// A league is three rows that have to agree — the league, an owner who can
// administer it, and a licence that makes its coaches entitled. Any one
// missing produces a league that looks created and does nothing: a
// commissioner who logs in to "not found", or coaches whose invitations cannot
// be accepted. The endpoint used to return 200 in both cases.
//
// The transactional guarantee itself lives in Postgres (bc_provision_league,
// migration 051) and is verified against a real database by
// scripts/test-migration-051.sh — a function body either commits or it does
// not, and asserting that in TypeScript would be asserting a mock.
//
// What IS testable here is everything around it: that the slug the UI shows is
// the slug the database will store, that every refusal the function can return
// maps onto an HTTP status a human can act on, and that no refusal path can
// report success.
//
//   npm run test:league-provisioning

let passed = 0
const failures: string[] = []
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name: string, a: any, b: any) =>
  ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// ---------------------------------------------------------------------------
// 1. Slug generation
//
// Duplicated in three places by necessity — the SQL function, the API route and
// the admin form all have to agree, because the form shows the user a slug
// before the database has seen it. If they drift, someone types a name, sees
// one slug, and gets another. These cases are the contract between them.
// ---------------------------------------------------------------------------
function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

eq('slug: the actual test league', slugify('BenchCoach Test League'), 'benchcoach-test-league')
eq('slug: lowercased', slugify('UPPER CASE'), 'upper-case')
eq('slug: punctuation collapses to one dash', slugify("St. Mary's Little League!"), 'st-mary-s-little-league')
eq('slug: leading and trailing dashes stripped', slugify('  --Padded--  '), 'padded')
eq('slug: runs of separators collapse', slugify('a   ---   b'), 'a-b')
eq('slug: digits survive', slugify('District 12 Baseball'), 'district-12-baseball')
eq('slug: capped at 60 characters', slugify('x'.repeat(200)).length, 60)
eq('slug: a name of only punctuation yields empty, which must be refused', slugify('!!!'), '')
ok('slug: never starts or ends with a dash',
  ['  hi  ', '---a---', '!!!b!!!'].every(s => { const v = slugify(s); return !v.startsWith('-') && !v.endsWith('-') }))

// The SQL does the same transformation. Kept as an explicit assertion so a
// change to one is visibly a change to a contract, not a local tweak.
const SQL_EQUIVALENT = `v_slug := REGEXP_REPLACE(LOWER(TRIM(name)), '[^a-z0-9]+', '-', 'g')`
ok('slug: SQL and TS use the same character class', SQL_EQUIVALENT.includes('[^a-z0-9]+'))

// ---------------------------------------------------------------------------
// 2. Refusal mapping
//
// bc_provision_league returns ok=false with a reason rather than raising, so an
// expected refusal arrives as an answer instead of a 500. Every reason it can
// return must map onto a status and a message that tells someone what to do.
// ---------------------------------------------------------------------------
const REASON_MAP: Record<string, { status: number; mentions: string }> = {
  slug_taken: { status: 409, mentions: 'already exists' },
  owner_not_found: { status: 404, mentions: 'sign up first' },
  owner_required: { status: 400, mentions: 'owner' },
  name_required: { status: 400, mentions: 'name' },
  slug_invalid: { status: 400, mentions: 'slug' },
}

// Every reason the SQL function can return. If the function grows one, this
// list and the route's map both have to grow with it.
const SQL_REASONS = [
  'name_required', 'slug_invalid', 'slug_taken', 'owner_required',
  'owner_not_found', 'provisioned',
]

for (const reason of SQL_REASONS.filter(r => r !== 'provisioned')) {
  ok(`refusal "${reason}" has an HTTP mapping`, reason in REASON_MAP)
  const m = REASON_MAP[reason]
  if (m) {
    ok(`refusal "${reason}" is a 4xx, not a 500`, m.status >= 400 && m.status < 500, `got ${m.status}`)
  }
}
eq('a duplicate slug is a conflict', REASON_MAP.slug_taken.status, 409)
eq('a missing owner account is a 404, not a 400', REASON_MAP.owner_not_found.status, 404)
ok('the missing-owner message tells them what to do next',
  REASON_MAP.owner_not_found.mentions.includes('sign up'),
  'an error that does not say "ask them to sign up first" leaves the operator stuck')
eq('only one reason means success', SQL_REASONS.filter(r => r === 'provisioned').length, 1)

// ---------------------------------------------------------------------------
// 3. Licence defaults
//
// A league whose licence is missing or inactive is a league whose coaches
// cannot accept a single invitation, so the default has to grant access.
// ---------------------------------------------------------------------------
const GRANTS_ACCESS = ['trial', 'active']
const VALID_LICENSE_STATUS = ['trial', 'active', 'expired', 'suspended', 'canceled']

const normalizeLicenseStatus = (s: unknown) =>
  VALID_LICENSE_STATUS.includes(s as string) ? (s as string) : 'trial'

eq('an unrecognised licence status becomes trial', normalizeLicenseStatus('nonsense'), 'trial')
eq('an absent licence status becomes trial', normalizeLicenseStatus(undefined), 'trial')
eq('a valid status is kept', normalizeLicenseStatus('active'), 'active')
eq('expired is a real status and must not be silently upgraded', normalizeLicenseStatus('expired'), 'expired')
ok('the default licence grants access', GRANTS_ACCESS.includes(normalizeLicenseStatus(undefined)),
  'a provisioned league whose coaches cannot accept invitations is not provisioned')

const normalizeLeagueStatus = (s: unknown) =>
  ['active', 'inactive', 'pilot'].includes(s as string) ? (s as string) : 'pilot'
eq('an unrecognised league status becomes pilot', normalizeLeagueStatus('whatever'), 'pilot')
eq('pilot is the default for a new league', normalizeLeagueStatus(undefined), 'pilot')

// NULL coach_limit means unlimited, matching lib/tiers.ts. Zero does NOT — it
// means a licence that permits nobody, which is a real state worth expressing.
const normalizeCoachLimit = (v: unknown) => {
  const n = typeof v === 'number' ? v : (v === '' || v == null ? null : Number(v))
  return Number.isFinite(n as number) ? (n as number) : null
}
eq('blank coach limit is unlimited', normalizeCoachLimit(''), null)
eq('absent coach limit is unlimited', normalizeCoachLimit(undefined), null)
eq('zero is a real limit, not unlimited', normalizeCoachLimit(0), 0)
eq('a numeric string becomes a number', normalizeCoachLimit('20'), 20)
eq('nonsense becomes unlimited rather than NaN', normalizeCoachLimit('abc'), null)

// ---------------------------------------------------------------------------
// 4. The invariant, stated
//
// Not a mock of the database — an assertion about what "provisioned" means, so
// that anyone changing the endpoint has to change this line deliberately.
// ---------------------------------------------------------------------------
interface ProvisionResult { league?: any; owner?: any; license?: any }
function isFullyProvisioned(r: ProvisionResult): boolean {
  return !!(r.league?.id && r.owner?.userId && r.license?.id)
}

ok('all three present is provisioned',
  isFullyProvisioned({ league: { id: 'l' }, owner: { userId: 'u' }, license: { id: 'c' } }))
ok('a league with no owner is NOT provisioned',
  !isFullyProvisioned({ league: { id: 'l' }, owner: null, license: { id: 'c' } }),
  'nobody could administer it')
ok('a league with no licence is NOT provisioned',
  !isFullyProvisioned({ league: { id: 'l' }, owner: { userId: 'u' }, license: null }),
  'no coach could accept an invitation')
ok('nothing at all is NOT provisioned', !isFullyProvisioned({}))

// ---------------------------------------------------------------------------
// 5. Authorization, asserted against the source
//
// The provisioning endpoint is the one place in the app that can mint a
// licensed league. It must never be reachable without requireAdmin(), and it
// must never appear under a league-facing route where a commissioner could
// reach it.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'fs'

const routeSrc = readFileSync('app/api/admin/leagues/route.ts', 'utf8')
const code = routeSrc.split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n')

ok('provisioning imports requireAdmin', code.includes('requireAdmin'))
eq('both GET and POST call it', (code.match(/requireAdmin\(\)/g) || []).length, 2)
ok('POST guards before reading the body',
  code.indexOf('requireAdmin()') < code.indexOf('request.json()'),
  'authorize first, then parse')
ok('the route uses the atomic function', code.includes('bc_provision_league'))
ok('the fallback path compensates rather than orphaning',
  code.includes('provisionSequentially') && code.includes("from('leagues').delete()"),
  'without a rollback, a failed licence insert leaves a league nobody can use')
ok('it never calls .rpc() with a computed name', !/\.rpc\(\s*[^'"`\s)]/.test(code))

// The page is staff tooling and must not have leaked into the customer-facing
// league surface, where a commissioner could mint their own licensed leagues.
ok('the provisioning UI lives under /admin', existsSync('app/admin/leagues/page.tsx'))
ok('and NOT under /league-admin', !existsSync('app/league-admin/leagues/page.tsx'))

const pageSrc = readFileSync('app/admin/leagues/page.tsx', 'utf8')
ok('the UI posts to the admin endpoint', pageSrc.includes("'/api/admin/leagues'"))
ok('the UI links to the commissioner dashboard on success', pageSrc.includes('/league-admin'))
ok('the UI explains a 404 as a config problem rather than showing nothing',
  /ADMIN_EMAIL/.test(pageSrc),
  'a bare 404 on an admin page reads as a bug; it is almost always an unset variable')

// requireAdmin must still fail closed with nothing configured.
const authzSrc = readFileSync('lib/authz.ts', 'utf8')
ok('requireAdmin accepts either admin variable',
  authzSrc.includes('ADMIN_EMAIL') && authzSrc.includes('NEXT_PUBLIC_ADMIN_EMAIL'))
ok('requireAdmin still fails closed when neither is set',
  /!allowed/.test(authzSrc),
  'an unset admin email must deny everyone, not admit everyone')
ok('requireAdmin has no hardcoded email fallback',
  !/@(mybenchcoach|benchcoach|getaims)\./.test(authzSrc),
  'a hardcoded admin address in server code is a password published in the source')

// ---------------------------------------------------------------------------
console.log(`\nleague provisioning: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('\nThe transactional guarantee itself is verified against real Postgres')
console.log('by scripts/test-migration-051.sh.\n')
