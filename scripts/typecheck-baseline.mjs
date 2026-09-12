// The TypeScript baseline, counted the same way every time.
//
// This number gets quoted between sessions as proof that a change introduced
// nothing, so it has to mean the same thing each time it is measured. Twice now
// it has not: 187, then 189, then 198, with a chunk of the difference being
// neither regression nor fix.
//
// Two reasons, both handled here.
//
// `.next/types/**` is GENERATED. Whether a diagnostic in it appears depends on
// whether the directory was freshly built, so a plain `tsc | grep -c` counts a
// different thing before and after a build. Those are excluded.
//
// And the raw diagnostic text carries line and column numbers, so a naive diff
// between two runs reports every line shift as a new error — 45 "new" and 36
// "gone" on one comparison where the real change was nine. `--by-file` prints
// the per-file counts, which is the shape worth diffing.
//
//   node scripts/typecheck-baseline.mjs
//   node scripts/typecheck-baseline.mjs --by-file
//
// The count is the repo's known untyped-Supabase-client debt: the client has no
// generated Database types, so `.eq(col, value)` takes `{}` and rows infer as
// `never`. It is not a to-do list of bugs. It goes DOWN when dead code is
// deleted and UP when a page adds another query, and neither is a regression.

import { execSync } from 'child_process'

const byFile = process.argv.includes('--by-file')

let out = ''
try {
  out = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '')
}

const all = out.split('\n').filter(l => l.includes('error TS'))
const generated = all.filter(l => l.startsWith('.next/'))
const real = all.filter(l => !l.startsWith('.next/'))

if (byFile) {
  const counts = new Map()
  for (const line of real) {
    const file = line.split('(')[0]
    counts.set(file, (counts.get(file) || 0) + 1)
  }
  for (const [file, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${file}`)
  }
  console.log('')
}

console.log(`baseline: ${real.length}`)
if (generated.length) {
  console.log(`  (${generated.length} more in generated .next/types, excluded — they depend on build state)`)
}
