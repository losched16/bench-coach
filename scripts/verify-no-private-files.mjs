#!/usr/bin/env node
// Fails if a file that must never be committed is tracked by git.
//
// This repository is public. Course text, import reports built from it, and
// anything marked private must stay out of every commit on every branch.
// (A private folder was once committed to a branch whose .gitignore lacked the
// rule. The rule now lives here too, so the gate fails instead of the leak.)
//
// Where there is no git checkout (a build container), there is nothing to check.

import { execFileSync } from 'child_process'

const PRIVATE = [
  [/^\.academy-content\//, 'private Academy course material'],
  [/(^|\/)PRIVATE-[^/]*$/i, 'a file named PRIVATE-*'],
  [/\.seed\.sql$/, 'a generated course seed (contains lesson text)'],
  [/^\.env($|\.)/, 'an environment file'],
]
let files
try { files = execFileSync('git', ['ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean) }
catch { console.log('no git checkout here; nothing to verify'); process.exit(0) }

const bad = []
for (const f of files) for (const [re, why] of PRIVATE) if (re.test(f) && !/\.example$/.test(f)) bad.push(`${f}  (${why})`)
if (bad.length) { console.error('Tracked files that must stay private:\n  ' + bad.join('\n  ') + '\n\nRemove them from the commit (and from history if pushed), and keep them in .gitignore.'); process.exit(1) }
console.log(`${files.length} tracked files; none are private`)
