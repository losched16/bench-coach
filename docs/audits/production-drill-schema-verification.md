# Production schema verification — drill system

Read-only inspection of the live Supabase project, 29 Aug 2026. Nothing was
written. All findings below come from `SELECT`-only REST queries and the
exported data.

**Method note.** `migrations/CHECK_SCHEMA.sql` could not be executed as SQL —
this environment reaches Supabase over the PostgREST HTTP API only (port 5432
is blocked by the network policy), and PostgREST does not run arbitrary SQL.
Schema was therefore verified by probing each column and table individually:
`GET /rest/v1/<table>?select=<column>&limit=1` returns 200 when the column
exists and 400 when it does not. This establishes presence, and does **not**
recover types, nullability, defaults, constraints or foreign keys — those parts
of the request are unmet and are listed at the end.

---

## Headline: the repo's picture of this table was wrong in both directions

The earlier audit (`docs/audits/drill-system-map.md`) derived the drill schema
from `DRILL_FIELDS` in `lib/drills.ts`. Production has **37 columns**;
`DRILL_FIELDS` names 24. The differences matter more than the count.

### Present in production, NOT read by any retrieval code

**This is the most consequential finding of the whole pass.** Five columns
exist, are populated, and are invisible to chat, the practice planner and
prescribe — because none of them is in `DRILL_FIELDS` or `DRILL_SELECT`.

| Column | Populated | Distinct values | Read by |
|---|---|---|---|
| `primary_skill` | **206/206** | 39 | Drill browser UI only |
| `indoor_outdoor` | **206/206** | 3 — `Indoor/Outdoor`, `Outdoor`, `Both` | Drill browser UI only |
| `space_required` | **206/206** | 6 — `Small`, `Medium`, `Medium-large`, `Outfield/large`, … | Drill browser UI only |
| `requires_partner` | **206/206** | 2 — boolean | Drill browser UI only |
| `secondary_skill` | 86/206 | 35 | Drill browser UI only |
| `tags` | 86/206 | 86 (JSON arrays) | **Nothing at all** |

The only reader is `app/dashboard/drills/page.tsx`, which does `select('*')` and
renders them as badges for a human to look at (lines 20–30, 460, 596, 601).

`tags` on `drill_resources` has **zero** code references anywhere. (Greps for
"tags" hit `lib/gohighlevel.ts`, which is CRM contact tags — unrelated.)

The earlier audit reported "NO COLUMN" for indoor/outdoor, space requirements
and tags. **That was wrong.** They exist and are near-fully populated.

### Referenced in code but NOT found in production

| Column | Referenced at | Production |
|---|---|---|
| `drill_resources.do_not_coach_flag` | Named in `migrations/011` prose and the earlier audit | **ABSENT (400)** |
| `drill_resources.do_not_coach_note` | same | **ABSENT (400)** |
| `drill_resources.age_relevance` | same | **ABSENT (400)** |

**These were never drill columns.** Re-reading `migrations/011` line 103, they
are added to `problem_taxonomy`, not `drill_resources` — and on
`problem_taxonomy` all three are **present and working**. The earlier audit's
claim that "a drill explicitly marked do-not-coach can be recommended" is
**withdrawn**: there is no per-drill suppression flag, only `status`.

`app/api/prescribe/route.ts:99` selects all three from `problem_taxonomy` and
was verified against production — the exact query returns 200 with real data.
Prescribe is not broken.

### Present in production, unused, and empty

| Column | State |
|---|---|
| `duration` | 0/206 populated. Migration 001's comment ("100% NULL/unused") still holds |
| `est_duration_minutes` | **0/206 populated** — the column exists, nothing has ever filled it |

## `drill_resources` — 37 columns confirmed present

```
id, drill_name, description, skill_category, primary_skill, secondary_skill,
tags, difficulty_level, progression_level, min_age, max_age, age_range,
equipment_needed, mechanic_focus, common_flaws_fixed, ai_coaching_notes,
safety_notes, success_markers, reps_guidance, frequency_guidance,
est_duration_minutes, duration, competition_level, indoor_outdoor,
space_required, requires_partner, status, source, url_verified_at,
youtube_video_id, youtube_url, youtube_start_seconds, thumbnail_url, channel,
created_by_coach_id, created_at, updated_at
```

## `problem_taxonomy` — all columns present

`slug`, `label`, `skill_category`, `description`, `aliases`,
`do_not_coach_flag`, `do_not_coach_note`, `age_relevance`, `created_at`.
48 rows.

## `drill_problem_map` — 4 columns

