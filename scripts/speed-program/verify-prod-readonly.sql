-- Speed program: READ-ONLY checks to run in the Supabase SQL editor.
-- Every statement is a SELECT against the catalog or reads counts. Nothing is
-- inserted, updated, deleted or created, and no child's record is read.
--
-- PART 1 - before applying 081: the things it depends on exist.
-- PART 2 - after applying 081: it did what the Postgres tests say it does.
-- Each row has a "pass" column; every row should say true.

-- ===== PART 1: before 081 =====
select 'helper bc_rank exists' as check, (to_regprocedure('public.bc_rank(text)') is not null) as pass
union all select 'helper bc_team_role exists', (to_regprocedure('public.bc_team_role(uuid)') is not null)
union all select 'helper bc_team_at_least exists', (to_regprocedure('public.bc_team_at_least(uuid, text)') is not null)
union all select 'bc_rank knows role words (admin=2, viewer=0)', (public.bc_rank('admin') = 2 and public.bc_rank('viewer') = 0)
union all select 'bc_rank gives -1 for capability words (why 081 uses role words)', (public.bc_rank('record') = -1 and public.bc_rank('decide') = -1)
union all select 'bc_team_role is SECURITY DEFINER', (select prosecdef from pg_proc where oid = 'public.bc_team_role(uuid)'::regprocedure)
union all select 'bc_team_at_least is SECURITY DEFINER', (select prosecdef from pg_proc where oid = 'public.bc_team_at_least(uuid, text)'::regprocedure)
union all select 'table ' || t || ' exists', (to_regclass('public.' || t) is not null)
  from unnest(array['players', 'teams', 'team_members', 'coaches', 'drill_resources']) as t
union all select 'authenticated cannot bypass RLS', not (select rolbypassrls from pg_roles where rolname = 'authenticated');

-- Library drills the mapping points at. Names that are missing are listed, not
-- an error: the mapping row just keeps a null drill_id until the drill exists.
select d as expected_drill, exists (select 1 from public.drill_resources r where r.drill_name = d) as present_in_library
from unnest(array[
  'Baseball Dynamic Stretches for Youth Players', 'Wall Drive — Straight Body, Punch the Knee', 'Falling Start — Fall, Then Go',
  'Ten-Yard Acceleration — Push, Push, Push', 'Tennis Ball Drop — See It, Go', 'Snap Down — Get Under Control Fast',
  'Shuffle to Sprint — Open the Hips and Go', 'Plant and Go — The 45-Degree Cut', 'Four Cones Ground Ball Drill',
  'Pogo Jumps — Quick, Quiet Contacts', 'Broad Jump — Jump and Stick It', 'Three-Ball Slow Roller Drill']) as d
order by present_in_library, d;

-- ===== PART 2: after 081 =====
select 'five speed_program tables exist' as check,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'speed_program%') = 5 as pass
union all select 'row level security is on for all five',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'speed_program%' and c.relkind = 'r' and c.relrowsecurity) = 5
union all select 'no policy uses a capability word as a role',
  (select count(*) from pg_policies where tablename like 'speed_program%' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(record|decide)''') = 0
union all select 'history tables have no UPDATE/DELETE/ALL policy',
  (select count(*) from pg_policies where tablename in ('speed_program_sessions', 'speed_program_assessments', 'speed_program_events') and cmd in ('UPDATE', 'DELETE', 'ALL')) = 0
union all select 'anon has no privilege on any speed table',
  (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_name like 'speed_program%') = 0
union all select 'authenticated has no DELETE/TRUNCATE, and UPDATE only on assignments',
  (select count(*) from information_schema.role_table_grants where grantee = 'authenticated' and table_name like 'speed_program%'
    and (privilege_type in ('DELETE', 'TRUNCATE') or (privilege_type = 'UPDATE' and table_name <> 'speed_program_assignments'))) = 0
union all select 'service_role has no UPDATE/DELETE on the history tables',
  (select count(*) from information_schema.role_table_grants where grantee = 'service_role'
    and table_name in ('speed_program_sessions', 'speed_program_assessments', 'speed_program_events') and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')) = 0
union all select 'append-only triggers are present on the three history tables',
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_speed_program_sessions_append_only', 'trg_speed_program_assessments_append_only', 'trg_speed_program_events_append_only')) = 3
union all select 'child scope triggers are present',
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_speed_program_sessions_scope', 'trg_speed_program_assessments_scope', 'trg_speed_program_events_scope')) = 3
union all select 'plan-snapshot guard trigger is present',
  (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_speed_program_assignment_guard') = 1
union all select 'the mapping has 14 exercises', (select count(*) from public.speed_program_exercise_drills) = 14
union all select 'no speed program has been created yet (expected before the feature is enabled)', (select count(*) from public.speed_program_assignments) = 0;

-- The policy list, for reading.
select tablename, policyname, cmd from pg_policies where tablename like 'speed_program%' order by tablename, cmd, policyname;
