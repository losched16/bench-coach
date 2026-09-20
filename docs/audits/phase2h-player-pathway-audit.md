# Phase 2H — player pathway tracking: implementation note

Written before any code changed, per the brief's §23. Everything below was read
out of the repository or queried read-only against production, not recalled.

---

## 1. What already exists

### The pathway layer is canonical and complete as curriculum

Migrations 069–071 are applied in production. Seven published pathways, all
`version = 1`:

| slug | skill_category | ages |
|---|---|---|
| `build-the-swing` | hitting | 6–14 |
| `throwing-development` | throwing | 6–14 |
| `infield-fundamentals` | fielding | 6–14 |
| `outfield-development` | fielding | 7–16 |
| `pitching-development` | pitching | 7–14 |
| `catching-development` | catching | 8–16 |
| `baserunning-development` | baserunning | 6–15 |

`lib/developmentPathways.ts` (728 lines) already exports everything the new
surfaces need: `loadPathway`, `orderedStages`, `nextStage`, `previousStage`,
`stageByKey`, `isFinalStage`, `stageCandidates`, `rankStageDrills`,
`sequenceStage`, `getPathwayPracticeRecommendation`, `planPracticeBlock`.
`lib/pathwayUi.ts` holds the presentation rules and `PathwayPicker` renders
them. **None of this needs to change.**

### A generic measurement model already exists — and it already solves §21

This is the single most important audit finding. `metric_types` +
`player_metrics` (migrations 000/019) are a curated, coach-extensible
measurement system that nothing in this brief needs to replace:

```
metric_types(slug, label, unit, shape, direction, default_attempts, hint, sort_order)
player_metrics(player_id, team_id, coach_id, metric_type_id, value, unit,
               measured_on, attempts, successes, source, note)
```

`direction` is `'higher' | 'lower'` and migration 019's own comment says why it
exists: *"home-to-first improving means the number goes DOWN, and every trend
read is backwards without it."* §21 of this brief asks for exactly that
behaviour and it is already built, already charted by `components/PlayerMetrics.tsx`,
and already has a "no trend line under three sessions" rule in `lib/metrics.ts`
(`MIN_SESSIONS_FOR_TREND`) that directly answers §21's *"do not add celebratory
'improved!' language if the difference could simply be timing noise."*

`home_to_first` is **already a seeded system preset**. Three of the brief's four
speed benchmarks are missing and are one `INSERT ... ON CONFLICT` away.

### Authorization

`bc_team_role(team)` resolves a caller to `owner | admin | contributor | viewer`
from `teams.coach_id` and `team_members` **and nothing else**. League
membership grants no team role. §19's requirement that *"league admins do NOT
automatically gain player-level access"* is therefore satisfied for free by
using the existing helper — no special-casing needed, and none should be added.

`lib/authz.ts` maps capabilities to roles: `read/ask → viewer`,
`record → contributor`, `decide → admin`, `own → owner`, with a stated
philosophy this feature should follow exactly:

> A contributor … can write down what HAPPENED. They cannot decide what happens
> NEXT — priorities, the roster … Those are the head coach's, because they
> redirect a kid's development.

Advancing a player through a curriculum **is** redirecting their development.
So: reading progress is `viewer`, logging a session or a measurement is
`contributor` (a record of what happened), and enrolling, advancing, regressing
or completing is `decide`/`admin`.

### Practice Plan handoff has a precedent

`app/dashboard/practice/page.tsx` already reads `?drill=` (the 2D Drill Finder
handoff), `?focus=`, `?prompt=` and `?plan=`. `choosePathway(slug)` already
exists and already loads stages and adds the implied focus chip. §14's handoff
is a query-string preset over machinery that is already there.

---

## 2. What should be reused

| Need | Reuse | Instead of |
|---|---|---|
| Measurement storage, units, direction, charting, trend rules | `metric_types` + `player_metrics` + `lib/metrics.ts` + `PlayerMetrics.tsx` | a new `player_measurements` table |
| The four speed benchmarks | 3 new rows in `metric_types` (`home_to_first` exists) | new schema |
| Curriculum, stages, drills, roles, recommendation | `development_pathway*` + `lib/developmentPathways.ts` | a second pathway system |
| Drill → practice recommendation | `getPathwayPracticeRecommendation()` | a second recommender |
| Stage picker + stage navigation UI | `PathwayPicker`, `lib/pathwayUi.ts` | a second picker |
| Team authorization, both layers | `bc_team_at_least()` in RLS, `authorizeTeam()` in routes | bespoke checks |
| Analytics | `lib/tracking.ts` `useTracker()` | a second event pipeline |
| Practice handoff | `?pathway=&stage=` + existing `choosePathway()` | a second generator |

---

## 3. What is genuinely missing

