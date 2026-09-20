#!/usr/bin/env bash
# Apply 069 → 074 to a real Postgres and prove Phase 2H does what it says.
#
# 074 is generated, so the quoting class of bug is handled by the emitter. 072
# is hand-written and carries the security-critical part of this phase, so most
# of what is checked below is authorization, not content.
#
# The claims:
#
#    1. 072, 073 and 074 apply cleanly on top of 069 + 070 + 071
#    2. re-running all three changes nothing
#    3. a player may hold several pathways at once
#    4. a player may NOT hold two live enrollments in the same pathway
#    5. a completed enrollment does not block starting that pathway again
#    6. the event trigger overwrites a forged team_id with the enrollment's own
#    7. an event pointing at a non-existent enrollment is rejected
#    8. advanced / regressed events must say where they went
#    9. a completed row must carry completed_at, and a live one must not
#   10. RLS: a coach on another team can read nothing
#   11. RLS: a viewer may read but not enroll
#   12. RLS: a contributor may log a session but NOT advance a player
#   13. RLS: an admin may advance
#   14. RLS: anon is granted nothing at all
#   15. the policies do NOT use the broken 'record' / 'decide' role words
#   16. 073 adds three presets and leaves home_to_first alone
#   17. 073 is safe to run twice (no duplicate presets)
#   18. 074 adds the speed pathway with 10 contiguous stages
#   19. every stage-drill link resolves to a real drill row
#   20. no existing drill row is modified or deleted by 074
#
#   npm run test:migration-2h

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M69="$ROOT/migrations/069_development_pathways.sql"
M70="$ROOT/migrations/070_pathway_content.sql"
M71="$ROOT/migrations/071_pathway_coverage_expansion.sql"
M72="$ROOT/migrations/072_player_pathway_progress.sql"
M73="$ROOT/migrations/073_speed_metric_presets.sql"
M74="$ROOT/migrations/074_speed_agility_pathway.sql"
M75="$ROOT/migrations/075_pathway_notes.sql"
WORK=$(mktemp -d /tmp/bc-pg2h-XXXXXX)
PORT=${PGPORT_TEST:-55472}
SOCK="$WORK/sock"

for f in "$M72" "$M73" "$M74" "$M75"; do
  [ -f "$f" ] || { echo "SKIP: $f not written yet." >&2; exit 0; }
done

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN — this check needs a server." >&2
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

PSQL() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }
Q() { PSQL -tAqc "$1" | tr -d '[:space:]'; }
pass() { echo "  PASS  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }
eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3', got '$2'"; }

echo ""
echo "Phase 2H migrations — 069 → 074 on PostgreSQL 16"
echo ""

# ---------------------------------------------------------------------------
# Stubs. Enough of the real schema that the migrations are testing themselves
# and not a toy.
# ---------------------------------------------------------------------------
PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $f$;
-- The caller under test. Set with SET test.uid.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;

CREATE TABLE public.coaches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.teams   (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid REFERENCES coaches(id));
CREATE TABLE public.players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.team_members (
  team_id uuid REFERENCES teams(id), user_id uuid, role text,
  PRIMARY KEY (team_id, user_id));

-- The REAL authorization helpers, copied from migration 034. bc_rank knows
-- four role words and nothing else, which is the whole point of test 15.
CREATE OR REPLACE FUNCTION public.bc_rank(p_role TEXT) RETURNS INT AS $$
  SELECT CASE p_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2
                     WHEN 'contributor' THEN 1 WHEN 'viewer' THEN 0 ELSE -1 END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.bc_team_role(p_team UUID) RETURNS TEXT AS $$
DECLARE v_role TEXT;
BEGIN
  IF p_team IS NULL OR auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT 'owner' INTO v_role FROM teams t JOIN coaches c ON c.id = t.coach_id
    WHERE t.id = p_team AND c.user_id = auth.uid();
  IF v_role IS NOT NULL THEN RETURN v_role; END IF;
  SELECT tm.role INTO v_role FROM team_members tm
    WHERE tm.team_id = p_team AND tm.user_id = auth.uid() LIMIT 1;
  RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.bc_team_at_least(p_team UUID, p_min TEXT) RETURNS BOOLEAN AS $$
  SELECT bc_rank(bc_team_role(p_team)) >= bc_rank(p_min);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- metric_types / player_metrics, as 019 leaves them.
CREATE TABLE public.metric_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid REFERENCES coaches(id),
  slug text NOT NULL, label text NOT NULL, unit text,
  shape text NOT NULL DEFAULT 'measurement' CHECK (shape IN ('measurement','challenge')),
  direction text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher','lower')),
  default_attempts int, hint text, sort_order int DEFAULT 100,
  archived boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now(),
  UNIQUE (coach_id, slug));
