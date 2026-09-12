// Editing a practice without breaking it.
//
// These are the rules the builder has to hold while a coach reorders, retimes,
// replaces and groups blocks. Most of them are invisible until they are wrong:
// a station parent whose minutes stop matching its rotation prints a sheet that
// disagrees with the clock, and a replace that quietly changes a block's length
// moves everything after it.
//
//   npm run test:plan-edits

import {
  moveBlock, duplicateBlock, removeBlock, setBlockMinutes, replaceBlock,
  replaceStation, insertBlock, blockFromDrill, customActivityBlock,
  makeStationGroup, ungroupStations, addStation, removeStation,
  stationElapsedMinutes, rotationFromElapsed, totalMinutes,
} from '@/lib/planEdits'
import { isStationGroup, scheduleRows, readPlan, plannedMinutes } from '@/lib/practicePlan'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (label: string, actual: any, expected: any) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

const PLAN = () => ([
  { type: 'warmup', title: 'Dynamic Stretch', minutes: 10 },
  { type: 'drill', title: 'Tee Work', minutes: 15 },
  {
    type: 'station', title: '3-Station Rotation', minutes: 26, groups: 3, rotation_minutes: 8,
    stations: [
      { title: 'High Tee', minutes: 8 },
      { title: 'Ground Ball Footwork', minutes: 8 },
      { title: 'Quick Transfer', minutes: 8 },
    ],
  },
  { type: 'game', title: 'Scrimmage', minutes: 20 },
])

// ── the station arithmetic, which everything else depends on ────────────────
//
// Three stations of eight is 26 elapsed, not 24 and not 72: one rotation per
// station plus a changeover between them. Modelled as three sequential blocks
// it reads as 72 and the scheduler discards two of them.

eq('3 stations x 8 min is 26 elapsed', stationElapsedMinutes(8, 3), 26)
eq('2 stations x 10 min is 21 elapsed', stationElapsedMinutes(10, 2), 21)
eq('one station has no changeover', stationElapsedMinutes(8, 1), 8)
eq('no stations is no time', stationElapsedMinutes(8, 0), 0)
eq('26 elapsed across 3 is an 8-minute rotation', rotationFromElapsed(26, 3), 8)
eq('...and the two are inverses', stationElapsedMinutes(rotationFromElapsed(26, 3), 3), 26)

// ── reorder ─────────────────────────────────────────────────────────────────

const moved = moveBlock(PLAN(), 3, 0)
eq('a block moves to the front', moved.map(b => b.title),
  ['Scrimmage', 'Dynamic Stretch', 'Tee Work', '3-Station Rotation'])
eq('...and nothing else changes order',
  moveBlock(PLAN(), 0, 2).map(b => b.title),
  ['Tee Work', '3-Station Rotation', 'Dynamic Stretch', 'Scrimmage'])
eq('total minutes are unchanged by a move', totalMinutes(moved), totalMinutes(PLAN()))
check('a move to the same place is a no-op', moveBlock(PLAN(), 1, 1).length === 4)
check('a drag that ends off the list does not throw', moveBlock(PLAN(), 9, 0).length === 4)

// The times beside the blocks have to follow the order, or the coach reads a
// running order in one sequence and a clock in another.
const rowsBefore = scheduleRows(PLAN(), '17:30').map(r => r.from)
const rowsAfter = scheduleRows(moved, '17:30').map(r => r.from)
eq('the clock restarts at the same time', rowsBefore[0], rowsAfter[0])
check('the second row now starts later, because a 20-minute block went first',
  rowsAfter[1] !== rowsBefore[1],
  `${rowsBefore[1]} vs ${rowsAfter[1]}`)

// ── duplicate and delete ────────────────────────────────────────────────────

const dup = duplicateBlock(PLAN(), 1)
eq('a copy lands directly after the original',
  dup.map(b => b.title),
  ['Dynamic Stretch', 'Tee Work', 'Tee Work', '3-Station Rotation', 'Scrimmage'])
eq('and the total grows by its minutes', totalMinutes(dup), totalMinutes(PLAN()) + 15)

// Deep copy, or editing the copy reaches back into the original.
const dupStations = duplicateBlock(PLAN(), 2)
;(dupStations[3].stations as any[])[0].title = 'Changed'
eq('editing a duplicated rotation does not touch the original',
  (dupStations[2].stations as any[])[0].title, 'High Tee')

eq('delete removes exactly one block',
  removeBlock(PLAN(), 0).map(b => b.title),
  ['Tee Work', '3-Station Rotation', 'Scrimmage'])

// ── duration ────────────────────────────────────────────────────────────────

const retimed = setBlockMinutes(PLAN(), 1, 20)
eq('a plain block takes the new length', retimed[1].minutes, 20)
eq('and the total follows', totalMinutes(retimed), totalMinutes(PLAN()) + 5)
eq('plannedMinutes agrees with totalMinutes', plannedMinutes(retimed), totalMinutes(retimed))

