-- Placeholder Academy course for Stripe TEST-MODE checks. No manuscript text.
-- Safe to run on a database that already holds the real course: it only touches
-- the slug 'academy-test-course'. Idempotent. Stays DRAFT and unpriced until
-- the Stripe test price id exists (see the UPDATE at the bottom, commented out).
INSERT INTO public.academy_courses (slug, title, subtitle, summary, status, preview_lesson_key, content_version, currency)
VALUES ('academy-test-course', 'Academy test course (placeholder)', 'Test only', 'Placeholder for Stripe test-mode checks.', 'draft', '1-1', 1, 'usd')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.academy_modules (course_id, module_key, position, title)
SELECT id, 'test', 1, 'Test module' FROM public.academy_courses WHERE slug = 'academy-test-course'
ON CONFLICT DO NOTHING;

INSERT INTO public.academy_lessons (course_id, lesson_key, module_key, kind, position, number_label, title, est_minutes, is_preview, status)
SELECT id, v.k, 'test', 'lesson', v.pos, v.k, v.t, 2, v.prev, 'published'
FROM public.academy_courses c,
     (VALUES ('1-1', 1, 'Free placeholder lesson', true), ('1-2', 2, 'Paid placeholder lesson', false)) AS v(k, pos, t, prev)
WHERE c.slug = 'academy-test-course'
ON CONFLICT DO NOTHING;

INSERT INTO public.academy_lesson_bodies (course_id, lesson_key, blocks)
SELECT c.id, v.k, jsonb_build_array(jsonb_build_object('type', 'p', 'text', v.txt))
FROM public.academy_courses c,
     (VALUES ('1-1', 'PLACEHOLDER free lesson text. Not course content.'), ('1-2', 'PLACEHOLDER paid lesson text. Visible only after a test purchase.')) AS v(k, txt)
WHERE c.slug = 'academy-test-course'
ON CONFLICT DO NOTHING;

-- LATER, once the Stripe TEST price exists (replace price_XXXX; do not run before):
-- UPDATE public.academy_courses SET status='published', price_cents=2900, stripe_price_id='price_XXXX' WHERE slug='academy-test-course';
