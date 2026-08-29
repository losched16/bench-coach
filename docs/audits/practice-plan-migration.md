# Practice Plan on shared retrieval, with a real clock

**29 August 2026.** Phase 2C.

Practice Plan was the last surface still choosing drills its own way, and the
only one where the coach states how much time they have and nothing counted it.
This covers both.

---

## 1. What Practice Plan actually did

Worth stating precisely, because the shape of the fix depends on it:
**Practice Plan does not select drills.** It builds a menu and hands it to the
model, which composes the blocks — including their lengths. That is the
product, and replacing it with a deterministic planner would be rewriting the
feature rather than migrating it.

The legacy candidate query, in `app/api/practice-plan/route.ts`:

```
visibleDrillsSafe(supabase, coachId, DRILL_SELECT, q =>
  q.or(categoriesForPracticeFocus(focus).map(c => `skill_category.ilike.${c}`))
   .limit(45))
```

Three problems, in ascending order of how much they cost a coach:

1. **A second implementation of drill selection.** Taxonomy, text scoring, age
   filtering and operational filtering all existed in `lib/drillRetrieval.ts`
   and none of them were reachable from here.
2. **The taxonomy was invisible.** A coach whose focus is "hitting" got hitting
   drills. Not the ones that fix what they described — any of them.
3. **`.limit(45)` with no ordering.** PostgREST applies the limit before any
   ordering, so *which* 45 came back was physical row order. This is the same
   class of bug as the hundred-row ceiling chat was cured of in Phase 1.

### What the ceiling actually cost

The hitting focus maps to five categories holding **68 drills**. The ceiling
took the first 45, so **23 were unreachable**. Where the good ones sat:

| Drill | Row | |
|---|---|---|
| One-Hand Tee Drill (Top Hand) | 50 | beyond the ceiling |
| Tee Work | 57 | beyond the ceiling |
| Low Tee | 58 | beyond the ceiling |
| Line Drive Pro / Visual Feedback | 59 | beyond the ceiling |

Those four are exactly what the new path schedules for *"my 8-year-old keeps
dropping his back shoulder"*. Three of them are **curated** taxonomy matches —
the hand-picked answer to that problem. Under the legacy query the model could
not have picked them, because they were never in the menu.

That is the headline result of this phase, and it is a ceiling artefact rather
than a scoring subtlety.

---

## 2. The new architecture

Two layers, deliberately not blended.

**Retrieval** (`lib/drillRetrieval.ts`, unchanged) answers *which drills are
best for this coaching need*. Practice Plan now calls `retrieveDrills()` — the
same entry point chat uses. Nothing about taxonomy scoring, text scoring, age
filtering, operational filtering, coach scoping or tiebreaking is
reimplemented in the route.

**Scheduling** (`lib/practiceScheduler.ts`, new) answers *which of them fit the
clock, in what order*. Pure functions, no I/O, fully testable offline.

Duration plays no part in retrieval. Phase 2B proved with the twenty evaluation
prompts run twice that populating `est_duration_minutes` changes nothing about
which drills rank where, and that property is preserved and re-asserted here.
Blending them would let a 5-minute drill beat a better 15-minute one on
relevance, which is not a judgement retrieval should ever make.

### The scheduler does two things

**Propose.** Turn the ranked candidates into an ordered shortlist that fits the
drill budget — deduplicated, progression-ordered, built around the strongest
matches. This is handed to the model as a recommendation, not a decision taken
from it.

**Enforce.** `fitBlocks()` reads the skeleton the model returns and makes the
arithmetic true. This is the part that matters: the prompt previously said
*"durations must add to about N minutes"*, and "about" was doing all the work.
A 60-minute request could come back as 72 minutes of blocks and nothing
noticed, because nothing was counting. A prompt cannot promise arithmetic; a
pure function that trims the plan can, and can be tested at seven budgets with
no API key.

---

## 3. The time contract

```
requested  −  non-drill blocks  −  transitions  =  drill budget
```

**Non-drill blocks** are the warm-up, competitive game and cool-down the
generator already produces. It scales with session length — a 20-minute
backyard session earns a two-minute activation, not the same warm-up a
90-minute team practice does.

**Transitions** are `2 min × (blocks − 1)`. Deliberately *not* a flat overhead
constant: the blocks themselves are already counted, so a fixed tax on top
would double-count and shrink every practice. What is genuinely unaccounted for
is the seam — moving eleven eight-year-olds to the next station, water, the
thirty seconds of explaining — and that scales with block count.

