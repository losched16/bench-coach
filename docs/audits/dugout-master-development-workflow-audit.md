# Player-development workflow audit, against Dugout Master

**Review date:** 2026-09-29
**Baseline:** `main` at `c38f34c` ("Fix the stale 154 constant in verify-finder-production (#12)"), working tree clean.
**Production database inspected read-only:** Supabase project `chdpqsumqospnaztvfqe`.
**Nothing was changed.** No migration applied, no production write, no deploy, no merge.

---

## 1. Executive verdict

BenchCoach has built more genuine player-development machinery than Dugout Master
appears to advertise, and a coach cannot get to most of it.

The parts are real and they are good. The drill library is 245 curated rows with
179 schedulable, every one carrying instructions, cues, watch-fors and a
progression, mapped to a 49-problem taxonomy. Eight development pathways carry 80
stages with objectives, mastery signals, common failure modes and 272 stage-drill
links. The AI context layer assembles observations, lesson diagnoses, stats,
measurements and prescription history into one weighted evidence block, and four
API routes use it. Player reports are coach-approved, frozen on finalization, and
can only cite drills that exist. The league layer's privacy boundary is structural
rather than filtered — a verifier proves no league surface names a single
coach-written text column.

What does not exist is the loop. The eleven-step workflow in this brief breaks in
three places, and all three breaks are the same break wearing different clothes:
**work recorded in one feature is invisible to the next one.**

The evidence is not an argument from reading code. In production, across the
entire history of the feature, `player_pathway_events` holds **4 `enrolled` and 2
`mastery_recorded` rows and nothing else** — zero sessions logged, zero players
advanced a stage. The `prescriptions` table, which drives the board the sidebar
calls "Skill Development" and which supplies the richest section of the AI
context, holds **0 rows**. Four coaches started a development plan and not one of
them ever came back to it.

Against Dugout Master, the honest read is: they appear to have shipped the
**operational** loop (lineups, live practice mode with timers, real-time coach
sync, org rollups) and market it clearly; BenchCoach has shipped the
**instructional** loop (what to teach, why, in what order, and how to tell it
landed) and hides it three clicks deep behind a tab. Neither product's advantage
is established as *quality* — only as presence.

The three recommendations below are all connection work. None requires a new
feature, and only one requires a schema change.

---

## 2. Evidence and verification limits

State these before the findings, because several conclusions are weaker than they
look and one is stronger.

### What I could verify

| Method | Coverage |
|---|---|
| Source reading at `c38f34c` | All routes, libs and pages named in this report |
| Production schema + row counts (read-only) | 90 public tables via Supabase MCP `list_tables`; two read-only aggregate `SELECT`s |
| Unit/logic tests, run today | `test:player-pathways` 140 passed · `test:pathways` 96 · `test:pathway-ui` 60 · `test:priority-coverage` 100 · `test:practice-scheduler` 517 · `test:player-report`, `test:progression`, `test:practice-prompt` all pass |
| Browser suite, real Chromium, fixture backend | `test:browser` **217 passed, 0 failed** |
| Pathway UI acceptance, real browser at 390px and 1440px | `accept:pathway-ui` **90 passed, 0 failed** (required a dev server on :3113, which the script does not start itself) |
| Production verifiers, anon key, RLS in force | `verify:pathways-prod` PASS · `verify:pathway-ui-prod` PASS · `verify:player-pathways-prod` PASS |
| Structural privacy check | `verify:league-privacy` PASS — 9 league route files, 3 RPCs, migration 050 |

### What I could not verify

1. **The competitor's site could not be opened.** `www.dugoutmaster.com` and
   `docs.dugoutmaster.com` are both blocked by this environment's network egress
   proxy (403 at CONNECT, confirmed by direct `curl` as well as WebFetch). Every
   competitor claim below comes from **search-result snippets of their own pages**,
   not from reading the pages. Snippets are second-hand. Treat the competitor
   column as *what they appear to advertise*, at lower confidence than the
   BenchCoach column, and re-verify before anything external is written from it.
2. **Prices are unknown.** Free / Pro / Elite tier names are corroborated; no
   dollar figure appeared in any snippet. Marked unknown, not estimated.
3. **Three of the supplied research claims are not corroborated** by any snippet I
   retrieved: *AI drill generation*, *player video comparison*, and *AI motion
   analysis*. What is corroborated is "per-player video uploads and in-app review
   — including loop playback" on Pro and Elite. This is **not** evidence those
   features are absent — I could not read the feature pages. It means the supplied
   research is currently unverified on those three points and should not be
   repeated as fact.
