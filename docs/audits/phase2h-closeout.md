# Phase 2H — Player Pathway Tracking + 9U Speed & Agility

## 1. Verdict

**COMPLETE**, with one caveat stated plainly below.

Built, tested, pushed, and **all three migrations are applied to production and
verified against it**. A coach can enrol a player in any of eight pathways —
including 9U Speed & Agility — see the current stage, run the drills, record
sessions and measurements, assess mastery, and deliberately advance or regress.

**The caveat: nothing was verified in a browser.** This environment cannot reach
the production domain (403 CONNECT) and the Vercel aliases sit behind SSO. Every
claim below is from automated verification against the live database and from
test suites, not from looking at the app. That distinction is kept throughout.

## 2. Git

| | |
|---|---|
| Starting HEAD | `87f645a` (Phase 2G, deployed) |
| Final commit | `634c36e` |
| Branch | `claude/latest-code-updates-0vrxpr` (pushed) |
| PR | None — not requested |

Three commits:

- `c254224` — migrations 072/073/074, the fixture, the emitter, the migration test
- `5ce9584` — library, API routes, player profile tab, detail page, practice handoff
- `634c36e` — `authorizeProgress` guard, analytics note

## 3. Architecture

### Reused, not rebuilt

| Need | What was reused |
|---|---|
| Measurement storage, units, direction, charting, "no trend under 3 sessions" | `metric_types` + `player_metrics` + `lib/metrics.ts` + `/api/metrics` |
| Curriculum, stages, roles, recommendation | `development_pathway*`, `lib/developmentPathways.ts` |
| This stage's drills | `getPathwayPracticeRecommendation()` — the same call the practice planner makes |
| Pathway listing in the enroll picker | `loadPathways()` |
| Team authorization, both layers | `bc_team_at_least()` in RLS, `lib/authz.ts` in routes |
| Analytics | `lib/tracking.ts` |
| Practice handoff | `?pathway=&stage=` into the existing `choosePathway()` |

**The measurement finding is the one that changed the shape of this phase.** The
brief proposed a measurement model. One already existed, with the exact column
that makes speed data legible — `direction`, `'higher' | 'lower'` — and
migration 019's own header says why it exists. `home_to_first` was already a
seeded preset. So Phase 2H adds **three rows to a lookup table** where it could
have added a table, a route, a chart and a trend function.

### New

- `player_pathway_progress`, `player_pathway_events` (migration 072)
- `lib/playerPathways.ts` — pure decision rules
- `/api/player-pathways`, `/api/player-pathways/[progressId]`, `.../events`
- `authorizeProgress()` in `lib/authz.ts`
- `components/PlayerDevelopment.tsx`, `/dashboard/roster/[playerId]/development/[progressId]`
- 19 canonical movement drills + the Speed & Agility pathway (migration 074)

### Why there is no duplication

No second pathway system, no second recommender, no second practice generator,
no second measurement model, no second analytics pipeline. The one genuinely new
concept is *player state*, which did not exist anywhere — 069 says in its own
header that the pathway layer "stores no player state", and that line still
holds: the curriculum tables are untouched and still know nothing about players.

## 4. Database

### Migration 072 — `player_pathway_progress`, `player_pathway_events` ✅ **APPLIED**

**Tables**

`player_pathway_progress`: `id`, `player_id`, `team_id`, `pathway_id`,
`pathway_version`, `current_stage_key`, `current_stage_number`, `status`
(`active|paused|completed`), `started_at`, `stage_started_at`, `completed_at`,
`created_by`, timestamps.

`player_pathway_events`: `id`, `progress_id`, `team_id`, `event_type`
(8 values), `stage_key`, `stage_number`, `from_stage_key`, `to_stage_key`,
`detail` JSONB, `note`, `actor_user_id`, `occurred_on`, `created_at`.

**Two design decisions worth stating**

*The stage pointer is a `stage_key`, not a `stage_id`.* 069 makes
`(pathway_id, stage_key)` unique and stable across renumbering. A stage **row**
can be dropped and recreated by a content migration, which changes its id; the
key survives. `current_stage_number` is carried alongside as a display cache and
is never what advancement is computed from.

*Sessions are events, not a third table.* "6 sessions completed" is a count of
`session_logged`; "3 at this stage" is the same count filtered by `stage_key`.
`plan_session_log` was considered and rejected — its `prescription_id` is
`NOT NULL` and cascades from `prescriptions`, so reuse meant fabricating a
prescription per enrollment or breaking its ownership model.

