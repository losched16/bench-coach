// npm run test:roster-archive
//
// The archive snapshot must round-trip: what a coach set on a player before
// archiving is exactly what comes back on restore, and a snapshot from an
// older shape of the row must still restore rather than throw.

import {
  rosterSnapshot, readSnapshot, restoreRow, restoreEligibility,
} from '../lib/rosterArchive'
import { AGE_GROUPS, nextAgeGroup, isAgeGroup } from '../lib/ageGroups'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('rosterSnapshot')
{
  const snap = rosterSnapshot(
    {
      id: 'tp1', team_id: 't1', player_id: 'p1',
      positions: ['SS', '2B'], hitting_level: 4, throwing_level: 3, fielding_level: null,
      pitching_level: 9 as any, baserunning_level: '2' as any, coachability_level: undefined,
      focus_notes: '  keep the back elbow up  ', locked_position: '', excluded_positions: ['C'],
      min_innings: 2, max_innings: null,
    },
    [{ position: 'P', eligible: false }, { position: 'SS', eligible: true }, { position: ' ', eligible: true }]
  )
  check('positions kept', JSON.stringify(snap.positions) === '["SS","2B"]', snap.positions)
  check('levels in 1..5 kept, out of range dropped', snap.hitting_level === 4 && snap.pitching_level === null)
  check('a numeric string level is read', snap.baserunning_level === 2)
  check('missing level is null', snap.coachability_level === null)
  check('focus notes trimmed', snap.focus_notes === 'keep the back elbow up')
  check('empty locked position is null', snap.locked_position === null)
  check('excluded positions kept', JSON.stringify(snap.excluded_positions) === '["C"]')
  check('innings kept', snap.min_innings === 2 && snap.max_innings === null)
  check('blank eligibility rows dropped', snap.eligibility.length === 2)
  check('eligibility false survives', snap.eligibility.find(e => e.position === 'P')?.eligible === false)
}

console.log('round trip')
{
  const before = rosterSnapshot(
    { id: 'a', team_id: 't', player_id: 'p', positions: ['1B'], hitting_level: 5, focus_notes: 'x' },
    [{ position: '1B', eligible: true }]
  )
  const stored = JSON.parse(JSON.stringify(before))
  const after = readSnapshot(stored)
  check('snapshot survives JSON', JSON.stringify(after) === JSON.stringify(before))
  const row = restoreRow('t', 'p', after)
  check('restore row targets the team and player', row.team_id === 't' && row.player_id === 'p')
  check('restore row carries the ratings', row.hitting_level === 5 && row.focus_notes === 'x')
  const elig = restoreEligibility('newtp', after)
  check('eligibility re-attached to the new roster row', elig.length === 1 && elig[0].team_player_id === 'newtp' && elig[0].position === '1B')
}

console.log('readSnapshot is forgiving')
{
  check('null is an empty snapshot', readSnapshot(null).positions.length === 0)
  check('garbage is an empty snapshot', readSnapshot('nope').eligibility.length === 0)
  const partial = readSnapshot({ positions: 'SS', eligibility: [{ position: 'C' }, null, { eligible: true }] })
  check('non-array positions become empty', partial.positions.length === 0)
  check('eligibility without a position is dropped', partial.eligibility.length === 1 && partial.eligibility[0].eligible === true)
}

console.log('ageGroups')
{
  check('8U moves to 9U', nextAgeGroup('8U') === '9U')
  check('top of the list has no next', nextAgeGroup('13U+') === null)
  check('unknown has no next', nextAgeGroup('') === null && nextAgeGroup(undefined) === null)
  check('list is in order', AGE_GROUPS[0] === '6U' && AGE_GROUPS[AGE_GROUPS.length - 1] === '13U+')
  check('isAgeGroup', isAgeGroup('10U') && !isAgeGroup('10u') && !isAgeGroup(10))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
