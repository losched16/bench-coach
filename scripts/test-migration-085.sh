#!/usr/bin/env bash
# Migration 085 — Development Programs.
#
# In a real Postgres, proves that:
#   * the migration applies, and re-applies, changing nothing that exists;
#   * saving a draft is atomic and idempotent (one program per draft);
#   * a second approval returns the same program rather than a duplicate;
#   * a development-plan link to ANOTHER player's plan is dropped on save;
#   * completing a session flips its status, replaces its measurements and
#     logs ONE session_logged event on the linked plan — and doing it twice
#     changes nothing;
#   * a completed session and its drills cannot be edited or deleted;
#   * un-completing reopens it and removes the measurements and the event;
#   * an approved revision rewrites future PLANNED sessions only and bumps
#     the version once; a stale revision is refused.
#
#   npm run test:migration-085
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
W=$(mktemp -d /tmp/bc-85-XXXXXX); mkdir -p "$W/sock"; chown -R ubuntu "$W" 2>/dev/null || true
su ubuntu -c "$PGBIN/initdb -D $W/data -U postgres --auth=trust" >/dev/null 2>&1
su ubuntu -c "$PGBIN/pg_ctl -D $W/data -o '-p 55485 -k $W/sock -c listen_addresses=' -l $W/pg.log start" >/dev/null 2>&1
sleep 2
P(){ $PGBIN/psql -h "$W/sock" -p 55485 -U postgres "$@"; }
pass(){ echo "  PASS  $1"; }
fail(){ echo "FAILED: $1"; exit 1; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3' got '$2'"; }
trap 'su ubuntu -c "$PGBIN/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT
cd "$(dirname "$0")/.."

PAYLOAD="$W/payload.json"; chmod 777 "$W"
npx --yes tsx --tsconfig tsconfig.json scripts/emit-program-fixture.ts "$PAYLOAD"
[ -s "$PAYLOAD" ] || fail "fixture payload was not written"
chmod 644 "$PAYLOAD"

# The tables 085 points at, reduced to the columns it uses.
#
# bc_team_at_least is stubbed with the REAL rule's shape (membership rank on the
# team) so the RLS policies are created and exercised here, not skipped.
P -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.coaches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.team_members (team_id uuid, user_id uuid, role text);
CREATE FUNCTION public.bc_rank(r text) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT CASE r WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'contributor' THEN 1 WHEN 'viewer' THEN 0 ELSE -1 END $$;
CREATE FUNCTION public.bc_team_at_least(p_team uuid, p_min text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = p_team AND m.user_id = auth.uid() AND public.bc_rank(m.role) >= public.bc_rank(p_min)) $$;
CREATE TABLE public.teams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid REFERENCES coaches(id));
CREATE TABLE public.players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.chat_threads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.drill_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), drill_name text);
CREATE TABLE public.metric_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid, slug text, label text, unit text,
  shape text, direction text, default_attempts int, hint text, sort_order int);
CREATE TABLE public.player_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid NOT NULL, player_id uuid NOT NULL,
  metric text NOT NULL, value numeric NOT NULL, unit text, measured_on date NOT NULL, source text, note text, entry_id uuid,
  metric_type_id uuid, attempts int, successes int, team_id uuid);
