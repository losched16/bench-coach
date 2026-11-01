-- Rollback for 081. DESTRUCTIVE: deletes every assigned program, session,
-- assessment and event. Export first if any real coach has used it:
--   \copy (select * from public.speed_program_sessions) to 'sessions.csv' csv header
-- (repeat for assignments, assessments, events).
-- Nothing outside the speed_program_* tables is touched.
DROP TABLE IF EXISTS public.speed_program_events CASCADE;
DROP TABLE IF EXISTS public.speed_program_assessments CASCADE;
DROP TABLE IF EXISTS public.speed_program_sessions CASCADE;
DROP TABLE IF EXISTS public.speed_program_exercise_drills CASCADE;
DROP TABLE IF EXISTS public.speed_program_assignments CASCADE;
DROP FUNCTION IF EXISTS public.bc_speed_program_child_scope();
DROP FUNCTION IF EXISTS public.bc_speed_program_append_only();
DROP FUNCTION IF EXISTS public.bc_speed_program_assignment_guard();
