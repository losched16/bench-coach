-- Synthetic data for the ISOLATED preview project. Not for production.
--
-- Paste into the preview project's SQL editor AFTER the migrations, and AFTER
-- creating five test accounts in that project's Authentication > Users, using
-- these made-up addresses (any strong password; do not reuse a real one):
--
--     owner.syn@example.test      head coach (owner)
--     admin.syn@example.test      team admin
--     contrib.syn@example.test    contributor
--     viewer.syn@example.test     viewer
--     outsider.syn@example.test   on no team (isolation checks)
--
-- Everything created here is named ZZ-SYN so it is obvious on sight. No real
-- name, email, photo or birthdate appears anywhere.
--
-- SAFETY GUARD: this refuses to run unless the project is empty of players and
-- teams, so it cannot be pasted into a project that holds real data by mistake.

DO $$
DECLARE
  v_owner uuid; v_admin uuid; v_contrib uuid; v_viewer uuid; v_out uuid;
  v_coach uuid; v_coach_out uuid; v_season uuid; v_season_out uuid; v_team uuid; v_team_out uuid;
BEGIN
  IF (SELECT count(*) FROM public.players) > 0 OR (SELECT count(*) FROM public.teams) > 0 THEN
    RAISE EXCEPTION 'REFUSED: this project already has players or teams. The synthetic seed only runs on an empty preview project.';
  END IF;

  SELECT id INTO v_owner   FROM auth.users WHERE email = 'owner.syn@example.test';
  SELECT id INTO v_admin   FROM auth.users WHERE email = 'admin.syn@example.test';
  SELECT id INTO v_contrib FROM auth.users WHERE email = 'contrib.syn@example.test';
  SELECT id INTO v_viewer  FROM auth.users WHERE email = 'viewer.syn@example.test';
  SELECT id INTO v_out     FROM auth.users WHERE email = 'outsider.syn@example.test';
  IF v_owner IS NULL OR v_admin IS NULL OR v_contrib IS NULL OR v_viewer IS NULL OR v_out IS NULL THEN
    RAISE EXCEPTION 'Create the five *.syn@example.test users in Authentication first.';
  END IF;

  INSERT INTO public.coaches (user_id) VALUES (v_owner)  RETURNING id INTO v_coach;
  INSERT INTO public.coaches (user_id) VALUES (v_out)    RETURNING id INTO v_coach_out;
  INSERT INTO public.seasons (coach_id, name) VALUES (v_coach, 'ZZ-SYN Season')      RETURNING id INTO v_season;
  INSERT INTO public.seasons (coach_id, name) VALUES (v_coach_out, 'ZZ-SYN Other')   RETURNING id INTO v_season_out;
  INSERT INTO public.teams (season_id, coach_id, name) VALUES (v_season, v_coach, 'ZZ-SYN Team One')       RETURNING id INTO v_team;
  INSERT INTO public.teams (season_id, coach_id, name) VALUES (v_season_out, v_coach_out, 'ZZ-SYN Team Two') RETURNING id INTO v_team_out;

  INSERT INTO public.team_members (team_id, user_id, role) VALUES
    (v_team, v_admin, 'admin'), (v_team, v_contrib, 'contributor'), (v_team, v_viewer, 'viewer');

  -- Three made-up players on team one, one on the other team.
  WITH p AS (
    INSERT INTO public.players (coach_id, name) VALUES
      (v_coach, 'ZZ-SYN Player A'), (v_coach, 'ZZ-SYN Player B'), (v_coach, 'ZZ-SYN Player C')
    RETURNING id
  )
  INSERT INTO public.team_players (team_id, player_id) SELECT v_team, id FROM p;
  WITH p AS (INSERT INTO public.players (coach_id, name) VALUES (v_coach_out, 'ZZ-SYN Player D') RETURNING id)
  INSERT INTO public.team_players (team_id, player_id) SELECT v_team_out, id FROM p;
END $$;

SELECT 'synthetic seed complete' AS status,
       (SELECT count(*) FROM public.players WHERE name LIKE 'ZZ-SYN%') AS synthetic_players,
       (SELECT count(*) FROM public.players WHERE name NOT LIKE 'ZZ-SYN%') AS other_players_should_be_zero;
