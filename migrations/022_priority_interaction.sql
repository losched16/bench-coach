-- ============================================================================
-- Migration 022: Interacting with a priority you're already running
-- ============================================================================
-- Until now a priority was write-once. You got one, and three weeks later you
-- were asked whether it moved. In between there was nothing to do with it —
-- you couldn't see the drills it prescribed, swap them when they weren't
-- landing, or say "the problem has changed" without waiting for the clock.
--
-- Two things get recorded here, and the second one matters more than it looks.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE prescriptions
  -- A coach asking for different drills is evidence about the READ, not about
  -- the drills. Once is "that one needed a net we don't have". Twice, with
  -- work being logged and nothing moving, usually means the cause we named was
  -- wrong — and the check-in should be willing to say so rather than
  -- prescribing a third set of drills for a problem that isn't there.
  ADD COLUMN IF NOT EXISTS drill_swaps INT NOT NULL DEFAULT 0,
  -- Drills already tried and set aside, so a swap never returns them.
  ADD COLUMN IF NOT EXISTS retired_drill_ids UUID[] NOT NULL DEFAULT '{}';

-- A check-in can now be asked for rather than waited for, and when it is, the
-- coach usually types why. Keeping that against the read it produced is what
-- makes the history readable later: "we changed course here, and this is what
-- they saw that made us."
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS coach_update TEXT;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT id, focus_area, status, drill_swaps,
--          array_length(drill_ids, 1)         AS drills_now,
--          array_length(retired_drill_ids, 1) AS drills_retired
--   FROM prescriptions
--   WHERE status = 'active'
--   ORDER BY drill_swaps DESC;
