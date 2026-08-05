-- ============================================================================
-- Migration 010: Scouting Reports module
-- ============================================================================
-- A second loop, distinct from the development loop. Development answers
-- "what should my player work on"; scouting answers "what should we do
-- against this team tomorrow."
--
-- Headline capability: pitching availability. Given logged opponent box
-- scores and a configurable pitch-count rule set, derive who is ineligible,
-- limited, or available for an upcoming game.
--
-- Framing: this is organized note-taking on games the coach already watched,
-- using data the tournament already published. Scouting data is scoped to
-- the logging account — no cross-account aggregation, ever.
--
-- Apply by pasting into the Supabase SQL editor. Additive only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Opponent teams
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opponent_teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id    UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  org_name    TEXT,
  age_group   TEXT,
  region      TEXT,
  notes       TEXT,
  first_seen  DATE,
  last_seen   DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Opponent players
-- ----------------------------------------------------------------------------
-- Identity across games is the hard part (misspelled names, reused jersey
-- numbers). Rows are never auto-merged below a high confidence threshold —
-- duplicates are recoverable, wrong merges silently corrupt pitch-count math.
CREATE TABLE IF NOT EXISTS opponent_players (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opponent_team_id  UUID REFERENCES opponent_teams(id) ON DELETE CASCADE NOT NULL,
  name              TEXT NOT NULL,
  jersey_number     TEXT,
  bats              TEXT CHECK (bats IN ('L', 'R', 'S')),
  throws            TEXT CHECK (throws IN ('L', 'R')),
  positions         TEXT[] DEFAULT '{}',
  notes             TEXT,
  confidence        TEXT NOT NULL DEFAULT 'confirmed'
                    CHECK (confidence IN ('confirmed', 'probable', 'uncertain')),
  needs_review      BOOLEAN DEFAULT FALSE,     -- flagged instead of auto-merged
  first_seen        DATE,
  last_seen         DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Scouting entries (mirrors `entries`/game capture, scoped to opponents)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scouting_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id          UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  -- NULL only for bracket entries, which cover a whole tournament rather
  -- than a single opponent
  opponent_team_id  UUID REFERENCES opponent_teams(id) ON DELETE CASCADE,
  entry_type        TEXT NOT NULL DEFAULT 'observation'
                    CHECK (entry_type IN ('box_score', 'recap', 'observation', 'bracket')),
  CONSTRAINT scouting_entries_opponent_required
    CHECK (entry_type = 'bracket' OR opponent_team_id IS NOT NULL),
  occurred_on       DATE,
  tournament_name   TEXT,
  image_urls        TEXT[] DEFAULT '{}',
  raw_parse         JSONB,
  parse_status      TEXT DEFAULT 'none'
                    CHECK (parse_status IN ('none', 'pending', 'parsed', 'failed')),
  parse_confidence  TEXT CHECK (parse_confidence IN ('high', 'medium', 'low')),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Opponent appearances — one row per player per logged game
-- ----------------------------------------------------------------------------
-- pitches_thrown is the whole ballgame: it drives the availability board.
CREATE TABLE IF NOT EXISTS opponent_appearances (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opponent_player_id  UUID REFERENCES opponent_players(id) ON DELETE CASCADE NOT NULL,
  scouting_entry_id   UUID REFERENCES scouting_entries(id) ON DELETE CASCADE,
  game_date           DATE NOT NULL,
  batting_order_slot  INT,
  positions_played    TEXT[] DEFAULT '{}',
  batting_line        JSONB,        -- AB/H/BB/K/etc as parsed
  pitches_thrown      INT,          -- null if didn't pitch
  innings_pitched     NUMERIC,
  raw                 JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. Pitch count rules — thresholds and required rest days by age
-- ----------------------------------------------------------------------------
-- coach_id NULL = system default rule set, visible to everyone.
-- thresholds jsonb: ordered array of { "max_pitches": N, "rest_days": M }.
-- A pitcher's rest requirement is the rest_days of the FIRST band whose
-- max_pitches >= pitches thrown. daily_max is the outing cap for the age.
CREATE TABLE IF NOT EXISTS pitch_count_rules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id          UUID REFERENCES coaches(id) ON DELETE CASCADE,   -- NULL = system default
  sanctioning_body  TEXT NOT NULL,             -- 'Little League', 'USSSA', 'Perfect Game', ...
  age_group         TEXT NOT NULL,             -- '8U', '9-10', '11-12', '13-14', ...
  daily_max         INT,                       -- max pitches in a single day, if defined
  thresholds        JSONB NOT NULL,            -- [{"max_pitches": 20, "rest_days": 0}, ...]
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coach_id, sanctioning_body, age_group)
);

