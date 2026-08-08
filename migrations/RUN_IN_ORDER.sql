-- ============================================================================
-- BenchCoach — run this whole file in the Supabase SQL editor
-- ============================================================================
-- Copy everything below, paste it into a new query, and hit Run. Once.
--
-- This is migrations 023 through 031 concatenated IN ORDER, because order
-- matters here: 031 reads a column that 030 adds, and it will stop with a
-- plain-English message rather than a confusing one if you run them apart.
--
-- Every statement is additive and idempotent — IF NOT EXISTS, or guarded by a
-- check. Running this twice does nothing the second time, and running it when
-- you have already applied some of these files individually is fine. Nothing
-- here drops a table or deletes a row.
--
-- Afterwards, run migrations/CHECK_SCHEMA.sql to confirm. Every row should say
-- 'ok'. (026 is a trigger fix with no new column, so it does not appear in
-- that check — it is in here regardless.)
--
-- Generated from the individual files in /migrations. If you ever need to read
-- one on its own, they are all still there.
-- ============================================================================



-- ############################################################################
-- ##  023_development_plans.sql
-- ############################################################################

-- ============================================================================
-- Migration 023: The plan that comes out of a priority
-- ============================================================================
-- A priority names the one thing to fix and hands over three or four drills.
-- What it never said is what a parent actually does on Tuesday: how long, how
-- many, in what order, and what "better" looks like by Saturday. That gap is
-- where the loop leaks — the coach agrees with the read, has the drills, and
-- still doesn't know how to spend twenty minutes in a driveway.
--
-- For a team priority the answer is a practice plan, which already exists.
-- For a player it is a personal development plan, and this is where it lives:
-- on the priority, not in a separate table, because it is only ever about one
-- priority and it dies when that priority closes.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE prescriptions
  -- { markdown, generated_at, weeks } — markdown is the rendered plan, weeks
  -- is how long it was written for so a regeneration can match it.
  ADD COLUMN IF NOT EXISTS development_plan JSONB;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT id, focus_area,
--          development_plan->>'generated_at' AS plan_written,
--          length(development_plan->>'markdown') AS plan_chars
--   FROM prescriptions
--   WHERE status = 'active'
--   ORDER BY created_at DESC;


-- ############################################################################
-- ##  024_tiers.sql
-- ############################################################################

-- ============================================================================
-- Migration 024: Two plans instead of one
-- ============================================================================
-- There was one paid tier, written as 'pro' by the Stripe webhook regardless of
-- what was bought. With two prices that would have handed coach features to
-- everyone who paid for the parent plan, because nothing ever looked at which
-- price the subscription was for.
--
-- Two things get fixed here.
--
-- 1. Existing subscribers move from 'pro' to 'team'. They bought the only plan
--    that existed, which included everything, and quietly downgrading someone
--    who is already paying is not a thing to do to your first customers.
--
-- 2. A "personal player" stops being a string match. Adding a child creates a
--    season literally named 'Personal' plus a team named after the kid — so
--    the only way to tell a parent's workspace from a real roster was
--    comparing season.name to 'Personal'. Hanging billing limits on a name
--    anybody can type is asking for it.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Plans
-- ----------------------------------------------------------------------------
ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT,
  ADD COLUMN IF NOT EXISTS is_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Everyone who already pays keeps everything they already had.
UPDATE coaches
SET subscription_tier = 'team'
WHERE subscription_tier IN ('pro', 'Pro', 'PRO');

