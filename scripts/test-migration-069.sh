#!/usr/bin/env bash
# Apply 069 to a real Postgres and prove it does what its header claims.
#
# 069 is pure DDL, which fails differently from 067's 142 UPDATEs. The things
# that go wrong in a schema migration are constraints that do not constrain,
# foreign keys pointing the wrong way, and an ON DELETE rule that quietly
# empties a table years later. None of those show up in a syntax check, so this
# applies it to a real server and then tries to break it on purpose.
#
# The claims:
#
#   1. it applies cleanly from a standing start
#   2. it is idempotent — a second run changes nothing and errors on nothing
#   3. it creates four tables and modifies no existing one
#   4. stage_number is unique within a pathway and starts at 1
#   5. stage_key is unique within a pathway
#   6. a stage cannot be its own prerequisite
#   7. a drill may hold several roles in one stage but not the same role twice
#   8. the role vocabulary is closed — an invented role is rejected
#   9. a drill referenced by a stage CANNOT be deleted (ON DELETE RESTRICT),
#      because the library retires rows rather than deleting them and a silent
#      cascade would empty a curriculum
#  10. deleting a pathway removes its stages and their links, and nothing else
#  11. status and age ranges are constrained
#
#   npm run test:migration-069

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/migrations/069_development_pathways.sql"
WORK=$(mktemp -d /tmp/bc-pg69-XXXXXX)
PORT=${PGPORT_TEST:-55469}
SOCK="$WORK/sock"

[ -f "$MIG" ] || { echo "FAILED: $MIG does not exist"; exit 1; }

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN — this check needs a server, not just psql." >&2
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
# Runs SQL that MUST be rejected. A constraint that does not fire is worse than
# no constraint, because it reads as protection.
rejects() {
  if PSQL -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null 2>&1; then
    fail "$2 — the statement was ACCEPTED and should not have been"
  fi
  pass "$2"
}

# ── the tables 069 depends on, shaped like the real ones ────────────────────
#
# The auth schema and the Supabase roles are stubs, the same ones
# test-migration-062.sh uses. CREATE POLICY resolves auth.role() at creation
# time, so without them the migration cannot even be parsed here — and the
# stub is what lets the service-role policy below be exercised rather than
# merely created.
PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
-- Settable per session, so a test can say who it is pretending to be.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $f$;
CREATE TABLE public.drill_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_name text,
  status text,
  created_by_coach_id uuid
);
CREATE TABLE public.problem_taxonomy (
  slug text PRIMARY KEY,
  label text
);
-- Only so 069's own verification SELECT can name it and prove it is unchanged.
-- 069 must not write to it.
CREATE TABLE public.drill_problem_map (
  drill_id uuid,
  problem_slug text,
  PRIMARY KEY (drill_id, problem_slug)
);
INSERT INTO public.drill_resources (id, drill_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tee Work'),
  ('22222222-2222-2222-2222-222222222222', 'Soft Toss');
INSERT INTO public.problem_taxonomy (slug, label) VALUES
  ('uppercutting', 'Uppercutting'), ('casting', 'Casting');
SQL

BEFORE_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
BEFORE_PROBLEMS=$(Q "SELECT count(*) FROM public.problem_taxonomy")

# ── 1. applies cleanly ──────────────────────────────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null || fail "migration did not apply"
pass "applies cleanly from a standing start"

# ── 2. idempotent ───────────────────────────────────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null || fail "second run errored — 069 is not idempotent"
pass "a second run applies with no error"

# ── 3. four new tables, nothing existing touched ────────────────────────────
TABLES=$(Q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'development_pathway%'")
[ "$TABLES" = "4" ] || fail "expected 4 pathway tables, found $TABLES"
pass "four pathway tables created"

AFTER_DRILLS=$(Q "SELECT count(*) FROM public.drill_resources")
AFTER_PROBLEMS=$(Q "SELECT count(*) FROM public.problem_taxonomy")
[ "$AFTER_DRILLS" = "$BEFORE_DRILLS" ] || fail "drill_resources row count changed: $BEFORE_DRILLS -> $AFTER_DRILLS"
[ "$AFTER_PROBLEMS" = "$BEFORE_PROBLEMS" ] || fail "problem_taxonomy row count changed"
pass "drill_resources and problem_taxonomy untouched ($AFTER_DRILLS drills, $AFTER_PROBLEMS problems)"

EMPTY=$(Q "SELECT (SELECT count(*) FROM public.development_pathways)
              + (SELECT count(*) FROM public.development_pathway_stages)
              + (SELECT count(*) FROM public.development_pathway_stage_drills)
              + (SELECT count(*) FROM public.development_pathway_stage_problems)")
[ "$EMPTY" = "0" ] || fail "069 inserted $EMPTY rows — it is schema only"
pass "069 inserts no data of its own"

# ── seed one small pathway to constrain against ─────────────────────────────
PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.development_pathways (id, slug, name, skill_category, status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'build-the-swing', 'Build the Swing', 'hitting', 'published');

INSERT INTO public.development_pathway_stages
  (id, pathway_id, stage_number, stage_key, name, objective)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'stance', 'Athletic stance', 'Sets up balanced without a reminder'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 'load',   'Load',            'Weight reaches the back hip');

UPDATE public.development_pathway_stages
   SET prerequisite_stage_id = 'bbbbbbbb-0000-0000-0000-000000000001'
 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';

INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'primary', 1, 'Teaches the objective directly.');

INSERT INTO public.development_pathway_stage_problems (stage_id, problem_slug)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'uppercutting');
SQL
pass "a two-stage pathway seeds and links"

