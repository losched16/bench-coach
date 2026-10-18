#!/usr/bin/env bash
# Migration 080 — BenchCoach Academy.
#
# Proves, in a real Postgres with Supabase's roles and auth.uid(), that:
#   * the outline is public, but lesson TEXT needs the preview flag or an
#     active enrollment — for anon, for a signed-in non-buyer, and after a
#     revoke or refund;
#   * nobody can grant themselves a course from the client;
#   * progress is own-row only and needs access;
#   * unapproved video links are never readable;
#   * the migration is additive and re-runnable.
#
#   npm run test:migration-080
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
W=$(mktemp -d /tmp/bc-80-XXXXXX); mkdir -p "$W/sock"; chown -R ubuntu "$W" 2>/dev/null || true
su ubuntu -c "$PGBIN/initdb -D $W/data -U postgres --auth=trust" >/dev/null 2>&1
su ubuntu -c "$PGBIN/pg_ctl -D $W/data -o '-p 55480 -k $W/sock -c listen_addresses=' -l $W/pg.log start" >/dev/null 2>&1
sleep 2
P(){ $PGBIN/psql -h "$W/sock" -p 55480 -U postgres "$@"; }
pass(){ echo "  PASS  $1"; }
fail(){ echo "FAILED: $1"; exit 1; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 — expected '$3' got '$2'"; }
trap 'su ubuntu -c "$PGBIN/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT

# Run <sql> as <role> with auth.uid() = <uid> ('' = anonymous). Last row, or ERR.
R(){ local out; out=$(P -tAq -v ON_ERROR_STOP=1 2>&1 <<SQL
BEGIN; SET LOCAL ROLE $1; SELECT set_config('request.jwt.claim.sub', '$2', true) \gset
$3;
COMMIT;
SQL
) && echo "$out" | tail -1 | tr -d '[:space:]' || echo ERR; }

# Supabase's shape, reduced to what 080 uses.
P -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.test');
-- An existing table, to prove nothing outside academy_* changes.
CREATE TABLE public.coaches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_subscribed boolean DEFAULT false);
INSERT INTO public.coaches (user_id) VALUES ('11111111-1111-1111-1111-111111111111');
SQL

P -v ON_ERROR_STOP=1 -q -f migrations/080_academy.sql >/dev/null 2>&1 || { P -v ON_ERROR_STOP=1 -q -f migrations/080_academy.sql; fail "080 did not apply"; }
pass "080 applies"
P -v ON_ERROR_STOP=1 -q -f migrations/080_academy.sql >/dev/null 2>&1 || fail "080 is not idempotent"
pass "re-running changes nothing"
eq "every academy table has RLS on" "$(P -tAqc "SELECT bool_and(rowsecurity) FROM pg_tables WHERE tablename LIKE 'academy_%'")" "t"
eq "nothing in coaches changed" "$(P -tAqc "SELECT count(*) FROM coaches WHERE is_subscribed")" "0"

