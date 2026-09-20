#!/usr/bin/env bash
# Migration 076 — per-user UI preferences, and the isolation that matters.
#
# The check this file exists for is "ANOTHER USER READS NONE OF IT". Dismissed
# help is small stuff, but the table is keyed on auth.uid() and a policy that
# leaked would leak for every key anyone ever stores here.
#
# Also asserts that coach_preferences — which is AI Memory, not UI state — is
# untouched, because reusing it was the obvious shortcut and the wrong one.
#
#   npm run test:migration-076
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
W=$(mktemp -d /tmp/bc-76-XXXXXX); mkdir -p "$W/sock"; chown -R ubuntu "$W" 2>/dev/null || true
su ubuntu -c "$PGBIN/initdb -D $W/data -U postgres --auth=trust" >/dev/null 2>&1
su ubuntu -c "$PGBIN/pg_ctl -D $W/data -o '-p 55476 -k $W/sock -c listen_addresses=' -l $W/pg.log start" >/dev/null 2>&1
sleep 2
P(){ $PGBIN/psql -h "$W/sock" -p 55476 -U postgres "$@"; }
Q(){ P -tAqc "$1" | tr -d '[:space:]'; }
pass(){ echo "  PASS  $1"; }
fail(){ echo "FAILED: $1"; exit 1; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3' got '$2'"; }
P -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.coach_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid, key text, value text);
INSERT INTO auth.users (id) VALUES
 ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
SQL
P -v ON_ERROR_STOP=1 -q -f migrations/076_user_ui_prefs.sql >/dev/null 2>&1 || fail "076 did not apply"
pass "076 applies cleanly"
P -v ON_ERROR_STOP=1 -q -f migrations/076_user_ui_prefs.sql >/dev/null 2>&1 || fail "076 is not idempotent"
pass "re-running changes nothing"
AS(){ $PGBIN/psql -h "$W/sock" -p 55476 -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE authenticated; SET test.uid='$1'; $2" >/dev/null 2>&1 && echo yes || echo no; }
ASQ(){ $PGBIN/psql -h "$W/sock" -p 55476 -U postgres -tAq -c "SET ROLE authenticated; SET test.uid='$1'; $2" 2>/dev/null | tr -d '[:space:]'; }
U1=11111111-1111-1111-1111-111111111111
U2=22222222-2222-2222-2222-222222222222
eq "a user may save their own preference" "$(AS $U1 "INSERT INTO user_ui_prefs (user_id,key,value) VALUES ('$U1','help.dismissed.practice-plans','{\"dismissed\":true}')")" "yes"
eq "a user may NOT write a preference for someone else" "$(AS $U1 "INSERT INTO user_ui_prefs (user_id,key,value) VALUES ('$U2','x','{}')")" "no"
eq "a user reads their own" "$(ASQ $U1 "SELECT count(*) FROM user_ui_prefs")" "1"
eq "ANOTHER USER READS NONE OF IT" "$(ASQ $U2 "SELECT count(*) FROM user_ui_prefs")" "0"
$PGBIN/psql -h "$W/sock" -p 55476 -U postgres -q -c "SET ROLE authenticated; SET test.uid='$U2'; UPDATE user_ui_prefs SET value='{\"dismissed\":false}'" >/dev/null 2>&1 || true
eq "and cannot update it" "$(Q "SELECT value->>'dismissed' FROM user_ui_prefs")" "true"
eq "anon holds no grant" "$(Q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_name='user_ui_prefs' AND grantee='anon'")" "0"
eq "four policies" "$(Q "SELECT count(*) FROM pg_policies WHERE tablename='user_ui_prefs'")" "4"
eq "no policy uses the broken capability words" "$(Q "SELECT count(*) FROM pg_policies WHERE tablename='user_ui_prefs' AND (coalesce(qual,'')~'''(record|decide)''' OR coalesce(with_check,'')~'''(record|decide)''')")" "0"
if P -q -c "INSERT INTO user_ui_prefs (user_id,key,value) VALUES ('$U1',repeat('x',200),'{}')" >/dev/null 2>&1; then fail "a runaway key was accepted"; fi
pass "an over-long key is rejected"
eq "AI MEMORY IS UNTOUCHED" "$(Q "SELECT count(*) FROM coach_preferences")" "0"
su ubuntu -c "$PGBIN/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true
rm -rf "$W"
echo ""; echo "All checks passed."