INSERT INTO public.metric_types (coach_id, slug, label, unit, shape, direction, sort_order) VALUES
  (NULL,'exit_velo','Exit velocity','mph','measurement','higher',10),
  (NULL,'home_to_first','Home to first','sec','measurement','lower',40),
  (NULL,'sixty','60 yard dash','sec','measurement','lower',50);
CREATE TABLE public.player_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid NOT NULL, player_id uuid NOT NULL,
  metric text NOT NULL, value numeric NOT NULL, unit text, measured_on date NOT NULL,
  metric_type_id uuid REFERENCES metric_types(id), team_id uuid);

-- drill_resources, with the real CHECK constraints. 071 was rejected by
-- production for writing practice_roles = {teach,prepare} past a stub that had
-- none of these; the emitter now validates the same vocabulary up front, and
-- this is the second line of defence.
CREATE TABLE public.drill_resources (
  id uuid PRIMARY KEY, drill_name text, skill_category text, primary_skill text,
  secondary_skill text, description text, ai_coaching_notes text, safety_notes text,
  success_markers text[], reps_guidance text, regression_notes text, progression_notes text,
  mechanic_focus text[], common_flaws_fixed text[], tags text[],
  age_range text, min_age int, max_age int, difficulty_level text, progression_level int,
  competition_level text, equipment_needed text[], indoor_outdoor text, space_required text,
  requires_partner boolean, est_duration_minutes int, activity_format text, practice_roles text[],
  min_players int, max_players int, ideal_group_size int, min_coaches int, station_friendly boolean,
  rep_density text, idle_time_risk text, engagement_level text, competition_style text,
  instruction_complexity text, throwing_load text, physical_intensity text,
  mixed_skill_friendly boolean, resource_kind text, status text, source text,
  created_by_coach_id uuid, duplicate_of_drill_id uuid,
  CONSTRAINT dr_practice_roles CHECK (practice_roles IS NULL OR practice_roles <@ ARRAY[
    'warmup','teach','isolate','repetition','progress','decision','competition',
    'game_application','team_execution','assessment','finish']),
  CONSTRAINT dr_activity_format CHECK (activity_format IS NULL OR activity_format = ANY
    ('{individual,partner,small_group,station,full_team,game}'::text[])),
  CONSTRAINT dr_competition_level CHECK (competition_level = ANY (ARRAY['rec','travel','both'])),
  CONSTRAINT dr_competition_style CHECK (competition_style IS NULL OR competition_style = ANY
    ('{none,scored,head_to_head,team_vs_team,game}'::text[])),
  CONSTRAINT dr_engagement CHECK (engagement_level IS NULL OR engagement_level = ANY ('{low,medium,high}'::text[])),
  CONSTRAINT dr_idle CHECK (idle_time_risk IS NULL OR idle_time_risk = ANY ('{low,medium,high}'::text[])),
  CONSTRAINT dr_instruction CHECK (instruction_complexity IS NULL OR instruction_complexity = ANY ('{low,medium,high}'::text[])),
  CONSTRAINT dr_intensity CHECK (physical_intensity IS NULL OR physical_intensity = ANY ('{low,medium,high}'::text[])),
  CONSTRAINT dr_rep_density CHECK (rep_density IS NULL OR rep_density = ANY ('{low,medium,high}'::text[])),
  CONSTRAINT dr_throwing_load CHECK (throwing_load IS NULL OR throwing_load = ANY ('{none,low,medium,high}'::text[])),
  CONSTRAINT dr_resource_kind CHECK (resource_kind IS NULL OR resource_kind = ANY
    (ARRAY['activity','practice_unit','source_collection','teaching_content'])),
  CONSTRAINT dr_status CHECK (status = ANY (ARRAY['approved','pending_review','rejected'])),
  CONSTRAINT dr_player_counts CHECK (
    (min_players IS NULL OR min_players >= 1) AND (max_players IS NULL OR max_players >= 1) AND
    (ideal_group_size IS NULL OR ideal_group_size >= 1) AND (min_coaches IS NULL OR min_coaches >= 0) AND
    (min_players IS NULL OR max_players IS NULL OR max_players >= min_players)));
