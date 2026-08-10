// Does the printed practice sheet say the right thing?
//
// The failures here are the quiet kind. An equipment list that fails to fold
// "bucket of baseballs (15+)" into "Baseballs" prints the same item three
// times and a coach stops trusting the list. One that folds too hard puts
// "tennis balls" and "baseballs" on the same line and a coach packs the wrong
// bucket. A clock that drifts by one block sends everybody to the cages ten
// minutes late.
//
// None of those throw. All of them are wrong on a field, in front of parents.
//
//   npm run test:practice-sheet

import {
  readPlan, equipmentKey, equipmentChecklist, scheduleRows, parseTime,
  plannedMinutes, fallbackCoachingPoints, reusableBlock, isExpanded, PlanBlock,
} from '@/lib/practicePlan'

let failures = 0

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`ok   ${label}`)
  } else {
    failures++
    console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`)
  }
}

const block = (minutes: number, equipment: string[] = [], extra: Partial<PlanBlock> = {}): PlanBlock =>
  ({ title: 'Block', minutes, equipment, ...extra })

// ── readPlan: three generations of the content column ───────────────────────

check('a bare array of blocks still reads', readPlan([{ title: 'x' }]).blocks.length === 1)
check('an array has no flags rather than undefined', Array.isArray(readPlan([{}]).flags))
check('the object shape reads', readPlan({ blocks: [{}, {}] }).blocks.length === 2)
check('null content does not throw', readPlan(null).blocks.length === 0)
check('a pre-clipboard plan has a null objective', readPlan({ blocks: [] }).objective === null)
check('clipboard fields read through', readPlan({ blocks: [], objective: 'Catch the ball' }).objective === 'Catch the ball')
check(
  'coaching_points is always an array',
  Array.isArray(readPlan({ blocks: [], coaching_points: 'not an array' }).coaching_points),
)

// ── equipmentKey: what counts as the same thing ─────────────────────────────

check('a count is not part of the identity', equipmentKey('15 baseballs') === equipmentKey('baseballs'))
check('a container is not part of the identity', equipmentKey('bucket of baseballs') === equipmentKey('Baseballs'))
check('a parenthetical is not part of the identity', equipmentKey('baseballs (15+)') === equipmentKey('baseballs'))
check('per-player phrasing folds', equipmentKey('1 glove per player') === equipmentKey('Gloves'))
check('plurals fold', equipmentKey('cone') === equipmentKey('3 cones'))
check('a range count folds', equipmentKey('10-12 baseballs') === equipmentKey('baseballs'))
check("possessives fold", equipmentKey('catchers gear') === equipmentKey("catcher's gear"))
check('l-screen spellings fold', equipmentKey('L Screen') === equipmentKey('l-screen'))
check('tee spellings fold', equipmentKey('batting tee') === equipmentKey('Tee'))

// The other half of the job: things that must NOT fold.
check('tennis balls are not baseballs', equipmentKey('tennis balls') !== equipmentKey('baseballs'))
check('wiffle balls are not baseballs', equipmentKey('wiffle balls') !== equipmentKey('baseballs'))
check("a catcher's mitt is not catcher's gear", equipmentKey("catcher's mitt") !== equipmentKey("catcher's gear"))
check('bats are not bases', equipmentKey('bats') !== equipmentKey('bases'))

// ── equipmentChecklist: one list for the car ────────────────────────────────

const packed = equipmentChecklist([
  block(10, ['bucket of baseballs (15+)', '3 cones']),
  block(15, ['Baseballs', 'batting tee', '1 glove per player']),
  block(20, ['cones', 'tennis balls']),
])

check('the same item appears once', packed.filter(x => /baseball/i.test(x)).length === 1, packed.join(' | '))
check('the count survives', packed.some(x => /15/.test(x)), packed.join(' | '))
check('a distinct item is kept', packed.some(x => /tennis/i.test(x)))
check('the list is sorted', packed.join('|') === [...packed].sort((a, b) => a.localeCompare(b)).join('|'))
check('every line is capitalised', packed.every(x => x[0] === x[0].toUpperCase()))
check('empty blocks give an empty list', equipmentChecklist([]).length === 0)
check('blank strings are dropped', equipmentChecklist([block(5, ['', '  '])]).length === 0)
check('a block with no equipment does not throw', equipmentChecklist([{ title: 'x', minutes: 5 }]).length === 0)

// ── the clock ───────────────────────────────────────────────────────────────

check('24-hour times parse', parseTime('17:30') === 17 * 60 + 30)
check('am/pm parses', parseTime('5:30pm') === 17 * 60 + 30)
check('noon is midday', parseTime('12:00pm') === 12 * 60)
check('midnight is zero', parseTime('12:00am') === 0)
check('nonsense is null, not a guess', parseTime('soon') === null)
check('an out-of-range minute is null', parseTime('10:75') === null)
check('an empty time is null', parseTime('') === null)

const rows = scheduleRows([block(10), block(25), block(20)], '17:30')
check('the first block starts at the start time', rows[0].from === '5:30', rows[0].from)
check('blocks run back to back', rows[1].from === rows[0].to, `${rows[0].to} -> ${rows[1].from}`)
check('the clock does not drift', rows[2].to === '6:25', rows[2].to)
check('12-hour rollover reads correctly', scheduleRows([block(60)], '11:30')[0].to === '12:30')

const elapsed = scheduleRows([block(10), block(25)], null)
check('no start time falls back to elapsed', elapsed[0].from === '0:00', elapsed[0].from)
check('elapsed accumulates', elapsed[1].to === '0:35', elapsed[1].to)
check('an unparseable start time falls back rather than throwing', scheduleRows([block(10)], 'later')[0].from === '0:00')
check('elapsed crosses the hour', scheduleRows([block(75)], null)[0].to === '1:15')
check('a block with no minutes does not break the clock', scheduleRows([block(0), block(10)], '17:00')[1].from === '5:00')
check('an untitled block still prints', scheduleRows([{ minutes: 5 }], null)[0].title === 'Untitled block')

// ── totals and fallbacks ────────────────────────────────────────────────────

check('planned minutes add up', plannedMinutes([block(10), block(25), block(20)]) === 55)
check('planned minutes ignore junk', plannedMinutes([block(10), { title: 'x' } as PlanBlock]) === 10)

const cued = fallbackCoachingPoints([
  block(10, [], { coaching_cues: ['step at your target', 'elbow up'] }),
  block(10, [], { coaching_cues: ['glove below the ball'] }),
  block(10, [], {}),
  block(10, [], { coaching_cues: ['finish over the front knee'] }),
])
check('one cue per block, not three from the first', cued.length === 3 && cued[1] === 'glove below the ball', cued.join(' | '))
check('a plan with no cues yields nothing rather than blanks', fallbackCoachingPoints([block(10)]).length === 0)

// ── reusing detail across a rebuild ─────────────────────────────────────────

const written: PlanBlock = {
  title: 'Alligator Ground Balls', minutes: 15,
  description: 'old description',
  detailed_instructions: '1. Ten reps at 15 feet…',
  coaching_cues: ['glove below the ball'],
}
const bare: PlanBlock = { title: 'Four Corners Rundown', minutes: 10 }

check('an expanded block is recognised', isExpanded(written))
check('a bare skeleton block is not', !isExpanded(bare))
check('an undefined block is not expanded', !isExpanded(undefined))

check(
  'the same block by name and length is reused',
  reusableBlock({ title: 'Alligator Ground Balls', minutes: 15 }, [written])
    ?.detailed_instructions === '1. Ten reps at 15 feet…',
)
check(
  'punctuation and case do not break the match',
  reusableBlock({ title: 'alligator ground-balls', minutes: 15 }, [written]) !== null,
)
check(
  'the new skeleton fields win over the old ones',
  reusableBlock({ title: 'Alligator Ground Balls', minutes: 15, description: 'new' }, [written])
    ?.description === 'new',
)
check(
  'a block whose length changed is rewritten, not reused',
  reusableBlock({ title: 'Alligator Ground Balls', minutes: 20 }, [written]) === null,
)
check(
  'a genuinely new block is not reused',
  reusableBlock({ title: 'Bunting Ladder', minutes: 15 }, [written]) === null,
)
check(
  'a previous block with no detail is not worth reusing',
  reusableBlock({ title: 'Four Corners Rundown', minutes: 10 }, [bare]) === null,
)
check('no previous plan means nothing to reuse', reusableBlock(written, null) === null)
check('an untitled block never matches', reusableBlock({ minutes: 15 }, [written]) === null)

console.log('')
if (failures > 0) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('ALL PASS')