**Indexes**: `uniq_player_pathway_live` (partial unique on
`player_id, team_id, pathway_id WHERE status <> 'completed'`),
`idx_player_pathway_progress_player`, `..._team`,
`idx_player_pathway_events_progress`, `idx_player_pathway_events_stage`.

**Constraints**: `completed` status and `completed_at` must agree;
`advanced`/`regressed` must carry both `from_stage_key` and `to_stage_key`.

**Triggers**: `bc_player_pathway_event_team()` overwrites the denormalised
`team_id` on every event insert with the enrollment's own, so a writer cannot
file an event under a team they are on while pointing at another team's row.
`bc_touch_player_pathway_progress()` maintains `updated_at`.

**RLS**

| Action | Role |
|---|---|
| SELECT progress / events | `viewer` |
| INSERT event (`session_logged`, `mastery_recorded`) | `contributor` |
| INSERT / UPDATE / DELETE progress | `admin` |
| UPDATE event | **no policy at all** — history is append-only |

`UPDATE` on progress carries both `USING` and `WITH CHECK`, so a row cannot be
moved onto a team the caller does not administer. **No grant to `anon`.**

### Migration 073 — speed metric presets ✅ **APPLIED**

Adds `sprint_10y`, `sprint_20y`, `broad_jump` to `metric_types`. Guarded on
`NOT EXISTS` rather than `ON CONFLICT`, because the unique index is
`(coach_id, slug)` and `coach_id` is `NULL` for a system preset — Postgres
treats NULLs as distinct, so `ON CONFLICT` never fires. **That is a latent
re-run hazard in migration 019 itself**: a second run of 019 would silently
duplicate all eight presets. Production has one of each, so 019 has only ever
been applied once. 073 does not inherit the hazard.

### Migration 074 — Speed & Agility ✅ **APPLIED**

19 new `drill_resources` rows, 1 pathway, 10 stages, 44 stage-drill links,
3 `drill_problem_map` rows. Zero existing rows modified or deleted. Generated by
`scripts/emit-speed-pathway.ts`; idempotent via `ON CONFLICT (id) DO NOTHING`
with UUIDv5 ids derived from drill names, and a delete-by-slug for the pathway.

## 5. Speed & Agility pathway

**10 stages**, `skill_category = 'athleticism'` (an existing `FocusArea` — no
new category invented), ages 8–12.

| # | Stage | Drills | New | Reused |
|---|---|---|---|---|
| 1 | Baseline & Running Mechanics | 6 | 5 | 1 |
| 2 | Acceleration Position | 4 | 4 | 0 |
| 3 | First-Step Explosion | 4 | 3 | 1 |
| 4 | Elasticity & Quick Ground Contact | 4 | 4 | 0 |
| 5 | Deceleration | 3 | 3 | 0 |
| 6 | Change of Direction | 4 | 3 | 1 |
| 7 | Reactive Agility | 4 | 3 | 1 |
| 8 | Baseball Acceleration | 5 | **0** | **5** |
| 9 | Position-Specific Speed | 5 | **0** | **5** |
| 10 | Game-Speed Integration & Retest | 5 | 4 | 1 |

**19 created, 14 existing reused, 44 links. No stage is THIN** (all have ≥3
drills and ≥1 primary).

### The content finding

§16 asked me to audit the library before creating anything. I read all 226
curated rows. **The library is a baseball-skill library and holds almost no
movement content**: two rows under `Athletic Development`, one of which is a
stretching routine. No A-march, no wall drive, no pogo, no snap-down, no cut, no
reactive start anywhere in it.

So stages 1–7 are a genuine coverage gap and needed new drills. **Stages 8 and 9
needed none** — *Swing and Sprint*, *Steal Breaks*, *Outfield Drop Step*,
*Ready and Go*, *Pick Your Hop*, *Four Cones*, *Three-Ball Slow Roller*,
*On the Run* were all already curated. That is the result that matters: the
transfer stages, the ones that make this a baseball pathway rather than a
fitness app, are built entirely from what the library already had.

### Media gaps

**No media is attached to any of the 19 new drills, and none was invented.**
Every one carries setup, coaching cue, reps, rest, success markers, common
mistakes, regression, progression, equipment and space in text, and the emitter
refuses to write the file if any field contains a URL. The pathway works with
video absent. Nineteen movement drills with no verified media is the standing
curation gap this phase leaves behind.

### Deliberate content decisions

- Lateral pogos are the **progression inside** Pogo Jumps, not a separate drill;
  same for the 5-yard sprint inside Ten-Yard Acceleration. Fewer, better rows.
