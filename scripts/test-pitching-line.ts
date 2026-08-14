// Does a pitcher's line add up?
//
// Two silent failures live here.
//
// INNINGS PITCHED IS NOT A DECIMAL. 2.1 means two and one third. Summing
// outings as decimals gives 2.1 + 1.2 = 3.3 when the answer is 4.0, and the
// number stays plausible the whole way — it is just wrong, and it drifts
// further with every outing added.
//
// OUTINGS LOGGED BEFORE MIGRATION 042 HAVE NO pitching_line. If those are
// skipped, a pitcher's innings total shrinks the day the feature ships, which
// looks exactly like data loss.
//
//   npm run test:pitching-line

import {
  aggregatePitchingLines, inningsToOuts, outsToInnings,
} from '@/lib/scouting'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

// ── the thirds ──────────────────────────────────────────────────────────────

check('whole innings convert', inningsToOuts(3) === 9)
check('one third converts', inningsToOuts(2.1) === 7)
check('two thirds converts', inningsToOuts(2.2) === 8)
check('zero is zero', inningsToOuts(0) === 0)
check('junk is zero', inningsToOuts(NaN) === 0)
check('a float artefact still reads as one third', inningsToOuts(2.0999999999) === 7,
  'JSON round-trips produce these and they must not silently lose an out')
check('a bogus third is clamped', inningsToOuts(2.7) === 8,
  'there is no such thing as .7 of an inning')

check('outs back to innings', outsToInnings(7) === 2.1)
check('a whole inning has no fraction', outsToInnings(9) === 3)
check('two thirds round-trips', outsToInnings(8) === 2.2)
check('the round trip is stable', outsToInnings(inningsToOuts(4.2)) === 4.2)

// ── the aggregate ───────────────────────────────────────────────────────────

const app = (ip: number, extra: any = {}) => ({
  pitches_thrown: 40,
  pitching_line: { ip, h: 2, r: 1, er: 1, bb: 3, k: 4, ...extra },
})

// THE BUG: decimal addition would give 3.3 here.
const two = aggregatePitchingLines([app(2.1), app(1.2)])
check('innings add in thirds, not as decimals', two.ip === 4, `got ${two.ip}`)
check('outings are counted', two.outings === 2)
check('walks issued accumulate', two.bb === 6)
check('strikeouts thrown accumulate', two.k === 8)
check('earned runs accumulate', two.er === 2)
check('pitch counts accumulate', two.pitches === 80)

const third = aggregatePitchingLines([app(2.1), app(2.1), app(2.1)])
check('three one-third outings make seven innings', third.ip === 7, `got ${third.ip}`)

// ── rows from before the migration ──────────────────────────────────────────

const legacy = aggregatePitchingLines([
  { pitches_thrown: 55, innings_pitched: 3, pitching_line: null },
  app(2.1),
])
check('an outing with no line still counts', legacy.outings === 2)
check('...and its innings are not lost', legacy.ip === 5.1, `got ${legacy.ip}`)
check('...and its pitches are not lost', legacy.pitches === 95)
check('...while the stats it never had stay zero', legacy.h === 2)

// ── who counts as a pitcher ─────────────────────────────────────────────────

const mixed = aggregatePitchingLines([
  { pitches_thrown: 0, batting_line: { ab: 3, h: 1 } } as any,
  { pitches_thrown: null, innings_pitched: null } as any,
  app(1),
])
check('position players are not counted as outings', mixed.outings === 1, `got ${mixed.outings}`)
check('an empty list is all zeros', aggregatePitchingLines([]).outings === 0)
check('...and does not produce NaN', aggregatePitchingLines([]).ip === 0)

// A source that spells things out rather than abbreviating.
const verbose = aggregatePitchingLines([
  { pitches_thrown: 30, pitching_line: { innings: 2, hits: 1, walks: 2, strikeouts: 3, earned_runs: 0 } },
])
check('long-form stat keys are understood', verbose.k === 3 && verbose.bb === 2 && verbose.h === 1)
check('...including innings', verbose.ip === 2)

// ── strikes, from the Pitches-Strikes footer ────────────────────────────────
// GameChanger prints "Pitches-Strikes: Gio C 53-40" in a notes block UNDER the
// box score, not in the pitching table. 53 pitches, 40 of them strikes.

const gio = aggregatePitchingLines([
  { pitches_thrown: 53, pitching_line: { ip: 3, h: 9, r: 7, er: 4, bb: 1, k: 1, strikes: 40, bf: 20 } },
])
check('strikes are kept', gio.strikes === 40)
check('strike percentage is computed', gio.strikePct === 75, `got ${gio.strikePct}`)
check('batters faced are kept', gio.bf === 20)

const austin = aggregatePitchingLines([
  { pitches_thrown: 37, pitching_line: { ip: 1.1, h: 4, r: 5, er: 5, bb: 1, k: 1, strikes: 21, hbp: 3 } },
])
check('a wilder outing scores lower', austin.strikePct === 57, `got ${austin.strikePct}`)

const bothOutings = aggregatePitchingLines([
  { pitches_thrown: 53, pitching_line: { ip: 3, strikes: 40 } },
  { pitches_thrown: 34, pitching_line: { ip: 1, strikes: 18 } },
])
check('pitches add across outings', bothOutings.pitches === 87)
check('strikes add across outings', bothOutings.strikes === 58)
check('the percentage is over the total, not an average of percentages',
  bothOutings.strikePct === 67, `got ${bothOutings.strikePct}`)

check('no strike data means null, not zero',
  aggregatePitchingLines([{ pitches_thrown: 40, innings_pitched: 2 }]).strikePct === null,
  '0% would read as "throws nothing but balls" rather than "not captured"')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
