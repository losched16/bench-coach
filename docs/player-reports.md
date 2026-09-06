# Player Development Reports

**Date:** 2026-09-06
**Migration:** `migrations/046_player_reports.sql` — **created, not applied.**

A coach writes a development report for one player and shares it with the
family as a PDF. There is no parent account, no invitation, no link to send,
and no email. The workflow ends at "Download PDF"; how it reaches the family is
the coach's business.

---

## The one rule

**AI assists. The coach approves.**

That is enforced structurally, not by prompt:

| | |
|---|---|
| The rewrite endpoint | writes nothing to the database, ever |
| A suggestion | is shown beside the coach's own words with four explicit choices |
| Drill recommendations | are retrieved from `drill_resources`; the model picks indexes out of a list it was handed and cannot name a drill that does not exist |
| Video links | come from the stored row only; a model never sees or produces a URL |
| Timestamps | are used only where `drill_resources.youtube_start_seconds` is set (**currently 0 of 206 rows**, so links are plain today) |
| Finalizing | is a separate act, on the last step, after a full preview |

---

## Schema

Three tables. See the migration for the reasoning on every column.

```
player_reports
  team_id      -> teams(id)      CASCADE   the authorization scope
  player_id    -> players(id)    CASCADE
  coach_id     -> coaches(id)    CASCADE   workspace owner, mirrors prescriptions
  author_user_id -> auth.users   SET NULL  an assistant leaving must not delete
                                           reports that went to families
  report_type  midseason | end_of_season | general
  status       draft | final
  context      JSONB — team/season/age/coach names, frozen at finalization
  strengths_content / development_intro / closing_content   approved prose
  strength_areas TEXT[]  the seven areas from lib/focusAreas.ts
  revision_of  -> player_reports(id) SET NULL
  revision     INT

player_report_focus_areas          1-3 development priorities
  problem_slug -> problem_taxonomy(slug) SET NULL   the EXISTING taxonomy
  focus_area   one of the seven, denormalised for future aggregation
  label        what the report says, snapshotted
  coach_notes      what the coach typed before any help
  approved_content what the parent reads

player_report_drills
  drill_id -> drill_resources(id) SET NULL   never CASCADE
  snapshot JSONB    the eight fields the PDF prints
  recommendation_reason   derived from the taxonomy, never model-written
  include_video BOOLEAN   the coach can keep the drill and drop the video
```

### Why strengths use focus areas rather than new labels

The repo has exactly one skill vocabulary — `problem_taxonomy`, 49 catalogued
*deficits* — and one planning unit, the seven `FocusArea` values. Neither has
positive-skill labels, and inventing forty ("Contact", "Bat speed", …) would be
the parallel taxonomy this codebase has spent three migrations avoiding.
Structure comes from the seven areas; specificity comes from the coach's own
sentences, which is where it belongs anyway.

### Why the snapshot

A report from September 2026 must still be the report the coach sent after the
drill library is re-curated in 2027. `drill_id` is the live link; `snapshot` is
what the document *says*. They are allowed to differ, and `ON DELETE SET NULL`
means a retired drill leaves the report intact rather than deleting a row out
of a document a family has.

Snapshots refresh on every draft save and once more at finalization. After
that they never move again.

---

## Lifecycle

```
draft ──finalize──▶ final ──revise──▶ new draft (revision 2, revision_of = the first)
  │                   │
  └── delete          └── immutable: API refuses writes, RLS refuses them again
```

A finalized report is never edited in place. The version in a parent's inbox
and the version in the app can therefore never disagree without the history
showing that they differ.

---

## Authorization

One question, asked once: **report → team → the caller's role on that team.**

`authorizeReport()` in `lib/authz.ts` resolves the report to its `team_id` and
hands it to the existing `authorizeTeam()`. There is no separate permission, no
author-only rule, and no token anywhere.

| Action | Capability | Roles |
|---|---|---|
| List, read, PDF | `read` | viewer and above |
| Create, save, finalize, revise, delete draft | `decide` | admin, owner |
| Drill suggestions, wording help | `decide` | admin, owner |