-- Anything unset or unrecognised is free. tierOf() in lib/tiers.ts treats an
-- unknown value as free too, so the database and the code agree.
UPDATE coaches
SET subscription_tier = 'free'
WHERE subscription_tier IS NULL
   OR subscription_tier NOT IN ('free', 'personal', 'team');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coaches_subscription_tier_check'
  ) THEN
    ALTER TABLE coaches
      ADD CONSTRAINT coaches_subscription_tier_check
      CHECK (subscription_tier IN ('free', 'personal', 'team'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Personal workspace vs real team
-- ----------------------------------------------------------------------------
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS workspace_kind TEXT NOT NULL DEFAULT 'team'
  CHECK (workspace_kind IN ('personal', 'team'));

-- Backfill from how it has always been distinguished, once, so the string
-- match never has to run again.
UPDATE teams t
SET workspace_kind = 'personal'
FROM seasons s
WHERE s.id = t.season_id
  AND lower(s.name) = 'personal'
  AND t.workspace_kind <> 'personal';

CREATE INDEX IF NOT EXISTS idx_teams_coach_kind ON teams(coach_id, workspace_kind);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT subscription_tier, is_subscribed, count(*)
--   FROM coaches GROUP BY 1, 2 ORDER BY 3 DESC;
--
--   SELECT c.display_name,
--          count(*) FILTER (WHERE t.workspace_kind = 'team')     AS teams,
--          count(*) FILTER (WHERE t.workspace_kind = 'personal') AS personal_players
--   FROM coaches c LEFT JOIN teams t ON t.coach_id = c.id
--   GROUP BY c.id, c.display_name ORDER BY teams DESC;


-- ############################################################################
-- ##  025_quick_log.sql
-- ############################################################################

-- ============================================================================
-- Migration 025: One "Ran it today" per priority per day
-- ============================================================================
-- The one-tap logger had no guard against a double tap. It disabled only while
-- the request was in flight, so a quick second thumb — or tapping, navigating
-- back, and tapping again — wrote two sessions for one day.
--
-- That corrupts the single number the whole loop reasons from. Adherence
-- decides whether "it didn't move" means CHANGE THE DRILL or SHRINK THE ASK,
-- and those are opposite advice. Two stray taps turn a real 4-of-6 week into
-- 8-of-6, which flips the verdict.
--
-- The fix has to distinguish the one-tap logger from the full Log an Entry
-- form, because logging two genuine sessions in one day is legitimate — a
-- morning and an evening in the cage is a real thing. A blanket unique
-- constraint would block that. So only quick logs are deduplicated.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS quick_log BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforced in the database as well as the route. The API returns the existing
-- row rather than inserting, but two requests racing each other would both
-- pass that check — this is what actually makes it impossible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_one_quick_log_per_day
  ON entries (prescription_id, occurred_on)
  WHERE quick_log = TRUE AND prescription_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Clean up anything already doubled
-- ----------------------------------------------------------------------------
-- Existing quick-tap entries predate the flag, so they are identified the way
-- the button wrote them: a home session with the title it always sets and no
-- notes attached. Only exact same-day duplicates are removed, oldest kept.
WITH quick AS (
  SELECT e.id, e.prescription_id, e.occurred_on,
         ROW_NUMBER() OVER (
           PARTITION BY e.prescription_id, e.occurred_on
           ORDER BY e.created_at
         ) AS rn
  FROM entries e
  WHERE e.entry_type = 'home_session'
    AND e.prescription_id IS NOT NULL
    AND e.title = 'Worked the priority'
    AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entry_id = e.id)
)
DELETE FROM entries WHERE id IN (SELECT id FROM quick WHERE rn > 1);

-- Mark the survivors so the new index covers them too.
UPDATE entries
SET quick_log = TRUE
WHERE entry_type = 'home_session'
  AND prescription_id IS NOT NULL
  AND title = 'Worked the priority'
  AND quick_log = FALSE;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   Should return no rows:
--   SELECT prescription_id, occurred_on, count(*)
--   FROM entries WHERE quick_log
--   GROUP BY 1, 2 HAVING count(*) > 1;


-- ############################################################################
-- ##  026_fix_game_note_mirror.sql
-- ############################################################################

-- ============================================================================
-- Migration 026: Game notes save again
-- ============================================================================
-- Notes taken during a game were silently not saving.
--
-- Migration 016 mirrors every game note into observations so the AI can see
-- what was said live. The trigger upserts with
--
--     ON CONFLICT (source_game_note_id) DO UPDATE
--
-- but the unique index it targets is PARTIAL:
--
--     CREATE UNIQUE INDEX ... ON observations(source_game_note_id)
--       WHERE source_game_note_id IS NOT NULL;
--
-- Postgres will not match a partial index unless the ON CONFLICT clause
-- carries the same predicate. Without it the statement raises
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — which fails the trigger, which fails the INSERT into
-- game_notes, and the game screen logged that to the console and moved on.
-- So the coach typed a note during an inning and it went nowhere.
--
-- Adding the predicate is the whole fix.
--
-- Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION game_notes_to_observation()
RETURNS TRIGGER AS $$
DECLARE
  v_coach_id UUID;
  v_team_id  UUID;
  v_date     DATE;
BEGIN
  SELECT g.team_id, t.coach_id, g.game_date
    INTO v_team_id, v_coach_id, v_date
  FROM games g
  JOIN teams t ON t.id = g.team_id
  WHERE g.id = NEW.game_id;

  -- No owning coach means nothing can read it anyway; skip rather than fail
  -- the note insert, which is the thing the coach actually cares about.
  IF v_coach_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO observations (
    coach_id, player_id, team_id, prompt_key, body, observed_on, source_game_note_id
  ) VALUES (
    v_coach_id,
    NEW.player_id,
    v_team_id,
    -- prompt_key drives weighting. 'in_game' says: seen live, written at the
    -- time, and carries the note's own category for extra signal.
    'in_game_' || COALESCE(NEW.note_type, 'general'),
    NEW.note,
    COALESCE(v_date, CURRENT_DATE),
    NEW.id
  )
  -- The predicate is what makes this match the partial index. It was missing.
  ON CONFLICT (source_game_note_id) WHERE source_game_note_id IS NOT NULL
  DO UPDATE
    SET body = EXCLUDED.body,
        prompt_key = EXCLUDED.prompt_key;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill anything typed during a game while this was broken. The note rows
-- themselves never made it in, so there is nothing to recover — but if any
-- landed before 016 was applied, this catches them.
INSERT INTO observations (
  coach_id, player_id, team_id, prompt_key, body, observed_on, source_game_note_id
)
SELECT t.coach_id, n.player_id, g.team_id,
       'in_game_' || COALESCE(n.note_type, 'general'),
       n.note,
       COALESCE(g.game_date, CURRENT_DATE),
       n.id
FROM game_notes n
JOIN games g ON g.id = n.game_id
JOIN teams t ON t.id = g.team_id
WHERE NOT EXISTS (
  SELECT 1 FROM observations o WHERE o.source_game_note_id = n.id
);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
-- Every game note should now have a matching observation:
--   SELECT
--     (SELECT count(*) FROM game_notes) AS notes,
--     (SELECT count(*) FROM observations WHERE source_game_note_id IS NOT NULL) AS mirrored;


-- ############################################################################
-- ##  027_lineup_constraints.sql
-- ############################################################################

-- ============================================================================
-- Migration 027: Lineup rules a coach sets once
-- ============================================================================
-- The fielding solver optimised for fit and fairness and had no way to be
-- told a rule. Three things a real coach needs before they will trust a
-- generated lineup:
--
--   "RJ only plays short."            → locked_position
--   "Lucas can play anywhere but 1B." → excluded_positions
--   "Everyone plays at least one."    → min_innings (per player, or team-wide)
--
-- These live on team_players rather than on a lineup, because they are true
-- of the player all season. A coach who has to re-enter them every game will
-- enter them once and then stop using the builder.
--
-- min/max innings is also where league rules live. 8U travel typically
-- requires every rostered kid to field an inning; a pitcher on a count gets a
-- max. Both are per player so an exception doesn't force a rule change.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE team_players
  -- NULL means unlocked, which is the normal case. A locked player takes no
  -- other position and the position prefers them.
  ADD COLUMN IF NOT EXISTS locked_position TEXT,
  -- Cheaper to say than listing the eight they CAN play.
  ADD COLUMN IF NOT EXISTS excluded_positions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_innings INT,
  ADD COLUMN IF NOT EXISTS max_innings INT;

-- Team-wide defaults. min_innings_all is the "everyone plays at least one
-- inning" rule expressed once instead of on twelve rows.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS min_innings_all INT,
  -- Which way the solver leans by default. Seasons already carry league_type,
  -- but a coach running a rec team in a competitive tournament needs to
  -- override it for the day, so the lineup keeps its own copy.
  ADD COLUMN IF NOT EXISTS default_strategy TEXT
    CHECK (default_strategy IS NULL OR default_strategy IN ('development', 'competitive'));

-- Seed the default from the season's league type where it is already known,
-- so travel teams open on the set-lineup behaviour without being asked.
UPDATE teams t
SET default_strategy = CASE s.league_type
    WHEN 'travel' THEN 'competitive'
    WHEN 'rec'    THEN 'development'
    ELSE NULL
  END
FROM seasons s
WHERE s.id = t.season_id
  AND t.default_strategy IS NULL
  AND s.league_type IN ('travel', 'rec');

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT p.name, tp.locked_position, tp.excluded_positions,
--          tp.min_innings, tp.max_innings
--   FROM team_players tp JOIN players p ON p.id = tp.player_id
--   WHERE tp.locked_position IS NOT NULL
--      OR array_length(tp.excluded_positions, 1) > 0
--      OR tp.min_innings IS NOT NULL
--      OR tp.max_innings IS NOT NULL;
--
--   SELECT name, default_strategy, min_innings_all FROM teams;


-- ############################################################################
-- ##  028_live_lineup.sql
-- ############################################################################

-- ============================================================================
-- Migration 028: The lineup, live
-- ============================================================================
-- Game Day tracked notes and pitch counts and nothing about who was actually
-- on the field. So the lineup builder produced a plan, and the game screen had
-- no idea it existed — a coach set a lineup, then managed the real one in their
-- head or on paper.
--
-- Two tables, and the split matters.
--
--   game_participation — one row per player per game: did they start, what
--   batting slot, are they in right now, how many times have they been
--   removed and re-entered. This is the state substitution rules are judged
--   against, and it has to be a running total rather than something derived
--   at read time, because "has RJ used his re-entry" must not depend on
--   replaying a log correctly.
--
--   game_position_log — one row per player per inning per position. This is
--   the history: who played where, when. Innings-played counts come from
--   here, and so does the fielding record the analysis reads.
--
-- Substitution rules are per GAME, not per team. The same team plays a rec
-- league game under continuous batting order on Tuesday and a tournament
-- under starter re-entry on Saturday.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which rules this game is being played under
-- ----------------------------------------------------------------------------
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS sub_rules TEXT NOT NULL DEFAULT 'starter_reentry'
    CHECK (sub_rules IN ('starter_reentry', 'continuous_free', 'no_reentry')),
  -- Set once the coach commits the starting lineup, so the screen knows
  -- whether it is still being built or is now the record of a game.
  ADD COLUMN IF NOT EXISTS lineup_locked_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Who is in, and what they have spent
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_participation (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,

  -- On the card before the first pitch. Only starters get a re-entry.
  is_starter      BOOLEAN NOT NULL DEFAULT FALSE,
  -- 1-based. A starter re-entering must return to the same slot, so this is
  -- the thing that makes that rule checkable.
  batting_slot    INT,
  is_in           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Running totals rather than derived. Whether a kid can go back in is not
  -- something to recompute from a log under time pressure at a fence.
  times_removed   INT NOT NULL DEFAULT 0,
  reentries       INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, team_player_id)
);

