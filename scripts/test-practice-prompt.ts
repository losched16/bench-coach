// Reading a practice out of the way a coach describes it.
//
// The generator always took free text; the numbers beside it did not. A coach
// who had already written what they wanted still had to translate their own
// sentence into a duration, three checkboxes and a coach count before the app
// would read the sentence.
//
// The prompt below is a real one, sent verbatim. Everything else here exists
// to stop this from guessing: a wrong duration produces a plan for a session
// that was never described, and the coach finds out at the field.
//
//   npm run test:practice-prompt

import {
  practiceInputsFromPrompt, durationFromPrompt, coachCountFromPrompt,
  playerCountFromPrompt, focusAreasFromPrompt, isUsablePracticePrompt,
  practiceFocusFromPrompt,
} from '@/lib/practicePrompt'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (label: string, actual: any, expected: any) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

// ── the real one ────────────────────────────────────────────────────────────

const REAL = `i want to use this as a starting point prompt for a team practice plan

I am trying to develop a practice plan for 9u travel team. These kids are good players, and we want to work on drills to improve fundamentals. Can you create a practice plan for 4 coaches, 2 hours. Starting with throwing progressions, then I want hitting stations to help with prop load fundamentals.

Then I want stations for proper ground ball fundamentals as well. We are taking this time to do drills to improve skills.`

const real = practiceInputsFromPrompt(REAL)
eq('"2 hours" is 120 minutes', real.duration, 120)
eq('"4 coaches" is four adults', real.coachCount, 4)
eq('the areas come back in the order he named them', real.focus, ['throwing', 'hitting', 'fielding'])
check('no player count was stated, so none is invented', real.playerCount === null)

// The trap in that exact sentence: "9u" sitting next to a duration.
eq('"9u" is not read as a duration', durationFromPrompt('practice plan for 9u travel team'), null)
eq('...even beside a real one', durationFromPrompt('9u team, 2 hours'), 120)

// ── duration ────────────────────────────────────────────────────────────────

eq('90 minutes', durationFromPrompt('a 90 minute practice'), 90)
eq('90 min', durationFromPrompt('90 min practice'), 90)
eq('2 hours', durationFromPrompt('2 hours on the field'), 120)
eq('two hours, spelled', durationFromPrompt('two hours on the field'), 120)
eq('1.5 hours', durationFromPrompt('1.5 hours'), 90)
eq('an hour and a half', durationFromPrompt('we have an hour and a half'), 90)
eq('an hour', durationFromPrompt('we only have an hour'), 60)
eq('nothing said', durationFromPrompt('work on ground balls'), null)
eq('empty', durationFromPrompt(''), null)
// Guards against nonsense rather than passing it to the scheduler.
eq('a 10-hour practice is not a practice', durationFromPrompt('10 hours'), null)
eq('five minutes is not a practice', durationFromPrompt('5 minutes'), null)

// ── coaches ─────────────────────────────────────────────────────────────────

eq('4 coaches', coachCountFromPrompt('for 4 coaches'), 4)
eq('four coaches, spelled', coachCountFromPrompt('four coaches and twelve kids'), 4)
eq('3 adults', coachCountFromPrompt('3 adults there'), 3)
eq('"just me" is one', coachCountFromPrompt('it is just me on Tuesday'), 1)
eq('"by myself" is one', coachCountFromPrompt('running it by myself'), 1)
eq('nothing said', coachCountFromPrompt('we want ground balls'), null)
// The route discards anything outside 1-6; matching that beats sending a
// number that is silently thrown away.
eq('twelve coaches is not a real answer', coachCountFromPrompt('12 coaches'), null)

// ── players ─────────────────────────────────────────────────────────────────

eq('12 players', playerCountFromPrompt('12 players'), 12)
eq('10 kids', playerCountFromPrompt('about 10 kids'), 10)
eq('nothing said', playerCountFromPrompt('hitting stations'), null)

// ── focus areas ─────────────────────────────────────────────────────────────

eq('throwing progressions', focusAreasFromPrompt('throwing progressions'), ['throwing'])
eq('ground balls are fielding', focusAreasFromPrompt('ground ball fundamentals'), ['fielding'])
eq('tee work is hitting', focusAreasFromPrompt('tee work and front toss'), ['hitting'])
eq('catchers', focusAreasFromPrompt('blocking for the catchers'), ['catching'])
eq('nothing named', focusAreasFromPrompt('a good practice'), [])

// Order, which is the whole reason this returns a list rather than a set.
eq('order follows the sentence',
  focusAreasFromPrompt('start with hitting, then ground balls, then baserunning'),
  ['hitting', 'fielding', 'baserunning'])
eq('...and reverses when the sentence does',
  focusAreasFromPrompt('start with baserunning, then ground balls, then hitting'),
  ['baserunning', 'fielding', 'hitting'])
eq('an area named twice appears once',
  focusAreasFromPrompt('hitting stations, more hitting, tee work'), ['hitting'])

// ── the practice form's own vocabulary ──────────────────────────────────────
//
// That form splits fielding into infield and outfield, has no pitching or
// athleticism, and adds game IQ. The split has to come from the text: "ground
// balls" is the dirt and "fly balls" is the grass, and a plan for the wrong
// one is a wasted practice.

eq('the real prompt, as the form says it',
  practiceFocusFromPrompt(REAL), ['throwing', 'hitting', 'infield'])
eq('ground balls are infield', practiceFocusFromPrompt('ground balls'), ['infield'])
eq('fly balls are outfield', practiceFocusFromPrompt('fly balls and shagging'), ['outfield'])
eq('both, when both are named',
  practiceFocusFromPrompt('ground balls then fly balls'), ['infield', 'outfield'])
eq('unsplit defence goes to infield',
  practiceFocusFromPrompt('work on defense'), ['infield'])
eq('pitching maps to throwing, the honest neighbour',
  practiceFocusFromPrompt('bullpen work'), ['throwing'])
eq('athleticism has no equivalent and is dropped, not approximated',
  practiceFocusFromPrompt('agility and conditioning'), [])
// I first asserted ['infield', 'game IQ'] here and the code was right to
// disagree. A cutoff involves the outfielder who threw it as much as the
// infielder who takes it, so "infield" is an invention — exactly the silent
// substitution this function refuses everywhere else. Game IQ alone is what
// the coach actually named.
eq('cutoffs and relays are game IQ, and nothing is invented alongside it',
  practiceFocusFromPrompt('cutoffs and relays'), ['game IQ'])
eq('...but a named position group still counts',
  practiceFocusFromPrompt('infield cutoffs and relays'), ['infield', 'game IQ'])

// ── is it worth generating from ─────────────────────────────────────────────

check('the real prompt is usable', isUsablePracticePrompt(REAL))
check('a duration alone is enough to start', isUsablePracticePrompt('give me a 90 minute practice'))
check('an area alone is enough to start', isUsablePracticePrompt('I want to work on ground ball fundamentals'))
check('a greeting is not a practice', !isUsablePracticePrompt('hey'))
check('empty is not a practice', !isUsablePracticePrompt(''))
check('prose naming nothing is not enough',
  !isUsablePracticePrompt('the kids were a bit flat on Saturday and I want to fix that'),
  'no area, no duration — there is nothing to build from')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