| Requested | Non-drill | Transitions | Drill budget |
|---|---|---|---|
| 20 | 6 | 4 | 10 |
| 30 | 9 | 6 | 15 |
| 45 | 14 | 8 | 23 |
| 60 | 14 | 8 | 38 |
| 75 | 20 | 10 | 45 |
| 90 | 20 | 10 | 60 |
| 120 | 25 | 12 | 83 |

### Slack is allowed; overage is not

A 60-minute practice does not need exactly 60:00 of blocks. Filling the last
four minutes with a weakly relevant drill is worse than handing back a
56-minute plan — a coach can always run one more round of something that
worked, and cannot un-run a bad drill. Observed slack across the seven
scenarios is 0–4 minutes.

Overage is not tolerated at all. `fitBlocks()` trims proportionally first, so
every block keeps its shape and its place, and only drops blocks from the back
when trimming alone cannot get there without shredding them below a 3-minute
floor.

### Not a knapsack

Selection is greedy **in relevance order**, not packed to fill the clock.
Packing the combination of durations closest to the budget would routinely drop
the best drill for three weak short ones, which is the exact failure this is
written to avoid. It does keep looking after the first drill that does not fit,
so a 15-minute drill cannot make the rest of the list unreachable by ordering
alone.

---

## 4. Redundancy — conservative on purpose

103 of 206 drills share a video with something else. Most are legitimately
distinct segments of one compilation: **Tee Work and Low Tee both come off
q7CPS0RYDPM** (Line Drive Pro is on a different video — corrected in Phase 2D),
and a coach running them in sequence is running a progression, not the same
drill twice.

So a shared video alone is never enough to suppress. Two drills are redundant
only when the names are identical once punctuation is stripped, or when one
name contains the other **and** they are the same piece of film — the long-form
and short-form entries of a single drill, "High Tee Drill — Hitting Up in the
Zone" and "High Tee".

Asserted both ways: the duplicate pairs are suppressed, and the Tee
Work / Low Tee / Line Drive Pro progression is not.

---

## 5. Evaluation

`npm run eval:practice-plan` — seven scenarios, offline, deterministic.

| Scenario | Req | Drill budget | Scheduled | Drills | Slack |
|---|---|---|---|---|---|
| Hitting fault (8yo, back shoulder) | 60 | 38 | 34 | 4 | 4 |
| Infield transfer (10yo) | 75 | 45 | 42 | 4 | 3 |
| Fly-ball confidence (8yo) | 45 | 23 | 23 | 3 | 0 |
| Pitching goal (11yo, throw harder) | 60 | 38 | 30 | 3 | 8 |
| Indoor session (9yo, small space) | 30 | 15 | 13 | 2 | 2 |
| Backyard solo (8yo) | 30 | 15 | 15 | 2 | 0 |
| Full team practice (10U) | 90 | 60 | 56 | 7 | 4 |

The flagship case:

```
"My 8-year-old keeps dropping his back shoulder when he swings."
diagnosis: uppercutting   path: hybrid

 1  10 min  stage 1  108.0  Tee Work                       curated-map
 2   8 min  stage 2  107.9  Low Tee                        curated-map
 3   8 min  stage 2  107.8  Line Drive Pro / Visual Feed.  curated-map
 4   8 min  stage 2   63.6  One-Hand Tee Drill (Top Hand)  auto-map
```

The curated sequence, in progression order, inside the budget. Under the legacy
path none of these four were in the menu at all.

### A bug this evaluation caught in itself

