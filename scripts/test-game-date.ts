// Does the date on a scouting entry survive contact with a screenshot?
//
// The failure: a coach typed July 14 2026, the parser read 2024 off a box score
// that printed "Jul 14" with no year, and the typed date was silently
// overwritten. The form no longer touches the date at all — what the coach
// selects is what saves — so these guard the parsed copy that still gets kept
// in the raw parse record, where an impossible year is still worth refusing.
//
//   npm run test:game-date

import {
  todayISO, parseISODate, daysBetween, checkGameDate,
} from '@/lib/gameDate'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

const TODAY = '2026-08-11'

// ── parsing ─────────────────────────────────────────────────────────────────

check('a real date parses', parseISODate('2026-07-14')?.y === 2026)
check('a non-date is null', parseISODate('July 14') === null)
check('a partial date is null', parseISODate('2026-07') === null)
check('empty is null', parseISODate('') === null)
check('null is null', parseISODate(null) === null)
check('month 13 is rejected', parseISODate('2026-13-01') === null)
check('31 February is rejected', parseISODate('2026-02-31') === null,
  'a date that does not exist is a parse error in disguise')
check('29 February on a leap year is fine', parseISODate('2024-02-29') !== null)
check('29 February on a common year is rejected', parseISODate('2026-02-29') === null)

check('days between counts forward', daysBetween('2026-08-01', '2026-08-11') === 10)
check('days between counts backward', daysBetween('2026-08-11', '2026-08-01') === -10)
check('days between spans a year', daysBetween('2025-08-11', '2026-08-11') === 365)
check('days between rejects junk', daysBetween('nope', '2026-08-11') === null)

check('todayISO is zero padded', /^\d{4}-\d{2}-\d{2}$/.test(todayISO(new Date(2026, 0, 5))))
check('todayISO uses local month numbering', todayISO(new Date(2026, 0, 5)) === '2026-01-05')

// ── the check ───────────────────────────────────────────────────────────────

check('a recent date is accepted', checkGameDate('2026-07-14', TODAY).verdict === 'ok')
check('...and is returned', checkGameDate('2026-07-14', TODAY).date === '2026-07-14')
check('today itself is fine', checkGameDate(TODAY, TODAY).verdict === 'ok')
check('a date last season is still fine', checkGameDate('2025-05-02', TODAY).verdict === 'ok')

// THE BUG: the model wrote 2024 for a game the coach dated 2026.
const stale = checkGameDate('2024-07-14', TODAY)
check('a date three years back is still allowed', stale.verdict === 'ok',
  'the cut-off is generous on purpose — this one is caught by the coach winning, not by the check')
const ancient = checkGameDate('2019-07-14', TODAY)
check('a date many years back is refused', ancient.verdict === 'ancient')
check('...and yields no date at all', ancient.date === null,
  'a date we do not trust is not a date')
check('...and explains itself to the coach', /years old/.test(ancient.note || ''), ancient.note || '')

const future = checkGameDate('2026-09-01', TODAY)
check('a future date is refused', future.verdict === 'future')
check('...and yields no date', future.date === null)
check('...and says so', /future/.test(future.note || ''))
check('a day of timezone slack is tolerated', checkGameDate('2026-08-12', TODAY).verdict === 'ok')

check('an unreadable date is not an error', checkGameDate('sometime in July', TODAY).verdict === 'unreadable')
check('...and produces no coach-facing noise', checkGameDate(null, TODAY).note === null)

// The coach's own date is not reconciled against anything — the capture form
// never reads a date out of an image. These only guard the parsed copy kept in
// the raw parse record.

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
