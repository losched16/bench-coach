-- ============================================================================
-- Migration 014: Check-ins — closing the loop
-- ============================================================================
-- Platform Scope v2, Build 3.
--
-- Build 1 captured what happened. Build 2 turned it into one priority with
-- success criteria stated in advance. This is the part that makes those worth
-- paying for: three weeks later we go back, compare what we said to watch for
-- against what actually got logged, and say whether it moved.
--
-- A prescription can be checked in more than once (due, then overdue, then
-- again after an extension), so check-ins are their own rows rather than
-- columns on prescriptions. The verdict is a RECOMMENDATION until the coach
-- accepts it — `accepted_at` is what separates "we think this is resolved"
-- from "the coach agreed and we closed it".
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS checkins (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id            UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  prescription_id     UUID REFERENCES prescriptions(id) ON DELETE CASCADE NOT NULL,
  markdown            TEXT,                    -- the written read, as generated
  -- what the check-in recommends. 'active' means "hold, it needs longer" —
  -- an honest and common answer at three weeks, not a failure to decide.
  verdict_status      TEXT CHECK (verdict_status IN ('active', 'resolved', 'stalled', 'abandoned')),
  outcome_note        TEXT,
  next_focus          TEXT,                    -- set when the read says work something else next
  -- adherence as measured at generation time, so a later check-in can show
  -- the trend without recomputing against a moved window
  adherence_logged    INT,
  adherence_expected  INT,
  days_elapsed        INT,
  accepted_at         TIMESTAMPTZ,             -- null until the coach acts on it
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- One notification per prescription per week, enforced here rather than in the
-- cron: the schedule can fire twice (retry, redeploy, manual run) and a coach
-- getting the same "time to check in on Charlie" email twice is worse than
-- getting it late.
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS last_checkin_notified_at TIMESTAMPTZ;

ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaches can manage own checkins') THEN
    CREATE POLICY "Coaches can manage own checkins" ON checkins FOR ALL
      USING (coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_checkins_coach        ON checkins(coach_id);
CREATE INDEX IF NOT EXISTS idx_checkins_prescription ON checkins(prescription_id);
CREATE INDEX IF NOT EXISTS idx_checkins_created      ON checkins(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_notified ON prescriptions(last_checkin_notified_at);

-- ----------------------------------------------------------------------------
-- Review queries
-- ----------------------------------------------------------------------------
-- Prescriptions due for a check-in right now:
--   SELECT id, priority, review_due_at FROM prescriptions
--   WHERE status = 'active' AND review_due_at <= NOW();
-- Check-ins generated but never acted on:
--   SELECT c.created_at, c.verdict_status, p.priority
--   FROM checkins c JOIN prescriptions p ON p.id = c.prescription_id
--   WHERE c.accepted_at IS NULL ORDER BY c.created_at DESC;
-- Outcome distribution — does the loop actually resolve things:
--   SELECT status, count(*) FROM prescriptions GROUP BY status;
