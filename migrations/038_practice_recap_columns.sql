-- ============================================================================
-- Migration 038: the practice recap columns that were never created
-- ============================================================================
-- Both ends of this loop have been built for a while and the middle was never
-- there.
--
-- /dashboard/recap writes what_worked, what_didnt_work, player_callouts,
-- energy_level, attendance_count, weather and next_focus. /api/practice-plan
-- reads all of them back and folds them into the next plan under the heading
-- "RECENT PRACTICE RECAPS (use these to make this plan better)".
--
-- practice_sessions has only: id, team_id, practice_plan_id, date, recap_note,
-- created_at. So the insert fails on the first unknown column and the coach
-- gets alert('Failed to save recap'), while the read is wrapped in a try/catch
-- that logs a warning nobody sees:
--
--     console.warn('Could not load practice recaps (table may not have new
--                   columns yet)')
--
-- Which means the thing that makes practice plans compound — each one shaped
-- by how the last one actually went — has never run once. Not a design
-- problem. A missing migration.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE practice_sessions
  -- What landed and what didn't. Free text, entered as a list, because the
  -- useful version of this is "the relay races worked, the bunting station was
  -- chaos" — not a rating out of five.
  ADD COLUMN IF NOT EXISTS what_worked      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS what_didnt_work  TEXT[] NOT NULL DEFAULT '{}',

  -- [{ player_id, player_name, note, type }] where type is
  -- positive | concern | observation.
  --
  -- JSONB rather than a child table on purpose: these are already mirrored
  -- into player_notes on save, which is where a note about one kid belongs and
  -- gets read from. This copy exists so the next plan can see the shape of the
  -- session without joining, and denormalising six rows for that is cheaper in
  -- every sense than a table nothing else references.
  ADD COLUMN IF NOT EXISTS player_callouts  JSONB  NOT NULL DEFAULT '[]'::jsonb,

  -- How the group actually was. A plan built for a team that was flat last
  -- Tuesday should not open with twenty minutes of stationary tee work.
  ADD COLUMN IF NOT EXISTS energy_level     TEXT
    CHECK (energy_level IS NULL OR energy_level IN ('low', 'medium', 'high')),

  -- Load-bearing for plan quality: eleven kids and six kids are different
  -- practices, and the builder currently has no idea which it is writing for.
  ADD COLUMN IF NOT EXISTS attendance_count INT
    CHECK (attendance_count IS NULL OR attendance_count >= 0),

  ADD COLUMN IF NOT EXISTS weather          TEXT,

  -- What the coach said they wanted next. The most direct signal in the whole
  -- recap, and the one the generator should weight hardest.
  ADD COLUMN IF NOT EXISTS next_focus       TEXT[] NOT NULL DEFAULT '{}';

-- The plan generator reads the three most recent recaps for a team, ordered by
-- date. Cheap, and this table grows one row per practice forever.
CREATE INDEX IF NOT EXISTS idx_practice_sessions_team_date
  ON practice_sessions (team_id, date DESC);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 7 rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'practice_sessions'
  AND column_name IN (
    'what_worked', 'what_didnt_work', 'player_callouts',
    'energy_level', 'attendance_count', 'weather', 'next_focus'
  )
ORDER BY column_name;

-- Recaps already saved, if any. Expect 0 the first time — every attempt before
-- this migration failed on the insert, so there is nothing to backfill and
-- nothing was silently half-written.
SELECT
  count(*)                                                      AS recaps,
  count(*) FILTER (WHERE array_length(what_worked, 1) > 0)      AS with_what_worked,
  count(*) FILTER (WHERE array_length(next_focus, 1) > 0)       AS with_next_focus,
  count(*) FILTER (WHERE attendance_count IS NOT NULL)          AS with_attendance
FROM practice_sessions;
