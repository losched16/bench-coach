-- ============================================================================
-- Migration 017: A standing read on each opponent
-- ============================================================================
-- Scouting captures fine and then makes the coach do the synthesis. Four box
-- scores, two recaps and a note is a pile of paper, not a scouting report —
-- what a coach actually wants before a game is one page that says how this
-- team plays and what to do about it.
--
-- So the analysis is a stored artifact per opponent, rewritten whenever new
-- evidence lands. Stored rather than generated on demand because a coach opens
-- this in a dugout on tournament wifi, and because keeping the previous
-- version lets us show what CHANGED since last time — which is more useful
-- than the analysis itself once you've played someone twice.
--
-- Hard boundaries carried over from the scouting module and enforced in the
-- prompt, not just here:
--   - never pooled across accounts; this is one coach's own observations
--   - performance and availability only, no characterization of a child
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS opponent_analyses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id          UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  opponent_team_id  UUID REFERENCES opponent_teams(id) ON DELETE CASCADE NOT NULL,

  markdown          TEXT NOT NULL,
  -- One-line answer to "what beats them", for list views and chat
  headline          TEXT,
  -- What's new since the previous analysis. Null on the first one.
  whats_changed     TEXT,

  -- What this read was built from, so a stale analysis is visibly stale
  entry_count       INT NOT NULL DEFAULT 0,
  player_count      INT NOT NULL DEFAULT 0,
  latest_entry_on   DATE,
  -- Total plate appearances behind it. Under ~15 and nothing here is a
  -- tendency; the prompt is told to say so rather than implying otherwise.
  total_pa          INT NOT NULL DEFAULT 0,

  generated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Only one analysis is current per opponent; older rows are the history that
-- makes "what changed" possible, so they are kept rather than overwritten.
CREATE INDEX IF NOT EXISTS idx_opponent_analyses_current
  ON opponent_analyses(opponent_team_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_opponent_analyses_coach
  ON opponent_analyses(coach_id);

ALTER TABLE opponent_analyses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own opponent analyses') THEN
    CREATE POLICY "Coaches can manage own opponent analyses" ON opponent_analyses FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Marks an opponent whose evidence has moved on since the last analysis, so
-- the UI can offer a refresh instead of quietly serving a stale read.
ALTER TABLE opponent_teams
  ADD COLUMN IF NOT EXISTS analysis_stale BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION mark_opponent_analysis_stale()
RETURNS TRIGGER AS $$
DECLARE
  v_opponent UUID;
BEGIN
  v_opponent := COALESCE(NEW.opponent_team_id, OLD.opponent_team_id);
  IF v_opponent IS NOT NULL THEN
    UPDATE opponent_teams SET analysis_stale = TRUE WHERE id = v_opponent;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_scouting_entry_marks_stale ON scouting_entries;
CREATE TRIGGER trg_scouting_entry_marks_stale
  AFTER INSERT OR UPDATE OR DELETE ON scouting_entries
  FOR EACH ROW EXECUTE FUNCTION mark_opponent_analysis_stale();

-- Appearances arrive attached to a scouting entry, but also from the pitch
-- counter, which has no entry. Catch those too via the player's team.
CREATE OR REPLACE FUNCTION mark_opponent_analysis_stale_by_player()
RETURNS TRIGGER AS $$
DECLARE
  v_opponent UUID;
BEGIN
  SELECT opponent_team_id INTO v_opponent
  FROM opponent_players
  WHERE id = COALESCE(NEW.opponent_player_id, OLD.opponent_player_id);

  IF v_opponent IS NOT NULL THEN
    UPDATE opponent_teams SET analysis_stale = TRUE WHERE id = v_opponent;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_appearance_marks_stale ON opponent_appearances;
CREATE TRIGGER trg_appearance_marks_stale
  AFTER INSERT OR UPDATE OR DELETE ON opponent_appearances
  FOR EACH ROW EXECUTE FUNCTION mark_opponent_analysis_stale_by_player();

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT t.name, t.analysis_stale, a.generated_at, left(a.headline, 60)
--   FROM opponent_teams t
--   LEFT JOIN LATERAL (
--     SELECT * FROM opponent_analyses WHERE opponent_team_id = t.id
--     ORDER BY generated_at DESC LIMIT 1
--   ) a ON true
--   ORDER BY t.last_seen DESC NULLS LAST;
