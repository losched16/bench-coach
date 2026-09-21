// The pitch counter's four states, and the one thing it must never claim.
//
//   npm run test:pitch-count
//
// The brief asks for no-rule, selected-rule, warning and over-limit to be
// tested. They are display states computed from two numbers, so they are
// tested here exhaustively rather than by driving a browser through a real
// count — which would prove the same arithmetic through four network round
// trips and a fixture of the pitch-count API.
//
// What the browser suite covers instead is the part a unit test cannot see:
// that the help card is on the start screen and NOT on the counting screen.
//
// THE POINT OF ALL OF IT: BenchCoach shows a pitcher's total against a rule
// set the coach optionally picked. It does not enforce a limit, it does not
// know the league's rules unless told, and it never stops a count. A coach who
// believes otherwise has been misled about a child's arm.

import { pitchWarning, countingAllowed, WARN_WITHIN, PitchRule } from '../lib/pitchCount'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

const LL10U: PitchRule = { sanctioning_body: 'Little League', age_group: '10U', daily_max: 75 }
const NO_MAX: PitchRule = { sanctioning_body: 'House', age_group: '8U', daily_max: null }

// ── 1. NO RULE SET ──────────────────────────────────────────────────────────
//
// The state a coach reaches by leaving the dropdown on "Just count, no rules".
// A silent screen here means "nothing to compare against", NOT "under the
// limit", and that is the distinction the guide exists to make.

eq('with no rule set there is no level', pitchWarning(0, null).level, 'none')
eq('and nothing is said', pitchWarning(0, null).message, null)
eq('not at 40 either', pitchWarning(40, null).message, null)
eq('NOR AT 200 — silence is not approval', pitchWarning(200, null).message, null)
eq('and the count is never emphasised', pitchWarning(200, null).emphasis, false)
eq('a rule set with no daily max behaves the same',
  pitchWarning(200, NO_MAX).message, null)
eq('undefined is treated as absent, not as a crash',
  pitchWarning(50, undefined).level, 'none')

// ── 2. A RULE SET, COMFORTABLY UNDER ────────────────────────────────────────

eq('at zero, nothing', pitchWarning(0, LL10U).level, 'none')
eq('at 40 of 75, still nothing', pitchWarning(40, LL10U).level, 'none')
eq('at 64 — one below the warning band — still nothing',
  pitchWarning(64, LL10U).level, 'none')

// ── 3. THE WARNING BAND ─────────────────────────────────────────────────────

eq(`the band opens exactly ${WARN_WITHIN} out`, pitchWarning(65, LL10U).level, 'near')
eq('and it counts down in pitches, not percentages',
  pitchWarning(65, LL10U).message, '10 pitches to the daily max.')
eq('at 74 it says one', pitchWarning(74, LL10U).message, '1 pitches to the daily max.')
eq('the near state is not emphasised — amber, not red',
  pitchWarning(70, LL10U).emphasis, false)

// ── 4. AT AND OVER THE LIMIT ────────────────────────────────────────────────

eq('AT the max is already over, not near', pitchWarning(75, LL10U).level, 'over')
eq('it names the rule set, so a coach can check it against their league',
  pitchWarning(75, LL10U).message,
  "Daily max for Little League 10U is 75. He's at 75.")
eq('past it, the real total is shown rather than the max',
  pitchWarning(96, LL10U).message,
  "Daily max for Little League 10U is 75. He's at 96.")
eq('and the count goes red', pitchWarning(96, LL10U).emphasis, true)

// ── the whole point ─────────────────────────────────────────────────────────

eq('COUNTING IS ALLOWED AT ZERO', countingAllowed(), true)
eq('COUNTING IS ALLOWED IN THE WARNING BAND', countingAllowed(), true)
eq('COUNTING IS ALLOWED PAST THE DAILY MAX', countingAllowed(), true)
check('nothing this module returns can disable a control',
  !Object.keys(pitchWarning(200, LL10U)).includes('disabled'))
check('and no message is phrased as an instruction to stop',
  !/\b(stop|must not|do not (let|allow)|remove him|take him out)\b/i
    .test([pitchWarning(75, LL10U).message, pitchWarning(96, LL10U).message,
           pitchWarning(70, LL10U).message].join(' ')))

// ── boundaries, because off-by-one here is a real pitcher ───────────────────

const LL12U: PitchRule = { sanctioning_body: 'Little League', age_group: '12U', daily_max: 85 }
eq('75 of 85 is the first warning', pitchWarning(75, LL12U).level, 'near')
eq('74 of 85 is not', pitchWarning(74, LL12U).level, 'none')
eq('84 of 85 warns', pitchWarning(84, LL12U).level, 'near')
eq('85 of 85 is over', pitchWarning(85, LL12U).level, 'over')

// A tiny limit, where the warning band would run below zero.
const TINY: PitchRule = { sanctioning_body: 'Rec', age_group: '6U', daily_max: 5 }
eq('a max below the warning band warns from the first pitch',
  pitchWarning(0, TINY).level, 'near')
eq('and still goes over at the max', pitchWarning(5, TINY).level, 'over')
check('a negative countdown is never shown',
  !/-\d/.test(pitchWarning(0, TINY).message || ''))

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
Checked here: what the screen says. Not checked here: whether a coach acts on
it, which is the part BenchCoach has no say in and should not pretend to.
`)
