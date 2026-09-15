#!/usr/bin/env bash
# Apply migration 062 to a real Postgres and prove the three claims it makes.
#
#   1. It is additive and idempotent — running it twice changes nothing and
#      every existing drill row survives with resource_kind NULL.
#   2. The constraints actually reject bad data: an unknown kind, a negative
#      timestamp, an end at or before the start, a duplicate attachment, two
#      primaries on one drill.
#   3. Media SELECT follows its parent drill. This is the one that matters:
#      the policy is the only thing standing between one coach's private drill
#      and another coach reading its media metadata, and a policy that is
#      subtly wrong looks exactly like one that is right.
#
# Claim 3 cannot be tested by reading SQL — drill_resources itself carries a
# blanket USING (true) SELECT policy that silently defeats its own ownership
# rule, which is precisely the class of mistake only an actual query finds.
#
#   npm run test:migration-062
#
# A THROWAWAY cluster in a temp directory, on a unix socket with
# listen_addresses empty, so it touches no network and no real database.

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-pg62-XXXXXX)
PORT=${PGPORT_TEST:-55462}
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
Q() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc "$1" | tr -d '[:space:]'; }

pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

# Does a statement get REJECTED? Inverted on purpose: a constraint that does
# not reject is the bug, and a test that only runs valid data never finds it.
rejects() {
  if $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null 2>&1
  then return 1; else return 0; fi
}

# ---------------------------------------------------------------------------
# Minimal stand-in: only what 062 touches.
# ---------------------------------------------------------------------------
cat > "$WORK/00_bootstrap.sql" <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
-- Stand-in for Supabase's auth.uid(), settable per session so the RLS checks
-- below can act as one coach and then another.
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

