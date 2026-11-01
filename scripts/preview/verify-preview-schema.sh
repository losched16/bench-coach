#!/usr/bin/env bash
# Can the isolated preview be built from this repository alone, and is the
# synthetic seed safe?  Runs on a THROWAWAY local Postgres; nothing external.
#
#   npm run preview:verify
#
# 1. applies scripts/preview/migration-order.txt to an empty database
# 2. creates the five synthetic auth users and runs seed-synthetic.sql
# 3. proves the seed refuses to run a second time (and so on a populated project)
# 4. proves scripts/preview/check-env.mjs refuses production, a live Stripe key, and flags left on

set -uo pipefail
PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK=$(mktemp -d /tmp/bc-preview-XXXXXX); PORT=${PGPORT_TEST:-55491}; SOCK="$WORK/sock"
[ -x "$PGBIN/initdb" ] || { echo "SKIP: no local PostgreSQL 16 at $PGBIN." >&2; exit 0; }
RUNAS=""
if [ "$(id -u)" = "0" ]; then for c in ubuntu postgres; do id "$c" >/dev/null 2>&1 && { RUNAS="$c"; break; }; done; [ -n "$RUNAS" ] || { echo "SKIP: root, no unprivileged user."; exit 0; }; fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$SOCK"; [ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORK"
run "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust" > "$WORK/i.log" 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $SOCK -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1
sleep 2
PSQL() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }
echo ""; echo "Isolated preview: schema build, synthetic seed, environment guard"; echo ""

PSQL -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null 2>"$WORK/s.err" || { cat "$WORK/s.err"; fail "stand-in"; }
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER DATABASE postgres SET search_path = public, extensions;
SET search_path = public, extensions;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email TEXT);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID; $f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), ''); $f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.email', true), ''); $f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb; $f$ LANGUAGE sql STABLE;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
pass "Supabase stand-in"

APPLIED=0; SKIPPED=0; NEEDLIB=0; FAILED=""
while IFS= read -r line; do
  n="${line%%#*}"; n="$(echo "$n" | tr -d '[:space:]')"; [ -z "$n" ] && continue
  opt=0; case "$n" in "~"*) opt=1; n="${n#\~}";; esac
  f="$ROOT/migrations/$n.sql"
  if [ ! -f "$f" ]; then SKIPPED=$((SKIPPED+1)); echo "    skip  $n (not on this branch)"; continue; fi
  if [ "$opt" = 1 ]; then
    if PSQL -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" >/dev/null 2>"$WORK/$n.err"; then APPLIED=$((APPLIED+1))
    elif grep -q "violates foreign key constraint" "$WORK/$n.err"; then NEEDLIB=$((NEEDLIB+1)); echo "    needs production drill library (expected on an empty project): $n"
    else FAILED="$FAILED $n"; echo "    FAIL  $n: $(grep -m1 -oE 'ERROR:.*' "$WORK/$n.err" | head -c 140)"; fi
  elif PSQL -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$WORK/$n.err"; then APPLIED=$((APPLIED+1))
  else FAILED="$FAILED $n"; echo "    FAIL  $n: $(grep -m1 -oE 'ERROR:.*' "$WORK/$n.err" | head -c 140)"; fi
done < "$ROOT/scripts/preview/migration-order.txt"
echo "  applied $APPLIED, content-only (need the drill library) $NEEDLIB, not on this branch $SKIPPED, failed:${FAILED:- none}"
[ -z "$FAILED" ] && pass "every migration in the order file applies to an empty database" || fail "migrations failed:$FAILED"
[ "$(PSQL -tAc "select count(*) from public.players")" = "0" ] && pass "the new database has no players" || fail "not empty"

PSQL -q -c "insert into auth.users (email) values ('owner.syn@example.test'),('admin.syn@example.test'),('contrib.syn@example.test'),('viewer.syn@example.test'),('outsider.syn@example.test')" >/dev/null
PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/preview/seed-synthetic.sql" >"$WORK/seed.out" 2>"$WORK/seed.err" && pass "the synthetic seed runs" || { cat "$WORK/seed.err"; fail "seed failed"; }
[ "$(PSQL -tAc "select count(*) from public.players where name like 'ZZ-SYN%'")" = "4" ] && pass "4 synthetic players, all named ZZ-SYN" || fail "players"
[ "$(PSQL -tAc "select count(*) from public.players where name not like 'ZZ-SYN%'")" = "0" ] && pass "no other player exists" || fail "foreign players"
[ "$(PSQL -tAc "select count(*) from public.team_members")" = "3" ] && pass "three staff roles on team one" || fail "staff"
PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/preview/seed-synthetic.sql" >/dev/null 2>"$WORK/seed2.err" && fail "the seed ran twice" || { grep -q "REFUSED" "$WORK/seed2.err" && pass "the seed refuses to run on a project that already has players or teams" || fail "seed refusal text missing"; }

