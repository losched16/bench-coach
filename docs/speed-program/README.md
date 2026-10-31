# Speed, Agility & Explosiveness program

A reusable, coach-led program a coach assigns to a player: one template, three
levels, three session types, four weeks. It sits on top of the existing speed
pathway (migrations 069-074) and does not change it.

**Status: built and tested; not launched.** It is off unless `SPEED_PROGRAM=1`
is set on the server. Nothing here claims real-user use, coach feedback, video
review or measured outcomes. See "Before it is turned on".

## What a coach gets

- **Assign** a player a level (Foundation, Development or Advanced youth). Age
  bands are advisory text only and never gate anything. The coach picks the
  level and the sessions per week. Games and hard practices count toward the
  "up to three quality high-intensity exposures a week" guardrail, so the
  suggestion drops as they rise; choosing more than that warns, it does not block.
- **Run** three sessions (A first-step acceleration, B lateral agility and change
  of direction, C jumps, landing and baseball reaction) across four weeks:
  Learn, Build, Transfer, Integrate and assess. Sets, reps, rest, cues and the
  indoor substitutes for the Development level are the source specification's
  own numbers, pinned by `scripts/test-speed-program.ts`.
- **Log** each session: sets and reps done, completed or skipped (with a reason),
  fatigue, effort, observed **landing / braking / reaction scored 0-2** (blank
  means "not observed", never zero), the cue that worked, adjustments, pain.
- **Advance** only with evidence: two completed sessions since the last advance
  with every recorded score at 2, no high fatigue, and the required kinds
  observed. A coach may **override** with a written reason (recorded with their
  name). **Pain at the most recent session blocks every advance and cannot be
  overridden.** One harder step per week; no stacking.
- **Adjust** the plan for a player (sets, reps, notes, remove an exercise from one
  session, remove or replace a video reference). Adjustments are events applied
  on top of the snapshot; the snapshot is never edited.
- **Baseline and retest** (optional): a 0-2 movement-quality rubric at any level,
  or a timed 10-yard sprint / home-to-first (Development and Advanced, outdoors
  or on a field only). A retest is compared **only** when the surface, timing
  method, start type, location and distance match, and the result is a number
  with no verdict. Nothing is ever shown as "progress" without two comparable
  results.

## Indoor 20x15 ft

Allowed: short controlled footwork, jumps, brakes, short reactions. The 10-yard
acceleration and the falling start are replaced by short controlled takeoffs
(the first uses the specification's text; see decisions). Timed sprints and
home-to-first are not offered indoors. The optional broad-jump-into-sprint is
outdoor only.

## Architecture

| Piece | Where |
| --- | --- |
| Template data (three levels, exercises, weeks, progressions, guardrails) | `lib/speedProgram/template.ts` |
| Pure rules (intake, schedule, adjustments, effective plan, session validation, eligibility, advance, assessments) | `lib/speedProgram/rules.ts` |
| Flag, scope, state assembly | `lib/speedProgram/server.ts` |
| API | `app/api/speed-program/**` (list/assign; one program; sessions; assessments; advance) |
| Coach UI | `app/dashboard/roster/[playerId]/speed-program` + `components/speed-program/*` |
| Entry point | a card on the player's Development tab, rendered only if the API answers |
| Data | `migrations/081_speed_program.sql` (rollback in `migrations/rollback/`) |

Tables: `speed_program_assignments` (the plan snapshot lives here),
`speed_program_sessions`, `speed_program_assessments`, `speed_program_events`
(all three append-only), and `speed_program_exercise_drills` (the mapping).

### The snapshot rule

An assignment stores the entire template (all three levels) as it stood on the
day it was assigned. Editing the template in code never reaches an assigned
player. A database trigger refuses any change to the snapshot, player, team or
template after assignment. Level, week and unlocks change through events that
record who and why.

### History retention

Sessions, assessments and events cannot be updated or deleted by anyone,
service role included (a trigger refuses it). A correction is a new row. The
only deletion path is the cascade from deleting the player or team, a deliberate
privacy deletion. There is no UPDATE or DELETE policy on those tables either.

### Authorization

Role words only (`bc_rank` returns -1 for capability words, so `'record'` and
`'decide'` would silently allow everyone). Read: viewer. Log a session or
assessment: contributor. Assign, adjust, advance: admin. Every handler checks the
flag first, then a session, then the program's own team. The team and player on
child rows are derived from the assignment by a trigger, never trusted from the
request. A caller who cannot read a program gets 404, the same as a missing id;
a team member who can read it but not change it gets 403.

## Exercise to canonical drill mapping

`speed_program_exercise_drills` (and the identical data in `template.ts`, checked
for drift by the unit test). `match` is `exact`, `close`, `partial` or `none`.
The coach page prints the label, and "Closest library drill (not the same
exercise)" for partial matches.

