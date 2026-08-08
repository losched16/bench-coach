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
