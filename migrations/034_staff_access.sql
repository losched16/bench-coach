-- ============================================================================
-- Migration 034: Staff can actually use the app
-- ============================================================================
-- Roles have existed since invites shipped — viewer, contributor, admin — and
-- they governed nothing but the Staff page itself. Underneath, every RLS policy
-- was owner-shaped:
--
--     USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()))
--
-- No policy anywhere mentioned team_members. So an invited assistant logged in
-- and found an empty team picker: the dashboard reads their teams through the
-- browser client, RLS refused every row, and nothing was wrong with their
-- invitation at all.
--
-- 033 closed the API routes. This opens the database to the right people.
--
-- ADDITIVE, NEVER DESTRUCTIVE
--
-- Postgres OR's permissive policies together, so these are ADDED alongside the
-- existing owner policies rather than replacing them. Nothing here can take
-- away access an owner already has — if every policy below were dropped
-- tomorrow, owners would be exactly where they started. That matters when the
-- alternative is rewriting forty policies against a schema this file can only
-- partly see.
--
-- WHICH TABLES CAME FROM WHERE
--
-- Some tables (games, game_notes, game_pitch_counts, position_eligibility,
-- team_members …) were created directly in Supabase rather than by a file in
-- this repo, so their DDL is not readable here. Every statement below therefore
-- CHECKS that the table and column exist before acting, and skips quietly if
-- they don't. Re-running after adding a table picks it up.
--
-- THE PERMISSION MODEL: RECORD, DON'T DECIDE
--
-- Read: any member, including a viewer.
-- Record (contributor+): what HAPPENED — the book, pitch counts, notes, log
--   entries, scouting captures, tonight's eligibility. Facts.
-- Decide (admin+): what happens NEXT — roster, pre-game lineups, priorities,
--   team settings, what the app remembers.
--
-- Same model as lib/authz.ts, deliberately. The API routes and the database
-- must not disagree about who may do what, because the app writes through both:
-- pages read and sometimes write with the browser client (RLS), while the
-- routes use the service role (authz.ts). One model, two enforcement points.
--
-- Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who am I on this team?
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so these can read team_members and coaches without being
-- caught by those tables' own RLS — a policy that needs a policy to evaluate
-- itself is how you get infinite recursion. STABLE so Postgres may cache the
-- result within a statement instead of re-running it per row.

