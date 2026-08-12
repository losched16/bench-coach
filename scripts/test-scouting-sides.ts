// Does the box-score parser log the team the coach actually asked for?
//
// Two real failures live here. A coach's own players appearing in a tracked
// team's roster, and — the one that matters more — a coach selecting Warrington,
// uploading Warrington vs Springfield, and getting Springfield. Neither throws.
// Both drive pitch-count availability, so the board is confidently wrong.
//
// The rule these enforce: if the coach named a team, that IS the answer, and
// when we cannot find it we ask instead of guessing.
//
//   npm run test:scouting-sides

import {
  chooseTrackedSide, teamNameSimilarity, teamNamesMatch, samePlayer, rosterOverlap,
  normalizeName, ownPlayersIn, ParsedSide,
} from '@/lib/scoutingSides'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

const side = (team_name: string | null, names: string[]): ParsedSide =>
  ({ team_name, players: names.map(n => ({ name: n })) })

const OURS = ['Charlie Losch', 'Jack Miller', 'Owen Ruiz', 'Ben Carter', 'Sam Doyle']

// ── name comparison ─────────────────────────────────────────────────────────

check('normalizes punctuation and case', normalizeName('Rangers 10U — Red!') === 'rangers 10u red')
check('age brackets do not make teams match',
  teamNameSimilarity('Rangers 10U', 'Hawks 10U') === 0,
  String(teamNameSimilarity('Rangers 10U', 'Hawks 10U')))
check('colour suffixes do not make teams match',
  teamNameSimilarity('Rangers Blue', 'Hawks Blue') === 0)
check('the same club with different decoration matches',
  teamNameSimilarity('Springfield Rangers', 'Rangers 10U Red') >= 0.6,
  String(teamNameSimilarity('Springfield Rangers', 'Rangers 10U Red')))
check('unrelated teams do not match', teamNameSimilarity('Rangers', 'Raiders') === 0)
check('an empty name matches nothing', teamNameSimilarity('', 'Rangers') === 0)

check('abbreviated first name matches', samePlayer('T. Smith', 'Tommy Smith'))
check('comma order matches', samePlayer('Smith, T', 'Tommy Smith'))
check('surname only matches a surname', samePlayer('Smith', 'Tommy Smith'))
check('different initials do not match', samePlayer('T. Smith', 'Jack Smith') === false)
check('different surnames do not match', samePlayer('T. Smith', 'T. Jones') === false)
check('blank never matches', samePlayer('', 'Tommy Smith') === false)

// ── the decision ────────────────────────────────────────────────────────────

const theirs = side('Hawks 10U', ['A. Nguyen', 'B. Patel', 'C. Kim', 'D. Rossi'])
const mine = side('Springfield Rangers', OURS)

check('the team the coach selected wins',
  chooseTrackedSide([mine, theirs], { trackedTeamName: 'Hawks' }).tracked === theirs)
check('...and it is confident',
  chooseTrackedSide([mine, theirs], { trackedTeamName: 'Hawks' }).confident)
check('...and it says why',
  /Hawks/.test(chooseTrackedSide([mine, theirs], { trackedTeamName: 'Hawks' }).reason))

check('our own team name excludes that side',
  chooseTrackedSide([mine, theirs], { ourTeamName: 'Springfield Rangers' }).tracked === theirs)
check('...and identifies which side was ours',
  chooseTrackedSide([mine, theirs], { ourTeamName: 'Springfield Rangers' }).ours === mine)

// The case that matters most: team names unreadable or missing, which is very
// common on a cropped screenshot. The roster is the only signal left.
const anonMine = side(null, OURS)
const anonTheirs = side(null, ['A. Nguyen', 'B. Patel', 'C. Kim', 'D. Rossi'])
const byRoster = chooseTrackedSide([anonMine, anonTheirs], { ourRoster: OURS })
check('roster overlap identifies our side with no team names', byRoster.tracked === anonTheirs)
check('...confidently', byRoster.confident)
check('...and explains it in coach language', /roster/.test(byRoster.reason), byRoster.reason)

check('roster overlap works with abbreviated box-score names',
  chooseTrackedSide(
    [side(null, ['C. Losch', 'J. Miller', 'O. Ruiz', 'B. Carter']), anonTheirs],
    { ourRoster: OURS },
  ).tracked === anonTheirs)

