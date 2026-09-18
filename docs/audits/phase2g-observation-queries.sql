-- Phase 2G — what to watch once pathways are live.
--
-- Run against production. Read-only. Every query is over public.user_events,
-- which lib/tracking.ts writes to via /api/track.
--
-- BEFORE READING ANY NUMBER FROM THESE, KNOW WHAT THEY CANNOT SEE
--
--   * lib/tracking.ts drops the event when there is no signed-in user, so this
--     is signed-in coaches only. There is no anonymous funnel here.
--   * It is fire-and-forget and swallows failures — a phone with no signal at
--     a field loses the event silently. Every count below is a FLOOR.
--   * A practice that was generated is not a practice that was run. Nothing
--     here knows whether anyone took it to a field.
--
-- Do not reconcile these against anything that must balance.

-- ─────────────────────────────────────────────────────────────────────────────
-- Q1. What share of practice generations use a pathway?
--
-- The headline number. Needs `practice_generated`, which fires on EVERY
-- generation and carries used_pathway — pathway_practice_generated alone has no
-- denominator. First builds only: a refine is the same practice again.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  date_trunc('week', created_at)::date            AS week,
  count(*)                                        AS generations,
  count(*) FILTER (WHERE (metadata->>'used_pathway')::boolean) AS with_pathway,
  round(100.0 * count(*) FILTER (WHERE (metadata->>'used_pathway')::boolean)
        / nullif(count(*), 0), 1)                 AS pct_with_pathway
FROM public.user_events
WHERE event_name = 'practice_generated'
  AND coalesce((metadata->>'is_refine')::boolean, false) = false
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q2. Of coaches who generate from one stage, how many later generate from a
--     DIFFERENT stage of the SAME pathway?
--
-- The strongest available signal that a coach values the SEQUENCE rather than
-- treating a pathway as a convenient filter. A coach who returns to stage 5
-- after stage 4 is using it as a progression. A coach who generates from
-- stage 1 four times is using it as a saved search.
--
-- Deliberately not "advancement": it counts any second distinct stage, forward
-- or back, because going back to a regression is also using the sequence.
-- ─────────────────────────────────────────────────────────────────────────────
WITH per_coach_pathway AS (
  SELECT
    user_id,
    metadata->>'pathway_slug'                      AS pathway_slug,
    count(DISTINCT metadata->>'stage_number')      AS distinct_stages,
    count(*)                                       AS generations,
    min(created_at)                                AS first_seen,
    max(created_at)                                AS last_seen
  FROM public.user_events
  WHERE event_name = 'pathway_practice_generated'
    AND metadata->>'pathway_slug' IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  count(*)                                              AS coach_pathway_pairs,
  count(*) FILTER (WHERE distinct_stages > 1)           AS used_more_than_one_stage,
  round(100.0 * count(*) FILTER (WHERE distinct_stages > 1)
        / nullif(count(*), 0), 1)                       AS pct_using_the_sequence,
  round(avg(distinct_stages), 2)                        AS avg_distinct_stages,
  round(avg(generations), 2)                            AS avg_generations
FROM per_coach_pathway;

-- Same question, one row per coach+pathway, for looking at the actual
-- behaviour rather than the average of it.
WITH per_coach_pathway AS (
  SELECT
    user_id,
    metadata->>'pathway_slug'                 AS pathway_slug,
    array_agg(DISTINCT (metadata->>'stage_number')::int ORDER BY (metadata->>'stage_number')::int) AS stages,
    count(*)                                  AS generations,
    max(created_at) - min(created_at)         AS span
  FROM public.user_events
  WHERE event_name = 'pathway_practice_generated'
    AND metadata->>'pathway_slug' IS NOT NULL
  GROUP BY 1, 2
)
SELECT pathway_slug, stages, array_length(stages, 1) AS distinct_stages,
       generations, span
FROM per_coach_pathway
ORDER BY distinct_stages DESC, generations DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q3. The funnel: does seeing the picker lead to using it?
--
-- Where coaches fall out is more useful than the final conversion. A big drop
-- between opened and selected means the picker is not compelling or not
-- legible; a big drop between selected and generated means the stage content
-- is not convincing once they read it.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT event_name, count(*) AS events, count(DISTINCT user_id) AS coaches
FROM public.user_events
WHERE event_name IN (
  'pathway_picker_opened', 'pathway_selected', 'pathway_stage_selected',
  'pathway_cleared', 'pathway_practice_generated',
  'pathway_load_retried', 'pathway_stage_load_retried'
)
GROUP BY 1 ORDER BY coaches DESC, events DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q4. Which pathways, and which stages?
--
-- Watch for two things. A pathway nobody picks may be badly named rather than
-- unwanted. And if almost every generation is stage 1, coaches are accepting
-- the default rather than choosing — which would mean the stage navigator is
-- not doing its job, not that stage 1 is where everyone is.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  metadata->>'pathway_slug'                  AS pathway,
  (metadata->>'stage_number')::int           AS stage,
  metadata->>'stage_key'                     AS stage_key,
  (metadata->>'stage_drill_count')::int      AS drills_in_stage,
  count(*)                                   AS generations,
  count(DISTINCT user_id)                    AS coaches
FROM public.user_events
WHERE event_name = 'pathway_practice_generated'
GROUP BY 1, 2, 3, 4
ORDER BY generations DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q5. Do focused stages get avoided?
--
-- 14 of the 70 stages carry the "Focused stage" label. If coaches pick them at
-- a materially lower rate than their 20% share of stages, the label is reading
-- as a warning rather than as information, and the wording should change.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  CASE WHEN (metadata->>'stage_drill_count')::int < 3
       THEN 'focused (1-2 drills)' ELSE 'full (3+ drills)' END AS stage_kind,
  count(*) AS generations,
  round(100.0 * count(*) / nullif(sum(count(*)) OVER (), 0), 1) AS pct
FROM public.user_events
WHERE event_name = 'pathway_practice_generated'
  AND metadata->>'stage_drill_count' IS NOT NULL
GROUP BY 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q6. Is anything failing?
--
-- Retries mean the pathway load is failing for real coaches. Should be zero.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT event_name, count(*), max(created_at) AS most_recent
FROM public.user_events
WHERE event_name IN ('pathway_load_retried', 'pathway_stage_load_retried')
GROUP BY 1;
