// Does the write-up agree with the box score?
//
// A GameChanger upload carries two independent accounts of the same game. The
// parser reads the stat table; nothing read the prose, and two of Springford
// Blue's six hits on 18 August went missing because of it — one of the players
// then read 0-for-8 for the season.
//
// The rule these enforce: flag only under-reporting, and only when the name
// matches exactly one player. A recap names highlights and skips the rest, so
// "the table has more hits than the prose mentions" is the normal case and must
// never warn. And a warning on the wrong player is worse than no warning,
// because the coach then has to disprove it.
//
//   npm run test:recap-crosscheck

import {
  hitClaimsFromRecap, crossCheckHits, matchRecapName, initialsOf, teamCreditedBy,
} from '@/lib/recapCrossCheck'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// The real recap from the entry that lost the hits.
const REAL = `SpringFord 8U Blue Defeat Lowell 8U On Multiple Hit Performance By Teddy

Teddy H collected three hits in three at bats, as SpringFord 8U Blue defeated Lowell 8U 11-1 on Friday.

A ground out by Mark T put SpringFord 8U Blue on the board in the top of the first.

SpringFord 8U Blue scored five runs on three hits in the top of the fourth inning. Rodrick G singled, scoring one run, an error scored one run, Lucas R grounded out, scoring two runs, and Charlie L grounded out, scoring one run.

Mark T drove the middle of the lineup, leading SpringFord 8U Blue with four runs batted in. The first baseman went 1-for-3 on the day.

Brendan B led Lowell 8U with one run batted in. The shortstop went 2-for-2 on the day.`

// The sentence that started all of this.
const EACH = `Teddy H, Rodrick G, Greyson, Charlie L, Lucas, and Wes B each collected one hit for SpringFord 8U Blue.`

// ── initials ────────────────────────────────────────────────────────────────
//
// The two sources write names in opposite shapes. Both reduce to initials.

check('a recap name reduces to initials', JSON.stringify(initialsOf('Charlie L')) === '{"first":"C","last":"L"}')
check('a box-score name reduces the same way', JSON.stringify(initialsOf('C Losch')) === '{"first":"C","last":"L"}')
check('a suffix does not become the surname',
  JSON.stringify(initialsOf('M Todd Jr.')) === '{"first":"M","last":"T"}',
  'Jr. must not read as the last name')
check('a bare first name has no last initial',
  JSON.stringify(initialsOf('Greyson')) === '{"first":"G","last":null}')
check('empty is null', initialsOf('') === null)

// ── matching ────────────────────────────────────────────────────────────────

const ROSTER = ['T Hylan', 'R Garcia', 'G Berk', 'C Losch', 'L Ruiz', 'W Bergmaier', 'M Todd Jr.', 'R Smith']

check('"Charlie L" is C Losch', matchRecapName('Charlie L', ROSTER) === 'C Losch')
check('"Wes B" is W Bergmaier', matchRecapName('Wes B', ROSTER) === 'W Bergmaier')
check('"Teddy H" is T Hylan', matchRecapName('Teddy H', ROSTER) === 'T Hylan')
check('"Mark T" is M Todd Jr.', matchRecapName('Mark T', ROSTER) === 'M Todd Jr.')
check('a bare first name still matches when it is unique',
  matchRecapName('Greyson', ROSTER) === 'G Berk')

// Refusals. Silence beats a warning on the wrong player.
check('an ambiguous bare name matches nothing',
  matchRecapName('Ryan', ['R Garcia', 'R Smith']) === null,
  'two R surnames — prose cannot separate them')
check('two players with identical initials match nothing',
  matchRecapName('Charlie L', ['C Losch', 'C Lowell']) === null)
check('a name nobody shares matches nothing',
  matchRecapName('Jayko F', ROSTER) === null)

// ── reading claims out of prose ─────────────────────────────────────────────

const each = hitClaimsFromRecap(EACH)
check('the "each collected one hit" list yields every name', each.length === 6, `got ${each.length}`)
check('...including Charlie L', each.some(c => c.who === 'Charlie L' && c.atLeast === 1))
check('...and Wes B', each.some(c => c.who === 'Wes B' && c.atLeast === 1))
check('...and the bare "Greyson"', each.some(c => c.who === 'Greyson' && c.atLeast === 1))
check('a claim carries the sentence it came from',
  each[0].because.includes('each collected one hit'))

const real = hitClaimsFromRecap(REAL)
const claimFor = (who: string) => real.find(c => c.who === who)
check('"collected three hits" is read as three', claimFor('Teddy H')?.atLeast === 3, JSON.stringify(claimFor('Teddy H')))
check('"singled" is read as at least one', claimFor('Rodrick G')?.atLeast === 1)

// GameChanger writes the line as "The first baseman went 1-for-3", attributing
// it to a POSITION rather than a name. Guessing which player that is would be
// the wrong kind of clever: on a team where two players share a position, or a
// game where someone moved, it would put a warning on the wrong line. So it is
// read as unattributable, and the hit is simply not claimed.
check('a line attributed to a position, not a name, is not attributed',
  !real.some(c => /baseman|shortstop|catcher|fielder/i.test(c.who)),
  'better to miss a claim than to pin it on the wrong player')
check('...so Mark T gets no hit claim from "The first baseman went 1-for-3"',
  claimFor('Mark T') === undefined)

// The same sentence WITH a name is read, which is the common shape.
const named = hitClaimsFromRecap('Teddy H went 3-for-3 on the day.')
check('"NAME went 3-for-3" is read as three',
  named.length === 1 && named[0].atLeast === 3, JSON.stringify(named))
check('grounding out is not a hit',
  !real.some(c => c.who === 'Charlie L'),
  '"Charlie L grounded out" must not be read as a hit')

