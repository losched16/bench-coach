-- ============================================================================
-- 061 — Roster archive
-- ============================================================================
--
-- A player leaves the roster without their record leaving the team.
--
-- "Remove" on the roster deleted the roster row and, when the child was on no
-- other team, the player row — and with it every note, measurement, report and
-- priority the coach had recorded. That is the wrong default for the ordinary
-- case: a kid who ages out, moves away, or sits out a season and comes back.
--
-- Archiving moves the roster row here. Everything keyed on (player_id,
-- team_id) — player_notes, player_reports, player_metrics, prescriptions,
-- observations, entries — is untouched and still readable from the player's
-- page. Because the row is gone from team_players, lineups, practice plans,
-- CoachAI context and the log stop offering the player with no code of their
-- own. A separate table rather than a flag on team_players for exactly that
-- reason: the safe behaviour is the one nobody has to remember to filter for.
--
-- `roster` is the team_players row and its position eligibility as JSON, so a
-- restore puts the player back with the ratings and positions they had.
--
-- Paste-ready for the Supabase SQL editor. Additive, idempotent, no data
-- written. Requires migration 034 (bc_team_at_least) for the policies.
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_player_archive (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id      UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by  UUID REFERENCES coaches(id) ON DELETE SET NULL,
  -- The coach's own words: "moved to 10U", "family relocated". Optional.
  reason       TEXT,
  -- The roster row as it was: positions, the six 1–5 ratings, focus notes,
  -- locked/excluded positions, innings bounds, position eligibility.
  roster       JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (team_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_team_player_archive_team
  ON team_player_archive (team_id, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_player_archive_player
  ON team_player_archive (player_id);

-- ----------------------------------------------------------------------------
-- RLS: the same shape as team_players. Anyone on the team may see who was
-- archived; taking a player off the roster or putting them back is a
-- decision, so admin and owner only.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bc_team_at_least') THEN
    RAISE NOTICE 'bc_team_at_least() not found — run migration 034 first, then re-run this file to install the roster-archive policies.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE team_player_archive ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Members read roster archive" ON team_player_archive';
  EXECUTE $p$
    CREATE POLICY "Members read roster archive" ON team_player_archive
      FOR SELECT USING (bc_team_at_least(team_id, 'viewer'))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins archive players" ON team_player_archive';
  EXECUTE $p$
    CREATE POLICY "Admins archive players" ON team_player_archive
      FOR INSERT WITH CHECK (bc_team_at_least(team_id, 'admin'))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins edit roster archive" ON team_player_archive';
  EXECUTE $p$
    CREATE POLICY "Admins edit roster archive" ON team_player_archive
      FOR UPDATE USING (bc_team_at_least(team_id, 'admin'))
      WITH CHECK (bc_team_at_least(team_id, 'admin'))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins restore players" ON team_player_archive';
  EXECUTE $p$
    CREATE POLICY "Admins restore players" ON team_player_archive
      FOR DELETE USING (bc_team_at_least(team_id, 'admin'))
  $p$;
END $$;

-- ----------------------------------------------------------------------------
-- Check
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'team_player_archive') AS archive_columns,   -- expect 7
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'team_player_archive') AS archive_policies,   -- expect 4
  (SELECT count(*) FROM team_player_archive) AS archived_players;    -- expect 0 on first run