1. **Player enrollment state.** Nothing anywhere records that a player is on a
   pathway. This is the whole gap.
2. **History.** §9 is right that `current_stage = 4` cannot answer how they got
   there.
3. **Three metric presets** — `sprint_10y`, `sprint_20y`, `broad_jump`.
4. **Speed & Agility curriculum content.** See §5 below — this is larger than
   the brief assumes.
5. **A player-facing development surface.** The player profile has Overview /
   Measurements / History / Reports tabs and no development tab.

---

## 4. Proposed schema (migration 072)

Two tables, not three.

### `player_pathway_progress` — one row per (player, team, pathway)

```
id, player_id → players, team_id → teams, pathway_id → development_pathways,
pathway_version INT NOT NULL,          -- pinned at enrollment (§20)
current_stage_key TEXT NOT NULL,       -- the durable identity (§20)
current_stage_number INT,              -- display only, refreshed on read
status TEXT CHECK (active|paused|completed),
started_at, stage_started_at, completed_at,
created_by UUID → auth.users, created_at, updated_at
UNIQUE (player_id, team_id, pathway_id) WHERE status <> 'completed'
```

**Why `stage_key` and not `stage_id`.** The brief answers this itself: *"Stage
keys are intended to survive renumbering. Use that fact."* A stage row can be
dropped and re-created by a future content migration, which changes its `id`;
`(pathway_id, stage_key)` is `UNIQUE` in 069 and is the identity that survives.
`current_stage_number` is carried alongside for cheap ordering but is treated as
a cache, never as truth.

**Multiple simultaneous pathways** fall out of the partial unique index: a
player may hold one active row per pathway and as many pathways as they like,
which is §8's requirement.

### `player_pathway_events` — append-only history, including sessions

```
id, progress_id → player_pathway_progress ON DELETE CASCADE,
team_id (denormalised, so RLS never joins),
event_type TEXT CHECK (enrolled|session_logged|mastery_recorded|
                       advanced|regressed|completed|paused|resumed),
stage_key TEXT, stage_number INT,      -- snapshot of where this happened
from_stage_key TEXT, to_stage_key TEXT,-- set on advanced/regressed
detail JSONB NOT NULL DEFAULT '{}',    -- signals[], drill_ids[], minutes
note TEXT,
actor_user_id UUID → auth.users,       -- WHO advanced them (§9)
occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
created_at
```

**Why sessions are events rather than a third table.** §13 asks for
"6 sessions completed" and "3 sessions at this stage". Both are counts of
`session_logged` events, the second filtered by `stage_key`. A separate session
table would need its own history semantics and would split "what happened to
this player" across two places. §9 already demands a reconstructable timeline;
a session is a thing that happened.

**Why `plan_session_log` is not reused.** Its `prescription_id` is `NOT NULL`
with an `ON DELETE CASCADE` to `prescriptions`, and its uniqueness key is
`(prescription_id, session_key, completed_on)`. Reusing it means either
inventing a prescription row per enrollment or making the FK nullable and
breaking its own ownership model. The brief's instruction is explicit: *"Do NOT
create semantic confusion simply to avoid a new table."* It does not fit.

**Why mastery signals are stored as text, not indexes.** A `mastery_recorded`
event stores the signal strings the coach actually saw and ticked. An index into
`mastery_signals[]` becomes a lie the moment the canonical array is reordered,
which is precisely the failure §20 warns about. The canonical stage is never
mutated — §12's requirement — because observations live only on the event.

### RLS — and a defect found while reading it

New policies use `bc_team_at_least(team_id, …)` with the **real role
vocabulary**:

| action | role required |
|---|---|
| SELECT progress / events | `viewer` |
| INSERT `session_logged`, `mastery_recorded` | `contributor` |
| enroll, advance, regress, complete, pause | `admin` |

> ### ⚠️ Pre-existing defect, NOT introduced here and NOT fixed here
>
> `bc_rank()` knows only `owner|admin|contributor|viewer` and returns `-1` for
> anything else. **105 existing policy clauses pass the *capability* names
> `'record'` and `'decide'` into it** — words from `lib/authz.ts`, not roles.
> Verified read-only against production:
>
> ```
> bc_rank('record') = -1   bc_rank('decide') = -1   bc_rank(NULL) = -1
> bc_rank(NULL) >= bc_rank('record')  →  TRUE
> ```
>
> So `bc_team_at_least(team_id, 'record')` is **true for every caller,
> including an unauthenticated one**. Tables whose only guard is such a policy
> are not protected by RLS at all — `player_notes` INSERT/UPDATE/DELETE among
> them.
>
> This is out of scope for 2H (§17-style "do not touch unrelated RLS", and
> fixing 105 policies is its own reviewed change), but it is a **P0 security
> finding** and is reported in the closeout. The new tables deliberately do not
> reproduce it. Note that the API routes are *not* affected — `lib/authz.ts`
> does its own correct check — so the exposure is limited to paths that write
> with the browser client.

