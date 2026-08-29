# How long does a drill take?

**29 August 2026.** Covers all 206 approved drills.

`est_duration_minutes` was populated on **0 of 206** rows. That is why nothing
in BenchCoach has ever been able to answer "does this fit in the forty minutes
I have left" — the question was unanswerable, so no surface asked it.

This document is the reasoning behind the numbers that fill that column. Read
the first section before trusting any of them.

---

## 1. There is almost no duration evidence in this library

Before estimating anything, every field on every row was searched for a stated
duration. What is actually there:

| Evidence | Drills | Share |
|---|---|---|
| An explicit duration in the drill's own prose | **5** | 2% |
| A rep prescription (`reps_guidance`) and nothing else | **67** | 33% |
| Neither | **134** | 65% |

The five that state a duration:

| Drill | Field | Says |
|---|---|---|
| Stride Pause to Stride Swing Drill | `frequency_guidance` | 5 min |
| Stance & Athletic Position Drill | `frequency_guidance` | 3 min |
| How to Get a T-Baller to Catch a Ball | `frequency_guidance` | 5 min |
| Daily Backhand Series | `ai_coaching_notes` | 10-min |
| Post-Throwing Recovery Routine | `ai_coaching_notes` | 15 min |

That is the entire factual basis. **Two thirds of the library says nothing at
all about how long it takes**, and no amount of processing changes that.

So: these numbers are **estimates from a stated model, not measurements**. The
column is named `est_duration_minutes` and this document exists so that the
"est" is a claim someone can check rather than a hedge.

---

## 2. The model

A drill's length is how many reps it prescribes, times how long one rep
physically takes in that category, plus the setup that category needs before
the first rep.

```
minutes = setup + (reps x secondsPerRep x pace) / 60
```

### Seconds per rep

One full cycle for **one player**: execute, reset, and whatever ball retrieval
or walk-back the rep forces. Not the swing.

| Category | sec/rep | Setup | Why |
|---|---|---|---|
| Hitting | 12 | 3 min | Ball is right there; retrieval is on a shared bucket between rounds |
| Soft Toss / Bunting | 10 | 3 min | Same cycle, slightly quicker |
| Throwing | 10 | 3 min | Throw, receive, throw back — two players, one rep |
| Fielding (Infield) | 15 | 3 min | Two positions have to recover before the next ball |
| Fielding (Fly Balls) | 25 | 3 min | Thirty yards out and back — the travel *is* the rep |
| Catching | 12 | 4 min | Quick reps, but gear and the catcher's reset add up |
| Pitching | 20 | 4 min | Full delivery plus the walk back, at bullpen pace |
| Baserunning / Athletic Dev | 30 | 3 min | Sprint the bases, then walk back; the walk-back dominates |
| Team Defense | 45 | 6 min | Nine players reset before the next rep, and someone is always out of position |
| Arm Care / Warmup | 20 | 2 min | Short cycles, long sequence |

**These constants are coaching judgement.** They are not measured and not
derived from the library. They live in one table in
`scripts/estimate-drill-durations.mjs` precisely so a coach can disagree with a
number and re-run everything with one command.

### Pace and setup modifiers

Category and rep count alone put two thirds of the library on a single number,
because two thirds falls to its category median. A budget where every drill is
eight minutes tells a coach nothing they could not get by counting drills. So
four fields that are populated on **every one of the 206 rows** are also read:

- `difficulty_level` — Beginner ×0.9, Intermediate ×1.0, **Advanced ×1.25**. An
  Advanced drill is not a harder version of the same rep; it is live arms,
  competitive rounds, and a coach stopping to correct.
- `progression_level` 4 — **+2 min setup**. All 18 are Advanced game-speed
  drills, and live reps need the field set before the first one.
- `space_required` — full field/large **+2 min**, medium **+1 min**.
- `equipment_needed` — 5+ items **+2 min**, 3–4 items **+1 min**.

