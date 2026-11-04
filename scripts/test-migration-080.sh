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

echo "-- migration 082: disputes (server-only audit table)"
P -v ON_ERROR_STOP=1 -q -f migrations/082_academy_disputes.sql >/dev/null 2>&1 || { P -v ON_ERROR_STOP=1 -q -f migrations/082_academy_disputes.sql; fail "082 did not apply"; }
P -v ON_ERROR_STOP=1 -q -f migrations/082_academy_disputes.sql >/dev/null 2>&1 || fail "082 is not idempotent"
pass "082 applies, and re-applies"
E2=$(P -tAq -c "INSERT INTO auth.users (id, email) VALUES ('99999999-0000-4000-8000-000000000009','d@x.test') RETURNING id")
EN=$(P -tAq -c "INSERT INTO academy_enrollments (user_id, course_id, source, granted_by) VALUES ('$E2','$C','admin_grant','t') RETURNING id")
eq "a dispute row can be recorded by the server" "$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_1','$EN','pi_1','open') RETURNING 1" 2>/dev/null || echo ERR)" "1"
eq "a dispute id can only be recorded once" "$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_1','$EN','pi_1','open') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a dispute status must be open, won or lost" "$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_2','$EN','pi_1','pending') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "an open dispute cannot carry a close date, a closed one must" "$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status, closed_at) VALUES ('dp_3','$EN','pi_1','open', now()) RETURNING 1" 2>/dev/null || echo ERR)$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_4','$EN','pi_1','lost') RETURNING 1" 2>/dev/null || echo ERR)" "ERRERR"
eq "a dispute must belong to a real enrollment" "$(P -tAq -c "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_5','00000000-0000-4000-8000-000000000000','pi_1','open') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a buyer cannot read dispute records" "$(R authenticated $E2 "SELECT count(*) FROM academy_disputes")" "ERR"
eq "a buyer cannot write dispute records" "$(R authenticated $E2 "INSERT INTO academy_disputes (dispute_id, enrollment_id, payment_intent, status) VALUES ('dp_6','$EN','pi_1','open') RETURNING 1")" "ERR"
eq "an anonymous visitor cannot read dispute records" "$(R anon '' "SELECT count(*) FROM academy_disputes")" "ERR"
eq "the service role can read and change them" "$(R service_role '' "UPDATE academy_disputes SET status='won', closed_at=now() WHERE dispute_id='dp_1' RETURNING 1")" "1"
eq "row level security is on for the dispute table" "$(P -tAq -c "SELECT relrowsecurity FROM pg_class WHERE relname='academy_disputes'")" "t"
eq "the dispute table has no policy at all" "$(P -tAq -c "SELECT count(*) FROM pg_policies WHERE tablename='academy_disputes'")" "0"
eq "082 changed nothing about enrollments" "$(P -tAq -c "SELECT count(*) FROM information_schema.columns WHERE table_name='academy_enrollments' AND column_name LIKE 'dispute%'")" "0"
echo "-- migration 083: drill videos (a lesson drill borrows a library drill's video)"
P -v ON_ERROR_STOP=1 -q -f migrations/083_academy_drill_videos.sql >/dev/null 2>&1 || { P -v ON_ERROR_STOP=1 -q -f migrations/083_academy_drill_videos.sql; fail "083 did not apply"; }
P -v ON_ERROR_STOP=1 -q -f migrations/083_academy_drill_videos.sql >/dev/null 2>&1 || fail "083 is not idempotent"
pass "083 applies, and re-applies"
DR='11111111-aaaa-4aaa-8aaa-111111111111'
eq "a mapping starts as a candidate" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','1-1','A','$DR') RETURNING approval_status")" "candidate"
eq "one video per lesson drill" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','1-1','A','$DR') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a drill label is one capital letter" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','1-1','a','$DR') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a mapping must be on a real lesson" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','9-9','A','$DR') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "approval needs a reviewer and a date" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='approved' WHERE drill_label='A' RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "approval needs a real reviewer name, not a blank" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='approved', reviewed_by=' ', reviewed_at=now() WHERE drill_label='A' RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a named, dated approval is accepted" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='approved', reviewed_by='Coach T', reviewed_at=now() WHERE drill_label='A' RETURNING 1")" "1"
eq "a negative start time is refused" "$(P -tAq -c "UPDATE academy_drill_videos SET start_seconds=-1 WHERE drill_label='A' RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "row security is on for the drill video table" "$(P -tAq -c "SELECT relrowsecurity::int FROM pg_class WHERE relname='academy_drill_videos'")" "1"
eq "a buyer with access reads the approved mapping" "$(R authenticated $E2 "SELECT count(*) FROM academy_drill_videos WHERE drill_label='A'")" "1"
eq "a visitor with no access reads no mapping (lesson 1.2 is paid)" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id, approval_status, reviewed_by, reviewed_at) VALUES ('$C','1-2','A','$DR','approved','T',now()) RETURNING 1" >/dev/null; R anon '' "SELECT count(*) FROM academy_drill_videos WHERE lesson_key='1-2'")" "0"
eq "a candidate mapping is never readable by a client" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='candidate', reviewed_by=NULL, reviewed_at=NULL WHERE drill_label='A' AND lesson_key='1-1'" >/dev/null; R authenticated $E2 "SELECT count(*) FROM academy_drill_videos WHERE lesson_key='1-1'")" "0"
eq "a buyer cannot write a mapping" "$(R authenticated $E2 "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','1-1','B','$DR') RETURNING 1")" "ERR"
eq "a buyer cannot approve a mapping" "$(R authenticated $E2 "UPDATE academy_drill_videos SET approval_status='approved', reviewed_by='me', reviewed_at=now() RETURNING 1")" "ERR"
eq "an anonymous visitor cannot write a mapping" "$(R anon '' "DELETE FROM academy_drill_videos RETURNING 1")" "ERR"
eq "the service role can manage mappings" "$(R service_role '' "UPDATE academy_drill_videos SET start_seconds=12 WHERE lesson_key='1-1' RETURNING 1")" "1"
echo "-- migration 084: a mapping can be a pasted YouTube video"
P -v ON_ERROR_STOP=1 -q -f migrations/084_academy_pasted_videos.sql >/dev/null 2>&1 || { P -v ON_ERROR_STOP=1 -q -f migrations/084_academy_pasted_videos.sql; fail "084 did not apply"; }
P -v ON_ERROR_STOP=1 -q -f migrations/084_academy_pasted_videos.sql >/dev/null 2>&1 || fail "084 is not idempotent"
pass "084 applies, and re-applies"
P -tAq -c "DELETE FROM academy_drill_videos" >/dev/null
eq "a pasted video is a valid mapping" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, youtube_video_id, title, channel) VALUES ('$C','1-1','A','abcdefghijk','T','Ch') RETURNING approval_status")" "candidate"
eq "a mapping needs a source" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label) VALUES ('$C','1-1','B') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a mapping cannot have both a library drill and a pasted video" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id, youtube_video_id) VALUES ('$C','1-1','B','$DR','abcdefghijk') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a pasted video id must be 11 safe characters" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, youtube_video_id) VALUES ('$C','1-1','B','x y') RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "a library mapping still works" "$(P -tAq -c "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, drill_id) VALUES ('$C','1-1','C','$DR') RETURNING approval_status")" "candidate"
eq "a pasted video still needs a named, dated approval" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='approved' WHERE drill_label='A' RETURNING 1" 2>/dev/null || echo ERR)" "ERR"
eq "an approved pasted video is readable by a buyer with access" "$(P -tAq -c "UPDATE academy_drill_videos SET approval_status='approved', reviewed_by='Coach T', reviewed_at=now() WHERE drill_label='A'" >/dev/null; R authenticated $E2 "SELECT count(*) FROM academy_drill_videos WHERE drill_label='A'")" "1"
eq "a candidate pasted video is not readable by a client" "$(R authenticated $E2 "SELECT count(*) FROM academy_drill_videos WHERE drill_label='C'")" "0"
eq "a buyer cannot paste a video" "$(R authenticated $E2 "INSERT INTO academy_drill_videos (course_id, lesson_key, drill_label, youtube_video_id) VALUES ('$C','1-1','D','abcdefghijk') RETURNING 1")" "ERR"
echo "ALL PASS"