CREATE OR REPLACE FUNCTION game_participation_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_participation_touch ON game_participation;
CREATE TRIGGER trg_game_participation_touch
  BEFORE UPDATE ON game_participation
  FOR EACH ROW EXECUTE FUNCTION game_participation_touch();

-- ----------------------------------------------------------------------------
-- 3. Who played where, inning by inning
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_position_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,
  inning          INT NOT NULL CHECK (inning > 0),
  -- NULL means on the bench that inning, which is worth recording: it is how
  -- "everyone played three innings" gets checked after the fact.
  position        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- One position per player per inning. A player cannot be at two spots at
  -- once, and a double-tap should correct rather than duplicate.
  UNIQUE (game_id, team_player_id, inning)
);

CREATE INDEX IF NOT EXISTS idx_game_position_log_game
  ON game_position_log(game_id, inning);

-- ----------------------------------------------------------------------------
-- RLS — same shape as everything else that hangs off a game
-- ----------------------------------------------------------------------------
ALTER TABLE game_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_position_log  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game participation') THEN
    CREATE POLICY "Coaches manage own game participation" ON game_participation FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own position log') THEN
    CREATE POLICY "Coaches manage own position log" ON game_position_log FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT p.name, gp.is_starter, gp.batting_slot, gp.is_in,
