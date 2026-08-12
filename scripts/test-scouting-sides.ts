// Does the box-score parser put the right team in the opponent's roster?
//
// The failure this guards is not an exception. It is a coach's own players
// quietly appearing in an opponent's roster, where they drive pitch-count
// availability and make a board that is confidently wrong. Nothing throws, and
// the screen looks normal.
//
//   npm run test:scouting-sides

import {
  chooseOpponentSide, teamNameSimilarity, samePlayer, rosterOverlap,
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

check('the opponent the coach picked wins',
  chooseOpponentSide([mine, theirs], { opponentName: 'Hawks' }).opponent === theirs)
check('...and it is confident',
  chooseOpponentSide([mine, theirs], { opponentName: 'Hawks' }).confident)
check('...and it says why',
  /Hawks/.test(chooseOpponentSide([mine, theirs], { opponentName: 'Hawks' }).reason))

check('our own team name excludes that side',
  chooseOpponentSide([mine, theirs], { ourTeamName: 'Springfield Rangers' }).opponent === theirs)
check('...and identifies which side was ours',
  chooseOpponentSide([mine, theirs], { ourTeamName: 'Springfield Rangers' }).ours === mine)

// The case that matters most: team names unreadable or missing, which is very
// common on a cropped screenshot. The roster is the only signal left.
const anonMine = side(null, OURS)
const anonTheirs = side(null, ['A. Nguyen', 'B. Patel', 'C. Kim', 'D. Rossi'])
const byRoster = chooseOpponentSide([anonMine, anonTheirs], { ourRoster: OURS })
check('roster overlap identifies our side with no team names', byRoster.opponent === anonTheirs)
check('...confidently', byRoster.confident)
check('...and explains it in coach language', /roster/.test(byRoster.reason), byRoster.reason)

check('roster overlap works with abbreviated box-score names',
  chooseOpponentSide(
    [side(null, ['C. Losch', 'J. Miller', 'O. Ruiz', 'B. Carter']), anonTheirs],
    { ourRoster: OURS },
  ).opponent === anonTheirs)

// One coincidental surname must not flip the decision.
const coincidence = side('Hawks', ['A. Nguyen', 'B. Patel', 'C. Kim', 'S. Doyle'])
const byCoincidence = chooseOpponentSide([coincidence, mine], { ourRoster: OURS })
check('a single shared surname does not make a team ours',
  byCoincidence.opponent === coincidence, byCoincidence.reason)

// ── refusing to guess ───────────────────────────────────────────────────────

const blind = chooseOpponentSide([anonMine, anonTheirs], {})
check('with no context at all it is NOT confident', !blind.confident)
check('...but still offers a guess to show the coach', blind.opponent !== null)
check('...and says plainly that it cannot tell', /cannot tell/.test(blind.reason), blind.reason)

check('a mismatched opponent name does not force a confident pick',
  chooseOpponentSide([anonMine, anonTheirs], { opponentName: 'Completely Different' }).confident === false)

// ── one team on the page ────────────────────────────────────────────────────

const solo = chooseOpponentSide([theirs], { ourTeamName: 'Springfield Rangers' })
check('a single foreign team is taken confidently', solo.confident && solo.opponent === theirs)

const soloOurs = chooseOpponentSide([mine], { ourTeamName: 'Springfield Rangers' })
check('a single side that is OUR team is refused', soloOurs.opponent === null)
check('...and says so', /your own team/.test(soloOurs.reason), soloOurs.reason)
check('a single side matching our roster is also refused',
  chooseOpponentSide([side(null, OURS)], { ourRoster: OURS }).opponent === null)

// ── nothing usable ──────────────────────────────────────────────────────────

check('no sides at all is handled', chooseOpponentSide([], { ourRoster: OURS }).opponent === null)
check('...and is not confident', !chooseOpponentSide([], {}).confident)

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
