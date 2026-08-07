#!/usr/bin/env node
// Guard against the bug that silently killed the chat.
//
// `response.content[0].text` was correct until Sonnet 5 / Opus 5, which run
// thinking by default. Now content[0] is a thinking block with empty text, the
// `.type === 'text'` check quietly fails, and the caller gets '' with no error
// thrown and nothing in the logs. Chat rendered blank bubbles for days.
//
// The fix is lib/claudeText.ts — textFrom() / requireText(). This script fails
// if anyone reintroduces the old pattern, or writes a non-streaming Claude call
// that doesn't route through the helper.
//
//   node scripts/verify-claude-calls.mjs

import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const files = execSync(
  `grep -rl "messages.create\\|content\\[0\\]" --include=*.ts --include=*.tsx app lib`,
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean)

const problems = []

for (const file of files) {
  if (file === 'lib/claudeText.ts') continue        // the helper documents the pattern
  const lines = readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`

    if (/(?:response|res|result|msg|message)\s*\.content\s*\[\s*0\s*\]/.test(line)) {
      problems.push(`${at}  indexes into content[] — use textFrom() from lib/claudeText`)
    }
    // Hand-rolled .find(...) works, but drifts. One helper, one place to fix.
    if (/\.content\s*\.find\s*\(/.test(line)) {
      problems.push(`${at}  hand-rolled text lookup — use textFrom() from lib/claudeText`)
    }
  })

  // Every non-streaming call needs the helper somewhere in the file.
  const src = lines.join('\n')
  if (src.includes('messages.create(') && !src.includes('claudeText')) {
    problems.push(`${file}  calls messages.create() but never imports textFrom/requireText`)
  }
}

if (problems.length) {
  console.error('\nUnsafe Claude response handling:\n')
  problems.forEach(p => console.error('  ' + p))
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}. See lib/claudeText.ts.\n`)
  process.exit(1)
}

console.log(`Checked ${files.length} files — all Claude responses read through lib/claudeText.`)