4. **No live signed-in session.** This environment cannot reach `mybenchcoach.com`.
   Everything about BenchCoach's runtime behaviour is from code, from fixture-backed
   browser runs, or from production *data* — never from clicking the deployed app.
5. **AI output quality is not assessed.** No model call was made. Tests that touch
   AI surfaces assert prompt *construction* and *grounding*, not answer quality.
   Passing them says the model was handed the right evidence, not that it reasoned
   well about it.
6. **Vercel deployment configuration was not read** (the call required an approval
   unavailable here). So whether `NEXT_PUBLIC_SWING_ANALYZER_URL` is set in
   production is **unknown**, and the swing-analysis feature's live status is
   unknown with it.

### One caution about the production numbers

The whole database is small: 11 coaches, 8 teams, 61 players, 15 practice plans.
Low usage of a feature is therefore weak evidence that the feature is bad — there
is barely any usage of anything. What the numbers *do* support is **relative**
comparison inside the same tiny population: 15 practice plans and 83 chat threads
against 0 logged pathway sessions is a ratio, and ratios survive small samples
better than absolute counts.

---

## 3. Baseline: what actually exists, classified

Using the brief's categories.

| Capability | State | Evidence |
|---|---|---|
| Curated drill library | **Verified deployed** | 245 rows, 179 schedulable; `verify:finder-prod` PASS 23/23 |
| Problem taxonomy + drill mapping | **Verified deployed** | 49 problems, 403 mappings, every problem covered |
| Development pathways (content) | **Verified deployed** | 8 pathways, 80 stages, 272 stage-drill links, 148 stage-problem links |
| Player development plans (enrollment + stage state) | **Deployed, barely used** | `player_pathway_progress` 4 rows; events: 4 enrolled, 2 mastery, **0 sessions, 0 advances** |
| Progression Playbooks | **Deployed, used** | `player_playbooks` 11 rows, 8 templates |
| Priorities / prescriptions | **Implemented, never used in production** | `prescriptions` **0 rows**; `plan_session_log` 0 rows |
| AI practice planning | **Verified deployed** | `practice_plans` 15 rows |
| CoachAI chat | **Verified deployed** | 83 threads, 156 messages |
| Observations / entries capture | **Deployed, lightly used** | `entries` 5, `observations` 4 |
| Measurements | **Deployed, lightly used** | `metric_types` 11, `player_metrics` 8 |
| Player reports (coach-approved PDF) | **Verified deployed** | 4 reports, 8 focus areas, 14 drill links — note `docs/player-reports.md` still says migration 054 is "created, not applied"; **that doc is stale, the tables are live** |
| Swing analysis (player video) | **Partially implemented / disconnected** | `swing_analyses` 13 rows, but depends on an external service at `SWING_ANALYZER_URL`, default `http://localhost:8080`; production config unknown |
| Lineups / game day | **Implemented, unused** | `game_lineups` 0, `lineup_assignments` 0, `game_participation` 0, `game_position_log` 0 |
| Pitch counting | **Deployed, used** | `pitch_count_sessions` 5, `game_pitch_counts` 13, 16 rule sets |
| Scouting | **Deployed, used** | 30 entries, 321 appearances, 59 opponent players, 6 analyses |
| League layer | **Implemented, never provisioned** | All six `league_*` tables exist; **all 0 rows** |
| Offline support | **Absent** | `public/sw.js` passes every request through: *"no offline caching for now"* |

---

## 4. Workflow trace: 9U, 12 players, 60 minutes, two coaches, limited equipment, one player with throwing accuracy and several teammates needing the same

### Step 1 — Record a player observation ✅ works

- **Entry point:** the `+` capture menu in the header (`components/CaptureMenu.tsx`), reachable from any screen including mobile, or `/dashboard/log`.
- **Handler:** `POST /api/log` → `entries` + `observations`.
- **Persists:** body, `prompt_key`, `observed_on`, `entry_type`, optional `player_id`, `team_id`, images.
- **Carries forward:** into `assembleCoachContext`, where it is rendered under
  *"WHAT THE COACH SAW (outranks the box score — if these conflict with stats, trust these)"*.

**Defect found here.** `app/dashboard/log/page.tsx:222` resolves `coachId` from the
**signed-in user's own** `coaches` row. But `app/api/practice-plan/route.ts:107` and
`app/api/chat/route.ts:833` both assemble context with `coachId: team.coach_id` — the
**team owner's** id — and `lib/coachContext.ts:262` filters observations by
`.eq('coach_id', coachId)`. So an assistant coach's observations are written under
their own id and are **systematically excluded from every AI surface**. In the
scenario: the assistant who actually watched the throwing station logs what he saw,
and the practice planner never sees it. This is silent — nothing errors.

