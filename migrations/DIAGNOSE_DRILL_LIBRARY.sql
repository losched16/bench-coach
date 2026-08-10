-- ============================================================================
-- Drill library diagnostic — read-only
-- ============================================================================
-- Answers the library-health questions that cannot be worked out from the
-- repo: status breakdown, the real progression-metadata gap, problem mapping
-- coverage, and video reuse.
--
-- Nothing here writes. Safe to run on production.
--
-- Run BLOCK A first. If BLOCK B errors on an unknown column, that error IS the
-- answer — it names the migration you have not applied yet (036 for
-- youtube_start_seconds, 041 for created_by_coach_id).
--
-- For "which migrations are applied", run CHECK_SCHEMA.sql instead — it
-- already covers 012 through 041.
-- ============================================================================


-- ============================================================================
-- BLOCK A — works on any version of the schema
-- ============================================================================
-- One result set, so the Supabase editor shows all of it. Read it top to
-- bottom; `section` groups the questions.

WITH
approved AS (
  SELECT * FROM drill_resources WHERE status = 'approved' OR status IS NULL
),
mapped AS (
  SELECT DISTINCT drill_id FROM drill_problem_map
),
problem_counts AS (
  SELECT p.slug,
         count(m.drill_id)                                       AS drills,
         count(a.id)                                             AS approved_drills
  FROM problem_taxonomy p
  LEFT JOIN drill_problem_map m ON m.problem_slug = p.slug
  LEFT JOIN approved a          ON a.id = m.drill_id
  GROUP BY p.slug
)
SELECT * FROM (
  -- ---- 2. LIBRARY SIZE -----------------------------------------------------
  SELECT '2. size' AS section, 'total rows' AS metric,
         count(*)::text AS value FROM drill_resources
  UNION ALL SELECT '2. size', 'status = approved',
         count(*)::text FROM drill_resources WHERE status = 'approved'
  UNION ALL SELECT '2. size', 'status IS NULL (also visible)',
         count(*)::text FROM drill_resources WHERE status IS NULL
  UNION ALL SELECT '2. size', 'status = something else (HIDDEN)',
         count(*)::text FROM drill_resources
         WHERE status IS NOT NULL AND status <> 'approved'
  UNION ALL SELECT '2. size', '>> user-visible total',
         count(*)::text FROM approved

  -- ---- 3. PROGRESSION METADATA GAP ----------------------------------------
  UNION ALL SELECT '3. metadata', 'has progression_level',
         count(*)::text FROM approved WHERE progression_level IS NOT NULL
  UNION ALL SELECT '3. metadata', 'has reps_guidance',
         count(*)::text FROM approved WHERE reps_guidance IS NOT NULL
  UNION ALL SELECT '3. metadata', 'has success_markers',
         count(*)::text FROM approved WHERE array_length(success_markers, 1) > 0
  UNION ALL SELECT '3. metadata', 'has frequency_guidance',
         count(*)::text FROM approved WHERE frequency_guidance IS NOT NULL
  UNION ALL SELECT '3. metadata', '>> has ALL THREE (can gate a step)',
         count(*)::text FROM approved
         WHERE progression_level IS NOT NULL
           AND reps_guidance IS NOT NULL
           AND array_length(success_markers, 1) > 0
  UNION ALL SELECT '3. metadata', '>> has NONE of the three',
         count(*)::text FROM approved
         WHERE progression_level IS NULL
           AND reps_guidance IS NULL
           AND coalesce(array_length(success_markers, 1), 0) = 0

  -- The 43-drill bulk load is identifiable by its channel/date; adjust the
  -- cutoff if it is wrong. Splitting on created_at is the only signal in the
  -- table that separates the two eras.
  UNION ALL SELECT '3. by era', 'rows created before 2026-08-01',
         count(*)::text FROM approved WHERE created_at < '2026-08-01'
  UNION ALL SELECT '3. by era', '  ...of those, all three fields',
         count(*)::text FROM approved
         WHERE created_at < '2026-08-01'
           AND progression_level IS NOT NULL
           AND reps_guidance IS NOT NULL
           AND array_length(success_markers, 1) > 0
  UNION ALL SELECT '3. by era', 'rows created on/after 2026-08-01',
         count(*)::text FROM approved WHERE created_at >= '2026-08-01'
  UNION ALL SELECT '3. by era', '  ...of those, all three fields',
         count(*)::text FROM approved
         WHERE created_at >= '2026-08-01'
           AND progression_level IS NOT NULL
           AND reps_guidance IS NOT NULL
           AND array_length(success_markers, 1) > 0

  -- ---- 4. PROBLEM MAPPING --------------------------------------------------
  UNION ALL SELECT '4. mapping', 'problems in taxonomy',
         count(*)::text FROM problem_taxonomy
  UNION ALL SELECT '4. mapping', 'drills with NO problem mapping (orphans)',
         count(*)::text FROM approved a
         WHERE NOT EXISTS (SELECT 1 FROM mapped m WHERE m.drill_id = a.id)
  UNION ALL SELECT '4. mapping', 'problems with ZERO mapped drills',
         count(*)::text FROM problem_counts WHERE drills = 0
  UNION ALL SELECT '4. mapping', 'problems with exactly ONE mapped drill',
         count(*)::text FROM problem_counts WHERE drills = 1
  UNION ALL SELECT '4. mapping', 'problems mapped but ZERO approved drills',
         count(*)::text FROM problem_counts
         WHERE drills > 0 AND approved_drills = 0

  -- ---- 5. VIDEO -------------------------------------------------------------
  UNION ALL SELECT '5. video', 'rows with no video id',
         count(*)::text FROM approved
         WHERE youtube_video_id IS NULL OR youtube_video_id = ''
  UNION ALL SELECT '5. video', 'rows WITH a video id',
         count(*)::text FROM approved
         WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
  UNION ALL SELECT '5. video', 'DISTINCT videos behind them',
         count(DISTINCT youtube_video_id)::text FROM approved
         WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
  UNION ALL SELECT '5. video', '>> rows sharing a video with another row',
         coalesce(sum(n), 0)::text FROM (
           SELECT count(*) AS n FROM approved
           WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
           GROUP BY youtube_video_id HAVING count(*) > 1
         ) s
  UNION ALL SELECT '5. video', '>> most drills on a single video',
         coalesce(max(n), 0)::text FROM (
           SELECT count(*) AS n FROM approved
           WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
           GROUP BY youtube_video_id
         ) s
  UNION ALL SELECT '5. video', 'compilation-shaped titles',
         count(*)::text FROM approved
         WHERE drill_name ~* '^\s*\d+\s|\btop\s+\d+|\bbest\s+\d+|\bdrills?\s+(for|to)\b|\bhow to\b|\bcomplete\b|\bfundamentals\b|\bbasics\b|\bcircuit\b|\broutine\b'
  UNION ALL SELECT '5. video', 'duplicate drill names',
         coalesce(sum(n), 0)::text FROM (
           SELECT count(*) AS n FROM approved GROUP BY lower(drill_name) HAVING count(*) > 1
         ) s
) r
ORDER BY section, metric;


