// Machine content never reaches a coach's screen.
//
// The chat prompt asks for prose and then a JSON block introduced by
// MEMORY_SUGGESTIONS:. The block is for the app. A coach reported seeing it at
// the bottom of their chat, raw, braces and confidence scores and all.
//
// Two compounding defects produced that, and the payload below is theirs:
//
//   1. The extraction regex `\{[\s\S]*?\}` is non-greedy, so it stopped at the
//      first closing brace — the one ending the first entry INSIDE the first
//      array. The captured fragment ended mid-array and would not parse.
//   2. The strip lived inside the try, AFTER the parse. So a parse failure left
//      the whole block in the message.
//
// The block only closes on its first brace when every array is empty, so this
// leaked exactly when the model had something to suggest. The feature worked
// only while it had nothing to say.
//
//   npm run test:memory-split

import { splitMemorySuggestions } from '@/lib/analysis'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// Reported verbatim.
const REPORTED = `Here's how I'd shape that practice.

MEMORY_SUGGESTIONS:
{
 "coach_preferences": [
 {"key": "current_practice_plan_focus", "value": "team hitting load progression as spine of 120-min practices, rotating with infield/outfield/baserunning", "confidence": 0.8}
 ],
 "team_issues": [
 {"title": "Baserunning discipline", "detail": "April 13 game note: too much throwing the ball around between catcher/pitcher and on the bases — worth reinforcing 'read the throw' cues during baserunning work", "confidence": 0.7}
 ],
 "player_notes": []
}`

const reported = splitMemorySuggestions(REPORTED)

check('the coach sees only the prose', reported.message === "Here's how I'd shape that practice.",
  JSON.stringify(reported.message))
check('no marker survives', !reported.message.includes('MEMORY_SUGGESTIONS'))
check('no braces survive', !reported.message.includes('{'))
check('no confidence score survives', !reported.message.includes('confidence'))

// The nesting that broke the old regex.
check('the whole nested object is captured, not the first inner one',
  !!reported.suggestions?.coach_preferences && !!reported.suggestions?.team_issues,
  JSON.stringify(reported.suggestions))
check('...with the preference intact',
  reported.suggestions.coach_preferences[0].key === 'current_practice_plan_focus')
check('...and the team issue',
  reported.suggestions.team_issues[0].title === 'Baserunning discipline')
check('...and an empty array stays an empty array',
  Array.isArray(reported.suggestions.player_notes) && reported.suggestions.player_notes.length === 0)

// ── stripping does not depend on parsing ────────────────────────────────────
//
// This is the rule the old code got backwards. Losing a suggestion costs the
// app a guess; showing one to a coach costs their trust in everything else on
// the screen. So the strip is unconditional and the parse is best-effort.

const TRUNCATED = `Good question.

MEMORY_SUGGESTIONS:
{
 "coach_preferences": [
 {"key": "x", "value": "cut off mid`
const truncated = splitMemorySuggestions(TRUNCATED)
check('an unclosed block is still stripped', truncated.message === 'Good question.',
  JSON.stringify(truncated.message))
check('...and yields no suggestions rather than junk', truncated.suggestions === null)

const GARBAGE = `Here you go.

MEMORY_SUGGESTIONS:
{ not json at all }`
const garbage = splitMemorySuggestions(GARBAGE)
check('unparseable JSON is still stripped', garbage.message === 'Here you go.')
check('...and yields nothing', garbage.suggestions === null)

// ── braces inside strings ───────────────────────────────────────────────────
//
// A coach note can contain anything. Counting braces without tracking string
// state would end the object early and drop the rest.

const BRACEY = `Fine.

MEMORY_SUGGESTIONS:
{
 "team_issues": [{"title": "Signs", "detail": "he yells {bunt} from the box", "confidence": 0.7}],
 "player_notes": []
}`
const bracey = splitMemorySuggestions(BRACEY)
check('a brace inside a string does not end the object',
  bracey.suggestions?.team_issues?.[0]?.detail === 'he yells {bunt} from the box',
  JSON.stringify(bracey.suggestions))
check('...and the message is still clean', bracey.message === 'Fine.')

const ESCAPED = `Sure.

MEMORY_SUGGESTIONS:
{
 "team_issues": [{"title": "Quote", "detail": "he said \\"go\\" on the pitch", "confidence": 0.7}],
 "player_notes": []
}`
const escaped = splitMemorySuggestions(ESCAPED)
check('an escaped quote does not end the string early',
  escaped.suggestions?.team_issues?.[0]?.detail === 'he said "go" on the pitch',
  JSON.stringify(escaped.suggestions))

// ── the ordinary cases ──────────────────────────────────────────────────────

const NONE = 'Just an answer, no block at all.'
const none = splitMemorySuggestions(NONE)
check('a reply without a block is returned as-is', none.message === NONE)
check('...with no suggestions', none.suggestions === null)

// The shape that DID work before, and must keep working.
const EMPTY = `Answer.

MEMORY_SUGGESTIONS:
{"coach_preferences": [], "team_issues": [], "player_notes": []}`
const empty = splitMemorySuggestions(EMPTY)
check('the all-empty block still parses', !!empty.suggestions)
check('...and is still stripped', empty.message === 'Answer.')

check('empty input does not throw', splitMemorySuggestions('').message === '')
check('null input does not throw', splitMemorySuggestions(null).message === '')

// Prose that merely mentions the word is not a marker — the marker starts a
// line. Otherwise an answer explaining the feature would truncate itself.
const MENTIONED = 'I store things under a MEMORY_SUGGESTIONS: heading internally, which you never see.'
check('an inline mention mid-sentence is not treated as the marker',
  splitMemorySuggestions(MENTIONED).message === MENTIONED,
  JSON.stringify(splitMemorySuggestions(MENTIONED).message))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
