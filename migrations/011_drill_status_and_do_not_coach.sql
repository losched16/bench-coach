-- ============================================================================
-- Migration 011: Drill review status + do-not-coach taxonomy (Build 0)
-- ============================================================================
-- Platform Scope v2, Build 0. Two concerns:
--
-- 1. REVIEW GATING. The 43 drills added by the library expansion (migration
--    008) carry AI-written coaching text that was sourced without watching
--    the videos. Until a human review pass approves them, they are marked
--    pending_review and every read path filters them out (app change ships
--    with this migration). The original hand-curated library stays approved
--    and visible. To approve reviewed drills, flip status to 'approved'.
--
-- 2. DO-NOT-COACH. Some flagged "problems" are developmentally normal at
--    young ages. Telling a parent "that's normal at 7, leave it alone" is a
--    product feature. problem_taxonomy gains do_not_coach_flag/note and
--    age_relevance so the prescription engine can return reassurance
--    instead of a drill plan.
--
-- Additive and idempotent. Run BEFORE deploying the app change that filters
-- drills by status (the filter errors if the column doesn't exist).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Review status columns on drill_resources
-- ----------------------------------------------------------------------------
ALTER TABLE drill_resources
  ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS source          TEXT,
  ADD COLUMN IF NOT EXISTS url_verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drill_resources_status_check'
  ) THEN
    ALTER TABLE drill_resources
      ADD CONSTRAINT drill_resources_status_check
      CHECK (status IN ('approved', 'pending_review', 'rejected'));
  END IF;
END $$;

-- Existing rows default to approved (the original curated library)
UPDATE drill_resources SET status = 'approved' WHERE status IS NULL;

-- The 43 expansion drills (migration 008) go to pending_review until a human
-- has spot-checked their coaching text against the videos. Keyed by video id,
-- the expansion's dedupe key. Idempotent: only demotes rows never verified.
UPDATE drill_resources
SET status = 'pending_review',
    source = COALESCE(source, 'ai_expansion_008')
WHERE youtube_video_id IN (
  'JDRg2nvAwqU',
  'Z1erh6UVR_w',
  'yJxiRn88Ms0',
  'eQCF2jZiU5M',
  'n8OCrOmbTBU',
  'RmlsQPV4OGs',
  'h_mEnVPL6Qg',
  'e_q6AWdgabQ',
  'wMZkEfiFBxc',
  'JVwDSgbUfBM',
  'SXfbP6x3iXI',
  'iZK-Rtp1bv4',
  'Yle6R1-flA8',
  'YipF1W7BDJM',
  'wIU9NdCBBkE',
  'TJXQiYdueQc',
  'OEYEvKRh2eQ',
  'cV8Ivq0XcJA',
  'OAbBekHAk_g',
  '95B1kSchurQ',
  'R1sbhgRzneQ',
  'QR2QWQTHp-s',
  'IEk4QipiFTY',
  'Elzjz_qhLM4',
  'F0MwVYtimb8',
  'x5oEDLlVpqo',
  '5q3b9m2ERho',
  'iUdI35veg5E',
  'RJRjtqWjNnQ',
  '9CzbPIQfXmM',
  'Ji0QzOJe3hE',
  '0Phvj-iyLcc',
  '8_6Ea45fL5s',
  'oCq8NblqfQE',
  'pn3xtpCc8uM',
  'OhWNIpPlcgA',
  '_yEr3pFHQUA',
  'Oz1oGdb0n-8',
  'pIx9tM4NKrU',
  'SR8atnQMvg4',
  'yrgUzW0UK40',
  'slqo583qoAg',
  'EunHAooYktE'
)
AND url_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_drill_resources_status ON drill_resources(status);

-- ----------------------------------------------------------------------------
-- 2. Do-not-coach columns on problem_taxonomy
-- ----------------------------------------------------------------------------
ALTER TABLE problem_taxonomy
  ADD COLUMN IF NOT EXISTS do_not_coach_flag BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS do_not_coach_note TEXT,
  ADD COLUMN IF NOT EXISTS age_relevance     TEXT[] DEFAULT '{}';

-- Seeds: problems that are developmentally normal at younger ages.
-- age_relevance lists the ages where coaching the problem IS appropriate;
-- below that range the engine returns do_not_coach_note instead of drills.

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{9U,10U,11U,12U,13U+}',
  do_not_coach_note = 'Catching with one hand is developmentally normal through age 7-8 — glove control follows hand strength, and forcing two-hand catches early mostly teaches stabbing at the ball. Keep playing catch; it resolves on its own.'
WHERE slug = 'one-hand-catching';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{8U,9U,10U,11U,12U,13U+}',
  do_not_coach_note = 'Whiffs and inconsistent contact ARE the developmental stage at 6-7. The fix is volume, not corrections — lots of swings off a tee and front toss, zero mechanical talk.'
WHERE slug = 'inconsistent-contact';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{10U,11U,12U,13U+}',
  do_not_coach_note = 'A two-strike approach is premature before ~9-10. Young hitters are still building one swing; asking them to manage counts splits their attention and usually makes the swing worse. Let them swing.'
WHERE slug = 'two-strike-approach';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{9U,10U,11U,12U,13U+}',
  do_not_coach_note = 'A slightly uphill swing path is correct, not a flaw. At 7-8, chasing a "level swing" often creates chopping. Only address an extreme uppercut where the head drops and contact collapses.'
WHERE slug = 'uppercutting';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{9U,10U,11U,12U,13U+}',
  do_not_coach_note = 'A lower natural arm slot at 6-8 usually reflects strength, not mechanics. Forcing "over the top" this young can hurt more than help. Build arm strength with catch play and revisit at 9+.'
WHERE slug = 'low-arm-slot';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{10U,11U,12U,13U+}',
  do_not_coach_note = 'Base stealing is not a coachable problem before the league permits leads/steals (typically 9-10U). Before then, work general speed and base-running awareness instead.'
WHERE slug = 'base-stealing';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{10U,11U,12U,13U+}',
  do_not_coach_note = 'A changeup is unnecessary before ~10U. At 7-9 the whole job is throwing fastball strikes with sound mechanics. Adding pitches early splits limited practice reps and helps nothing.'
WHERE slug = 'no-changeup';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{10U,11U,12U,13U+}',
  do_not_coach_note = 'Pitch recognition against off-speed is not trainable at 7-8 — and almost nobody throws off-speed at that age. If it shows up occasionally, it is noise, not a flaw.'
WHERE slug = 'cant-hit-offspeed';

UPDATE problem_taxonomy SET
  do_not_coach_flag = TRUE,
  age_relevance = '{9U,10U,11U,12U,13U+}',
  do_not_coach_note = 'Sliding is rarely needed (and often not allowed) before 8U-9U. Teaching it early risks scraped-up kids and bad habits. Wait until the league requires it, then teach it in one session on grass.'
WHERE slug = 'cant-slide';

-- ----------------------------------------------------------------------------
-- 3. Review queries
-- ----------------------------------------------------------------------------
-- Visible vs gated drills after this migration:
--   SELECT status, count(*) FROM drill_resources GROUP BY status;
-- Do-not-coach coverage:
--   SELECT slug, age_relevance FROM problem_taxonomy WHERE do_not_coach_flag;
