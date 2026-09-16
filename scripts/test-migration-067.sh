#!/usr/bin/env bash
# Apply 067 to a real Postgres and prove it does what its header claims.
#
# 067 is 142 UPDATE statements carrying hand-written prose full of apostrophes,
# em dashes and quoted cues. The specific way that goes wrong is a quoting bug
# that turns the rest of a description into SQL — which either fails loudly or,
# far worse, succeeds and writes something mangled. A parser is the only thing
# that can tell the difference, so this runs it against a real server.
#
# The claims:
#
#   1. it applies cleanly from a standing start
#   2. it is idempotent — a second run changes nothing and errors on nothing
#   3. it touches only public.drill_resources
#   4. it deletes nothing and inserts nothing: the row count is identical after
#   5. it writes to no column outside the agreed text set — in particular no
#      media column, no timestamp column and no taxonomy column
#   6. every row it claims to update exists and is actually changed
#
#   npm run test:migration-067

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/migrations/067_instruction_quality.sql"
WORK=$(mktemp -d /tmp/bc-pg67-XXXXXX)
PORT=${PGPORT_TEST:-55467}
SOCK="$WORK/sock"

[ -f "$MIG" ] || { echo "FAILED: $MIG does not exist"; exit 1; }

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

Q() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAqc "$1" | tr -d '[:space:]'; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

# ── a table shaped like the real one ─────────────────────────────────────────
# The extra columns are the ones 067 must NOT touch. They carry sentinel values
# so an accidental write is visible rather than inferred.
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE public.drill_resources (
  id uuid PRIMARY KEY,
  drill_name text, skill_category text,
  description text, ai_coaching_notes text,
  success_markers text[], equipment_needed text[], practice_roles text[],
  regression_notes text, progression_notes text, advanced_progression_notes text,
  safety_notes text, reps_guidance text,
  updated_at timestamptz DEFAULT '2000-01-01',
  -- must survive untouched
  youtube_video_id text DEFAULT 'SENTINEL',
  youtube_url text DEFAULT 'SENTINEL',
  youtube_start_seconds int DEFAULT 42,
  youtube_start_source text DEFAULT 'SENTINEL',
  resource_kind text DEFAULT 'SENTINEL',
  duplicate_of_drill_id uuid,
  activity_family_id uuid,
  variation_type text DEFAULT 'SENTINEL',
  created_by_coach_id uuid
);
SQL

# Seed exactly the ids the migration names, so "every row it updates exists" is
# a fact about the file rather than an assumption.
grep -oE "WHERE id = '[^']+'" "$MIG" \
  | sed -E "s/WHERE id = '(.*)'/INSERT INTO public.drill_resources(id) VALUES ('\1');/" \
  | $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q

SEEDED=$(Q "SELECT count(*) FROM public.drill_resources")
NAMED=$(grep -oE "WHERE id = '[^']+'" "$MIG" | sort -u | wc -l | tr -d ' ')
[ "$SEEDED" = "$NAMED" ] || fail "migration names $NAMED distinct ids but only $SEEDED seeded — duplicate WHERE clauses"
pass "$NAMED distinct drill ids, one UPDATE each"

# ── 1. applies cleanly ───────────────────────────────────────────────────────
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$MIG" \
  || fail "migration did not apply — check quoting in the generated prose"
pass "applies cleanly from a standing start"

AFTER=$(Q "SELECT count(*) FROM public.drill_resources")
[ "$AFTER" = "$SEEDED" ] || fail "row count changed: $SEEDED before, $AFTER after — 067 must not insert or delete"
pass "row count unchanged ($AFTER) — nothing inserted, nothing deleted"

# ── 2. every named row actually changed ──────────────────────────────────────
# A migration that silently no-ops is indistinguishable from one that worked,
# unless something checks.
UNTOUCHED=$(Q "SELECT count(*) FROM public.drill_resources WHERE updated_at = '2000-01-01'")
[ "$UNTOUCHED" = "0" ] || fail "$UNTOUCHED rows were named but never written"
pass "all $AFTER named rows were actually updated"

WRITTEN=$(Q "SELECT count(*) FROM public.drill_resources
             WHERE description IS NOT NULL OR ai_coaching_notes IS NOT NULL
                OR success_markers IS NOT NULL OR regression_notes IS NOT NULL")
[ "$WRITTEN" = "$AFTER" ] || fail "only $WRITTEN of $AFTER rows received any instruction text"
pass "every row received instruction text"

# ── 3. nothing outside the agreed columns was touched ────────────────────────
for col in youtube_video_id youtube_url youtube_start_source resource_kind variation_type; do
  BAD=$(Q "SELECT count(*) FROM public.drill_resources WHERE $col IS DISTINCT FROM 'SENTINEL'")
  [ "$BAD" = "0" ] || fail "$BAD rows had $col modified — 067 must not touch media or taxonomy"
done
BAD=$(Q "SELECT count(*) FROM public.drill_resources WHERE youtube_start_seconds IS DISTINCT FROM 42")
[ "$BAD" = "0" ] || fail "$BAD rows had youtube_start_seconds modified — Phase 2C writes no timestamps"
pass "media, timestamp and taxonomy columns all untouched"

BAD=$(Q "SELECT count(*) FROM public.drill_resources
         WHERE duplicate_of_drill_id IS NOT NULL OR activity_family_id IS NOT NULL")
[ "$BAD" = "0" ] || fail "$BAD rows had canonicalization columns written"
pass "canonicalization columns untouched"

# ── 4. idempotent ────────────────────────────────────────────────────────────
SNAP=$(Q "SELECT md5(string_agg(
            coalesce(description,'') || coalesce(ai_coaching_notes,'') ||
            coalesce(array_to_string(success_markers,'|'),'') ||
            coalesce(regression_notes,'') || coalesce(progression_notes,''),
            '' ORDER BY id)) FROM public.drill_resources")
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$MIG" \
  || fail "second run failed — migration is not idempotent"
SNAP2=$(Q "SELECT md5(string_agg(
            coalesce(description,'') || coalesce(ai_coaching_notes,'') ||
            coalesce(array_to_string(success_markers,'|'),'') ||
            coalesce(regression_notes,'') || coalesce(progression_notes,''),
            '' ORDER BY id)) FROM public.drill_resources")
[ "$SNAP" = "$SNAP2" ] || fail "content changed on the second run — not idempotent"
pass "idempotent: second run leaves identical content"

# ── 5. the prose survived the round trip ─────────────────────────────────────
# The thing a quoting bug mangles is an apostrophe, so check one explicitly
# rather than trusting that no error meant no damage.
APOS=$(Q "SELECT count(*) FROM public.drill_resources WHERE description LIKE '%''%'")
[ "$APOS" -gt "0" ] || fail "no description contains an apostrophe — quoting has eaten something"
pass "$APOS descriptions round-tripped apostrophes intact"

TRUNC=$(Q "SELECT count(*) FROM public.drill_resources WHERE length(description) < 60 AND description IS NOT NULL")
[ "$TRUNC" = "0" ] || fail "$TRUNC descriptions are under 60 chars — text was truncated somewhere"
pass "no description was truncated"

echo ""
echo "067 applies, is idempotent, and stays inside its own columns."
