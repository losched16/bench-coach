-- ============================================================================
-- Migration 082: Academy chargeback (dispute) records
-- ============================================================================
-- NOT APPLIED to any database yet. Additive and idempotent. Needs review first.
--
-- One row per Stripe dispute against an Academy payment: what happened, when, and what
-- the Academy did about access. Server-written only (the webhook, with the service
-- role). No client policy exists and no client privilege is granted, so a buyer can
-- never read or change their own dispute record.
--
-- Access is NOT stored here; it stays on academy_enrollments. This table is the audit
-- trail for why access changed (access_action) and the guard against out-of-order
-- Stripe events (status is final once won or lost).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.academy_disputes (
  dispute_id          text PRIMARY KEY,
  enrollment_id       uuid NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
  payment_intent      text NOT NULL,
  status              text NOT NULL CHECK (status IN ('open', 'won', 'lost')),
  reason              text,
  amount              integer,
  currency            text,
  due_by              timestamptz,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  -- What the Academy did to access because of this event: nothing / revoked / restored.
  access_action       text NOT NULL DEFAULT 'none' CHECK (access_action IN ('none', 'kept', 'revoked', 'restored')),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (closed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_academy_disputes_enrollment ON public.academy_disputes (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_academy_disputes_open ON public.academy_disputes (status) WHERE status = 'open';

ALTER TABLE public.academy_disputes ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: with RLS on and no policy, no client role can read or write it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON public.academy_disputes FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON public.academy_disputes FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.academy_disputes TO service_role'; END IF;
END $$;
