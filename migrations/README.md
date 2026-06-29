# Migrations

SQL migrations for Bench Coach. The project creates/edits Supabase tables via
the **Supabase SQL editor** (dashboard), so each file here is paste-ready. Run
them in numeric order.

> ⚠️ As of this commit, **none of these have been applied to the live database.**
> They are reviewable proposals.

| File | Purpose | Destructive? |
|---|---|---|
| `001_prescription_engine.sql` | Adds prescription columns to `drill_resources` + creates `problem_taxonomy` and `drill_problem_map`. | No — additive only |
| `002_seed_problem_taxonomy.sql` | Seeds ~35 canonical problems with NL aliases. | No — idempotent upsert |
| `003_backfill_and_normalize.sql` | Normalizes duplicate `skill_category` values; auto-maps drills→problems from existing flaw/focus tags. | Low — updates 8 category strings; inserts map rows |

## Background

See [`docs/drill-audit.md`](../docs/drill-audit.md) for the full audit that
motivated these changes (current schema, gap analysis, and design rationale for
the join-table approach).

## After applying

- The two review queries at the bottom of `003` show mapping coverage and which
  drills still have no problem mapping (those need a manual or AI-assisted pass).
- `reps_guidance`, `frequency_guidance`, `est_duration_minutes`, `success_markers`,
  and `progression_level` are intentionally left for a follow-up data pass — they
  require real coaching input, not free-text matching.

`supabase-schema.sql` should also be updated to include `drill_resources`,
`playbook_templates`, and these new tables so the schema is reproducible from
version control (currently it isn't).