CREATE TABLE public.player_pathway_progress (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL, team_id uuid NOT NULL);
CREATE TABLE public.player_pathway_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), progress_id uuid NOT NULL REFERENCES player_pathway_progress(id),
  team_id uuid NOT NULL, event_type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', actor_user_id uuid, occurred_on date NOT NULL DEFAULT CURRENT_DATE);
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111', 'coach@example.test'), ('22222222-2222-2222-2222-222222222222', 'viewer@example.test'), ('33333333-3333-3333-3333-333333333333', 'otherteam@example.test');
INSERT INTO coaches (id, user_id) VALUES ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO teams (id, coach_id) VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'), ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001');
INSERT INTO team_members VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('eeeeeeee-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'viewer'),
  ('eeeeeeee-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'owner');
INSERT INTO players (id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Charlie'), ('00000000-0000-0000-0000-0000000000c2', 'Other kid');
-- Charlie's real plans, and ANOTHER player's plan the payload must not be able to link to.
INSERT INTO player_pathway_progress (id, player_id, team_id) VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000c1', 'eeeeeeee-0000-0000-0000-000000000001'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000c2', 'eeeeeeee-0000-0000-0000-000000000001');
INSERT INTO metric_types (coach_id, slug, label, shape, direction) VALUES (NULL, 'exit_velo', 'Exit velocity', 'measurement', 'higher');
SQL

P -v ON_ERROR_STOP=1 -q -f migrations/085_development_programs.sql >/dev/null 2>&1 || { P -v ON_ERROR_STOP=1 -q -f migrations/085_development_programs.sql; fail "085 did not apply"; }
pass "085 applies"
P -v ON_ERROR_STOP=1 -q -f migrations/085_development_programs.sql >/dev/null 2>&1 || fail "085 is not idempotent"
pass "re-running changes nothing"
eq "eight new tables" "$(P -tAqc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'program_%' OR tablename LIKE 'development_program%')")" "8"
eq "every program table has RLS on" "$(P -tAqc "SELECT bool_and(rowsecurity) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'program_%' OR tablename LIKE 'development_program%')")" "t"
eq "seven metric presets added once" "$(P -tAqc "SELECT count(*) FROM metric_types WHERE coach_id IS NULL AND slug IN ('sprint_5y','first_step_pct','first_step_outfield_pct','fly_ball_catch_pct','clean_fielding_pct','contact_quality_pct','balance_hold_sec')")" "7"
eq "existing preset untouched" "$(P -tAqc "SELECT count(*) FROM metric_types WHERE slug='exit_velo'")" "1"

U=11111111-1111-1111-1111-111111111111
D=dddddddd-0000-0000-0000-000000000001
PAYLOAD_SQL="$(cat "$PAYLOAD" | sed "s/'/''/g")"
P -v ON_ERROR_STOP=1 -q -c "INSERT INTO development_program_drafts (id, team_id, player_id, payload) VALUES ('$D','eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','{}')"

P -v ON_ERROR_STOP=1 -q -c "CREATE TEMP TABLE _p AS SELECT '$PAYLOAD_SQL'::jsonb AS j" 2>/dev/null || true
SAVE1=$(P -tAq -v ON_ERROR_STOP=1 <<SQL
SELECT ok || '|' || reason || '|' || already_saved FROM bc_save_development_program('$D', '$U', '$PAYLOAD_SQL'::jsonb);
SQL
)
eq "first save succeeds" "$(echo "$SAVE1" | cut -d'|' -f1,2)" "true|saved"
SAVE2=$(P -tAq -v ON_ERROR_STOP=1 <<SQL
SELECT ok || '|' || reason || '|' || already_saved FROM bc_save_development_program('$D', '$U', '$PAYLOAD_SQL'::jsonb);
SQL
)
eq "second approval is the same program, not a duplicate" "$SAVE2" "true|already_saved|true"
eq "exactly one program" "$(P -tAqc "SELECT count(*) FROM development_programs")" "1"
eq "draft marked saved" "$(P -tAqc "SELECT status FROM development_program_drafts WHERE id='$D'")" "saved"
eq "8 weeks of dates" "$(P -tAqc "SELECT (max(scheduled_date) - min(scheduled_date)) + 1 FROM program_sessions")" "56"
eq "four phases" "$(P -tAqc "SELECT count(*) FROM program_phases")" "4"
eq "seven skills" "$(P -tAqc "SELECT count(*) FROM program_skills")" "7"
eq "every week has a rest day" "$(P -tAqc "SELECT count(DISTINCT week) FROM program_sessions WHERE kind='rest'")" "8"
eq "no duplicate session keys" "$(P -tAqc "SELECT count(*) - count(DISTINCT session_key) FROM program_sessions")" "0"
eq "linked own plan kept" "$(P -tAqc "SELECT count(*) FROM program_skills WHERE progress_id='33333333-3333-3333-3333-333333333333'")" "1"
eq "another player's plan link dropped" "$(P -tAqc "SELECT count(*) FROM program_skills WHERE progress_id='44444444-4444-4444-4444-444444444444'")" "0"
eq "drills saved in order for a session" "$(P -tAqc "SELECT count(*) FROM program_session_drills d JOIN program_sessions s ON s.id=d.session_id WHERE s.session_key='w1d1'")" "$(P -tAqc "SELECT count(*) FROM program_session_drills d JOIN program_sessions s ON s.id=d.session_id WHERE s.session_key='w1d1' AND d.position >= 0")"

