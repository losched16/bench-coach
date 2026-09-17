#!/usr/bin/env bash
# Apply 069, 070 and then 071 to a real Postgres and prove 071 does what it says.
#
# 071 is hand-written, unlike 070, so the quoting class of bug is back: an
# unescaped apostrophe inside a coaching note takes the whole migration down and
# no amount of reading it catches that reliably. It has also never been executed
# anywhere, because production approval is blocked. This runs it.
#
# The claims:
#
#    1. it applies cleanly on top of 069 + 070
#    2. exactly six drill rows are added and none is removed
#    3. seven taxonomy mappings are added, using only slugs that already exist
#    4. the stretching routine is off the baserunning stage
#    5. seventeen stage-drill links are added
#    6. the re-ranks landed — the stance drill reinforces, do-or-die progresses
#    7. no stage is left with zero drills
#    8. every stage-drill link still points at a real drill row
#    9. re-running changes nothing
#   10. the pw_st / pw_ds / pw_ps helpers are gone
#
#   npm run test:migration-071

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG69="$ROOT/migrations/069_development_pathways.sql"
MIG70="$ROOT/migrations/070_pathway_content.sql"
MIG71="$ROOT/migrations/071_pathway_coverage_expansion.sql"
WORK=$(mktemp -d /tmp/bc-pg71-XXXXXX)
PORT=${PGPORT_TEST:-55471}
SOCK="$WORK/sock"

[ -f "$MIG70" ] || { echo "SKIP: $MIG70 not generated yet — run npm run emit:pathways." >&2; exit 0; }
[ -f "$MIG71" ] || { echo "SKIP: $MIG71 not written yet." >&2; exit 0; }

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN — this check needs a server." >&2
  exit 0
fi

RUNAS=""
if [ "$(id -u)" = "0" ]; then
  for candidate in ubuntu postgres; do
    if id "$candidate" >/dev/null 2>&1; then RUNAS="$candidate"; break; fi
  done
  [ -n "$RUNAS" ] || { echo "SKIP: running as root and no unprivileged user to fall back to." >&2; exit 0; }
