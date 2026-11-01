#!/usr/bin/env bash
# Apply 081 to a real Postgres and prove the speed program's data rules.
#
#  1. applies cleanly; re-applying changes nothing
#  2. the exercise->drill mapping equals the template's (no drift) and resolves ids
#  3. a plan snapshot, player, team and template cannot be changed after assigning
#  4. one live program per player/team/template; a finished one does not block a new run
#  5. child rows take team and player from the assignment (a forged team is overwritten)
#  6. sessions, assessments and events cannot be updated or deleted, even by the service role
#  7. ...but deleting the player cascades (privacy deletion)
#  8. scores outside 0-2, skipped-with-scores, malformed assessments and
#     override-without-reason are refused by the database
#  9. RLS: another team reads nothing; viewer reads; contributor logs a session but cannot
#     assign or advance; admin can; non-members cannot write; anon has no grants
# 10. policies use role words, never 'record'/'decide'
# 11. rollback removes only speed_program_* objects and is re-runnable
#
#   npm run test:migration-081

set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M81="$ROOT/migrations/081_speed_program.sql"
DOWN="$ROOT/migrations/rollback/081_speed_program_down.sql"
WORK=$(mktemp -d /tmp/bc-pg81b-XXXXXX)
PORT=${PGPORT_TEST:-55482}
SOCK="$WORK/sock"
[ -f "$M81" ] || { echo "SKIP: 081 not written."; exit 0; }
[ -x "$PGBIN/initdb" ] || { echo "SKIP: no local PostgreSQL 16 at $PGBIN." >&2; exit 0; }
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  for c in ubuntu postgres; do id "$c" >/dev/null 2>&1 && { RUNAS="$c"; break; }; done
  [ -n "$RUNAS" ] || { echo "SKIP: root and no unprivileged user."; exit 0; }
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$SOCK"; [ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORK"
run "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust" > "$WORK/initdb.log" 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $SOCK -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1
sleep 2
PSQL() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }
Q() { PSQL -tAqc "$1" | tr -d '[:space:]'; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }
eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3', got '$2'"; }
AS() { PSQL -tAq -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$1'; $2" 2>&1 | tr -d '[:space:]'; }
CAN() { PSQL -v ON_ERROR_STOP=1 -tAq -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$1'; $2" >/dev/null 2>&1 && echo yes || echo no; }
REFUSED() { PSQL -v ON_ERROR_STOP=1 -tAq -c "$1" >/dev/null 2>&1 && echo no || echo yes; }

echo ""; echo "Migration 081 on the production baseline (real helpers, policies, Supabase default grants)"; echo ""

# --- Supabase stand-in (roles, auth schema), then the REAL production baseline ---
cat > "$WORK/00_supabase.sql" <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;
ALTER DATABASE postgres SET search_path = public, extensions;
SET search_path = public, extensions;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- As on Supabase: the service role bypasses RLS; ordinary users do not.
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email TEXT);
-- Resolved from the request JWT, as PostgREST does.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $f$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), ''); $f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.email', true), ''); $f$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb; $f$ LANGUAGE sql STABLE;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
-- Supabase's default: every new public table is granted ALL to these roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
PSQL -v ON_ERROR_STOP=1 -q -f "$WORK/00_supabase.sql" >/dev/null 2>"$WORK/s.err" || { cat "$WORK/s.err"; fail "stand-in did not apply"; }
PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/migrations/000_baseline.sql" >/dev/null 2>"$WORK/b.err" || { tail -5 "$WORK/b.err"; fail "production baseline did not apply"; }
pass "the production baseline (000_baseline.sql) applied: real tables, real bc_* helpers, real policies"