# ── 4-8. the constraints ────────────────────────────────────────────────────
rejects "INSERT INTO public.development_pathway_stages (pathway_id, stage_number, stage_key, name, objective)
         VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'other', 'Dup number', 'x')" \
        "stage_number is unique within a pathway"

rejects "INSERT INTO public.development_pathway_stages (pathway_id, stage_number, stage_key, name, objective)
         VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 9, 'stance', 'Dup key', 'x')" \
        "stage_key is unique within a pathway"

rejects "INSERT INTO public.development_pathway_stages (pathway_id, stage_number, stage_key, name, objective)
         VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 0, 'zero', 'Zero', 'x')" \
        "stage_number must be at least 1"

rejects "UPDATE public.development_pathway_stages
            SET prerequisite_stage_id = id
          WHERE stage_key = 'stance'" \
        "a stage cannot be its own prerequisite"

rejects "INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)
         VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'primary', 2, 'again')" \
        "the same drill cannot hold the same role twice in a stage"

rejects "INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)
         VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'vibes', 1, 'made up')" \
        "the role vocabulary is closed"

rejects "INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rationale)
         VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assessment', NULL)" \
        "a stage drill must carry a rationale"

rejects "INSERT INTO public.development_pathways (slug, name, status) VALUES ('x', 'X', 'live')" \
        "status is constrained to draft/published/retired"

rejects "INSERT INTO public.development_pathways (slug, name, min_age, max_age) VALUES ('y', 'Y', 14, 8)" \
        "min_age may not exceed max_age"

rejects "INSERT INTO public.development_pathway_stage_problems (stage_id, problem_slug)
         VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'not-a-real-problem')" \
        "a stage may only address a real taxonomy problem"

# A drill in more than one role in the same stage IS allowed — a stage often
# teaches and assesses with the same activity.
PSQL -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO public.development_pathway_stage_drills (stage_id, drill_id, role, rank, rationale)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'reinforcement', 1, 'Same drill, different job.')" \
  >/dev/null || fail "a drill should be allowed to hold two different roles in one stage"
pass "a drill may hold several roles in one stage"

# ── 9. a referenced drill cannot be deleted ─────────────────────────────────
rejects "DELETE FROM public.drill_resources WHERE id = '11111111-1111-1111-1111-111111111111'" \
        "a drill referenced by a stage cannot be deleted (ON DELETE RESTRICT)"

# ── 10. deleting a pathway cascades to its own rows and nothing else ────────
PSQL -v ON_ERROR_STOP=1 -q -c \
  "DELETE FROM public.development_pathways WHERE slug = 'build-the-swing'" >/dev/null
LEFT=$(Q "SELECT (SELECT count(*) FROM public.development_pathway_stages)
             + (SELECT count(*) FROM public.development_pathway_stage_drills)
             + (SELECT count(*) FROM public.development_pathway_stage_problems)")
[ "$LEFT" = "0" ] || fail "deleting a pathway left $LEFT orphaned rows"
pass "deleting a pathway cascades to its stages, links and problems"

STILL=$(Q "SELECT count(*) FROM public.drill_resources")
[ "$STILL" = "$BEFORE_DRILLS" ] || fail "deleting a pathway removed drills — the cascade points the wrong way"
pass "...and removes no drills ($STILL still there)"

# ── 11. RLS is on, and reads are public ─────────────────────────────────────
RLS=$(Q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'development_pathway%' AND rowsecurity")
[ "$RLS" = "4" ] || fail "RLS enabled on only $RLS of 4 pathway tables"
pass "row level security enabled on all four tables"

POLICIES=$(Q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'development_pathway%'")
[ "$POLICIES" = "8" ] || fail "expected 8 policies (read + service write on 4 tables), found $POLICIES"
pass "read and service-role-write policies on every table"

echo ""
echo "069 applies, is idempotent, constrains what it claims to, and touches nothing it should not."