// The station case, which is where this gets easy to get wrong.
const stretched = setBlockMinutes(PLAN(), 2, 32)
eq('a stretched rotation takes the elapsed time', stretched[2].minutes, 32)
eq('...and re-derives the rotation length', stretched[2].rotation_minutes, 10)
eq('...and every station follows it',
  (stretched[2].stations as any[]).map(s => s.minutes), [10, 10, 10])
check('the parent still reads as a station group', isStationGroup(stretched[2]))
check('zero and nonsense are floored rather than accepted',
  setBlockMinutes(PLAN(), 1, 0)[1].minutes === 1)

// ── replace ─────────────────────────────────────────────────────────────────
//
// Position and duration are what the coach built the clock around. Swapping
// the drill should not move everything after it.

const NEW_DRILL = { drill_name: 'Front Toss', description: 'Feeder behind a screen.', equipment_needed: ['L-screen'] }
const replaced = replaceBlock(PLAN(), 1, blockFromDrill(NEW_DRILL))
eq('the replacement holds the same slot', replaced.map(b => b.title),
  ['Dynamic Stretch', 'Front Toss', '3-Station Rotation', 'Scrimmage'])
eq('...and the same minutes', replaced[1].minutes, 15)
eq('...so the total is untouched', totalMinutes(replaced), totalMinutes(PLAN()))
eq('...and it carries the drill through', replaced[1].equipment, ['L-screen'])
eq('a replacement may take its own length when asked',
  replaceBlock(PLAN(), 1, blockFromDrill(NEW_DRILL, 25), { keepMinutes: false })[1].minutes, 25)

// One station, not the rotation.
const stationSwap = replaceStation(PLAN(), 2, 1, blockFromDrill({ drill_name: 'Backhand Series' }))
eq('only the named station changes',
  (stationSwap[2].stations as any[]).map(s => s.title),
  ['High Tee', 'Backhand Series', 'Quick Transfer'])
eq('the rotation length is unchanged', stationSwap[2].minutes, 26)
eq('...and the new station takes the rotation, not its own default',
  (stationSwap[2].stations as any[])[1].minutes, 8)
eq('replacing a station on a non-station block does nothing',
  replaceStation(PLAN(), 1, 0, blockFromDrill({ drill_name: 'x' })), PLAN())

// ── add ─────────────────────────────────────────────────────────────────────

eq('a drill appends by default', insertBlock(PLAN(), blockFromDrill({ drill_name: 'Wall Ball' })).map(b => b.title),
  ['Dynamic Stretch', 'Tee Work', '3-Station Rotation', 'Scrimmage', 'Wall Ball'])
eq('...or lands where asked',
  insertBlock(PLAN(), blockFromDrill({ drill_name: 'Wall Ball' }), 1).map(b => b.title),
  ['Dynamic Stretch', 'Wall Ball', 'Tee Work', '3-Station Rotation', 'Scrimmage'])

const custom = customActivityBlock({ title: 'Team talk', minutes: 5, type: 'cooldown', description: 'Wrap up' })
eq('a custom activity is an ordinary block', custom.type, 'cooldown')
eq('...with its own title and length', [custom.title, custom.minutes], ['Team talk', 5])
eq('an untitled activity is still named something', customActivityBlock({}).title, 'Untitled activity')

// ── station groups ──────────────────────────────────────────────────────────

const group = makeStationGroup(
  [{ title: 'A', minutes: 8 }, { title: 'B', minutes: 8 }, { title: 'C', minutes: 8 }],
  { rotationMinutes: 8 }
)
check('a made group reads as a station group', isStationGroup(group))
eq('its minutes are elapsed, not the sum', group.minutes, 26)
eq('its rotation is stated', group.rotation_minutes, 8)
eq('every station carries the rotation length',
  (group.stations as any[]).map(s => s.minutes), [8, 8, 8])

eq('ungrouping gives the sequential blocks back',
  ungroupStations(PLAN(), 2).map(b => b.title),
  ['Dynamic Stretch', 'Tee Work', 'High Tee', 'Ground Ball Footwork', 'Quick Transfer', 'Scrimmage'])

const added = addStation(PLAN(), 2, blockFromDrill({ drill_name: 'Short Hops' }))
eq('adding a station lengthens the elapsed time', added[2].minutes, stationElapsedMinutes(8, 4))
eq('...and the new one takes the rotation', (added[2].stations as any[])[3].minutes, 8)

const dropped = removeStation(PLAN(), 2, 0)
eq('removing a station shortens the elapsed time', dropped[2].minutes, stationElapsedMinutes(8, 2))
eq('...and leaves the rest', (dropped[2].stations as any[]).map(s => s.title),
  ['Ground Ball Footwork', 'Quick Transfer'])

// A rotation of one is not a rotation.
const collapsed = removeStation(removeStation(PLAN(), 2, 0), 2, 0)
check('dropping to one station collapses the group', !isStationGroup(collapsed[2]))
eq('...and what is left is that activity', collapsed[2].title, 'Quick Transfer')

// ── historical plans still parse ────────────────────────────────────────────
//
// Three generations of `content` are in the database and the builder has to
// open all of them.