CREATE TABLE public.problem_taxonomy (slug text PRIMARY KEY, label text);
CREATE TABLE public.drill_problem_map (
  drill_id uuid, problem_slug text, sort_order int, curated boolean,
  PRIMARY KEY (drill_id, problem_slug));
SQL

# Seed every drill and problem 070, 071 and 074 name.
#
# The 19 ids 074 CREATES must NOT be pre-seeded: its insert is ON CONFLICT (id)
# DO NOTHING, so a stub sitting on one of those ids would make the migration
# silently skip it and the test would prove the opposite of what it claims.
# Every OTHER id in these files stands in for a production row.
#
# Not just "the section after the pathway marker" — the stage-drill links point
# at the new drills too, so the exclusion has to come from the create block
# itself.
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
awk '/^-- ── 1\. the drills/,/^ON CONFLICT \(id\) DO NOTHING;/' "$M74" \
  | grep -Eo "$UUID" | sort -u > "$WORK/created.txt"
cat "$M70" "$M71" "$M74" | grep -Eo "$UUID" | sort -u > "$WORK/all.txt"
comm -23 "$WORK/all.txt" "$WORK/created.txt" > "$WORK/seed.txt"

CREATED_IN_074=$(wc -l < "$WORK/created.txt" | tr -d ' ')
[ "$CREATED_IN_074" = "19" ] || fail "expected 074 to create 19 drill ids, its insert block names $CREATED_IN_074"

{
  echo "INSERT INTO public.drill_resources (id, drill_name, competition_level, resource_kind, status) VALUES"
  sed "s/^/('/; s/\$/','stub','both','activity','approved'),/" "$WORK/seed.txt" | sed '$ s/,$/;/'
} > "$WORK/seed.sql"
PSQL -v ON_ERROR_STOP=1 -q -f "$WORK/seed.sql"

$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.problem_taxonomy (slug, label)
SELECT DISTINCT m[1], m[1] FROM (
  SELECT regexp_matches(pg_read_file('$M70') || pg_read_file('$M71') || pg_read_file('$M74'),
    'problem_slug[^;]*?''([a-z0-9-]+)''', 'g') AS m) s
ON CONFLICT DO NOTHING;
INSERT INTO public.problem_taxonomy (slug, label)
SELECT DISTINCT m[1], m[1] FROM (
  SELECT regexp_matches(pg_read_file('$M70') || pg_read_file('$M71') || pg_read_file('$M74'),
    'VALUES[^;]*?,\s*''([a-z0-9-]+)'',\s*\d+,\s*true', 'g') AS m) s
ON CONFLICT DO NOTHING;
SQL

for f in "$M69" "$M70" "$M71"; do
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null 2>&1 || fail "prerequisite $f did not apply"
done
pass "069 + 070 + 071 apply (prerequisites)"

DRILLS_BEFORE=$(Q "SELECT count(*) FROM drill_resources")
NAMED_BEFORE=$(Q "SELECT count(*) FROM drill_resources WHERE drill_name <> 'stub'")

# ---------------------------------------------------------------------------
# 1. the three migrations apply
# ---------------------------------------------------------------------------
for f in "$M72" "$M73" "$M74" "$M75"; do
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" > "$WORK/$(basename "$f").log" 2>&1 \
    || { echo "--- $(basename "$f") ---"; tail -20 "$WORK/$(basename "$f").log"; fail "$(basename "$f") did not apply"; }
done
pass "072, 073, 074 and 075 apply cleanly"

