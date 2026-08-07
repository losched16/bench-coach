-- ============================================================================
-- Migration 015: Priorities get a focus area, and run in parallel
-- ============================================================================
-- A player works pitching, hitting, fielding and agility in the same week.
-- Build 3 modelled a single active priority per player, which is wrong for how
-- anyone actually trains. The real constraint is narrower: don't stack several
-- corrections on the SAME motion, because when it doesn't move you can't tell
-- which cue failed.
--
-- So: one active priority per focus area, each with its own three-week window,
-- its own success criteria, and its own check-in. A new priority in an area
-- that already has one supersedes it; a new priority in a different area just
-- runs alongside.
--
-- focus_area is nullable on purpose. Priorities issued before this migration
-- have no area, and the app treats those as "General" rather than hiding them.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS focus_area TEXT
  CHECK (focus_area IS NULL OR focus_area IN (
    'hitting', 'pitching', 'throwing', 'fielding', 'catching', 'baserunning', 'athleticism'
  ));

-- Backfill from the taxonomy for anything already issued against a known
-- problem. The mapping mirrors lib/focusAreas.ts — the library's categories
-- are more granular than the unit a coach plans a week around ("Soft Toss" is
-- a drill format, not something you work on for three weeks).
UPDATE prescriptions p
SET focus_area = CASE lower(t.skill_category)
    WHEN 'hitting'              THEN 'hitting'
    WHEN 'bunting'              THEN 'hitting'
    WHEN 'soft toss'            THEN 'hitting'
    WHEN 'pitching'             THEN 'pitching'
    WHEN 'arm care'             THEN 'pitching'
    WHEN 'throwing'             THEN 'throwing'
    WHEN 'fielding'             THEN 'fielding'
    WHEN 'fielding (infield)'   THEN 'fielding'
    WHEN 'fielding (fly balls)' THEN 'fielding'
    WHEN 'team defense'         THEN 'fielding'
    WHEN 'catching'             THEN 'catching'
    WHEN 'baserunning'          THEN 'baserunning'
    WHEN 'athletic development' THEN 'athleticism'
    WHEN 'warmup'               THEN 'athleticism'
    ELSE NULL
  END
FROM problem_taxonomy t
WHERE p.problem_id = t.slug
  AND p.focus_area IS NULL;

-- The dashboard and check-in both read "active priorities for this subject",
-- now several at a time.
CREATE INDEX IF NOT EXISTS idx_prescriptions_active_area
  ON prescriptions(coach_id, status, focus_area);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
-- What's running, by area:
--   SELECT focus_area, count(*) FROM prescriptions
--   WHERE status = 'active' GROUP BY focus_area ORDER BY count(*) DESC;
--
-- Anything unclassified (issued before this migration, or from a goal that
-- didn't match a catalogued problem) shows as NULL and renders as "General":
--   SELECT id, focus_area, left(priority, 60) FROM prescriptions
--   WHERE status = 'active' AND focus_area IS NULL;
