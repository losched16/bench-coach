-- ============================================================================
-- 050_VERIFY.sql — prove migration 050 actually works, on a real database
-- ============================================================================
-- Everything about the league layer has so far been verified statically: pure
-- unit tests, build-time checkers, a typecheck and a production build. None of
-- it has ever run against Postgres. This file is what closes that gap.
--
-- Run it AFTER applying 050_league_layer.sql, on STAGING.
--
-- SAFE TO RUN ON A DATABASE WITH REAL DATA, because the whole thing is wrapped
-- in a transaction that ends in ROLLBACK. Nothing it creates survives. It reads
-- your real rows only to count them and prove they were not disturbed.
--
-- It is deliberately NOT idempotent-by-cleanup — it does not DELETE anything,
-- ever. The rollback is the cleanup. If you find yourself tempted to change the
-- final ROLLBACK to COMMIT, do not: there is no reason to keep any of this.
--
-- Read the NOTICEs. Every check prints PASS or FAIL with what it expected.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_pass   INT := 0;
  v_fail   INT := 0;
  v_msg    TEXT;

  v_league       UUID;
  v_season       UUID;
  v_division     UUID;
  v_inv_a        UUID;
  v_inv_b        UUID;
  v_claim        RECORD;
  v_user         UUID;
  v_user2        UUID;
  v_admin_coach  UUID;
  v_new_coach    UUID;
  v_coach_season UUID;
  v_team         UUID;
  v_teams_before INT;
  v_teams_after  INT;
  v_unaffiliated INT;
  v_rows         INT;

  PROCEDURE_NOTE TEXT := '';