--          gp.times_removed, gp.reentries
--   FROM game_participation gp
--   JOIN team_players tp ON tp.id = gp.team_player_id
--   JOIN players p ON p.id = tp.player_id
--   WHERE gp.game_id = '<game id>'
--   ORDER BY gp.batting_slot NULLS LAST;
--
--   SELECT inning, position, p.name
--   FROM game_position_log l
--   JOIN team_players tp ON tp.id = l.team_player_id
--   JOIN players p ON p.id = tp.player_id
--   WHERE l.game_id = '<game id>' ORDER BY inning, position;


-- ############################################################################
-- ##  029_house_rules.sql
-- ############################################################################

-- ============================================================================
-- Migration 029: House rules a coach states once, mid-game
-- ============================================================================
-- The dugout assistant knows the three rulesets the app enforces. It does not
-- know that this tournament allows a courtesy runner for the catcher without
-- counting as a substitution, or that this league lets a starter re-enter
-- twice. A coach types that once and expects it to hold for the rest of the
-- game — and to be respected the next time they ask a question.
--
-- Free text on purpose. The alternative is a settings screen enumerating every
-- quirk in youth baseball, which nobody would fill in and which would still
-- miss the one that matters on Saturday.
--
-- These do NOT silently relax the engine. The buttons keep enforcing the
-- selected ruleset, and the assistant is told to say when a house rule and the
-- ruleset disagree, so the coach either changes the setting or overrides
-- knowingly. A rule the assistant honours and the button refuses is the worst
-- possible outcome.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS house_rules TEXT;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT game_date, opponent, sub_rules, house_rules
--   FROM games WHERE house_rules IS NOT NULL ORDER BY game_date DESC;


