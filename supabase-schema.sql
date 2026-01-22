-- Bench Coach Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Coaches table
CREATE TABLE coaches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Coach preferences (global, persistent)
CREATE TABLE coach_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coach_id, key)
);

-- Seasons (Spring 2026, Summer 2026, etc.)
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  league_type TEXT CHECK (league_type IN ('rec', 'travel', 'clinic', 'other')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams (season-specific rosters)
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE NOT NULL,
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  age_group TEXT, -- 6U, 7U, 8U, 9U, 10U, 11U, 12U, 13U+
  skill_level TEXT CHECK (skill_level IN ('beginner', 'mixed', 'advanced')),
  practice_duration_minutes INT,
  practice_days JSONB, -- ["Mon", "Wed"]
  primary_goals JSONB, -- ["throwing", "catching", "hitting"]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players (persistent identity across seasons)
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  jersey_number TEXT,
  birth_year INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player traits (persistent personality/behavior notes)
CREATE TABLE player_traits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team players (season-specific snapshot)
CREATE TABLE team_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  positions JSONB, -- ["SS", "2B", "OF"]
  hitting_level INT CHECK (hitting_level BETWEEN 1 AND 5),
  throwing_level INT CHECK (throwing_level BETWEEN 1 AND 5),
  fielding_level INT CHECK (fielding_level BETWEEN 1 AND 5),
  focus_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, player_id)
);

-- Team notes (season-scoped)
CREATE TABLE team_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  note TEXT NOT NULL,
  pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player notes (season-scoped)
CREATE TABLE player_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practice plans
CREATE TABLE practice_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INT,
  focus JSONB, -- ["throwing accuracy", "attention"]
  content JSONB, -- structured drill blocks
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practice sessions (optional - track what actually happened)
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  practice_plan_id UUID REFERENCES practice_plans(id) ON DELETE SET NULL,
  date DATE,
  recap_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat threads
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES chat_threads(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  memory_suggestions JSONB, -- AI memory write-back suggestions
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team memory summaries (rolling summary of key facts)
CREATE TABLE team_memory_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) Policies
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memory_summaries ENABLE ROW LEVEL SECURITY;

-- Coaches policies
CREATE POLICY "Users can view own coach profile"
  ON coaches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coach profile"
  ON coaches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own coach profile"
  ON coaches FOR UPDATE
  USING (auth.uid() = user_id);

-- Coach preferences policies
CREATE POLICY "Coaches can view own preferences"
  ON coach_preferences FOR SELECT
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can insert own preferences"
  ON coach_preferences FOR INSERT
  WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can update own preferences"
  ON coach_preferences FOR UPDATE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can delete own preferences"
  ON coach_preferences FOR DELETE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

-- Seasons policies
CREATE POLICY "Coaches can view own seasons"
  ON seasons FOR SELECT
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can insert own seasons"
  ON seasons FOR INSERT
  WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can update own seasons"
  ON seasons FOR UPDATE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can delete own seasons"
  ON seasons FOR DELETE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

-- Teams policies
CREATE POLICY "Coaches can view own teams"
  ON teams FOR SELECT
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can insert own teams"
  ON teams FOR INSERT
  WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can update own teams"
  ON teams FOR UPDATE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can delete own teams"
  ON teams FOR DELETE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

-- Players policies
CREATE POLICY "Coaches can view own players"
  ON players FOR SELECT
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can insert own players"
  ON players FOR INSERT
  WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can update own players"
  ON players FOR UPDATE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

CREATE POLICY "Coaches can delete own players"
  ON players FOR DELETE
  USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));

-- Apply similar policies for all other tables
-- (Player traits, team players, notes, practice plans, chat, etc.)
-- For brevity, the pattern is: coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())

CREATE POLICY "Coaches can manage player traits" ON player_traits FOR ALL
  USING (player_id IN (SELECT id FROM players WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage team players" ON team_players FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage team notes" ON team_notes FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage player notes" ON player_notes FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage practice plans" ON practice_plans FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage practice sessions" ON practice_sessions FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage chat threads" ON chat_threads FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

CREATE POLICY "Coaches can manage chat messages" ON chat_messages FOR ALL
  USING (thread_id IN (SELECT id FROM chat_threads WHERE team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()))));

CREATE POLICY "Coaches can manage team memory" ON team_memory_summaries FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())));

-- Indexes for performance
CREATE INDEX idx_coaches_user_id ON coaches(user_id);
CREATE INDEX idx_seasons_coach_id ON seasons(coach_id);
CREATE INDEX idx_teams_season_id ON teams(season_id);
CREATE INDEX idx_teams_coach_id ON teams(coach_id);
CREATE INDEX idx_players_coach_id ON players(coach_id);
CREATE INDEX idx_team_players_team_id ON team_players(team_id);
CREATE INDEX idx_team_players_player_id ON team_players(player_id);
CREATE INDEX idx_chat_threads_team_id ON chat_threads(team_id);
CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX idx_team_notes_team_id ON team_notes(team_id);
CREATE INDEX idx_player_notes_team_id ON player_notes(team_id);
CREATE INDEX idx_player_notes_player_id ON player_notes(player_id);
CREATE INDEX idx_practice_plans_team_id ON practice_plans(team_id);
