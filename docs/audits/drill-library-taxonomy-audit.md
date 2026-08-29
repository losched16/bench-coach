# Drill taxonomy — current state

Discovery pass, 29 Aug 2026.

**This report is structural. The counts are not in it, because this audit ran
from the repository and the drill records live in Supabase.**

To fill in every number below:

```bash
node scripts/drill-audit.mjs taxonomy
```

That script is read-only — SELECT statements only, no writes anywhere in the
file. It prints each section headed exactly as below.

---

## What the taxonomy actually is

There are **five** independent ways a drill is classified, and they were added
at different times for different reasons. None of them is a general-purpose tag
system.

| Dimension | Column | Type | Controlled? |
|---|---|---|---|
| Skill area | `skill_category` | TEXT | **No** — free text, known to be inconsistently cased |
| Difficulty | `difficulty_level` | TEXT | **No** — free text |
| Sequence | `progression_level` | INT | Numeric, no defined scale in the schema |
| What it fixes | `common_flaws_fixed` | TEXT[] | **No** — free strings |
| What it trains | `mechanic_focus` | TEXT[] | **No** — free strings |

Plus one that *is* controlled:

| Problem vocabulary | `problem_taxonomy.slug` + `drill_problem_map` | Controlled, hand-curated |

**There is no `tags` column, no `keywords` column, and no `search_terms`
column.** When the audit brief asks about "tags", the honest answer is that
`common_flaws_fixed` and `mechanic_focus` are performing that job, and they are
uncontrolled string arrays.

### Why the free text matters

`app/api/practice-plan/route.ts:191` filters categories with `ilike`-any rather
than `in`, carrying this comment:

> `// ilike-any rather than 'in', because the stored categories are inconsistently cased.`

The inconsistency is known and routed around. `lib/focusAreas.ts:174` then
hardcodes the expected spellings (`'fielding (infield)'`, `'fielding (fly
balls)'`, `'soft toss'`). **Any category in the database not on that list is
invisible to the practice planner for that focus.** The taxonomy script's
"skill_category" section against `PRACTICE_FOCUS_CATEGORIES` will show whether
that is happening.

`scoreDrillRelevance` (`lib/analysis.ts:101`) tokenises and stems these arrays,
so `"Dropping back shoulder"` and `"dropping back shoulder"` score identically
— **but** the exact-match paths (`in('skill_category', categories)` at
`app/api/prescribe/route.ts:246`) are case-sensitive. Casing matters in some
code paths and not others, which is the worst of both.

## Age

Age is represented **four separate ways**, and they do not agree:

| Column | Type | Used by |
|---|---|---|
| `min_age` / `max_age` | INT | The only one that filters anything (prescribe) |
| `age_range` | TEXT (e.g. `"8-10"`) | Displayed to the model in chat and the practice menu. Never filtered |
| `age_relevance` | TEXT[] (migration 011) | No read path found in this audit |
| `progression_level` | INT | A proxy for developmental stage, not age |

The prescribe filter requires `playerAge && min_age && max_age` all present, so
its real coverage is the count of drills carrying **both** bounds. The script
reports that as `BOTH min and max`.

`age_relevance` was added by migration 011 alongside the do-not-coach flags. No
code in this repository reads it. Worth confirming whether it was ever
populated.

## Skill level and difficulty

`difficulty_level` is free text ranked by `DIFFICULTY_RANK` in
`app/api/prescribe/route.ts`. **Any value not in that map sorts last** — a drill
labelled `"beginner"` lowercase, or `"Easy"`, silently ranks below every
recognised value. The taxonomy script lists every distinct value so this is
checkable.

`progression_level` is an integer with no documented scale. A known issue
flagged in an earlier session: `stageOf()` in `lib/progression.ts` clamps to 3,
while live drill data contains `progression_level = 4`. **That is a real,
outstanding bug** and it is in scope for this audit only as an observation.

## Status and suppression

| Column | Meaning |
|---|---|
| `status` | `'approved'` by default (migration 008). Prescribe accepts `approved` or NULL |
| `do_not_coach_flag` / `do_not_coach_note` | Migration 011 |

**`do_not_coach_flag` is not in the chat drill select list**
(`app/api/chat/route.ts:277`), so chat cannot see it and cannot honour it. The
practice planner's `DRILL_SELECT` does not include it either.

## What the script reports

Run `node scripts/drill-audit.mjs taxonomy` for:

- `skill_category` with counts, plus **categories differing only by
  case/whitespace**
- `difficulty_level`, `progression_level`, `competition_level`, `status` counts
- age: `min_age` / `max_age` / both present; `age_range` values;
  `age_relevance` values
- every distinct `common_flaws_fixed` and `mechanic_focus` value with frequency
- **values used exactly once** in each array (candidates for consolidation)
- **case/whitespace-variant tag values** — these are distinct strings to the
  exact-match paths
- tag density: drills by flaw count, drills with none of either
- problem taxonomy: problems by category, drills mapped to none, and
  **problems with zero approved drills**

That last one matters most. A problem with no drills is a diagnosis the app can
make and then not act on.

## Not fixed

Per the brief, nothing here is corrected. Documenting only.

One standing constraint from earlier work should carry into any redesign:
**never take a problem in `problem_taxonomy` to zero prescribable drills.**
Coverage beats quality — a mediocre drill beats an undiagnosable problem.
