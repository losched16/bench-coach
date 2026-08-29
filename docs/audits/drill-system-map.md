# Where the drill system lives

Discovery pass, 29 Aug 2026. Nothing in this document changes behaviour.

**A note on what this audit can and cannot say.** The drill records live in
Supabase. This pass was performed from the repository, which has no database
access, so **every claim here about *code* is verified against the source, and
no claim here about *data* is asserted at all** — the counts belong in the
coverage and taxonomy reports, and those need `scripts/drill-audit.mjs` run
against production first. Where a number would normally go, this document says
so rather than guessing.

---

## Storage

| Thing | Where |
|---|---|
| Drill records | `drill_resources` (Supabase) |
| Problem vocabulary | `problem_taxonomy` (Supabase) |
| Drill ↔ problem mapping | `drill_problem_map` (Supabase) |
| Coach favourites | `favorite_drills` (migration 041) |
| Coach-authored drills | `drill_resources` rows with `created_by_coach_id` set |

**There is no seed file and no static drill data in the repo.**
`cowork-expansion/existing_drills.json` looks like one but is a partial export
of 163 drills carrying six fields (`id`, `drill_name`, `youtube_video_id`,
`skill_category`, `difficulty_level`, `progression_level`) made for a one-off
expansion. It is a snapshot of unknown age, not a source of truth, and should
not be used as the audit inventory.

`cowork-expansion/` also holds `new_drills.json`, `new_problems.json` and
`new_mappings.json` with `apply-expansion.mjs` — the tooling for that earlier
expansion.

## Schema — `drill_resources`

Assembled from the migrations that alter it. **The base table predates the
migrations directory**, so the original columns are inferred from the code that
selects them (`lib/drills.ts` `DRILL_FIELDS`) rather than from a `CREATE TABLE`
in this repo. Run `migrations/CHECK_SCHEMA.sql` to confirm what production
actually has.

**Base columns** (via `DRILL_FIELDS`, `lib/drills.ts:21`):

```
id, drill_name, description, youtube_video_id, youtube_url, thumbnail_url,
channel, youtube_start_seconds, skill_category, difficulty_level,
progression_level, equipment_needed, ai_coaching_notes, safety_notes,
min_age, max_age, competition_level, mechanic_focus, common_flaws_fixed,
reps_guidance, frequency_guidance, success_markers, status,
created_by_coach_id
```

Also referenced by code but not in `DRILL_FIELDS`: `age_range` (free text, used
by chat and the practice planner), `est_duration_minutes`, `age_relevance[]`,
`do_not_coach_flag`, `do_not_coach_note`, `source`, `url_verified_at`.

**Added by migration:**

| Migration | Columns |
|---|---|
| `001_prescription_engine.sql` | `reps_guidance`, `frequency_guidance`, `est_duration_minutes`, `success_markers[]`, `competition_level` (CHECK: rec/travel/both) |
| `008_library_expansion.sql` | `status` (default `'approved'`), `source`, `url_verified_at` |
| `011_drill_status_and_do_not_coach.sql` | `do_not_coach_flag`, `do_not_coach_note`, `age_relevance[]` |
| `041_coach_drills_and_favorites.sql` | `created_by_coach_id` |

`001` notes that a pre-existing `duration` column is "100% NULL/unused", which
is why `est_duration_minutes` was added beside it.

### `problem_taxonomy` (migration 001)

```sql
slug TEXT PRIMARY KEY, label TEXT NOT NULL, skill_category TEXT,
description TEXT, aliases TEXT[], created_at TIMESTAMPTZ
```

`aliases` is the phrase list used to match a coach's words to a problem.

### `drill_problem_map` (migration 001)

```sql
drill_id UUID, problem_slug TEXT, sort_order INT DEFAULT 100,
curated BOOLEAN DEFAULT FALSE, PRIMARY KEY (drill_id, problem_slug)
```

`curated = TRUE` means hand-verified; `FALSE` means auto-backfilled from
`common_flaws_fixed` strings by migration 003. **This distinction drives
ranking** — see the chat retrieval audit.

## Types

There is no shared `Drill` interface. Drill shape is expressed three ways:

- `DRILL_FIELDS` — `lib/drills.ts:21`, a runtime column string
- `ScorableDrill` — `lib/analysis.ts:90`, the six fields the relevance scorer reads
- `any[]` — everywhere else, including `PracticeInputs.drillResources`

`lib/drills.ts` explains the `any`: selecting a runtime string of columns gives
supabase-js nothing to infer from, so every row types as `GenericStringError`.

## Read paths