The first version of the scenarios used `focus: ['fielding']`. There is no
`fielding` key — the product's keys are `hitting, throwing, catching, infield,
outfield, baserunning, game iq, confidence, focus/behavior`.
`categoriesForPracticeFocus()` returns `[]` for an unknown focus, which reads
downstream as "no category constraint", so the fielding scenarios were silently
evaluating against the whole library and the legacy comparison was measuring
nothing. The evaluator now validates its scenarios against the real keys before
running.

The runtime behaviour is left alone — returning `[]` is correct there, since
absence is not a constraint — but it is worth knowing that **a typo'd focus
degrades silently in production too**.

---

## 6. Duration debt — aim the curation

134 of 206 drills carry a LOW-confidence duration inherited from their category
median. Curating all 134 blind is the wrong order of work. These are the ones
the evaluation scenarios actually schedule:

| Used | Min | Category | Drill |
|---|---|---|---|
| 2 | 5 | Warmup | 8 Baseball Warm-Up Exercises You Must Do |
| 1 | 10 | Fielding (Infield) | The Hands Routine — Infield Fielding Drill |
| 1 | 10 | Fielding (Infield) | Infield Throwing Drill |
| 1 | 10 | Fielding (Infield) | Groundball Transfer Catch |
| 1 | 12 | Fielding (Infield) | 4 High-Energy Infield Drills |
| 1 | 10 | Fielding (Infield) | Youth Infield Drill (Practice Anywhere) |
| 1 | 10 | Fielding (Infield) | The Best Youth Infield Drill |
| 1 | 10 | Fielding (Fly Balls) | 3 Great Outfield Drills for Youth Players |
| 1 | 8 | Fielding (Fly Balls) | Outfield Drop Step Drill |
| 1 | 10 | Throwing | Crow Hop — Arm Strength and Outfield Throwing |
| 1 | 10 | Hitting | 5 Essential Hitting Drills for Youth Baseball |
| 1 | 10 | Pitching | Indoor Team Pitching Drills |
| 1 | 8 | Bunting | Bunting with Lacrosse Stick |

**13 drills, and six of them are Fielding (Infield).** That category has 20
drills of which only 8 state reps — it is the concentration worth fixing first.
Writing `reps_guidance` for these thirteen is an hour of work and converts the
most-used estimates from inherited medians to anchored ones.

A LOW-confidence duration never blocks scheduling. This is observation for
targeting, not a gate.

---

## 7. What this deliberately does not know

**How many kids are standing there.** The library has no player count, coach
count, station count or equipment quantity. `est_duration_minutes` is a **base**
estimate — what one group needs to run the drill once — and it is not scaled to
an assumed roster and must not be. A twelve-player team running one tee needs a
multiplier on reps, which is a different input with different data behind it;
guessing at it here would make the stored number mean two things.

The route does load the roster and passes the headcount to the model in prose
for station maths. That is unchanged and is not the same as scaling durations.

---

## 8. Metadata normalization (migration 048)

| Column | Was | Now |
|---|---|---|
| `space_required` | `Full Field` 14, `Full field` 13 | `Full Field` 27 |
| `indoor_outdoor` | `Both` 93, `Indoor/Outdoor` 45 | `Both` 138 |

**This is data hygiene, not a bug fix, and the earlier Phase 2B framing
overstated it.** `spaceEligible()` and `environmentEligible()` both lowercase
before matching, and the latter treats a value containing `/` as "either", so
all four spellings already behaved correctly. It is still worth fixing: a
controlled column with two spellings of one value is a trap for the next
`GROUP BY`, admin filter, or query that does not happen to lowercase.

The variants split across provenance — both appear under
`source = ai_expansion_008` *and* `source IS NULL` — so they are genuine
inconsistency rather than a batch marker worth keeping.

Not done: widening the matching in `drillRetrieval.ts`. The lowercasing is
right; making the filters more forgiving than that would hide the next
malformed value instead of surfacing it. Tests assert every historical variant
still resolves identically, so the migration cannot quietly change eligibility.

Other controlled columns audited and found clean: `requires_partner` (boolean),
`skill_category` (13 values, no variants), `difficulty_level` (3), `status`
(all `approved`). `competition_level` is `both` on all 206 rows — a filter that
currently discriminates nothing.

---

## 9. Preserved

Request and response schema, the NDJSON stream shape, block JSON, saved plans,
`practice_sessions` recaps, favorites, `mustIncludeDrillIds`, the refine path
and `reusableBlock`, roster/station prose, coach scoping, `guard()`
authorization, the coach voice, and the three-stage progression mapping
(level 4 → stage 3, re-asserted in tests).

Persistence is untouched: `practice_plans.content` is a JSON blob written
client-side at generation time. **No historical plan is rewritten** — only
newly generated plans use the new selection and scheduling.

---

## 10. Commands

```
npm run test:practice-scheduler     517 assertions
npm run eval:practice-plan          seven scenarios
npm run eval:practice-plan -- --compare    legacy vs new
npm run test:drill-retrieval        unchanged, still passing
npm run test:drill-durations        179 assertions, invariance intact
```
