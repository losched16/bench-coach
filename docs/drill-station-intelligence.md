# Drill & Station Intelligence — phase 1

## The problem this solves

The drill library knew what a drill *teaches*. It did not know whether the drill
could be **run**: how many players it needs, how many adults, whether three of
them can go at once, or whether it keeps eleven-year-olds moving.

Two consequences, both visible in production before this phase:

1. **Age was standing in for ability.** `difficulty_level` existed but nothing
   ranked on it, so the only way a plan got harder was for the player to get
   older. An advanced 8U travel team and a first-week 8U rec team got the same
   practice.
2. **Every practice was written for an unknown number of kids and adults.** The
   generator was told "split into stations" with no idea whether the coach was
   alone with twelve players. A plan that needs three coaches, handed to one, is
   not a plan.

## The two claims

Everything here exists to make two sentences true, and both are asserted in
`scripts/test-drill-intelligence.ts` rather than eyeballed:

> **Age gates development. Difficulty ranks ability. They are independent.**
>
> A nine-year-old on an advanced team can be given an advanced drill. A
> thirteen-and-up drill can never reach them, however advanced they are.

> **Three stations cost the time of one, not three.**
>
> Twelve players in three groups of four, rotating every eight minutes, is a
> twenty-four-minute block. Modelled as three sequential blocks it reads as
> seventy-two and the scheduler throws two of them away.

## What changed

| Layer | File | Change |
|---|---|---|
| Schema | `migrations/056_drill_station_intelligence.sql` | `drill_activity_families` + 20 nullable columns on `drill_resources` |
| Data | `migrations/058_drill_calibration.sql` | 9 families, 42 drills calibrated, 2 originals created |
| Types | `lib/drills.ts` | `DrillRecord` and `DRILL_FIELDS` extended |
| Ranking | `lib/drillRetrieval.ts` | skill / engagement / throwing / station / group-size signals; player and coach hard gates |
| Feasibility | `lib/stationPlanner.ts` | new — can these run side by side, and for how long |
| Scheduling | `lib/practiceScheduler.ts` | family-aware redundancy; a station-group suggestion in the skeleton |
| Route | `app/api/practice-plan/route.ts` | team ability, expected headcount and coach count now reach retrieval |
| UI | `app/dashboard/practice/page.tsx` | "How many coaches will be there?" |

## The rules that keep it safe

### Absence is not a constraint

Every new column is nullable and 164 of the 206 drills have none of them set. A
filter fires only when **both** the drill states a requirement and the practice
states a count. A drill that never declared `min_players` is eligible at any
headcount, forever. This is not a transitional accommodation — it is the rule,
because a NOT NULL default would have converted silence into a claim.

`scripts/test-drill-intelligence.ts` asserts it directly: an uncalibrated
library passes through feasibility filtering untouched, and the "Unknown
everything" evaluator scenario shows 208 → 208 eligible with zero filters
applied.

### Relevance stays dominant

The new preference weights are small on purpose — `skillFit: 3`, `engagement:
2`, `throwing: 2`, `station: 2`, `groupSize: 2`, `competitionCtx: 1` — against
a curated taxonomy mapping's 100. The suite proves the arithmetic: a curated
mapping outranks *every* preference signal combined, with a margin above 50. If
that margin ever narrows, a preference has become too heavy and the test fails.

### Hard where it must be, soft everywhere else

Hard (a drill is removed): age, `min_players`, `min_coaches`.
Soft (a drill is ranked): everything else — ability, engagement, throwing load,
station fit, group size, rec/travel context.

`competition_level` moved from hard to soft in this phase. It used to exclude
travel drills from rec teams, which is wrong: an advanced 9U all-star side plays
in a rec league and needs those drills. `competitionEligible()` is retained and
now always returns `true`, so the filter list, debug output and tests keep their
shape while the signal moves to `competitionAffinity()`.

### Stations are a suggestion, never a rewrite

`schedulePractice` returns `stations`, drawn only from drills already in the
plan and sized to the minutes those drills already held. It cannot push a
practice over budget, and it never promotes a weaker drill for being more
station-friendly — relevance was decided upstream. The generator is told about
the rotation and decides whether to use it.

The refusal is as much of a result as the rotation: "5 players is fewer than two
groups of 3" is the sentence that stops a plan lying to a coach.