# ---------------------------------------------------------------------------
# 2. idempotence
# ---------------------------------------------------------------------------
SNAP="SELECT (SELECT count(*) FROM drill_resources) || '/' ||
             (SELECT count(*) FROM metric_types) || '/' ||
             (SELECT count(*) FROM development_pathways) || '/' ||
             (SELECT count(*) FROM development_pathway_stages) || '/' ||
             (SELECT count(*) FROM development_pathway_stage_drills)"
BEFORE=$(Q "$SNAP")
for f in "$M72" "$M73" "$M74" "$M75"; do
  PSQL -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null 2>&1 || fail "re-running $(basename "$f") failed"
done
eq "re-running all four changes nothing" "$(Q "$SNAP")" "$BEFORE"

# ---------------------------------------------------------------------------
# Fixtures: two teams, four people.
# ---------------------------------------------------------------------------
PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),  -- head coach, team A
  ('22222222-2222-2222-2222-222222222222'),  -- assistant (admin), team A
  ('33333333-3333-3333-3333-333333333333'),  -- parent helper (contributor), A
  ('44444444-4444-4444-4444-444444444444'),  -- viewer, team A
  ('55555555-5555-5555-5555-555555555555');  -- another team's coach entirely
INSERT INTO public.coaches (id, user_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002','55555555-5555-5555-5555-555555555555');
INSERT INTO public.teams (id, coach_id) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002');
INSERT INTO public.team_members (team_id, user_id, role) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','admin'),
  ('bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','contributor'),
  ('bbbbbbbb-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','viewer');
INSERT INTO public.players (id, name) VALUES
  ('cccccccc-0000-0000-0000-000000000001','Charlie');
SQL

SPEED=$(Q "SELECT id FROM development_pathways WHERE slug='speed-and-agility-development'")
SWING=$(Q "SELECT id FROM development_pathways WHERE slug='build-the-swing'")
TEAM_A='bbbbbbbb-0000-0000-0000-000000000001'
PLAYER='cccccccc-0000-0000-0000-000000000001'

ENROLL="INSERT INTO player_pathway_progress
  (player_id, team_id, pathway_id, pathway_version, current_stage_key, current_stage_number)
  VALUES ('$PLAYER','$TEAM_A','%s',1,'%s',1)"

# ---------------------------------------------------------------------------
# 3-5. enrollment rules
# ---------------------------------------------------------------------------
PSQL -q -c "$(printf "$ENROLL" "$SPEED" "baseline-and-mechanics")" >/dev/null
PSQL -q -c "$(printf "$ENROLL" "$SWING" "athletic-stance")" >/dev/null 2>&1 \
  || PSQL -q -c "$(printf "$ENROLL" "$SWING" "stance")" >/dev/null
eq "a player may hold several pathways at once" \
   "$(Q "SELECT count(*) FROM player_pathway_progress WHERE player_id='$PLAYER'")" "2"

if PSQL -q -c "$(printf "$ENROLL" "$SPEED" "acceleration-position")" >/dev/null 2>&1; then
  fail "a second LIVE enrollment in the same pathway was allowed"
fi
pass "a player may not hold two live enrollments in the same pathway"

PROG=$(Q "SELECT id FROM player_pathway_progress WHERE pathway_id='$SPEED'")
PSQL -q -c "UPDATE player_pathway_progress SET status='completed', completed_at=now() WHERE id='$PROG'" >/dev/null
PSQL -q -c "$(printf "$ENROLL" "$SPEED" "baseline-and-mechanics")" >/dev/null 2>&1 \
  || fail "a completed enrollment blocked starting the pathway again"
pass "a completed enrollment does not block starting that pathway again"
PROG=$(Q "SELECT id FROM player_pathway_progress WHERE pathway_id='$SPEED' AND status='active'")

# ---------------------------------------------------------------------------
# 6-9. integrity
# ---------------------------------------------------------------------------
PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type, stage_key)
            VALUES ('$PROG','bbbbbbbb-0000-0000-0000-000000000002','session_logged','baseline-and-mechanics')" >/dev/null
eq "a forged team_id on an event is overwritten with the enrollment's own" \
   "$(Q "SELECT team_id FROM player_pathway_events WHERE event_type='session_logged'")" "$TEAM_A"

if PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type)
               VALUES ('$(uuidgen 2>/dev/null || echo 99999999-9999-9999-9999-999999999999)','$TEAM_A','session_logged')" >/dev/null 2>&1; then
  fail "an event pointing at a non-existent enrollment was accepted"
fi
pass "an event pointing at a non-existent enrollment is rejected"

if PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type, stage_key)
               VALUES ('$PROG','$TEAM_A','advanced','baseline-and-mechanics')" >/dev/null 2>&1; then
  fail "an 'advanced' event with no from/to was accepted"
fi
pass "advanced and regressed events must say where they went"

if PSQL -q -c "UPDATE player_pathway_progress SET status='completed' WHERE id='$PROG'" >/dev/null 2>&1; then
  fail "a completed row without completed_at was accepted"
fi
pass "a completed row must carry completed_at"

# ---------------------------------------------------------------------------
# 10-14. RLS. The service role has been writing so far; now become a user.
# ---------------------------------------------------------------------------
AS() { # AS <uid> <sql>  — run as an ordinary authenticated user
  $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAq \
    -c "SET ROLE authenticated; SET test.uid = '$1'; $2" 2>&1 | tr -d '[:space:]'
}
ASX() { # same, but report whether the statement succeeded
  $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q \
    -c "SET ROLE authenticated; SET test.uid = '$1'; $2" >/dev/null 2>&1 && echo yes || echo no
}

eq "an outside coach reads no enrollments" \
   "$(AS 55555555-5555-5555-5555-555555555555 "SELECT count(*) FROM player_pathway_progress")" "0"
eq "an outside coach reads no events" \
   "$(AS 55555555-5555-5555-5555-555555555555 "SELECT count(*) FROM player_pathway_events")" "0"
# Three by now: the completed speed enrollment, the swing one, and the speed
# one that was started again afterwards. A viewer sees the history too.
eq "a viewer on the team reads the enrollments" \
   "$(AS 44444444-4444-4444-4444-444444444444 "SELECT count(*) FROM player_pathway_progress")" "3"

eq "a viewer may NOT enroll a player" \
   "$(ASX 44444444-4444-4444-4444-444444444444 "$(printf "$ENROLL" "$SWING" "x")")" "no"
eq "a contributor may NOT enroll a player" \
   "$(ASX 33333333-3333-3333-3333-333333333333 "$(printf "$ENROLL" "$SWING" "x")")" "no"

LOG="INSERT INTO player_pathway_events (progress_id, team_id, event_type, stage_key)
     VALUES ('$PROG','$TEAM_A','session_logged','baseline-and-mechanics')"
eq "a contributor MAY log a session — that is a record of what happened" \
   "$(ASX 33333333-3333-3333-3333-333333333333 "$LOG")" "yes"
eq "a viewer may NOT log a session" \
   "$(ASX 44444444-4444-4444-4444-444444444444 "$LOG")" "no"

# An UPDATE blocked by RLS does NOT raise — the USING clause simply filters the
# row out and the statement succeeds having changed nothing. So these assert the
# EFFECT rather than the exit status, which is the only honest way to test a
# policy on UPDATE. (The INSERT checks above are different: a WITH CHECK
# violation does raise.)
STAGE_NOW() { Q "SELECT current_stage_key FROM player_pathway_progress WHERE id='$PROG'"; }
ADVANCE() { # ADVANCE <uid> <stage-key>
  $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -q \
    -c "SET ROLE authenticated; SET test.uid = '$1';
        UPDATE player_pathway_progress SET current_stage_key='$2', current_stage_number=2
        WHERE id='$PROG'" >/dev/null 2>&1 || true
}

ADVANCE 33333333-3333-3333-3333-333333333333 'contributor-moved-him'
eq "a contributor may NOT advance a player — that is a decision" \
   "$(STAGE_NOW)" "baseline-and-mechanics"

ADVANCE 55555555-5555-5555-5555-555555555555 'outsider-moved-him'
eq "an outside coach may NOT advance a player" \
   "$(STAGE_NOW)" "baseline-and-mechanics"

ADVANCE 44444444-4444-4444-4444-444444444444 'viewer-moved-him'
eq "a viewer may NOT advance a player" \
   "$(STAGE_NOW)" "baseline-and-mechanics"