-- ----------------------------------------------------------------------------
-- 6. Matchups — upcoming games to prep for
-- ----------------------------------------------------------------------------
-- status 'possible' supports bracket capture: log a bracket screenshot and
-- prep for the semifinal opponent before the quarterfinal is played.
CREATE TABLE IF NOT EXISTS matchups (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id          UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  team_id           UUID REFERENCES teams(id) ON DELETE CASCADE,
  opponent_team_id  UUID REFERENCES opponent_teams(id) ON DELETE CASCADE NOT NULL,
  scheduled_at      TIMESTAMPTZ,
  tournament_name   TEXT,
  bracket_position  TEXT,
  status            TEXT NOT NULL DEFAULT 'upcoming'
                    CHECK (status IN ('upcoming', 'played', 'possible')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. Row Level Security — scouting data stays scoped to the logging account
-- ----------------------------------------------------------------------------
ALTER TABLE opponent_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE opponent_players     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouting_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE opponent_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_count_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchups             ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own opponent teams') THEN
    CREATE POLICY "Coaches can manage own opponent teams" ON opponent_teams FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own opponent players') THEN
    CREATE POLICY "Coaches can manage own opponent players" ON opponent_players FOR ALL
      USING (opponent_team_id IN (SELECT id FROM opponent_teams
             WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own scouting entries') THEN
    CREATE POLICY "Coaches can manage own scouting entries" ON scouting_entries FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own opponent appearances') THEN
    CREATE POLICY "Coaches can manage own opponent appearances" ON opponent_appearances FOR ALL
      USING (opponent_player_id IN (SELECT id FROM opponent_players
             WHERE opponent_team_id IN (SELECT id FROM opponent_teams
             WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()))));
  END IF;

  -- System defaults (coach_id NULL) are readable by everyone; coaches manage their own overrides
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read system pitch count rules') THEN
    CREATE POLICY "Anyone can read system pitch count rules" ON pitch_count_rules FOR SELECT
      USING (coach_id IS NULL
             OR coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can insert own pitch count rules') THEN
    CREATE POLICY "Coaches can insert own pitch count rules" ON pitch_count_rules FOR INSERT
      WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can update own pitch count rules') THEN
    CREATE POLICY "Coaches can update own pitch count rules" ON pitch_count_rules FOR UPDATE
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can delete own pitch count rules') THEN
    CREATE POLICY "Coaches can delete own pitch count rules" ON pitch_count_rules FOR DELETE
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own matchups') THEN
    CREATE POLICY "Coaches can manage own matchups" ON matchups FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_opponent_teams_coach_id       ON opponent_teams(coach_id);
CREATE INDEX IF NOT EXISTS idx_opponent_players_team_id      ON opponent_players(opponent_team_id);
CREATE INDEX IF NOT EXISTS idx_scouting_entries_coach_id     ON scouting_entries(coach_id);
CREATE INDEX IF NOT EXISTS idx_scouting_entries_opponent_id  ON scouting_entries(opponent_team_id);
CREATE INDEX IF NOT EXISTS idx_opponent_appearances_player   ON opponent_appearances(opponent_player_id);
CREATE INDEX IF NOT EXISTS idx_opponent_appearances_entry    ON opponent_appearances(scouting_entry_id);
CREATE INDEX IF NOT EXISTS idx_opponent_appearances_date     ON opponent_appearances(game_date);
CREATE INDEX IF NOT EXISTS idx_matchups_coach_id             ON matchups(coach_id);
CREATE INDEX IF NOT EXISTS idx_matchups_opponent_id          ON matchups(opponent_team_id);
CREATE INDEX IF NOT EXISTS idx_pitch_count_rules_coach       ON pitch_count_rules(coach_id);

-- ----------------------------------------------------------------------------
-- 9. Seed system-default pitch count rule sets (coach_id NULL)
-- ----------------------------------------------------------------------------
-- Published rest-day rules from the major sanctioning bodies. Coaches can add
-- their own rule sets for local circuits; these are the widely used defaults.
-- Bands are cumulative-pitch thresholds: rest_days applies when pitches thrown
-- fall at or below max_pitches (checked in ascending order).

-- Little League (2024 regular season rules)
INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Little League', '7-8', 50,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Little League' AND age_group = '7-8');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Little League', '9-10', 75,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 75, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Little League' AND age_group = '9-10');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Little League', '11-12', 85,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 85, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Little League' AND age_group = '11-12');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Little League', '13-14', 95,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 95, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Little League' AND age_group = '13-14');