SID=$(P -tAqc "SELECT id FROM program_sessions WHERE kind='coached' AND 'hitting' = ANY(focus) ORDER BY scheduled_date LIMIT 1")
PROG=$(P -tAqc "SELECT id FROM development_programs")
MT=$(P -tAqc "SELECT id FROM metric_types WHERE slug='exit_velo'")
COMPLETE(){ P -tAq -v ON_ERROR_STOP=1 <<SQL
SELECT ok || '|' || reason FROM bc_complete_program_session('$SID', '$U', true, '2026-11-10', 55,
  '[{"position":0,"done":true,"rating":"easy"}]'::jsonb, '{"hitting":"easy"}'::jsonb, false, 'went well',
  '[{"metric_type_id":"$MT","metric":"Exit velocity","value":42,"unit":"mph","checkpoint":"baseline","conditions":"tee, same ball"}]'::jsonb);
SQL
}
eq "complete a session" "$(COMPLETE)" "true|completed"
eq "complete twice: still one completion" "$( COMPLETE >/dev/null; P -tAqc "SELECT count(*) FROM program_session_completions")" "1"
eq "status flipped" "$(P -tAqc "SELECT status FROM program_sessions WHERE id='$SID'")" "completed"
eq "measurement lives in player_metrics, linked to the program" "$(P -tAqc "SELECT count(*) FROM player_metrics WHERE program_id='$PROG' AND checkpoint='baseline'")" "1"
eq "re-completing replaces, never duplicates, measurements" "$(P -tAqc "SELECT count(*) FROM player_metrics WHERE program_session_id='$SID'")" "1"
eq "ONE session_logged event on the linked plan" "$(P -tAqc "SELECT count(*) FROM player_pathway_events WHERE event_type='session_logged' AND progress_id='33333333-3333-3333-3333-333333333333'")" "1"

R(){ P -tAq -v ON_ERROR_STOP=1 -c "$1" 2>&1 | tr -d "[:space:]" || true; }
case "$(R "UPDATE program_sessions SET title='hacked' WHERE id='$SID'")" in *cannotbeedited*) pass "completed session cannot be edited";; *) fail "completed session was editable";; esac
case "$(R "DELETE FROM program_sessions WHERE id='$SID'")" in *cannotbedeleted*) pass "completed session cannot be deleted";; *) fail "completed session was deletable";; esac
case "$(R "UPDATE program_session_drills SET name='x' WHERE session_id='$SID'")" in *cannotbechanged*) pass "completed session's drills are frozen";; *) fail "drills of a completed session were editable";; esac

P -tAq -v ON_ERROR_STOP=1 -c "SELECT ok FROM bc_uncomplete_program_session('$SID')" >/dev/null
eq "un-complete reopens" "$(P -tAqc "SELECT status FROM program_sessions WHERE id='$SID'")" "planned"
eq "un-complete removes the measurement" "$(P -tAqc "SELECT count(*) FROM player_metrics WHERE program_session_id='$SID'")" "0"
eq "un-complete removes the plan event" "$(P -tAqc "SELECT count(*) FROM player_pathway_events WHERE event_type='session_logged'")" "0"