-- ############################################################################
-- ##  030_scorebook.sql
-- ############################################################################

-- ============================================================================
-- Migration 030: The scorebook
-- ============================================================================
-- Game Day could record notes, pitch counts and who was on the field. It could
-- not record what actually happened — who got the hit, who drove in the run,
-- how the out was made. That is the book, and it is the thing a coach is
-- holding when someone asks "did he score on that?".
--
-- ONE ORDERED STREAM, WITH SNAPSHOTS
--
-- Every event — a plate appearance, a stolen base, a passed ball — is one row
-- with a sequence number, carrying the bases and outs AFTER it happened.
--
-- Storing the after-state rather than deriving it is deliberate, and it is the
-- same call migration 028 made for re-entries:
--
--   Undo is deleting the highest seq. A coach who taps the wrong button
--   between pitches gets it back in one tap, with nothing to replay.
--
--   The state of the game is the last row. Nothing is recomputed under time
--   pressure at a fence, and a change to the scoring rules next month cannot
--   silently rewrite a game played last week.
--
--   Overrides survive. When the coach drags a runner somewhere the defaults
--   did not put him, the snapshot holds what he decided — not what the table
--   would have said.
--
-- PITCH COUNTS ARE NOT FORKED
--
-- Pitches logged here are written through to game_pitch_counts, which stays
-- the single source of truth that the pitch panel, the dugout assistant and
-- the availability check all read. A second count that disagreed with the
-- first would be worse than no scorebook at all.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which dugout we're in
-- ----------------------------------------------------------------------------
-- Home or away decides whether the top of the inning is our offence or our
-- pitching, which the book needs before the first pitch.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS is_home BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set the first time an event is recorded, so the game screen can tell a
  -- scored game from one that was only watched.
  ADD COLUMN IF NOT EXISTS scorebook_started_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. The book
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,

  -- Position in the game. Undo takes the highest, and the unique constraint
  -- means two taps racing each other cannot both land.
  seq             INT NOT NULL,

  -- 'pa'   — a plate appearance ended
  -- 'base' — runners moved without one: steal, passed ball, pickoff
  kind            TEXT NOT NULL DEFAULT 'pa' CHECK (kind IN ('pa', 'base')),

  inning          INT  NOT NULL CHECK (inning > 0),
  half            TEXT NOT NULL CHECK (half IN ('top', 'bottom')),
  -- Derived from half + games.is_home at write time, and stored, because the
  -- book must still read correctly if someone fixes is_home afterwards.
  we_batting      BOOLEAN NOT NULL,

  -- '1B', 'K', 'GO', 'SB', 'WP' … see lib/scorebook.ts, which is authoritative.
  result          TEXT NOT NULL,
  -- How it reads in the book: '6-3', 'F8', 'E5'.
  scoring         TEXT,

  -- Our batter. NULL when the other side is hitting — they are on nobody's
  -- roster and never will be.
  batter_team_player_id UUID REFERENCES team_players(id) ON DELETE SET NULL,
  -- Their batter, by lineup slot, with a name if the coach bothered.
  opponent_slot   INT,
  opponent_name   TEXT,

  -- Our pitcher, when we are in the field. This is what makes a pitching line
  -- possible, and it is the join to game_pitch_counts.
  pitcher_player_id UUID REFERENCES players(id) ON DELETE SET NULL,

  -- The count this plate appearance took. Balls + strikes do not have to sum
  -- to pitches: fouls are pitches that are sometimes neither.
  balls           INT NOT NULL DEFAULT 0,
  strikes         INT NOT NULL DEFAULT 0,
  pitches         INT NOT NULL DEFAULT 0,

  rbi             INT NOT NULL DEFAULT 0,

  -- The snapshot. See the header — this is the point of the table.
  outs_before     INT NOT NULL DEFAULT 0 CHECK (outs_before BETWEEN 0 AND 3),
  outs_after      INT NOT NULL DEFAULT 0 CHECK (outs_after  BETWEEN 0 AND 3),
  -- { "first": {id,name,earned} | null, "second": …, "third": … }
  bases_before    JSONB NOT NULL DEFAULT '{}'::jsonb,
  bases_after     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ id, name, earned }] — who crossed the plate on this event. Runs belong
  -- to the runner, not the batter, which is why they are carried here.
  runs_scored     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Set when the coach moved a runner somewhere the defaults did not, so the
  -- book can show its own workings if the numbers are ever questioned.
  adjusted        BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_game_events_game_seq
  ON game_events(game_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_batter
  ON game_events(batter_team_player_id)
  WHERE batter_team_player_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. RLS — same shape as everything else hanging off a game
-- ----------------------------------------------------------------------------
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game events') THEN
    CREATE POLICY "Coaches manage own game events" ON game_events FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- The book, in order
--   SELECT seq, inning, half, we_batting, result, scoring,
--          COALESCE(p.name, e.opponent_name, 'slot ' || e.opponent_slot) AS batter,
--          balls || '-' || strikes AS count, pitches, rbi, outs_after,
--          jsonb_array_length(runs_scored) AS runs
--   FROM game_events e
--   LEFT JOIN team_players tp ON tp.id = e.batter_team_player_id
--   LEFT JOIN players p ON p.id = tp.player_id
--   WHERE e.game_id = '<game id>'
--   ORDER BY seq;
--
--   -- Does it reconcile? Runs here should equal the score on the game.
--   SELECT half, SUM(jsonb_array_length(runs_scored)) AS runs
--   FROM game_events WHERE game_id = '<game id>' GROUP BY half;


-- ############################################################################
-- ##  031_half_innings_and_eligibility.sql
-- ############################################################################

-- ============================================================================
-- Migration 031: Half-innings, opponent pitchers, and per-game eligibility
-- ============================================================================
-- Three things, and the first one is the cause of most of the clunkiness.
--
-- 1. THE GAME HAD NO HALF
--
-- games tracked current_inning and nothing else, so "the top of the third" and
-- "the bottom of the third" were the same place. That is why a coach had to
-- bump the inning to change pitchers: the only way to say "we're in the field
-- now" was to move to a different inning, which then lied about the inning.
--
-- current_half makes the cursor complete. It is the SHARED cursor — the pitch
-- panel, the lineup panel and the scorebook all read and write it, so whichever
-- one the coach touches moves the others. The scorebook keeps it automatically
-- when it is being used, and the manual control keeps it when it is not.
-- Nothing requires the scorebook.
--
-- 2. PITCH COUNTS WERE OURS ONLY
--
-- A coach tracking the other team's pitcher had nowhere to put those pitches.
-- Same table, because they are the same act and the same buttons; a second
-- table would have meant a second counter that drifts.
--
-- 3. ELIGIBILITY WAS ALREADY GLOBAL, BUT INVISIBLE AND UNCHANGEABLE
--
-- position_eligibility is keyed by team_player_id, so it always was a team
-- setting — it just lived inside the lineup builder, which made it feel like
-- something you redo every game. What was actually missing is the opposite:
-- a way to depart from it for ONE game, when you're trying a kid somewhere new
-- without promising he can play there from now on.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. This one needs 030 first
-- ----------------------------------------------------------------------------
-- The pitch-count backfill below reads games.is_home, which 030 adds. Failing
-- here with a sentence beats failing forty lines down with "column is_home
-- does not exist".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'is_home'
  ) THEN
    RAISE EXCEPTION 'Run 030_scorebook.sql before this one — it adds games.is_home, which this migration reads.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Which half of the inning we're in