### Step 2 — Identify or select a development priority ⚠️ works, but on a dead path

- **Entry point:** `/dashboard` ("Skill Development" in the sidebar) → `POST /api/prescribe`.
- The route diagnoses against `problem_taxonomy` (Haiku), then writes the analysis (Opus 5) from `renderCoachContext(ctx)`.
- `commitPrescription` (`lib/prescriptions.ts`) writes a `prescriptions` row.

**This is the richest reasoning surface in the product and it has never been used.**
`prescriptions` holds 0 rows in production. Every `CURRENTLY WORKING ON` and
`WHAT WE'VE ALREADY TRIED` block in `renderCoachContext` is therefore empty for
every coach, today — the part of the context layer designed to make the AI
remember what it already told you has never had anything to remember.

### Step 3 — Create or update an individual development plan ⚠️ ambiguous by name

There are **two unrelated things called a development plan**:

1. `POST /api/development-plan` → home-practice sessions written against **a
   prescription**, rendered by `components/DevelopmentPlan.tsx` under the button
   *"Build {name}'s development plan"*. Dead today (no prescriptions exist).
2. **Player Development Plans** → pathway enrollment in `player_pathway_progress`,
   started from the player's Development tab.

Plus **Playbooks** (fixed session programs) and the **priorities board** labelled
"Skill Development". That is four development-shaped concepts, three of which are
never named on the same screen. `docs/program-choice.md` did good work
disambiguating Playbooks from Player Development Plans; it does not address the
name collision with (1), or the sidebar label.

### Step 4 — Select a pathway / stage ✅ works well

- **Entry point:** Roster → player → **Development** tab (`components/PlayerDevelopment.tsx`) → `POST /api/player-pathways`.
- 8 pathways, 80 stages. `lib/playerPathways.ts` resolves the stage and handles the
  re-curation case honestly (`stage_gone` rather than silently resetting to stage 1).
- **Discoverability defect:** there is **no sidebar entry for Development Plans**.
  Playbooks has one. The single most development-specific feature in the product is
  three clicks deep behind a tab on a player page.

### Step 5 — Generate a team practice incorporating the need ✅ works, with a manual bridge

- From the stage page, **"Add to practice"** deep-links to
  `/dashboard/practice?teamId=…&pathway=<slug>&stage=<n>`
  (`app/dashboard/roster/[playerId]/development/[progressId]/page.tsx:537`), and the
  practice page pre-selects the picker and adds the implied focus chip
  (`app/dashboard/practice/page.tsx:308-334`). Suggested, not forced — the coach
  still presses Generate.
- The route then loads the pathway, calls `getPathwayPracticeRecommendation`, and
  injects the stage objective, ordered drills, mastery signals and failure modes as
  a strong preference (`app/api/practice-plan/route.ts:440-500`).
- Team-wide context also flows: `assembleCoachContext(coachId: team.coach_id, teamId)`,
  plus `team_notes`, roster headcount, equipment, coach count.
- `lib/stationPlanner.ts` models three parallel stations as 24 minutes, not 72 — which
  is exactly what the 60-minute, two-coach, 12-player scenario needs.

**Break:** the handoff is one-directional and one-player-at-a-time. There is no
"these four players are on this stage, build a station for them" path. The coach
must know to open one player's plan and press the button.

### Step 6 — Review and adjust drills, groups, timing, equipment ✅ works

Draft-before-commit, `DrillSwap`, `practiceAdjust`, `mustIncludeDrillIds` treated
as binding. `test:practice-scheduler` 517 assertions pass.

### Step 7 — Run the practice on the field ⚠️ thin

- **What exists:** a print sheet (`/dashboard/practice/[id]/print`, 527 lines),
  station rotations with elapsed ranges, mobile layout verified at 390px with 0px
  overflow and ≥32px tap targets (`accept:pathway-ui` checks 28-30).
- **What does not exist:** a live run mode. No timer anywhere in `PracticeBlock.tsx`
  — no `setInterval`, no running clock. No per-station live view, no "next rotation"
  control, no live sync between the head coach's phone and the assistant's.
- **No offline support at all.** `public/sw.js` is four lines of pass-through with the
  comment *"no offline caching for now"*. On a field with no signal, the app is blank.
  Do not claim otherwise anywhere.

### Step 8 — Record completion, observations, reassessment ❌ **this is the break**

