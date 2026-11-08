# Development Programs and the CoachAI intelligence upgrade

Branch: `feature/coachai-development-programs`. Off by default behind
`NEXT_PUBLIC_DEVELOPMENT_PROGRAMS=on`. Migration `085` is **not applied
anywhere**.

## 1. Audit

**Reusable, reused:** drill library (`drill_resources`, `schedulableDrills`,
eligibility predicates, `stageOf`, `watchUrl`); development pathways
(`player_pathway_progress`/`events`, `loadPathwayContext`); `assembleCoachContext`
(observations, lesson diagnoses, journal, metrics, pathways); `metric_types` +
`player_metrics` + `lib/metrics`; authz (`guard`, `authorizeTeam`,
`authorizePlayer`, roles); `claudeClient`; the `chat_messages.meta` column; the
migration/RLS/`bc_team_at_least` patterns and the shell-based Postgres test
harness.

**Missing:** any multi-week, dated, executable structure (`prescriptions`
holds a 3-week single-problem plan; `plan_session_log` is tied to a
prescription; practice plans are single team sessions); intent routing; a
schema-validated generator; safety rules for independent work and throwing;
assessment protocols; a draft → approval boundary.

**Root cause of the Charlie failure** — several causes that reinforce each other:

1. `CHAT_ADDENDUM` told the model *"If someone asks for a full plan, point them
   at What to Work On… do not reproduce it here"* and *"do not casually
   introduce a competing focus"*. A six-skill, eight-week request was therefore
   deflected by instruction.
2. The playbook block said *"THE PRIORITY WINS"* with no scope limit, so an
   active hitting priority was read as a gate on every other skill (the
   "defer outfield until the hitting drill is mastered" behaviour).
3. There was one behaviour for every message: one model call, free prose, a
   10k-token cap shared with thinking, a 12-drill menu retrieved for the
   *message text* (not per skill/phase), no schema, nothing saveable.
4. No intent detection: a program request and "which glove?" took the same path.
5. Context was good (that is why it knew the October observation) but nothing
   downstream could use it to plan.

## 2. Architecture

```
message ─ classifyIntent ─┬ quick / explain / assessment / team_practice → existing chat, with intent guidance
                          ├ program_edit (draft open) → pure edit ops → updated draft
                          └ program → buildBrief → loadPlayerEvidence (authorised) → composeDraft (deterministic)
                                       → optional model enrichment (text fields only, sanitised)
                                       → repairDraft → validateDraft (16 checks) → development_program_drafts
draft ─ coach edits (record) ─ approve (decide) ─ bc_save_development_program (one txn, idempotent) ─ saved program
saved ─ complete session (record) ─ bc_complete_program_session ─ player_metrics + pathway 'session_logged'
      ─ propose (server computes) ─ revision ─ approve (decide) ─ bc_apply_program_revision (future planned sessions only)
```

* **Completeness is structural, not hoped-for.** `lib/programs/compose.ts`
  builds every week, session, block and drill with no model call. The model
  (`author.ts`) may only fill whitelisted text fields (summary, rationale,
  per-session cue/note, hypotheses). It cannot add/remove/reorder anything,
  links are stripped, outcome promises are dropped. If it is down the program is
  still complete and the coach is told.
* **Library first.** Baseball drills come from `schedulableDrills` filtered by
  age, indoor/outdoor, equipment (cones/markers/tape are treated as
  *substitutable* and the swap is written into the instructions); the same
  anchor drill repeats through a phase and difficulty advances by progression
  stage. Warm-ups, strength/balance work, readiness checks and independent
  routines are **built-in exercises** (`exercises.ts`), never written to
  `drill_resources`; gaps are reported as `curationFlags`.
* **Safety is computed, not trusted.** An independent session is one whose
  every exercise is marked independent in static data; library drills are never
  independent; strength is always supervised; the throwing gate starts closed
  and is cleared only by a coach (checked in the editor); no pitch/velocity
  volume is scheduled while closed. Pitch Smart *game* limits are encoded from
  mlb.com (checked 2026-11-08); it publishes no weekly/practice/annual numbers
  on that page and none are invented.
* **No parallel sources of truth.** Assessments are `player_metrics` rows
  (new nullable `program_id`, `program_session_id`, `checkpoint`,
  `conditions`) using 7 new system `metric_types`. Programs reference existing
  development plans and log into them; they never advance a stage.

## 3. Schema (migration `085_development_programs.sql`)

`development_program_drafts`, `development_programs` (one per draft:
`source_draft_id UNIQUE`), `program_phases`, `program_skills`,
`program_sessions`, `program_session_drills`, `program_session_completions`
(one per session), `program_revisions`; 4 columns on `player_metrics`; 7
`metric_types`; triggers freezing completed sessions and their drills; 4
service-role-only functions. RLS on every table (viewer reads; writes only via
the checked server routes). Additive and idempotent; touches no existing row.

## 4. Roles

| Action | Capability |
|---|---|
| Ask CoachAI / generate a draft | `ask` |
| Edit a draft | `record` |
| Approve & save, clear the throwing gate, reschedule, apply a revision, re-open a completed session | `decide` |
| Complete a session, record measurements | `record` (a helper's completion is unconfirmed until a head coach does it/confirms) |

## 5. Turning it on (needs your approval — not done)

1. Review `migrations/085_development_programs.sql`; apply in the Supabase SQL
   editor to **staging first**; run its verification queries.
2. Set `NEXT_PUBLIC_DEVELOPMENT_PROGRAMS=on` for that environment and redeploy.
3. Smoke test with a real account: generate, review, save, open today, complete.
4. Production: same, after the above.

Nothing has been merged, migrated or deployed.

## 6. Tests

`npm run test:programs` (223 checks), `npm run test:migration-085` (real
Postgres incl. RLS and cross-team isolation), `npm run test:programs-browser`
(real Chromium, mocked program API), `npm run acceptance:programs` (prints the
Charlie program), `npm run verify:authz` (six new routes guarded).

## 7. Known limitations

* The live model has not been run (no API key in this environment). The prompts
  and the sanitiser are tested with stubs only; **coaching-language quality is
  unverified.**
* The Charlie acceptance uses fixture evidence and a fixture drill pool, not the
  real account or production library.
* The browser test mocks `/api/development-program/*`; route handlers are
  covered by authz verification, store scoping tests and the SQL tests, but
  **no test calls a route handler end to end against a real Supabase**.
* Qualitative observations are stored in session-completion notes, not as
  `entries`/observations, so they do not yet feed CoachAI's observation context.
* Revision application supports four operations (add a drill, ease, progress,
  pause throwing). Advancing a *drill stage* is expressed as an intensity step.
* Saved sessions are edited via reschedule/notes and revisions; full content
  editing exists only on drafts.
* Holiday handling covers Thanksgiving, Dec 24/25 and Jan 1 only. No team
  calendar conflict detection (no program-side calendar data exists).
* Player Reports do not yet read program assessments directly (they will see the
  `player_metrics` rows).
* Pitch Smart numbers should be re-checked at pitchsmart.mlb.com before reuse.
