// Hooks below an early return.
//
//   npm run test:hook-order
//
// WHY THIS EXISTS
//
// app/dashboard/practice/page.tsx had a useEffect underneath its
// `if (loading) return <div>Loading…</div>`. The first render takes the early
// return and never reaches the hook; the second render does; React then throws
// "Rendered more hooks than during the previous render" and unmounts the tree.
// The practice builder — the thing the whole product is for — rendered nothing
// at all from 2026-09-16 until a browser run caught it four days later.
//
// Nothing caught it in between, and nothing could have: the repo's suites are
// all pure-function tests, `next build` compiles the file happily because it is
// valid TypeScript, and eslint is not configured. The rule that would have
// caught it (react-hooks/rules-of-hooks) is exactly the rule nobody was
// running.
//
// So this is a deliberately dumb scanner rather than a parser. It walks each
// component-looking function, notes the line of the first top-level `return`,
// and complains about any top-level hook call after it. Indentation is the
// proxy for "top level of this function", which is reliable here because the
// repo is uniformly two-space indented — and a scanner that runs beats a
// correct one that needs a dependency this environment cannot install.

import { readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const ROOT = join(__dirname, '..')

let passed = 0
const failures: string[] = []

const files = execSync(
  `find app components -name '*.tsx' -not -path '*/node_modules/*'`,
  { cwd: ROOT, encoding: 'utf8' }
).trim().split('\n').filter(Boolean)

// `use` followed by an upper-case letter, called at the start of a statement.
const HOOK = /(?:^|[\s=({[,])(use[A-Z]\w*)\s*\(/
// A function component: `function Name(` or `const Name = (` at column 0.
const COMPONENT = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(|^(?:export\s+)?const\s+([A-Z]\w*)\s*[:=].*(?:=>|function)/
const TOP_LEVEL_RETURN = /^  return[\s(<]/
const TOP_LEVEL_IF_RETURN = /^  if\s*\(.*\)\s*(?:\{|return)/

for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  const lines = src.split('\n')

  let inComponent: string | null = null
  let firstReturn = -1
  let depthGuess = 0

  const flush = () => { inComponent = null; firstReturn = -1 }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (COMPONENT.test(line)) {
      flush()
      const m = COMPONENT.exec(line)!
      inComponent = m[1] || m[2]
      depthGuess = 0
      continue
    }
    if (!inComponent) continue

    // A line at column 0 that closes the function ends the component.
    if (/^\}/.test(line)) { flush(); continue }

    // Remember where this component first returns at its own top level.
    if (firstReturn === -1) {
      if (TOP_LEVEL_RETURN.test(line)) { firstReturn = i; continue }
      // `if (x) return ...` or an if-block whose body returns.
      if (TOP_LEVEL_IF_RETURN.test(line)) {
        if (/return/.test(line)) { firstReturn = i; continue }
        // Look at the next two lines for a return inside the block.
        const body = (lines[i + 1] || '') + (lines[i + 2] || '')
        if (/^\s{4}return/.test(lines[i + 1] || '') || /^\s{4}return/.test(body)) {
          firstReturn = i
        }
      }
      continue
    }

    // Past the first return. Only top-level statements matter — a hook inside
    // a nested arrow function is somebody else's component.
    if (!/^  (?:const|let|var|use[A-Z]|React\.use)/.test(line)) continue
    const m = HOOK.exec(line)
    if (!m) continue
    // useRef/useState in a destructure after a return can still be real, but
    // every hook is equally illegal here, so no exceptions.
    failures.push(
      `${rel}:${i + 1}  ${m[1]}() is below the early return on line ${firstReturn + 1}` +
      `\n      in <${inComponent}>  —  ${line.trim().slice(0, 80)}`)
  }
  passed++
}

console.log(`\nscanned ${passed} component files, ${failures.length} problem(s)`)
if (failures.length) {
  console.log('\nA hook after an early return crashes the component on its second render:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
No hook sits below an early return. Not checked here: hooks inside conditionals
or loops, which this scanner cannot see.
`)