-- USSSA (common tournament limits — daily max by age, rest after 46+)
INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'USSSA', '8U', 50,
  '[{"max_pitches": 25, "rest_days": 0}, {"max_pitches": 45, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'USSSA' AND age_group = '8U');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'USSSA', '9U-10U', 75,
  '[{"max_pitches": 25, "rest_days": 0}, {"max_pitches": 45, "rest_days": 1}, {"max_pitches": 75, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'USSSA' AND age_group = '9U-10U');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'USSSA', '11U-12U', 85,
  '[{"max_pitches": 25, "rest_days": 0}, {"max_pitches": 45, "rest_days": 1}, {"max_pitches": 85, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'USSSA' AND age_group = '11U-12U');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'USSSA', '13U-14U', 95,
  '[{"max_pitches": 25, "rest_days": 0}, {"max_pitches": 45, "rest_days": 1}, {"max_pitches": 95, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'USSSA' AND age_group = '13U-14U');

-- Cal Ripken (Babe Ruth League youth division — Pitch Smart aligned bands)
INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Cal Ripken', '8U', 50,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Cal Ripken' AND age_group = '8U');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Cal Ripken', '9-10', 75,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 75, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Cal Ripken' AND age_group = '9-10');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Cal Ripken', '11-12', 85,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 85, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Cal Ripken' AND age_group = '11-12');

-- Babe Ruth League (13-15 / 16-18 divisions — Pitch Smart aligned bands)
INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Babe Ruth', '13-15', 95,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 95, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Babe Ruth' AND age_group = '13-15');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Babe Ruth', '16-18', 105,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 105, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Babe Ruth' AND age_group = '16-18');

-- Perfect Game (youth tournament guidance, Pitch Smart aligned)
INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Perfect Game', '9-10', 75,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 75, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Perfect Game' AND age_group = '9-10');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Perfect Game', '11-12', 85,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 85, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Perfect Game' AND age_group = '11-12');

INSERT INTO pitch_count_rules (coach_id, sanctioning_body, age_group, daily_max, thresholds)
SELECT NULL, 'Perfect Game', '13-14', 95,
  '[{"max_pitches": 20, "rest_days": 0}, {"max_pitches": 35, "rest_days": 1}, {"max_pitches": 50, "rest_days": 2}, {"max_pitches": 65, "rest_days": 3}, {"max_pitches": 95, "rest_days": 4}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM pitch_count_rules WHERE coach_id IS NULL AND sanctioning_body = 'Perfect Game' AND age_group = '13-14');