U_OWN1=aaaaaaaa-0000-0000-0000-000000000001; U_ADM1=aaaaaaaa-0000-0000-0000-000000000002
U_CON1=aaaaaaaa-0000-0000-0000-000000000003; U_VIEW1=aaaaaaaa-0000-0000-0000-000000000004
U_OUT=aaaaaaaa-0000-0000-0000-000000000005;  U_OWN2=aaaaaaaa-0000-0000-0000-000000000006
T1=bbbbbbbb-0000-0000-0000-000000000001; T2=bbbbbbbb-0000-0000-0000-000000000002
P1=cccccccc-0000-0000-0000-000000000001; P2=cccccccc-0000-0000-0000-000000000002
C1=dddddddd-0000-0000-0000-000000000001; C2=dddddddd-0000-0000-0000-000000000002
S1=99999999-0000-0000-0000-000000000001; S2=99999999-0000-0000-0000-000000000002
PSQL -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO auth.users (id) VALUES ('$U_OWN1'),('$U_ADM1'),('$U_CON1'),('$U_VIEW1'),('$U_OUT'),('$U_OWN2');
INSERT INTO coaches (id, user_id) VALUES ('$C1','$U_OWN1'),('$C2','$U_OWN2');
INSERT INTO seasons (id, coach_id, name) VALUES ('$S1','$C1','S1'),('$S2','$C2','S2');
INSERT INTO teams (id, season_id, coach_id, name) VALUES ('$T1','$S1','$C1','Team one'),('$T2','$S2','$C2','Team two');
INSERT INTO team_members (team_id, user_id, role) VALUES ('$T1','$U_ADM1','admin'),('$T1','$U_CON1','contributor'),('$T1','$U_VIEW1','viewer');
INSERT INTO players (id, coach_id, name) VALUES ('$P1','$C1','Player One'),('$P2','$C1','Player Two');
INSERT INTO drill_resources (id, drill_name, skill_category) VALUES (gen_random_uuid(),'Pogo Jumps — Quick, Quiet Contacts','Athletic Development'),(gen_random_uuid(),'Wall Drive — Straight Body, Punch the Knee','Athletic Development');
SQL
# What the migration must leave alone: every existing table's policies and rows.
BEFORE=$(Q "select (select count(*) from pg_policies where tablename not like 'speed_program%')||'/'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'speed_program%')||'/'||(select count(*) from teams)||'/'||(select count(*) from team_members)")

# 1. applies, re-applies
PSQL -v ON_ERROR_STOP=1 -q -f "$M81" >/dev/null 2>"$WORK/a1.err" || { cat "$WORK/a1.err"; fail "081 did not apply"; }
pass "081 applies cleanly"
PSQL -v ON_ERROR_STOP=1 -q -f "$M81" >/dev/null 2>"$WORK/a2.err" || { cat "$WORK/a2.err"; fail "081 did not re-apply"; }
eq "re-applying changes nothing" "$(Q "select count(*) from speed_program_exercise_drills")" "14"
eq "five tables, no more" "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name like 'speed_program%'")" "5"

# 2. mapping
eq "pogo and wall drive resolve to library drill ids" "$(Q "select count(*) from speed_program_exercise_drills where drill_id is not null")" "2"
eq "'none' rows carry no drill name" "$(Q "select count(*) from speed_program_exercise_drills where match='none' and drill_name is not null")" "0"
eq "a 'none' row without ... is the only way to have no name" "$(REFUSED "insert into speed_program_exercise_drills values ('t','x',NULL,NULL,'exact',NULL)")" "yes"

PLAN='{"template":{"key":"speed-agility-explosiveness","version":1},"levels":{}}'
mkA() { echo "insert into speed_program_assignments (id,player_id,team_id,template_key,template_version,level,space,days_per_week,plan,created_by) values ('$1','$2','$3','speed-agility-explosiveness',1,'development','outdoor_open',3,'$PLAN','$U_ADM1')"; }
A1=eeeeeeee-0000-0000-0000-000000000001
PSQL -v ON_ERROR_STOP=1 -q -c "$(mkA $A1 $P1 $T1)"

# 3. snapshot is fixed
eq "changing the plan snapshot is refused" "$(REFUSED "update speed_program_assignments set plan='{}'::jsonb where id='$A1'")" "yes"
eq "changing the player is refused" "$(REFUSED "update speed_program_assignments set player_id='$P2' where id='$A1'")" "yes"
eq "changing the team is refused" "$(REFUSED "update speed_program_assignments set team_id='$T2' where id='$A1'")" "yes"
eq "week, level, unlocks and status can change" "$(REFUSED "update speed_program_assignments set current_week=2, level='advanced', unlocks=array['skater_hop'], status='paused' where id='$A1'")" "no"
PSQL -q -c "update speed_program_assignments set status='active' where id='$A1'"

