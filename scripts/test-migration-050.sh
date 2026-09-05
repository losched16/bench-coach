#!/usr/bin/env bash
# Apply migration 050 to a real Postgres and prove it works.
#
# Everything else about the league layer is checked statically — pure unit
# tests, build-time verifiers, a typecheck, a production build. None of that can
# tell you whether the SQL parses, whether the foreign keys hold, whether the
# partial unique index actually refuses a duplicate, or whether
# bc_claim_league_seat() really stops two coaches taking the last seat. Only a
# database can answer those, and this stands one up to ask.
#
#   npm run test:migration-050
#
# It creates a THROWAWAY cluster in a temp directory, on a unix socket with
# listen_addresses empty, so it touches no network and no real database. It is
# torn down on exit whether it passes or fails.
#
# WHAT THIS IS NOT: it is not a substitute for running against staging Supabase.
# The bootstrap below is a minimal stand-in for Supabase — auth.users, auth.uid()
# and the three Supabase roles — and real RLS behaviour under a genuine
# authenticated session is still something only staging can prove. What this DOES
# establish is that the migration applies, is idempotent, and that its
# constraints and functions behave.

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-pg-XXXXXX)
PORT=${PGPORT_TEST:-55432}
SOCK="$WORK/sock"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN — this check needs a server, not just psql." >&2
  exit 0
fi

# initdb refuses to run as root, which is the common case in a container.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="ubuntu"
  id "$RUNAS" >/dev/null 2>&1 || { echo "SKIP: running as root and no unprivileged user to fall back to." >&2; exit 0; }
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

fail() { echo ""; echo "FAILED: $1"; [ -f "$WORK/pg.log" ] && tail -30 "$WORK/pg.log"; exit 1; }

# ---------------------------------------------------------------------------
# 1. A minimal Supabase stand-in
# ---------------------------------------------------------------------------
# Only what migration 050 and the base schema actually reference: the auth
# schema, auth.uid(), and the three roles whose existence 050 checks for before
# granting. Deliberately small — the point is to test OUR migration, not to
# reimplement Supabase.
cat > "$WORK/00_bootstrap.sql" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- Reads a session GUC so a test can say "I am this user" and watch RLS react.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$ LANGUAGE sql STABLE;
SQL

$PSQL -f "$WORK/00_bootstrap.sql" > "$WORK/bootstrap.log" 2>&1 || fail "bootstrap"

# ---------------------------------------------------------------------------
# 2. The base schema, plus the three tables that live only in Supabase
# ---------------------------------------------------------------------------
# team_members, team_invitations and user_events were created through the
# Supabase dashboard and have no DDL in this repo (migration 034 says so and
# guards every statement accordingly). Recreated here from the shapes the
# application code reads and writes.
$PSQL -f "$ROOT/supabase-schema.sql" > "$WORK/schema.log" 2>&1 || fail "supabase-schema.sql"

cat > "$WORK/01_outofrepo.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer',
  invited_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT,
  event_name TEXT NOT NULL,
  page_path  TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- `games` is referenced by the accept route's activity check. Minimal shape.
CREATE TABLE IF NOT EXISTS games (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
SQL

$PSQL -f "$WORK/01_outofrepo.sql" > "$WORK/outofrepo.log" 2>&1 || fail "out-of-repo tables"

# A couple of pre-existing rows, so the migration is applied to a database that
# already has data rather than to an empty one. This is what proves "additive".
cat > "$WORK/02_seed.sql" <<'SQL'
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'existing.coach@example.com'),
  -- A second account, so the ownership-transfer section runs rather than
  -- skipping: coaches.user_id is UNIQUE and the transfer needs two coaches.
  ('55555555-5555-5555-5555-555555555555', 'arriving.headcoach@example.com');
INSERT INTO coaches (id, user_id, display_name) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Existing Coach');
INSERT INTO seasons (id, coach_id, name) VALUES
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Spring 2026');
INSERT INTO teams (id, season_id, coach_id, name) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'Pre-existing 9U Team');
SQL
$PSQL -f "$WORK/02_seed.sql" > "$WORK/seed.log" 2>&1 || fail "seed"

BEFORE=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc "select count(*) from teams")

# ---------------------------------------------------------------------------
# 3. Apply migration 050 — twice, because it claims to be idempotent
# ---------------------------------------------------------------------------
echo "  applying migration 050..."
$PSQL -f "$ROOT/migrations/050_league_layer.sql" > "$WORK/050a.log" 2>&1 \
  || { echo "--- first apply failed ---"; tail -25 "$WORK/050a.log"; exit 1; }

echo "  re-applying migration 050 (idempotence)..."
$PSQL -f "$ROOT/migrations/050_league_layer.sql" > "$WORK/050b.log" 2>&1 \
  || { echo "--- SECOND apply failed: migration is not idempotent ---"; tail -25 "$WORK/050b.log"; exit 1; }