- Every rep guidance is short with long rest. "Train speed while fresh" is
  enforced in the text of every drill, because a youth coach converts a speed
  session into a conditioning session by accident constantly.
- Stage 5 (Deceleration) comes **before** Stage 6 (Change of Direction). A cut is
  a stop with an exit attached, and a player who cannot stop cannot safely turn.
- Only 3 taxonomy mappings, all to `slow-first-step`. A drill mapped to a problem
  it half-answers makes retrieval worse for the problem.

## 6. Player tracking

**Enrollment** — `POST /api/player-pathways` with `{teamId, playerId,
pathwaySlug}`, capability `decide`. Verifies the player is on *that* team (the
team check alone only proves the caller administers the team they named),
verifies the pathway is published and has stages, pins `pathway_version`, sets
`current_stage_key` to stage 1, writes an `enrolled` event. An existing live
enrollment returns that plan rather than racing the unique index.

**Current stage** — `resolveStage()` looks the key up in the loaded pathway and
returns one of four answers: the stage, `no_pathway`, `no_stages`, or
**`stage_gone`**. That last one is the version-drift case: if a re-curated
pathway no longer has the key, the coach is told the pathway changed and their
history is kept, rather than being silently moved to stage 1.

**Advancement / regression** — `POST .../events` with `kind: 'advance'|'regress'`
and the `toStageKey` the client believes it is moving to, capability `decide`.
`validateMove()` runs server-side (a hidden button is not a rule), refuses if the
client's target disagrees with the pathway, and the `UPDATE` is conditional on
the stage and status it validated against — so two coaches advancing at once
cannot skip a stage. `stage_started_at` resets in both directions. An
`advanced`/`regressed` event records from, to, and **who**.

**Completion** — only from the final stage, where the advance button *becomes*
Complete pathway rather than sitting beside it. Sets `status='completed'` and
`completed_at` (the CHECK constraint makes them agree). The partial unique index
then allows the pathway to be started again, and the first run's history stays.

**History** — every event, append-only, no UPDATE policy. `describeEvent()`
renders each as a sentence naming stages, never people.

**Mastery observations** — the signal **text** is stored, filtered against the
stage's canonical list server-side. The most recent `mastery_recorded` event
wins, so unticking sticks. The canonical stage is never mutated.

**Nothing advances a player except a human pressing a button.** There is no model
anywhere in this feature.

## 7. Measurements

**Schema**: `metric_types` + `player_metrics`, unchanged from migration 019.

**Metrics**: `sprint_10y` (sec, lower), `sprint_20y` (sec, lower),
`home_to_first` (sec, lower — pre-existing), `broad_jump` (in, higher).

**Units** are stored as the coach enters them, in the metric's own unit. Seconds
for times, inches for the jump — what a youth coach's stopwatch and tape read.

**Comparison behaviour** — `summariseMeasurement()` returns baseline (first
reading), previous (second-newest), latest, and `change = latest − baseline`
**keeping its real sign**, so a sprint time that fell renders `-0.11 sec`.
Whether that direction is the better one is `towardBetter`, computed from the
`direction` column, and it only colours an arrow.

Three things it deliberately will not do: with one reading there is **no change
at all** rather than a comparison against itself; a zero change is not called an
improvement; and no celebratory language anywhere. A hand-held stopwatch is not
accurate to a hundredth of a second and a child who grew two inches mid-season
can move better and time slower.

## 8. UI

**Added**

- `components/PlayerDevelopment.tsx` — the Development tab
- `app/dashboard/roster/[playerId]/development/[progressId]/page.tsx`
- `app/api/player-pathways/route.ts` (GET, POST)
- `app/api/player-pathways/[progressId]/route.ts` (GET, DELETE)
- `app/api/player-pathways/[progressId]/events/route.ts` (POST)

**Changed**

- `app/dashboard/roster/[playerId]/page.tsx` — Development tab added
- `app/dashboard/practice/page.tsx` — `?pathway=&stage=` preset
- `lib/authz.ts` — `authorizeProgress()`
- `scripts/verify-authz.mjs` — registered the new guard

The card says **"Stage 3 of 10"** and never a percentage. A curriculum is not a
loading bar and a progress bar would claim a player on stage 3 is 30% of the way
to something.

## 9. Practice Plan integration

`/dashboard/practice?teamId=…&pathway=<slug>&stage=<n>` opens the generate modal
and calls the existing `choosePathway(slug)`, then sets the stage. That function
already loads the stages, adds the implied focus chip and handles the failure
states; reimplementing it would be a second way for the two to disagree.

