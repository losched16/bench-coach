# How a practice gets built today

Discovery pass, 29 Aug 2026. No behaviour changed.

Traced request: *"75-minute practice, 8U, 11 players, one head coach, two
assistants, one batting cage, a field, tees, baseballs and cones. Focus on
throwing, ground balls and hitting."*

**Headline: the model does essentially all of it.** Code narrows the drill
menu by skill category, counts the roster, and passes constraints through as
prose. Every operational decision — how many stations, how long each block
runs, whether three stations can share one bucket of balls — is made by Claude
inside a prompt, with no arithmetic and no validation before or after.

---

## The pipeline

`app/api/practice-plan/route.ts` → `lib/anthropic.ts`

```
POST /api/practice-plan
  → categoriesForPracticeFocus(focus)          lib/focusAreas.ts:189
  → visibleDrillsSafe(DRILL_SELECT, narrow)    ilike categories, limit 45
  → if fewer than 8 matched: re-query unfiltered, limit 45
  → favoriteDrillIds()                         preference, not a filter
  → mustIncludeDrillIds fetched separately and merged
  → roster query                               real player count and names
  → assembleCoachContext()
  → generatePracticeSkeleton()   Sonnet 5, effort medium  → blocks + minutes
  → expandPracticeBlock() × N    Sonnet 5, in parallel    → steps, cues, setup
  → saved to practice_plans
```

Two phases exist for latency: the skeleton returns in seconds so the coach can
tell early whether it is the practice they asked for. Phase 2 writes each block
out and **does not re-select drills** — the system prompt says "Do not
redesign it, do not change its length."

## What the model is given

`practiceSituation()` (`lib/anthropic.ts`) builds the situation string:

- age group, skill level, duration
- focus areas
- the coach's stated objective, if given
- free-text constraints, marked *"this outranks everything else here"*
- `equipmentAvailable` — with the instruction *"you may not require anything
  outside this list… Never write a block a coach cannot physically run"*
- current goals and team notes
- `loopContext` (active priorities) and `rosterSection`

`drillMenu()` renders one line per drill via `drillMenuLine` (`lib/drills.ts:159`):

```
- ★ "Drill Name" (Category, Difficulty, ages 8-10) [video: abc123]
  — first 130 chars of description | trains: mechanic_focus | needs: equipment
```

**`est_duration_minutes` is not in `DRILL_SELECT`.** The planner never sees how
long a drill is supposed to take, on any drill, ever.

## Decision by decision

| Consideration | Where it happens | How |
|---|---|---|
| Total practice time | Prompt | *"Durations must add to about ${duration} minutes"*. **Not checked in code.** No sum, no reconciliation |
| Age | Prompt | Age group in the situation string; also displayed per drill via `age_range`. **Never filters the menu** |
| Skill level | Prompt | Team skill level in the situation string. `difficulty_level` shown per drill. No filter |
| Player count | Prompt | **Real.** Roster queried (`route.ts:~265`); a code comment notes it was hardcoded `[]` until recently, so "every plan ever generated was written for an unknown number of kids" |
| Coach count | **Nowhere** | No input field, no column, no prompt variable. The flags instruction mentions *"One adult against two places to stand"*, so the model is told to notice — but it is never given the number |
| Station count | Model | Prompt asks for "two to four named drill blocks". No computation from players ÷ coaches |
| Players per station | Model | Nothing computes it |
| Equipment conflicts | **Nowhere** | `equipmentAvailable` is a flat availability list with no counts. Nothing tracks whether two simultaneous stations need the same tee |
| Space conflicts | **Nowhere** | No space/location field on drills or in the request. "One batting cage" would arrive only as free text in `constraints` |
| Drill duration | Model | `est_duration_minutes` exists in the schema but is **not selected**. Model invents block lengths |
| Setup / transition time | **Nowhere** | No transition budget. Blocks are assumed to abut exactly |
| Warm-up | Prompt | Required structurally; `categoriesForPracticeFocus` force-adds `warmup` and `athletic development` to every category query |
| Teaching before competing | Prompt | Implied by required shape (warmup → drills → game → cooldown). Not enforced, and no drill field says which a drill is |
| Throwing workload | Prompt | Flags instruction mentions *"Throwing volume against what they played this weekend"*. No pitch/throw counting, though `pitch_counts` exists elsewhere in the app |
| Hitting reps | Model | Nothing counts reps |
| Defensive reps | Model | Nothing counts reps |
| Variety | Model | No repeat detection across consecutive practices |
| Idle time | Prompt | Model is asked to flag headcount against stations. Nothing computes queue length |
| Intensity | **Nowhere** | No intensity field, no arc model |
| Sequencing | Prompt | Fixed shape only |
| Prerequisites | **Nowhere** | No prerequisite column |
| Simultaneous equipment demand | **Nowhere** | The gap most likely to produce an unrunnable plan |

## Where the code actually decides something

Three places, and they are worth naming because they are the entirety of the
deterministic logic:

**1. Category narrowing** — `lib/focusAreas.ts:174`

```ts
const PRACTICE_FOCUS_CATEGORIES: Record<string, string[]> = {
  hitting:  ['hitting', 'bunting', 'soft toss'],
  throwing: ['throwing', 'pitching', 'arm care'],
  infield:  ['fielding', 'fielding (infield)', 'team defense'],
  outfield: ['fielding', 'fielding (fly balls)', 'team defense'],
  ...
  confidence: [], 'focus/behavior': [],
}
```

A hardcoded map from UI focus to `skill_category` values. Applied with
`ilike`-any rather than `in`, with a comment: *"the stored categories are
inconsistently cased."* **The data quality problem is known and worked around
rather than fixed.**

Our traced request picks throwing + infield + hitting → `throwing, pitching,
arm care, fielding, fielding (infield), team defense, hitting, bunting, soft
toss` + `warmup, athletic development`.

**2. Widen on thin results** — `route.ts:217`

```ts
if (!matched || matched.length < 8) { /* re-query with no category filter */ }
```

Guards against a focus with no library coverage. Side effect: a genuinely thin
category silently produces an unfiltered menu, so the model may be choosing
from drills unrelated to the requested focus without any signal that this
happened.

**3. Must-include merge** — `route.ts:238`

Drills the coach explicitly picked are fetched separately and merged, because
the category filter would otherwise drop a hitting favourite from a fielding
practice.

## What would happen with the traced request

Traceable from the code:

- 11 players **would** reach the prompt (real roster query).
- **Three coaches would not** — there is no field for it. The model would
  either assume or omit.
- **One batting cage would not** reach anything structured; only free text.
- Tees / baseballs / cones would arrive via `equipmentAvailable` as a flat
  list, with no counts, so "one tee" and "six tees" are indistinguishable.
- 75 minutes would be a prompt instruction, and whether blocks summed to 75
  would depend entirely on the model's arithmetic. **Nothing verifies it.**

Note `lib/practicePlan.ts` — used by the *printable sheet* — does have real
duration maths (`plannedMinutes`, `scheduleRows`, `totalMinutes`). It computes
after the fact for display. **It is not used during generation and cannot
reject a plan.**

## The most likely operational failure

Two stations needing the same equipment at the same time. Nothing in the system
represents equipment as a countable resource: `equipment_needed` is a string
array on a drill, `equipmentAvailable` is a string array on the request, and no
code intersects them, counts them, or checks them across concurrent blocks.

A plan that puts four kids on a tee at station 1 and four on a tee at station 3
with one tee in the car is fully consistent with every rule the system enforces.
