-- ============================================================================
-- Build 0 audit — run in the Supabase SQL editor AFTER migration 011.
-- Paste each block and record the results. These answer the mapping-coverage
-- questions the prescription engine depends on.
-- ============================================================================

-- 0. Sanity: status distribution (how many drills are user-visible today)
SELECT status, count(*) AS drills
FROM drill_resources
GROUP BY status
ORDER BY status;

-- 1. ORPHAN DRILLS — zero problem mappings; invisible to the prescription
--    engine (they still show in the browsable library)
SELECT d.drill_name, d.skill_category, d.status
FROM drill_resources d
LEFT JOIN drill_problem_map m ON m.drill_id = d.id
WHERE m.drill_id IS NULL
ORDER BY d.skill_category, d.drill_name;

-- 2. UNDIAGNOSABLE PROBLEMS — zero mapped drills; the engine can name the
--    flaw and offer nothing
SELECT p.slug, p.label, p.skill_category
FROM problem_taxonomy p
LEFT JOIN drill_problem_map m ON m.problem_slug = p.slug
WHERE m.problem_slug IS NULL
ORDER BY p.skill_category, p.slug;

-- 3. THIN PROBLEMS — exactly one mapped drill (no variety, no escalation path)
SELECT p.slug, p.label, count(m.drill_id) AS mapped_drills
FROM problem_taxonomy p
JOIN drill_problem_map m ON m.problem_slug = p.slug
GROUP BY p.slug, p.label
HAVING count(m.drill_id) = 1
ORDER BY p.slug;

-- 4. GATED-ONLY PROBLEMS — problems whose only mapped drills are still
--    pending_review; these become undiagnosable in practice while the
--    status gate is live
SELECT p.slug, p.label,
       count(*) AS total_mapped,
       count(*) FILTER (WHERE d.status = 'approved') AS approved_mapped
FROM problem_taxonomy p
JOIN drill_problem_map m ON m.problem_slug = p.slug
JOIN drill_resources d ON d.id = m.drill_id
GROUP BY p.slug, p.label
HAVING count(*) FILTER (WHERE d.status = 'approved') = 0
ORDER BY p.slug;

-- 5. Do-not-coach coverage after migration 011
SELECT slug, label, age_relevance, left(do_not_coach_note, 60) AS note_preview
FROM problem_taxonomy
WHERE do_not_coach_flag
ORDER BY slug;

-- 6. Approve reviewed expansion drills (run per-drill after human review, or
--    all at once if you accept the batch):
-- UPDATE drill_resources SET status = 'approved'
-- WHERE status = 'pending_review';  -- or: AND id = '<specific id>'