ADVANCE 22222222-2222-2222-2222-222222222222 'acceleration-position'
eq "an admin MAY advance a player" \
   "$(STAGE_NOW)" "acceleration-position"

# The same trap on the other side: an admin must not be able to move a row OUT
# of their team, which is what the WITH CHECK clause is for.
$PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -q \
  -c "SET ROLE authenticated; SET test.uid = '22222222-2222-2222-2222-222222222222';
      UPDATE player_pathway_progress SET team_id='bbbbbbbb-0000-0000-0000-000000000002'
      WHERE id='$PROG'" >/dev/null 2>&1 || true
eq "an admin may NOT move an enrollment onto a team they do not administer" \
   "$(Q "SELECT team_id FROM player_pathway_progress WHERE id='$PROG'")" "$TEAM_A"

eq "anon holds no grant on progress" \
   "$(Q "SELECT count(*) FROM information_schema.role_table_grants
         WHERE grantee='anon' AND table_name='player_pathway_progress'")" "0"
eq "anon holds no grant on events" \
   "$(Q "SELECT count(*) FROM information_schema.role_table_grants
         WHERE grantee='anon' AND table_name='player_pathway_events'")" "0"

# ---------------------------------------------------------------------------
# 15. the broken role words are not reproduced
# ---------------------------------------------------------------------------
# bc_rank() returns -1 for 'record' and 'decide', so bc_team_at_least(t,'record')
# is `rank >= -1` — true for everyone, including auth.uid() IS NULL. 105 existing
# policy clauses in this schema do that. None of the new ones may.
eq "bc_rank really does treat 'record' as unknown (the defect is real)" \
   "$(Q "SELECT bc_rank('record')")" "-1"
eq "an unauthenticated caller really would pass a 'record' check" \
   "$(Q "SELECT bc_rank(NULL) >= bc_rank('record')")" "t"
eq "NO new policy uses a capability word where a role belongs" \
   "$(Q "SELECT count(*) FROM pg_policies WHERE tablename LIKE 'player_pathway%'
         AND (coalesce(qual,'') ~ '''(record|decide)''' OR coalesce(with_check,'') ~ '''(record|decide)''')")" "0"

# ---------------------------------------------------------------------------
# 16-17. metric presets
# ---------------------------------------------------------------------------
eq "all four speed benchmarks are present" \
   "$(Q "SELECT count(*) FROM metric_types WHERE coach_id IS NULL
         AND slug IN ('sprint_10y','sprint_20y','home_to_first','broad_jump')")" "4"
eq "no duplicate presets after two runs" \
   "$(Q "SELECT count(*) FROM metric_types WHERE coach_id IS NULL AND slug='sprint_10y'")" "1"
eq "the sprints read 'lower is better'" \
   "$(Q "SELECT count(*) FROM metric_types WHERE coach_id IS NULL
         AND slug IN ('sprint_10y','sprint_20y') AND direction='lower'")" "2"
eq "the broad jump reads 'higher is better'" \
   "$(Q "SELECT direction FROM metric_types WHERE coach_id IS NULL AND slug='broad_jump'")" "higher"
eq "home_to_first was left exactly as 019 wrote it" \
   "$(Q "SELECT label || '/' || unit || '/' || direction || '/' || sort_order
         FROM metric_types WHERE coach_id IS NULL AND slug='home_to_first'")" "Hometofirst/sec/lower/40"

# ---------------------------------------------------------------------------
# 18-20. the pathway
# ---------------------------------------------------------------------------
eq "the speed pathway is published under athleticism" \
   "$(Q "SELECT skill_category || '/' || status FROM development_pathways
         WHERE slug='speed-and-agility-development'")" "athleticism/published"
eq "it has 10 stages" \
   "$(Q "SELECT count(*) FROM development_pathway_stages WHERE pathway_id='$SPEED'")" "10"
eq "stage numbers are 1..10 and contiguous" \
   "$(Q "SELECT count(*) FROM (
          SELECT stage_number, row_number() OVER (ORDER BY stage_number) AS r
          FROM development_pathway_stages WHERE pathway_id='$SPEED') x
         WHERE x.stage_number <> x.r")" "0"
