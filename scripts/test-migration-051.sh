#!/usr/bin/env bash
# Apply migration 051 to a real Postgres and prove provisioning is atomic.
#
# The claim 051 makes is that a league, its owner and its licence are created
# together or not at all. That is not a claim a unit test can check — it is a
# property of a transaction, and only a database has transactions. So this
# stands one up, breaks the licence insert on purpose, and asserts that the
# league row is gone afterwards.
#
#   npm run test:migration-051
#
# Same shape as test-migration-050.sh: a THROWAWAY cluster in a temp directory,
# on a unix socket with listen_addresses empty, so it touches no network and no
# real database, torn down on exit whether it passes or fails.

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-pg51-XXXXXX)
PORT=${PGPORT_TEST:-55433}
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
Q()  { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc "$1"; }

pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

# ---------------------------------------------------------------------------
# Minimal stand-in: only what 051 touches.
# ---------------------------------------------------------------------------
cat > "$WORK/00_bootstrap.sql" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TABLE leagues (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL, slug text UNIQUE NOT NULL,
  logo_url text, website text, city text, state text, governing_body text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pilot')),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

CREATE TABLE league_seasons (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE);

CREATE TABLE league_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','commissioner','admin','coaching_director','viewer')),
  UNIQUE (league_id, user_id));

CREATE TABLE league_licenses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  league_season_id uuid REFERENCES league_seasons(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('trial','active','expired','suspended','canceled')),
  plan text, coach_limit int CHECK (coach_limit IS NULL OR coach_limit >= 0),
  starts_at timestamptz, ends_at timestamptz,
  stripe_customer_id text, contract_reference text,
  created_at timestamptz DEFAULT now());

INSERT INTO auth.users (id) VALUES ('22222222-2222-2222-2222-222222222222');
SQL

$PSQL -f "$WORK/00_bootstrap.sql" > /dev/null || fail "bootstrap did not apply"

echo ""
echo "migration 051 — atomic league provisioning"

# ---------------------------------------------------------------------------
$PSQL -f "$ROOT/migrations/051_provision_league_atomically.sql" > /dev/null \
  || fail "051 did not apply"
pass "applies cleanly"

$PSQL -f "$ROOT/migrations/051_provision_league_atomically.sql" > /dev/null \
  || fail "051 is not idempotent — a second apply failed"
pass "is idempotent (CREATE OR REPLACE, re-runnable)"

# ---------------------------------------------------------------------------
# Refusals must write nothing at all.
# ---------------------------------------------------------------------------
R=$(Q "SELECT reason FROM bc_provision_league('No Owner','no-owner')")
[ "$R" = "owner_required" ] || fail "expected owner_required, got '$R'"
[ "$(Q "SELECT count(*) FROM leagues")" = "0" ] || fail "a refused provision created a league"
pass "no owner: refused, and no league row written"

R=$(Q "SELECT reason FROM bc_provision_league('Ghost','ghost', p_owner_user_id => '11111111-1111-1111-1111-111111111111')")
[ "$R" = "owner_not_found" ] || fail "expected owner_not_found, got '$R'"
[ "$(Q "SELECT count(*) FROM leagues")" = "0" ] || fail "an unknown owner created a league"
pass "unknown owner: refused, and no league row written"

R=$(Q "SELECT reason FROM bc_provision_league('','')")
[ "$R" = "name_required" ] || fail "expected name_required, got '$R'"
pass "empty name: refused"

R=$(Q "SELECT reason FROM bc_provision_league('!!!','')")
[ "$R" = "slug_invalid" ] || fail "expected slug_invalid, got '$R'"
pass "a name that slugifies to nothing: refused"

# ---------------------------------------------------------------------------
# The happy path writes exactly three rows.
# ---------------------------------------------------------------------------
SLUG=$(Q "SELECT league_slug FROM bc_provision_league('BenchCoach Test League', NULL, p_owner_user_id => '22222222-2222-2222-2222-222222222222', p_coach_limit => 20)")
[ "$SLUG" = "benchcoach-test-league" ] || fail "slug was '$SLUG', expected benchcoach-test-league"
pass "slug generated from the name matches the UI's slugify"