// The strongest claim per player wins, so one sentence cannot undercut another.
const both = hitClaimsFromRecap('Teddy H singled in the first. Teddy H went 3-for-3 on the day.')
check('the strongest claim per player wins', both.length === 1 && both[0].atLeast === 3)

check('empty prose claims nothing', hitClaimsFromRecap('').length === 0)
check('prose with no hit language claims nothing',
  hitClaimsFromRecap('It rained and the game was called in the third inning.').length === 0)

// ── the check itself ────────────────────────────────────────────────────────
//
// The exact failure, reproduced: the parsed table as it was stored, against the
// recap that was stored beside it.

const PARSED_AS_STORED = [
  { name: 'T Hylan', batting_line: { ab: 3, h: 1 } },
  { name: 'R Garcia', batting_line: { ab: 2, h: 1 } },
  { name: 'G Berk', batting_line: { ab: 3, h: 1 } },
  { name: 'C Losch', batting_line: { ab: 1, h: 0 } },   // the dropped hit
  { name: 'L Ruiz', batting_line: { ab: 3, h: 1 } },
  { name: 'W Bergmaier', batting_line: { ab: 1, h: 0 } }, // and the other one
]

const found = crossCheckHits(EACH, PARSED_AS_STORED)
check('both dropped hits are found', found.length === 2, `got ${found.length}: ${found.map(f => f.playerName).join(', ')}`)
check('Charlie is one of them', found.some(f => f.playerName === 'C Losch'))
check('Wes is the other', found.some(f => f.playerName === 'W Bergmaier'))
check('the flag carries the evidence',
  found[0].because.includes('each collected one hit'),
  'a coach has to be able to check the claim, not just be told')
check('and says both numbers',
  found.every(f => f.recapSays === 1 && f.parsedHas === 0))

// The corrected table must go quiet. This is the assertion that stops the
// warning becoming permanent furniture.
const CORRECTED = PARSED_AS_STORED.map(p =>
  p.name === 'C Losch' || p.name === 'W Bergmaier'
    ? { ...p, batting_line: { ...p.batting_line, h: 1 } }
    : p
)
check('once fixed, it says nothing', crossCheckHits(EACH, CORRECTED).length === 0)

// ── what must never warn ────────────────────────────────────────────────────

check('a table with MORE hits than the prose mentions is fine',
  crossCheckHits('Teddy H singled in the first.', [{ name: 'T Hylan', batting_line: { ab: 4, h: 3 } }]).length === 0,
  'a recap names highlights and skips the rest — flagging this would flag every upload')
check('an unmatched name is skipped, not guessed',
  crossCheckHits(EACH, [{ name: 'Jayko F', batting_line: { ab: 3, h: 0 } }]).length === 0)
check('an ambiguous name is skipped',
  crossCheckHits('Ryan each collected one hit.', [
    { name: 'R Garcia', batting_line: { h: 0 } },
    { name: 'R Smith', batting_line: { h: 0 } },
  ]).length === 0)
check('a player with no batting line is not this check\'s business',
  crossCheckHits(EACH, [{ name: 'C Losch' }]).length === 0)
check('no recap text means no warnings', crossCheckHits('', PARSED_AS_STORED).length === 0)
check('no players means no warnings', crossCheckHits(EACH, []).length === 0)

// ── the other dugout ────────────────────────────────────────────────────────
//
// Found by running this check over the 18 stored entries, not by writing a
// test. One entry flagged, and it was wrong: the Springford Blue page showed
// "Luciano and Khaleb each collected three hits for Latin America 8U" against
// Lucas Ruiz, who is the only L on the Springford sheet. A recap narrates BOTH
// line-ups. The sentence says whose hits they are and nothing was reading it.

const OTHER_SIDE = `Latin America 8U piled up 11 hits in the game. Luciano and Khaleb each collected three hits for Latin America 8U. Jose Fernando O collected two hits for Latin America 8U in two at bats.`

check('a sentence naming a team is read as crediting that team',
  teamCreditedBy('Luciano and Khaleb each collected three hits for Latin America 8U.') === 'Latin America 8U')
check('the trailing clause is not swallowed into the team name',
  teamCreditedBy('Jose Fernando O collected two hits for Latin America 8U in two at bats.') === 'Latin America 8U',
  '"in two at bats" must stop the match')
check('a sentence crediting nobody names no team',
  teamCreditedBy('Teddy H collected three hits in three at bats, as SpringFord 8U Blue defeated Lowell 8U 11-1.') === null,
  'no "for X" clause — falls back to matching by name')

check('the other dugout\'s hits do not land on our roster',
  crossCheckHits(OTHER_SIDE, [{ name: 'L Ruiz', batting_line: { ab: 2, h: 0 } }], 'Springford Blue').length === 0,
  'the real false positive: Luciano is not Lucas Ruiz')

// The guard must not eat the sentence it was built for. GameChanger spells the
// team differently from the tracked record — "SpringFord 8U Blue" against
// "Springford Blue" — so this has to match on similarity, not equality.
check('our own dugout\'s hits still count against our roster',
  crossCheckHits(EACH, PARSED_AS_STORED, 'Springford Blue').length === 2,
  'the 18 August detection must survive the team guard')
check('...and still names both players',
  crossCheckHits(EACH, PARSED_AS_STORED, 'Springford Blue')
    .map(f => f.playerName).sort().join(',') === 'C Losch,W Bergmaier')

// Without a subject team there is nothing to compare against, so behaviour is
// unchanged — the caller that knows the team passes it.
check('no subject team means the guard cannot fire',
  crossCheckHits(EACH, PARSED_AS_STORED).length === 2)

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