## Deliberate deviations from the brief

**No `review_status`, no `source_quality`.** `status` already carries
approved / pending_review / rejected and `source` already records provenance.
Adding either would create a second answer to a question the table answers, and
the two would drift.

**`developing` is normalized, not migrated.** Three stores disagree about the
middle rung and always will: the library says `intermediate`, production's
`teams.skill_level` CHECK says `mixed`, the product says `developing`.
`normalizeSkill()` maps all three rather than migrating either column, because
migrating `teams.skill_level` would touch live coach-entered data to win a
vocabulary argument.

**42 drills calibrated, not 206.** Every value in `058` was read off the drill's
own description, equipment list and existing metadata. At forty rows that is
defensible one row at a time. At 206 it becomes pattern-matching on drill names,
and the result is a library that *looks* calibrated and quietly is not — strictly
worse than the honest NULLs it replaced, because retrieval treats a stated value
as a claim.

## Protect the Castle

Original to BenchCoach, supplied by the product owner. Not scraped, not
attributed to a channel, no video, and `source = 'benchcoach_original'` so
nothing downstream can mistake it for curated third-party content.

It exists in the calibration set for a reason beyond being a good drill. Before
this phase the library's youngest `Advanced` drill had `min_age = 9`, so
"advanced at 8U" was unrepresentable **in the data** even though the code had
always treated the two axes independently. `Protect the Castle + Throw`
(8–11, Advanced) is the first row that breaks it. The alternative would have
been editing ages or difficulty on existing rows to manufacture the case, which
is exactly the invented certainty the brief rules out.

## Verification

```
npm run test:drill-intelligence     # 84 assertions — the two claims, plus 058's shape
npm run test:drill-retrieval        # ranking unchanged where it should be
npm run test:practice-scheduler     # 517 assertions — budget arithmetic
npm run eval:practice-plan          # 24 scenarios, offline, no database
npm run verify:bootstrap            # 056 and 058 applied to a throwaway cluster
```

### The regression result that matters

The seven scenarios that existed before this phase produce **byte-identical
plans** after it. Nothing already working changed; the new behaviour appears
only when the new inputs are supplied. The 17 added scenarios are the ones the
library could not previously be asked.

### The proof, in one comparison

| Scenario | Eligible pool | First four drills |
|---|---|---|
| Beginner 8U team | 208 → 147 | Base Running Athletic Circuit · Foul Line Throw · Traditional Changeup · EASY Baseball Catch Drill |
| Advanced 8U team | 208 → 147 | Stance & Athletic Position · **Protect the Castle + Throw** · Little League Cuts & Relays · Ripken Soft Toss |

Same age gate, same 147 drills survive it, completely different practice. That
is the claim, in production data.

The coach-count case, same team and same clock:

| Coaches | Stations |
|---|---|
| 1 | 3 stations × 7 min = 23 min elapsed — all three self-running |
| 3 | 4 stations × 8 min = 35 min elapsed — two of them coach-led |

## Not applied to production

`056` and `058` are both **unapplied**. They have been proven against a
throwaway Postgres cluster (`npm run verify:bootstrap`: 6 applied, 0 failed) and
the offline evaluator overlays `058`'s values in memory, but nothing in this
phase has written to the production database.

`scripts/parse-calibration.mjs` reads `058`'s values straight out of the SQL so
the migration stays the only place they are written; `test:drill-intelligence`
runs the parser and fails loudly if an edit breaks the shape, rather than
silently handing the evaluator an empty overlay.

## Rollback

Both migrations are additive, and the code tolerates every column being NULL —
which is what makes rollback cheap. Nothing below requires a restore.

### If 056 breaks reads

It cannot break reads by construction: it adds a table and twenty nullable
columns and touches no existing value. If something downstream nonetheless
misbehaves, roll back the CODE, not the schema. New columns nobody selects are
inert, and the previous build's `DRILL_FIELDS` does not name them.

Only if the schema itself must go:

```sql
ALTER TABLE public.drill_resources
  DROP COLUMN IF EXISTS activity_family_id,
  DROP COLUMN IF EXISTS variation_type;
  -- …and the other eighteen
DROP TABLE IF EXISTS public.drill_activity_families;
```

Do this last. It destroys 058's data with it.

### If 058's data is wrong

Clear the calibration without touching the drills:

