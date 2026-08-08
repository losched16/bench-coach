-- ============================================================================
-- Migration 036: a plan is a progression, not a pile of drills
-- ============================================================================
-- The library already knows how to progress. drill_resources has
-- progression_level (1 = groove the movement, 2 = repeat it under load,
-- 3 = game speed), reps_guidance, frequency_guidance and success_markers,
-- curated by hand in 004 and 008. /api/prescribe already sorts the selected
-- drills by it, and /api/prescribe/drills even says so out loud:
--
--     -- Preserve prescribed order — it is a progression, not a set.
--
-- and then the plan screen rendered them as four equal numbered cards with a
-- video each. Every fact needed to say "do this one until he can do X, THEN
-- move to the next" was on hand and thrown away at the last step.
--
-- This adds the two things that were genuinely missing: somewhere to keep the
-- steps once they are worked out, and somewhere to record which step the
-- player is actually on.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE prescriptions
  -- The staged plan: [{ n, title, why, drillIds[], moveOnWhen[] }].
  --
  -- Derived, not authored — lib/progression.ts rebuilds it from the drills
  -- whenever it is missing, so every plan ever issued stages correctly with no
  -- backfill. Stored anyway because the drills behind a plan can be swapped
  -- later, and a coach who has already been told "step 2 is front toss" should
  -- not find the steps quietly renumbered underneath them.
  ADD COLUMN IF NOT EXISTS plan_steps JSONB,

  -- Which step the player is on. 1-based.
  --
  -- Advanced by the parent, never by a clock. The whole reason the countdown
  -- came out of this product is that a kid is ready when he is ready, and the
  -- person watching him is the one who knows.
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 1,

  -- When they last moved up, so a check-in can say "he has been on step 1 for
  -- three weeks" — which is a real signal about the read, the same way two
  -- drill swaps are.
  ADD COLUMN IF NOT EXISTS step_advanced_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Compilation videos
-- ---------------------------------------------------------------------------
-- A fair amount of the library is anchored to videos that cover several drills
-- at once — "10 Best Baseball Throwing Drills for Kids" is one row. Sending a
-- parent to minute 0 of a twelve-minute compilation and telling them it is a
-- drill is how a plan starts feeling like a pile of general YouTube links.
--
-- With a start offset the embed opens on the drill in question. Null means
-- "start at the beginning", which is right for the single-drill videos.
ALTER TABLE drill_resources
  ADD COLUMN IF NOT EXISTS youtube_start_seconds INT
  CHECK (youtube_start_seconds IS NULL OR youtube_start_seconds >= 0);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 4 rows: current_step, plan_steps, step_advanced_at (prescriptions)
-- and youtube_start_seconds (drill_resources).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'prescriptions'
       AND column_name IN ('plan_steps', 'current_step', 'step_advanced_at'))
   OR (table_name = 'drill_resources'
       AND column_name = 'youtube_start_seconds')
ORDER BY table_name, column_name;

-- How much of the library can actually carry a progression today. A drill with
-- no progression_level still gets placed (lib/progression.ts falls back to
-- difficulty_level), but one with no success_markers gives the parent no gate
-- to judge readiness by — that is the curation backlog, in one number.
SELECT
  count(*)                                                        AS drills,
  count(*) FILTER (WHERE progression_level IS NOT NULL)            AS has_progression_level,
  count(*) FILTER (WHERE array_length(success_markers, 1) > 0)     AS has_success_marker,
  count(*) FILTER (WHERE reps_guidance IS NOT NULL)                AS has_dose
FROM drill_resources
WHERE status = 'approved' OR status IS NULL;
