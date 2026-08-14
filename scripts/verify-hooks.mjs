#!/usr/bin/env node
// Hooks must not sit after an early return.
//
// This exists because of a white screen. Two useState calls were added next to
// the function that used them, which happened to be BELOW `if (loading) return
// (...)`. The first render bailed out having called nine hooks; the second ran
// eleven; React threw "rendered more hooks than during the previous render"
// and the whole team page died with "a client-side exception has occurred".
//
// eslint's react-hooks/rules-of-hooks catches this in a second. It never ran,
// because next.config.js sets eslint.ignoreDuringBuilds — so the build was
// green, the types were clean, and the page was broken. Turning eslint on
// across this codebase is a separate and much larger job; this is the one rule
// whose violation takes a page down rather than making it untidy.
//
// The check: inside a component body, find the first `return` at the top level
// of the function, then flag any hook call that appears after it at that same
// level. Nested returns (inside a map, an if-block, a callback) are ignored,
// which is what makes this quiet enough to be worth running.

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['app', 'components']
const HOOK = /(?:^|[^.\w])(use[A-Z]\w*)\s*\(/
const COMPONENT_START = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(/

const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (full.endsWith('.tsx')) files.push(full)
  }
}
for (const r of ROOTS) { try { walk(r) } catch {} }

const problems = []

// Indentation rather than brace counting. A component signature in this
// codebase spans several lines of destructured props with braces of their own
// ({ a, b }: { a: string }), so counting braces from the `function` keyword
// puts the body at an unpredictable depth — the first version of this check
// did exactly that and silently passed on the bug it was written for.
//
// Every component here is declared at column 0 and closed by a `}` at column
// 0, and everything directly in its body is indented two spaces. That holds
// throughout, and it is unambiguous.
// A lone closing brace at column 0. NOT `}: {` or `}) {`, which are how a
// multi-line props type closes — reading those as the end of the component was
// why the first two versions of this check passed on a live bug.
const COMPONENT_END = /^\}\s*$/
const TOP_LEVEL_HOOK = /^ {2}(?:const|let|var)?\s*.*?(?:^|[^.\w])(use[A-Z]\w*)\s*\(/
// A return at the component's own indent always exits it.
const BARE_RETURN = /^ {2}return[\s(;]/
// One level in only counts when the enclosing block is a top-level if/else.
// The same indentation inside `const x = useMemo(() => {` is a return from the
// callback, not from the component — the first version of this check flagged
// three of those in PlayerMetrics and was wrong every time.
const NESTED_RETURN = /^ {4}return[\s(;]/
const TOP_LEVEL_BRANCH = /^ {2}(?:\} *)?(?:if|else)\b/
const BLOCK_CLOSE = /^ {2}\}/
// useEffect cleanups are returns too, and they exit the callback rather than
// the component.
const CLEANUP = /^\s*return\s*(?:\(\s*\)|function)\s*(?:=>|\()/

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')

  let inComponent = null
  let firstReturnLine = null
  let inBranch = false

  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '')

    if (!inComponent) {
      const m = COMPONENT_START.exec(code)
      if (m) { inComponent = m[1]; firstReturnLine = null; inBranch = false }
      continue
    }

    if (COMPONENT_END.test(code)) {
      inComponent = null; firstReturnLine = null; inBranch = false
      continue
    }

    // Track whether we are inside an if/else attached to the component body.
    if (TOP_LEVEL_BRANCH.test(code)) inBranch = true
    else if (BLOCK_CLOSE.test(code)) inBranch = false

    if (firstReturnLine === null && !CLEANUP.test(code)) {
      if (BARE_RETURN.test(code) || (inBranch && NESTED_RETURN.test(code))) {
        firstReturnLine = i + 1
        continue
      }
    }

    const h = TOP_LEVEL_HOOK.exec(code)
    if (h && firstReturnLine !== null) {
      problems.push(
        `${file}:${i + 1}  ${h[1]}() is called after the return on line ` +
        `${firstReturnLine} of <${inComponent}>. A render that takes that early ` +
        `return calls fewer hooks than one that does not, and React throws. ` +
        `Move it up with the other hooks.`
      )
    }
  }
}

if (problems.length) {
  console.error('\nHooks after an early return:\n')
  problems.forEach(p => console.error('  ' + p))
  console.error(
    `\n${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
    `Every hook must run on every render, so they all belong above the first ` +
    `return.\n`
  )
  process.exit(1)
}

console.log(
  `Checked ${files.length} components — no hook is called after an early return.`
)
