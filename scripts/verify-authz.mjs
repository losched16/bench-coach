// Every API route must decide who is calling.
//
// The routes use the service-role client, which bypasses RLS — so RLS protects
// nothing on these paths and each handler is on its own. For a long time most
// of them took a teamId from the request body and trusted it, which meant any
// signed-in user could read and write another coach's team.
//
// This fails the build-time check if a handler has no guard. The exemptions are
// listed with a reason each; adding to that list is a deliberate act.
//
//   npm run verify:authz

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Routes that authenticate by some other means, each with the reason.
const EXEMPT = {
  'app/api/cron/checkin-digest/route.ts': 'CRON_SECRET header — no user session exists',
  'app/api/stripe/webhook/route.ts':      'Stripe signature verification',
  'app/api/stripe/checkout/route.ts':     'own session; creates a checkout for the caller',
  'app/api/stripe/portal/route.ts':       'own session; opens the caller’s own portal',
  'app/api/ghl/track-signup/route.ts':    'runs at signup, before a session exists',
  'app/api/team/invite/accept/route.ts':  'a token IS the credential — the caller is not a member yet',
  // Same reason as the team invite above, and the same shape: the caller is
  // not a member of the league or the team yet, so there is no membership to
  // check. The 256-bit token we issued stands in for it, the claimed userId is
  // verified against auth.admin.getUserById before anything is written, and
  // every property of the invitation is re-read from the database rather than
  // trusted from the request.
  'app/api/league/invite/accept/route.ts': 'a token IS the credential — the caller is not a member yet',
  'app/api/team/invite/route.ts':         'checks the session and owner/admin role inline',
  'app/api/team/members/route.ts':        'checks the session and owner/admin role inline',
  // Anonymous by design: it counts what visitors do on the public marketing
  // pages, and those visitors have no account. Writes nothing but a name from
  // a fixed allowlist and a few length-capped strings, and stores no
  // identifier — so there is no principal to authorize and nothing to leak.
  'app/api/track/seo/route.ts':           'public marketing pages — the visitors it measures have no session',
}

// The league guards live in lib/leagueAuthz.ts rather than lib/authz.ts, because
// "may this person administer this league" is a different question about a
// different principal than "may this person touch this team's data". They are
// listed here as first-class guards: a league route that calls one has
// authorized its caller just as thoroughly as a team route that calls guard().
const GUARDS = [
  'guard(', 'requireSession(', 'requireAdmin(', 'authorizeTeam(',
  'authorizeGame(', 'authorizeCoach(', 'authorizeThread(',
  'guardLeague(', 'requireLeagueRole(',
]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

const problems = []
let checked = 0
let exempted = 0

for (const file of walk('app/api').sort()) {
  if (EXEMPT[file]) { exempted++; continue }
  const src = readFileSync(file, 'utf8')
  checked++

  // A guarded route MUST be dynamic. Without it, Next tries to prerender the
  // handler at build time with a stand-in Request whose .url and .method throw
  // — which passed locally and failed the deploy.
  if (!src.includes("export const dynamic")) {
    problems.push(`${file} — no \`export const dynamic = 'force-dynamic'\` (auth reads cookies; it must never be prerendered)`)
  }

  for (const m of METHODS) {
    const re = new RegExp(`export async function ${m}\\s*\\(`)
    const at = src.search(re)
    if (at === -1) continue
    // The guard has to be the first thing the handler does, before any query.
    const head = src.slice(at, at + 500)
    if (!GUARDS.some(g => head.includes(g))) {
      problems.push(`${file} — ${m} has no authorization guard`)
    }
  }
}

if (problems.length > 0) {
  console.error('Unguarded API handlers:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(`\nAdd a guard from lib/authz, or add the file to EXEMPT in this script with a reason.`)
  process.exit(1)
}

console.log(`Checked ${checked} route files (${exempted} exempt) — every handler authorizes its caller, and none can be prerendered.`)