**Suggested, not forced.** It preselects the picker and stops. The coach still
presses Generate, can move the stage, and can clear the pathway. One player's
plan does not silently become the whole team's practice. No second generator.

## 10. Tests

| Command | Result |
|---|---|
| `npm run test:migration-2h` | **42 checks, all passing** (real PostgreSQL 16) |
| `npm run test:player-pathways` | **84 passed, 0 failed** |
| `npm run test:pathways` | 96 passed, 0 failed |
| `npm run test:pathway-ui` | 60 passed, 0 failed |
| `npm run test:drill-finder` | 114 passed, 0 failed |
| `npm run test:drill-library` | ALL PASS (206 drills, 13 categories) |
| `npm run test:duplicates` | pass |
| `npm run test:player-report` | pass |
| `npm run test:progression` | pass |
| `npm run test:schedulable` | pass |
| `npm run test:league-entitlements` | pass |
| `npm run verify:league-privacy` | pass |
| `npm run verify:authz` | **68 route files (10 exempt) — every handler authorizes its caller** |
| `npm run typecheck:baseline` | **196 — unmoved** |
| `npm run build` | compiled successfully |
| `npm run verify:player-pathways-prod` | **12 of 13 pass against live production**; the one failure is the missing pathway (074) |
| `npm run verify:speed-drills` | correctly reports all 19 drills absent — 074 not applied |

`npm run lint` is **not configured** in this repo and was not run. No existing
test was weakened.

**What `test:migration-2h` actually proves**, since it is the security surface:
a contributor may log a session and may **not** advance a player; a viewer may
read and may not write; an outside coach reads nothing and writes nothing; an
admin may advance but may **not** move an enrollment onto another team; `anon`
holds no grant at all; a forged `team_id` on an event is overwritten; and no new
policy uses a capability word where a role belongs.

One test was wrong when first written and is worth recording: an `UPDATE` blocked
by RLS **does not raise** — the `USING` clause filters the row out and the
statement succeeds having changed nothing. Testing for an error would have
passed while proving nothing. Those checks now assert the stage key afterwards.

## 11. Production readiness

| | |
|---|---|
| **Implemented** | All of sections 4–9 |
| **Migrated locally** | 072, 073, 074 — applied to real PostgreSQL 16, 42 checks |
| **Migrated staging** | n/a — no staging database exists |
| **Migrated production** | **072, 073 and 074 — all applied and verified** |
| **Browser verified** | **NOTHING** |

Live production state, read back after applying:

```
072 tables   : APPLIED — anon reads 0 enrollments, 0 events
073 presets  : 4/4  home_to_first · sprint_10y · sprint_20y · broad_jump
               directions correct (3 lower, 1 higher), no duplicates
074 pathway  : APPLIED — 10 stages, 44 stage-drill links, 6 problem links
published pathways 8   ·   stages 80   ·   links 272
movement drills 21     ·   curated drills 245
```

### How 074 was applied, and why it needed care

Two things made this migration awkward, and both are worth recording.

First, the Supabase MCP tool went into an approval blackout partway through —
the same failure Phase 2F hit — where every call, including a `SELECT count(*)`,
returns `requires approval`. It recovered on its own.

Second, 074 is 82KB, almost all of it curated coaching prose, and the apply tool
takes SQL as an inline argument rather than a file path. Applying it meant
reproducing nineteen long drill descriptions into tool calls, and a drifted word
inside a coaching cue would be permanent, invisible in any diff of this repo,
and sitting in front of a coach as though somebody had curated it.

So it was applied in **eight verified chunks** rather than typed out in one go:

1. The 19 drills in five batches, then `verify:speed-drills` — which compares
   **every field of every drill** against `scripts/fixtures/speed-agility.ts`
   and fails naming the drill and the field. **PASS: all 19 match exactly.**
2. The stages and links were **not** retyped at all. They were mechanically
   extracted from the generated migration into a compact `INSERT … SELECT FROM
   (VALUES …)` form, and that form was proved equivalent by applying both the
   original and the compact version to separate local PostgreSQL databases and
   diffing the resulting rows: **10 stages IDENTICAL, 44 stage-drill links
   IDENTICAL, 6 stage-problem links IDENTICAL.**

The checks that closed the loop, all green against live production:

```
npm run verify:speed-drills          PASS — all 19 drills match the fixture exactly
npm run verify:player-pathways-prod  PASS — 22 checks
npm run verify:pathway-ui-prod       PASS — 8 pathways, 80 stages, 272 links
```

