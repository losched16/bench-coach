// Getting text and JSON out of a Claude response, including when there is none.
//
// Two production failures live behind these assertions.
//
// The first was silent: every call read `response.content[0].text`, which stopped
// being the answer when Sonnet 5 started thinking by default. content[0] became
// an empty thinking block, chat saved blank messages, and nothing threw.
//
// The second was loud but misdiagnosed. The practice-plan skeleton ran at
// max_tokens 4000 with effort 'medium' — thinking and the JSON out of one
// budget — so the budget could be spent before the object started. The coach
// was told "The plan outline came back unreadable. Try again", which is advice
// for a different problem: retrying could not fix a request that never fit.
//
//   npm run test:claude-text

import { textFrom, requireText, requireJson } from '@/lib/claudeText'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
function throwsWith(fn: () => any, needle: string): boolean {
  try { fn(); return false } catch (e: any) { return String(e.message).includes(needle) }
}

// The shape that broke chat: thinking first, answer second.
const THINKING_FIRST = {
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'the real answer' },
  ],
  stop_reason: 'end_turn',
}

// ── textFrom ────────────────────────────────────────────────────────────────

check('the answer is found behind a thinking block',
  textFrom(THINKING_FIRST) === 'the real answer',
  'content[0] is the thinking block on Sonnet 5 and Opus 5')
check('several text blocks are joined',
  textFrom({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }) === 'a\nb')
check('thinking alone is no text at all',
  textFrom({ content: [{ type: 'thinking', thinking: '' }] }) === '')
check('a malformed response does not throw', textFrom({} as any) === '')

// ── requireText ─────────────────────────────────────────────────────────────

check('text passes through', requireText(THINKING_FIRST, 'x') === 'the real answer')
check('no text is an error, not an empty string',
  throwsWith(() => requireText({ content: [{ type: 'thinking', thinking: '' }] }, 'chat reply'), 'chat reply'))
check('...and the error names the budget when that was the cause',
  throwsWith(
    () => requireText({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }, 'chat reply'),
    'raise max_tokens'),
  'the fix is a number in the request, not a retry')

// ── requireJson ─────────────────────────────────────────────────────────────

const ok = { content: [{ type: 'text', text: '{"title":"Tuesday","blocks":[]}' }], stop_reason: 'end_turn' }
check('an object is parsed', requireJson(ok).title === 'Tuesday')
check('prose around the object is ignored',
  requireJson({ content: [{ type: 'text', text: 'Here you go:\n{"a":1}\nHope that helps.' }] }).a === 1)

// The three failures that used to produce one identical sentence.
//
// 1. Budget gone before any text. Retrying cannot fix it.
check('cut off before any text says so',
  throwsWith(
    () => requireJson({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }, 'plan outline'),
    'raise max_tokens'))

// 2. Budget gone MID-OBJECT. The sneaky one: a half-written object still has a
//    closing brace from a nested value, so the regex matches and JSON.parse is
//    what fails — with no hint that the budget was the cause.
const TRUNCATED = {
  content: [{ type: 'text', text: '{"title":"Tuesday","blocks":[{"title":"Tee Work","minutes":10}' }],
  stop_reason: 'max_tokens',
}
check('a half-written object still matches the brace regex',
  /\{[\s\S]*\}/.test(TRUNCATED.content[0].text),
  'which is why stop_reason has to be checked before trusting a parse failure')
check('...and is reported as truncation, not as bad JSON',
  throwsWith(() => requireJson(TRUNCATED, 'plan outline'), 'cut off mid-object'))

// 3. Genuinely not JSON. This is the only one where trying again is sensible.
check('no JSON at all is reported as no JSON',
  throwsWith(
    () => requireJson({ content: [{ type: 'text', text: 'I cannot help with that.' }], stop_reason: 'end_turn' }, 'plan outline'),
    'without any JSON'))
check('unparseable JSON that was not truncated says what the parser said',
  throwsWith(
    () => requireJson({ content: [{ type: 'text', text: '{"a": }' }], stop_reason: 'end_turn' }, 'plan outline'),
    'would not parse'))

// The three messages must be distinguishable — that is the whole point.
const messages = new Set<string>()
for (const r of [
  { content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' },
  TRUNCATED,
  { content: [{ type: 'text', text: 'nope' }], stop_reason: 'end_turn' },
]) {
  try { requireJson(r, 'plan outline') } catch (e: any) { messages.add(e.message) }
}
check('three different causes give three different messages', messages.size === 3,
  `got ${messages.size}: ${Array.from(messages).join(' / ')}`)

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
