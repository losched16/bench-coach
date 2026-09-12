// "Blocks you don't mention stay as they are."
//
// That sentence is under the Ask BenchCoach box, and it is a promise about
// something a coach cannot check: they ask for ten more minutes of hitting, the
// plan comes back, and they have no way of knowing whether the four blocks they
// liked are the same four blocks or four rewrites that happen to share a name.
//
// reusableBlock is what makes it true. When a rebuilt block has the same name
// and the same length as one the coach already read, the written detail is
// carried across verbatim rather than regenerated — telling a model to keep
// something "as close to identical as you can" was never going to hold.
//
// Two assertions covered this before, in a file about printing. The behaviour
// is load-bearing for the whole adjustment flow, so it gets its own.
//
//   npm run test:block-reuse

import { reusableBlock, isExpanded, PlanBlock } from '@/lib/practicePlan'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// A block the coach has already read: it has the written detail on it.
const WRITTEN: PlanBlock = {
  type: 'drill',
  title: 'Alligator Ground Balls',
  minutes: 15,
  description: 'Two hands, field it out front.',
  setup: 'Two lines at the edge of the infield, coach rolling.',
  coaching_cues: ['Two hands', 'Field it out front', 'Feet before hands'],
  common_mistakes: ['Reaching back for it'],
  watch_for: 'The glove turning over before the ball is in it.',
  youtube_video_id: 'abc12345678',
}

// What phase one returns on a rebuild: a name and a length, no detail yet.
const SKELETON: PlanBlock = { type: 'drill', title: 'Alligator Ground Balls', minutes: 15 }

// ── what counts as already written ──────────────────────────────────────────

check('a block with setup and cues is expanded', isExpanded(WRITTEN))
check('a bare skeleton is not', !isExpanded(SKELETON))
check('a title and minutes alone are not detail',
  !isExpanded({ title: 'x', minutes: 10, description: 'a sentence' }),
  'a description arrives with the skeleton; it is not the written-out block')
check('nothing is not expanded', !isExpanded(null))

// ── the promise ─────────────────────────────────────────────────────────────

const kept = reusableBlock(SKELETON, [WRITTEN])
check('an unchanged block comes back', kept !== null)
check('...with its setup', kept?.setup === WRITTEN.setup)
check('...with its cues, verbatim',
  JSON.stringify(kept?.coaching_cues) === JSON.stringify(WRITTEN.coaching_cues))
check('...with its watch-for', kept?.watch_for === WRITTEN.watch_for)
check('...with its video', kept?.youtube_video_id === 'abc12345678')

// Punctuation and case are the model's to vary; they do not mean a new block.
check('a re-cased title still matches',
  reusableBlock({ ...SKELETON, title: 'alligator ground-balls' }, [WRITTEN]) !== null)
check('extra punctuation still matches',
  reusableBlock({ ...SKELETON, title: 'Alligator  Ground Balls!' }, [WRITTEN]) !== null)

// ── when it must NOT reuse ──────────────────────────────────────────────────
//
// These are the cases where the coach asked for a change. Handing back the old
// detail would mean the plan says one thing and reads as another.

check('a renamed block is a different block',
  reusableBlock({ ...SKELETON, title: 'Short Hops' }, [WRITTEN]) === null)
check('a retimed block is a different block',
  reusableBlock({ ...SKELETON, minutes: 20 }, [WRITTEN]) === null,
  'ten more minutes of hitting means this block genuinely changed')
check('nothing to reuse from is null', reusableBlock(SKELETON, []) === null)
check('a previous block with no detail is not worth reusing',
  reusableBlock(SKELETON, [{ title: 'Alligator Ground Balls', minutes: 15 }]) === null)
check('an untitled block matches nothing',
  reusableBlock({ minutes: 15 }, [WRITTEN]) === null)

// ── the skeleton still wins where it speaks ─────────────────────────────────
//
// The rebuild may have changed the description or found a different video. The
// carried-across detail fills the gaps; it does not overrule the new answer.

const withNewDescription = reusableBlock(
  { ...SKELETON, description: 'Now with a tennis ball.', youtube_video_id: 'zzz99999999' },
  [WRITTEN]
)
check('a changed description survives the reuse',
  withNewDescription?.description === 'Now with a tennis ball.')
check('...and a changed video does too',
  withNewDescription?.youtube_video_id === 'zzz99999999')
check('...while the written setup is still carried',
  withNewDescription?.setup === WRITTEN.setup,
  'the new answer wins where it speaks; the old detail fills the rest')

// ── a whole rebuild, the way the route does it ──────────────────────────────
//
// "Give me ten more minutes of hitting." One block changes length, one is
// replaced, the rest must be untouched.

const BEFORE: PlanBlock[] = [
  { ...WRITTEN, title: 'Dynamic Warm-Up', minutes: 10 },
  { ...WRITTEN, title: 'Tee Work', minutes: 15 },
  { ...WRITTEN, title: 'Alligator Ground Balls', minutes: 15 },
  { ...WRITTEN, title: 'Scrimmage', minutes: 20 },
]
const REBUILT: PlanBlock[] = [
  { type: 'warmup', title: 'Dynamic Warm-Up', minutes: 10 },
  { type: 'drill', title: 'Tee Work', minutes: 25 },              // the ten minutes
  { type: 'drill', title: 'Alligator Ground Balls', minutes: 15 },
  { type: 'game', title: 'Kickball Finish', minutes: 10 },        // swapped out
]

const resolved = REBUILT.map(b => reusableBlock(b, BEFORE) ?? b)
check('the untouched warm-up keeps its detail', !!resolved[0].setup)
check('the untouched ground balls keep theirs', !!resolved[2].setup)
check('the block that got longer is rewritten, not reused',
  !resolved[1].setup,
  'its length changed, so its detail has to be written for the new length')
check('the block that was swapped out is new', !resolved[3].setup)
check('two of four were preserved',
  resolved.filter(b => !!b.setup).length === 2,
  `got ${resolved.filter(b => !!b.setup).length}`)

// ── station children ────────────────────────────────────────────────────────
//
// The route flattens a rotation's stations and matches them the same way, so a
// station the coach did not mention keeps its detail too.

const PRIOR_WITH_STATIONS: PlanBlock[] = [
  {
    type: 'station', title: '3-Station Rotation', minutes: 26, rotation_minutes: 8,
    stations: [
      { ...WRITTEN, title: 'High Tee', minutes: 8 },
      { ...WRITTEN, title: 'Backhand Series', minutes: 8 },
    ],
  },
]
const flattened = PRIOR_WITH_STATIONS.flatMap(p => Array.isArray(p.stations) ? p.stations : [p])
check('a station child is reusable by name and length',
  reusableBlock({ title: 'High Tee', minutes: 8 }, flattened)?.setup === WRITTEN.setup)
check('...and a station whose rotation changed is not',
  reusableBlock({ title: 'High Tee', minutes: 10 }, flattened) === null,
  'retiming the rotation changes every station, so their detail is rewritten')

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