-- ============================================================================
-- BLOCK B — needs migrations 036 and 041
-- ============================================================================
-- An "column does not exist" error here tells you which migration is missing.

SELECT
  count(*) FILTER (WHERE youtube_start_seconds IS NULL
                      OR youtube_start_seconds = 0)          AS video_no_start_offset,
  count(*) FILTER (WHERE youtube_start_seconds > 0)          AS video_has_start_offset,
  count(*) FILTER (WHERE created_by_coach_id IS NULL)        AS curated,
  count(*) FILTER (WHERE created_by_coach_id IS NOT NULL)    AS coach_written
FROM drill_resources
WHERE status = 'approved' OR status IS NULL;


-- ============================================================================
-- BLOCK C — the lists (run each on its own; they return rows, not counts)
-- ============================================================================

-- C1. Every video carrying more than one drill, worst first. This is the list
--     that tells you how much video re-sourcing there actually is.
SELECT youtube_video_id,
       count(*)                        AS drills_on_this_video,
       string_agg(drill_name, ' | ' ORDER BY drill_name) AS drills
FROM drill_resources
WHERE (status = 'approved' OR status IS NULL)
  AND youtube_video_id IS NOT NULL AND youtube_video_id <> ''
GROUP BY youtube_video_id
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- C2. Compilation-shaped titles.
SELECT id, drill_name, skill_category, youtube_video_id
FROM drill_resources
WHERE (status = 'approved' OR status IS NULL)
  AND drill_name ~* '^\s*\d+\s|\btop\s+\d+|\bbest\s+\d+|\bdrills?\s+(for|to)\b|\bhow to\b|\bcomplete\b|\bfundamentals\b|\bbasics\b|\bcircuit\b|\broutine\b'
ORDER BY drill_name;

-- C3. Problems with no usable drill behind them — where the prescription
--     engine has nothing to offer.
SELECT p.slug, p.label, p.skill_category,
       count(m.drill_id)                                        AS mapped,
       count(*) FILTER (WHERE d.status = 'approved' OR d.status IS NULL) AS usable
FROM problem_taxonomy p
LEFT JOIN drill_problem_map m ON m.problem_slug = p.slug
LEFT JOIN drill_resources d   ON d.id = m.drill_id
GROUP BY p.slug, p.label, p.skill_category
HAVING count(*) FILTER (WHERE d.status = 'approved' OR d.status IS NULL) <= 1
ORDER BY usable, p.slug;

-- C4. Approved drills nothing maps to — invisible to the prescription engine
--     even though they are in the library.
SELECT d.id, d.drill_name, d.skill_category
FROM drill_resources d
WHERE (d.status = 'approved' OR d.status IS NULL)
  AND NOT EXISTS (SELECT 1 FROM drill_problem_map m WHERE m.drill_id = d.id)
ORDER BY d.skill_category, d.drill_name;
