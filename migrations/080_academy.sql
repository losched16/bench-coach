-- ============================================================================
-- Migration 080: BenchCoach Academy — courses, enrollments, reading progress
-- ============================================================================
-- A course is something a person BUYS ONCE and READS. It is not a subscription,
-- not a team feature, and not a coaching workflow:
--
--   * Access lives here (academy_enrollments), never on `coaches`. Buying a
--     course does not touch is_subscribed / subscription_tier, and a
--     subscription does not unlock a course.
--   * Progress here is READING progress ("I finished lesson 2.1"). A player's
--     skill progress stays in the development workflow (player_pathway_*);
--     nothing in this file stores anything about a player.
--   * Lesson OUTLINES (titles, numbers) are public so the sales page can show
--     the curriculum. Lesson BODIES live in their own table and are readable
--     only for the free preview lesson or with an active enrollment — row-level
--     security cannot hide one column, so the split is what makes it enforceable.
--   * Enrollments are written only by the server (service role) after a
--     Stripe-verified payment or an admin grant. No client policy can insert,
--     update or delete one.
--   * Editorial flags and processed Stripe events have RLS on and no policies:
--     service role only.
--
-- Course content is NOT in this file (the repository is public). It is loaded
-- by `npm run academy:import` from the private manuscript.
--
-- Additive and idempotent. Zero rows in existing tables are modified.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academy_courses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                text NOT NULL,
  subtitle             text,
  summary              text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  preview_lesson_key   text,
  -- The course-wide safety notice, shown with every lesson that has drills.
  safety_note          text,
  content_version      integer NOT NULL DEFAULT 1 CHECK (content_version >= 1),
  -- What the page shows and what Checkout charges. Both NULL = not for sale
  -- yet; the buy button stays disabled. The price is a business decision and
  -- is never defaulted here.
  price_cents          integer CHECK (price_cents IS NULL OR price_cents > 0),
  currency             text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  stripe_price_id      text CHECK (stripe_price_id IS NULL OR stripe_price_id ~ '^price_'),
  -- Soft link to the canonical coaching workflow this course feeds
  -- (development_pathways.slug). Phase 2 uses it to start a player's plan;
  -- Phase 1 only points at it.
  related_pathway_slug text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_modules (
  course_id   uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  module_key  text NOT NULL CHECK (module_key ~ '^[a-z0-9-]+$'),
  position    integer NOT NULL CHECK (position >= 1),
  title       text NOT NULL,
  subtitle    text,
  outcome     text,
  -- The module's field test is body text: it lives on the module's last
  -- lesson in academy_lesson_bodies.field_test, behind the same access rule.
  PRIMARY KEY (course_id, module_key),
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS public.academy_lessons (
  course_id    uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  lesson_key   text NOT NULL CHECK (lesson_key ~ '^[a-z0-9-]+$'),
  module_key   text,
  kind         text NOT NULL CHECK (kind IN ('intro', 'lesson', 'resource')),
  position     integer NOT NULL CHECK (position >= 1),
  number_label text,
  title        text NOT NULL,
  summary      text,
  est_minutes  integer CHECK (est_minutes IS NULL OR est_minutes BETWEEN 1 AND 120),
  is_preview   boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  PRIMARY KEY (course_id, lesson_key),
  UNIQUE (course_id, position),
  FOREIGN KEY (course_id, module_key) REFERENCES public.academy_modules(course_id, module_key) ON DELETE CASCADE,
  CHECK ((kind = 'lesson') = (module_key IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.academy_lesson_bodies (
  course_id    uuid NOT NULL,
  lesson_key   text NOT NULL,
  blocks       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocks) = 'array'),
  field_test   text,
  source_hash  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, lesson_key),
  FOREIGN KEY (course_id, lesson_key) REFERENCES public.academy_lessons(course_id, lesson_key) ON DELETE CASCADE
);

-- External demonstrations. Linked out, never rehosted. Only 'approved' rows
-- are ever shown to a learner, and approval needs a named reviewer and date.
CREATE TABLE IF NOT EXISTS public.academy_video_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid NOT NULL,
  lesson_key       text NOT NULL,
  kind             text NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'article')),
  title            text NOT NULL,
  creator          text NOT NULL,
  watch_url        text NOT NULL CHECK (watch_url ~ '^https://[^\s]+$'),
  supported_skill  text,
  start_seconds    integer CHECK (start_seconds IS NULL OR start_seconds >= 0),
  approval_status  text NOT NULL DEFAULT 'candidate' CHECK (approval_status IN ('candidate', 'approved', 'rejected', 'retired')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  age_fit          text,
  safety_notes     text,
  link_status      text NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked', 'ok', 'broken')),
  last_checked_at  timestamptz,
  position         integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, lesson_key) REFERENCES public.academy_lessons(course_id, lesson_key) ON DELETE CASCADE,
  CHECK (approval_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  UNIQUE (course_id, lesson_key, watch_url)
);

