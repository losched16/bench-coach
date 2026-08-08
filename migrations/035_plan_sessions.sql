-- ============================================================================
-- Migration 035: The plan as a checklist
-- ============================================================================
-- The development plan already writes real sessions — "3 rounds of 8 off the
-- tee at belt height, freeze at contact on the last one of each round". What it
-- could not do is be USED. It arrived as three weeks of prose under three
-- headings, so there was nothing to tick, nothing that knew where you were, and
-- the check-in could only see that something was logged, never which session.
--
-- Two changes, both small.
--
-- 1. THE PLAN GAINS A STRUCTURED HALF
--
-- prescriptions.development_plan is JSONB and already holds { markdown, weeks,
-- generated_at, drill_ids }. It now also holds `sessions`: an ordered list of
-- { key, title, minutes, week, blocks: [{ minutes, what, cue }] }.
--
-- The prose stays. "How to tell it's working" and "when it goes sideways" are
-- the most useful paragraphs in the plan and do not belong in a checklist —
-- only the week sections become structured.
--
-- No schema change is needed for that: JSONB already accepts it. It is written
-- down here so the shape has one documented home.
--
-- 2. WHICH SESSIONS ACTUALLY RAN
--
-- A row per session completed. Deliberately NOT a boolean on the plan JSON:
-- when a session ran is the question the check-in asks three weeks later, and
-- a flag cannot answer it. It also survives the plan being rewritten, because
-- the work happened whether or not the plan it came from still exists.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_session_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id  UUID REFERENCES prescriptions(id) ON DELETE CASCADE NOT NULL,
  coach_id         UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,

  -- Stable within a plan: 'w1s2' is week one, session two. Not an index into
  -- an array, because regenerating a plan must not silently re-point what was
  -- already ticked.
  session_key      TEXT NOT NULL,
  -- Carried so the log still reads correctly after a rewrite.
  session_title    TEXT,

  completed_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Whoever ticked it. A contributor running a session is a normal thing.
  completed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  minutes          INT,
  note             TEXT,

  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- One tick per session per day. A double-tap corrects rather than inflating
  -- adherence — the same lesson as the quick-log in migration 025, where an
  -- inflated count flipped the check-in's verdict.
  UNIQUE (prescription_id, session_key, completed_on)
);

CREATE INDEX IF NOT EXISTS idx_plan_session_log_prescription
  ON plan_session_log(prescription_id, completed_on DESC);

ALTER TABLE plan_session_log ENABLE ROW LEVEL SECURITY;

-- Same shape as everything else hanging off a prescription, and the same
-- record/decide split as migration 034: running a session and ticking it off is
-- a RECORD of what happened, so a contributor may do it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_read_plan_session_log') THEN
    CREATE POLICY "bc_read_plan_session_log" ON plan_session_log FOR SELECT
      USING (bc_coach_at_least(coach_id, 'viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_ins_plan_session_log') THEN
    CREATE POLICY "bc_ins_plan_session_log" ON plan_session_log FOR INSERT
      WITH CHECK (bc_coach_at_least(coach_id, 'contributor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bc_del_plan_session_log') THEN
    CREATE POLICY "bc_del_plan_session_log" ON plan_session_log FOR DELETE
      USING (bc_coach_at_least(coach_id, 'contributor'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   -- What has actually been run, per priority
--   SELECT p.focus_area, p.priority, l.session_title, l.completed_on
--   FROM plan_session_log l
--   JOIN prescriptions p ON p.id = l.prescription_id
--   ORDER BY l.completed_on DESC;
--
--   -- Adherence: sessions ticked vs sessions in the plan
--   SELECT p.id, p.focus_area,
--          jsonb_array_length(COALESCE(p.development_plan->'sessions', '[]'::jsonb)) AS planned,
--          count(l.id) AS done
--   FROM prescriptions p
--   LEFT JOIN plan_session_log l ON l.prescription_id = p.id
--   WHERE p.development_plan IS NOT NULL
--   GROUP BY p.id, p.focus_area;
