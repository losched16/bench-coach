-- SYNTHETIC drill-library fixture for the ISOLATED preview. Not for production.
--
-- Why it exists: the preview database is built from schema only, so it has no
-- drill library. The speed program maps each exercise to a library drill BY NAME
-- (speed_program_exercise_drills.drill_id is resolved from drill_resources.drill_name).
-- With no library rows, none of those links resolve and the mapping cannot be tested.
--
-- What it is: twelve placeholder rows, one for each distinct library drill the speed
-- program names. They carry the real drill NAMES so the by-name lookup works, and
-- nothing else of the real drills: no instructions, no coaching text, no video. The
-- description says in plain words that they are fixtures. Nothing is copied from
-- production, and no player or customer data is involved.
--
-- Run it AFTER the migrations (including 081_speed_program). Safe on a preview project
-- only: a few migrations seed a couple of BenchCoach-original drills, so it allows up to
-- 10 existing rows, and refuses if the library is larger than that (a real library has
-- hundreds) or if any fixture row is already there.

DO $$
BEGIN
  IF (SELECT count(*) FROM public.drill_resources) > 10 THEN
    RAISE EXCEPTION 'REFUSED: drill_resources already holds a real library. The synthetic drill fixture only runs on a preview project.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.drill_resources WHERE source = 'synthetic-preview-fixture') THEN
    RAISE EXCEPTION 'REFUSED: the synthetic drill fixture is already loaded.';
  END IF;
END $$;

INSERT INTO public.drill_resources (id, drill_name, skill_category, primary_skill, description, status, source, tags)
SELECT v.id::uuid, v.name, 'Athletic Development', 'synthetic fixture',
       'SYNTHETIC TEST FIXTURE. A placeholder so the program-to-library link can be tested in the preview. It contains no drill instructions and is not the real library drill.',
       'approved', 'synthetic-preview-fixture', ARRAY['synthetic-fixture']
FROM (VALUES
  ('f1000000-0000-4000-8000-000000000001', 'Baseball Dynamic Stretches for Youth Players'),
  ('f1000000-0000-4000-8000-000000000002', 'Wall Drive — Straight Body, Punch the Knee'),
  ('f1000000-0000-4000-8000-000000000003', 'Falling Start — Fall, Then Go'),
  ('f1000000-0000-4000-8000-000000000004', 'Ten-Yard Acceleration — Push, Push, Push'),
  ('f1000000-0000-4000-8000-000000000005', 'Tennis Ball Drop — See It, Go'),
  ('f1000000-0000-4000-8000-000000000006', 'Snap Down — Get Under Control Fast'),
  ('f1000000-0000-4000-8000-000000000007', 'Shuffle to Sprint — Open the Hips and Go'),
  ('f1000000-0000-4000-8000-000000000008', 'Plant and Go — The 45-Degree Cut'),
  ('f1000000-0000-4000-8000-000000000009', 'Four Cones Ground Ball Drill'),
  ('f1000000-0000-4000-8000-00000000000a', 'Pogo Jumps — Quick, Quiet Contacts'),
  ('f1000000-0000-4000-8000-00000000000b', 'Broad Jump — Jump and Stick It'),
  ('f1000000-0000-4000-8000-00000000000c', 'Three-Ball Slow Roller Drill')
) AS v(id, name);

-- Resolve the speed program's mapping to these rows (the same lookup 081 runs).
DO $$
BEGIN
  IF to_regclass('public.speed_program_exercise_drills') IS NOT NULL THEN
    UPDATE public.speed_program_exercise_drills m
       SET drill_id = (SELECT d.id FROM public.drill_resources d WHERE d.drill_name = m.drill_name ORDER BY d.id LIMIT 1)
     WHERE m.drill_name IS NOT NULL;
  END IF;
END $$;

SELECT 'synthetic drill fixture loaded' AS status,
       (SELECT count(*) FROM public.drill_resources WHERE source = 'synthetic-preview-fixture') AS fixture_drills,
       (SELECT count(*) FROM public.drill_resources WHERE source IS DISTINCT FROM 'synthetic-preview-fixture') AS migration_seeded_drills_expect_about_2;
