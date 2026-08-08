-- ============================================================================
-- Migration 024: Two plans instead of one
-- ============================================================================
-- There was one paid tier, written as 'pro' by the Stripe webhook regardless of
-- what was bought. With two prices that would have handed coach features to
-- everyone who paid for the parent plan, because nothing ever looked at which
-- price the subscription was for.
--
-- Two things get fixed here.
--
-- 1. Existing subscribers move from 'pro' to 'team'. They bought the only plan
--    that existed, which included everything, and quietly downgrading someone
--    who is already paying is not a thing to do to your first customers.
--
-- 2. A "personal player" stops being a string match. Adding a child creates a
--    season literally named 'Personal' plus a team named after the kid — so
--    the only way to tell a parent's workspace from a real roster was
--    comparing season.name to 'Personal'. Hanging billing limits on a name
--    anybody can type is asking for it.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Plans
-- ----------------------------------------------------------------------------
ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT,
  ADD COLUMN IF NOT EXISTS is_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Everyone who already pays keeps everything they already had.
UPDATE coaches
SET subscription_tier = 'team'
WHERE subscription_tier IN ('pro', 'Pro', 'PRO');

-- Anything unset or unrecognised is free. tierOf() in lib/tiers.ts treats an
-- unknown value as free too, so the database and the code agree.
UPDATE coaches
SET subscription_tier = 'free'
WHERE subscription_tier IS NULL
   OR subscription_tier NOT IN ('free', 'personal', 'team');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coaches_subscription_tier_check'
  ) THEN
    ALTER TABLE coaches
      ADD CONSTRAINT coaches_subscription_tier_check
      CHECK (subscription_tier IN ('free', 'personal', 'team'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Personal workspace vs real team
-- ----------------------------------------------------------------------------
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS workspace_kind TEXT NOT NULL DEFAULT 'team'
  CHECK (workspace_kind IN ('personal', 'team'));

-- Backfill from how it has always been distinguished, once, so the string
-- match never has to run again.
UPDATE teams t
SET workspace_kind = 'personal'
FROM seasons s
WHERE s.id = t.season_id
  AND lower(s.name) = 'personal'
  AND t.workspace_kind <> 'personal';

CREATE INDEX IF NOT EXISTS idx_teams_coach_kind ON teams(coach_id, workspace_kind);

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT subscription_tier, is_subscribed, count(*)
--   FROM coaches GROUP BY 1, 2 ORDER BY 3 DESC;
--
--   SELECT c.display_name,
--          count(*) FILTER (WHERE t.workspace_kind = 'team')     AS teams,
--          count(*) FILTER (WHERE t.workspace_kind = 'personal') AS personal_players
--   FROM coaches c LEFT JOIN teams t ON t.coach_id = c.id
--   GROUP BY c.id, c.display_name ORDER BY teams DESC;