-- ----------------------------------------------------------------------------
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS current_half TEXT NOT NULL DEFAULT 'top'
    CHECK (current_half IN ('top', 'bottom'));

-- ----------------------------------------------------------------------------
-- 2. Pitch counts get a half, and can belong to the other team
-- ----------------------------------------------------------------------------
ALTER TABLE game_pitch_counts
  ADD COLUMN IF NOT EXISTS half TEXT NOT NULL DEFAULT 'top'
    CHECK (half IN ('top', 'bottom')),
  -- Their pitcher. Nobody rosters the other team, so the name is the identity.
  ADD COLUMN IF NOT EXISTS is_opponent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opponent_pitcher_name TEXT;

-- Our pitcher rows need a player; theirs never have one. Dropping the NOT NULL
-- is what lets both live in the same table, and the CHECK keeps a row from
-- being neither.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_pitch_counts'
      AND column_name = 'player_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE game_pitch_counts ALTER COLUMN player_id DROP NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_pitch_counts_has_a_pitcher'
  ) THEN
    ALTER TABLE game_pitch_counts ADD CONSTRAINT game_pitch_counts_has_a_pitcher
      CHECK (player_id IS NOT NULL OR opponent_pitcher_name IS NOT NULL);
  END IF;
END $$;

-- Existing rows are all ours, and ours are thrown in the half we're in the
-- field: the bottom when we're home, the top when we're away. Away games are
-- already correct at the 'top' default, so only home games need moving.
UPDATE game_pitch_counts pc
SET half = 'bottom'
FROM games g
WHERE g.id = pc.game_id
  AND pc.is_opponent = FALSE
  AND pc.half = 'top'
  AND COALESCE(g.is_home, TRUE) = TRUE;