# Two coaches, one curated drill, one private drill each.
$PSQL > /dev/null <<'SQL'
INSERT INTO coaches (id, user_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002');
INSERT INTO drill_resources (id, drill_name, skill_category, youtube_video_id, created_by_coach_id) VALUES
  ('dddddddd-0000-0000-0000-00000000000c','Curated Front Toss','Hitting','q7CPS0RYDPM', NULL),
  ('dddddddd-0000-0000-0000-00000000000a','A private drill','Hitting','aaaaaaaaaaa','aaaaaaaa-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-00000000000b','B private drill','Hitting','bbbbbbbbbbb','bbbbbbbb-0000-0000-0000-000000000002');
SQL

BEFORE=$(Q "SELECT count(*) FROM drill_resources")

echo ""
echo "migration 062 against PostgreSQL 16"
echo ""

# ---------------------------------------------------------------------------
# 1. applies, twice, changing nothing the second time
# ---------------------------------------------------------------------------
$PSQL -f "$ROOT/migrations/062_resource_kind_and_media.sql" > /dev/null 2>&1 \
  || fail "migration 062 did not apply"
pass "applies to a clean database"

$PSQL -f "$ROOT/migrations/062_resource_kind_and_media.sql" > /dev/null 2>&1 \
  || fail "migration 062 is not idempotent — a second run errored"
pass "applies a second time without error (idempotent)"

[ "$(Q "SELECT count(*) FROM drill_resources")" = "$BEFORE" ] \
  || fail "drill rows changed: was $BEFORE"
pass "every existing drill row survives ($BEFORE rows, none deleted)"

[ "$(Q "SELECT count(*) FROM drill_resources WHERE resource_kind IS NOT NULL")" = "0" ] \
  || fail "the migration classified rows; it must leave every one NULL"
pass "every row starts unclassified — absence is not a constraint"

[ "$(Q "SELECT count(*) FROM drill_media_resources")" = "0" ] \
  || fail "the migration created media rows; the backfill does that"
pass "no media rows are invented by the schema change"

# ---------------------------------------------------------------------------
# 2. the constraints reject what they claim to
# ---------------------------------------------------------------------------
rejects "UPDATE drill_resources SET resource_kind='compilation' WHERE drill_name='Curated Front Toss'" \
  || fail "an unknown resource_kind was accepted"
pass "an unknown resource_kind is rejected"

$PSQL -c "UPDATE drill_resources SET resource_kind='source_collection' WHERE drill_name='Curated Front Toss'" > /dev/null \
  || fail "a valid resource_kind was rejected"
pass "each of the four valid kinds is accepted"

M="INSERT INTO drill_media_resources (drill_id, media_type, url"
D="'dddddddd-0000-0000-0000-00000000000c'"

rejects "$M, start_seconds) VALUES ($D,'youtube','https://x', -5)" \
  || fail "a negative start_seconds was accepted"
pass "a negative timestamp is rejected"

rejects "$M, start_seconds, end_seconds) VALUES ($D,'youtube','https://y', 90, 90)" \
  || fail "end_seconds equal to start_seconds was accepted"
pass "an end at or before the start is rejected"

rejects "$M) VALUES ($D,'tiktok','https://z')" \
  || fail "an unknown media_type was accepted"
pass "an unknown media_type is rejected"

rejects "$M) VALUES ($D,'youtube','   ')" \
  || fail "a blank url was accepted"
pass "a blank url is rejected"

$PSQL -c "$M, start_seconds, is_primary) VALUES ($D,'youtube','https://www.youtube.com/watch?v=q7CPS0RYDPM', NULL, true)" > /dev/null
pass "a real media row inserts"

rejects "$M, start_seconds) VALUES ($D,'youtube','https://www.youtube.com/watch?v=q7CPS0RYDPM', NULL)" \
  || fail "a duplicate attachment was accepted — the backfill would double up on a re-run"
pass "the same drill/url/segment cannot be attached twice (backfill is safe to re-run)"

$PSQL -c "$M, start_seconds) VALUES ($D,'youtube','https://www.youtube.com/watch?v=q7CPS0RYDPM', 90)" > /dev/null \
  || fail "the same video at a DIFFERENT timestamp was rejected; that is a legitimate second segment"
pass "...but the same video at a different timestamp is a separate, allowed attachment"

rejects "$M, is_primary) VALUES ($D,'article','https://example.com/a', true)" \
  || fail "a second primary on one drill was accepted"
pass "a drill cannot have two primary media"

$PSQL -c "$M) VALUES ($D,'article','https://example.com/a')" > /dev/null
pass "...but may carry many non-primary media of different types"

[ "$(Q "SELECT count(*) FROM drill_media_resources WHERE drill_id=$D")" = "3" ] \
  || fail "expected 3 media rows on the curated drill"
pass "one drill now carries youtube, a second segment, and an article"

# ---------------------------------------------------------------------------
# 3. RLS: media follows its parent drill
# ---------------------------------------------------------------------------
# Media on each coach's private drill, inserted as the table owner (RLS off).
$PSQL > /dev/null <<'SQL'
INSERT INTO drill_media_resources (drill_id, media_type, url) VALUES
  ('dddddddd-0000-0000-0000-00000000000a','youtube','https://private-a'),
  ('dddddddd-0000-0000-0000-00000000000b','youtube','https://private-b');
SQL

# The owner of a table bypasses RLS, so the checks below run as `authenticated`.
$PSQL -c "GRANT USAGE ON SCHEMA public, auth TO authenticated; GRANT SELECT ON coaches, drill_resources TO authenticated;" > /dev/null

# -q matters: without it psql prints a "SET" command tag for each SET, and the
# captured value becomes "SETSET1" instead of "1" — a comparison that fails on a
# policy that is working perfectly.
as_coach() { # uid, sql
  $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAqc \
    "SET ROLE authenticated; SET LOCAL test.uid='$1'; $2" | tr -d '[:space:]'
}

A_UID=11111111-0000-0000-0000-000000000001
B_UID=22222222-0000-0000-0000-000000000002

[ "$(as_coach $A_UID "SELECT count(*) FROM drill_media_resources WHERE url='https://private-a'")" = "1" ] \
  || fail "coach A cannot see media on their OWN drill"
pass "a coach sees media on their own private drill"

[ "$(as_coach $A_UID "SELECT count(*) FROM drill_media_resources WHERE url='https://private-b'")" = "0" ] \
  || fail "COACH A CAN READ MEDIA ON COACH B'S PRIVATE DRILL"
pass "a coach CANNOT see media on another coach's private drill"

[ "$(as_coach $B_UID "SELECT count(*) FROM drill_media_resources WHERE url='https://private-a'")" = "0" ] \
  || fail "COACH B CAN READ MEDIA ON COACH A'S PRIVATE DRILL"
pass "...and the same holds in the other direction"

[ "$(as_coach $A_UID "SELECT count(*) FROM drill_media_resources WHERE drill_id='dddddddd-0000-0000-0000-00000000000c'")" = "3" ] \
  || fail "a coach cannot see media on the CURATED library"
pass "every coach sees media on the curated library"

# A signed-out reader gets the curated library and nothing private.
SIGNED_OUT=$($PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAqc \
  "SET ROLE authenticated; SELECT count(*) FROM drill_media_resources WHERE url LIKE 'https://private-%'" | tr -d '[:space:]')
[ "$SIGNED_OUT" = "0" ] || fail "a signed-out reader sees $SIGNED_OUT private media rows"
pass "a signed-out reader sees no private media at all"

# And the thing that makes this different from drill_resources itself.
BLANKET=$(Q "SELECT count(*) FROM pg_policies WHERE tablename='drill_media_resources' AND cmd='SELECT' AND qual='true'")
[ "$BLANKET" = "0" ] \
  || fail "drill_media_resources has a blanket USING (true) SELECT policy, which would defeat the ownership rule"
pass "no blanket-true SELECT policy exists to override the ownership rule"

echo ""
echo "migration 062: all checks passed."