Worth noting that `verify:pathway-ui-prod` — written in Phase 2G *after* the
stale `pathways.length === 4` failure — passed unchanged as the library grew
from 7 pathways to 8 and from 228 links to 272. Structural invariants instead
of snapshot counts is the reason it did not have to be edited.

### Browser verification

I cannot do it. This environment gets 403 CONNECT to `mybenchcoach.com` and the
Vercel aliases sit behind Vercel SSO. **No claim of live verification is made.**
Once 073 and 074 are applied and the branch is deployed, the flow to walk is the
brief's own §30 acceptance test, and the steps most worth watching are 5
(recording four measurements), 9 (advancing, and confirming the next stage is
named before you confirm) and 13 (the practice builder opening with the pathway
and stage preselected).

## 12. Remaining gaps

1. **No browser verification.** Environment-limited, and the only thing between
   this and "verified end to end".
3. **19 movement drills have no media.** Deliberate — nothing was invented — and
   the largest curation debt this phase creates.
4. **Version drift is untested against real data.** Every production pathway is
   `v1`, so the `stage_gone` path can only be exercised by unit test. It is,
   thoroughly, because it cannot be exercised any other way.
5. **No advancement suggestion.** The brief allows AI to *assist*. Nothing does
   yet; the coach reads the signals and decides. That was the right place to stop
   for a first version, but it is a gap against §4.
6. **`plan_session_log` and `prescriptions.development_plan` are untouched.**
   They coexist as intended, with no bridge between them.
7. **Pre-existing, carried forward:** production `service_role` rotation (P0);
   `verify:video-links` red on `components/PlayerReview.tsx:67`; the
   space/Full Field asymmetry deferred from 2G.

---

> ## ⚠️ 13. P0 SECURITY FINDING — pre-existing, not introduced, not fixed here
>
> Found while reading RLS patterns to copy them. **Reported, not acted on.**
>
> `bc_rank()` understands `owner | admin | contributor | viewer` and returns
> `-1` for anything else. **105 policy clauses in this schema pass `'record'` or
> `'decide'`** — which are `lib/authz.ts` *capability* names, not roles.
> Verified read-only against production:
>
> ```
> bc_rank('record') = -1   bc_rank('decide') = -1   bc_rank(NULL) = -1
> bc_rank(NULL) >= bc_rank('record')  →  TRUE
> ```
>
> So `bc_team_at_least(team_id, 'record')` is **true for every caller, including
> an unauthenticated one**. Any table whose only guard for an operation is such a
> clause is not protected by RLS for that operation — `player_notes`
> INSERT/UPDATE/DELETE among them.
>
> **Scope of exposure.** The API routes are *not* affected: `lib/authz.ts` does
> its own correct check with the real role vocabulary. The exposure is on paths
> that write with the **browser Supabase client**, where RLS is the only
> enforcement. Several player-profile writes do exactly that.
>
> **Why it was not fixed here.** Rewriting 105 policy clauses is its own change
> with its own blast radius, it needs a per-table review of what each one *meant*
> to allow, and doing it as a side effect of a feature phase is how a security
> fix ships unreviewed. The Phase 2H tables deliberately do not reproduce it, and
> `test:migration-2h` asserts both that the defect is real and that no new policy
> repeats it.
>
> **Recommended fix**, for a change of its own: teach `bc_rank()` the capability
> names by mapping them onto the roles `lib/authz.ts` already maps them to —
> `record → 1`, `decide → 2` — which repairs all 105 clauses at once without
> touching a single policy, then audit the handful of policies whose intent that
> changes.

## 14. Recommendation — the single best next step

**Deploy the branch, and put one real player on the Speed & Agility pathway
yourself — before building anything else.**

Not because the code is unproven; because the *curriculum* is. The schema is
tested 42 ways and the rules 84 ways, but the thing that decides whether this
feature is good is whether stage 3 of Speed & Agility is genuinely the right
thing to work on after stage 2 — and no test can tell you that. Ten stages of
sequencing written in one session need one coach running them with one kid
before they get a second feature built on top.

The second-best next step, and the one I would explicitly **not** take yet, is
AI-assisted advancement suggestions. It is the obvious extension and the brief
allows it. But suggesting "Charlie looks ready for stage 4" on top of a sequence
nobody has run, from session counts a coach may or may not be logging, would be
confidence the system has not earned. Watch whether coaches advance players at
all first — the analytics note's question 2 — because if they never do, a
suggestion has nothing to attach to, and if they do it freely, they may not need
one.

**And separately from this feature: the `bc_rank` finding above is a bigger deal
than anything in Phase 2H.** It should be scheduled on its own.
