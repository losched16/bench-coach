-- ============================================================================
-- Migration 073: the speed benchmarks, as metric_types presets
-- ============================================================================
-- The Speed & Agility pathway needs four objective measurements: 10-yard
-- sprint, 20-yard sprint, home-to-first, and standing broad jump.
--
-- NO NEW MEASUREMENT TABLE IS ADDED, AND NONE IS NEEDED.
--
-- migration 019 already built exactly this: metric_types (a curated, coach-
-- extensible vocabulary) plus player_metrics (every reading, with a date, a
-- coach and a note). It already carries the one column that makes speed data
-- readable —
--
--     direction: 'higher' = bigger is better (exit velo)
--                'lower'  = smaller is better (home to first, pop time)
--
-- — and 019's own header says why: "home-to-first improving means the number
-- goes DOWN, and every trend read is backwards without it." A bespoke speed
-- table would have had to rediscover that, and lib/metrics.ts's rule that no
-- trend line is drawn under three sessions, and PlayerMetrics.tsx's chart.
--
-- home_to_first is ALREADY a seeded preset. This adds the three that are not.
--
-- WHY NOT ON CONFLICT
--
-- 019 upserts its presets with ON CONFLICT (coach_id, slug). That arbiter is
-- the UNIQUE (coach_id, slug) index, and for a system preset coach_id is NULL —
-- which Postgres treats as distinct from every other NULL, so the conflict
-- clause never fires and a second run would silently duplicate all eight rows.
-- Production has one of each today, so 019 has only ever been applied once.
-- This file does not inherit the hazard: it guards on NOT EXISTS, which is
-- correct whether or not the index can arbitrate.
--
-- Additive and idempotent. No existing row is modified.
-- ============================================================================

INSERT INTO public.metric_types (coach_id, slug, label, unit, shape, direction, hint, sort_order)
SELECT v.coach_id, v.slug, v.label, v.unit, v.shape, v.direction, v.hint, v.sort_order
FROM (VALUES
  -- Sort order slots between home_to_first (40) and sixty (50), so the running
  -- measurements read together in the picker.
  (NULL::uuid, 'sprint_10y', '10 yard sprint', 'sec', 'measurement', 'lower',
   'Standing start, same surface every time. Measures the first steps, which is what baseball actually asks for. Lower is better.', 41),
  (NULL::uuid, 'sprint_20y', '20 yard sprint', 'sec', 'measurement', 'lower',
   'Standing start. Long enough to show acceleration holding up, short enough to stay a speed test rather than conditioning. Lower is better.', 42),
  -- Not a time, and the only one of the four where bigger is better. Inches
  -- rather than centimetres because that is what a youth coach's tape reads.
  (NULL::uuid, 'broad_jump', 'Standing broad jump', 'in', 'measurement', 'higher',
   'Two feet, no run-up, measured to the back of the heels. Stands in for lower-body power. Higher is better.', 43)
) AS v(coach_id, slug, label, unit, shape, direction, hint, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.metric_types m
  WHERE m.coach_id IS NULL AND m.slug = v.slug
);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect all four speed benchmarks present exactly once, and the three sprint
-- measures reading 'lower' while the jump reads 'higher'. A direction that is
-- wrong here makes every improvement render as a regression on the player page.
SELECT
  slug, label, unit, direction,
  count(*) OVER (PARTITION BY slug) AS copies
FROM public.metric_types
WHERE coach_id IS NULL
  AND slug IN ('sprint_10y', 'sprint_20y', 'home_to_first', 'broad_jump')
ORDER BY sort_order;
