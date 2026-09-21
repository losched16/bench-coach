#!/usr/bin/env node
// The checks that stand between a commit and production.
//
//   npm run gate          # everything below
//   npm run build         # runs it automatically, via prebuild
//
// WHY THIS IS A REAL GATE AND NOT A SUGGESTION
//
// Verified from the build log of dpl_H6quRyrwDdJr61mKgswG5tmEUVv9:
//
//     Detected Next.js version: 14.2.0
//     Running "npm run build"
//     > benchcoach@1.0.0 prebuild
//     > node scripts/verify-env.mjs
//     > benchcoach@1.0.0 build
//     > next build
//
// Vercel runs `npm run build`, so npm runs `prebuild` first. If prebuild exits
// non-zero, `npm run build` fails, the deployment goes to ERROR, and the
// production alias keeps pointing at the previous build. That is the whole
// mechanism: there is no branch protection on this repo, no CI required
// check, and no review step — `git push origin main` deploys. The build script
// is the only thing in that path that can say no.
//
// WHAT IS DELIBERATELY NOT IN HERE
//
// The Chromium suite. It needs a dev server and a browser binary, neither of
// which exists in a Vercel build container, and a gate that cannot run is
// worse than an honest omission. It runs in .github/workflows/checks.yml
// instead — which, to be clear, does NOT block anything until branch
// protection requires it. See docs/release-gates.md.
//
// Each check below is fast (the whole run is seconds) and deterministic. If
// something slow or flaky ever needs adding, it belongs in CI, not here:
// a build gate that intermittently fails deployments will be deleted within a
// week, and it will take the useful checks with it.

import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKS = [
  {
    name: 'environment',
    why: 'a missing anon key fails as an unreadable prerender trace',
    run: ['node', ['scripts/verify-env.mjs']],
  },
  {
    name: 'hook rules',
    why: 'a hook below an early return renders the page as nothing',
    run: ['npx', ['eslint', '--no-eslintrc', '-c', '.eslintrc.hooks.cjs',
                  '--ext', '.ts,.tsx', 'app', 'components', 'lib']],
  },
  {
    name: 'hook order (scanner)',
    why: 'belt and braces on the specific shape that shipped broken',
    run: ['npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/test-hook-order.ts']],
  },
  {
    name: 'types',
    why: 'no NEW type errors against the recorded baseline',
    run: ['node', ['scripts/typecheck-baseline.mjs']],
  },
  {
    name: 'route authorization',
    why: 'every API handler authorizes its caller',
    run: ['node', ['scripts/verify-authz.mjs']],
  },
  {
    name: 'help content',
    why: 'guides may not name controls that do not exist, or leak repair instructions',
    run: ['npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/test-help-content.ts']],
  },
  {
    // Safety-critical: these assert that the pitch guide claims no
    // enforcement, no compliance and nothing medical, and that the four
    // display states are what the guide says they are. It was written in the
    // last phase and wired to NOTHING — defined in package.json and invoked
    // by no workflow and no gate. Found by checking rather than assuming.
    name: 'pitch counter',
    why: 'the pitch guide may not claim enforcement, compliance or safety',
    run: ['npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/test-pitch-count.ts']],
  },
  {
    name: 'onboarding rules',
    why: 'a failed query must not read as a new coach',
    run: ['npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/test-onboarding.ts']],
  },
]

const only = process.argv[2]
const selected = only ? CHECKS.filter(c => c.name.includes(only)) : CHECKS

console.log(`\nRelease gate — ${selected.length} checks\n`)

const failed = []
for (const check of selected) {
  const started = Date.now()
  process.stdout.write(`  ${check.name.padEnd(22)}`)
  try {
    execFileSync(check.run[0], check.run[1], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    console.log(`ok   ${Date.now() - started}ms`)
  } catch (e) {
    console.log(`FAIL ${Date.now() - started}ms`)
    failed.push({ check, output: ((e.stdout || '') + (e.stderr || '')).trim() })
  }
}

if (failed.length === 0) {
  console.log('\n✓ Gate passed. This build may deploy.\n')
  process.exit(0)
}

console.error(`\n✗ ${failed.length} check(s) failed. THIS BUILD WILL NOT DEPLOY.\n`)
for (const f of failed) {
  console.error(`── ${f.check.name} ${'─'.repeat(Math.max(0, 60 - f.check.name.length))}`)
  console.error(`   ${f.check.why}\n`)
  console.error(f.output.split('\n').slice(-40).map(l => `   ${l}`).join('\n'))
  console.error('')
}
console.error('Run `npm run gate` locally to reproduce.\n')
process.exit(1)
