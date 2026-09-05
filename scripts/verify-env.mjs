#!/usr/bin/env node
// Fail the build now, with a sentence, rather than at request time with a 500.
//
//   npm run verify:env      # on its own
//   npm run build           # runs automatically, via prebuild
//
// WHY THIS RUNS AT BUILD
//
// next.config.js sets both typescript.ignoreBuildErrors and
// eslint.ignoreDuringBuilds, so a BenchCoach build succeeds against almost
// anything. What it cannot survive is a missing NEXT_PUBLIC_SUPABASE_ANON_KEY
// — and the way it fails is a prerender error deep in a page trace that says
// nothing about environment variables. A whole afternoon has been lost to that
// exact message.
//
// The other direction is worse and quieter. ADMIN_EMAIL unset does not fail
// anything: requireAdmin() denies everyone, every /api/admin/* route answers
// 404, and /admin/leagues looks like a bug in the page. Deploying that is
// possible today and nothing says a word.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It never prints a value, only whether one is present. It does not check that
// a key WORKS — that needs a network call, which does not belong in a build —
// and it does not check the optional variables beyond listing what each one
// switches off, because a staging environment that has no Stripe key is
// correct, not broken.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFiles, resolveEnv, describeTarget } from './lib/env-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

loadEnvFiles()

// Mirrors ENV_SPEC in lib/env.ts. Kept as a literal rather than imported
// because this runs before any TypeScript is compiled; test-env-safety.ts
// asserts the two lists agree.
const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'the build cannot resolve a database, and every page that reads data fails to prerender'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'prerendering fails with an error that never mentions environment variables'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'every server route that reads across users returns 500 at request time'],
  ['ADMIN_EMAIL', 'requireAdmin() denies everyone, so /api/admin/* answers 404 and the admin pages look broken'],
]

const OPTIONAL = [
  ['NEXT_PUBLIC_ADMIN_EMAIL', 'the admin nav hides itself; the API still works off ADMIN_EMAIL'],
  ['NEXT_PUBLIC_APP_URL', 'invitation links are built against http://localhost:3000 and are dead for the recipient'],
  ['ANTHROPIC_API_KEY', 'chat, practice plans and diagnosis fail at request time'],
  ['STRIPE_SECRET_KEY', 'individual checkout fails; league-sponsored coaches never reach it'],
  ['STRIPE_WEBHOOK_SECRET', 'Stripe webhooks are rejected, so subscriptions never activate'],
  ['CRON_SECRET', 'the weekly check-in cron refuses — which is the safe direction'],
]

const present = (n) => !!(process.env[n] && String(process.env[n]).trim())

const env = resolveEnv()
const missing = REQUIRED.filter(([n]) => !present(n))
const off = OPTIONAL.filter(([n]) => !present(n))

console.log('')
console.log(`  environment: ${describeTarget(env)}`)
console.log(`  ${env.reason}`)
console.log('')

if (off.length) {
  console.log('  not configured — these features are off in this environment:')
  for (const [n, effect] of off) console.log(`    ${n.padEnd(30)} ${effect}`)
  console.log('')
}

if (missing.length) {
  console.error('BUILD STOPPED — required environment variables are missing.')
  console.error('')
  for (const [n, effect] of missing) {
    console.error(`  ${n}`)
    console.error(`    without it: ${effect}`)
    console.error('')
  }
  console.error('  Set them where this is being built:')
  console.error('    locally  → .env.local  (see .env.example)')
  console.error('    Vercel   → Project Settings → Environment Variables, per environment')
  console.error('')
  console.error('  docs/ENVIRONMENTS.md has the full list and which value belongs where.')
  console.error('')
  process.exit(1)
}

console.log(`  all ${REQUIRED.length} required variables are set.`)
console.log('')
