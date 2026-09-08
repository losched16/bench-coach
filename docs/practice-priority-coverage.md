# Practice plan priority coverage

## The failure this fixes

A coach selected Throwing, Hitting and Infield for a 90-minute 9U practice
and received one 10-minute hitting block and roughly seventy minutes of infield
and throwing, with the plan's own flag reading "High Tee Drill is your only
hitting rep today, so protect that one." The system noticed the under-coverage
after composing the plan and apologised for it instead of fixing it.

## Where the pipeline let it happen

```
selected priorities → retrieval → scheduler proposal → skeleton prompt
→ model skeleton → fitBlocks (time only) → expansion → review screen
```

- **Retrieval** (`lib/drillRetrieval.ts`) ranks the whole pool by relevance to
  one combined sentence (objective + constraints + focus list). A focus area
  whose drills score lower can arrive with two candidates or none.
- **The scheduler proposal** (`lib/practiceScheduler.ts`) filled the drill
  budget greedily in relevance order. Nothing in it knew which priority a
  drill served.
- **The skeleton prompt** (`lib/anthropic.ts`) listed the focus areas but never
  required that each one get real reps.
- **Post-generation validation** was `fitBlocks` — time only. The only
  coverage signal was the model's self-written `flags`.

## What changed

### Coverage is measured deterministically

`lib/priorityCoverage.ts` — `evaluatePriorityCoverage(blocks, priorities, { drills })`
returns, per selected priority: `exposure_minutes`, `meaningful_blocks`,
`station_exposure_minutes`, `coverage_ratio`, `status`, `minimum_minutes`, and
the per-block credits behind them, plus `explain[]` lines for debug output.

**Exposure is player exposure, not elapsed time.** A 24-minute three-station
rotation credits each station's priority one rotation (8 minutes), not 24. A
station block is one row on the clock (`minutes` = elapsed) with `stations[]`,
`groups` and `rotation_minutes` stored structurally.

**Mentioned is not covered.** A block serves a priority through the library
drill it cites (`skill_category` / `primary_skill`, plus `secondary_skill` at
half credit), or — for a block with no drill link — through its title, then
its description. Warm-ups and cool-downs never count. Tags, coaching points
and a coach holding a fungo bat never count. Stamped `skills[]` on a block are
trusted only for keys the coach actually selected.

**The threshold is derived, not invented.** With N co-primary priorities the
fair share is the plan's meaningful minutes over N. A priority is
`under_covered` below 60% of its fair share, never below 8 minutes, and also
whenever the best-covered priority holds more than twice its exposure. It is
`strong` at 90% of its share. Explicit weights (`weights` option) change the
share; the product has no priority ranking today, so none is inferred and the
priorities are co-primary.

For the real case (72 meaningful minutes, three priorities): fair share 24,
minimum 14. Ten minutes of hitting is flagged; sixteen against twenty-eight is
not.

### Coverage runs before the plan is shown

`app/api/practice-plan/route.ts`, after `fitBlocks`:

```
evaluate → if under-covered: repairPriorityCoverage → fitBlocks again → evaluate
→ stamp skills on every block → send skeleton (with priority_coverage) → expand
```

### The bounded repair pass

`repairPriorityCoverage` takes at most four steps, re-measuring after each:

1. replace a redundant block of an over-covered priority (one that keeps
   another meaningful block) with a drill for the under-covered priority, same
   minutes; the competitive game is the last victim considered
2. move minutes from over-covered blocks onto the under-covered priority's own
   block, never below a 6-minute floor
3. fold one block per priority into a station rotation, which frees elapsed
   time, and spend the freed time on the under-covered priority
4. add the under-covered priority as a station inside an existing rotation
5. replace the lowest-value block of an over-covered priority

A replacement drill must clear age, headcount, coach count, equipment,
throwing load (no `high` load with a game tomorrow) and family redundancy
against every drill already in the plan. Total minutes never rise; the route
re-runs `fitBlocks` afterwards so the clock contract holds by construction.
When nothing eligible exists, the priority is reported `unresolved` and the
plan is not padded.

### The proposal reserves a share per priority

`schedulePractice` now takes `priorities` and `candidatesByPriority`. Before
relevance fills the budget, each priority is given its best drills up to its
minimum, then round-robin up to a fair share; the relevance fill afterwards
refuses a drill that would put one priority past twice the least-covered one
(`rejected[].reason === 'balance'`). The route tops up any priority with fewer
than four candidates using a category-only retrieval (no second model call)
and offers those drills to the model in the menu.

### The prompt

The skeleton prompt states that every selected focus area needs a real block
or station of its own, that a station rotation is ONE block with elapsed
minutes and a `stations[]` array, and `describeSchedule` shows the model the
drill minutes per focus area in the shortlist.

## Review UX

- `components/PriorityCoverageSummary.tsx` — one row per priority: minutes,
  bar against the fair share, status word; "about" when a rotation makes the
  minutes approximate. Shown at the top of the draft modal and the saved plan.
- `components/PracticeBlock.tsx` — every block is a compact row (time range,
  title, minutes, type, skill chips, station summary) until tapped; expanded
  is the full block it always was. A station rotation is one parent row; its
  stations are nested rows with their own detail. Expand all / Collapse all
  controls sit above the list. Open state is React state only.
- The print sheet (`app/dashboard/practice/[id]/print`) lists a rotation's
  stations under its single schedule row and prints station detail as 3A, 3B,
  3C. Nothing was removed from print.

## Save / reload

`content.priority_coverage` is stored with the plan (JSONB, no migration).
`readPlan` returns it or `null`. A plan without it — every plan saved before
this — has its coverage derived from the blocks at render time. Expansion
state is never persisted.

## Tests

`npm run test:priority-coverage` — exposure arithmetic, station exposure,
mentioned-vs-covered, the threshold, the real 9U case before/after repair
(clock unchanged, age-eligible replacements, game block kept, one-coach
staffing), scenarios A–E through proposal and repair, station-aware plan
helpers, and a source check that the route repairs before it sends.

`npm run eval:practice-plan` prints the proposal's priority coverage per
scenario.