eq('a bare array of blocks reads', readPlan([{ title: 'Old', minutes: 10 }]).blocks.length, 1)
eq('the middle shape reads',
  readPlan({ blocks: [{ title: 'Mid', minutes: 10 }], coach_notes: 'n', flags: [] }).blocks.length, 1)
eq('the current shape reads', readPlan({ blocks: PLAN() }).blocks.length, 4)
eq('an empty plan does not crash', readPlan(null).blocks.length, 0)
check('edits work on a historical plan too',
  moveBlock(readPlan([{ title: 'A', minutes: 5 }, { title: 'B', minutes: 5 }]).blocks, 1, 0)[0].title === 'B')

// ── every entry path becomes the same PlanBlock[] ───────────────────────────
//
// AI, template, manual and saved are four ways to OBTAIN blocks. Once obtained
// they are the same thing, and the builder must not be able to tell them apart.
// readPlan is the funnel; these assert each shape survives it and then edits
// identically.

const AI_CONTENT = { blocks: PLAN(), objective: 'Two hands', coaching_points: ['a'], flags: [] }
const TEMPLATE_CONTENT = { blocks: [{ type: 'warmup', title: 'Dynamic Stretch', minutes: 10 }] }
const BLANK_CONTENT = { blocks: [{ type: 'warmup', title: 'Warm-up', minutes: 10, description: '', coaching_cues: [] }] }
const HISTORICAL = [{ title: 'Old array plan', minutes: 12 }]

for (const [name, content] of [
  ['AI', AI_CONTENT], ['template', TEMPLATE_CONTENT], ['blank', BLANK_CONTENT], ['historical', HISTORICAL],
] as Array<[string, any]>) {
  const blocks = readPlan(content).blocks
  check(`${name} content normalises to blocks`, Array.isArray(blocks) && blocks.length > 0)
  check(`...and ${name} edits the same way`,
    insertBlock(blocks, blockFromDrill({ drill_name: 'Wall Ball' })).length === blocks.length + 1)
  check(`...and ${name} retimes the same way`,
    setBlockMinutes(blocks, 0, 14)[0].minutes === 14)
}

// A blank plan is a real plan, not a special case.
eq('a blank plan has a total', totalMinutes(readPlan(BLANK_CONTENT).blocks), 10)

// ── the save/reload shape is stable ─────────────────────────────────────────
//
// Edit, "save", reopen. The second read must give back what the first one
// produced, or a coach loses work between sessions without being told.

const edited = setBlockMinutes(
  insertBlock(readPlan(AI_CONTENT).blocks, blockFromDrill({ drill_name: 'Wall Ball' }), 1), 0, 12)
const roundTripped = readPlan({ ...AI_CONTENT, blocks: edited }).blocks
eq('a saved-and-reopened plan is identical', JSON.stringify(roundTripped), JSON.stringify(edited))
eq('...including the block that was added', roundTripped[1].title, 'Wall Ball')
eq('...and the one that was retimed', roundTripped[0].minutes, 12)

// ── the totals coverage is measured from ────────────────────────────────────
//
// Priority coverage reads the blocks, so it follows every edit for free — but
// only if the edits produce a correct block list. These assert the arithmetic
// coverage depends on.

const base = PLAN()
eq('add changes the total',
  totalMinutes(insertBlock(base, blockFromDrill({ drill_name: 'X' }, 9))), totalMinutes(base) + 9)
eq('delete changes the total', totalMinutes(removeBlock(base, 0)), totalMinutes(base) - 10)
eq('reorder does not', totalMinutes(moveBlock(base, 0, 3)), totalMinutes(base))
eq('replace does not, by design', totalMinutes(replaceBlock(base, 1, blockFromDrill({ drill_name: 'X' }, 99))), totalMinutes(base))
eq('a station child swap does not either',
  totalMinutes(replaceStation(base, 2, 0, blockFromDrill({ drill_name: 'X' }, 99))), totalMinutes(base))

// Coverage reads skills off blocks; a replacement must not carry the old
// block's skills, or the summary credits work that is no longer in the plan.
const withSkills = [{ type: 'drill', title: 'Tee', minutes: 10, skills: ['hitting'] }]
const swapped = replaceBlock(withSkills, 0, blockFromDrill({ drill_name: 'Ground Balls' }))
check('a replacement does not inherit the old block\'s skills',
  swapped[0].skills === undefined,
  'otherwise coverage credits hitting for an infield drill')

// ── nothing mutates ─────────────────────────────────────────────────────────
//
// The builder keeps the pre-edit copy for "undo my edits". If any of these
// mutated in place, undo would restore the edit.

const original = PLAN()
const snapshot = JSON.stringify(original)
moveBlock(original, 0, 3)
duplicateBlock(original, 0)
removeBlock(original, 0)
setBlockMinutes(original, 2, 40)
replaceBlock(original, 0, { title: 'x' })
replaceStation(original, 2, 0, { title: 'y' })
insertBlock(original, { title: 'z' })
addStation(original, 2, { title: 'w' })
removeStation(original, 2, 0)
ungroupStations(original, 2)
check('every operation leaves its input untouched', JSON.stringify(original) === snapshot,
  'undo depends on this')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