# A published course: module m1 with preview lesson 1-1 and paid lesson 1-2; a draft course.
P -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO academy_courses (id, slug, title, status, preview_lesson_key) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'swing', 'Swing', 'published', '1-1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'draft-course', 'Draft', 'draft', NULL);
INSERT INTO academy_modules (course_id, module_key, position, title) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'm1', 1, 'Foundation'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'm1', 1, 'Draft module');
INSERT INTO academy_lessons (course_id, lesson_key, module_key, kind, position, title, is_preview) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-1', 'm1', 'lesson', 1, 'Grip', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-2', 'm1', 'lesson', 2, 'Stance', false),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'd-1', 'm1', 'lesson', 1, 'Draft lesson', true);
INSERT INTO academy_lesson_bodies (course_id, lesson_key, blocks) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-1', '[{"type":"p","text":"preview"}]'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-2', '[{"type":"p","text":"paid"}]'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'd-1', '[{"type":"p","text":"draft"}]');
INSERT INTO academy_video_links (course_id, lesson_key, title, creator, watch_url, approval_status, reviewed_by, reviewed_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-2', 'Approved demo', 'Creator', 'https://www.youtube.com/watch?v=approved01', 'approved', 'Clint', now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', '1-2', 'Candidate', 'Creator', 'https://www.youtube.com/watch?v=candidate1', 'candidate', NULL, NULL);
SQL

C=aaaaaaaa-0000-0000-0000-000000000001
BUYER=11111111-1111-1111-1111-111111111111; OTHER=22222222-2222-2222-2222-222222222222

echo "-- outline vs text"
eq "anon sees the published course" "$(R anon '' "SELECT count(*) FROM academy_courses")" "1"
eq "anon sees the whole outline (2 lessons)" "$(R anon '' "SELECT count(*) FROM academy_lessons")" "2"
eq "anon reads the PREVIEW lesson text" "$(R anon '' "SELECT string_agg(lesson_key, ',') FROM academy_lesson_bodies")" "1-1"
eq "a signed-in non-buyer reads only the preview text" "$(R authenticated $OTHER "SELECT string_agg(lesson_key, ',') FROM academy_lesson_bodies")" "1-1"
eq "a draft course's preview is not readable" "$(R anon '' "SELECT count(*) FROM academy_lesson_bodies WHERE course_id='aaaaaaaa-0000-0000-0000-000000000002'")" "0"
eq "no video link is readable without access" "$(R authenticated $OTHER "SELECT count(*) FROM academy_video_links")" "0"

echo "-- nobody can grant themselves a course"
eq "anon cannot insert an enrollment" "$(R anon '' "INSERT INTO academy_enrollments (user_id, course_id, source, granted_by) VALUES ('$BUYER','$C','admin_grant','me') RETURNING 1")" "ERR"
eq "a signed-in user cannot insert their own enrollment" "$(R authenticated $BUYER "INSERT INTO academy_enrollments (user_id, course_id, source, granted_by) VALUES ('$BUYER','$C','admin_grant','me') RETURNING 1")" "ERR"
eq "a user cannot write progress without access" "$(R authenticated $BUYER "INSERT INTO academy_lesson_progress (user_id, course_id, lesson_key) VALUES ('$BUYER','$C','1-1') RETURNING 1")" "ERR"

# The server grants it (service role / owner).
P -q -c "INSERT INTO academy_enrollments (user_id, course_id, source, stripe_checkout_session_id, amount_total, currency) VALUES ('$BUYER','$C','purchase','cs_test_1',1900,'usd')"
echo "-- with an active enrollment"
eq "the buyer reads every lesson's text" "$(R authenticated $BUYER "SELECT string_agg(lesson_key, ',' ORDER BY lesson_key) FROM academy_lesson_bodies")" "1-1,1-2"
eq "the buyer sees only APPROVED video links" "$(R authenticated $BUYER "SELECT string_agg(title, ',') FROM academy_video_links")" "Approveddemo"
eq "the buyer sees their own enrollment" "$(R authenticated $BUYER "SELECT count(*) FROM academy_enrollments")" "1"
eq "another user does not see it" "$(R authenticated $OTHER "SELECT count(*) FROM academy_enrollments")" "0"
eq "another user still reads only the preview" "$(R authenticated $OTHER "SELECT string_agg(lesson_key, ',') FROM academy_lesson_bodies")" "1-1"
eq "the buyer cannot edit their enrollment (e.g. un-revoke later)" "$(R authenticated $BUYER "UPDATE academy_enrollments SET status='active' RETURNING 1")" ""
eq "the buyer cannot delete their enrollment" "$(R authenticated $BUYER "DELETE FROM academy_enrollments RETURNING 1")" ""
eq "the buyer records progress" "$(R authenticated $BUYER "INSERT INTO academy_lesson_progress (user_id, course_id, lesson_key) VALUES ('$BUYER','$C','1-2') RETURNING 1")" "1"
eq "the buyer marks it complete" "$(R authenticated $BUYER "UPDATE academy_lesson_progress SET completed_at=now() WHERE lesson_key='1-2' RETURNING 1")" "1"
eq "the buyer cannot write progress for someone else" "$(R authenticated $BUYER "INSERT INTO academy_lesson_progress (user_id, course_id, lesson_key) VALUES ('$OTHER','$C','1-1') RETURNING 1")" "ERR"
eq "another user cannot read the buyer's progress" "$(R authenticated $OTHER "SELECT count(*) FROM academy_lesson_progress")" "0"
eq "progress for a lesson that does not exist is refused" "$(R authenticated $BUYER "INSERT INTO academy_lesson_progress (user_id, course_id, lesson_key) VALUES ('$BUYER','$C','9-9') RETURNING 1")" "ERR"
eq "service-only tables are closed to clients" "$(R authenticated $BUYER "SELECT count(*) FROM academy_stripe_events")$(R authenticated $BUYER "SELECT count(*) FROM academy_editorial_flags")" "00"

echo "-- revoke and refund"
P -q -c "UPDATE academy_enrollments SET status='revoked', revoked_at=now(), revoke_reason='test' WHERE user_id='$BUYER'"
eq "after a revoke the buyer is back to the preview only" "$(R authenticated $BUYER "SELECT string_agg(lesson_key, ',') FROM academy_lesson_bodies")" "1-1"
eq "...and can no longer record progress" "$(R authenticated $BUYER "UPDATE academy_lesson_progress SET completed_at=now() RETURNING 1")" "ERR"
P -q -c "UPDATE academy_enrollments SET status='refunded' WHERE user_id='$BUYER'"
eq "a refunded enrollment gives no access" "$(R authenticated $BUYER "SELECT count(*) FROM academy_lesson_bodies WHERE lesson_key='1-2'")" "0"

echo "-- data rules"
eq "an active enrollment cannot carry a revoke date" "$(P -tAq -c "UPDATE academy_enrollments SET status='active' WHERE user_id='$BUYER' RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a purchase needs a checkout session id" "$(P -tAq -c "INSERT INTO academy_enrollments (user_id, course_id, source) VALUES ('$OTHER','$C','purchase') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "one checkout session can never enroll twice" "$(P -tAq -c "INSERT INTO academy_enrollments (user_id, course_id, source, stripe_checkout_session_id) VALUES ('$OTHER','$C','purchase','cs_test_1') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "an approved video needs a reviewer and date" "$(P -tAq -c "INSERT INTO academy_video_links (course_id, lesson_key, title, creator, watch_url, approval_status) VALUES ('$C','1-1','x','y','https://example.com/v','approved') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a non-https video link is refused" "$(P -tAq -c "INSERT INTO academy_video_links (course_id, lesson_key, title, creator, watch_url) VALUES ('$C','1-1','x','y','javascript:alert(1)') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a lesson outside a module must be intro/resource" "$(P -tAq -c "INSERT INTO academy_lessons (course_id, lesson_key, kind, position, title) VALUES ('$C','x','lesson',9,'x') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "deleting a user removes their enrollment and progress" "$(P -tAq -c "DELETE FROM auth.users WHERE id='$BUYER'"; P -tAqc "SELECT count(*) FROM academy_enrollments WHERE user_id='$BUYER'")" "0"
echo "ALL PASS"