// One coincidental surname must not flip the decision.
const coincidence = side('Hawks', ['A. Nguyen', 'B. Patel', 'C. Kim', 'S. Doyle'])
const byCoincidence = chooseTrackedSide([coincidence, mine], { ourRoster: OURS })
check('a single shared surname does not make a team ours',
  byCoincidence.tracked === coincidence, byCoincidence.reason)

// ── refusing to guess ───────────────────────────────────────────────────────

const blind = chooseTrackedSide([anonMine, anonTheirs], {})
check('with no context at all it is NOT confident', !blind.confident)
check('...and refuses to pick rather than guessing', blind.tracked === null)
check('...and says plainly which decision it needs', /which one/.test(blind.reason), blind.reason)

// ── the Warrington case ─────────────────────────────────────────────────────
// The coach selected Warrington and uploaded Warrington vs Springfield. This is
// a scouting upload: neither team is theirs, and their roster is irrelevant.

const warrington = side('Warrington', ['A. Nguyen', 'B. Patel', 'C. Kim'])
const springfield = side('Springfield', ['D. Rossi', 'E. Fox', 'F. Grant'])
const war = chooseTrackedSide([springfield, warrington], { trackedTeamName: 'Warrington' })
check('the selected team is logged, not the other one', war.tracked === warrington, war.reason)
check('...confidently', war.confident)
check('...and no side is marked as ours', war.ours === null)

check('the selected team wins even when listed first',
  chooseTrackedSide([warrington, springfield], { trackedTeamName: 'Warrington' }).tracked === warrington)

// Our own roster must NOT drag the answer away from what the coach selected.
check('the selection outranks our own roster',
  chooseTrackedSide(
    [side('Warrington', OURS), springfield],
    { trackedTeamName: 'Warrington', ourRoster: OURS, ourTeamName: 'Springfield Rangers' },
  ).tracked?.team_name === 'Warrington')

// A scoreboard printing three letters is the normal case, not the exception.
check('an abbreviated scoreboard name still matches', teamNamesMatch('WAR', 'Warrington'))
check('...and drives the choice',
  chooseTrackedSide([springfield, side('WAR', ['A. Nguyen'])], { trackedTeamName: 'Warrington' }).confident)
check('a short name does not match an unrelated club', teamNamesMatch('WAR', 'Springfield') === false)

// Named a team that is on neither side: ask, and name what we did read.
const missing = chooseTrackedSide([springfield, side('Hawks', ['X. One'])], { trackedTeamName: 'Warrington' })
check('a team we cannot find is never silently substituted', missing.tracked === null)
check('...it is not confident', !missing.confident)
check('...and the message names both teams we DID read',
  /Springfield/.test(missing.reason) && /Hawks/.test(missing.reason), missing.reason)
check('...and names the team they asked for', /Warrington/.test(missing.reason))

// ── one team on the page ────────────────────────────────────────────────────

const solo = chooseTrackedSide([theirs], { ourTeamName: 'Springfield Rangers' })
check('a single foreign team is taken confidently', solo.confident && solo.tracked === theirs)

const soloOurs = chooseTrackedSide([mine], { ourTeamName: 'Springfield Rangers' })
check('a single side that is OUR team is refused', soloOurs.tracked === null)
check('...and says so', /your own team/.test(soloOurs.reason), soloOurs.reason)
check('a single side matching our roster is also refused',
  chooseTrackedSide([side(null, OURS)], { ourRoster: OURS }).tracked === null)

// ── nothing usable ──────────────────────────────────────────────────────────

check('no sides at all is handled', chooseTrackedSide([], { ourRoster: OURS }).tracked === null)
check('...and is not confident', !chooseTrackedSide([], {}).confident)

// ── the save-time guard ─────────────────────────────────────────────────────

check('our players are spotted in a list about to be saved',
  ownPlayersIn([{ name: 'C. Losch' }, { name: 'A. Nguyen' }], OURS).length === 1)
check('a clean list flags nothing',
  ownPlayersIn([{ name: 'A. Nguyen' }, { name: 'B. Patel' }], OURS).length === 0)
check('no roster means no false alarms', ownPlayersIn([{ name: 'C. Losch' }], []).length === 0)

check('overlap is a fraction of the side, not a count',
  Math.abs(rosterOverlap(side(null, ['C. Losch', 'A. Nguyen']), OURS) - 0.5) < 0.001)

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