This is reading signal that is already there. It is not manufacturing spread.

### Buckets, not decimals

Everything rounds to **5, 8, 10, 12, 15 or 20 minutes**. A practice runs in
blocks a coach can hold in their head, and "13.4 minutes" is false precision
that invites arithmetic nobody should trust.

### Two protective rules

- **Block floor.** A drill whose name contains *routine, program, series,
  system, package, progression* or *circuit* never lands below 10 minutes. A
  coach who reads "J-Band Routine: 5 min" will run it wrong.
- **Duplicate reconciliation.** 103 drills share a video with at least one
  other. Where two of them also share a name by containment — "High Tee Drill —
  Hitting Up in the Zone" and "High Tee" — they are the same drill entered
  twice, and them disagreeing about their own length is incoherent no matter
  which number is right. Four pairs were reconciled. Ties go to the longer:
  under-running a drill is the cheaper mistake.

---

## 3. What came out

| Confidence | Basis | Drills |
|---|---|---|
| **HIGH** | The drill states its own duration | 5 (2%) |
| **MED** | Parsed from `reps_guidance` | 67 (33%) |
| **LOW** | Category model, using the category's median rep count | 134 (65%) |

**Two thirds of these numbers are LOW confidence.** That is a property of the
library, not of the model, and the honest fix is coaches writing rep counts
into `reps_guidance` — 72 rows have one and they are the only rows carrying
real per-drill signal.

### Distribution

| Minutes | Drills |
|---|---|
| 5 | 15 |
| 8 | 71 |
| 10 | 93 |
| 12 | 15 |
| 15 | 9 |
| 20 | 3 |

Median 10 min. Whole library end to end: 1,946 min (32.4 h).

(The 10-minute count read 92 in the first draft of this table — it was taken
from a replica run with one row hand-edited out. Production confirms 93, and
the six buckets total 206.)

### By category

| Category | n | Median | Range |
|---|---|---|---|
| Team Defense | 7 | 12 | 10–20 |
| Baserunning | 13 | 12 | 8–15 |
| Arm Care | 5 | 10 | 5–15 |
| Catching | 13 | 10 | 5–15 |
| Fielding (Fly Balls) | 11 | 10 | 8–12 |
| Fielding (Infield) | 20 | 10 | 8–15 |
| Hitting | 55 | 10 | 5–20 |
| Pitching | 33 | 10 | 8–12 |
| Athletic Development | 2 | 10 | 8–10 |
| Bunting | 5 | 8 | 8–10 |
| Soft Toss | 4 | 8 | 8–10 |
| Throwing | 36 | 8 | 5–10 |
| Warmup | 2 | 5 | 5–5 |

Team Defense being the most expensive category and Warmup the cheapest is the
ordering a coach would predict, which is the weakest possible form of
validation but the only one available.

---

## 4. A bug worth recording

The first version of the rep parser read six of the 72 anchor drills an order
of magnitude low:

| `reps_guidance` | Read as | Actually |
|---|---|---|
| `Pick 2 drills, 10 throws each` | 2 reps | 20 |
| `2 situational rounds of 6 at-bat scenarios` | 2 reps | 12 |
| `3 circuits of 3 balls per session` | 3 reps | 9 |
| `3 rounds: 5 heavy + 5 light + 5 game-bat swings` | 3 reps | 45 |
| `5 drills x 6 reps daily` | 5 reps | 30 |
| `Walk-through of 4 scenarios, then 2 live reps each` | 4 reps | 8 |

This mattered more than six rows: those 72 drills also set the **category
median rep counts that the other 134 inherit**, so the error propagated into
two thirds of the library. All six shapes are now locked down by assertions in
`scripts/test-drill-durations.ts`.

---

## 5. Retrieval is unaffected, and that is tested

