#!/usr/bin/env bash
# Does migrations/EXPORT_SCHEMA.sql actually produce a usable baseline?
#
#   npm run test:export-schema
#
# This is the check that matters before anyone pastes that file into the
# Supabase SQL editor against production. The script is read-only, so it cannot
# do harm — but it can waste a round trip by producing SQL that does not
# re-apply, and the round trip is a person copying a few thousand lines out of
# a browser.
#
# So: build a database, export it with EXPORT_SCHEMA.sql, apply that export to
# a SECOND empty database, and compare the two. Anything present in the first
# and missing from the second is something the export drops on the floor.
#
# Two throwaway clusters, unix sockets, listen_addresses empty. No network, no
# real database, torn down on exit either way.

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-export-XXXXXX)
PORT=${PGPORT_TEST:-55441}
SOCK="$WORK/sock"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN." >&2; exit 0
fi

RUNAS=""
if [ "$(id -u)" = "0" ]; then
  for c in ubuntu postgres; do if id "$c" >/dev/null 2>&1; then RUNAS="$c"; break; fi; done
  [ -n "$RUNAS" ] || { echo "SKIP: root with no unprivileged user." >&2; exit 0; }
  chown -R "$RUNAS" "$WORK"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }
cleanup() {
  run "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$SOCK"; [ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORK"
run "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust" >"$WORK/initdb.log" 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $SOCK -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1
sleep 2

P()  { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$2"; }
Q()  { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -d "$1" -tAc "$2"; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

echo ""
echo "EXPORT_SCHEMA.sql — does its output rebuild the database it came from?"
echo ""

# ---------------------------------------------------------------------------
# Source database: the same bootstrap verify:bootstrap uses.
# ---------------------------------------------------------------------------
Q postgres "SELECT 1" >/dev/null
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -q -c "CREATE DATABASE src" >/dev/null
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -q -c "CREATE DATABASE dst" >/dev/null

cat > "$WORK/00_supabase.sql" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email TEXT);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$ LANGUAGE sql STABLE;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL

for db in src dst; do
  P "$db" "$WORK/00_supabase.sql" >/dev/null 2>&1 || fail "Supabase stand-in failed on $db"
done
pass "two throwaway databases, both with the Supabase stand-in"

P src "$ROOT/supabase-schema.sql" >"$WORK/base.log" 2>&1 || fail "supabase-schema.sql"
for f in $(ls "$ROOT"/migrations/[0-9][0-9][0-9]_*.sql | sort); do
  case "$(basename "$f")" in *_VERIFY.sql|000_baseline.sql) continue;; esac
  P src "$f" >/dev/null 2>&1 || true   # the known failures; verify:bootstrap reports them
done
SRC_T=$(Q src "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
pass "source database built ($SRC_T tables)"

# ---------------------------------------------------------------------------
# Export it, exactly as the SQL editor would.
# ---------------------------------------------------------------------------
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -d src -tA -F $'\t' \
  -f "$ROOT/migrations/EXPORT_SCHEMA.sql" > "$WORK/export.tsv" 2>"$WORK/export.err" \
  || { cat "$WORK/export.err"; fail "EXPORT_SCHEMA.sql did not run"; }

[ -s "$WORK/export.tsv" ] || fail "EXPORT_SCHEMA.sql produced no rows"
pass "EXPORT_SCHEMA.sql runs and returns $(wc -l < "$WORK/export.tsv") rows"

# Strip the row-number column the SQL editor shows, leaving the DDL.
cut -f2- "$WORK/export.tsv" > "$WORK/baseline.sql"
echo "" >> "$WORK/baseline.sql"

# ---------------------------------------------------------------------------
# Apply the export to the empty database.
# ---------------------------------------------------------------------------
if ! P dst "$WORK/baseline.sql" >"$WORK/apply.log" 2>&1; then
  echo ""
  echo "  the exported baseline did not apply. First errors:"
  grep -m5 -E "ERROR|psql:" "$WORK/apply.log" | sed 's/^/    /'
  fail "exported baseline does not re-apply"
fi
pass "the exported baseline applies to an empty database"

# ---------------------------------------------------------------------------
# Compare. Anything in src and not in dst is something the export loses.
# ---------------------------------------------------------------------------
cmp_sets() {
  local what="$1" sql="$2"
  Q src "$sql" | sort > "$WORK/src.$what"
  Q dst "$sql" | sort > "$WORK/dst.$what"
  local s d missing extra
  s=$(wc -l < "$WORK/src.$what"); d=$(wc -l < "$WORK/dst.$what")
  missing=$(comm -23 "$WORK/src.$what" "$WORK/dst.$what" | head -10)
  extra=$(comm -13 "$WORK/src.$what" "$WORK/dst.$what" | head -10)
  if [ -n "$missing" ]; then
    echo "  FAIL  $what: $s in source, $d rebuilt — missing:"
    echo "$missing" | sed 's/^/          /'
    FAILURES=$((FAILURES + 1))
  elif [ -n "$extra" ]; then
    echo "  ----  $what: $d rebuilt vs $s, extra (usually harmless):"
    echo "$extra" | sed 's/^/          /'
  else
    pass "$what: all $s reproduced"
  fi
}

FAILURES=0
echo ""
cmp_sets tables   "SELECT tablename FROM pg_tables WHERE schemaname='public'"
cmp_sets views    "SELECT viewname FROM pg_views WHERE schemaname='public'"
cmp_sets columns  "SELECT table_name||'.'||column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public'"
cmp_sets indexes  "SELECT indexname FROM pg_indexes WHERE schemaname='public'"
cmp_sets constraints "SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'"
cmp_sets functions "SELECT proname||'('||pg_get_function_identity_arguments(p.oid)||')' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'"
cmp_sets triggers "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal"
cmp_sets rls      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity"
cmp_sets policies "SELECT tablename||'.'||policyname FROM pg_policies WHERE schemaname='public'"

# The security property this whole exercise exists to preserve.
echo ""
for fn in bc_claim_league_seat bc_release_league_seat; do
  EX=$(Q src "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")
  [ "$EX" = "0" ] && continue
  for role in anon authenticated; do
    S=$(Q src "SELECT has_function_privilege('$role', p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")
    D=$(Q dst "SELECT has_function_privilege('$role', p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fn'")
    [ "$S" = "$D" ] || { echo "  FAIL  $fn: $role EXECUTE is '$S' in production and '$D' rebuilt"; FAILURES=$((FAILURES+1)); }
  done
  [ "$FAILURES" = "0" ] && pass "$fn: the revoke from anon and authenticated survives the export"
done

# search_path on SECURITY DEFINER functions must carry across, or the rebuilt
# database is differently vulnerable from the one it copied.
SP_SRC=$(Q src "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')")
SP_DST=$(Q dst "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')")
[ "$SP_SRC" = "$SP_DST" ] || { echo "  FAIL  SECURITY DEFINER search_path: $SP_SRC pinned in source, $SP_DST rebuilt"; FAILURES=$((FAILURES+1)); }
[ "$SP_SRC" = "$SP_DST" ] && pass "SECURITY DEFINER search_path settings survive ($SP_SRC pinned)"

# ---------------------------------------------------------------------------
echo ""
if [ "$FAILURES" != "0" ]; then
  fail "$FAILURES difference(s) between the source database and the one rebuilt from its export"
fi
echo "EXPORT_SCHEMA.sql round-trips: its output rebuilds the database it came from,"
echo "including RLS state, policies, and the function revokes."
echo ""