eq "every stage has an objective and a mastery signal" \
   "$(Q "SELECT count(*) FROM development_pathway_stages WHERE pathway_id='$SPEED'
         AND (objective IS NULL OR objective='' OR cardinality(mastery_signals)=0)")" "0"
eq "every stage has at least one primary drill" \
   "$(Q "SELECT count(*) FROM development_pathway_stages s WHERE s.pathway_id='$SPEED'
         AND NOT EXISTS (SELECT 1 FROM development_pathway_stage_drills d
                         WHERE d.stage_id=s.id AND d.role='primary')")" "0"
eq "every stage-drill link resolves to a real drill row" \
   "$(Q "SELECT count(*) FROM development_pathway_stage_drills d
         JOIN development_pathway_stages s ON s.id=d.stage_id
         LEFT JOIN drill_resources dr ON dr.id=d.drill_id
         WHERE s.pathway_id='$SPEED' AND dr.id IS NULL")" "0"
eq "19 movement drills were created" \
   "$(Q "SELECT count(*) FROM drill_resources WHERE skill_category='Athletic Development'
         AND source='benchcoach_original'")" "19"
eq "no previously-named drill row was deleted" \
   "$(Q "SELECT count(*) FROM drill_resources WHERE drill_name <> 'stub'")" \
   "$((NAMED_BEFORE + 19))"
eq "no drill row disappeared" \
   "$(Q "SELECT CASE WHEN count(*) >= $DRILLS_BEFORE THEN 'ok' ELSE 'lost' END FROM drill_resources")" "ok"
eq "every new drill passes the practice_roles CHECK" \
   "$(Q "SELECT count(*) FROM drill_resources WHERE source='benchcoach_original'
         AND skill_category='Athletic Development'
         AND NOT (practice_roles <@ ARRAY['warmup','teach','isolate','repetition','progress',
                  'decision','competition','game_application','team_execution','assessment','finish'])")" "0"
eq "no new drill carries a URL in any text field" \
   "$(Q "SELECT count(*) FROM drill_resources WHERE skill_category='Athletic Development'
         AND source='benchcoach_original'
         AND (description ~* 'https?://' OR ai_coaching_notes ~* 'https?://')")" "0"

# ---------------------------------------------------------------------------
# 21-24. notes (075)
# ---------------------------------------------------------------------------
PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type, stage_key, note)
            VALUES ('$PROG','$TEAM_A','note','acceleration-position','Hips sagging on the wall drive.')" >/dev/null \
  || fail "a note event was rejected"
pass "a note may be recorded against a stage"

eq "a contributor MAY write a note — it is a record, not a decision" \
   "$(ASX 33333333-3333-3333-3333-333333333333 "INSERT INTO player_pathway_events
      (progress_id, team_id, event_type, stage_key, note)
      VALUES ('$PROG','$TEAM_A','note','acceleration-position','seen it')")" "yes"
eq "a viewer may NOT write a note" \
   "$(ASX 44444444-4444-4444-4444-444444444444 "INSERT INTO player_pathway_events
      (progress_id, team_id, event_type, stage_key, note)
      VALUES ('$PROG','$TEAM_A','note','acceleration-position','nope')")" "no"
eq "an outside coach may NOT write a note" \
   "$(ASX 55555555-5555-5555-5555-555555555555 "INSERT INTO player_pathway_events
      (progress_id, team_id, event_type, stage_key, note)
      VALUES ('$PROG','$TEAM_A','note','acceleration-position','nope')")" "no"

# A widened constraint that stopped constraining would be worse than the gate
# it replaced.
if PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type)
               VALUES ('$PROG','$TEAM_A','whatever_i_like')" >/dev/null 2>&1; then
  fail "the event_type constraint accepts anything now"
fi
pass "an invented event type is still rejected"

# A note may be filed against a stage the player is not standing on — that is
# the point of a browsable plan.
PSQL -q -c "INSERT INTO player_pathway_events (progress_id, team_id, event_type, stage_key, note)
            VALUES ('$PROG','$TEAM_A','note','game-speed-and-retest','read ahead')" >/dev/null \
  || fail "a note against a stage the player has not reached was rejected"
pass "a note may be filed against a stage the player has not reached"

echo ""
echo "All checks passed."
echo ""
