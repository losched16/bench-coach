#!/usr/bin/env bash
# Apply 062 + 064 to a real Postgres and prove the duplicate invariants.
#
# These are destructive probes — a chain, a cycle, a self-reference, a delete of
# a canonical that duplicates point at — and none of them belongs anywhere near
# production. A throwaway cluster is the only honest place to assert that a
# constraint REFUSES something, because the only way to know is to try it.
#
# The four claims:
#
#   1. a duplicate cannot point at another duplicate (no chains)
#   2. a canonical that others point at cannot itself become a duplicate
#      (the same chain, built from the far end — the one a CHECK cannot see)
#   3. a row cannot duplicate itself
#   4. a canonical with duplicates cannot be deleted out from under them
#
# And the one that matters most, which is not a constraint at all:
#
#   5. a duplicate is still selectable BY ID, because that is what a finalized
#      player report does when it renders the drill it recommended.
#
#   npm run test:migration-064

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-pg64-XXXXXX)
PORT=${PGPORT_TEST:-55464}
SOCK="$WORK/sock"

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
  chown -R "$RUNAS" "$WORK"
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

PSQL="$PGBIN/psql -h $SOCK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
Q() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAqc "$1" | tr -d '[:space:]'; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

# Inverted on purpose: a constraint that does not refuse is the bug, and a test
# that only runs valid data never finds it.
rejects() {
  if $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null 2>&1
  then return 1; else return 0; fi
}

cat > "$WORK/00_bootstrap.sql" <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $f$;
CREATE TABLE coaches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE drill_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_name text NOT NULL,
  skill_category text NOT NULL,
  youtube_video_id text, youtube_url text, youtube_start_seconds int,
  youtube_start_source text, channel text, thumbnail_url text,
  status text, created_by_coach_id uuid REFERENCES coaches(id)
);
SQL

$PSQL -f "$WORK/00_bootstrap.sql" > /dev/null
$PSQL -f "$ROOT/migrations/062_resource_kind_and_media.sql" > /dev/null 2>&1

echo ""
echo "migration 064 against PostgreSQL 16"
echo ""

$PSQL -f "$ROOT/migrations/064_true_duplicates.sql" > /dev/null 2>&1 || fail "064 did not apply"
pass "applies to a database that has run 062"
$PSQL -f "$ROOT/migrations/064_true_duplicates.sql" > /dev/null 2>&1 || fail "064 is not idempotent"
pass "applies a second time without error (idempotent)"

# CANON <- DUP, plus an unrelated canonical to point things at.
$PSQL > /dev/null <<'SQL'
INSERT INTO drill_resources (id, drill_name, skill_category) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000c','Front Toss','Hitting'),
  ('aaaaaaaa-0000-0000-0000-00000000000d','Front Toss Drill','Hitting'),
  ('aaaaaaaa-0000-0000-0000-00000000000e','Tee Work','Hitting');
UPDATE drill_resources SET duplicate_of_drill_id = 'aaaaaaaa-0000-0000-0000-00000000000c'
  WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000d';
SQL
[ "$(Q "SELECT count(*) FROM drill_resources WHERE duplicate_of_drill_id IS NOT NULL")" = "1" ] \
  || fail "a plain duplicate could not be recorded"
pass "a duplicate can point at a canonical"

C=aaaaaaaa-0000-0000-0000-00000000000c
D=aaaaaaaa-0000-0000-0000-00000000000d
E=aaaaaaaa-0000-0000-0000-00000000000e

rejects "UPDATE drill_resources SET duplicate_of_drill_id='$D' WHERE id='$E'" \
  || fail "a CHAIN was accepted — resolving the real drill becomes an unbounded walk"
pass "a duplicate cannot point at another duplicate (no chains)"

rejects "UPDATE drill_resources SET duplicate_of_drill_id='$E' WHERE id='$C'" \
  || fail "a canonical with dependents became a duplicate — the chain built from the far end"
pass "a canonical other rows point at cannot itself become a duplicate"

rejects "UPDATE drill_resources SET duplicate_of_drill_id='$E' WHERE id='$E'" \
  || fail "a self-reference was accepted"
pass "a row cannot duplicate itself"

rejects "UPDATE drill_resources SET duplicate_of_drill_id='$C' WHERE id='$C'" \
  || fail "a canonical pointed at itself"
pass "...including the canonical of an existing duplicate"

rejects "DELETE FROM drill_resources WHERE id='$C'" \
  || fail "a canonical with duplicates was DELETED, orphaning them"
pass "a canonical with duplicates cannot be deleted out from under them"

# A two-row cycle is the chain rule applied twice; assert it explicitly because
# it is the case that hangs a resolver rather than merely confusing it.
rejects "UPDATE drill_resources SET duplicate_of_drill_id='$D' WHERE id='$C'" \
  || fail "a CYCLE was accepted"
pass "a two-row cycle is refused"

# ---------------------------------------------------------------------------
# The claim that is not a constraint: history still resolves.
# ---------------------------------------------------------------------------
[ "$(Q "SELECT count(*) FROM drill_resources WHERE id='$D'")" = "1" ] \
  || fail "the duplicate row is gone"
pass "the duplicate row still exists"

[ "$(Q "SELECT drill_name FROM drill_resources WHERE id='$D'")" = "FrontTossDrill" ] \
  || fail "the duplicate cannot be selected by id — a finalized report would render a blank"
pass "a duplicate is still selectable BY ID, name intact"

[ "$(Q "SELECT count(*) FROM drill_resources WHERE duplicate_of_drill_id IS NULL")" = "2" ] \
  || fail "expected 2 canonical rows"
pass "discovery-shaped reads see 2 of the 3 rows, not 3"

[ "$(Q "SELECT count(*) FROM drill_resources")" = "3" ] \
  || fail "rows were lost"
pass "all 3 rows are still in the table — nothing was deleted"

echo ""
echo "migration 064: all checks passed."