AFTER=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc "select count(*) from teams")
if [ "$BEFORE" != "$AFTER" ]; then
  echo "FAILED: team count changed across the migration ($BEFORE -> $AFTER)"; exit 1
fi

# ---------------------------------------------------------------------------
# 4. The verification harness
# ---------------------------------------------------------------------------
echo "  running 050_VERIFY.sql..."
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 \
  -f "$ROOT/migrations/050_VERIFY.sql" > "$WORK/verify.log" 2>&1 || {
    echo "--- verification failed ---"
    grep -E "PASS|FAIL|NOTE|passed|ERROR" "$WORK/verify.log" | sed 's/^psql:[^ ]* //' | tail -50
    exit 1
  }

grep -E "PASS|FAIL|NOTE|passed," "$WORK/verify.log" | sed -E 's/^(psql:[^ ]* )?NOTICE: *//' | sed 's/^/  /'

# ---------------------------------------------------------------------------
# 5. REAL CONCURRENCY
# ---------------------------------------------------------------------------
# 050_VERIFY.sql runs in a single session, so it proves the LOGIC of
# bc_claim_league_seat() but not its LOCKING — a function can look correct and
# still let two transactions read the same count. This races genuinely parallel
# connections at one scarce seat, which is the only way to tell the difference.
#
# 12 coaches, 3 seats. If the FOR UPDATE on the licence row is doing its job,
# exactly 3 win. Without it, several read "0 used" simultaneously and overshoot.
echo "  racing 12 concurrent claims for 3 seats..."

$PSQL <<'SQL' > "$WORK/race_setup.log" 2>&1 || fail "race setup"
INSERT INTO leagues (id, name, slug, status)
VALUES ('99999999-9999-9999-9999-999999999999', 'RACE League', 'race-league', 'active');
INSERT INTO league_licenses (league_id, status, coach_limit, starts_at)
VALUES ('99999999-9999-9999-9999-999999999999', 'active', 3, NOW() - INTERVAL '1 day');
INSERT INTO league_invitations (league_id, email, invite_token, status, expires_at)
SELECT '99999999-9999-9999-9999-999999999999',
       'race' || g || '@verify.test', 'race-tok-' || g, 'pending', NOW() + INTERVAL '30 days'
FROM generate_series(1, 12) g;
SQL

# Each claim in its own connection, all fired at once.
for tok in $(seq 1 12); do
  (
    ID=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
      "select id from league_invitations where invite_token = 'race-tok-$tok'")
    $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
      "select claimed from bc_claim_league_seat('$ID'::uuid, '99999999-9999-9999-9999-999999999999'::uuid)"
  ) >> "$WORK/race_results.txt" 2>&1 &
done
wait

WON=$(grep -c '^t$' "$WORK/race_results.txt" || true)
ACCEPTED=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
  "select count(*) from league_invitations where league_id = '99999999-9999-9999-9999-999999999999' and status = 'accepted'")

if [ "$WON" != "3" ] || [ "$ACCEPTED" != "3" ]; then
  echo "FAILED: 12 concurrent claims against 3 seats produced $WON winners and $ACCEPTED accepted rows."
  echo "        Expected exactly 3 of each. The licence row lock is not serialising claims."
  exit 1
fi
echo "  PASS  exactly 3 of 12 concurrent claims won the 3 available seats"

# And the same invitation claimed by many connections at once must be taken once.
$PSQL <<'SQL' > /dev/null 2>&1
UPDATE league_licenses SET coach_limit = NULL WHERE league_id = '99999999-9999-9999-9999-999999999999';
UPDATE league_invitations SET status = 'pending', accepted_at = NULL
WHERE invite_token = 'race-tok-1';
SQL

SOLO=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
  "select id from league_invitations where invite_token = 'race-tok-1'")
rm -f "$WORK/replay.txt"
for _ in $(seq 1 8); do
  $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
    "select claimed from bc_claim_league_seat('$SOLO'::uuid, '99999999-9999-9999-9999-999999999999'::uuid)" \
    >> "$WORK/replay.txt" 2>&1 &
done
wait

REPLAY_WON=$(grep -c '^t$' "$WORK/replay.txt" || true)
if [ "$REPLAY_WON" != "1" ]; then
  echo "FAILED: one invitation claimed by 8 concurrent connections was won $REPLAY_WON times, expected exactly 1."
  exit 1
fi
echo "  PASS  one invitation raced by 8 connections is claimed exactly once"

$PSQL -c "DELETE FROM leagues WHERE id = '99999999-9999-9999-9999-999999999999'" > /dev/null 2>&1

# Nothing from the harness may survive its own rollback.
LEAK=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc \
  "select (select count(*) from leagues) + (select count(*) from league_invitations)")
if [ "$LEAK" != "0" ]; then
  echo "FAILED: 050_VERIFY.sql left $LEAK rows behind — its ROLLBACK is not doing its job"; exit 1
fi

echo ""
echo "migration 050: applies cleanly, is idempotent, leaves existing teams untouched ($BEFORE teams before and after), and its verification harness rolls back cleanly."