-- ---------------------------------------------------------------------------
-- Access and progress
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academy_enrollments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id                   uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE RESTRICT,
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'refunded')),
  source                      text NOT NULL CHECK (source IN ('purchase', 'admin_grant', 'bundle', 'league_grant')),
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  stripe_customer_id          text,
  amount_total                integer,
  currency                    text,
  granted_by                  text,
  enrolled_at                 timestamptz NOT NULL DEFAULT now(),
  revoked_at                  timestamptz,
  revoke_reason               text,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id),
  CHECK ((status = 'active') = (revoked_at IS NULL)),
  CHECK (source <> 'purchase' OR stripe_checkout_session_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS academy_enrollments_payment_intent_idx
  ON public.academy_enrollments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.academy_lesson_progress (
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id        uuid NOT NULL,
  lesson_key       text NOT NULL,
  content_version  integer NOT NULL DEFAULT 1,
  first_opened_at  timestamptz NOT NULL DEFAULT now(),
  last_opened_at   timestamptz NOT NULL DEFAULT now(),
  -- Reading acknowledgement only. Not skill mastery.
  completed_at     timestamptz,
  PRIMARY KEY (user_id, course_id, lesson_key),
  FOREIGN KEY (course_id, lesson_key) REFERENCES public.academy_lessons(course_id, lesson_key) ON DELETE CASCADE
);

-- Every Stripe event the Academy has acted on: a replayed event is a no-op.
CREATE TABLE IF NOT EXISTS public.academy_stripe_events (
  event_id     text PRIMARY KEY,
  event_type   text NOT NULL,
  outcome      text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Internal editorial review list (from the importer). Never shown to learners.
CREATE TABLE IF NOT EXISTS public.academy_editorial_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  lesson_key  text,
  flag        text NOT NULL,
  detail      text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, lesson_key, flag)
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.academy_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS academy_courses_touch ON public.academy_courses;
CREATE TRIGGER academy_courses_touch BEFORE UPDATE ON public.academy_courses
  FOR EACH ROW EXECUTE FUNCTION public.academy_touch_updated_at();
DROP TRIGGER IF EXISTS academy_enrollments_touch ON public.academy_enrollments;
CREATE TRIGGER academy_enrollments_touch BEFORE UPDATE ON public.academy_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.academy_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so a policy on one table can ask about
-- another without granting the caller read access to it; each answers only
-- about the CALLER (auth.uid()), never about an arbitrary user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.academy_course_published(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.academy_courses WHERE id = p_course AND status = 'published')
$$;

CREATE OR REPLACE FUNCTION public.academy_has_access(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.academy_enrollments
    WHERE course_id = p_course AND user_id = auth.uid() AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION public.academy_can_read_lesson(p_course uuid, p_lesson text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.academy_lessons l
    JOIN public.academy_courses c ON c.id = l.course_id
    WHERE l.course_id = p_course AND l.lesson_key = p_lesson
      AND c.status = 'published' AND l.status = 'published'
      AND (l.is_preview OR public.academy_has_access(p_course)))
$$;

REVOKE ALL ON FUNCTION public.academy_course_published(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.academy_has_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.academy_can_read_lesson(uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.academy_course_published(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.academy_has_access(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.academy_can_read_lesson(uuid, text) TO anon, authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.academy_courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_modules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lessons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_bodies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_video_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_enrollments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_stripe_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_editorial_flags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS academy_read_courses ON public.academy_courses;
  CREATE POLICY academy_read_courses ON public.academy_courses
    FOR SELECT USING (status = 'published');

  DROP POLICY IF EXISTS academy_read_modules ON public.academy_modules;
  CREATE POLICY academy_read_modules ON public.academy_modules
    FOR SELECT USING (public.academy_course_published(course_id));

  -- Outline only: titles, numbers, minutes. Public for a published course.
  DROP POLICY IF EXISTS academy_read_lessons ON public.academy_lessons;
  CREATE POLICY academy_read_lessons ON public.academy_lessons
    FOR SELECT USING (status = 'published' AND public.academy_course_published(course_id));

  -- The paid text: the preview lesson, or an active enrollment.
  DROP POLICY IF EXISTS academy_read_bodies ON public.academy_lesson_bodies;
  CREATE POLICY academy_read_bodies ON public.academy_lesson_bodies
    FOR SELECT USING (public.academy_can_read_lesson(course_id, lesson_key));

  DROP POLICY IF EXISTS academy_read_videos ON public.academy_video_links;
  CREATE POLICY academy_read_videos ON public.academy_video_links
    FOR SELECT USING (approval_status = 'approved' AND public.academy_can_read_lesson(course_id, lesson_key));

  -- Your own enrollments, read-only. No insert/update/delete policy exists.
  DROP POLICY IF EXISTS academy_read_own_enrollments ON public.academy_enrollments;
  CREATE POLICY academy_read_own_enrollments ON public.academy_enrollments
    FOR SELECT USING (user_id = auth.uid());

  DROP POLICY IF EXISTS academy_read_own_progress ON public.academy_lesson_progress;
  CREATE POLICY academy_read_own_progress ON public.academy_lesson_progress
    FOR SELECT USING (user_id = auth.uid());
  DROP POLICY IF EXISTS academy_ins_own_progress ON public.academy_lesson_progress;
  CREATE POLICY academy_ins_own_progress ON public.academy_lesson_progress
    FOR INSERT WITH CHECK (user_id = auth.uid() AND public.academy_has_access(course_id));
  DROP POLICY IF EXISTS academy_upd_own_progress ON public.academy_lesson_progress;
  CREATE POLICY academy_upd_own_progress ON public.academy_lesson_progress
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND public.academy_has_access(course_id));
  DROP POLICY IF EXISTS academy_del_own_progress ON public.academy_lesson_progress;
  CREATE POLICY academy_del_own_progress ON public.academy_lesson_progress
    FOR DELETE USING (user_id = auth.uid());
END $$;

-- ---------------------------------------------------------------------------
-- After applying (read-only checks):
--   SELECT count(*) FROM academy_courses;            -- 0 until the import runs
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'academy_%';  -- all true
-- ---------------------------------------------------------------------------