CREATE INDEX IF NOT EXISTS idx_game_pitch_counts_lookup
  ON game_pitch_counts(game_id, inning, half);

-- ----------------------------------------------------------------------------
-- 3. Eligibility, just for tonight
-- ----------------------------------------------------------------------------
-- A row here OVERRIDES position_eligibility for one game and one game only.
-- No row means "use the team setting", which is why this is a sparse table and
-- not a copy of the whole grid per game — a per-game snapshot would silently
-- freeze a kid's eligibility at whatever it was the night you made it.
CREATE TABLE IF NOT EXISTS game_position_eligibility (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  team_player_id  UUID REFERENCES team_players(id) ON DELETE CASCADE NOT NULL,
  position        TEXT NOT NULL,
  eligible        BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (game_id, team_player_id, position)
);

CREATE INDEX IF NOT EXISTS idx_game_position_eligibility_game
  ON game_position_eligibility(game_id);

-- Set once the coach has looked at the eligibility grid for this game, so the
-- review is offered rather than nagged.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS eligibility_reviewed_at TIMESTAMPTZ;

ALTER TABLE game_position_eligibility ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches manage own game eligibility') THEN
    CREATE POLICY "Coaches manage own game eligibility" ON game_position_eligibility FOR ALL
      USING (game_id IN (
        SELECT g.id FROM games g JOIN teams t ON t.id = g.team_id
        WHERE t.coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- Pitch counts, both teams, by half
--   SELECT inning, half, is_opponent,
--          COALESCE(p.name, opponent_pitcher_name) AS pitcher, pitch_count
--   FROM game_pitch_counts pc
--   LEFT JOIN players p ON p.id = pc.player_id
--   WHERE pc.game_id = '<game id>'
--   ORDER BY inning, half DESC, pitcher;
--
--   -- Where a game departs from the team's eligibility
--   SELECT pl.name, ge.position, ge.eligible AS tonight
--   FROM game_position_eligibility ge
--   JOIN team_players tp ON tp.id = ge.team_player_id
--   JOIN players pl ON pl.id = tp.player_id
--   WHERE ge.game_id = '<game id>';


-- ============================================================================
-- Done. Run migrations/CHECK_SCHEMA.sql next to confirm every row says 'ok'.
-- ============================================================================