- The **only** UI callers of `POST /api/player-pathways/[progressId]/events` are the
  development detail page and `PlayerDevelopment.tsx`. Nothing on any practice
  surface writes a pathway event.
- `practice_plans` has **no column** linking a plan to a pathway, stage or player.
  Verified against production: `id, team_id, title, duration_minutes, focus, content,
  created_at, updated_at, focus_areas, scheduled_for, recap_dismissed_at`. The
  pathway linkage exists **only as an analytics event** in `user_events`, which is
  not readable as domain data.
- So a coach who generated a pathway-driven practice, ran it, and watched the player
  all session must now navigate Roster → player → Development → the stage → "Record
  today's work", from memory, and re-enter what happened.

**Production proves nobody does this.** 4 enrolled, 2 mastery signals, **0
`session_logged`, 0 `advanced`**. The most carefully built part of the development
system — `validateMove`, optimistic-concurrency stage transitions, append-only
history — has never been exercised by a real coach.

### Step 9 — Return for the next session ⚠️ partial

The plan is there, the stage is there, the timeline is there. What is missing is any
record that a practice happened against it, so the timeline shows an enrollment and
then silence.

### Step 10 — Receive guidance reflecting previous work ❌ **the second break**

`lib/coachContext.ts` never reads `player_pathway_progress` or
`player_pathway_events`. Confirmed by exhaustive grep: those tables are touched only
by the three `/api/player-pathways` routes, `lib/playerPathways.ts`, `lib/authz.ts`,
`lib/migrationHints.ts` and a verifier. Consequently:

| Surface | Sees prescriptions | Sees playbooks | Sees pathway progress |
|---|---|---|---|
| CoachAI chat | ✅ `route.ts:833` | ✅ `route.ts:208` → `lib/anthropic.ts:303` | ❌ |
| Practice planner | ✅ `route.ts:107` | ❌ | ⚠️ only the slug/stage the coach picked *this minute* |
| Prescribe / analysis | ✅ | ❌ | ❌ |
| Development-plan writer | ✅ | ❌ | ❌ |

Ask CoachAI *"what should we do with Marcus this week?"* and it will not know Marcus
is on stage 3 of Build the Arm, that his coach ticked two mastery signals, or that he
has been on that stage for five weeks. The product **retains** that history and does
not **use** it.

### Step 11 — Coach-reviewed family report ✅ genuinely strong

`/api/player-reports/*` with `draft` → `improve` → `revise` → `finalize` → `pdf`.
The rewrite endpoint never writes to the database; drills are chosen by index from a
handed list so a model cannot invent one; video URLs come only from stored rows;
finalized reports are frozen and edits create a revision; `context` snapshots team,
season and coach names at finalization. No parent account, no portal, no email — it
ends at Download PDF. 4 reports and 14 drill links exist in production.
`test:player-report` and `test:report-copy` pass.

**Gap:** the report draft does not pull from pathway progress either, so the one
document a family reads cannot say "he moved from stage 2 to stage 4 this season" —
the exact sentence the pathway system exists to make possible.

---

## 5. The three critical breaks, stated once

1. **Pathway progress is invisible to every AI surface.** The flagship development
   feature does not participate in the product's flagship advantage.
2. **Running a practice records nothing against the plan it came from.** No schema
   link exists between a practice plan and a pathway stage, so the loop cannot close
   even manually without re-entry. Production: 0 sessions ever logged.
3. **Assistant-coach observations never reach the AI**, because capture writes the
   signed-in coach's id and context reads the team owner's.

A fourth, non-technical: **four features are called some variant of "development"**
and the most capable one has no navigation entry.

---

## 6. Competitive matrix

Competitor column = advertised, from search snippets of their own pages, **not read
first-hand** (site blocked). Sources listed at the end.

