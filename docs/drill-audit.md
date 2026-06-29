# Drill Library Audit — Prescription Engine Prerequisite

**Date:** 2026-06-29
**Scope:** Audit only. No database or drill code was modified.
**Goal:** Determine what drill metadata exists today vs. what a diagnosis-to-prescription engine needs.

---

## 1. Source of truth

The drill library lives **entirely in a single Supabase (Postgres) table: `drill_resources`**. There is no static file, JSON seed, or local data fixture — and, notably, **no migration or `CREATE TABLE` statement for it anywhere in the repo**.

- `supabase-schema.sql` documents 14 app tables but **does not include `drill_resources`** (nor `playbook_templates`, which is also queried). Both tables were created directly in the Supabase dashboard and never checked into version control. The committed schema file is therefore incomplete as a source of truth.
- Consumers that read the table:
  - [app/api/drills/route.ts](app/api/drills/route.ts) — public lookup API (single / multi / by-category), used by [lib/useDrillResources.ts](lib/useDrillResources.ts) for the chat assistant.
  - [app/dashboard/drills/page.tsx](app/dashboard/drills/page.tsx) — the Drill Library UI; does `select('*')` so its `DrillResource` interface is the most complete in-repo description of the table.
  - [app/api/practice-plan/route.ts:90](app/api/practice-plan/route.ts) and [app/api/practice-plan/swap/route.ts:23](app/api/practice-plan/swap/route.ts) — pull drills into generated practice plans.
  - [scripts/enrich-playbooks.js](scripts/enrich-playbooks.js) and [scripts/update-playbook-templates.js](scripts/update-playbook-templates.js) — match drills into `playbook_templates`.