BEGIN
  -- Tiny assertion helper, inline because a function would outlive the rollback
  -- in some setups and this file promises to leave nothing behind.
  CREATE TEMP TABLE IF NOT EXISTS _v(ok BOOLEAN, name TEXT) ON COMMIT DROP;

  -- ==========================================================================
  -- 1. STRUCTURE
  -- ==========================================================================
  INSERT INTO _v
  SELECT count(*) = 6, 'all six league tables exist'
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('leagues','league_members','league_seasons',
                       'league_divisions','league_licenses','league_invitations');

  INSERT INTO _v
  SELECT count(*) = 6, 'RLS is enabled on all six'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relrowsecurity
    AND c.relname IN ('leagues','league_members','league_seasons',
                      'league_divisions','league_licenses','league_invitations');

  INSERT INTO _v
  SELECT count(*) = 4, 'teams gained its four nullable league columns'
  FROM information_schema.columns
  WHERE table_name = 'teams'
    AND column_name IN ('league_id','league_season_id','league_division_id',
                        'league_placeholder_owner_id')
    AND is_nullable = 'YES';

  -- The privacy boundary, as the database sees it. No league policy may sit on
  -- a team-scoped or content table.
  INSERT INTO _v
  SELECT count(*) = 0, 'no league policy touches a team or content table'
  FROM pg_policies
  WHERE policyname LIKE 'bc_league%'
    AND tablename NOT LIKE 'league%';

  INSERT INTO _v
  SELECT count(*) = 0, 'league_invitations has NO policy (tokens are bearer credentials)'
  FROM pg_policies WHERE tablename = 'league_invitations';

  INSERT INTO _v
  SELECT bool_and(cmd = 'SELECT'), 'every league policy is SELECT-only'
  FROM pg_policies WHERE policyname LIKE 'bc_league%';

  INSERT INTO _v
  SELECT count(*) = 2, 'both seat functions exist'
  FROM pg_proc WHERE proname IN ('bc_claim_league_seat','bc_release_league_seat');

  -- SECURITY DEFINER functions callable by the browser client would be a hole
  -- straight through RLS.
  INSERT INTO _v
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname IN ('bc_claim_league_seat','bc_release_league_seat')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ), 'seat functions are NOT executable by authenticated';

  -- ==========================================================================
  -- 2. EXISTING DATA IS UNDISTURBED
  -- ==========================================================================
  SELECT count(*) INTO v_teams_before FROM teams;
  SELECT count(*) INTO v_unaffiliated FROM teams WHERE league_id IS NULL;

  INSERT INTO _v VALUES (v_teams_before = v_unaffiliated,
    'every pre-existing team is still unaffiliated (no backfill happened)');

  INSERT INTO _v
  SELECT count(*) = 0, 'no league was seeded' FROM leagues;
  INSERT INTO _v
  SELECT count(*) = 0, 'no licence was seeded' FROM league_licenses;

  -- ==========================================================================
  -- 3. SEAT CLAIMING — the race that mattered most
  -- ==========================================================================
  INSERT INTO leagues (name, slug, status)
  VALUES ('VERIFY Temp League', 'verify-temp-' || gen_random_uuid(), 'pilot')
  RETURNING id INTO v_league;

  INSERT INTO league_seasons (league_id, name, status)
  VALUES (v_league, 'VERIFY Season', 'active') RETURNING id INTO v_season;

  INSERT INTO league_divisions (league_id, league_season_id, name)
  VALUES (v_league, v_season, 'VERIFY 10U') RETURNING id INTO v_division;

  -- A licence with exactly ONE seat, so the second claim must be refused.
  INSERT INTO league_licenses (league_id, status, coach_limit, starts_at, ends_at)
  VALUES (v_league, 'active', 1, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days');

  INSERT INTO league_invitations (league_id, email, invite_token, status, expires_at)
  VALUES (v_league, 'a@verify.test', 'verify-tok-a-' || gen_random_uuid(),
          'pending', NOW() + INTERVAL '30 days')
  RETURNING id INTO v_inv_a;

  INSERT INTO league_invitations (league_id, email, invite_token, status, expires_at)
  VALUES (v_league, 'b@verify.test', 'verify-tok-b-' || gen_random_uuid(),
          'pending', NOW() + INTERVAL '30 days')
  RETURNING id INTO v_inv_b;

  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_a, v_league);
  INSERT INTO _v VALUES (v_claim.claimed, 'first coach claims the only seat');
  INSERT INTO _v VALUES (v_claim.seats_used = 1, 'seats_used reports 1 after the first claim');

  -- The seat limit, enforced. This is the check that used to be a read-then-
  -- write in application code and let two coaches take the same last seat.
  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_b, v_league);
  INSERT INTO _v VALUES (NOT v_claim.claimed, 'second coach is refused — no seats left');
  INSERT INTO _v VALUES (v_claim.reason = 'coach_limit_reached',
    'refusal reason is coach_limit_reached');

  -- Replay: the same invitation claimed twice.
  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_a, v_league);
  INSERT INTO _v VALUES (NOT v_claim.claimed, 'an accepted invitation cannot be claimed again');
  INSERT INTO _v VALUES (v_claim.reason = 'invitation_accepted',
    'replay reason is invitation_accepted');

  -- Release hands the seat back, which is what the route does when the work
  -- after claiming fails.
  INSERT INTO _v VALUES (bc_release_league_seat(v_inv_a), 'releasing a claimed seat succeeds');
  INSERT INTO _v
  SELECT status = 'pending', 'released invitation is pending again'
  FROM league_invitations WHERE id = v_inv_a;

  INSERT INTO _v VALUES (NOT bc_release_league_seat(v_inv_a),
    'releasing an already-pending invitation is a no-op, not an error');

  -- Now the freed seat can be taken by the other coach.
  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_b, v_league);
  INSERT INTO _v VALUES (v_claim.claimed, 'the freed seat can be claimed by someone else');

  -- A revoked invitation must never be claimable, and release must not revive it.
  UPDATE league_invitations SET status = 'revoked' WHERE id = v_inv_a;
  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_a, v_league);
  INSERT INTO _v VALUES (NOT v_claim.claimed, 'a revoked invitation cannot be claimed');
  INSERT INTO _v VALUES (v_claim.reason = 'invitation_revoked', 'reason is invitation_revoked');
  INSERT INTO _v VALUES (NOT bc_release_league_seat(v_inv_a),
    'release cannot resurrect a revoked invitation');

  -- An unlicensed league grants nothing, whatever its invitations say.
  UPDATE league_licenses SET status = 'expired' WHERE league_id = v_league;
  UPDATE league_invitations SET status = 'pending' WHERE id = v_inv_a;
  SELECT * INTO v_claim FROM bc_claim_league_seat(v_inv_a, v_league);
  INSERT INTO _v VALUES (NOT v_claim.claimed, 'an expired licence claims nothing');
  INSERT INTO _v VALUES (v_claim.reason = 'league_unlicensed', 'reason is league_unlicensed');
  UPDATE league_licenses SET status = 'active' WHERE league_id = v_league;

  -- ==========================================================================
  -- 4. THE PARTIAL UNIQUE INDEX — one pending invitation per email per league
  -- ==========================================================================
  BEGIN
    INSERT INTO league_invitations (league_id, email, invite_token, status, expires_at)
    VALUES (v_league, 'a@verify.test', 'verify-dup-' || gen_random_uuid(),
            'pending', NOW() + INTERVAL '30 days');
    INSERT INTO _v VALUES (FALSE, 'duplicate pending invitation was REJECTED');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _v VALUES (TRUE, 'duplicate pending invitation was REJECTED');
  END;

  -- The index is partial: the same address may be invited again once the
  -- earlier invitation is no longer pending.
  UPDATE league_invitations SET status = 'revoked' WHERE id = v_inv_a;
  BEGIN
    INSERT INTO league_invitations (league_id, email, invite_token, status, expires_at)
    VALUES (v_league, 'a@verify.test', 'verify-reinv-' || gen_random_uuid(),
            'pending', NOW() + INTERVAL '30 days');
    INSERT INTO _v VALUES (TRUE, 're-inviting after revoke is allowed');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _v VALUES (FALSE, 're-inviting after revoke is allowed');
  END;

  -- ==========================================================================
  -- 5. OWNERSHIP TRANSFER — needs a real auth user, so it is conditional
  -- ==========================================================================
  -- Two DISTINCT users are needed: coaches.user_id is UNIQUE, so the
  -- placeholder admin and the arriving head coach cannot share one. Existing
  -- users are borrowed read-only — this never creates an auth user, because
  -- inserting into auth.users behind Supabase's own signup flow is not
  -- something a verification script should do to anybody's database.
  SELECT id INTO v_user  FROM auth.users ORDER BY id LIMIT 1;
  SELECT id INTO v_user2 FROM auth.users WHERE id <> v_user ORDER BY id LIMIT 1;

  IF v_user IS NULL OR v_user2 IS NULL THEN
    PROCEDURE_NOTE := 'SKIPPED ownership-transfer checks: needs two rows in auth.users, found '
      || (SELECT count(*) FROM auth.users) || '.';
  ELSE
    -- Reuse the existing coach row when this user already has one, because
    -- coaches.user_id is UNIQUE and a real account on staging will.
    SELECT id INTO v_admin_coach FROM coaches WHERE user_id = v_user;
    IF v_admin_coach IS NULL THEN
      INSERT INTO coaches (user_id, display_name)
      VALUES (v_user, 'VERIFY placeholder admin') RETURNING id INTO v_admin_coach;
    END IF;

    INSERT INTO seasons (coach_id, name) VALUES (v_admin_coach, 'VERIFY League')
    RETURNING id INTO v_coach_season;

    -- A league-provisioned placeholder team, exactly as the admin route creates it.
    INSERT INTO teams (season_id, coach_id, name, league_id, league_season_id,
                       league_division_id, league_placeholder_owner_id)
    VALUES (v_coach_season, v_admin_coach, 'VERIFY 10U Phillies', v_league, v_season,
            v_division, v_admin_coach)
    RETURNING id INTO v_team;

    INSERT INTO _v
    SELECT league_placeholder_owner_id = coach_id,
           'a provisioned team starts as a claimable placeholder'
    FROM teams WHERE id = v_team;

    -- The claim, as the accept route performs it: compare-and-set on BOTH the
    -- current owner and the placeholder marker.
    SELECT id INTO v_new_coach FROM coaches WHERE user_id = v_user2;
    IF v_new_coach IS NULL THEN
      INSERT INTO coaches (user_id, display_name)
      VALUES (v_user2, 'VERIFY head coach') RETURNING id INTO v_new_coach;
    END IF;

    UPDATE teams
    SET coach_id = v_new_coach, league_placeholder_owner_id = NULL
    WHERE id = v_team
      AND coach_id = v_admin_coach
      AND league_placeholder_owner_id = v_admin_coach;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO _v VALUES (v_rows = 1, 'head coach claims the placeholder team');

    -- The second claimant loses. This is the concurrent-accept case: the same
    -- compare-and-set now matches nothing, which is how the route knows to add
    -- the coach as staff instead of reporting a phantom success.
    UPDATE teams
    SET coach_id = v_admin_coach
    WHERE id = v_team
      AND coach_id = v_admin_coach
      AND league_placeholder_owner_id = v_admin_coach;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO _v VALUES (v_rows = 0, 'a second claim on the same team matches no rows');

    INSERT INTO _v
    SELECT league_placeholder_owner_id IS NULL AND coach_id = v_new_coach,
           'the claimed team is owned by the head coach and no longer claimable'
    FROM teams WHERE id = v_team;

    -- Deleting a league must ORPHAN its teams, never cascade into destroying a
    -- coach's roster and season of notes.
    DELETE FROM leagues WHERE id = v_league;
    SELECT count(*) INTO v_rows FROM teams WHERE id = v_team;
    INSERT INTO _v VALUES (v_rows = 1, 'deleting a league does NOT delete its teams');
    INSERT INTO _v
    SELECT league_id IS NULL, 'deleting a league nulls the team''s league_id'
    FROM teams WHERE id = v_team;
  END IF;

  -- ==========================================================================
  -- 6. NOTHING PRE-EXISTING MOVED
  -- ==========================================================================
  SELECT count(*) INTO v_teams_after FROM teams;
  INSERT INTO _v VALUES (
    v_teams_after >= v_teams_before,
    'no pre-existing team was deleted by any of the above');

  -- ==========================================================================
  -- REPORT
  -- ==========================================================================
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)
    INTO v_pass, v_fail FROM _v;

  RAISE NOTICE '';
  RAISE NOTICE '=== migration 050 verification ===';
  FOR v_msg IN SELECT CASE WHEN ok THEN '  PASS  ' ELSE '  FAIL  ' END || name FROM _v LOOP
    RAISE NOTICE '%', v_msg;
  END LOOP;
  IF PROCEDURE_NOTE <> '' THEN RAISE NOTICE '  NOTE  %', PROCEDURE_NOTE; END IF;
  RAISE NOTICE '';
  RAISE NOTICE '%  passed, %  failed', v_pass, v_fail;
  RAISE NOTICE '';

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'migration 050 verification FAILED (% checks). Nothing was committed.', v_fail;
  END IF;
END $$;

-- Everything above is thrown away. This is not a cleanup step that can be
-- forgotten — it is the only way this file ends.
ROLLBACK;