CREATE OR REPLACE FUNCTION bc_rank(p_role TEXT)
RETURNS INT AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'contributor' THEN 1
    WHEN 'viewer' THEN 0
    ELSE -1
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION bc_team_role(p_team UUID)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_team IS NULL OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  -- The owner, by way of their coach row.
  SELECT 'owner' INTO v_role
  FROM teams t
  JOIN coaches c ON c.id = t.coach_id
  WHERE t.id = p_team AND c.user_id = auth.uid();
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  SELECT tm.role INTO v_role
  FROM team_members tm
  WHERE tm.team_id = p_team AND tm.user_id = auth.uid()
  LIMIT 1;

  RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_team_at_least(p_team UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT bc_rank(bc_team_role(p_team)) >= bc_rank(p_min);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_game_at_least(p_game UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM games g
    WHERE g.id = p_game AND bc_team_at_least(g.team_id, p_min)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_team_player_at_least(p_team_player UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_players tp
    WHERE tp.id = p_team_player AND bc_team_at_least(tp.team_id, p_min)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_thread_at_least(p_thread UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_threads t
    WHERE t.id = p_thread AND bc_team_at_least(t.team_id, p_min)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Coach-scoped data — players, scouting, priorities. A member of ANY of that
-- coach's teams qualifies, taking their strongest role. Scouting is shared
-- across a coach's teams, so membership of one is the grant.
CREATE OR REPLACE FUNCTION bc_coach_at_least(p_coach UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (SELECT 1 FROM coaches c WHERE c.id = p_coach AND c.user_id = auth.uid())
    OR EXISTS (
      SELECT 1
      FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.coach_id = p_coach
        AND tm.user_id = auth.uid()
        AND bc_rank(tm.role) >= bc_rank(p_min)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_opponent_team_at_least(p_opp UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM opponent_teams ot
    WHERE ot.id = p_opp AND bc_coach_at_least(ot.coach_id, p_min)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 2. A member can see their own membership, and the team it points at
-- ----------------------------------------------------------------------------
-- This pair is what fixes the empty team picker. The dashboard asks
-- team_members for its own rows, then asks teams for those ids; both were
-- refused.
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_read_own_membership') THEN
    CREATE POLICY "bc_read_own_membership" ON team_members FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  -- The owner and admins see the whole staff list for their team.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_read_team_membership') THEN
    CREATE POLICY "bc_read_team_membership" ON team_members FOR SELECT
      USING (bc_team_at_least(team_id, 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_read_member_team') THEN
    CREATE POLICY "bc_read_member_team" ON teams FOR SELECT
      USING (bc_team_at_least(id, 'viewer'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Everything else, driven by a table
-- ----------------------------------------------------------------------------
-- One row per table: how it links to a team, and what a WRITE to it requires.
-- Reads always require 'viewer'. Keeping this as data rather than 160 hand
-- written policies is what makes it reviewable — the interesting content is the
-- third column, and it should be readable at a glance.
DO $$
DECLARE
  r RECORD;
  v_expr TEXT;
  v_read TEXT;
  v_write TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table                        link column          link kind        write needs
      -- ── Who is on the team: decisions ────────────────────────────────
      ('team_players',                'team_id',           'team',          'decide'),
      ('players',                     'coach_id',          'coach',         'decide'),
      ('player_traits',               'player_id',         'skip',          'decide'),
      ('position_eligibility',        'team_player_id',    'team_player',   'decide'),
      ('seasons',                     'coach_id',          'coach',         'decide'),
      -- ── What we plan: decisions ──────────────────────────────────────
      ('game_lineups',                'team_id',           'team',          'decide'),
      ('prescriptions',               'team_id',           'team',          'decide'),
      ('checkins',                    'coach_id',          'coach',         'decide'),
      ('practice_plans',              'team_id',           'team',          'decide'),
      ('practice_sessions',           'team_id',           'team',          'decide'),
      ('metric_types',                'coach_id',          'coach',         'decide'),
      ('pitch_count_rules',           'coach_id',          'coach',         'decide'),
      -- What the app remembers is a decision too: an assistant's phrasing
      -- must not quietly become the head coach's stated preference.
      ('coach_preferences',           'coach_id',          'coach',         'decide'),
      ('team_memory_summaries',       'team_id',           'team',          'decide'),
      -- ── What happened: records ───────────────────────────────────────
      ('games',                       'team_id',           'team',          'record'),
      ('game_notes',                  'game_id',           'game',          'record'),
      ('game_pitch_counts',           'game_id',           'game',          'record'),
      ('game_events',                 'game_id',           'game',          'record'),
      ('game_participation',          'game_id',           'game',          'record'),
      ('game_position_log',           'game_id',           'game',          'record'),
      ('game_opponent_lineup',        'game_id',           'game',          'record'),
      -- Tonight only. The team default sits under position_eligibility above,
      -- and needs 'decide' — that split is the whole model in one pair.
      ('game_position_eligibility',   'game_id',           'game',          'record'),
      ('pitch_count_sessions',        'team_id',           'team',          'record'),
      ('entries',                     'team_id',           'team',          'record'),
      ('observations',                 'team_id',          'team',          'record'),
      ('player_metrics',              'coach_id',          'coach',         'record'),
      ('team_notes',                  'team_id',           'team',          'record'),
      ('player_notes',                'team_id',           'team',          'record'),
      ('roster_name_mappings',        'team_id',           'team',          'record'),
      -- ── Conversations ────────────────────────────────────────────────
      ('chat_threads',                'team_id',           'team',          'record'),
      ('chat_messages',               'thread_id',         'thread',        'record'),
      -- ── Scouting: the most delegable job there is ────────────────────
      ('opponent_teams',              'coach_id',          'coach',         'record'),
      ('opponent_players',            'opponent_team_id',  'opponent_team', 'record'),
      ('scouting_entries',            'coach_id',          'coach',         'record'),
      ('opponent_analyses',           'coach_id',          'coach',         'record'),
      ('matchups',                    'team_id',           'team',          'record')
    ) AS x(tbl, col, kind, write_needs)
  LOOP
    -- Only touch what is actually there. Several of these tables were created
    -- outside this repo, and one of them may not exist in a given database.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = r.tbl
    );
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    );
    -- Linked by something this migration has no helper for. Reached through
    -- guarded API routes instead; skipped rather than half-guarded.
    CONTINUE WHEN r.kind = 'skip';

    v_expr := CASE r.kind
      WHEN 'team'          THEN format('bc_team_at_least(%I, %%L)', r.col)
      WHEN 'game'          THEN format('bc_game_at_least(%I, %%L)', r.col)
      WHEN 'coach'         THEN format('bc_coach_at_least(%I, %%L)', r.col)
      WHEN 'team_player'   THEN format('bc_team_player_at_least(%I, %%L)', r.col)
      WHEN 'thread'        THEN format('bc_thread_at_least(%I, %%L)', r.col)
      WHEN 'opponent_team' THEN format('bc_opponent_team_at_least(%I, %%L)', r.col)
    END;

    v_read  := format(v_expr, 'viewer');
    v_write := format(v_expr, r.write_needs);

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);

    -- Named bc_* so they are identifiable as this migration's work, and so
    -- re-running replaces them rather than stacking duplicates.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'bc_read_' || r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'bc_ins_'  || r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'bc_upd_'  || r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'bc_del_'  || r.tbl, r.tbl);

    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (%s)',
                   'bc_read_' || r.tbl, r.tbl, v_read);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (%s)',
                   'bc_ins_' || r.tbl, r.tbl, v_write);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (%s)',
                   'bc_upd_' || r.tbl, r.tbl, v_write);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (%s)',
                   'bc_del_' || r.tbl, r.tbl, v_write);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- What this migration created, and what each policy requires
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE policyname LIKE 'bc_%'
--   ORDER BY tablename, cmd;
--
--   -- Sanity check as yourself: should say 'owner' for a team you own
--   SELECT id, name, bc_team_role(id) AS my_role FROM teams;
--
--   -- Anything still owner-only that a member might need. Tables with a
--   -- bc_read_ policy are covered; anything listed here is reached only
--   -- through the guarded API routes.
--   SELECT t.table_name
--   FROM information_schema.tables t
--   WHERE t.table_schema = 'public'
--     AND NOT EXISTS (
--       SELECT 1 FROM pg_policies p
--       WHERE p.tablename = t.table_name AND p.policyname LIKE 'bc_read_%'
--     )
--   ORDER BY 1;
