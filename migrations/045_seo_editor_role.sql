-- ============================================================================
-- Migration 045: a database login that can only edit marketing copy
-- ============================================================================
-- The SEO conversion script needs to read seo_pages and write back a
-- structured block. That is the entire job.
--
-- The obvious way to give it that is SUPABASE_SERVICE_ROLE_KEY, which also
-- grants the ability to read every coach's roster, every scouting report and
-- every player note in the project, and to delete any of it. Handing over that
-- much authority for a job this small is how a credential ends up in a shell
-- history, a CI log or an agent transcript and takes the whole database with
-- it.
--
-- So: a role that can SELECT and UPDATE seo_pages and nothing else. Not the
-- users table, not rosters, not scouting. No DDL. No DELETE — a conversion
-- gone wrong should be recoverable by restoring content, never by discovering
-- that a page is gone.
--
-- Worst case if this credential leaks: somebody edits marketing pages. That is
-- a bad afternoon. It is not the business.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU RUN THIS
-- ---------------------------------------------------------------------------
-- Replace the password below. Generate one and keep it out of chat windows:
--
--     openssl rand -base64 32
--
-- Then the connection string is (from Supabase → Project Settings → Database,
-- using the SESSION POOLER host, port 5432):
--
--     postgresql://benchcoach_seo:<PASSWORD>@<HOST>:5432/postgres
--
-- Set that as SEO_DATABASE_URL. Never as a chat message — as an environment
-- variable in whatever runs the script.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'benchcoach_seo') THEN
    -- CHANGE THIS PASSWORD.
    CREATE ROLE benchcoach_seo LOGIN PASSWORD 'replace-me-before-running';
  END IF;
END
$$;

-- Rotating later is this one statement:
--   ALTER ROLE benchcoach_seo PASSWORD '<new password>';

-- ---------------------------------------------------------------------------
-- Exactly the grants the job needs
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE postgres TO benchcoach_seo;
GRANT USAGE ON SCHEMA public TO benchcoach_seo;

-- Read the page. Write back only the content column: the script adds a
-- `resource` key to the JSON and must never be able to change a slug, a
-- canonical, or is_published — those decide what Google sees and are not the
-- script's business.
GRANT SELECT ON public.seo_pages TO benchcoach_seo;
GRANT UPDATE (content) ON public.seo_pages TO benchcoach_seo;

-- Nothing else. Stated rather than assumed, because a future
-- GRANT ... ON ALL TABLES would otherwise quietly widen this.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM benchcoach_seo;
GRANT SELECT ON public.seo_pages TO benchcoach_seo;
GRANT UPDATE (content) ON public.seo_pages TO benchcoach_seo;

-- And no inheritance of whatever the default privileges hand out later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM benchcoach_seo;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Every table this role can touch, and how. Expect exactly two rows, both on
-- seo_pages: SELECT, and UPDATE on `content`.
SELECT table_name, privilege_type, column_name
FROM information_schema.column_privileges
WHERE grantee = 'benchcoach_seo'
UNION ALL
SELECT table_name, privilege_type, NULL
FROM information_schema.table_privileges
WHERE grantee = 'benchcoach_seo'
ORDER BY table_name, privilege_type;

-- Sanity: this must come back empty. If any other table appears, something
-- granted more than intended and the role is not narrow any more.
SELECT DISTINCT table_name
FROM information_schema.table_privileges
WHERE grantee = 'benchcoach_seo' AND table_name <> 'seo_pages';