# The synthetic drill-library fixture: placeholders only, resolves the speed-program mapping, refuses a populated library.
PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/preview/seed-drill-fixture.sql" >"$WORK/dr.out" 2>"$WORK/dr.err" && pass "the synthetic drill fixture loads" || { cat "$WORK/dr.err"; fail "drill fixture failed"; }
[ "$(PSQL -tAc "select count(*) from public.drill_resources where source='synthetic-preview-fixture'")" = "12" ] && pass "12 placeholder drills, all marked synthetic" || fail "fixture count"
[ "$(PSQL -tAc "select count(*) from public.drill_resources where source='synthetic-preview-fixture' and description not like 'SYNTHETIC TEST FIXTURE%'")" = "0" ] && pass "every fixture row says in words that it is a fixture" || fail "fixture wording"
[ "$(PSQL -tAc "select count(*) from public.drill_resources where source='synthetic-preview-fixture' and (ai_coaching_notes is not null or safety_notes is not null or reps_guidance is not null or cardinality(coalesce(success_markers,'{}'::text[])) > 0)")" = "0" ] && pass "no coaching text, safety text or reps were copied into the fixture" || fail "fixture carries drill content"
if [ "$(PSQL -tAc "select to_regclass('public.speed_program_exercise_drills') is not null")" = "t" ]; then
  [ "$(PSQL -tAc "select count(*) from public.speed_program_exercise_drills where drill_name is not null and drill_id is null")" = "0" ] && pass "every speed-program exercise that names a library drill now resolves to a fixture row" || fail "unresolved mapping"
  [ "$(PSQL -tAc "select count(*) from public.speed_program_exercise_drills where match='none' and drill_id is not null")" = "0" ] && pass "the exercise with no library drill stays unmapped (nothing invented)" || fail "none-match got a drill"
  [ "$(PSQL -tAc "select count(distinct drill_id) from public.speed_program_exercise_drills")" = "12" ] && pass "the 14 exercises map onto the 12 fixture drills" || fail "distinct drills"
fi
PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/preview/seed-drill-fixture.sql" >/dev/null 2>"$WORK/dr2.err" && fail "drill fixture ran twice" || { grep -q REFUSED "$WORK/dr2.err" && pass "the drill fixture refuses to run twice (and on a real library)" || fail "fixture refusal text"; }

if [ "$(PSQL -tAc "select to_regclass('public.academy_disputes') is not null")" = "t" ]; then
  [ "$(PSQL -tAc "select count(*) from information_schema.role_table_grants where table_name='academy_disputes' and grantee in ('anon','authenticated')")" = "0" ] && pass "the dispute table gives anon and authenticated no privilege, despite Supabase's default grants" || fail "dispute table grants"
  [ "$(PSQL -tAc "select relrowsecurity::int::text||(select count(*) from pg_policies where tablename='academy_disputes') from pg_class where relname='academy_disputes'")" = "10" ] && pass "the dispute table has row security on and no policy" || fail "dispute table rls"
fi

CE="$ROOT/scripts/preview/check-env.mjs"
export NEXT_PUBLIC_SUPABASE_ANON_KEY=anon SUPABASE_SERVICE_ROLE_KEY=svc STRIPE_WEBHOOK_SECRET=whsec_x
chk() { env "$@" node "$CE" >/dev/null 2>&1 && echo ok || echo refused; }
PREV=abcdefghijklmnopqrst; PROD=zyxwvutsrqponmlkjihg
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_test_x)" = ok ] && pass "check-env accepts a separate project with a test Stripe key" || fail "check-env rejected a good preview"
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PROD.supabase.co STRIPE_SECRET_KEY=sk_test_x)" = refused ] && pass "check-env refuses the production Supabase project" || fail "check-env accepted production"
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_live_x)" = refused ] && pass "check-env refuses a live Stripe key" || fail "check-env accepted a live key"
[ "$(chk NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_test_x)" = refused ] && pass "check-env refuses to run without the production ref to compare against" || fail "check-env ran blind"
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_test_x ACADEMY_LAUNCH=1)" = refused ] && pass "check-env refuses a launch flag that is on without PREVIEW_ALLOW_FLAGS=1" || fail "flag left on"
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_test_x ACADEMY_LAUNCH=1 PREVIEW_ALLOW_FLAGS=1)" = ok ] && pass "...and accepts it when the preview turns it on deliberately" || fail "deliberate flag refused"
[ "$(chk PRODUCTION_SUPABASE_REF=$PROD NEXT_PUBLIC_SUPABASE_URL=https://$PREV.supabase.co STRIPE_SECRET_KEY=sk_test_x VERCEL_ENV=production)" = refused ] && pass "check-env refuses VERCEL_ENV=production" || fail "production env accepted"
echo ""; echo "ALL PASS"