# Revisions: complete one session, then approve a patch that touches it and a future one.
COMPLETE >/dev/null
FUT=$(P -tAqc "SELECT session_key FROM program_sessions WHERE kind='coached' AND status='planned' ORDER BY scheduled_date DESC LIMIT 1")
DONE=$(P -tAqc "SELECT session_key FROM program_sessions WHERE id='$SID'")
P -v ON_ERROR_STOP=1 -q -c "INSERT INTO program_revisions (id, program_id, team_id, from_version, summary) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','$PROG','eeeeeeee-0000-0000-0000-000000000001',1,'add reaction work')" 2>&1 | head -2
P -v ON_ERROR_STOP=1 -q -c "INSERT INTO program_revisions (id, program_id, team_id, from_version, summary) VALUES ('bbbbbbbb-0000-0000-0000-000000000009','$PROG','eeeeeeee-0000-0000-0000-000000000001',1,'second')" >/dev/null 2>&1 || true
PATCH='[{"session_key":"'$FUT'","est_minutes":60,"drills":[{"position":0,"block_index":0,"block_kind":"skill","block_title":"x","block_minutes":60,"skill":"hitting","name":"Patched drill","minutes":60,"intensity":"easy"}]},{"session_key":"'$DONE'","drills":[{"position":0,"block_index":0,"block_kind":"skill","block_title":"x","block_minutes":1,"name":"MUST NOT APPLY","minutes":1}]}]'
eq "approved revision applies" "$(P -tAq -v ON_ERROR_STOP=1 -c "SELECT ok||'|'||new_version FROM bc_apply_program_revision('bbbbbbbb-0000-0000-0000-000000000001','$U','$PATCH'::jsonb)")" "true|2"
eq "future planned session rewritten" "$(P -tAqc "SELECT count(*) FROM program_session_drills d JOIN program_sessions s ON s.id=d.session_id WHERE s.session_key='$FUT' AND d.name='Patched drill'")" "1"
eq "completed session untouched by the revision" "$(P -tAqc "SELECT count(*) FROM program_session_drills WHERE name='MUST NOT APPLY'")" "0"
eq "program version bumped once" "$(P -tAqc "SELECT version FROM development_programs")" "2"
eq "stale revision refused" "$(P -tAq -v ON_ERROR_STOP=1 -c "SELECT reason FROM bc_apply_program_revision('bbbbbbbb-0000-0000-0000-000000000009','$U','[]'::jsonb)")" "program_changed_since_proposal"
eq "applied revision cannot be applied twice" "$(P -tAq -v ON_ERROR_STOP=1 -c "SELECT reason FROM bc_apply_program_revision('bbbbbbbb-0000-0000-0000-000000000001','$U','[]'::jsonb)")" "already_decided"

# The service-role functions are not callable by ordinary roles.
case "$(P -tAq -c "SET ROLE authenticated; SELECT * FROM bc_save_development_program('$D','$U','{}'::jsonb)" 2>&1)" in *"permission denied"*) pass "authenticated cannot call the save function";; *) fail "authenticated could call the save function";; esac
# ── RLS: cross-team and cross-role isolation (real policies, real roles) ──────
AS(){ P -tAq -v ON_ERROR_STOP=1 2>&1 <<SQL | tr -d '[:space:]'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', true) \gset
$2;
COMMIT;
SQL
}
OWNER=11111111-1111-1111-1111-111111111111; VIEWER=22222222-2222-2222-2222-222222222222; OTHER=33333333-3333-3333-3333-333333333333
eq "the team's owner reads the program" "$(AS $OWNER "SELECT count(*) FROM development_programs")" "1"
eq "a viewer on the team reads it too" "$(AS $VIEWER "SELECT count(*) FROM development_programs")" "1"
eq "a coach on ANOTHER team sees no programs" "$(AS $OTHER "SELECT count(*) FROM development_programs")" "0"
eq "...no sessions" "$(AS $OTHER "SELECT count(*) FROM program_sessions")" "0"
eq "...no drills of those sessions" "$(AS $OTHER "SELECT count(*) FROM program_session_drills")" "0"
eq "...no phases" "$(AS $OTHER "SELECT count(*) FROM program_phases")" "0"
eq "...no skills" "$(AS $OTHER "SELECT count(*) FROM program_skills")" "0"
eq "...no completions" "$(AS $OTHER "SELECT count(*) FROM program_session_completions")" "0"
eq "...no drafts" "$(AS $OTHER "SELECT count(*) FROM development_program_drafts")" "0"
eq "...no revisions" "$(AS $OTHER "SELECT count(*) FROM program_revisions")" "0"
eq "a viewer can see the session drills of their team" "$(AS $VIEWER "SELECT count(*) > 0 FROM program_session_drills")" "t"
case "$(AS $OWNER "UPDATE development_programs SET title='x'")" in *"permissiondenied"*) pass "even a team owner cannot write programs directly (writes go through the checked server routes)";; *) fail "direct client write was allowed";; esac
case "$(AS $OTHER "DELETE FROM program_sessions")" in *"permissiondenied"*) pass "another team cannot delete sessions";; *) fail "another team could delete";; esac
echo "all migration 085 checks passed"