`est_duration_minutes` was already in `DRILL_FIELDS` before it held any values,
so populating it puts a previously-uniformly-null field onto every scoring path
at once. If any weight, filter or tiebreak reads it — now or by accident later
— the entire retrieval surface shifts under a change meant to be additive.

`scripts/test-drill-durations.ts` runs the twenty evaluation prompts against
the library **twice**, once with durations and once without, and asserts the
runs are identical in returned ids, ordering, scores to four decimal places,
eligibility counts, retrieval path and filters applied. It separately asserts
the durations do arrive on the returned records, because invariance would also
be satisfied by the field being silently dropped.

179 assertions, all passing. No scoring weight, filter, model or prompt was
changed.

---

## 6. What this deliberately does not model

**Team size.** A twelve-player team running one tee is not a three-player team
running one tee, and the difference is a multiplier on reps, not on the drill.
Base duration is what one group needs to run the drill once. Scaling for a
roster is a separate decision with its own inputs — stations, number of
coaches, whether the drill parallelises at all — and folding a guess about it
into the stored number would make the stored number mean two things.

Also untouched: `youtube_start_seconds` (still 0/206), equipment quantities,
coach/player counts, drill descriptions, the taxonomy, and every scoring
weight.

---

## 7. Does it survive a practice?

`npm run sim:practice-budget` runs retrieval for five scenarios at six budgets,
subtracts 8 minutes of overhead — gathering eleven eight-year-olds, a water
break, someone who cannot find their glove — and fills the rest greedily in
rank order.

| Budget | Drills | Min used | Slack | Avg drill |
|---|---|---|---|---|
| 30 | 3.0 | 19.6 | 2.4 | 6.5 |
| 45 | 4.6 | 35.2 | 1.8 | 7.7 |
| 60 | 6.6 | 48.4 | 3.6 | 7.3 |
| 75 | 8.8 | 64.6 | 2.4 | 7.3 |
| 90 | 10.8 | 80.6 | 1.4 | 7.5 |
| 120 | 14.4 | 106.6 | 5.4 | 7.4 |

Slack stays near zero at every budget, including 120 minutes — retrieval does
not run out of relevant drills before the clock runs out. A 30-minute backyard
session yields three drills, which is a coherent session rather than an
artefact of estimates being too long to use.

---

## 8. Reproducing and revising

```
node scripts/estimate-drill-durations.mjs            summary + distribution
node scripts/estimate-drill-durations.mjs --table    full 206-row review table
node scripts/estimate-drill-durations.mjs --low      only the 134 LOW rows
node scripts/estimate-drill-durations.mjs --csv      docs/audits/drill-duration-estimates.csv
node scripts/estimate-drill-durations.mjs --sql      regenerates migration 047
```

Every row of the review table, with its evidence string, is checked in at
`docs/audits/drill-duration-estimates.csv`.

To revise: change a constant in `CATEGORY_MODEL`, re-run with `--sql`, re-run
`npm run test:drill-durations`. The migration is matched on **drill id, never
on title** — 103 drills share a video and several share a name prefix, so a
title match would hit the wrong row.

Migration 047 only fills nulls (`AND est_duration_minutes IS NULL`). A duration
a human corrects by hand wins over anything this script computed, and re-running
must not silently undo that correction. Both behaviours were verified against a
local Postgres 16 loaded with the real 206 production ids: first run
`UPDATE 206`, hand-edit one row, second run `UPDATE 0`, hand-edit intact.

---

## 9. Open, and not addressed here

- **`space_required` has a case variant in production** — `Full Field` (14
  rows) and `Full field` (13 rows) are the same value stored two ways. It does
  not affect durations (the model lowercases before matching) but it is a live
  data-quality defect in a column retrieval filters on.
- **`youtube_start_seconds` is still 0/206**, with 103 drills sharing a video
  and one video backing 19 separate drills. Those 19 all link to the same
  unsegmented compilation.
- **65% LOW confidence** will stay 65% until `reps_guidance` is filled in.