fi

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }
cleanup() {
  run "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$SOCK"
[ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORK"
run "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust" > "$WORK/initdb.log" 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $SOCK -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1
sleep 2

PSQL() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }
Q() { PSQL -tAqc "$1" | tr -d '[:space:]'; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

# The drill_resources stub needs every column 071 writes, or the insert fails
# for a reason that has nothing to do with the migration being wrong.
PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $f$;

CREATE TABLE public.drill_resources (
  id uuid PRIMARY KEY, drill_name text, skill_category text, primary_skill text,
  secondary_skill text, description text, ai_coaching_notes text, safety_notes text,
  success_markers text[], reps_guidance text, regression_notes text, progression_notes text,
  mechanic_focus text[], common_flaws_fixed text[], tags text[],
  age_range text, min_age int, max_age int, difficulty_level text, progression_level int,
  competition_level text, equipment_needed text[], indoor_outdoor text, space_required text,
  requires_partner boolean, est_duration_minutes int, activity_format text, practice_roles text[],
  min_players int, max_players int, ideal_group_size int, min_coaches int, station_friendly boolean,
  rep_density text, idle_time_risk text, engagement_level text, competition_style text,
  instruction_complexity text, throwing_load text, physical_intensity text,
  mixed_skill_friendly boolean, resource_kind text, status text, source text,
  created_by_coach_id uuid);
CREATE TABLE public.problem_taxonomy (slug text PRIMARY KEY, label text);
CREATE TABLE public.drill_problem_map (
  drill_id uuid, problem_slug text, sort_order int, curated boolean,
  PRIMARY KEY (drill_id, problem_slug));
SQL

# Seed every drill and problem 070 AND 071 name, so a missing reference is a
# fact about the files rather than a gap in the seed.
{ grep -oE "SELECT s\.id, '[0-9a-f-]{36}'" "$MIG70" | grep -oE "[0-9a-f-]{36}"
  grep -oE "'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'" "$MIG71" | tr -d "'"
} | sort -u \
  | sed -E "s/(.*)/INSERT INTO public.drill_resources(id, drill_name) VALUES ('\1', 'seeded') ON CONFLICT DO NOTHING;/" \
  | PSQL -v ON_ERROR_STOP=1 -q

{ grep -oE "^SELECT s\.id, '[a-z][a-z0-9-]*'$" "$MIG70" | grep -oE "'[a-z][a-z0-9-]*'" | tr -d "'"
  grep -oE ",'[a-z][a-z0-9-]+',[0-9]+,true\)" "$MIG71" | grep -oE "'[a-z][a-z0-9-]+'" | tr -d "'"
} | sort -u \
  | sed -E "s/(.*)/INSERT INTO public.problem_taxonomy(slug, label) VALUES ('\1', 'seeded') ON CONFLICT DO NOTHING;/" \
  | PSQL -v ON_ERROR_STOP=1 -q

# The six rows 071 CREATES must not be pre-seeded, or "six were added" proves
# nothing. The seed above deliberately grabbed every uuid in the file, so take
# those six back out before applying.
NEW_IDS=$(sed -n '/^INSERT INTO public.drill_resources (/,/ON CONFLICT (id) DO NOTHING/p' "$MIG71" \
  | grep -oE "^\('[0-9a-f-]{36}'" | grep -oE "[0-9a-f-]{36}")
NEW_COUNT=$(echo "$NEW_IDS" | grep -c . || true)
[ "$NEW_COUNT" = "6" ] || fail "expected 6 new drill rows in 071, parsed $NEW_COUNT"
for id in $NEW_IDS; do Q "DELETE FROM public.drill_resources WHERE id = '$id'" >/dev/null; done

BEFORE_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
BEFORE_MAPS=$(Q "SELECT count(*) FROM public.drill_problem_map")
pass "$BEFORE_DRILLS drills and $(Q "SELECT count(*) FROM public.problem_taxonomy") problems seeded"

# ── 1. applies cleanly ──────────────────────────────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG69" >/dev/null || fail "069 did not apply"
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG70" >/dev/null || fail "070 did not apply on top of 069"

# 070 was applied to production in parts using three helper functions. 071 drops
# them, and DROP IF EXISTS on something that never existed must not fail.
BEFORE_LINKS=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills")
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG71" >/dev/null || fail "071 did not apply on top of 070"
pass "069, 070 and 071 apply cleanly in order"

# ── 2. six drills added, none removed ───────────────────────────────────────
AFTER_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
[ "$AFTER_DRILLS" = "$((BEFORE_DRILLS + 6))" ] \
  || fail "expected $((BEFORE_DRILLS + 6)) drills, found $AFTER_DRILLS"
pass "exactly 6 drill rows added, none removed"

UNAPPROVED=$(Q "SELECT count(*) FROM public.drill_resources
  WHERE id IN ($(echo "$NEW_IDS" | sed "s/.*/'&'/" | paste -sd,))
    AND (status <> 'approved' OR resource_kind <> 'activity' OR created_by_coach_id IS NOT NULL)")
[ "$UNAPPROVED" = "0" ] || fail "$UNAPPROVED new row(s) are not approved curated activities"
pass "all six are approved, curated activities"

EMPTY=$(Q "SELECT count(*) FROM public.drill_resources
  WHERE id IN ($(echo "$NEW_IDS" | sed "s/.*/'&'/" | paste -sd,))
    AND (coalesce(length(description),0) < 200
      OR coalesce(length(ai_coaching_notes),0) < 200
      OR coalesce(array_length(success_markers,1),0) < 3
      OR regression_notes IS NULL OR progression_notes IS NULL)")
[ "$EMPTY" = "0" ] || fail "$EMPTY new row(s) fall short of the Phase 2C instruction standard"
pass "all six carry description, coaching notes, 3+ success markers, easier and harder"

# ── 3. taxonomy ─────────────────────────────────────────────────────────────
AFTER_MAPS=$(Q "SELECT count(*) FROM public.drill_problem_map")
[ "$AFTER_MAPS" = "$((BEFORE_MAPS + 7))" ] \
  || fail "expected $((BEFORE_MAPS + 7)) mappings, found $AFTER_MAPS"
pass "7 taxonomy mappings added"

ORPHAN=$(Q "SELECT count(*) FROM public.drill_problem_map m
  LEFT JOIN public.problem_taxonomy t ON t.slug = m.problem_slug WHERE t.slug IS NULL")
[ "$ORPHAN" = "0" ] || fail "$ORPHAN mapping(s) point at a problem slug that does not exist"
pass "no mapping invents a problem slug"

# ── 4. the bad link is gone ─────────────────────────────────────────────────
STRETCH=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills d
  JOIN public.development_pathway_stages s ON s.id = d.stage_id
  JOIN public.development_pathways p ON p.id = s.pathway_id
 WHERE p.slug = 'baserunning-development' AND s.stage_key = 'out-of-the-box'
   AND d.drill_id = 'b194ff1d-f857-47d5-911c-0bab06c6e6bc'")
[ "$STRETCH" = "0" ] || fail "the stretching routine is still attached to baserunning stage 1"
pass "the mis-curated stretching link is removed"

# ── 5. seventeen links added ────────────────────────────────────────────────
AFTER_LINKS=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills")
EXPECTED_LINKS=$((BEFORE_LINKS + 17 - 1))   # 17 inserted, 1 deleted
[ "$AFTER_LINKS" = "$EXPECTED_LINKS" ] \
  || fail "expected $EXPECTED_LINKS stage-drill links, found $AFTER_LINKS"
pass "17 stage-drill links added, 1 removed"

# ── 6. the re-ranks landed ──────────────────────────────────────────────────
GRIPROLE=$(Q "SELECT d.role FROM public.development_pathway_stage_drills d
  JOIN public.development_pathway_stages s ON s.id = d.stage_id
  JOIN public.development_pathways p ON p.id = s.pathway_id
 WHERE p.slug = 'build-the-swing' AND s.stage_key = 'grip'
   AND d.drill_id = '252404f0-38c3-481f-a18b-f7ce0262903f'")
[ "$GRIPROLE" = "reinforcement" ] || fail "the stance drill is still '$GRIPROLE' on the grip stage"

DODROLE=$(Q "SELECT d.role FROM public.development_pathway_stage_drills d
  JOIN public.development_pathway_stages s ON s.id = d.stage_id
  JOIN public.development_pathways p ON p.id = s.pathway_id
 WHERE p.slug = 'outfield-development' AND s.stage_key = 'ground-ball-approach'
   AND d.drill_id = 'daea5efc-42ce-4a83-9f07-a867dd6fbddd'")
[ "$DODROLE" = "progression" ] || fail "do-or-die is still '$DODROLE' on the ground-ball stage"
pass "both re-ranks landed — stance reinforces, do-or-die progresses"

# ── 7. no stage left empty ──────────────────────────────────────────────────
EMPTYSTAGE=$(Q "SELECT count(*) FROM public.development_pathway_stages s
  WHERE NOT EXISTS (SELECT 1 FROM public.development_pathway_stage_drills d WHERE d.stage_id = s.id)")
[ "$EMPTYSTAGE" = "0" ] || fail "$EMPTYSTAGE stage(s) have no drill at all after 071"
pass "every stage still has at least one drill"

# ── 8. every link resolves ──────────────────────────────────────────────────
DANGLING=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills d
  LEFT JOIN public.drill_resources r ON r.id = d.drill_id WHERE r.id IS NULL")
[ "$DANGLING" = "0" ] || fail "$DANGLING stage-drill link(s) point at nothing"
pass "every stage-drill link resolves to a real drill row"

# ── 9. re-running changes nothing ───────────────────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG71" >/dev/null || fail "071 is not re-runnable"
RERUN_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
RERUN_LINKS=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills")
RERUN_MAPS=$(Q "SELECT count(*) FROM public.drill_problem_map")
[ "$RERUN_DRILLS" = "$AFTER_DRILLS" ] || fail "re-running 071 changed the drill count"
[ "$RERUN_LINKS" = "$AFTER_LINKS" ] || fail "re-running 071 duplicated stage-drill links"
[ "$RERUN_MAPS" = "$AFTER_MAPS" ] || fail "re-running 071 duplicated taxonomy mappings"
pass "071 is idempotent"

# ── 10. the helpers are gone ────────────────────────────────────────────────
HELPERS=$(Q "SELECT count(*) FROM pg_proc WHERE proname IN ('pw_st','pw_ds','pw_ps')")
[ "$HELPERS" = "0" ] || fail "$HELPERS helper function(s) survived 071"
pass "pw_st, pw_ds and pw_ps are dropped"

# ── optional: emit the after-coverage CSV from this database ────────────────
# Ground truth beats arithmetic. With COVERAGE_AFTER set, dump the per-stage
# coverage the pathway actually has once 071 has applied, using the same status
# rule as the Phase 2E audit: a hand-written note wins, then no primary is a
# GAP, then fewer than three drills is THIN.
if [ -n "${COVERAGE_AFTER:-}" ]; then
  PSQL -v ON_ERROR_STOP=1 --csv -t -q -c "
    SELECT p.slug, s.stage_number, s.name, s.objective,
           count(*) FILTER (WHERE d.role = 'primary'),
           count(*) FILTER (WHERE d.role = 'regression'),
           count(*) FILTER (WHERE d.role = 'reinforcement'),
           count(*) FILTER (WHERE d.role = 'progression'),
           count(*) FILTER (WHERE d.role = 'assessment'),
           count(*) FILTER (WHERE d.role = 'game_application'),
           (SELECT count(*) FROM public.development_pathway_stage_problems q WHERE q.stage_id = s.id),
           CASE WHEN coalesce(array_length(s.mastery_signals,1),0) > 0 THEN 'yes' ELSE 'no' END,
           CASE WHEN s.notes ILIKE 'GAP%' THEN 'GAP'
                WHEN s.notes ILIKE 'THIN%' THEN 'THIN'
                WHEN count(*) FILTER (WHERE d.role = 'primary') = 0 THEN 'GAP'
                WHEN count(d.id) < 3 THEN 'THIN'
                ELSE 'READY' END,
           coalesce(s.notes, '')
      FROM public.development_pathways p
      JOIN public.development_pathway_stages s ON s.pathway_id = p.id
      LEFT JOIN public.development_pathway_stage_drills d ON d.stage_id = s.id
     GROUP BY p.slug, s.id, s.stage_number, s.name, s.objective, s.mastery_signals, s.notes
     ORDER BY p.slug, s.stage_number" > "$COVERAGE_AFTER"
  sed -i '1i pathway,stage_number,stage_name,stage_objective,primary_drill_count,regression_count,reinforcement_count,progression_count,assessment_count,game_application_count,taxonomy_problem_count,mastery_signal_present,status,gap_notes' "$COVERAGE_AFTER"
  echo "  wrote $COVERAGE_AFTER"
fi

echo ""
echo "071 passes all 10 checks against a real PostgreSQL."
