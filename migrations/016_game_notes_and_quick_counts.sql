-- ============================================================================
-- Migration 016: In-game notes become evidence, and a standalone pitch counter
-- ============================================================================
--
-- PART 1 — game notes reach the loop
--
-- A note tapped out in the third inning ("pulled off the ball on that swing")
-- is the best evidence in the product: the coach saw it, and wrote it down
-- while the memory was intact. coachContext already ranks that class of
-- evidence above the box score — it just never received any of it, because
-- game_notes and observations were separate tables nobody bridged.
--
-- The bridge is a trigger rather than app code because the note is inserted
-- client-side, straight to PostgREST, from more than one place. A trigger
-- catches every path, including ones written later.
--
-- PART 2 — the quick pitch counter
--
-- Counting pitches should not require declaring a game. A coach standing on
-- the fence wants to tap a name and start counting, sometimes for a kid on
-- the other team. Opponent counts feed the availability engine that already
-- exists, so counting the other team's starter today tells you on Saturday
-- whether he can pitch.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: mirror game_notes into observations
-- ----------------------------------------------------------------------------

-- The link back, so deleting a note removes the observation it created rather
-- than leaving a ghost the AI keeps citing.
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS source_game_note_id UUID
  REFERENCES game_notes(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_source_game_note
  ON observations(source_game_note_id)
  WHERE source_game_note_id IS NOT NULL;

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
  ON CONFLICT (source_game_note_id) DO UPDATE
    SET body = EXCLUDED.body,
        prompt_key = EXCLUDED.prompt_key;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_game_notes_to_observation ON game_notes;
CREATE TRIGGER trg_game_notes_to_observation
  AFTER INSERT OR UPDATE OF note, note_type ON game_notes
  FOR EACH ROW EXECUTE FUNCTION game_notes_to_observation();

-- Backfill everything already written. Same shape as the trigger.
INSERT INTO observations (
  coach_id, player_id, team_id, prompt_key, body, observed_on, source_game_note_id
)
SELECT
  t.coach_id,
  n.player_id,
  g.team_id,
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
-- PART 2: standalone pitch counts
-- ----------------------------------------------------------------------------
-- Three kinds of subject, deliberately:
--   roster   — a player on your team
--   opponent — a known opponent player, so the availability engine sees it
--   adhoc    — a name typed on the fence. No identity, no history, still counts.
--
-- adhoc exists because the alternative is a coach abandoning the tool when the
-- kid isn't in any roster yet. A count with a name attached beats no count.

CREATE TABLE IF NOT EXISTS pitch_count_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id            UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  team_id             UUID REFERENCES teams(id) ON DELETE SET NULL,

  subject_type        TEXT NOT NULL DEFAULT 'adhoc'
                      CHECK (subject_type IN ('roster', 'opponent', 'adhoc')),
  team_player_id      UUID REFERENCES team_players(id) ON DELETE SET NULL,
  opponent_player_id  UUID REFERENCES opponent_players(id) ON DELETE SET NULL,
  opponent_team_id    UUID REFERENCES opponent_teams(id) ON DELETE SET NULL,
  -- Always populated, whatever the subject type — this is what the UI shows
  -- and what survives if the linked player is later deleted.
  label               TEXT NOT NULL,

  counted_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  pitches             INT NOT NULL DEFAULT 0 CHECK (pitches >= 0),
  innings             NUMERIC,
  -- Which rule set to read the count against, if the coach picked one
  rule_set_id         UUID REFERENCES pitch_count_rules(id) ON DELETE SET NULL,
  notes               TEXT,
  -- Open counters resume; finished ones stop appearing as "in progress"
  finished_at         TIMESTAMPTZ,
  -- Set once a finished opponent count has been pushed into the scouting
  -- record, so re-finishing doesn't double-count an outing.
  appearance_id       UUID REFERENCES opponent_appearances(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT pitch_count_subject_target CHECK (
    (subject_type = 'roster'   AND team_player_id     IS NOT NULL) OR
    (subject_type = 'opponent' AND opponent_player_id IS NOT NULL) OR
    (subject_type = 'adhoc')
  )
);

CREATE OR REPLACE FUNCTION pitch_count_sessions_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pitch_count_sessions_touch ON pitch_count_sessions;
CREATE TRIGGER trg_pitch_count_sessions_touch
  BEFORE UPDATE ON pitch_count_sessions
  FOR EACH ROW EXECUTE FUNCTION pitch_count_sessions_touch();

ALTER TABLE pitch_count_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own pitch counts') THEN
    CREATE POLICY "Coaches can manage own pitch counts" ON pitch_count_sessions FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pitch_counts_coach    ON pitch_count_sessions(coach_id, counted_on DESC);
CREATE INDEX IF NOT EXISTS idx_pitch_counts_open     ON pitch_count_sessions(coach_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pitch_counts_opponent ON pitch_count_sessions(opponent_player_id);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
-- In-game notes now visible to the AI:
--   SELECT count(*) FROM observations WHERE source_game_note_id IS NOT NULL;
-- Counters still open:
--   SELECT label, pitches, counted_on FROM pitch_count_sessions
--   WHERE finished_at IS NULL ORDER BY updated_at DESC;
