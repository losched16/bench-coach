#!/usr/bin/env bash
# Apply 069 then 070 to a real Postgres and prove the content lands correctly.
#
# 070 is generated, which removes the quoting class of bug but not the others.
# What can still be wrong: a stage inserted against the wrong pathway, a
# prerequisite chain that does not form, a re-run that duplicates rather than
# replaces, or a DELETE whose cascade reaches further than intended.
#
# The claims:
#
#   1. it applies cleanly on top of 069
#   2. every pathway, stage, drill link and problem link named in the file lands
#   3. stage numbers are 1..n with no gaps and no duplicates, per pathway
#   4. exactly one stage per pathway has no prerequisite, and the chain is
#      otherwise complete
#   5. every stage-drill link points at a real drill row
#   6. re-running REPLACES rather than duplicates
#   7. it writes nothing to drill_resources, problem_taxonomy or drill_problem_map
#
#   npm run test:migration-070

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG69="$ROOT/migrations/069_development_pathways.sql"
MIG70="$ROOT/migrations/070_pathway_content.sql"
WORK=$(mktemp -d /tmp/bc-pg70-XXXXXX)
PORT=${PGPORT_TEST:-55470}
SOCK="$WORK/sock"

[ -f "$MIG70" ] || { echo "SKIP: $MIG70 not generated yet — run npm run emit:pathways." >&2; exit 0; }

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

PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $f$;

CREATE TABLE public.drill_resources (
  id uuid PRIMARY KEY, drill_name text, status text, created_by_coach_id uuid);
CREATE TABLE public.problem_taxonomy (slug text PRIMARY KEY, label text);
CREATE TABLE public.drill_problem_map (
  drill_id uuid, problem_slug text, PRIMARY KEY (drill_id, problem_slug));
SQL

# Seed exactly the drills and problems 070 names, so "every reference resolves"
# is a fact about the generated file rather than an assumption about the seed.
grep -oE "SELECT s\.id, '[0-9a-f-]{36}'" "$MIG70" \
  | grep -oE "'[0-9a-f-]{36}'" | sort -u \
  | sed -E "s/'(.*)'/INSERT INTO public.drill_resources(id, drill_name) VALUES ('\1', 'seeded');/" \
  | PSQL -v ON_ERROR_STOP=1 -q

# Line-oriented, not multiline: the generated file puts the INSERT and its
# SELECT on separate lines, and grep -oE cannot see across them. A problem link
# is the only place a bare "SELECT s.id, '<slug>'" appears — the drill links
# carry a uuid and two more values on the same line.
grep -oE "^SELECT s\.id, '[a-z][a-z0-9-]*'$" "$MIG70" \
  | grep -oE "'[a-z][a-z0-9-]*'" | sort -u \
  | sed -E "s/'(.*)'/INSERT INTO public.problem_taxonomy(slug, label) VALUES ('\1', 'seeded');/" \
  | PSQL -v ON_ERROR_STOP=1 -q

SEEDED_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
SEEDED_PROBLEMS=$(Q "SELECT count(*) FROM public.problem_taxonomy")
[ "$SEEDED_DRILLS" -gt 50 ] || fail "only $SEEDED_DRILLS drills seeded — the id extraction is wrong"
pass "$SEEDED_DRILLS distinct drills and $SEEDED_PROBLEMS problems referenced by 070"

# ── 1. applies on top of 069 ────────────────────────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG69" >/dev/null || fail "069 did not apply"
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG70" >/dev/null || fail "070 did not apply on top of 069"
pass "069 then 070 apply cleanly"

# ── 2. everything the file names actually landed ────────────────────────────
FILE_PATHWAYS=$(grep -c "^INSERT INTO public.development_pathways$" "$MIG70" || true)
FILE_STAGES=$(grep -c "^INSERT INTO public.development_pathway_stages$" "$MIG70" || true)
FILE_LINKS=$(grep -c "^INSERT INTO public.development_pathway_stage_drills" "$MIG70" || true)
FILE_PROBS=$(grep -c "^INSERT INTO public.development_pathway_stage_problems" "$MIG70" || true)

DB_PATHWAYS=$(Q "SELECT count(*) FROM public.development_pathways")
DB_STAGES=$(Q "SELECT count(*) FROM public.development_pathway_stages")
DB_LINKS=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills")
DB_PROBS=$(Q "SELECT count(*) FROM public.development_pathway_stage_problems")

