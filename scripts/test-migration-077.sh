#!/usr/bin/env bash
# Migration 077 — practice → development-plan link.
#
# The check this file exists for is "THE SAME PRACTICE CANNOT BE COUNTED TWICE
# ON ONE PLAYER'S PLAN", enforced by the database rather than by a button.
# Also: existing practices are untouched, hand-recorded sessions are never
# blocked, and the migration is additive and re-runnable.
#
#   npm run test:migration-077
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
W=$(mktemp -d /tmp/bc-77-XXXXXX); mkdir -p "$W/sock"; chown -R ubuntu "$W" 2>/dev/null || true
su ubuntu -c "$PGBIN/initdb -D $W/data -U postgres --auth=trust" >/dev/null 2>&1
su ubuntu -c "$PGBIN/pg_ctl -D $W/data -o '-p 55477 -k $W/sock -c listen_addresses=' -l $W/pg.log start" >/dev/null 2>&1
sleep 2
P(){ $PGBIN/psql -h "$W/sock" -p 55477 -U postgres "$@"; }
Q(){ P -tAqc "$1" | tr -d '[:space:]'; }
OK(){ P -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null 2>&1 && echo yes || echo no; }
pass(){ echo "  PASS  $1"; }
fail(){ echo "FAILED: $1"; exit 1; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3' got '$2'"; }
trap 'su ubuntu -c "$PGBIN/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT

# The two tables as production has them, reduced to the columns involved.
P -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.practice_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL, title text,
  duration_minutes int, content jsonb, scheduled_for date);
CREATE TABLE public.player_pathway_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), progress_id uuid NOT NULL, team_id uuid NOT NULL,
  event_type text NOT NULL, stage_key text, stage_number int,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, note text, occurred_on date DEFAULT current_date);
INSERT INTO public.practice_plans (id, team_id, title) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Existing practice');
-- A hand-recorded session and a duplicate hand-recorded session, both legal today.
INSERT INTO public.player_pathway_events (progress_id, team_id, event_type, detail) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'session_logged', '{"minutes":30}'),
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'session_logged', '{"minutes":30}');
SQL

P -v ON_ERROR_STOP=1 -q -f migrations/077_practice_plan_pathway_link.sql >/dev/null 2>&1 || fail "077 did not apply"
pass "077 applies cleanly over existing rows"
P -v ON_ERROR_STOP=1 -q -f migrations/077_practice_plan_pathway_link.sql >/dev/null 2>&1 || fail "077 is not idempotent"
pass "re-running changes nothing"

eq "existing practices are untouched (link null)" "$(Q "SELECT count(*) FROM practice_plans WHERE pathway_slug IS NULL AND pathway_stage_number IS NULL")" "1"
eq "a practice can carry a pathway and stage" "$(OK "INSERT INTO practice_plans (team_id, title, pathway_slug, pathway_stage_number) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','Built from a stage','build-the-swing',3)")" "yes"
eq "a stage without a pathway is refused" "$(OK "INSERT INTO practice_plans (team_id, title, pathway_stage_number) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','x',3)")" "no"
eq "a nonsense stage number is refused" "$(OK "INSERT INTO practice_plans (team_id, title, pathway_slug, pathway_stage_number) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','x','p',0)")" "no"

PR1=cccccccc-0000-0000-0000-000000000001; PR2=cccccccc-0000-0000-0000-000000000002; T=bbbbbbbb-0000-0000-0000-000000000001
PLAN=aaaaaaaa-0000-0000-0000-000000000001
ins(){ OK "INSERT INTO player_pathway_events (progress_id, team_id, event_type, detail) VALUES ('$1','$T','$2','$3')"; }
eq "a practice recorded on a player's plan" "$(ins $PR1 session_logged "{\"practice_plan_id\":\"$PLAN\",\"minutes\":90}")" "yes"
eq "THE SAME PRACTICE CANNOT BE COUNTED TWICE ON ONE PLAYER'S PLAN" "$(ins $PR1 session_logged "{\"practice_plan_id\":\"$PLAN\",\"minutes\":90}")" "no"
eq "the same practice on another player's plan is fine" "$(ins $PR2 session_logged "{\"practice_plan_id\":\"$PLAN\"}")" "yes"
eq "hand-recorded sessions are never blocked" "$(ins $PR1 session_logged '{"minutes":20}')" "yes"
eq "other event types are not affected" "$(ins $PR1 mastery_recorded "{\"practice_plan_id\":\"$PLAN\"}")" "yes"
eq "the pre-existing duplicate hand-recorded sessions survived" "$(Q "SELECT count(*) FROM player_pathway_events WHERE progress_id='$PR1' AND event_type='session_logged' AND NOT detail ? 'practice_plan_id'")" "3"

echo ""; echo "All checks passed."