Authoring is **not** `record`. This codebase draws its line between writing
down what happened tonight and deciding what happens next. A contributor is a
parent keeping the book; a development document about a child, under the head
coach's name, going to that child's family, is the season's judgement.

`POST /api/player-reports` additionally checks `team_players` — a coach who
legitimately owns team A must not be able to name any `player_id` and open a
report on a child from another club.

RLS in migration 046 mirrors all of this for the browser client, using
migration 034's `bc_team_at_least()` helpers.

### There is no league layer

The brief this was built from assumed a "hardened league layer". There isn't
one: `seasons.league_type` is a four-value text column and nothing else. No
league tables, no league admins, no league permissions. So no league
administrator can read a report today, which is the correct default. **If a
league layer is added later, reports should stay out of it unless there is an
explicit product decision** — "league admin" must not silently come to mean
"may read every coach's private comments about every child".

---

## Drill recommendations

`lib/drillRetrieval.ts`, extracted from `app/api/prescribe/drills/route.ts` so
there is one recommender rather than two drifting copies. The prescribe route
now imports it.

```
problem_taxonomy slug -> drill_problem_map (curated, sequenced)
  ↓ top up from the library when the mapping is thin
  ↓ drop drills outside the player's age band
  ↓ bound the pool by scoreDrillRelevance()
  ↓ rankByFit(): a Haiku call that returns INDEXES into that pool
```

Steps 1–4 are deterministic and decide quality. Step 5 only reorders, discards
any index outside the pool, and falls back to keyword order on any failure.

The extraction also fixed something: `gatherCandidates` read `drill_resources`
directly, so a coach-authored drill mapped to a problem could surface in
another coach's suggestions. It now goes through `visibleDrills()`.

Target is 3–5 candidates per priority. Twenty results is not more choice; it is
the same choice made worse, on a phone.

---

## PDF

**`pdf-lib`, server-rendered, never stored.**

No headless browser: a ~50MB chromium layer on Vercel for two pages of headed
text is a bad trade, and it introduces failures that only happen in production.
`pdf-lib` is pure JS with no native dependencies and behaves identically
locally and deployed.

Not `window.print()` either. The practice sheet does that and is right to — it
is a clipboard, for the coach. This goes to a family.

**Regenerated, not stored**, and safe to regenerate because finalization froze
everything it draws from. Storing would create a file about a child kept
private by configuration rather than by construction, and a second copy that
can disagree with the report. `GET /api/player-reports/[id]/pdf` is the only
way this content leaves the app, and it authorizes like every other route.
`Cache-Control: private, no-store`.

Links are real PDF link annotations reading "Watch drill", not printed URLs.
Text is folded to WinAnsi first — the standard fonts throw on anything outside
it, and a coach should not lose an hour's work to a pasted emoji.

---

## Files

| | |
|---|---|
| Migration | `migrations/046_player_reports.sql` |
| Domain | `lib/playerReports.ts` |
| Persistence | `lib/playerReportStore.ts` |
| Retrieval | `lib/drillRetrieval.ts` *(shared with the prescribe route)* |
| AI | `lib/playerReportAI.ts` |
| PDF | `lib/playerReportPdf.ts` |
| Authorization | `lib/authz.ts` → `authorizeReport()` |
| API | `app/api/player-reports/**` |
| Wizard | `app/dashboard/player-reports/[reportId]/page.tsx` |
| Components | `components/PlayerReports.tsx`, `components/playerReport/*` |
| Tests | `scripts/test-player-report.ts` — `npm run test:player-report` |

---

## What is deliberately not here

Parent accounts, invitations, parent auth, parent dashboards, public report
URLs, email, SMS, numeric player ratings, player comparison, league analytics.

The focus-area rows are shaped so league-level aggregation is *possible* later
(`problem_slug` + `focus_area` + the team's age group). Nothing aggregates
them today, and nothing should until someone decides who may see pooled data
about children.
