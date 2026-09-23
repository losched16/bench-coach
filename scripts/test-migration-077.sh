#!/usr/bin/env bash
# Migration 077 — swing capture provenance and measurement integrity.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
W=$(mktemp -d /tmp/bc-77-XXXXXX)
mkdir -p "$W/sock"
chown -R ubuntu "$W" 2>/dev/null || true

su ubuntu -c "$PGBIN/initdb -D $W/data -U postgres --auth=trust" >/dev/null 2>&1
su ubuntu -c "$PGBIN/pg_ctl -D $W/data -o '-p 55477 -k $W/sock -c listen_addresses=' -l $W/pg.log start" >/dev/null 2>&1
trap 'su ubuntu -c "$PGBIN/pg_ctl -D '$W'/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT
sleep 2

P(){ $PGBIN/psql -h "$W/sock" -p 55477 -U postgres "$@"; }
Q(){ P -tAqc "$1" | tr -d '[:space:]'; }
pass(){ echo "  PASS  $1"; }
fail(){ echo "FAILED: $1"; exit 1; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3' got '$2'"; }

P -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TABLE public.coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES public.coaches(id)
);
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.metric_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES public.coaches(id),
  slug text NOT NULL,
  label text NOT NULL,
  unit text,
  shape text NOT NULL DEFAULT 'measurement',
  direction text NOT NULL DEFAULT 'higher',
  default_attempts int,
  hint text,
  sort_order int DEFAULT 100,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE public.player_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid REFERENCES public.coaches(id),
  player_id uuid REFERENCES public.players(id),
  team_id uuid REFERENCES public.teams(id),
  metric_type_id uuid REFERENCES public.metric_types(id),
  metric text,
  value numeric,
  unit text,
  attempts int,
  successes int,
  measured_on date,
  note text
);

INSERT INTO auth.users(id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO public.coaches(id) VALUES ('22222222-2222-2222-2222-222222222222');
INSERT INTO public.teams(id,coach_id) VALUES ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
INSERT INTO public.players(id) VALUES ('44444444-4444-4444-4444-444444444444');
INSERT INTO public.metric_types(id,coach_id,slug,label,unit,shape,direction,sort_order)
VALUES ('55555555-5555-5555-5555-555555555555',NULL,'exit_velo','Exit velocity','mph','measurement','higher',10);
SQL

P -v ON_ERROR_STOP=1 -q -f migrations/077_swing_capture_foundation.sql >/dev/null 2>&1 || fail "077 did not apply"
pass "077 applies cleanly"
P -v ON_ERROR_STOP=1 -q -f migrations/077_swing_capture_foundation.sql >/dev/null 2>&1 || fail "077 is not idempotent"
pass "077 re-applies cleanly"

eq "projected distance preset exists once" "$(Q "SELECT count(*) FROM metric_types WHERE coach_id IS NULL AND slug='projected_hit_distance'")" "1"
eq "launch angle is deliberately not a trend preset" "$(Q "SELECT count(*) FROM metric_types WHERE slug='launch_angle'")" "0"
eq "swing capture table exists" "$(Q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='swing_captures'")" "1"
eq "camera calibration distance is persisted" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='swing_captures' AND column_name='camera_distance_ft'")" "1"
eq "player metrics has capture provenance" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='player_metrics' AND column_name='source_capture_id'")" "1"

# Ordinary/manual measurements must remain able to share the same metric type;
# NULL source_capture_id is intentionally not globally unique.
P -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO player_metrics(coach_id,player_id,team_id,metric_type_id,metric,value,unit,measured_on)
VALUES
 ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','exit_velo',50,'mph',CURRENT_DATE),
 ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','exit_velo',51,'mph',CURRENT_DATE);
SQL
pass "manual readings still allow repeated metric types"

CAPTURE=66666666-6666-6666-6666-666666666666
P -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO swing_captures(
 id,team_id,player_id,storage_path,source,capture_fps,camera_distance_ft,created_by
) VALUES (
 '$CAPTURE','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
 'swing-captures/33333333-3333-3333-3333-333333333333/44444444-4444-4444-4444-444444444444/test.mp4',
 'video_upload',240,10,'11111111-1111-1111-1111-111111111111'
);
INSERT INTO player_metrics(coach_id,player_id,team_id,metric_type_id,metric,value,unit,measured_on,source_capture_id)
VALUES ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','exit_velo',52,'mph',CURRENT_DATE,'$CAPTURE');
SQL
pass "a capture-derived metric can be written"

if P -q -v ON_ERROR_STOP=1 -c "INSERT INTO player_metrics(coach_id,player_id,team_id,metric_type_id,metric,value,unit,measured_on,source_capture_id) VALUES ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','exit_velo',53,'mph',CURRENT_DATE,'$CAPTURE')" >/dev/null 2>&1; then
  fail "duplicate capture+metric was accepted"
fi
pass "one capture cannot duplicate the same derived metric"

if P -q -v ON_ERROR_STOP=1 -c "INSERT INTO swing_captures(team_id,player_id,storage_path,camera_distance_ft) VALUES ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','bad-distance.mp4',2)" >/dev/null 2>&1; then
  fail "invalid camera calibration distance was accepted"
fi
pass "invalid camera distance is rejected"

if P -q -v ON_ERROR_STOP=1 -c "INSERT INTO swing_captures(team_id,player_id,storage_path,status,confirmed_by,confirmed_at) VALUES ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','fake-confirmed.mp4','confirmed','11111111-1111-1111-1111-111111111111',NOW())" >/dev/null 2>&1; then
  fail "confirmed capture without measurements was accepted"
fi
pass "confirmed status requires measurement evidence"

eq "RLS is enabled on swing captures" "$(Q "SELECT relrowsecurity::int FROM pg_class WHERE oid='public.swing_captures'::regclass")" "1"
eq "anon has no swing capture grant" "$(Q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_name='swing_captures' AND grantee='anon'")" "0"

echo ""
echo "All migration 077 checks passed."