| Area | Dugout Master (advertised) | BenchCoach (observed, with code evidence) | Assessment | Confidence | Implication for a 6U–12U volunteer coach / league buyer |
|---|---|---|---|---|---|
| **Contextual AI coaching** | Nothing corroborated. "Note capture and insights… carry those lessons into your next practice" — mechanism unstated | Real and deep. `lib/coachContext.ts` assembles observations, instructor diagnoses, stats, measurements, prescription history with explicit evidence weighting; used by 4 routes; grounded in 245 real drills | **BenchCoach advantage** | Medium-high on ours (code + tests read); low on theirs (snippets only) | The single clearest differentiator, and the homepage undersells it |
| **Practice planning** | "Build drill timelines, reuse practice plans"; "timed drill plans include setup instructions, equipment, and skill focus"; shared drill library; org-wide reuse | AI generation from roster, headcount, equipment, coach count, focus; station maths that prices parallel work correctly; draft-before-commit; swap; 517 scheduler assertions | **Overlap, different shapes.** Theirs = reusable templates. Ours = generated-to-constraints | Medium | Ours wins on a Tuesday with 60 minutes and no plan; theirs wins on "run the same practice at every level" |
| **Practice execution** | "Run live sessions with timers and real-time progress tracking"; "live mode with timers" | Print sheet + station rotations with elapsed ranges. **No timer, no live mode, no coach sync, no offline** (`sw.js` passes through) | **Competitor apparent advantage** | High on ours (code is unambiguous); medium on theirs | This is the hour that matters most and we are weakest in it |
| **Individual development** | Tag players in notes so "development feedback… lives on their profile"; tryout scoring; "sort to spot over-benched players" | 8 pathways, 80 stages with objectives, mastery signals, failure modes, 272 drill links; stage advance is a human decision with confirmation and optimistic concurrency | **BenchCoach advantage on structure; unproven in use** | High | We can answer "what next and why"; theirs appears to answer "what did we notice" |
| **Progression playbooks** | Not corroborated | 8 templates, 11 running; fixed sessions, team or individual | **Unknown** (cannot establish they lack it) | Low | Fine as-is; not a wedge |
| **Measurement & reassessment** | "Key metrics" on a player view; tryout scoring with consistent org-wide drills | `lib/metrics.ts` with honest rules: sessions are dates, `MIN_SESSIONS_FOR_TREND = 3`, direction-aware, best vs average both kept; 11 types, 8 readings | **Overlap.** Ours is more rigorous, theirs is more routinised (everyone scored the same way at tryouts) | Medium | Their tryout framing gets data recorded; our rigour makes it mean something. Theirs is the better *habit* |
| **Reports & family sharing** | Public team page + QR, "nothing for families to install, no account" | Coach-approved PDF, frozen on finalize, revisioned, drills verified against the library, no model-authored claims about a child | **Different products.** Theirs = broadcast. Ours = per-child document | High on ours | Ours is the one a parent keeps. Theirs is the one a parent checks on Saturday |
| **Game-day tools** | Core pitch: lineups, defence, substitutions, inning-by-inning, live lineup sync across coaches | Lineup builder, pitch counter (16 rule sets, in real use), scorebook, scouting. **But `game_lineups`, `lineup_assignments`, `game_participation` are all 0 rows** | **Competitor advantage** | High | It is their headline and their proof; ours is built and unused |
| **Video** | "Per-player video uploads and in-app review including loop playback" on Pro/Elite. *Comparison and AI motion analysis are supplied research I could not corroborate* | Drill instructional video only, provenance-checked (`0 verified, 0 timestamped` — links are plain by design). **Player video = `swing_analyses`, 13 rows, external service, production config unknown** | **Competitor apparent advantage** | Low-medium both sides | Distinguish sharply: our drill video ≠ their player video. We should not imply we do player video review |
| **League adoption & admin** | Multi-team accounts, coach permissions, white-label, org-wide rollups — with "league-level dashboards and reporting **on the way**" | Full league layer built: roles, divisions, seasons, licenses, invitations, sponsorship entitlements, adoption overview. Privacy boundary structural and verified. **0 leagues provisioned** | **Overlap; ours stronger on privacy, theirs stronger on being in use** | High on ours | A commissioner can be shown what was bought and whether it is used — once one is actually provisioned |
| **Onboarding / time to first result** | Free tier for roster basics; coaches onboarded "in minutes"; QR/link registration; GameChanger calendar+stats sync | First-practice checklist with careful unavailable-vs-empty handling; help registry; photo-to-lineup OCR import. No GameChanger API sync | **Competitor advantage on cold start** | Medium | Their free game-day entry gets a coach in with zero setup; our value needs data first |

---

## 7. The three highest-value improvements

Chosen on one rule: *connect what exists*. All three attack the same defect from
different ends. Nothing here is a new feature.

---

### #1 — Put pathway progress into the AI context layer

**Problem.** A coach asks CoachAI what to do next with a player and gets an answer
that ignores the development plan that coach set up for that player.

**Evidence.** `lib/coachContext.ts` never queries `player_pathway_progress` or
`player_pathway_events` (exhaustive grep, §4 step 10). The contrast is exact:
playbooks *are* rendered into the chat prompt (`lib/anthropic.ts:303`), pathways are
not. Meanwhile the prescription sections that dominate `renderCoachContext` are
empty for every coach in production (0 rows).

