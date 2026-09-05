-- 051_provision_league_atomically.sql
--
-- Provision a league, its first licence and its first administrator as ONE
-- operation.
--
-- WHY THIS EXISTS
--
-- /api/admin/leagues currently writes three rows in sequence:
--
--     INSERT leagues          -- error checked
--     INSERT league_members   -- error NOT checked
--     INSERT league_licenses  -- error NOT checked
--
-- The first is guarded. The second and third are not, and neither is rolled
-- back if it fails. So a transient failure on the membership insert leaves a
-- league nobody can administer, and a failure on the licence insert leaves a
-- league whose commissioner logs in to a dashboard that works but whose
-- coaches cannot accept a single invitation. Both are silent: the endpoint
-- still returns 200.
--
-- That is precisely the failure the provisioning endpoint was written to
-- prevent, reintroduced one layer down. A league, the licence that makes its
-- coaches entitled, and the human who can administer it are not three
-- independent facts — a league missing any one of them is not a partially
-- provisioned league, it is a broken one.
--
-- A function body in Postgres is a single transaction. Every INSERT below
-- commits together or none of them do.
--
-- SECURITY DEFINER, and callable only by service_role, matching the bc_*
-- family in migration 050. The route already sits behind requireAdmin(); this
-- grant makes the database refuse anyone who has not been through it.
--
-- Returns a row rather than raising for expected refusals — a duplicate slug
-- and a missing owner are answers, not faults, and the route maps them onto a
-- 409 and a 404. Unexpected failures still raise and roll back.

CREATE OR REPLACE FUNCTION bc_provision_league(
  p_name            TEXT,
  p_slug            TEXT,
  p_city            TEXT DEFAULT NULL,
  p_state           TEXT DEFAULT NULL,
  p_governing_body  TEXT DEFAULT NULL,
  p_website         TEXT DEFAULT NULL,
  p_logo_url        TEXT DEFAULT NULL,
  p_status          TEXT DEFAULT 'pilot',
  p_owner_user_id   UUID DEFAULT NULL,
  p_license_status  TEXT DEFAULT 'trial',
  p_license_plan    TEXT DEFAULT NULL,
  p_coach_limit     INT  DEFAULT NULL,
  p_starts_at       TIMESTAMPTZ DEFAULT NULL,
  p_ends_at         TIMESTAMPTZ DEFAULT NULL,
  p_contract_ref    TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok             BOOLEAN,
  reason         TEXT,
  league_id      UUID,
  league_slug    TEXT,
  license_id     UUID,
  owner_user_id  UUID
)
AS $$
DECLARE
  v_league_id  UUID;
  v_license_id UUID;
  v_slug       TEXT;
BEGIN
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RETURN QUERY SELECT FALSE, 'name_required'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  v_slug := COALESCE(NULLIF(TRIM(p_slug), ''), LOWER(TRIM(p_name)));
  v_slug := REGEXP_REPLACE(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := TRIM(BOTH '-' FROM v_slug);
  v_slug := LEFT(v_slug, 60);

  IF v_slug = '' THEN
    RETURN QUERY SELECT FALSE, 'slug_invalid'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  -- Checked before writing anything so a duplicate is a clean refusal rather
  -- than a caught constraint violation mid-transaction.
  IF EXISTS (SELECT 1 FROM leagues WHERE slug = v_slug) THEN
    RETURN QUERY SELECT FALSE, 'slug_taken'::TEXT, NULL::UUID, v_slug, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  -- An owner is not optional in practice. A league with no administrator
  -- cannot create a season, a team or an invitation, so it can do nothing at
  -- all — and the endpoint would have returned 200 saying it worked.
  IF p_owner_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'owner_required'::TEXT, NULL::UUID, v_slug, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RETURN QUERY SELECT FALSE, 'owner_not_found'::TEXT, NULL::UUID, v_slug, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO leagues (name, slug, city, state, governing_body, website, logo_url, status)
  VALUES (
    TRIM(p_name), v_slug,
    NULLIF(TRIM(COALESCE(p_city, '')), ''),
    NULLIF(TRIM(COALESCE(p_state, '')), ''),
    NULLIF(TRIM(COALESCE(p_governing_body, '')), ''),
    NULLIF(TRIM(COALESCE(p_website, '')), ''),
    NULLIF(TRIM(COALESCE(p_logo_url, '')), ''),
    CASE WHEN p_status IN ('active', 'inactive', 'pilot') THEN p_status ELSE 'pilot' END
  )
  RETURNING id INTO v_league_id;

  INSERT INTO league_members (league_id, user_id, role)
  VALUES (v_league_id, p_owner_user_id, 'owner');

  INSERT INTO league_licenses (
    league_id, status, plan, coach_limit, starts_at, ends_at, contract_reference
  )
  VALUES (
    v_league_id,
    CASE WHEN p_license_status IN ('trial', 'active', 'expired', 'suspended', 'canceled')
         THEN p_license_status ELSE 'trial' END,
    NULLIF(TRIM(COALESCE(p_license_plan, '')), ''),
    p_coach_limit,
    COALESCE(p_starts_at, NOW()),
    p_ends_at,
    NULLIF(TRIM(COALESCE(p_contract_ref, '')), '')
  )
  RETURNING id INTO v_license_id;

  RETURN QUERY SELECT TRUE, 'provisioned'::TEXT, v_league_id, v_slug, v_license_id, p_owner_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Roles are revoked and granted by name only where the name exists. Supabase
-- has anon/authenticated/service_role; a bare Postgres used for verifying this
-- migration does not, and a REVOKE naming a missing role aborts the whole
-- file — which would mean the function could not be tested outside Supabase.
DO $$
DECLARE
  sig TEXT := 'bc_provision_league(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, '
           || 'TEXT, UUID, TEXT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT)';
  r   TEXT;
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', sig, r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END IF;
END $$;

COMMENT ON FUNCTION bc_provision_league(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) IS
  'Creates a league, its first administrator and its first licence in one '
  'transaction. Returns ok=false with a reason for expected refusals '
  '(slug_taken, owner_not_found, owner_required). Service role only.';

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Expect one row, ok=false, reason='owner_required' — and NO league created,
-- which is the whole point.
--
-- SELECT * FROM bc_provision_league('Verification Only', 'verification-only');
-- SELECT count(*) FROM leagues WHERE slug = 'verification-only';  -- expect 0
