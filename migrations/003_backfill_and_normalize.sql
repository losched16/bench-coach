-- ============================================================================
-- Migration 003: Backfill drill_problem_map + normalize skill_category
-- ============================================================================
-- Run AFTER 001 and 002. Safe to re-run (idempotent).
--
-- What it does:
--   1. Normalizes the duplicate skill_category values found in the audit so
--      sequencing/grouping isn't fragmented.
--   2. Auto-populates drill_problem_map by matching each drill's existing
--      common_flaws_fixed / mechanic_focus / tags against the taxonomy aliases.
--      These rows are marked curated = FALSE — a human (or AI pass) should
--      review and promote them, and fill the ~35 drills that have no flaws yet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Normalize skill_category (merge "X - Y" duplicates into "X (Y)")
-- ----------------------------------------------------------------------------
UPDATE drill_resources SET skill_category = 'Fielding (Infield)'   WHERE skill_category = 'Fielding - Infield';
UPDATE drill_resources SET skill_category = 'Fielding (Fly Balls)' WHERE skill_category = 'Fielding - Fly Balls';

-- ----------------------------------------------------------------------------
-- 2. Auto-map drills → problems via alias match (case-insensitive, exact term)
-- ----------------------------------------------------------------------------
INSERT INTO drill_problem_map (drill_id, problem_slug, curated)
SELECT DISTINCT d.id, p.slug, FALSE
FROM drill_resources d
JOIN problem_taxonomy p ON EXISTS (
  SELECT 1
  FROM unnest(
         coalesce(d.common_flaws_fixed, '{}') ||
         coalesce(d.mechanic_focus,     '{}') ||
         coalesce(d.tags,               '{}')
       ) AS term
  WHERE lower(trim(term)) = ANY (
          SELECT lower(trim(a)) FROM unnest(p.aliases) AS a
        )
)
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Report — review these after running
-- ----------------------------------------------------------------------------
-- Mappings created per problem:
--   SELECT p.slug, p.label, count(m.drill_id) AS drills
--   FROM problem_taxonomy p LEFT JOIN drill_problem_map m ON m.problem_slug = p.slug
--   GROUP BY p.slug, p.label ORDER BY drills;
--
-- Drills still mapped to NO problem (need manual/AI tagging):
--   SELECT d.id, d.drill_name, d.skill_category
--   FROM drill_resources d LEFT JOIN drill_problem_map m ON m.drill_id = d.id
--   WHERE m.drill_id IS NULL ORDER BY d.skill_category, d.drill_name;
--
-- NOTE: reps_guidance, frequency_guidance, est_duration_minutes, success_markers,
-- and progression_level (74% null) are NOT backfilled here — they need real
-- coaching input. Recommend an AI-assisted pass modeled on
-- scripts/enrich-playbooks.js as the next data step.