[ "$DB_PATHWAYS" = "$FILE_PATHWAYS" ] || fail "file names $FILE_PATHWAYS pathways, database has $DB_PATHWAYS"
[ "$DB_STAGES" = "$FILE_STAGES" ] || fail "file names $FILE_STAGES stages, database has $DB_STAGES"
[ "$DB_LINKS" = "$FILE_LINKS" ] || fail "file names $FILE_LINKS drill links, database has $DB_LINKS"
[ "$DB_PROBS" = "$FILE_PROBS" ] || fail "file names $FILE_PROBS problem links, database has $DB_PROBS"
pass "$DB_PATHWAYS pathways, $DB_STAGES stages, $DB_LINKS drill links, $DB_PROBS problem links — all landed"

# ── 3. stage numbering is 1..n per pathway ──────────────────────────────────
BADNUM=$(Q "SELECT count(*) FROM (
  SELECT pathway_id FROM public.development_pathway_stages
   GROUP BY pathway_id
  HAVING min(stage_number) <> 1
      OR max(stage_number) <> count(*)
      OR count(DISTINCT stage_number) <> count(*)) x")
[ "$BADNUM" = "0" ] || fail "$BADNUM pathway(s) have gappy or duplicated stage numbers"
pass "every pathway numbers its stages 1..n with no gaps"

# ── 4. the prerequisite chain forms ─────────────────────────────────────────
ROOTS=$(Q "SELECT count(*) FROM public.development_pathway_stages WHERE prerequisite_stage_id IS NULL")
[ "$ROOTS" = "$DB_PATHWAYS" ] || fail "expected exactly $DB_PATHWAYS first stages, found $ROOTS"
pass "exactly one stage per pathway has no prerequisite"

BADCHAIN=$(Q "SELECT count(*) FROM public.development_pathway_stages s
  JOIN public.development_pathway_stages p ON p.id = s.prerequisite_stage_id
 WHERE p.pathway_id <> s.pathway_id OR p.stage_number <> s.stage_number - 1")
[ "$BADCHAIN" = "0" ] || fail "$BADCHAIN stage(s) point at a prerequisite in the wrong pathway or the wrong place"
pass "every prerequisite is the immediately preceding stage of the same pathway"

# ── 5. every drill link resolves ────────────────────────────────────────────
ORPHAN=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills sd
  LEFT JOIN public.drill_resources d ON d.id = sd.drill_id WHERE d.id IS NULL")
[ "$ORPHAN" = "0" ] || fail "$ORPHAN stage-drill link(s) point at a drill that does not exist"
pass "every stage-drill link resolves to a real drill"

NORATIONALE=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills
  WHERE rationale IS NULL OR length(trim(rationale)) < 40")
[ "$NORATIONALE" = "0" ] || fail "$NORATIONALE link(s) carry no real rationale"
pass "every stage-drill link carries a rationale"

# ── 6. re-running replaces rather than duplicates ───────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG70" >/dev/null || fail "second run of 070 errored"
AGAIN_STAGES=$(Q "SELECT count(*) FROM public.development_pathway_stages")
AGAIN_LINKS=$(Q "SELECT count(*) FROM public.development_pathway_stage_drills")
[ "$AGAIN_STAGES" = "$DB_STAGES" ] || fail "re-run changed stage count: $DB_STAGES -> $AGAIN_STAGES"
[ "$AGAIN_LINKS" = "$DB_LINKS" ] || fail "re-run changed link count: $DB_LINKS -> $AGAIN_LINKS"
pass "re-running 070 replaces rather than duplicates"

# ── 7. the library is untouched ─────────────────────────────────────────────
NOW_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
NOW_PROBLEMS=$(Q "SELECT count(*) FROM public.problem_taxonomy")
NOW_MAP=$(Q "SELECT count(*) FROM public.drill_problem_map")
[ "$NOW_DRILLS" = "$SEEDED_DRILLS" ] || fail "drill_resources changed: $SEEDED_DRILLS -> $NOW_DRILLS"
[ "$NOW_PROBLEMS" = "$SEEDED_PROBLEMS" ] || fail "problem_taxonomy changed"
[ "$NOW_MAP" = "0" ] || fail "drill_problem_map gained $NOW_MAP rows — 070 must not write there"
pass "drill_resources, problem_taxonomy and drill_problem_map untouched"

# 070 contains no statement that could reach the library.
if grep -nE "^\s*(UPDATE|DELETE|INSERT)\s+(INTO\s+)?public\.(drill_resources|drill_problem_map|problem_taxonomy)\b" "$MIG70"; then
  fail "070 contains a statement targeting the drill library"
fi
pass "070 contains no statement targeting the drill library at all"

echo ""
echo "070 applies on 069, lands every row it names, chains its stages, and touches nothing else."
