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
| `010_scouting_reports.sql` | Scouting Reports module: `opponent_teams`, `opponent_players`, `opponent_appearances`, `scouting_entries`, `pitch_count_rules` (seeds Little League / USSSA / Perfect Game defaults), `matchups` + RLS + indexes. | No — additive only, idempotent |
| `050_league_layer.sql` | League layer phase 1: `leagues`, `league_members`, `league_seasons`, `league_divisions`, `league_licenses`, `league_invitations`, three nullable league FKs on `teams`, `bc_league_*` helpers + RLS. | No — additive only, idempotent; no backfill and no seeded data |
| `054_player_reports.sql` | Player development reports: `player_reports`, `player_report_focus_areas`, `player_report_drills` + indexes, RLS (needs 034's helpers) and an `updated_at` trigger. Finalized rows are immutable in RLS as well as in the API. | No — additive only, idempotent |
| `055_report_branding.sql` | One nullable JSONB column on `coaches` — the letterhead a coach's player reports print (name, header line, footer). No RLS change. | No — additive only, idempotent |
| `056_drill_station_intelligence.sql` | Drill & station intelligence phase 1: `drill_activity_families` + 20 nullable columns on `drill_resources` (family, format, player/coach minimums, station fit, engagement, load, progression notes), CHECK vocabularies and two partial indexes. Every column is nullable so all 206 existing rows stay fully eligible. | No — additive only, idempotent; no data written |
| `058_drill_calibration.sql` | Calibration data for 056: 9 activity families, 42 existing drills given real values, and two original BenchCoach activities (`Protect the Castle`, `Protect the Castle + Throw`) inserted with `source = 'benchcoach_original'`. 164 drills are deliberately left uncalibrated. | Low — UPDATEs 42 rows' new columns only and INSERTs 2 drills; no existing value is overwritten |
| `059_coach_count_throwing_load_calibration.sql` | Sets `min_coaches` and `throwing_load` on 22 Throwing / Arm Care / Infield / Team Defense drills. Introduces the library's first `min_coaches = 2` (`Machine-Fed Relay Sequences`), verified to leave 3 solo-coach alternatives on its only taxonomy mapping. | Low — UPDATEs two columns on 22 rows, keyed on id AND name; no existing value is overwritten |
| `060_calibrate_the_drills_that_get_selected.sql` | Sets the same two columns on the 11 drills `validate-live-retrieval` reported selecting while still printing `throw=?` — mostly tee work, whose `throwing_load = 'none'` is what makes a game-tomorrow plan provable rather than coincidental. 059 alone closed neither live finding; this one closed both. | Low — UPDATEs two columns on 11 rows, keyed on id AND name |

## Migration 050 — the league layer

Nothing works until this is applied, and nothing breaks before it is.

The app degrades quietly while the tables are absent: every league query returns
an error that supabase-js reports as `data: null` rather than throwing, so
`getUserEntitlements` sees no league teams, no coach is sponsored, the "Provided
by" badge and the League Admin nav link never render, and `/league-admin`
answers "not found". Existing coaches see no change at all. That is the intended
pre-apply state, not a fallback that needs fixing.

Two things to check after applying, both at the bottom of the file:

- `unaffiliated = teams` and `in_a_league = 0`. Every existing team must still
  have NULL league columns — the migration backfills nothing.
- `leagues`, `license` and `invitation` counts are all 0. No sample league is
  created; a real one is inserted by hand or through the admin flows.

There is no seed. Creating the first league, its licence and its first
administrator is currently three INSERTs in the SQL editor — see
"Known gaps" in the Phase 1 closeout.

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
