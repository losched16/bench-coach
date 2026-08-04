-- ============================================================================
-- Migration 009: Backfill coaching fields on 4 reused drills
-- ============================================================================
-- The library expansion (008) reused 4 pre-existing drills inside curated
-- sequences for new problems, but those drills had NULL reps_guidance /
-- frequency_guidance / success_markers. This fills them so every curated
-- new-problem drill is complete. Additive (fields were NULL); idempotent.
-- Applied live via REST on the same day as 008; recorded here for reproducibility.
-- ============================================================================

UPDATE drill_resources SET
  reps_guidance = '3 sets of 8 bunts (sacrifice + for a hit)',
  frequency_guidance = '2x/week',
  success_markers = ARRAY['Squares up on time, catches the ball with the bat, and consistently deadens it into fair territory.']
WHERE id = '6103f317-ff80-4422-a86a-e83d9e15d80b'; -- How to Bunt - Youth Skills  (cant-bunt)

UPDATE drill_resources SET
  reps_guidance = '2 sets of 8 blocks (straight, left, right)',
  frequency_guidance = '2x/week',
  success_markers = ARRAY['Drops to the knees with chest over the ball, hips back and hands down, and keeps blocked balls in front.']
WHERE id = 'a1914ed5-c1e1-4123-ad4c-66685131199b'; -- Top 5 Blocking Drills for Catchers  (catcher-blocking)

UPDATE drill_resources SET
  reps_guidance = '3 sets of 10 receptions',
  frequency_guidance = '2-3x/week',
  success_markers = ARRAY['Catches and sticks the pitch quietly with no glove drift, stealing the edges of the zone.']
WHERE id = 'fe58cb41-277b-4757-bd46-dc78206d4d45'; -- 3 Simple Framing Drills for Catchers  (catcher-receiving)

UPDATE drill_resources SET
  reps_guidance = '2 sets of 8 fly balls between two outfielders',
  frequency_guidance = '1-2x/week',
  success_markers = ARRAY['One player calls it early and loud, the other peels off - no collisions, nothing drops between them.']
WHERE id = '0c9a28d6-8fcf-4000-82fa-a1216ed45916'; -- Flyball Communication Drill  (outfield-communication)
