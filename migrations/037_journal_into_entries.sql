-- ============================================================================
-- Migration 037: fold the Development Journal into the activity log
-- ============================================================================
-- There were two places to record a lesson.
--
-- player_journal_entries came first: a per-player tab with session date, type,
-- instructor, focus areas, what went well, what needs work, home drills, notes
-- and media. Then migration 012 built `entries` + `observations` as "the
-- unified activity log: everything the user records is an entry, whatever its
-- type" — and the journal was left alone because it worked and it was full of
-- real data.
--
-- The cost of leaving it showed up later. A lesson logged in the journal is
-- NOT the same to the engine as a lesson logged in Log an Entry: only the
-- latter produces an observation with prompt_key 'instructor_diagnosis', which
-- is the one note the diagnosis engine adopts rather than argues with. Two
-- doors to the same room, and one of them quietly leads somewhere worse.
--
-- This moves every journal row into entries + observations and marks it
-- migrated. Nothing is deleted: player_journal_entries keeps its rows, and
-- entries.legacy_journal_id records where each one came from, so this is
-- reversible and re-runnable.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provenance
-- ---------------------------------------------------------------------------
-- The unique index is what makes a second run a no-op rather than a duplicate
-- history. Partial, because every entry created normally has a NULL here and
-- a plain UNIQUE would allow only one of them.
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS legacy_journal_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS entries_legacy_journal_id_key
  ON entries (legacy_journal_id) WHERE legacy_journal_id IS NOT NULL;

-- Read by lib/coachContext.ts, which keeps rendering un-migrated journal rows
-- so a database that has not run this migration still gives the model the
-- player's lesson history. Once a row is migrated it must stop being read from
-- here, or every lesson reaches the model twice.
ALTER TABLE player_journal_entries
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. The entries
-- ---------------------------------------------------------------------------
-- Session type mapping. 'camp' and 'other' have no equivalent in the entries
-- CHECK constraint and both land on 'practice' — a camp is a coached practice
-- someone paid for, and 'other' was almost always a practice too. The original
-- word is not lost: it goes into the title, which is what the coach reads.
INSERT INTO entries (
  coach_id, player_id, team_id, entry_type, occurred_on, title,
  instructor_name, duration_min, image_urls, legacy_journal_id, created_at
)
SELECT
  j.coach_id,
  j.player_id,
  j.team_id,
  CASE j.session_type
    WHEN 'lesson'   THEN 'lesson'
    WHEN 'practice' THEN 'practice'
    WHEN 'game'     THEN 'game'
    WHEN 'backyard' THEN 'home_session'
    ELSE 'practice'
  END,
  j.session_date,
  -- e.g. "Camp/Clinic — Hitting, Fielding". The skills array has nowhere else
  -- to go and reads well here.
  CASE j.session_type
    WHEN 'lesson'   THEN 'Private Lesson'
    WHEN 'practice' THEN 'Team Practice'
    WHEN 'game'     THEN 'Game'
    WHEN 'backyard' THEN 'Backyard Training'
    WHEN 'camp'     THEN 'Camp/Clinic'
    ELSE 'Session'
  END
  || CASE
       WHEN j.skills IS NOT NULL AND array_length(j.skills, 1) > 0
       THEN ' — ' || array_to_string(j.skills, ', ')
       ELSE ''
     END,
  j.instructor_name,
  j.duration_minutes,
  -- Journal media and log screenshots already share the 'journal-media'
  -- bucket and both store storage paths, so this is a straight lift. Videos
  -- come across too; image_urls is a path list, not an image-only list.
  COALESCE(
    (SELECT array_agg(m ->> 'path') FROM jsonb_array_elements(
       CASE jsonb_typeof(j.media) WHEN 'array' THEN j.media ELSE '[]'::jsonb END
     ) AS m WHERE m ->> 'path' IS NOT NULL),
    '{}'
  ),
  j.id,
  j.created_at
FROM player_journal_entries j
WHERE j.migrated_at IS NULL
  AND j.coach_id IS NOT NULL
ON CONFLICT (legacy_journal_id) WHERE legacy_journal_id IS NOT NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The observations
-- ---------------------------------------------------------------------------
-- Each free-text field becomes one observation, keyed so the engine can weight
-- it the same way it weights notes typed into Log an Entry.
--
-- The load-bearing row is the first one. On a lesson with a named instructor,
-- "what needs work" IS the instructor's diagnosis — that is what the field
-- meant on that form — so it maps to 'instructor_diagnosis' and inherits the
-- weight the engine gives a paid professional who watched in person. Without a
-- named instructor it is the parent's own read, and it stays 'needs_work'.
INSERT INTO observations (coach_id, player_id, team_id, entry_id, prompt_key, body, observed_on, created_at)
SELECT e.coach_id, e.player_id, e.team_id, e.id, k.prompt_key, k.body, e.occurred_on, e.created_at
FROM entries e
JOIN player_journal_entries j ON j.id = e.legacy_journal_id
CROSS JOIN LATERAL (
  VALUES
    (CASE WHEN j.session_type = 'lesson' AND j.instructor_name IS NOT NULL
          THEN 'instructor_diagnosis' ELSE 'needs_work' END, j.needs_work),
    ('worked_on',   j.focus_areas),
    ('went_well',   j.went_well),
    ('home_drills', j.home_drills),
    ('notes',       j.notes)
) AS k(prompt_key, body)
WHERE e.legacy_journal_id IS NOT NULL
  AND k.body IS NOT NULL
  AND btrim(k.body) <> ''
  -- Safe to re-run: an observation already carried across is not carried twice.
  AND NOT EXISTS (
    SELECT 1 FROM observations o
    WHERE o.entry_id = e.id AND o.prompt_key = k.prompt_key
  );

-- ---------------------------------------------------------------------------
-- 4. Mark them done
-- ---------------------------------------------------------------------------
UPDATE player_journal_entries j
SET migrated_at = NOW()
WHERE j.migrated_at IS NULL
  AND EXISTS (SELECT 1 FROM entries e WHERE e.legacy_journal_id = j.id);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect migrated = total, and left_behind = 0. A row can only be left behind
-- if it has no coach_id, which should not happen — the form always set one.
SELECT
  count(*)                                            AS journal_rows,
  count(*) FILTER (WHERE migrated_at IS NOT NULL)     AS migrated,
  count(*) FILTER (WHERE migrated_at IS NULL)         AS left_behind
FROM player_journal_entries;

-- What came across, by type. Compare against the journal's own counts.
SELECT entry_type, count(*) AS entries, sum(array_length(image_urls, 1)) AS media_paths
FROM entries
WHERE legacy_journal_id IS NOT NULL
GROUP BY entry_type
ORDER BY entries DESC;

-- The notes, by kind. instructor_diagnosis is the one that changes what the
-- engine does with a lesson.
SELECT o.prompt_key, count(*)
FROM observations o
JOIN entries e ON e.id = o.entry_id
WHERE e.legacy_journal_id IS NOT NULL
GROUP BY o.prompt_key
ORDER BY count(*) DESC;

-- ---------------------------------------------------------------------------
-- Rollback, if it goes wrong
-- ---------------------------------------------------------------------------
-- The journal rows were never touched beyond migrated_at, so undoing this is
-- deleting what was created and clearing the flag:
--
--   DELETE FROM observations WHERE entry_id IN (
--     SELECT id FROM entries WHERE legacy_journal_id IS NOT NULL);
--   DELETE FROM entries WHERE legacy_journal_id IS NOT NULL;
--   UPDATE player_journal_entries SET migrated_at = NULL;