**Why this first.** It is the smallest change with the largest effect on the claim
the company is positioned on. Today "the AI knows your players" is true of notes and
stats and false of the development plan — the one place a coach has explicitly
written down what they intend to teach. It also immediately makes the existing 4
enrollments useful instead of inert.

**Reuse.** `assembleCoachContext` / `renderCoachContext`; `lib/playerPathways.ts`
(`resolveStage`, `planOutline`, and the stage/mastery summarisers already written and
covered by 140 passing assertions); `loadPathway`.

**Smallest coherent scope.** Add one optional block to `CoachContext` —
`pathwayProgress?: Array<{ pathway, stageNumber, stageTotal, stageName, objective,
stageStartedAt, masterySignalsRecorded, masterySignalsTotal, sessionsLogged,
lastEventOn }>` — populated by one query when `playerId` is set and one team-scoped
query when it is not. Render it under a heading that states the rule plainly, e.g.
*"DEVELOPMENT PLAN IN FORCE — the coach chose this. Do not contradict it; if you
think the player is ready to move on, say so and say why, but the coach decides."*

**Files/tables.** `lib/coachContext.ts` (the only required edit); optionally
`lib/playerPathways.ts` for a summariser. Tables read: `player_pathway_progress`,
`player_pathway_events`, `development_pathway_stages`. **No schema change.**

**Dependencies/risks.** Context length — the block must be capped (one row per active
enrollment, most recent 5 events). Risk of the model treating a stage as a
prescription and drifting into advancement advice; mitigated by the heading above and
by the fact that no AI route can call the events API (`events/route.ts` is explicit:
*"NOTHING HERE MAY BE CALLED BY AN AI"*). Must inherit the same defensive `try/catch`
the other blocks use so a missing table degrades rather than breaks.

**Effort: small.** One file, one shape, two queries, following a pattern used five
times already in the same module.

**Acceptance criteria.**
1. With a player on a pathway, `renderCoachContext` output contains the pathway name, stage number of total, and the stage objective.
2. With no enrollment, the output is byte-identical to today's.
3. A player enrolled against a re-curated pathway whose stage key no longer exists produces a stated "stage unavailable" line, not a crash and not a silent stage 1.
4. Unit assertions added to `test:player-pathways`; whole gate stays 8/8.

**Proposed success measure (proposed, not observed).** Share of CoachAI answers about
an enrolled player that name the player's current stage — target >80% on a 20-question
manual sample, scored by a human, not by a test.

---

### #2 — Record the practice against the plan it came from

**Problem.** A coach generates a practice from a stage, runs it, and the plan shows
nothing. Closing the loop today means re-navigating four levels deep and retyping.

**Evidence.** `practice_plans` has no pathway/player column (production schema read).
The linkage exists only in `user_events` analytics. No practice surface calls the
pathway events API. Production: **0 `session_logged` events, ever.**

**Why this over alternatives.** Without it, improvement #1 has thin history to read —
it would show an enrollment and a stage with no work behind it. This is the step that
generates the data everything else reasons over, and it is the step the brief's
scenario breaks on.

**Reuse.** The existing `POST /api/player-pathways/[progressId]/events` with
`kind: 'session'` — which already accepts `minutes`, `drillIds`, `note` and
`occurredOn`, already validates the stage, and already enforces `record` capability
so an assistant can do it. The `?pathway=&stage=` deep-link already proves the two
surfaces can talk.

**Smallest coherent scope.** Two halves:

- **Schema (this is the one place a change is genuinely needed):** add
  `pathway_slug TEXT` and `pathway_stage_number INT` to `practice_plans`, nullable,
  no backfill. Two nullable columns are strictly less invasive than a join table and
  are enough to answer "which stage did this practice serve".
- **UI:** on a saved plan that carries a pathway, show one control — *"Record this
  against the players on this stage"* — listing the enrolled players on that pathway
  and stage with checkboxes, defaulting to all, posting one `session` event each with
  the plan's duration and drill ids. One tap, from the surface the coach is already on.

**Files/tables.** New migration `077_practice_plan_pathway_link.sql`;
`app/dashboard/practice/page.tsx` (insert payload + the new control);
`app/api/player-pathways/route.ts` (a list-by-pathway-and-stage read, or a filter on
the existing GET). Tables: `practice_plans` (altered), `player_pathway_events`
(written, existing shape).

