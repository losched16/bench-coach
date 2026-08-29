# Drill library — production data quality

Read-only export of live Supabase, 29 Aug 2026. Every number below is counted
from `docs/audits/drill-library-production.json`, which is verbatim
`drill_resources`. Nothing was inferred from prose.

---

## Overall

| | |
|---|---|
| **Total drill records** | **206** |
| Approved | **206** (100%) |
| Non-approved | **0** — no `pending_review`, no `rejected` |
| System drills | **206** |
| **Coach-authored** (`created_by_coach_id` set) | **0** |
| `do_not_coach_flag = true` | **N/A — the column does not exist on drills** (see schema verification) |
| With `source` | 43 (21%) |
| Without `source` | 163 (79%) |
| `competition_level` | 206 × `both`. No drill is scoped rec-only or travel-only |

Migration 041 shipped coach-authored drills; **nobody has created one.** Every
row is curated library content. The `visibleDrills` scoping machinery is
therefore currently protecting an empty set — correct, and not yet load-bearing.

## Field completeness

| Field | Populated | Blank | % |
|---|---|---|---|
| `drill_name` | 206 | 0 | 100% |
| `description` | 206 | 0 | 100% |
| `skill_category` | 206 | 0 | 100% |
| `primary_skill` | 206 | 0 | 100% |
| `secondary_skill` | 86 | 120 | 42% |
| `tags` | 86 | 120 | 42% |
| `mechanic_focus` | 206 | 0 | 100% |
| `common_flaws_fixed` | 171 | 35 | 83% |
| `difficulty_level` | 206 | 0 | 100% |
| `progression_level` | 108 | 98 | 52% |
| `min_age` | 206 | 0 | 100% |
| `max_age` | 206 | 0 | 100% |
| `age_range` | 206 | 0 | 100% |
| `equipment_needed` | 202 | 4 | 98% |
| **`est_duration_minutes`** | **0** | **206** | **0%** |
| `duration` (legacy) | 0 | 206 | 0% |
| `reps_guidance` | 72 | 134 | 35% |
| `frequency_guidance` | 72 | 134 | 35% |
| `success_markers` | 72 | 134 | 35% |
| `competition_level` | 206 | 0 | 100% |
| `ai_coaching_notes` | 206 | 0 | 100% |
| `safety_notes` | 38 | 168 | 18% |
| `indoor_outdoor` | 206 | 0 | 100% |
| `space_required` | 206 | 0 | 100% |
| `requires_partner` | 206 | 0 | 100% |
| `youtube_video_id` | 205 | 1 | 100% |
| `youtube_url` | 206 | 0 | 100% |
| **`youtube_start_seconds`** | **0** | **206** | **0%** |
| `thumbnail_url` | 205 | 1 | 100% |
| `channel` | 206 | 0 | 100% |
| `source` | 43 | 163 | 21% |
| `url_verified_at` | 43 | 163 | 21% |
| `status` | 206 | 0 | 100% |
| `created_by_coach_id` | 0 | 206 | 0% |
| `instructions` | — | — | **NOT A COLUMN** |

Fields the request listed that are **not columns** in production:
`instructions`, `age_relevance` (it is on `problem_taxonomy`),
`do_not_coach_flag`, `do_not_coach_note` (same).

## The three numbers that decide the redesign

**1. `est_duration_minutes` is 0% populated.** The practice planner cannot
budget time because there is no time to budget with — not because the column
is unselected (though it is also that), but because it is empty on every row.
Any deterministic planner needs this filled first. It is the single highest-value
backfill in the library.

**2. `youtube_start_seconds` is 0% populated, and 103 of 206 drills share a
video with another drill.** One video (`4NOo7JSK6eA`) backs **19 different
drill records**; another backs 10; sixteen videos back 103 drills between them.
Every one of those links opens at 0:00. A coach clicking "Heel-Toe Drill" gets
a 14-minute mechanics video and no indication where the drill is. The column to
fix this exists and has never been used.

**3. The operational metadata is already there.** `indoor_outdoor`,
`space_required` and `requires_partner` are **100% populated** — and no
recommendation surface reads any of them. The earlier audit assumed these
concepts were missing from the schema. They are not missing; they are
disconnected.

## Coaching intelligence

| | |
|---|---|
| `ai_coaching_notes` | **100%** — but a single prose blob, not a cue list |
| `safety_notes` | 18% |
| `success_markers` | 35% |
| Teaching points / common mistakes / corrections / progressions / regressions | **no columns** |

The app generates cues, mistakes and variations per practice block every time it
runs, and has nowhere to save them.

## Provenance

Only 43 drills (21%) record a `source`, and exactly the same 43 have a
`url_verified_at`. The other 163 have neither — no record of where they came
from, and no link check has ever run against them.

## Duplicates and near-duplicates

See `drill-duplicate-candidates.md`. Summary: **2 normalised-name clusters, 1
identical-description pair, and 16 shared-video clusters covering 103 drills.**

## Where the library is genuinely strong

Worth stating plainly, because the gaps above are loud:

- **Age is 100% complete on all three fields, with zero contradictions.**
  `min_age`/`max_age` are populated on every row, and every `age_range` string
  matches its numeric bounds exactly. The prescribe age filter — which needs
  both bounds — works on 100% of the library.
- **`difficulty_level` is perfectly clean.** Three values, all inside
  `DIFFICULTY_RANK`. No stragglers sorting to 99.
- **`skill_category` has no case or whitespace variants.** The `ilike` workaround
  in `app/api/practice-plan/route.ts:191` is defending against a problem that
  does not currently exist in the data.
- **`mechanic_focus` is 100% populated.**
- **Every problem in the taxonomy has at least one approved drill.** The
  "never take a problem to zero" rule is currently satisfied.
