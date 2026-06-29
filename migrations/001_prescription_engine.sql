-- ============================================================================
-- Migration 001: Prescription Engine — schema
-- ============================================================================
-- Adds the metadata a diagnosis-to-prescription engine needs, WITHOUT changing
-- or removing any existing column. The Drill Library page, chat assistant, and
-- practice-plan APIs continue to work unchanged.
--
-- Apply by pasting into the Supabase SQL editor (the project's existing workflow
-- for `drill_resources` / `playbook_templates`). Run 001 → 002 → 003 in order.
--
-- Design note: problem→drill is modeled as a normalized join table
-- (problem_taxonomy + drill_problem_map) rather than a free-text array column.
-- This is the durable option from docs/drill-audit.md §5b: a controlled
-- vocabulary with NL aliases is what lets a plain-English complaint map
-- deterministically to drills. Per-drill *attributes* (reps, duration, success
-- markers, competition level) remain plain columns on drill_resources.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Additive per-drill attribute columns (dosage + success + scope)
-- ----------------------------------------------------------------------------
ALTER TABLE drill_resources
  ADD COLUMN IF NOT EXISTS reps_guidance        TEXT,                 -- e.g. "3 sets x 10 swings"
  ADD COLUMN IF NOT EXISTS frequency_guidance   TEXT,                 -- e.g. "2-3x per week"
  ADD COLUMN IF NOT EXISTS est_duration_minutes INT,                  -- numeric duration for practice-time budgeting
                                                                      --   (the existing `duration` column is 100% NULL/unused)
  ADD COLUMN IF NOT EXISTS success_markers      TEXT[] DEFAULT '{}',  -- "you'll know it's working when…" (measurable)
  ADD COLUMN IF NOT EXISTS competition_level    TEXT   DEFAULT 'both';

-- Constrain competition_level to rec / travel / both (matches seasons.league_type intent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drill_resources_competition_level_check'
  ) THEN
    ALTER TABLE drill_resources
      ADD CONSTRAINT drill_resources_competition_level_check
      CHECK (competition_level IN ('rec', 'travel', 'both'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Controlled problem vocabulary (the keystone for diagnosis matching)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS problem_taxonomy (
  slug           TEXT PRIMARY KEY,             -- 'late-timing'
  label          TEXT NOT NULL,                -- 'Late / poor timing' (coach-facing)
  skill_category TEXT,                         -- 'Hitting' (groups problems in the UI)
  description    TEXT,                          -- optional plain-English explanation
  aliases        TEXT[] DEFAULT '{}',          -- phrases a coach might type + existing flaw strings,
                                                --   used for NL diagnosis matching and the 003 backfill
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Drill ↔ problem mapping (which drills fix which problem)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drill_problem_map (
  drill_id      UUID REFERENCES drill_resources(id) ON DELETE CASCADE,
  problem_slug  TEXT REFERENCES problem_taxonomy(slug) ON DELETE CASCADE,
  -- sequence ordering for a given problem (1 = most foundational). Lets the
  -- engine build a foundational→advanced plan even where progression_level is null.
  sort_order    INT DEFAULT 100,
  curated       BOOLEAN DEFAULT FALSE,          -- TRUE = hand-verified; FALSE = auto-backfilled from flaws
  PRIMARY KEY (drill_id, problem_slug)
);

CREATE INDEX IF NOT EXISTS idx_drill_problem_map_problem ON drill_problem_map(problem_slug);
CREATE INDEX IF NOT EXISTS idx_drill_problem_map_drill   ON drill_problem_map(drill_id);

-- ----------------------------------------------------------------------------
-- 4. RLS — reference data, world-readable (mirrors drill_resources read access)
-- ----------------------------------------------------------------------------
ALTER TABLE problem_taxonomy  ENABLE ROW LEVEL SECURITY;
ALTER TABLE drill_problem_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read problem taxonomy" ON problem_taxonomy;
CREATE POLICY "Anyone can read problem taxonomy"
  ON problem_taxonomy FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read drill problem map" ON drill_problem_map;
CREATE POLICY "Anyone can read drill problem map"
  ON drill_problem_map FOR SELECT USING (true);
-- Writes (seeding/backfill) use the service role, which bypasses RLS.
