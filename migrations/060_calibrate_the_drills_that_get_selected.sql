-- ============================================================================
-- 060 — Calibrate the drills the live scenarios actually select
-- ============================================================================
--
-- 059 calibrated 22 drills chosen by category: Throwing, Arm Care, Infield —
-- the set I reasoned a "game tomorrow, keep it light" practice would pick from.
--
-- Then I ran validate-live-retrieval against the calibrated library, and it
-- said, of the same scenario it had flagged before:
--
--   throwing : 0 high of 4 blocks · 4 have NO throwing_load at all
--              *** the signal did not participate — this outcome is
--                  under-determined
--
-- Unchanged. 059 closed nothing.
--
-- WHY THE FIRST BATCH MISSED
--
-- The reasoning was backwards. A practice told to keep throwing light does not
-- schedule throwing drills — that is the whole point of the constraint. It
-- schedules TEE WORK. So the drills whose load decides that scenario are
-- hitting drills, and calibrating the throwing library left every one of them
-- NULL. The blocks came back with no high-throwing work for the same reason
-- they always had: they were hitting drills chosen by category, and the
-- constraint never had a value to act on.
--
-- Right answer, wrong question. "Where would the signal change a decision" was
-- the correct criterion; I answered it by reasoning about categories when the
-- validator could simply be asked. These eleven drills are the ones it reported
-- selecting while still printing `throw=?`.
--
-- WHAT THIS CLOSES
--
-- A tee drill has throwing_load 'none' — not NULL, not 'low'. The difference
-- matters: NULL means nobody looked, and the practice that avoided throwing did
-- so by luck. 'none' is a claim, and a game-tomorrow plan built entirely from
-- 'none' blocks is a plan that can be shown to honour the constraint rather
-- than one that happens to.
--
-- Same for the infield drills: three of them appear in the 9U infield practice
-- and all three occupy an adult, which is what lets the coach count finally
-- bear on a real plan.
--
-- Keyed on id and name together, as 059.
-- ============================================================================

BEGIN;

WITH calibration(id, drill_name, min_coaches, throwing_load) AS (VALUES
  -- ── Hitting: a bat, a tee, and no ball ever thrown. ─────────────────────
  -- These decide the game-tomorrow scenario. 'none' is the value that makes
  -- the outcome provable instead of coincidental.
  ('4148cfe0-4a27-4abc-a754-dcd5f2544f0e'::uuid, 'Shoulder Swings — Stay Short to the Ball',     0, 'none'),
  ('252404f0-38c3-481f-a18b-f7ce0262903f'::uuid, 'Stance & Athletic Position Drill',             0, 'none'),
  ('1c406241-97b4-425d-8f16-89ade2dbbc22'::uuid, 'Bucket Drill — Stay in Your Legs',             0, 'none'),
  ('09efef50-4077-4e64-80cc-e7d31a8aaa23'::uuid, 'One-Hand Tee Drill (Bottom Hand)',             0, 'none'),
  ('f35c8a06-d0e9-4a8b-ac8a-efffb204f026'::uuid, 'Stride Pause to Stride Swing Drill',           0, 'none'),
  ('ac27e607-b52e-4865-8240-5a9b7795a410'::uuid, 'The Swing Rail / Stay Inside the Ball Drill',  0, 'none'),
  -- Soft-toss fed: an underhand feed from a partner is not arm load.
  ('6d491e2a-be0d-4c9a-94c4-6d66f6d6bfb8'::uuid, 'The Track and Catch Drill — Head on the Ball', 0, 'none'),

  -- ── Infield: these three carry the 9U infield practice, and each one puts
  --    an adult on the ball. This is what gives the coach count something to
  --    bite on in a real plan rather than only in a unit test. ─────────────
  ('64c760e9-fb4d-449a-ba23-81dd057e0b11'::uuid, '4 High-Energy Infield Drills',            1, 'medium'),
  ('0833de14-902c-408a-a3a9-a8c4df28c4f1'::uuid, 'Cross-Shuffle Drill',                     1, 'low'),
  -- The first baseman receives; the feeder throws. Light for the fielder.
  ('6c2e8d58-e7f0-4727-b561-cb61bca27e25'::uuid, 'First Base Footwork & Throw Adjustments',  1, 'low'),

  -- ── Throwing: a cue drill built around real but instructional throws. ───
  ('50087451-2665-4c78-b968-ca56e9ceec3b'::uuid, 'Point-and-Go Glove Drill — Align Your Body to the Target', 1, 'low')
)
UPDATE public.drill_resources d SET
  min_coaches   = c.min_coaches,
  throwing_load = c.throwing_load,
  updated_at    = NOW()
FROM calibration c
WHERE d.id = c.id
  AND d.drill_name = c.drill_name;

COMMIT;

-- Verification: re-run scripts/validate-live-retrieval.ts. Scenario 4 should
-- report "0 have NO throwing_load at all" and drop the under-determined
-- warning, which is the finding this pair of migrations exists to close.