| Exercise | Library drill | Match |
| --- | --- | --- |
| Warm-up | Baseball Dynamic Stretches for Youth Players | partial |
| Wall drive or standing march | Wall Drive — Straight Body, Punch the Knee | exact |
| Falling start | Falling Start — Fall, Then Go | exact |
| 10-yard acceleration | Ten-Yard Acceleration — Push, Push, Push | exact |
| Cone reaction chase | Tennis Ball Drop — See It, Go | close |
| Shuffle and stop | Snap Down — Get Under Control Fast | partial |
| Shuffle, plant, accelerate | Shuffle to Sprint — Open the Hips and Go | close |
| Half-circle cut | Plant and Go — The 45-Degree Cut | partial (gap) |
| Reactive roll, field | Four Cones Ground Ball Drill | partial |
| Pogo jumps | Pogo Jumps — Quick, Quiet Contacts | exact |
| Broad jump and freeze | Broad Jump — Jump and Stick It | exact |
| Skater step and stick | none | none (gap) |
| Infield react and throw | Three-Ball Slow Roller Drill | partial |
| Broad jump into acceleration | Broad Jump — Jump and Stick It | partial |

### Two gaps

No library drill is created by this change. Draft write-ups for the skater step
and the half-circle cut are in `DRILL-DRAFTS.md`, marked as drafts, with no video,
for a coach to review before anything is added to the library.

## Video references

Every reference is an external Instagram link, credited to its creator, shown as
"External reference · not yet reviewed". None is marked verified or approved,
and the code has no path that sets such a status. None is presented as original
BenchCoach content. A coach can remove or replace a reference per player (the
replacement is credited and also unreviewed). Reference links are limited to
https Instagram and YouTube. No video has been manually reviewed.

## Review documents

- `COACH-REVIEW.md` - every dose, progression and safety assumption for Foundation
  and Advanced, with approve boxes. Generated from the template (a test fails if it drifts).
- `DRILL-DRAFTS.md` - the two missing drills, as drafts.
- `INDOOR-FALLING-START.md` - the indoor falling-start substitute and why.
- `COACH-SIGN-OFF.md` - the single packet a coach signs (generated from the template).
- `MOBILE-QA.md` - the real-device checklist; `MOBILE-WALKTHROUGH.md` - the synthetic-data script.
- `RELEASE-READINESS.md` - test evidence, the inherited pitch-counter failures, blockers.
- `scripts/speed-program/verify-prod-readonly.sql` - read-only checks to run in the Supabase SQL editor before and after applying 081.

## Decisions to review

1. **Foundation and Advanced are drafts.** The source specifies Development
   exactly. Foundation (one set, 2-3 reps, no timed or maximal work, low jumps,
   two sessions a week) and Advanced (4-6 quality reps, rest as a floor the coach
   sets) are conservative adaptations, labelled "draft" in the app. Review them.
2. **Indoor falling start.** The source gives an indoor substitute for the
   10-yard acceleration only. The falling start now uses a two-step lean-and-catch
   with a clear run-out (`INDOOR-FALLING-START.md`); the numbers are mine and
   pending approval.
3. **Assessments are stored in their own table, not `player_metrics`.** Migration
   073 says no new measurement table is needed, but `player_metrics` has nowhere
   to store the conditions that make two times comparable. The same metric slugs
   (`sprint_10y`, `home_to_first`) are used, so a later bridge is easy. Nothing is
   written to `player_metrics`.
4. **Migration 074 deletes the speed pathway by slug before re-inserting it.**
   This program does not reference pathway rows, so re-running 074 cannot orphan
   an assignment. The older pathway enrolment table (`player_pathway_progress`)
   does reference it; that is a pre-existing property of 074.
5. **Number 081.** Chosen to avoid the Academy's 080.

## Tests

- `npm run test:speed-program` - template against the source numbers, mapping
  and migration agree, rules, route static checks (flag + session on every
  handler; no write path to history tables or to player measurements).
- `npm run test:migration-081` - Postgres 16: apply twice, snapshot immutability,
  one live program, forged scope overwritten, append-only (service role too),
  validity constraints, override needs a reason, RLS by role and team, anon has
  no grants, role words only, cascade, rollback and re-apply.
- `npm run test:speed-program-e2e` - Chromium through the real login page against
  a fixture backend: assign, exact plan, log, persisted history, advance, pain
  block (UI and API), override needs a reason, indoor substitutes, adjustment
  leaves the snapshot alone, baseline/retest comparability, viewer / contributor
  / outsider, 390px width.

The browser test uses an in-memory stand-in for Supabase, so it proves the
app's behaviour, not production RLS or data. Production RLS is covered by the
Postgres test.

## Before it is turned on

Apply `081_speed_program.sql` (rollback exists and is tested). Set
`SPEED_PROGRAM=1` on a preview deployment first. Then:

- [ ] a coach with a real player walks assign, log, advance, retest on a phone;
- [ ] a coach reviews Foundation and Advanced, the indoor falling start, and the
      two drill drafts;
- [ ] each video reference is reviewed or removed;
- [ ] a viewer and a contributor account are checked against a real team;
- [ ] decide whether to bridge timed results into `player_metrics`.

No coach has done any of this yet. Do not describe the program as live, tested
with users, or effective until they have.