**Dependencies/risks.** Needs #1 to be worth much. A coach with 12 enrolled players
could fire 12 events with one tap — make the list explicit and the default reviewable
rather than silent. Must not write anything on plan *generation*; only on an explicit
press, or it becomes an AI-driven write to a child's record, which the architecture
deliberately forbids. RLS on `player_pathway_events` already scopes by team.

**Effort: medium.** One migration, one non-trivial UI affordance, one read endpoint.
Bounded by reusing the existing event contract unchanged.

**Acceptance criteria.**
1. A plan generated with `?pathway=X&stage=3` saves with `pathway_slug='X'`, `pathway_stage_number=3`.
2. A plan generated with no pathway saves both columns null and the control does not render.
3. Pressing the control writes exactly one `session_logged` event per selected player, carrying minutes and drill ids, and the stage timeline shows them.
4. A contributor (assistant) can press it; a viewer cannot.
5. Re-pressing does not duplicate silently — either it is idempotent per plan per player, or it says the work is already recorded.

**Proposed success measure (proposed).** `session_logged` events per active
enrollment per month — currently 0. Any sustained non-zero value is the first
evidence the loop closes.

---

### #3 — Fix assistant-coach observation attribution, and surface Development Plans in the sidebar

Two small fixes, bundled because both are "the coach cannot reach what exists" and
neither justifies a slot alone.

**Problem A.** Observations recorded by an assistant are invisible to every AI
surface. **Evidence:** capture writes the signed-in coach's id
(`app/dashboard/log/page.tsx:222`); context filters on the team owner's
(`practice-plan/route.ts:107`, `chat/route.ts:833`, `coachContext.ts:262`). Silent —
nothing errors, the notes simply never appear.

**Problem B.** Development Plans have no navigation entry; Playbooks does. The
sidebar's "Skill Development" points at the priorities board, which has 0 rows in
production. **Evidence:** `app/dashboard/layout.tsx:305-346`.

**Why this matters more than it looks.** In the scenario as written — two coaches —
the assistant is exactly who watches the throwing station while the head coach runs
hitting. Problem A means the product quietly discards the observation most likely to
be about the player in question.

**Reuse.** `lib/authz.ts` already resolves team membership; `sessionClient` already
knows who is calling. The sidebar already supports `needs` capability gating.

**Smallest coherent scope.**
- A: in `assembleCoachContext`, replace the single `.eq('coach_id', coachId)` filter on
  observations with "coach ids belonging to this team" when a `teamId` is present —
  team owner plus `team_members`. Leave the player-scoped and personal-plan paths alone.
- B: add `{ label: 'Development Plans', href: '/dashboard/roster', … }`, or better, a
  team-level list of active enrollments. If a new page is too much for this slot, the
  sidebar link alone plus a Development-tab deep link is the one-line version.

**Files/tables.** `lib/coachContext.ts`, `app/dashboard/layout.tsx`. Reads
`team_members`. **No schema change.**

**Dependencies/risks.** A is a **privacy-relevant widening** — it must be team-scoped
and nothing else, and it must not change the personal-plan (no team) path. Needs an
explicit assertion that a coach on two teams does not see team A's observations in
team B's context. B risks adding a fifth "development" thing to the navigation; the
label should be the one `lib/programChoice.ts` already uses.

**Effort: small.** Both are localised. A needs careful test coverage because it
touches who-sees-what.

**Acceptance criteria.**
1. An observation written by a `team_members` contributor appears in `renderCoachContext` for that team.
2. An observation from a team the caller is not on never appears — asserted directly.
3. The personal-plan (no `teamId`) path is unchanged.
4. Development Plans is reachable in ≤2 clicks from the dashboard.
5. `verify:authz` and `verify:league-privacy` still pass; gate 8/8.

**Proposed success measure (proposed).** Observations authored by non-owner coaches
that appear in a generated practice's context — currently structurally 0.

---

## 8. Answers to the standing questions

**Does this change the development-focused positioning?** No — it strengthens the
strategy and indicts the execution. Dugout Master appears to be winning the
operational category (lineups, live practice, org rollups) and says so plainly.
Competing there is a losing race. The instructional category — what to teach this
child next, why, and how to tell it worked — is genuinely ours and nothing in the
competitor research contradicts that. But the positioning currently outruns the
product at one specific joint: the AI does not see the development plan.