COUNTS=$(Q "SELECT (SELECT count(*) FROM leagues)||'/'||(SELECT count(*) FROM league_members WHERE role='owner')||'/'||(SELECT count(*) FROM league_licenses)")
[ "$COUNTS" = "1/1/1" ] || fail "expected 1 league / 1 owner / 1 licence, got $COUNTS"
pass "creates league + owner + licence together (1/1/1)"

LIC=$(Q "SELECT status||'/'||coach_limit FROM league_licenses")
[ "$LIC" = "trial/20" ] || fail "expected trial/20, got $LIC"
pass "licence defaults to trial and honours the coach limit"

[ "$(Q "SELECT count(*) FROM league_licenses WHERE starts_at IS NOT NULL")" = "1" ] \
  || fail "licence has no start date"
pass "licence starts immediately"

# ---------------------------------------------------------------------------
R=$(Q "SELECT reason FROM bc_provision_league('BenchCoach Test League', NULL, p_owner_user_id => '22222222-2222-2222-2222-222222222222')")
[ "$R" = "slug_taken" ] || fail "expected slug_taken, got '$R'"
[ "$(Q "SELECT count(*) FROM leagues")" = "1" ] || fail "a duplicate created a second league"
pass "duplicate slug: refused, no partial provisioning"

# ---------------------------------------------------------------------------
# THE POINT OF THE WHOLE MIGRATION.
#
# Force the licence insert to fail after the league and owner rows are written.
# A negative coach_limit violates the CHECK, which raises inside the function
# body — so the whole transaction must roll back.
# ---------------------------------------------------------------------------
BEFORE=$(Q "SELECT count(*) FROM leagues")
set +e
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
  "SELECT ok FROM bc_provision_league('Rollback Test','rollback-test', p_owner_user_id => '22222222-2222-2222-2222-222222222222', p_coach_limit => -5)" \
  > "$WORK/rollback.txt" 2>&1
set -e
grep -q "violates check constraint" "$WORK/rollback.txt" \
  || fail "expected the licence insert to fail; it did not"
AFTER=$(Q "SELECT count(*) FROM leagues")
[ "$BEFORE" = "$AFTER" ] || fail "league count went $BEFORE -> $AFTER; the failed provision was not rolled back"
[ "$(Q "SELECT count(*) FROM leagues WHERE slug='rollback-test'")" = "0" ] \
  || fail "ORPHANED LEAGUE: the league survived a failed licence insert"
pass "a licence failure rolls the league and owner back — no orphan"

# And the same failure through the OLD sequential path, to show what 051 fixes.
$PSQL -c "INSERT INTO leagues (name, slug, status) VALUES ('Old Path','old-path','pilot')" > /dev/null
set +e
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
  "INSERT INTO league_licenses (league_id, status, coach_limit) SELECT id,'trial',-5 FROM leagues WHERE slug='old-path'" \
  > /dev/null 2>&1
set -e
ORPHAN=$(Q "SELECT count(*) FROM leagues WHERE slug='old-path'")
[ "$ORPHAN" = "1" ] || fail "harness error: the sequential path should have left an orphan to contrast with"
pass "for contrast: the sequential path leaves the orphan 051 prevents"
$PSQL -c "DELETE FROM leagues WHERE slug='old-path'" > /dev/null

# ---------------------------------------------------------------------------
# The function must not be reachable from the browser client.
# ---------------------------------------------------------------------------
for role in anon authenticated; do
  GRANTED=$(Q "SELECT has_function_privilege('$role','bc_provision_league(text,text,text,text,text,text,text,text,uuid,text,text,integer,timestamptz,timestamptz,text)','EXECUTE')")
  [ "$GRANTED" = "f" ] || fail "$role can EXECUTE bc_provision_league — it could mint itself a licensed league"
  pass "$role cannot execute bc_provision_league"
done
GRANTED=$(Q "SELECT has_function_privilege('service_role','bc_provision_league(text,text,text,text,text,text,text,text,uuid,text,text,integer,timestamptz,timestamptz,text)','EXECUTE')")
[ "$GRANTED" = "t" ] || fail "service_role cannot execute bc_provision_league — the route would break"
pass "service_role can execute it"

echo ""
echo "migration 051: applies cleanly, is idempotent, refuses without writing, provisions all three rows together, rolls back a mid-provision failure, and is revoked from the browser client."