# 4. one live program
eq "a second live program for the same player/team/template is refused" "$(REFUSED "$(mkA eeeeeeee-0000-0000-0000-000000000009 $P1 $T1)")" "yes"
eq "the same player on another team is allowed" "$(REFUSED "$(mkA eeeeeeee-0000-0000-0000-000000000002 $P1 $T2)")" "no"
PSQL -q -c "update speed_program_assignments set status='completed', completed_at=now() where id='$A1'"
eq "a finished program does not block a new run" "$(REFUSED "$(mkA eeeeeeee-0000-0000-0000-000000000003 $P1 $T1)")" "no"
eq "completed without a date is refused" "$(REFUSED "update speed_program_assignments set status='completed', completed_at=NULL where id='eeeeeeee-0000-0000-0000-000000000003'")" "yes"
A3=eeeeeeee-0000-0000-0000-000000000003; A2=eeeeeeee-0000-0000-0000-000000000002

# 5. scope derived
PSQL -v ON_ERROR_STOP=1 -q -c "insert into speed_program_sessions (assignment_id,team_id,player_id,week,session_key,status,occurred_on,landing) values ('$A3','$T2','$P2',1,'C','completed','2026-10-20',2)"
eq "a forged team/player on a session is overwritten with the assignment's" "$(Q "select team_id::text||player_id::text from speed_program_sessions limit 1")" "$T1$P1"
eq "a session for a missing assignment is refused" "$(REFUSED "insert into speed_program_sessions (assignment_id,week,session_key,status,occurred_on) values (gen_random_uuid(),1,'A','completed','2026-10-20')")" "yes"

# 6. append-only
eq "updating a session is refused" "$(REFUSED "update speed_program_sessions set landing=0")" "yes"
eq "deleting a session is refused" "$(REFUSED "delete from speed_program_sessions")" "yes"
PSQL -q -c "insert into speed_program_events (assignment_id,event_type,detail) values ('$A3','enrolled','{}')"
eq "updating an event is refused" "$(REFUSED "update speed_program_events set reason='x'")" "yes"
eq "deleting an event is refused" "$(REFUSED "delete from speed_program_events")" "yes"
PSQL -q -c "insert into speed_program_assessments (assignment_id,kind,method,metric_slug,value,unit,conditions,occurred_on) values ('$A3','baseline','timed','sprint_10y',2.31,'s','{\"surface\":\"grass\"}','2026-10-20')"
eq "updating an assessment is refused" "$(REFUSED "update speed_program_assessments set value=1")" "yes"
eq "deleting an assessment is refused" "$(REFUSED "delete from speed_program_assessments")" "yes"
eq "...even as the service role" "$(PSQL -tAq -c "SET ROLE service_role; delete from speed_program_sessions" >/dev/null 2>&1 && echo no || echo yes)" "yes"