`drill_id`, `problem_slug`, `curated`, `sort_order`. 311 rows.

**No confidence column, no timestamps.** The request asked for those; they do
not exist. `curated` (boolean) is the only quality signal, and it is real
production data, not inferred.

## Other tables

| Table | Exists | Rows | Note |
|---|---|---|---|
| `drill_favorites` | Yes | — | Created by migration 041. **Named `drill_favorites`, not `favorite_drills`** — the earlier audit had the name wrong |
| `favorite_drills` | Responds 200 | count unavailable | See caveat below |
| `saved_drills` | Yes | **2** | See next section |
| `playbook_templates` | Yes | 8 | Not in `supabase-schema.sql` |
| `practice_plans` | Yes | 16 | |
| `plan_session_log` | Yes | — | Migration 035 |

Caveat: PostgREST returns 200 for some names that may resolve via views or
aliases; `drill_favorites` is the one migration 041 creates and the one
`lib/drills.ts` queries.

## What `saved_drills` actually is

**Answered definitively.** It is a per-team bookmark of **AI chat responses**,
not a link to the drill library.

Columns: `id`, `team_id`, `title`, `content`, `category`, `tags`,
`source_message_id`, `created_at`, `updated_at`.

- `content` holds the **full markdown of a chat answer** — a sample row is a
  700-word fly-ball drill sequence written by the assistant.
- `source_message_id` points at the chat message it was saved from.
- **No foreign key, no drill ID, no name reference to `drill_resources`.** The
  relationship the request asked about does not exist in any form.
- **2 rows in all of production.**
- Read by chat at `app/api/chat/route.ts:264` (`title, category`, limit 10) and
  rendered into the prompt as a "saved drills" summary.

**Verdict: legacy and effectively unused.** It predates `drill_resources` as a
library, is still wired into the chat prompt, and holds two rows. It is not a
drill table and should not be reasoned about as one.

## Migrations 032–041

| Migration | Marker probed | Result |
|---|---|---|
| 032 opponent lineup | table `game_opponent_lineup` | **APPLIED** |
| 033 opponent threads | `chat_threads.opponent_team_id` | **APPLIED** |
| 034 staff access | table `team_members` | **APPLIED** |
| 035 plan sessions | table `plan_session_log` | **APPLIED** |
| 036 plan progression | `drill_resources.youtube_start_seconds`, `prescriptions.plan_steps` | **APPLIED** |
| 037 journal into entries | `entries.legacy_journal_id` | **NOT APPLIED** |
| 038 practice recap | `practice_sessions.what_worked` | **APPLIED** |
| 039 practice schedule | `practice_plans.scheduled_for` | **NOT APPLIED** |
| 040 repair subscribed free | no schema change to probe | **INCONCLUSIVE** |
| 041 coach drills + favourites | table `drill_favorites`, `drill_resources.created_by_coach_id` | **APPLIED** |

Also confirmed applied (from recent work): 042 `opponent_appearances.pitching_line`,
043 `opponent_teams.is_own_team`.

**044 is inconclusive by this method** — it makes `user_events.user_id`
nullable rather than adding a column, and column presence cannot distinguish
that. Run the verification query inside `migrations/044_anonymous_seo_events.sql`.

### The two unapplied migrations matter

**037** — `entries.legacy_journal_id` absent means the journal-into-entries
backfill has not run. Old `player_journal_entries` may not be visible in the
activity log.

**039** — `practice_plans.scheduled_for` absent. `app/api/practice-plan` and the
practice UI reference scheduling; any code path touching `scheduled_for` or
`recap_dismissed_at` will fail against production. Worth checking before the
next practice-planning change.

## Not verified

The request asked for types, nullability, defaults, constraints and foreign
keys. **PostgREST cannot return these**, and port 5432 is blocked from this
environment, so `information_schema` was unreachable.

To complete it, run in the Supabase SQL editor (read-only):

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('drill_resources','problem_taxonomy','drill_problem_map',
                     'drill_favorites','saved_drills')
ORDER BY table_name, ordinal_position;

SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
       kcu.column_name, ccu.table_name AS references_table
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu USING (constraint_name)
LEFT JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
WHERE tc.table_name IN ('drill_resources','problem_taxonomy','drill_problem_map',
                        'drill_favorites','saved_drills')
ORDER BY tc.table_name, tc.constraint_type;
```

Also unrun: `migrations/CHECK_SCHEMA.sql` and
`migrations/DIAGNOSE_DRILL_LIBRARY.sql` in full, for the same reason.
