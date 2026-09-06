-- ============================================================================
-- 052 — Close a live data exposure: four SECURITY DEFINER views readable by anon
-- ============================================================================
--
-- WHAT IS WRONG
--
-- Four views in `public` are defined with the SECURITY DEFINER property and are
-- owned by `postgres`. A SECURITY DEFINER view executes with its OWNER's
-- privileges, which means Row Level Security on the tables underneath does not
-- apply to whoever queries the view. Supabase's default grants then give
-- `anon` and `authenticated` SELECT on it.
--
-- The `anon` key is public by design — it ships in the JavaScript bundle of
-- every page of the deployed site. So this was reachable by anyone, with no
-- account, using a key they could read out of the page source.
--
-- Verified on 2026-09-06 against production with an unauthenticated request:
--
--   admin_user_activity        HTTP 206, 10 rows
--   player_season_batting      HTTP 206, 58 rows
--   admin_daily_active_users   HTTP 206, 17 rows
--   admin_feature_usage        HTTP 206,  9 rows
--
-- Only row COUNTS were requested; no personal data was read.
--
-- admin_user_activity carries display_name, is_subscribed, subscription_tier,
-- stripe_customer_id, signup_date, last_active and per-user activity counts,
-- for every registered account. player_season_batting carries per-player
-- season batting records — children's data, across every team.
--
-- RLS itself was working. The same unauthenticated request against `coaches`,
-- `players` and `teams` returned zero rows. The views were the way around it.
--
-- WHY THIS FIX IS SAFE
--
-- Every reader of these four views in the application uses the service-role
-- client: app/api/admin/route.ts, app/api/stats/route.ts,
-- app/api/stats/player-card/route.ts, app/api/lineup/route.ts,
-- app/api/chat/route.ts and lib/coachContext.ts. The service role bypasses RLS,
-- so switching the views to security_invoker changes nothing for them. No
-- browser client reads these views at all, which is why the grants can go too.
--
-- TWO LAYERS, EITHER OF WHICH WOULD BE SUFFICIENT
--
--   1. security_invoker — the view runs as the CALLER, so RLS on the
--      underlying tables applies. This is the actual bug, fixed at the source.
--   2. REVOKE — the browser roles lose SELECT entirely, which also removes the
--      views from the public PostgREST surface.
--
-- Both, because the first depends on the underlying tables having correct RLS
-- and the second does not, and after a finding like this the belt and the
-- braces are both worth having.
--
-- Requires PostgreSQL 15 or newer for security_invoker. Production is 17.6.
-- Additive and idempotent; safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Make each view respect the caller's row level security.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'admin_user_activity',
    'player_season_batting',
    'admin_daily_active_users',
    'admin_feature_usage'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Take the browser roles off them entirely.
--
-- Wrapped in a role-existence check so this also applies to a plain Postgres
-- used for staging tests, where Supabase's roles do not exist.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v TEXT; r TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'admin_user_activity',
    'player_season_batting',
    'admin_daily_active_users',
    'admin_feature_usage'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v
    ) THEN CONTINUE; END IF;

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);

    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', v, r);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT ON public.%I TO service_role', v);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verification — run this after applying. Every row must read false/false/true.
-- ---------------------------------------------------------------------------
-- SELECT c.relname AS view_name,
--        has_table_privilege('anon',          c.oid, 'SELECT') AS anon_select,
--        has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--        has_table_privilege('service_role',  c.oid, 'SELECT') AS service_select,
--        c.reloptions
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('admin_user_activity','player_season_batting',
--                     'admin_daily_active_users','admin_feature_usage')
-- ORDER BY c.relname;
--
-- Expect: anon_select = false, auth_select = false, service_select = true,
-- and reloptions containing security_invoker=on.
--
-- Then confirm from outside, with the public anon key — each must return 0 rows
-- or 401, where it previously returned 10, 58, 17 and 9:
--
--   curl -s -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
--     "https://<ref>.supabase.co/rest/v1/admin_user_activity?select=*&limit=1"
--
-- AND confirm the admin dashboard and stats pages still work, since they read
-- these same views with the service role.