---

## 5. Speed & Agility content — bigger than the brief assumes

§16 asks me to audit the drill library first. I did, over all 226 curated rows.
The library is a **baseball skill** library, not a movement library:

```
  59 Hitting        24 Fielding (Infield)    8 Team Defense     2 Athletic Development
  36 Throwing       17 Baserunning           5 Bunting          2 Warmup
  35 Pitching       15 Fielding (Fly Balls)  5 Arm Care
  14 Catching        4 Soft Toss
```

Both `Athletic Development` rows are, in full: *Baseball Dynamic Stretches for
Youth Players* (a mobility warm-up) and *Base Running Athletic Circuit* (a timed
bases circuit — genuinely about acceleration, deceleration and change of
direction, and reusable).

Against §16's 23 requested activities:

| Already curated — reuse | Genuine gap — create |
|---|---|
| Home-to-first start → *Fastest Technique Running Out of the Box*, *Swing and Sprint* | A-March, A-Skip |
| Steal / crossover start → *Steal Breaks — Reading the Pitcher & First Move* | Wall Drive, Falling Start |
| Outfield drop step → *Outfield Drop Step Drill*, *Ready and Go — Outfield First Step* | 5 / 10 / 20-yard sprint |
| Infield first-step reaction → *Ready and Go*, *Pick Your Hop*, *Four Cones Ground Ball Drill* | Pogo jumps, lateral pogos, jump rope, broad jump |
| Progressive acceleration (partly) → *Base Running Athletic Circuit* | Sprint + stick, snap down |
| Lateral movement (partly) → *Cross-Shuffle Drill* (infield-specific) | Shuffle → sprint, shuffle → crossover, 45° cut |
| | Tennis-ball drop, mirror drill |

So **stages 8 and 9 (baseball transfer) are already covered by existing drills**
— which is the pleasing result, since those are the stages that justify the
pathway living in a baseball product at all. **Stages 1–7 are a real content
gap** and need roughly 16 new canonical drills, written to the Phase 2C
instruction conventions.

Pathway category: **`athleticism`**. It is already in the `FocusArea` union,
already a practice-plan focus chip, and `lib/focusAreas.ts` already maps
`'athletic development'` and `'warmup'` onto it. No new category is invented,
per §6.

---

## 6. Proposed UX

- **Player profile** gains a **Development** tab beside Overview / Measurements
  / History / Reports. No new top-level navigation, per §11.
- **`/dashboard/roster/[playerId]/development/[progressId]`** — the detail page:
  stage heading, objective, why it matters, mastery-signal checkboxes, this
  stage's drills via `getPathwayPracticeRecommendation`, baseline-vs-latest
  measurements, and the coach decision row.
- **Coach decision** renders *Keep working* / *Advance to Stage N — <name>* /
  *Go back to Stage N − 1*, with the destination named before confirmation.
  On the final stage, advance becomes **Complete pathway**. No button can leave
  the sequence.
- **Add to practice** deep-links to `/dashboard/practice?teamId=…&pathway=<slug>&stage=<n>`.

Language follows §28: *Working on*, *What good looks like*, *Drills for this
stage*, *Record today's work*. No mesocycles.

---

## 7. Risks

1. **Content volume.** 16 new drills is the largest single content addition
   since Phase 2C. Each needs setup, cues, reps, rest, mistakes, regression,
   progression, equipment, space — and must pass the schedulable and duplicate
   rules. Mitigation: write them to the existing conventions and run
   `test:schedulable` / `test:duplicates` / `audit:instructions` before
   applying.
2. **`practice_roles` CHECK.** Phase 2F lost an apply to this: the enum is
   `warmup, teach, isolate, repetition, progress, decision, competition,
   game_application, team_execution, assessment, finish`. `prepare` is **not**
   valid. The local migration stub now carries the real CHECK constraints and
   must be used before any production apply.
3. **Versioning.** Every pathway is `v1` today, so the version-pinning code
   cannot be exercised by real data. Mitigation: unit-test the stale-stage path
   directly rather than assuming it.
4. **Stale verifier.** Phase 2F shipped `pathways.length === 4`, which passed
   while the deployment was incomplete. New verifiers assert structural
   invariants and *print* counts.
5. **Measurement noise.** Four sprint readings on a 9-year-old with a stopwatch
   are not science. The UI shows baseline / previous / latest and the delta, and
   says nothing about whether it is meaningful — §21's instruction, and already
   the house position in `lib/metrics.ts`.
6. **Live browser verification.** This environment cannot reach
   `mybenchcoach.com` (403 CONNECT) and Vercel aliases sit behind SSO. Any
   claim of pixel verification would be false; the closeout will say what was
   and was not verified.