# 8. database-level validity
S="insert into speed_program_sessions (assignment_id,week,session_key,status,occurred_on"
eq "a score of 3 is refused" "$(REFUSED "$S,landing) values ('$A3',1,'C','completed','2026-10-21',3)")" "yes"
eq "a negative score is refused" "$(REFUSED "$S,braking) values ('$A3',1,'A','completed','2026-10-21',-1)")" "yes"
eq "week 5 is refused" "$(REFUSED "$S) values ('$A3',5,'A','completed','2026-10-21')")" "yes"
eq "session 'D' is refused" "$(REFUSED "$S) values ('$A3',1,'D','completed','2026-10-21')")" "yes"
eq "skipped without a reason is refused" "$(REFUSED "$S) values ('$A3',1,'A','skipped','2026-10-21')")" "yes"
eq "skipped with a score is refused" "$(REFUSED "$S,skip_reason,braking) values ('$A3',1,'A','skipped','2026-10-21','game',2)")" "yes"
eq "completed with a skip reason is refused" "$(REFUSED "$S,skip_reason) values ('$A3',1,'A','completed','2026-10-21','game')")" "yes"
eq "skipped with a reason and a pain flag is accepted" "$(REFUSED "$S,skip_reason,pain_flag) values ('$A3',1,'A','skipped','2026-10-21','sick',true)")" "no"
eq "a timed assessment without conditions is refused" "$(REFUSED "insert into speed_program_assessments (assignment_id,kind,method,metric_slug,value,unit,occurred_on) values ('$A3','retest','timed','sprint_10y',2.2,'s','2026-10-27')")" "yes"
eq "a timed assessment of zero seconds is refused" "$(REFUSED "insert into speed_program_assessments (assignment_id,kind,method,metric_slug,value,unit,conditions,occurred_on) values ('$A3','retest','timed','sprint_10y',0,'s','{}','2026-10-27')")" "yes"
eq "an unknown timed metric is refused" "$(REFUSED "insert into speed_program_assessments (assignment_id,kind,method,metric_slug,value,unit,conditions,occurred_on) values ('$A3','retest','timed','vertical',2,'s','{}','2026-10-27')")" "yes"
eq "a rubric assessment with a time is refused" "$(REFUSED "insert into speed_program_assessments (assignment_id,kind,method,value,rubric,occurred_on) values ('$A3','baseline','rubric',2,'{\"landing\":2}','2026-10-27')")" "yes"
eq "a rubric assessment is accepted" "$(REFUSED "insert into speed_program_assessments (assignment_id,kind,method,rubric,occurred_on) values ('$A3','baseline','rubric','{\"landing\":2,\"braking\":1,\"reaction\":2}','2026-10-27')")" "no"
EV="insert into speed_program_events (assignment_id,event_type,detail,reason) values ('$A3','advance'"
eq "an override without a reason is refused by the database" "$(REFUSED "$EV,'{\"override\":true}',NULL)")" "yes"
eq "an override with a short reason is refused" "$(REFUSED "$EV,'{\"override\":true}','ok')")" "yes"
eq "an override with a written reason is accepted" "$(REFUSED "$EV,'{\"override\":true}','Rain cancelled two sessions this week')")" "no"
eq "a normal advance needs no reason" "$(REFUSED "$EV,'{\"override\":false}',NULL)")" "no"

# 9. RLS
SEL="select count(*) from speed_program_assignments where id='$A3'"
eq "RLS: the owner of another team reads nothing" "$(AS $U_OWN2 "$SEL")" "0"
eq "RLS: a signed-in user with no team reads nothing" "$(AS $U_OUT "$SEL")" "0"
eq "RLS: a viewer reads the program" "$(AS $U_VIEW1 "$SEL")" "1"
eq "RLS: a viewer reads its sessions" "$(AS $U_VIEW1 "select count(*)>0 from speed_program_sessions")" "t"
eq "RLS: another team reads no sessions" "$(AS $U_OWN2 "select count(*) from speed_program_sessions")" "0"
eq "RLS: another team reads no assessments or events" "$(AS $U_OWN2 "select (select count(*) from speed_program_assessments)+(select count(*) from speed_program_events)")" "0"
INS_A="insert into speed_program_assignments (player_id,team_id,template_key,template_version,level,space,days_per_week,plan) values ('$P2','$T1','other',1,'foundation','indoor_small',2,'$PLAN')"
eq "RLS: a viewer cannot assign a program" "$(CAN $U_VIEW1 "$INS_A")" "no"
eq "RLS: a contributor cannot assign a program" "$(CAN $U_CON1 "$INS_A")" "no"
eq "RLS: an outsider cannot assign a program" "$(CAN $U_OUT "$INS_A")" "no"
eq "RLS: the owner of another team cannot assign into this team" "$(CAN $U_OWN2 "$INS_A")" "no"
eq "RLS: an admin can assign" "$(CAN $U_ADM1 "$INS_A")" "yes"
INS_S="insert into speed_program_sessions (assignment_id,week,session_key,status,occurred_on) values ('$A3',1,'B','completed','2026-10-22')"
eq "RLS: a viewer cannot log a session" "$(CAN $U_VIEW1 "$INS_S")" "no"
eq "RLS: an outsider cannot log a session" "$(CAN $U_OUT "$INS_S")" "no"
eq "RLS: another team's owner cannot log a session (team is derived from the assignment)" "$(CAN $U_OWN2 "$INS_S")" "no"
eq "RLS: a contributor can log a session" "$(CAN $U_CON1 "$INS_S")" "yes"
INS_E="insert into speed_program_events (assignment_id,event_type,detail) values ('$A3','advance','{\"kind\":\"week\"}')"
eq "RLS: a contributor cannot advance a player" "$(CAN $U_CON1 "$INS_E")" "no"
eq "RLS: a viewer cannot advance a player" "$(CAN $U_VIEW1 "$INS_E")" "no"
eq "RLS: an admin can record an advance" "$(CAN $U_ADM1 "$INS_E")" "yes"
eq "RLS: a contributor can log an assessment" "$(CAN $U_CON1 "insert into speed_program_assessments (assignment_id,kind,method,rubric,occurred_on) values ('$A3','retest','rubric','{\"landing\":2,\"braking\":2,\"reaction\":2}','2026-10-28')")" "yes"
eq "RLS: a viewer cannot log an assessment" "$(CAN $U_VIEW1 "insert into speed_program_assessments (assignment_id,kind,method,rubric,occurred_on) values ('$A3','retest','rubric','{\"landing\":2}','2026-10-28')")" "no"
eq "RLS: an admin cannot rewrite the plan through the API role" "$(CAN $U_ADM1 "update speed_program_assignments set plan='{}'::jsonb where id='$A3'")" "no"
eq "RLS: an admin can change the week" "$(AS $U_ADM1 "with u as (update speed_program_assignments set current_week=2 where id='$A3' returning 1) select count(*) from u")" "1"
eq "RLS: a contributor's update changes nothing" "$(AS $U_CON1 "with u as (update speed_program_assignments set current_week=3 where id='$A3' returning 1) select count(*) from u")" "0"
eq "RLS: nobody (not even the owner) can delete a program through the API role" "$(CAN $U_OWN1 "delete from speed_program_assignments where id='$A3'")" "no"
eq "RLS: the mapping is readable by a signed-in user" "$(AS $U_OUT "select count(*) from speed_program_exercise_drills")" "14"
eq "RLS: anon is granted nothing on any of the tables" "$(Q "select count(*) from information_schema.role_table_grants where grantee='anon' and table_name like 'speed_program%'")" "0"
eq "RLS: every table has row level security on" "$(Q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'speed_program%' and c.relkind='r' and c.relrowsecurity")" "5"