Every library read is required to go through `lib/drills.ts`. This is enforced
at build time by `scripts/verify-drill-scope.mjs`, which fails the build if a
query bypasses it — the check reports "6 via visibleDrills, 1 direct and
scoped, 6 exempt (by-id lookups the caller already owns)".

| Surface | File | Selection |
|---|---|---|
| Chat | `app/api/chat/route.ts:276` | `visibleDrills(...).limit(100)` — **no filtering at all** |
| Practice plan | `app/api/practice-plan/route.ts:198` | category filter, `limit(45)`, widen-on-empty |
| Practice plan swap | `app/api/practice-plan/swap/route.ts:44` | `visibleDrills` |
| Prescribe | `app/api/prescribe/route.ts:197` | via `drill_problem_map`, then keyword fallback |
| Prescribe drills | `app/api/prescribe/drills/route.ts:259` | same pattern |
| Prescribe step | `app/api/prescribe/step/route.ts` | by id |
| Drill browser | `app/api/drills/route.ts:35` | by category/search |
| Custom drills | `app/api/drills/custom/route.ts` | coach's own CRUD |
| Development plan | `app/api/development-plan/route.ts` | `drill_resources` |
| Check-in | `lib/checkin.ts` | names by id |
| Admin link check | `app/api/admin/verify-links/route.ts` | all, for URL verification |
| Drill library UI | `app/dashboard/drills/page.tsx:139` | `visibleDrills(supabase, cid, '*')` |

`visibleDrills(client, coachId, fields)` returns the curated library plus the
calling coach's own drills. A null `coachId` returns curated only.

## Retrieval mechanics

**There is no vector search, no embeddings, and no RAG.** Confirmed by grep
across `lib/`, `app/` and `migrations/` for `embedding`, `pgvector`,
`vector(`, `cosine`, `<=>` — zero hits. There is no `tags` column, no
`keywords` column, and no search-terms field.

Retrieval is one of three mechanisms:

1. **Whole-library dump into the prompt** (chat) — 100 drills, unfiltered.
2. **Category filter, then dump** (practice plan) — `ilike` on
   `skill_category`, capped at 45.
3. **Taxonomy join, then keyword fallback** (prescribe) — the only path that
   reasons about the coach's actual problem.

The keyword scorer is `scoreDrillRelevance` (`lib/analysis.ts:101`): stemmed
token overlap, weighted `common_flaws_fixed` ×4, `mechanic_focus` ×3,
`drill_name` ×3, `description` ×1, `ai_coaching_notes` ×1. `skill_category` is
deliberately excluded, with a comment explaining that counting it gave every
drill in a category a free passing score.

## Prompts that select drills

| Prompt | File | Role |
|---|---|---|
| Chat system prompt, `DRILL RESOURCES LIBRARY` | `lib/anthropic.ts:490` | Lists up to 100 drills; instructs the model to prefer the library and cite the video |
| `diagnose()` | `app/api/prescribe/route.ts` | Maps a complaint to 1–3 problem slugs + skill categories |
| `pickRelevantDrills()` | `app/api/prescribe/route.ts:396` | Model picks from a keyword-bounded pool of 40 |
| `generatePracticeSkeleton` | `lib/anthropic.ts:812` | Chooses named drill blocks from the menu |
| `expandPracticeBlock` | `lib/anthropic.ts:869` | Writes one block; does not re-select |
| `drillMenuLine` | `lib/drills.ts:159` | The single line per drill the planner sees |

## Practice templates

`lib/practiceTemplates.ts` holds six occasion templates (first practice,
game-day warmup, indoor/rainout, short practice, evaluation day,
pre-tournament) **as code, not database rows**. They deliberately contain **no
`youtube_video_id` and no drill IDs** — a comment states this is so a drill
library audit cannot break them. They therefore do not participate in drill
retrieval at all.

Playbooks/development plans (`app/api/development-plan/route.ts`, `plan_sessions`,
migrations 023/035/036) do reference drills.

## What could not be traced from the repo

- The actual contents of `drill_resources`, `problem_taxonomy` and
  `drill_problem_map`. Run `scripts/drill-audit.mjs`.
- Whether migrations 032–041 are applied in production. Run
  `migrations/CHECK_SCHEMA.sql`.
- The base `CREATE TABLE drill_resources` — not in this repo.
- `saved_drills` (chat reads it at `app/api/chat/route.ts:264`) appears to be a
  separate, older, per-team list distinct from `drill_resources`. Its schema is
  not in the migrations directory and its relationship to the main library is
  unclear.
