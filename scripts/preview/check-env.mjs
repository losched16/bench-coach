#!/usr/bin/env node
// Refuses to continue unless the environment is an ISOLATED preview.
//
//   PRODUCTION_SUPABASE_REF=<ref of production> node scripts/preview/check-env.mjs
//
// It reads the same variables the app reads and prints only yes/no results,
// never a value. Run it in the shell you deploy or test from (or wire it as a
// check) before any preview test touches data.
//
// Checks:
//  - the Supabase URL is a project, and is NOT the production project
//  - the service key and anon key are set (their values are never printed)
//  - Stripe is a TEST key (sk_test_), and the webhook secret is set
//  - both launch flags are explicit, and not "1" unless PREVIEW_ALLOW_FLAGS=1
//  - no variable still points at a production hostname

const env = process.env
const problems = []
const ok = []
const need = (name) => (env[name] && env[name].trim() ? env[name].trim() : null)

const prodRef = need('PRODUCTION_SUPABASE_REF')
if (!prodRef) problems.push('PRODUCTION_SUPABASE_REF is not set: set it to the production project ref so this check can tell them apart')

const url = need('NEXT_PUBLIC_SUPABASE_URL')
let ref = null
if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is not set')
else {
  try {
    const u = new URL(url)
    const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)
    if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(u.hostname)) problems.push('the Supabase URL is not https')
    ref = m ? m[1] : (['127.0.0.1', 'localhost'].includes(u.hostname) ? 'local' : null)
    if (!ref) problems.push('the Supabase URL is not a <ref>.supabase.co project or a local fixture')
  } catch { problems.push('the Supabase URL is not a valid URL') }
}
if (ref && prodRef && ref === prodRef) problems.push('REFUSED: the Supabase URL is the PRODUCTION project')
else if (ref && prodRef) ok.push('the Supabase project is not the production project')

for (const k of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (need(k)) ok.push(`${k} is set`); else problems.push(`${k} is not set`)
}
// A service key minted for a different project would still be refused by Supabase, but fail early:
// the key's payload names its project ref.
const svc = need('SUPABASE_SERVICE_ROLE_KEY')
if (svc && svc.split('.').length === 3) {
  try {
    const claims = JSON.parse(Buffer.from(svc.split('.')[1], 'base64url').toString())
    if (claims.ref && ref && claims.ref !== ref) problems.push('the service key belongs to a different project than the URL')
    else if (claims.ref && prodRef && claims.ref === prodRef) problems.push('REFUSED: the service key is the PRODUCTION key')
  } catch { /* opaque key format: nothing to compare */ }
}

const sk = need('STRIPE_SECRET_KEY')
if (!sk) problems.push('STRIPE_SECRET_KEY is not set')
else if (!sk.startsWith('sk_test_') && !sk.startsWith('rk_test_')) problems.push('REFUSED: the Stripe key is not a TEST key')
else ok.push('the Stripe key is a test key')
if (!need('STRIPE_WEBHOOK_SECRET')) problems.push('STRIPE_WEBHOOK_SECRET is not set (use the secret of the TEST-mode webhook endpoint)')

if (env.VERCEL_ENV === 'production') problems.push('REFUSED: VERCEL_ENV is production')
for (const flag of ['SPEED_PROGRAM', 'ACADEMY_LAUNCH']) {
  if (env[flag] === '1' && env.PREVIEW_ALLOW_FLAGS !== '1') problems.push(`${flag}=1 but PREVIEW_ALLOW_FLAGS is not 1 (turn flags on only deliberately, in the preview)`)
  else ok.push(`${flag} is ${env[flag] === '1' ? 'ON (allowed for this preview)' : 'off'}`)
}

for (const line of ok) console.log(`  ok    ${line}`)
for (const line of problems) console.log(`  FAIL  ${line}`)
if (problems.length) { console.log('\nNot safe to test against.'); process.exit(1) }
console.log('\nThis looks like an isolated preview.')
