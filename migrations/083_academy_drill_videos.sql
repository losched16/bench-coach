-- ============================================================================
-- Migration 083: Academy drill videos (a lesson drill points at a library drill's video)
-- ============================================================================
-- Applied to the live Supabase project on 2026-11-03 (owner-approved; verified: RLS on, 1 read policy, no client write grants, 0 rows).
-- Additive and idempotent. The app code that uses it ships with the Academy drill videos PR (#35).
--
-- An Academy lesson contains drills ("Drill A - ..."). The BenchCoach drill library
-- (public.drill_resources) already carries a curated YouTube video for most drills, and the
-- development plans play it inline. This table lets the owner point one lesson drill at one
-- library drill so the lesson shows that video the same way.
--
-- What this table does NOT do:
--  * It copies no text and no video. The lesson keeps its own words; the video stays on YouTube.
--  * It does not approve anything by itself. A mapping is a 'candidate' until the owner approves
--    it, and approval needs a reviewer name and a date. Only approved rows reach a learner.
--  * drill_id is a soft link (no foreign key), like speed_program_exercise_drills. The app
--    treats a missing or retired library drill as "no video" instead of failing the lesson.
--
-- Written by the owner's admin API (service role) only. The only client policy is read of
-- APPROVED rows for a lesson the caller may already read; no client write privilege exists.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.academy_drill_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid NOT NULL,
  lesson_key       text NOT NULL,
  -- The drill's letter in the lesson ("A", "B", ...). One video per lesson drill.
  drill_label      text NOT NULL CHECK (drill_label ~ '^[A-Z]$'),
  drill_id         uuid NOT NULL,
  -- Where in the video this drill begins. NULL = nobody has said (never 0-as-unknown).
  start_seconds    integer CHECK (start_seconds IS NULL OR start_seconds >= 0),
  approval_status  text NOT NULL DEFAULT 'candidate' CHECK (approval_status IN ('candidate', 'approved', 'rejected', 'retired')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, lesson_key) REFERENCES public.academy_lessons(course_id, lesson_key) ON DELETE CASCADE,
  UNIQUE (course_id, lesson_key, drill_label),
  CHECK (approval_status <> 'approved' OR (reviewed_by IS NOT NULL AND length(trim(reviewed_by)) >= 2 AND reviewed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_academy_drill_videos_lesson ON public.academy_drill_videos (course_id, lesson_key) WHERE approval_status = 'approved';

ALTER TABLE public.academy_drill_videos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS academy_read_drill_videos ON public.academy_drill_videos;
  CREATE POLICY academy_read_drill_videos ON public.academy_drill_videos
    FOR SELECT USING (approval_status = 'approved' AND public.academy_can_read_lesson(course_id, lesson_key));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON public.academy_drill_videos FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON public.academy_drill_videos FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'GRANT SELECT ON public.academy_drill_videos TO anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'GRANT SELECT ON public.academy_drill_videos TO authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.academy_drill_videos TO service_role'; END IF;
END $$;