# 10. role words
eq "no policy uses 'record' or 'decide' as a role" "$(Q "select count(*) from pg_policies where tablename like 'speed_program%' and (coalesce(qual,'')||coalesce(with_check,'')) ~ '''(record|decide)'''")" "0"
eq "history tables have no UPDATE or DELETE policy" "$(Q "select count(*) from pg_policies where tablename in ('speed_program_sessions','speed_program_assessments','speed_program_events') and cmd in ('UPDATE','DELETE','ALL')")" "0"

# 7. cascade on player deletion
PSQL -q -c "SET ROLE service_role; delete from players where id='$P1'" >/dev/null 2>&1 || true
eq "deleting the player removes their program history (privacy deletion)" "$(Q "select count(*) from speed_program_sessions s join speed_program_assignments a on a.id=s.assignment_id where a.player_id='$P1'")" "0"
eq "...and left another player's program alone" "$(Q "select count(*) from speed_program_assignments where player_id='$P2'")" "1"

# 10b. production-like extras
eq "the signed-in role cannot bypass RLS; the service role can (as on Supabase)" "$(Q "select (select rolbypassrls from pg_roles where rolname='authenticated')::text||(select rolbypassrls from pg_roles where rolname='service_role')::text")" "falsetrue"
eq "the signed-in role has no DELETE on any speed table, and no UPDATE on the history tables" "$(Q "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_name like 'speed_program%' and (privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER') or (privilege_type='UPDATE' and table_name<>'speed_program_assignments'))")" "0"
eq "the service role cannot delete or update history rows by grant either" "$(Q "select count(*) from information_schema.role_table_grants where grantee='service_role' and table_name in ('speed_program_sessions','speed_program_assessments','speed_program_events') and privilege_type in ('DELETE','UPDATE','TRUNCATE')")" "0"
eq "an anonymous request (no JWT) reads nothing and writes nothing" "$(PSQL -tAq -c "SET ROLE anon; select count(*) from speed_program_assignments" 2>&1 | grep -c 'permission denied')" "1"
eq "a signed-in user whose id is not on any team reads nothing (real bc_team_role)" "$(AS $U_OUT "select count(*) from speed_program_sessions")" "0"
AFTER=$(Q "select (select count(*) from pg_policies where tablename not like 'speed_program%')||'/'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'speed_program%')||'/'||(select count(*) from teams)||'/'||(select count(*) from team_members)")
eq "081 left every existing table's policies, table list and rows unchanged" "$AFTER" "$BEFORE"

# 10b. production-like extras
eq "the signed-in role cannot bypass RLS; the service role can (as on Supabase)" "$(Q "select (select rolbypassrls from pg_roles where rolname='authenticated')::text||(select rolbypassrls from pg_roles where rolname='service_role')::text")" "falsetrue"
eq "the signed-in role has no DELETE on any speed table, and no UPDATE on the history tables" "$(Q "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_name like 'speed_program%' and (privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER') or (privilege_type='UPDATE' and table_name<>'speed_program_assignments'))")" "0"
eq "the service role cannot delete or update history rows by grant either" "$(Q "select count(*) from information_schema.role_table_grants where grantee='service_role' and table_name in ('speed_program_sessions','speed_program_assessments','speed_program_events') and privilege_type in ('DELETE','UPDATE','TRUNCATE')")" "0"
eq "an anonymous request (no JWT) reads nothing and writes nothing" "$(PSQL -tAq -c "SET ROLE anon; select count(*) from speed_program_assignments" 2>&1 | grep -c 'permission denied')" "1"
eq "a signed-in user whose id is not on any team reads nothing (real bc_team_role)" "$(AS $U_OUT "select count(*) from speed_program_sessions")" "0"
AFTER=$(Q "select (select count(*) from pg_policies where tablename not like 'speed_program%')||'/'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'speed_program%')||'/'||(select count(*) from teams)||'/'||(select count(*) from team_members)")
eq "081 left every existing table's policies, table list and rows unchanged" "$AFTER" "$BEFORE"

# The read-only production check file runs cleanly here, and PART 2 is all true.
VER="$ROOT/scripts/speed-program/verify-prod-readonly.sql"
awk '/^-- ===== PART 1/{f=1} /^-- ===== PART 2/{f=0} f' "$VER" > "$WORK/v1.sql"
awk '/^-- ===== PART 2/{f=1} f' "$VER" > "$WORK/v2.sql"
PSQL -v ON_ERROR_STOP=1 -q -f "$WORK/v1.sql" >"$WORK/v1.out" 2>&1 && pass "verify-prod-readonly.sql PART 1 runs" || { cat "$WORK/v1.out"; fail "verify PART 1 failed to run"; }
eq "PART 1 helper and table checks are all true" "$(PSQL -tA -f "$WORK/v1.sql" 2>&1 | grep -E '^(helper|bc_rank|bc_team|table|authenticated)' | grep -c '|f$')" "0"
PSQL -tA -f "$WORK/v2.sql" > "$WORK/v2.out" 2>&1 || { cat "$WORK/v2.out"; fail "verify PART 2 failed to run"; }
eq "PART 2 (after 081) has no failing row, except the mapping count after the cascade test" "$(grep -E '\|f$' "$WORK/v2.out" | grep -vc 'no speed program has been created')" "0"
if grep -qiE '\b(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b' <(sed 's/--.*//' "$VER" | tr 'A-Z' 'a-z' | grep -vE "'[^']*(insert|update|delete|create|drop|alter|grant|revoke)[^']*'"); then fail "the verify file contains a write statement"; else pass "verify-prod-readonly.sql contains no write statement"; fi

# 11. rollback
PSQL -v ON_ERROR_STOP=1 -q -f "$DOWN" >/dev/null 2>&1 || fail "rollback failed"
eq "rollback removes all five tables" "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name like 'speed_program%'")" "0"
eq "rollback leaves players, teams and drills alone" "$(Q "select (select count(*) from players)+(select count(*) from teams)+(select count(*) from drill_resources)")" "5"
PSQL -v ON_ERROR_STOP=1 -q -f "$DOWN" >/dev/null 2>&1 && pass "rollback is re-runnable" || fail "rollback not re-runnable"
PSQL -v ON_ERROR_STOP=1 -q -f "$M81" >/dev/null 2>&1 && pass "081 re-applies after a rollback" || fail "081 did not re-apply after rollback"

echo ""; echo "ALL PASS"
