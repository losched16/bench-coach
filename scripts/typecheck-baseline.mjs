// The TypeScript baseline — enforced, not merely counted.
//
//   node scripts/typecheck-baseline.mjs            # check; exit 1 on anything new
//   node scripts/typecheck-baseline.mjs --by-file  # ...and print per-file counts
//   node scripts/typecheck-baseline.mjs --update   # deliberately rewrite the baseline
//
// WHY IT USED TO BE USELESS
//
// It printed a number and exited 0. Every report that said "typecheck 196,
// unchanged" was a human reading a number, not a check. Worse, a total is not
// a baseline: fix one error and introduce another and the total is identical,
// so the thing most likely to matter — a NEW diagnostic — was exactly what it
// could not see. It also exited 0 when tsc failed to run at all, and during
// the last closeout the count "improved" from 196 to 5 because a broken import
// made the compiler give up early. A falling number was the symptom of
// something worse, and nothing noticed.
//
// WHAT IT COMPARES
//
// Not the total. A multiset of normalised diagnostic IDENTITIES:
//
//     path/to/file.tsx :: TS2345 :: Argument of type 'string | null' is not…
//
// Line and column are deliberately dropped, because adding an import shifts
// every line below it and a naive diff then reports 45 new and 36 gone when
// nothing changed. Identical diagnostics in one file are counted, so deleting
// one of three and adding a fourth is still caught.
//
// WHAT FAILS THE RUN
//
//   * a diagnostic identity that is not in the baseline, or more of one than
//     the baseline records
//   * tsc failing to run, or a configuration error (TS5xxx / TS6xxx)
//   * an incomplete run — killed, out of memory, or no output at all
//
// A diagnostic that has GONE is reported and does not fail. It also does not
// silently rewrite the file: shrinking the baseline is a deliberate act, done
// with --update and committed, so the debt cannot quietly drift downward-then-
// upward without anybody seeing it.
//
// THE DEBT ITSELF IS NOT A TO-DO LIST. Nearly all of it is one thing: the
// Supabase client has no generated Database types, so `.eq(col, value)` takes
// `{}` and rows infer as `never`. Fixing that is a separate piece of work and
// is not attempted here.
//
// `.next/types/**` is GENERATED and excluded — whether those diagnostics
// appear depends on whether the directory was freshly built, so including them
// would make the baseline mean different things before and after a build.

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'typecheck-baseline.json')

const byFile = process.argv.includes('--by-file')
const update = process.argv.includes('--update')

// ── run the compiler ────────────────────────────────────────────────────────

let out = ''
let ranClean = false
try {
  out = execFileSync('npx', ['tsc', '--noEmit'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  ranClean = true
} catch (e) {
  // tsc exits non-zero whenever there are diagnostics, which is the normal
  // case here. What matters is whether it actually produced diagnostics.
  out = (e.stdout || '') + (e.stderr || '')
  if (e.signal || e.code === 'ENOENT' || e.code === 'ETIMEDOUT') {
    fail(`tsc did not complete (${e.signal || e.code}). This is not a passing typecheck.`)
  }
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const lines = out.split('\n')
const diagnostics = lines.filter(l => /error TS\d+:/.test(l))

// A run that produced neither diagnostics nor a clean exit told us nothing.
if (!ranClean && diagnostics.length === 0) {
  console.error(out.slice(0, 2000))
  fail('tsc produced no diagnostics and did not exit cleanly — the run is incomplete.')
}

// Configuration and CLI errors are not code debt; they mean the check itself
// is broken, and they are what made the count collapse to 5 last time.
const configErrors = diagnostics.filter(l => /error TS[56]\d{3}:/.test(l))
if (configErrors.length) {
  console.error(configErrors.slice(0, 10).join('\n'))
  fail(`${configErrors.length} compiler/configuration error(s). Fix these before reading any count.`)
}

// ── normalise ───────────────────────────────────────────────────────────────

/** `file(12,34): error TS2345: msg` → `file :: TS2345 :: msg` */
function identity(line) {
  const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
  if (!m) return null
  const [, file, , , code, message] = m
  return `${file} :: ${code} :: ${message.trim()}`
}

const real = []
const generated = []
for (const line of diagnostics) {
  const id = identity(line)
  if (!id) continue
  ;(line.startsWith('.next/') ? generated : real).push(id)
}

if (real.length === 0 && !ranClean) {
  fail('no diagnostics parsed from a failing tsc run — the output format changed?')
}

const tally = list => {
  const m = new Map()
  for (const id of list) m.set(id, (m.get(id) || 0) + 1)
  return m
}
const now = tally(real)

// ── per-file view ───────────────────────────────────────────────────────────

if (byFile) {
  const counts = new Map()
  for (const id of real) {
    const file = id.split(' :: ')[0]
    counts.set(file, (counts.get(file) || 0) + 1)
  }
  for (const [file, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${file}`)
  }
  console.log('')
}

// ── compare ─────────────────────────────────────────────────────────────────

const serialise = map => ({
  note: 'Generated by scripts/typecheck-baseline.mjs --update. Known, accepted ' +
        'type debt: mostly the untyped Supabase client. Adding to this file ' +
        'should be a deliberate, reviewed decision.',
  total: real.length,
  diagnostics: Object.fromEntries([...map.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
})

if (update) {
  writeFileSync(BASELINE, JSON.stringify(serialise(now), null, 2) + '\n')
  console.log(`\nBaseline rewritten: ${real.length} diagnostics across ${now.size} identities.`)
  console.log('Commit typecheck-baseline.json with the change that justified it.\n')
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  fail(`No ${BASELINE}. Create it once with: node scripts/typecheck-baseline.mjs --update`)
}

let base
try {
  base = new Map(Object.entries(JSON.parse(readFileSync(BASELINE, 'utf8')).diagnostics || {}))
} catch (e) {
  fail(`Could not read the baseline file: ${e.message}`)
}

const added = []
const removed = []
for (const [id, n] of now) {
  const was = base.get(id) || 0
  if (n > was) added.push({ id, n: n - was })
}
for (const [id, n] of base) {
  const is = now.get(id) || 0
  if (is < n) removed.push({ id, n: n - is })
}

console.log(`baseline: ${real.length} (recorded ${base.size} identities)`)
if (generated.length) {
  console.log(`  (${generated.length} more in generated .next/types, excluded — they depend on build state)`)
}

if (removed.length) {
  console.log(`\n  ${removed.length} baseline diagnostic(s) no longer appear. Good.`)
  for (const r of removed.slice(0, 5)) console.log(`    − ${r.id.slice(0, 120)}`)
  if (removed.length > 5) console.log(`    … and ${removed.length - 5} more`)
  console.log('  Bank it when you mean to: node scripts/typecheck-baseline.mjs --update')
}

if (added.length) {
  console.error(`\n✗ ${added.reduce((a, b) => a + b.n, 0)} NEW type error(s), not in the baseline:\n`)
  for (const a of added) {
    console.error(`  ${a.n > 1 ? `${a.n}× ` : ''}${a.id}`)
  }
  console.error('\nA fixed error does not pay for a new one — this compares identities, not totals.')
  console.error('If a new diagnostic is genuinely accepted debt, rebaseline deliberately:')
  console.error('  node scripts/typecheck-baseline.mjs --update\n')
  process.exit(1)
}

console.log('\n✓ No new type errors.\n')
