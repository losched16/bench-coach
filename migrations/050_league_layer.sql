-- ============================================================================
-- Migration 050: the league layer
-- ============================================================================
-- BenchCoach is bought by one coach at a time. This is the first migration that
-- lets an organisation buy it for everybody — a youth league pays once, and its
-- coaches get the product they would otherwise have bought themselves.
--
-- The hierarchy it adds, above everything that already exists:
--
--     League → League Season → Division → Team → Coaches
--
-- Teams are the join. `teams` gains three NULLABLE league columns and nothing
-- else changes about it: every existing team keeps NULL in all three and is
-- exactly as valid as it was yesterday. There is deliberately no second
-- league-flavoured teams table, because two tables meaning "team" is how the
-- practice planner ends up reading one and the lineup builder the other.
--
-- WHAT THIS IS NOT
--
-- Not a league management platform. No schedules, no standings, no
-- registration, no parent messaging, no field assignments. Those are products
-- SportsEngine already sells. This is the coach-enablement layer plus enough
-- administration to onboard a paying league without hand-editing rows.
--
-- ENTITLEMENT, NOT SUBSCRIPTION
--
-- `league_licenses` is an entitlement source that sits ALONGSIDE
-- coaches.is_subscribed, never on top of it. A league paying for a coach must
-- never write is_subscribed = true on that coach's row: the day the league
-- stops paying, that flag would be a lie that outlives the contract, and the
-- coach would keep Coach-plan surfaces nobody is paying for. So the two stay
-- separate and lib/leagueEntitlements.ts answers "may they?" by asking both.
--
-- PRIVACY IS ENFORCED BY WHAT IS ABSENT
--
-- Note what this migration does NOT create: any policy granting a league
-- member read access to teams, player_notes, team_notes, chat_messages,
-- player_traits or scouting_entries. Those tables gate on
-- bc_team_at_least(team_id, …) from migration 034, which reads team_members
-- and team ownership. League membership is a different table and appears in
-- none of those expressions, so a commissioner reading a coach's player notes
-- is not something we have to remember to forbid — there is no path.
--
-- The adoption dashboard therefore reads through server-side service-role
-- queries behind requireLeagueRole() in lib/leagueAuthz.ts, which return counts
-- and timestamps and never free text. Widening RLS to make reporting easier
-- would have been the cheap way and the wrong one.
--
-- ADDITIVE, IDEMPOTENT, NO BACKFILL
--
-- Creates nothing but new tables, new nullable columns and new policies. Seeds
-- no leagues, no licences and no sample data — a production database must not
-- acquire a fake league because a migration ran. Apply in the Supabase SQL
-- editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. leagues
-- ----------------------------------------------------------------------------
-- status is deliberately three plain strings rather than a state machine.
-- 'pilot' exists because the first few leagues will be exactly that, and
-- reporting on "how many pilots converted" should not require reading a
-- contract PDF.
CREATE TABLE IF NOT EXISTS leagues (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  -- The public handle. Used in invite URLs and, later, a branded landing page.
  slug           TEXT UNIQUE NOT NULL,
  logo_url       TEXT,
  website        TEXT,
  city           TEXT,
  state          TEXT,
  -- Little League, USSSA, Cal Ripken, PONY, or nothing. Free text on purpose:
  -- the list is long, regional and changes, and getting it wrong should not
  -- block a signup.
  governing_body TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive', 'pilot')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-table touch function, matching pitch_count_sessions_touch() and friends.
-- There is no shared trigger helper in this schema and inventing one here would
-- be a refactor smuggled into a feature migration.
CREATE OR REPLACE FUNCTION leagues_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leagues_touch ON leagues;
CREATE TRIGGER trg_leagues_touch
  BEFORE UPDATE ON leagues
  FOR EACH ROW EXECUTE FUNCTION leagues_touch();

-- ----------------------------------------------------------------------------
-- 2. league_members — league ADMINISTRATORS, not coaching staff
-- ----------------------------------------------------------------------------
-- The single most important thing about this table: it is not team_members and
-- must never be confused with it. A row here says "this person runs the
-- league". It grants league administration and adoption reporting. It grants
-- nothing whatsoever on any team's data — a commissioner who wants to see a
-- roster has to be invited onto that team like anybody else.
--
-- References auth.users directly rather than coaches, because a commissioner is
-- frequently not a coach and should not need a coach row to administer a
-- league.
CREATE TABLE IF NOT EXISTS league_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- division_admin is RESERVED, not implemented. It ranks lowest and is
  -- currently treated as read-only league-wide, because a half-built scope
  -- check that silently reads as league-wide is worse than an honest one that
  -- says so. Phase 2 gives it a division_id and narrows it.
  role       TEXT NOT NULL
             CHECK (role IN ('owner', 'commissioner', 'admin',
                             'coaching_director', 'division_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One membership per person per league. A second role for the same person is
  -- an update, not another row — otherwise "what may they do" has two answers.
  UNIQUE (league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_user   ON league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);

-- ----------------------------------------------------------------------------
-- 3. league_seasons
-- ----------------------------------------------------------------------------
-- "Spring 2027". Distinct from the existing `seasons` table, which is a single
-- coach's private season and belongs to that coach. A league season is the
-- organisation's calendar; a coach's season is their own workspace. They are
-- related only through teams.
CREATE TABLE IF NOT EXISTS league_seasons (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  starts_at  DATE,
  ends_at    DATE,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_seasons_league ON league_seasons(league_id);
-- The dashboard header asks "which season are we in" on every page load.
CREATE INDEX IF NOT EXISTS idx_league_seasons_active
  ON league_seasons(league_id, status);

-- ----------------------------------------------------------------------------
-- 4. league_divisions
-- ----------------------------------------------------------------------------
-- 8U Minors, 10U Majors. Scoped to a season as well as a league because
-- divisions get renamed and re-drawn between seasons, and last spring's
-- adoption numbers must keep pointing at last spring's divisions.
CREATE TABLE IF NOT EXISTS league_divisions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id        UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  league_season_id UUID NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- Matches the existing teams.age_group vocabulary (6U … 13U+) but is not
  -- constrained to it: a league that runs "Juniors" should be able to say so.
  age_group        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_divisions_league ON league_divisions(league_id);
CREATE INDEX IF NOT EXISTS idx_league_divisions_season ON league_divisions(league_season_id);

-- ----------------------------------------------------------------------------
-- 5. league_licenses — the organisational entitlement
-- ----------------------------------------------------------------------------
-- What makes a coach's access sponsored. lib/leagueEntitlements.ts reads this
-- and nothing else to decide whether a league is currently paying.
--
-- 'trial' grants access exactly like 'active' — a pilot league whose coaches
-- cannot use the product is not a pilot. The three states that do NOT grant are
-- expired, suspended and canceled, and they are separate rather than one
-- 'inactive' because "we suspended them" and "the contract ran out" get
-- different phone calls.
--
-- Billing stays out of here on purpose. stripe_customer_id and
-- contract_reference are recorded so an invoice can be traced to a licence, but
-- Phase 1 does not build a league billing portal: leagues at this size are sold
-- by a human and paid by invoice, and building a self-serve org billing flow
-- before the first league signs is building for an imagined customer.
CREATE TABLE IF NOT EXISTS league_licenses (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id          UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  -- NULL means the licence covers the league rather than one named season,
  -- which is how an annual contract spanning Spring and Fall is expressed.
  league_season_id   UUID REFERENCES league_seasons(id) ON DELETE SET NULL,
  status             TEXT NOT NULL
                     CHECK (status IN ('trial', 'active', 'expired',
                                       'suspended', 'canceled')),
  plan               TEXT,
  -- NULL means unlimited, matching the NULL-is-unlimited convention in
  -- lib/tiers.ts so the two limit systems read the same way.
  coach_limit        INTEGER CHECK (coach_limit IS NULL OR coach_limit >= 0),
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  stripe_customer_id TEXT,
  contract_reference TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_licenses_league ON league_licenses(league_id);
-- Entitlement resolution runs on every guarded request for a league coach, and
-- always asks the same question: which licences for this league are live now.
CREATE INDEX IF NOT EXISTS idx_league_licenses_live
  ON league_licenses(league_id, status, ends_at);

-- ----------------------------------------------------------------------------
-- 6. league_invitations
-- ----------------------------------------------------------------------------
-- Shaped after the existing team_invitations table so the two flows stay
-- recognisably the same thing: a token IS the credential, the row records who
-- was asked and whether they came.
--
-- Differences from team_invitations, each deliberate:
--   * `email` is NOT NULL. A team invite is a link a coach texts to someone
--     they know. A league invite is addressed to a roster of coaches the
--     commissioner is reporting on, and "who has not accepted yet" is the
--     single most important number on their dashboard — which needs a name.
--   * No max_uses/use_count. One invitation, one coach. Reuse is exactly what
--     we do not want when the licence has a coach_limit.
CREATE TABLE IF NOT EXISTS league_invitations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id          UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  league_season_id   UUID REFERENCES league_seasons(id) ON DELETE SET NULL,
  league_division_id UUID REFERENCES league_divisions(id) ON DELETE SET NULL,
  -- Nullable so an invitation can precede team assignment, but Phase 1's UI
  -- always sets it: letting a coach pick their own team from a league-wide list
  -- is how the wrong person ends up on the 12U Majors roster.
  team_id            UUID REFERENCES teams(id) ON DELETE SET NULL,
  email              TEXT NOT NULL,
  intended_role      TEXT NOT NULL DEFAULT 'head_coach'
                     CHECK (intended_role IN ('head_coach', 'assistant_coach')),
  invite_token       TEXT UNIQUE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at        TIMESTAMPTZ,
  -- NULL means no expiry. The API sets 30 days, longer than the team invite's 7
  -- because a league sends these in a batch in February for a season starting
  -- in April.
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Token lookup is the hot path: every hit on /league/invite/<token>.
CREATE INDEX IF NOT EXISTS idx_league_invitations_token  ON league_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_league_invitations_league ON league_invitations(league_id, status);
CREATE INDEX IF NOT EXISTS idx_league_invitations_team   ON league_invitations(team_id);
-- Case-insensitive, because a coach invited as J.Smith@ signs up as j.smith@
-- and expects it to be the same invitation.
CREATE INDEX IF NOT EXISTS idx_league_invitations_email  ON league_invitations(lower(email));

-- One live invitation per person per league. Re-inviting someone who has not
-- accepted should update the row the commissioner is looking at, not create a
-- second one that makes "coaches invited" count them twice. Accepted, revoked
-- and expired rows are excluded so a coach can legitimately be re-invited to a
-- later season.
CREATE UNIQUE INDEX IF NOT EXISTS idx_league_invitations_one_pending
  ON league_invitations(league_id, lower(email))
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. teams gains its league columns
-- ----------------------------------------------------------------------------
-- All three NULLABLE, all three with no default. A team with NULL league_id is
-- an ordinary BenchCoach team owned by an ordinary coach, which is what every
-- team in the database is today and what most of them will stay.
--
-- ON DELETE SET NULL throughout: deleting a league must orphan its teams, never
-- cascade into deleting a coach's roster, practice plans and season of notes. A
-- league leaving is a billing event, not a reason to destroy the coaching work
-- that happened under it.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS league_id          UUID REFERENCES leagues(id)           ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS league_season_id   UUID REFERENCES league_seasons(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS league_division_id UUID REFERENCES league_divisions(id)  ON DELETE SET NULL;

-- Partial: the index serves league reporting, and the overwhelming majority of
-- rows are NULL and would only make it bigger.
CREATE INDEX IF NOT EXISTS idx_teams_league
  ON teams(league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_league_division
  ON teams(league_division_id) WHERE league_division_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7b. Placeholder ownership, stated rather than inferred
-- ----------------------------------------------------------------------------
-- teams.coach_id is NOT NULL, so a league administrator building next season's
-- teams in February has to own them — there is nobody else yet. When the head
-- coach accepts in March, that ownership transfers to them, because a league
-- coach who cannot manage their own staff or team is a visibly worse product
-- than the one they would have bought.
--
-- The first implementation decided "is this a placeholder?" by asking whether
-- the current owner happens to be an administrator of the league. That is a
-- HEURISTIC, and it is wrong in a case that will certainly occur: a
-- commissioner who also coaches a team in their own league. Their real team,
-- with their real roster and their real practice plans, would have been
-- transferred away to whoever opened a head-coach invitation pointing at it.
--
-- So placeholder-ness is recorded as a fact at creation instead. This column
-- holds the coach row that is holding the team ON BEHALF of a coach who has not
-- arrived yet. Transfer is permitted only while
--
--     teams.coach_id = teams.league_placeholder_owner_id
--
-- and the column is set to NULL the moment the team is claimed, so a team can
-- be claimed exactly once and never again. A team created through ordinary
-- coach onboarding has NULL here and is therefore never transferable, whoever
-- owns it and whatever roles they hold.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS league_placeholder_owner_id UUID
    REFERENCES coaches(id) ON DELETE SET NULL;

-- Partial: only league-provisioned teams awaiting a coach are ever looked up
-- this way, and that is a small set that empties as a season fills.
CREATE INDEX IF NOT EXISTS idx_teams_placeholder
  ON teams(league_placeholder_owner_id) WHERE league_placeholder_owner_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7c. Claiming an invitation, and a seat, atomically
-- ----------------------------------------------------------------------------
-- Two races meet here, and both were previously lost.
--
-- 1. THE INVITATION. The accept route used to do its work — create a coach row,
--    move a team, insert a membership — and only THEN mark the invitation
--    accepted with a conditional UPDATE. So two people opening the same link at
--    once both passed validation, both wrote, and only then did one discover it
--    had lost. The loser's side effects stayed.
--
-- 2. THE SEAT. coach_limit was checked by counting accepted invitations and
--    then writing. Two coaches accepting the last seat both read "29 of 30" and
--    both proceeded.
--
-- One function fixes both, because they are the same transition: an invitation
-- becoming accepted IS a seat being taken.
--
-- FOR UPDATE on the licence row is what serialises it. Concurrent callers for
-- the same league queue behind that lock, so the count each one reads already
-- includes every accept that committed before it. A league with no licence row
-- cannot reach here — the route checks that first — but the function still
-- refuses rather than assuming.
--
-- SECURITY DEFINER because it is called with the service role from a route that
-- has already authorized the caller by token; it is not reachable from the
-- browser client, which has no policy allowing it to see league_invitations at
-- all.
--
-- Returns a single row: whether the seat was claimed, and if not, why. The
-- route maps `reason` onto an HTTP status. Returning a reason rather than
-- raising keeps an expected refusal ("already accepted") from arriving as a
-- 500.
CREATE OR REPLACE FUNCTION bc_claim_league_seat(
  p_invitation_id UUID,
  p_league_id     UUID
)
RETURNS TABLE (claimed BOOLEAN, reason TEXT, seats_used INT, coach_limit INT)
AS $$
DECLARE
  v_limit    INT;
  v_used     INT;
  v_status   TEXT;
  v_licensed BOOLEAN;
BEGIN
  -- Serialise every concurrent claim for this league behind the licence row.
  -- Ordered and limited so the lock target is deterministic when a league has
  -- more than one live licence.
  SELECT l.coach_limit, TRUE
    INTO v_limit, v_licensed
  FROM league_licenses l
  WHERE l.league_id = p_league_id
    AND l.status IN ('trial', 'active')
    AND (l.starts_at IS NULL OR l.starts_at <= NOW())
    AND (l.ends_at   IS NULL OR l.ends_at   >  NOW())
  ORDER BY l.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT COALESCE(v_licensed, FALSE) THEN
    RETURN QUERY SELECT FALSE, 'league_unlicensed'::TEXT, 0, NULL::INT;
    RETURN;
  END IF;

  -- Re-read the invitation under the lock. Its status may have changed since
  -- the route validated it.
  SELECT i.status INTO v_status
  FROM league_invitations i
  WHERE i.id = p_invitation_id AND i.league_id = p_league_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT FALSE, 'not_found'::TEXT, 0, v_limit;
    RETURN;
  END IF;

  IF v_status <> 'pending' THEN
    -- 'accepted' is the common case and means somebody got here first — which
    -- is usually the same person clicking twice.
    RETURN QUERY SELECT FALSE, ('invitation_' || v_status)::TEXT, 0, v_limit;
    RETURN;
  END IF;

  SELECT count(*)::INT INTO v_used
  FROM league_invitations i
  WHERE i.league_id = p_league_id AND i.status = 'accepted';

  IF v_limit IS NOT NULL AND v_used >= v_limit THEN
    RETURN QUERY SELECT FALSE, 'coach_limit_reached'::TEXT, v_used, v_limit;
    RETURN;
  END IF;

  UPDATE league_invitations
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = p_invitation_id AND status = 'pending';

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_used + 1, v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Releasing a claim, for when the work AFTER claiming fails.
--
-- The route claims the invitation first and then does the team work, so a
-- failure in that second half must hand the seat back rather than leaving a
-- coach with an invitation marked accepted that never actually did anything.
-- Conditional on 'accepted' so this can never revive a revoked invitation.
CREATE OR REPLACE FUNCTION bc_release_league_seat(p_invitation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE league_invitations
  SET status = 'pending', accepted_at = NULL
  WHERE id = p_invitation_id AND status = 'accepted';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Neither function is callable by a signed-in browser client.
--
-- This matters more than it looks. Both are SECURITY DEFINER, so they run with
-- the definer's rights and are not subject to RLS — which is the point, and
-- also means that a function left EXECUTE-able by `authenticated` is a hole
-- straight through every policy in this file. bc_claim_league_seat() in
-- particular can flip an invitation to accepted.
--
-- Wrapped in a role-existence check so the migration also applies to a plain
-- Postgres used for staging, where Supabase's anon/authenticated/service_role
-- do not exist. Without this the whole file aborts on the first REVOKE.
DO $$
DECLARE
  fn TEXT;
  rl TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'bc_claim_league_seat(UUID, UUID)',
    'bc_release_league_seat(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);

    FOREACH rl IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rl) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, rl);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Who am I in this league?
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER and STABLE for the same reasons as the bc_team_* family in
-- migration 034: a policy on league_members that has to read league_members to
-- evaluate itself is infinite recursion, and the answer is worth caching within
-- a statement rather than recomputing per row.

CREATE OR REPLACE FUNCTION bc_league_rank(p_role TEXT)
RETURNS INT AS $$
  SELECT CASE p_role
    WHEN 'owner'             THEN 4
    WHEN 'commissioner'      THEN 3
    WHEN 'admin'             THEN 2
    WHEN 'coaching_director' THEN 1
    -- Reserved. Ranks lowest so that anything gated above it stays shut until
    -- Phase 1 of division scoping actually exists.
    WHEN 'division_admin'    THEN 0
    ELSE -1
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION bc_league_role(p_league UUID)
RETURNS TEXT AS $$
  SELECT lm.role
  FROM league_members lm
  WHERE lm.league_id = p_league
    AND lm.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION bc_league_at_least(p_league UUID, p_min TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_league IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND bc_league_rank(bc_league_role(p_league)) >= bc_league_rank(p_min);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- A coach standing inside this league: they own a team attached to it, or they
-- are on the staff of one. This is what lets a sponsored coach read the league's
-- name and logo to render "Provided by Spring-Ford Youth Baseball" — and it
-- grants exactly that and nothing else, because the only tables whose policies
-- mention it are leagues, league_seasons and league_divisions.
CREATE OR REPLACE FUNCTION bc_in_league_team(p_league UUID)
RETURNS BOOLEAN AS $$
  SELECT p_league IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM teams t
         JOIN coaches c ON c.id = t.coach_id
         WHERE t.league_id = p_league AND c.user_id = auth.uid()
       )
       OR EXISTS (
         SELECT 1 FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE t.league_id = p_league AND tm.user_id = auth.uid()
       )
     );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 9. Row level security
-- ----------------------------------------------------------------------------
-- Read-only, and narrow. There is not one INSERT, UPDATE or DELETE policy in
-- this migration: every league write goes through an API route holding the
-- service role, behind requireLeagueRole() in lib/leagueAuthz.ts. That is the
-- same division of labour migration 034 settled on — the browser client reads
-- under RLS, the routes write under an explicit authorization check — and it
-- means a stolen anon key can create a league exactly as easily as it can
-- today, which is not at all.

ALTER TABLE leagues            ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_seasons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_divisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_licenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_invitations ENABLE ROW LEVEL SECURITY;

-- Named bc_league_* so re-running replaces rather than stacks, matching 034.
DROP POLICY IF EXISTS bc_league_read              ON leagues;
DROP POLICY IF EXISTS bc_league_read_seasons      ON league_seasons;
DROP POLICY IF EXISTS bc_league_read_divisions    ON league_divisions;
DROP POLICY IF EXISTS bc_league_read_own_member   ON league_members;
DROP POLICY IF EXISTS bc_league_read_members      ON league_members;
DROP POLICY IF EXISTS bc_league_read_licenses     ON league_licenses;

-- The league itself: administrators, and the coaches it sponsors. The second
-- half of that OR is what puts a league's name on a coach's dashboard.
CREATE POLICY bc_league_read ON leagues FOR SELECT
  USING (bc_league_at_least(id, 'division_admin') OR bc_in_league_team(id));

CREATE POLICY bc_league_read_seasons ON league_seasons FOR SELECT
  USING (bc_league_at_least(league_id, 'division_admin') OR bc_in_league_team(league_id));

CREATE POLICY bc_league_read_divisions ON league_divisions FOR SELECT
  USING (bc_league_at_least(league_id, 'division_admin') OR bc_in_league_team(league_id));

-- Your own membership — this is what the nav asks to decide whether to show a
-- "League Admin" link at all.
CREATE POLICY bc_league_read_own_member ON league_members FOR SELECT
  USING (user_id = auth.uid());

-- The full administrator list, for admins and above. Permissive policies OR
-- together, so this adds to the row above rather than narrowing it.
CREATE POLICY bc_league_read_members ON league_members FOR SELECT
  USING (bc_league_at_least(league_id, 'admin'));

-- The licence is the league's own contract; the people running the league may
-- read its status and dates. Coaches may not: a sponsored coach has no business
-- with the invoice, and the "provided by your league" banner is rendered from
-- the server's entitlement answer rather than from this table.
CREATE POLICY bc_league_read_licenses ON league_licenses FOR SELECT
  USING (bc_league_at_least(league_id, 'admin'));

-- league_invitations gets RLS enabled and NO policy at all, which denies every
-- client read. That is intentional and is the strongest statement in this file:
-- the invite token is a bearer credential, and a table of live tokens readable
-- by any authenticated user is an account takeover. The accept route reads it
-- with the service role after matching a token the caller already holds; the
-- admin dashboard lists it behind requireLeagueRole().

-- ----------------------------------------------------------------------------
-- What is deliberately NOT here
-- ----------------------------------------------------------------------------
-- No policy granting league members SELECT on teams, players, team_players,
-- player_notes, team_notes, player_traits, chat_threads, chat_messages,
-- practice_plans, prescriptions, entries or scouting_entries.
--
-- Every one of those gates on bc_team_at_least(...) or bc_coach_at_least(...)
-- from migration 034, both of which resolve through team ownership and
-- team_members. Nothing in this file appears in either. A commissioner
-- therefore cannot read a single practice plan, player note, scouting report or
-- AI conversation belonging to a coach in their league — not because a rule
-- forbids it, but because no policy grants it and RLS denies by default.
--
-- If a future migration adds a league-shaped read policy to any of those
-- tables, that is the migration that breaks this guarantee, and it should be
-- reviewed as a privacy change rather than as a reporting convenience.

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Six new tables, all with RLS on.
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname LIKE 'league%'
--   ORDER BY 1;
--   -- Expect 6 rows, relrowsecurity = true on every one.
--
-- Every league policy and what it requires. Expect 6, all SELECT, and NONE on
-- teams or any content table.
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE policyname LIKE 'bc_league%'
--   ORDER BY tablename, cmd;
--
-- league_invitations must have RLS on and zero policies.
--   SELECT count(*) AS invitation_policies
--   FROM pg_policies WHERE tablename = 'league_invitations';
--   -- Expect 0.
--
-- Existing teams are untouched: every row still has NULL league columns, and
-- the count of teams is whatever it was before this ran.
--   SELECT count(*) AS teams,
--          count(*) FILTER (WHERE league_id IS NULL) AS unaffiliated,
--          count(*) FILTER (WHERE league_id IS NOT NULL) AS in_a_league
--   FROM teams;
--   -- Expect unaffiliated = teams, in_a_league = 0, immediately after applying.
--
-- No league data was seeded.
--   SELECT
--     (SELECT count(*) FROM leagues)            AS leagues,
--     (SELECT count(*) FROM league_licenses)    AS licenses,
--     (SELECT count(*) FROM league_invitations) AS invitations;
--   -- Expect 0, 0, 0.
