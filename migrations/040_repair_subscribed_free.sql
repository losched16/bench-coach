-- ============================================================================
-- Migration 040: repair subscribers that 024 wrote down as free
-- ============================================================================
-- Migration 024 introduced subscription_tier and backfilled it in two steps:
--
--     UPDATE coaches SET subscription_tier = 'team'
--     WHERE subscription_tier IN ('pro', 'Pro', 'PRO');
--
--     UPDATE coaches SET subscription_tier = 'free'
--     WHERE subscription_tier IS NULL
--        OR subscription_tier NOT IN ('free', 'personal', 'team');
--
-- The column was created in that same migration, so every existing row was
-- NULL when the first UPDATE ran. It only rescued rows the Stripe webhook had
-- already stamped 'pro'. Anyone who was subscribed WITHOUT that stamp — an
-- account granted access by hand, or one where is_subscribed was set before
-- the webhook wrote a tier — fell through to the second UPDATE and became
-- 'free'.
--
-- 024 read is_subscribed nowhere. It should have: is_subscribed = true meant
-- "paying under the single-plan regime", which included everything.
--
-- The symptom is not an error anywhere. tierOf() maps 'free' to a config with
-- teamFeatures: false, so Staff, the lineup builder, scouting and practice
-- plans quietly leave the menu, and their routes answer 402. The coach sees a
-- smaller product and no explanation.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- Look first. Every row here is someone who is paying and being treated as
-- lapsed.
SELECT
  c.id,
  u.email,
  c.subscription_tier,
  c.is_subscribed,
  c.stripe_customer_id
FROM coaches c
LEFT JOIN auth.users u ON u.id = c.user_id
WHERE c.is_subscribed = TRUE
  AND c.subscription_tier = 'free'
ORDER BY u.email;

-- ---------------------------------------------------------------------------
-- The repair
-- ---------------------------------------------------------------------------
-- is_subscribed = true with tier 'free' is a contradiction the app cannot
-- produce on its own:
--
--   * checkout writes  { is_subscribed: true,  subscription_tier: tier || 'personal' }
--   * cancellation writes { is_subscribed: false, subscription_tier: 'free' }
--
-- so the two never legitimately disagree. Every row matching this is a 024
-- casualty, and 'team' is what they had before 024 ran.
--
-- One exception worth naming rather than hiding: the subscription-updated
-- handler leaves the tier alone when an active subscription is on a price it
-- cannot map (STRIPE_PRICE_PERSONAL / STRIPE_PRICE_TEAM unset). A Personal
-- buyer in that state would be upgraded to Coach here. That errs in the
-- customer's favour, which is the same call checkWorkspaceLimit already makes
-- — getting billing wrong the other way costs the customer, not us. If the
-- SELECT above returns anyone you did not expect, fix them by hand instead of
-- running this.
UPDATE coaches
SET subscription_tier = 'team'
WHERE is_subscribed = TRUE
  AND subscription_tier = 'free';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect subscribed_but_free = 0.
SELECT
  count(*)                                                                 AS coaches,
  count(*) FILTER (WHERE is_subscribed AND subscription_tier = 'team')     AS coach_plan,
  count(*) FILTER (WHERE is_subscribed AND subscription_tier = 'personal') AS personal_plan,
  count(*) FILTER (WHERE is_subscribed AND subscription_tier = 'free')     AS subscribed_but_free,
  count(*) FILTER (WHERE NOT is_subscribed)                                AS not_subscribed
FROM coaches;