```sql
UPDATE public.drill_resources SET
  activity_family_id = NULL, variation_type = NULL, activity_format = NULL,
  practice_roles = NULL, min_players = NULL, max_players = NULL,
  ideal_group_size = NULL, min_coaches = NULL, station_friendly = NULL,
  rep_density = NULL, idle_time_risk = NULL, engagement_level = NULL,
  competition_style = NULL, instruction_complexity = NULL,
  throwing_load = NULL, physical_intensity = NULL, mixed_skill_friendly = NULL
WHERE station_friendly IS NOT NULL OR activity_family_id IS NOT NULL;
```

The library is then exactly where it was before 058: 206 drills, all metadata
NULL, everything eligible. "Absence is not a constraint" makes the rollback and
the pre-migration state the same state.

### The two original drills

Retire, never delete:

```sql
UPDATE public.drill_resources SET status = 'rejected'
WHERE source = 'benchcoach_original';
```

`status` allows `approved`, `pending_review`, `rejected` — there is no
`retired` value, so `rejected` is the one that takes them out of the visible
library. Deleting them would break any practice plan that already references
them by id.

### Family links only

```sql
UPDATE public.drill_resources SET activity_family_id = NULL, variation_type = NULL;
```

Redundancy detection falls back to names and video ids, which is where it was
before this phase.

### Is the schema safe to leave while code is rolled back?

Yes, and this is the important property. The columns are nullable and unread by
older code; `drill_activity_families` is a table nothing older queries. A code
rollback needs no schema rollback, so the two can be reverted independently and
in either order.

## What is live (7 September 2026)

The distinction that matters: **migrations applied is not the same as feature
live.**

| Layer | State |
|---|---|
| Migration `056` | **applied to production** |
| Migration `058` | **applied to production** |
| The two original drills | **live** — visible to coaches now |
| Difficulty-aware ranking | **not live** — the code is not deployed |
| Player / coach feasibility | **not live** |
| Station suggestions | **not live** |
| "How many coaches?" in the UI | **not live** |

`main` is `0bf9296`, which predates Phase 1, and that is what the production
build is running. The schema and the calibration data are in place underneath
it, doing nothing, which is exactly the safe order: the columns are nullable and
unread by the deployed build, so the database moved first and the code can
follow whenever it is merged.

The one user-visible change today is that the library has 208 drills instead of
206. Protect the Castle and Protect the Castle + Throw are approved, retrievable
and have no video — a state the library already contained one example of, so it
is not a new case for the renderer.

### Verified live, with the deployed-code caveat

`npm run validate:live-retrieval` runs the real `rankDrills()` over the real
production library, read with the public anon key. It proves the ENGINE against
LIVE DATA; it does not prove the deployed application, because the deployed
application does not contain the engine yet.

```
library: 208 drills · 45 calibrated · 163 untouched · 9 families in use

8U beginner eligible pool : 147
8U advanced eligible pool : 147
identical                 : YES — the age gate is the same, only ranking differs
```

Age leaks across all nine retrieval scenarios: **none**.

## Two honest negative results from live validation

### The coach count changed nothing in the live practices

Scenarios 1 and 2 — the same 8U practice with three coaches and then with one —
produced an identical plan and an identical station group. That is a correct
answer and a weak demonstration, and the reason is in the data, not the code:

**No drill in the production library requires more than one coach.** All 208
pass `min_coaches <= 1`, so the hard coach gate cannot fire against today's
library, and the station group that was chosen needed only one coach-led station
either way.

The mechanism itself is right and is asserted in `test:drill-intelligence`:
twelve players and one coach cannot staff three coach-dependent stations, and
the same twelve with self-running activities can. What is missing is library
data that exercises it. Calibrating a batch of genuinely coach-hungry activities
— live BP, machine work, anything with a fungo — is what would make the coach
count matter to a real coach.

### The light-throwing practice was right for the wrong reason

Scenario 4 ("game tomorrow, keep throwing light") produced zero high-throwing
blocks, which is the desired outcome. But all four selected drills have
`throwing_load` NULL: they are hitting drills chosen by category, and the
throwing-load signal did not demonstrably cause the result. The outcome is
correct and under-determined.

Both findings point the same way, and it is not "calibrate all 206": it is
"calibrate the drills where the new signals would actually change a decision."