Schema, counts, and sample records below were obtained by **read-only query against the live table** (the only way to see real data, since the schema isn't in the repo).

> ⚠️ **Security issue found while locating the source of truth (out of audit scope, but high severity):** a live Supabase **service-role key** is hardcoded in [scripts/enrich-playbooks.js:6](scripts/enrich-playbooks.js) and [scripts/update-playbook-templates.js:20](scripts/update-playbook-templates.js) and is committed to the repo. The service-role key bypasses Row Level Security. It should be rotated in Supabase and moved to an environment variable. Flagging only — not fixed in this task.

---

## 2. Current schema

Table: **`drill_resources`** — **163 rows.**

| Column | Type | Purpose / notes |
|---|---|---|
| `id` | uuid (PK) | Primary key. |
| `drill_name` | text | Display name; also the fuzzy-match key used everywhere. |
| `description` | text | 1–2 sentence summary. |
| `youtube_url` | text | Source video URL. |
| `youtube_video_id` | text | For embedded player. |
| `thumbnail_url` | text | YouTube thumbnail. |
| `channel` | text | Attribution / source channel. |
| `duration` | (numeric/int) | **Exists but 100% NULL** — never populated. |
| `skill_category` | text | Broad bucket (Hitting, Throwing, etc.). Primary filter/sort key. **Values are inconsistent — see below.** |
| `primary_skill` | text | Usually mirrors `skill_category`. |
| `secondary_skill` | text | Free-text secondary tag; sometimes null. |
| `tags` | text[] | Keyword tags; occasionally null. |
| `age_range` | text | Display string, e.g. `"9-12"`. Fully populated. |
| `min_age` | int | Numeric floor for age filtering. Fully populated. |
| `max_age` | int | Numeric ceiling for age filtering. Fully populated. |
| `difficulty_level` | text | `Beginner` / `Intermediate` / `Advanced`. Fully populated but skewed. |
| `progression_level` | int | Intended fine-grained sequencing. **74% NULL.** |
| `indoor_outdoor` | text | Setting (`Indoor/Outdoor`, `Outdoor`, `Both`). |
| `space_required` | text | `Small` / `Medium` / `Full field`. |
| `requires_partner` | bool | Whether a partner/coach is needed. |
| `equipment_needed` | text[] | Gear list; sometimes null. |
| `mechanic_focus` | text[] | Mechanics the drill targets. Fully populated. |
| `common_flaws_fixed` | text[] | Free-text problems the drill addresses. **21% empty.** |
| `safety_notes` | text | Safety guidance. 93% NULL. |
| `ai_coaching_notes` | text | Coaching cues for the AI to relay. Fully populated. |
| `created_at` | timestamptz | Row insert time. |
| `updated_at` | timestamptz | Row update time. |

### Data-quality observations (relevant to the engine)

**`skill_category` has duplicate/inconsistent values** that will fragment any category-based sequencing:
- `Fielding (Infield)` (9) **and** `Fielding - Infield` (5)
- `Fielding (Fly Balls)` (5) **and** `Fielding - Fly Balls` (3)

Full distribution (163 rows): Hitting 48 · Throwing 36 · Pitching 30 · Fielding (Infield) 9 · Catching 7 · Baserunning 7 · Fielding (Fly Balls) 5 · Fielding - Infield 5 · Soft Toss 4 · Bunting 3 · Fielding - Fly Balls 3 · Arm Care 2 · Warmup 2 · Athletic Development 2.

**`difficulty_level`** is heavily skewed: Beginner 95 · Intermediate 66 · **Advanced 2**. Almost no advanced material to sequence toward.

**`progression_level`** is mostly empty: NULL 120 · level 3 → 29 · level 2 → 12 · level 4 → 2. No level-1 or level-5 rows exist. It cannot currently drive ordering.

**Fully populated / reliable:** `min_age`, `max_age`, `age_range`, `mechanic_focus`, `ai_coaching_notes`, `difficulty_level`.

---

## 3. Sample records (real data, across skills)

```jsonc
// Hitting
{ "drill_name": "High Tee Drill", "skill_category": "Hitting",
  "difficulty_level": "Intermediate", "progression_level": 3, "age_range": "9-12",
  "common_flaws_fixed": ["Dropping hands / under balls"],
  "mechanic_focus": ["tee work","high pitches","posture"],
  "ai_coaching_notes": "Cue: athletic posture + keep hands above ball; match bat path to pitch plane.",
  "duration": null, "safety_notes": null }

// Throwing  (a relatively complete record)
{ "drill_name": "How to Throw the RIGHT WAY", "skill_category": "Throwing",
  "difficulty_level": "Intermediate", "progression_level": 3, "age_range": "6-12",
  "common_flaws_fixed": ["Arm pain / poor mechanics"],
  "mechanic_focus": ["throwing","mechanics","arm care"],
  "safety_notes": "Warm up first; keep throws age-appropriate; stop if pain.",
  "ai_coaching_notes": "Cue: glove-side target; separate on time; smooth arm circle; good follow-through.",
  "duration": null }

// Pitching  (note: common_flaws_fixed null)
{ "drill_name": "5 Youth Pitching Drills From Your Knees", "skill_category": "Pitching",
  "difficulty_level": "Beginner", "progression_level": 2, "age_range": "6-10",
  "common_flaws_fixed": null,
  "mechanic_focus": ["pitching","knee drills","foundation"], "duration": null }

// Fielding (Infield)
{ "drill_name": "Infield Throwing Drill", "skill_category": "Fielding (Infield)",
  "difficulty_level": "Intermediate", "progression_level": 3, "age_range": "9-12",
  "common_flaws_fixed": ["Slow transfer"],
  "mechanic_focus": ["infield","throwing","footwork"], "duration": null }

// Catching  (beginner / fear-of-ball)
{ "drill_name": "How to Get a T-Baller to Catch a Ball", "skill_category": "Catching",
  "difficulty_level": "Beginner", "progression_level": 2, "age_range": "6-8",
  "common_flaws_fixed": ["Fear of ball / low confidence"],
  "equipment_needed": null, "duration": null }

// Baserunning  (common_flaws_fixed null)
{ "drill_name": "How to Add Base Running Into Practice", "skill_category": "Baserunning",
  "difficulty_level": "Intermediate", "progression_level": 3, "age_range": "6-12",
  "common_flaws_fixed": null, "duration": null }

// Bunting  (common_flaws_fixed null)
{ "drill_name": "How to Bunt Like a PRO", "skill_category": "Bunting",
  "difficulty_level": "Intermediate", "progression_level": 3, "age_range": "9-12",
  "common_flaws_fixed": null, "duration": null }

// Arm Care  (progression_level null, richer flaw list)
{ "drill_name": "Baseball Arm Stretches and Pre-Throwing Warm-Up", "skill_category": "Arm Care",
  "difficulty_level": "Beginner", "progression_level": null, "age_range": "6-12",
  "common_flaws_fixed": ["cold arm throwing","stiff shoulders","poor range of motion","arm soreness from inadequate warm-up"],
  "duration": null, "tags": null }
```

These illustrate the core gap: the drill that fixes "Charlie is late on faster pitching" would need to be reachable from a *problem*, but `common_flaws_fixed` is free-text, inconsistent in style/casing, and null on ~1 in 5 drills (including entire useful drills like the bunting and baserunning examples above).

---

## 4. Gap analysis — what a prescription engine needs

| Prescription need | Status | Evidence |
|---|---|---|
| **Map drill → specific problem(s) it fixes** | **PARTIAL** | `common_flaws_fixed` (text[]) is the only field for this. 35/163 (21%) are empty; values are free-text with no controlled vocabulary (`"Dropping hands / under balls"`, `"Slow transfer"`, `"Fear of ball / low confidence"`), so a plain-English diagnosis can't be reliably matched. `mechanic_focus` + `tags` add weak signal. Good enough for keyword search; **not** good enough for deterministic prescription. |
| **Difficulty / progression level** | **PARTIAL** | `difficulty_level` exists and is fully populated, but skewed (only 2 Advanced of 163). `progression_level` (int) is the field intended for foundational→advanced sequencing but is **NULL on 120/163 (74%)** and spans only 2–4. Cannot order a plan today. |
| **Reps / duration / frequency** | **MISSING** | `duration` column exists but is **100% NULL**. There are **no** reps or frequency columns at all. (Note: reps/duration/success do exist inside `playbook_templates.sessions` activity JSON — but that is the playbook system, not the drill library the engine will prescribe from.) |
| **Success marker ("you'll know it's working when…")** | **MISSING** | No column. `ai_coaching_notes` holds *cues* ("keep hands above ball"), not measurable outcomes. The reassessment loop has nothing to check against. |
| **Age / level appropriateness (rec vs travel)** | **PARTIAL** | Age is **EXISTS** and reliable (`min_age`/`max_age`/`age_range` fully populated). But **rec vs travel** competition level is **MISSING** — no field distinguishes them. `difficulty_level` is a rough proxy only. (The app models `league_type` rec/travel/clinic on `seasons`, so the concept exists elsewhere but not on drills.) |

**Summary:** Age targeting and broad skill bucketing are solid. The four things prescription specifically depends on — a reliable problem→drill map, populated progression ordering, dosage (reps/duration/frequency), and success markers for the reassessment loop — are each missing or only partially present.

---

## 5. Recommended minimal schema additions

All changes below are **additive and non-breaking** — existing columns and the Drill Library UI, chat API, and practice-plan APIs continue to work unchanged.

### 5a. Columns to add to `drill_resources`

```sql
ALTER TABLE drill_resources
  ADD COLUMN problem_tags         TEXT[]  DEFAULT '{}',   -- controlled-vocab problems this drill fixes
  ADD COLUMN reps_guidance        TEXT,                   -- e.g. "3 sets x 10 swings"
  ADD COLUMN frequency_guidance   TEXT,                   -- e.g. "2-3x per week"
  ADD COLUMN est_duration_minutes INT,                    -- numeric duration for plan budgeting (the existing `duration` column is unused/100% NULL)
  ADD COLUMN success_markers      TEXT[]  DEFAULT '{}',   -- "you'll know it's working when…", measurable
  ADD COLUMN competition_level    TEXT    DEFAULT 'both'
    CHECK (competition_level IN ('rec','travel','both'));
```

Why these specifically:
- **`problem_tags`** — the keystone. A normalized, lowercase, kebab-case vocabulary (e.g. `late-swing`, `steps-in-bucket`, `drops-hands`, `slow-transfer`, `fear-of-ball`) is what lets a plain-English complaint map deterministically to drills. Backfill from existing `common_flaws_fixed`; keep `common_flaws_fixed` as the human-readable display string.
- **`reps_guidance` / `frequency_guidance` / `est_duration_minutes`** — dosage. `est_duration_minutes` (numeric) also lets the engine fit a plan into a known practice-time budget. Add new rather than reuse the ambiguous `duration` column.
- **`success_markers`** — the reassessment loop's check condition; without it "know it's working when…" and re-test have nothing to measure.
- **`competition_level`** — rec vs travel scope, additive and defaulted to `both` so nothing breaks.

### 5b. Stronger option for the problem map (recommended if effort allows)

A free-text/array tag set drifts over time. A normalized taxonomy + join table makes diagnosis matching reliable and reportable:

```sql
CREATE TABLE problem_taxonomy (
  slug        TEXT PRIMARY KEY,        -- 'late-swing'
  label       TEXT NOT NULL,           -- 'Late on faster pitching'
  skill_category TEXT,                 -- optional grouping
  aliases     TEXT[] DEFAULT '{}'      -- phrases that map here, for NL diagnosis
);

CREATE TABLE drill_problem_map (
  drill_id     UUID REFERENCES drill_resources(id) ON DELETE CASCADE,
  problem_slug TEXT REFERENCES problem_taxonomy(slug) ON DELETE CASCADE,
  PRIMARY KEY (drill_id, problem_slug)
);
```

The `problem_tags` column (5a) is the minimal path; this join-table model is the durable one. Either can be adopted without touching existing code.

### 5c. Data cleanup needed before the engine ships (no schema change)

1. **Normalize `skill_category`** — merge `Fielding - Infield` → `Fielding (Infield)` and `Fielding - Fly Balls` → `Fielding (Fly Balls)` so sequencing isn't fragmented.
2. **Backfill `progression_level`** for the 120 NULL rows (and consider a consistent 1–5 scale; today only 2–4 are used).
3. **Backfill `problem_tags`** from `common_flaws_fixed`, and fill the 35 drills where it's empty.

---

## Appendix — out-of-scope items noted

- Live Supabase **service-role key committed** in `scripts/enrich-playbooks.js` and `scripts/update-playbook-templates.js` (see §1) — rotate and move to env var.
- `scripts/seo-generator/node_modules/` is committed and should be gitignored (per task brief).
- `README.md` and `FILE_STRUCTURE.md` are stale; neither documents `drill_resources` or `playbook_templates`, which is part of why the schema isn't discoverable from the repo.
- `supabase-schema.sql` should be updated to include `drill_resources` and `playbook_templates` so the schema is reproducible from version control.