**Claims we can demonstrate today.**
- The AI reads coach notes, instructor diagnoses, game stats, measurements and prior priorities, with stated evidence weighting (`lib/coachContext.ts`, four routes).
- Every suggested drill is a real curated drill with instructions, cues and a progression — the model picks from a handed list and cannot invent one (245 rows, `verify:finder-prod` PASS 23/23).
- Practices are built to real constraints: headcount, equipment, coach count, duration, with station maths that prices parallel work correctly (517 assertions).
- Player reports are coach-approved, frozen, revisioned, and contain no model-authored claims about a child.
- League sponsorship exposes counts and timestamps, never a note, a conversation or a report (structurally verified).
- Development pathways with stage objectives, mastery signals and failure modes exist and are curated (8/80/272, three production verifiers PASS).

**Claims needing qualification.**
- *"The AI learns about your players."* It **retrieves**; it does not learn. And it currently retrieves everything except the development plan. Say "remembers what you've told it" and make #1 true before saying more.
- *"Everything adapts to your team"* near playbooks (`app/page.tsx`) — a playbook is fixed; `docs/program-choice.md` already flagged this and it is still there.
- Anything implying **live practice running**, **timers**, or **offline use**. There are none. `sw.js` is explicit.
- Anything implying **player video analysis** as a shipped feature: 13 rows exist but it depends on an external service whose production configuration is unknown.
- `docs/player-reports.md` says migration 054 is "created, not applied" — **stale**; the tables are live with 4 reports. Worth correcting so the next reader is not misled.

**Valuable capabilities that are hidden or poorly explained.**
1. **Development Plans** — the deepest development feature, no sidebar entry, three clicks deep.
2. **The evidence-weighting model** — that a coach's own eyes outrank the box score is a real product opinion and appears nowhere a user can see it.
3. **Station maths** — the 24-minutes-not-72 insight is the difference between a usable 60-minute practice and an impossible one, and is invisible.
4. **Measurement honesty** — `MIN_SESSIONS_FOR_TREND = 3` and best-vs-average is exactly the rigour a sceptical parent wants, and is never surfaced as a promise.
5. **League privacy** — structurally verified and a genuine sales asset for a board conversation; currently a code comment.

**What to defer deliberately.**
- **GameChanger API integration.** Real gravity, but the photo-to-lineup OCR import already covers the field moment, and this is a large integration against a third party.
- **Public team pages / QR / registration.** Their model, not ours; drags in parent-facing surface area we have deliberately avoided.
- **Player video comparison and motion analysis.** Expensive, unverified as a competitor capability, and orthogonal to the broken loop.
- **A live practice mode with timers.** The clearest competitor advantage and still the wrong next move — it is a substantial build, and a timer on a practice whose outcome is never recorded does not close the loop. Revisit once #2 exists.
- **Any analytics platform.** The measurement primitives are adequate; the missing thing is *data*, not dashboards.
- **Game-day feature work.** Built, 0 rows, unused. Find out why before building more.

---

## 9. Recommended first implementation task

**Improvement #1 — put pathway progress into `lib/coachContext.ts`.**

One file, no schema change, no migration, no new surface. It makes the existing
development plans immediately visible to CoachAI, the practice planner, the analysis
writer and the report drafter at once, because all four already call the same
assembler. It is the prerequisite that makes #2 worth building, it is provable by
unit assertion rather than by judgement, and it can ship behind the existing gate in
a single small PR.

Concretely: extend `CoachContext` with an optional `pathwayProgress` block, populate
it in `assembleCoachContext` with the same defensive `try/catch` the metrics and
prescription blocks use, render it in `renderCoachContext` under a heading that
states the coach owns the decision, and add assertions to `test:player-pathways`
covering the enrolled, not-enrolled and stale-stage cases.

---

## Sources

Competitor claims are from search-result snippets of the following pages. **The pages
themselves could not be opened** from this environment (egress blocked, 403 at
CONNECT), so none of this is first-hand.

- [Dugout Master — home](https://www.dugoutmaster.com/)
- [Features](https://www.dugoutmaster.com/features)
- [For Organizations](https://www.dugoutmaster.com/for/organizations)
- [For Club Owners](https://www.dugoutmaster.com/for/club-owners)
- [For Schools](https://www.dugoutmaster.com/for/schools)
- [Pricing](https://www.dugoutmaster.com/pricing)
- [Docs — Manage Your Team with Confidence](https://docs.dugoutmaster.com/)
- [Docs — Teams Overview](https://docs.dugoutmaster.com/teams/overview/)
- [Docs — Game Results](https://docs.dugoutmaster.com/games/game-results/)

The named URLs `/features/player-development`, `/features/practices`,
`/features/game-day` and `/features/season-management` did not appear in any search
result and were not reachable; nothing in this report is attributed to them.
