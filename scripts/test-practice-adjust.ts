// What the model is told when a coach asks for a change.
//
// This is one link in a chain that fails silently. The prompt asks for
// unmentioned blocks back with the same title and the same minutes;
// reusableBlock matches on exactly those two fields and carries the written
// detail across. Break either end and nothing errors — the coach just finds
// that the four blocks they liked have been quietly reworded.
//
// The bug these were written for: the plan used to be sent as its own JSON,
// truncated at 6000 characters. On realistic blocks that meant a twelve-block
// practice reached the model three blocks short, and a nine-block one arrived
// as invalid JSON cut mid-object.
//
//   npm run test:practice-adjust

import { buildAdjustmentPrompt, planOutline } from '@/lib/practiceAdjust'
import { reusableBlock, PlanBlock } from '@/lib/practicePlan'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// A block with everything written on it, which is what makes the old JSON
// approach blow its budget.
const detailed = (n: number): PlanBlock => ({
  type: 'drill', title: `Block ${n}`, minutes: 10,
  description: 'A sentence about what happens in this block and why it is here.',
  setup: 'Two lines at the edge of the infield, coach rolling from the grass, bucket at the cones.',
  detailed_instructions: ['Step one, in detail.', 'Step two, also in detail.', 'Step three.'],
  coaching_cues: ['Two hands', 'Field it out front', 'Feet before hands'],
  common_mistakes: ['Reaching back for it', 'Standing up too early'],
  watch_for: 'The glove turning over before the ball is in it.',
  equipment: ['baseballs', 'cones'],
  youtube_video_id: 'abc12345678',
})

// ── every block reaches the model ───────────────────────────────────────────
//
// The whole point. A block the model cannot see cannot come back with the same
// title and minutes, so its detail is lost however good reusableBlock is.

for (const n of [6, 9, 12, 20]) {
  const blocks = Array.from({ length: n }, (_, i) => detailed(i + 1))
  const prompt = buildAdjustmentPrompt({ blocks, words: 'more hitting', planTitle: 'A practice' })
  const seen = blocks.filter(b => prompt.includes(String(b.title))).length
  check(`all ${n} blocks reach the model`, seen === n, `${seen} of ${n}`)
}

const twelve = Array.from({ length: 12 }, (_, i) => detailed(i + 1))
const twelvePrompt = buildAdjustmentPrompt({ blocks: twelve, words: 'x' })
check('a twelve-block practice costs well under the old 6000-char budget',
  twelvePrompt.length < 2000,
  `${twelvePrompt.length} chars — the JSON it replaced was 8,640 and got cut to 6,000`)

// The old approach, kept here as the thing that must not come back.
const oldStyle = JSON.stringify({ title: 'A practice', blocks: twelve }, null, 1).slice(0, 6000)
const lostUnderOld = twelve.filter(b => !oldStyle.includes(`"${b.title}"`)).length
check('...and the old approach really did lose blocks', lostUnderOld === 3,
  `${lostUnderOld} of 12 never reached the model`)

// ── the outline says what a rebuild needs to match ──────────────────────────

const outline = planOutline('Tuesday', [
  { type: 'warmup', title: 'Dynamic Stretch', minutes: 10 },
  { type: 'drill', title: 'Tee Work', minutes: 15 },
])
check('the title is carried', outline.includes('TITLE: Tuesday'))
check('each block has its minutes', outline.includes('Dynamic Stretch — 10 min'))
check('...and its type', outline.includes('(warmup)'))
check('blocks are numbered in running order',
  outline.indexOf('1. Dynamic Stretch') < outline.indexOf('2. Tee Work'))

// A rotation's stations are named: "swap the backhand station" has to resolve
// to something the model can see.
const withStations = planOutline(null, [{
  type: 'station', title: '3-Station Rotation', minutes: 26, rotation_minutes: 8,
  stations: [
    { title: 'High Tee', minutes: 8 },
    { title: 'Backhand Series', minutes: 8 },
    { title: 'Quick Transfer', minutes: 8 },
  ],
}])
check('stations are named under their rotation', withStations.includes('station: Backhand Series'))
check('...with their own minutes', withStations.includes('Backhand Series — 8 min'))
check('...and the parent keeps the elapsed time', withStations.includes('3-Station Rotation — 26 min'))

// ── the contract sentence ───────────────────────────────────────────────────
//
// reusableBlock matches on title AND minutes. If this instruction ever goes
// missing the model has no reason to return either unchanged, and the failure
// looks like the model deciding to reword things.

const prompt = buildAdjustmentPrompt({
  specifics: 'Only the infield tonight, no catcher.',
  planTitle: 'Tuesday',
  blocks: [{ type: 'drill', title: 'Tee Work', minutes: 15 }],
  words: 'Give me 10 more minutes of hitting',
})
check('the coach\'s own words are quoted', prompt.includes('"Give me 10 more minutes of hitting"'))
check('their standing specifics survive', prompt.includes('Only the infield tonight'))
check('the SAME TITLE instruction is present', prompt.includes('SAME title'))
check('the SAME MINUTES instruction is present', prompt.includes('SAME number of minutes'))
check('and it says why, so it is not tidied away',
  prompt.includes('already-written detail is carried across untouched'))
check('it forbids changing anything not asked about',
  prompt.includes('only where they asked you to'))

// ── the two ends actually agree ─────────────────────────────────────────────
//
// The prompt asks for title and minutes back; reusableBlock matches on title
// and minutes. Asserting both in one place is what stops one end drifting.

const WRITTEN: PlanBlock = {
  title: 'Tee Work', minutes: 15,
  setup: 'Three tees along the fence.', coaching_cues: ['Knob to the ball'],
}
check('a block returned with the same title and minutes is reused',
  reusableBlock({ title: 'Tee Work', minutes: 15 }, [WRITTEN])?.setup === WRITTEN.setup)
check('...and the outline gave the model exactly those two fields to return',
  planOutline(null, [WRITTEN]).includes('Tee Work — 15 min'))

// ── edges ───────────────────────────────────────────────────────────────────

check('no specifics does not leave a dangling blank',
  !buildAdjustmentPrompt({ blocks: [], words: 'x' }).startsWith('\n'))
check('an empty plan still produces a usable instruction',
  buildAdjustmentPrompt({ blocks: [], words: 'start again' }).includes('"start again"'))
check('a missing title is simply absent', !planOutline(null, []).includes('TITLE'))
check('an untitled block is still listed', planOutline(null, [{ minutes: 5 }]).includes('Untitled'))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
