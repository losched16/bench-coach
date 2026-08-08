-- ============================================================================
-- Migration 029: House rules a coach states once, mid-game
-- ============================================================================
-- The dugout assistant knows the three rulesets the app enforces. It does not
-- know that this tournament allows a courtesy runner for the catcher without
-- counting as a substitution, or that this league lets a starter re-enter
-- twice. A coach types that once and expects it to hold for the rest of the
-- game — and to be respected the next time they ask a question.
--
-- Free text on purpose. The alternative is a settings screen enumerating every
-- quirk in youth baseball, which nobody would fill in and which would still
-- miss the one that matters on Saturday.
--
-- These do NOT silently relax the engine. The buttons keep enforcing the
-- selected ruleset, and the assistant is told to say when a house rule and the
-- ruleset disagree, so the coach either changes the setting or overrides
-- knowingly. A rule the assistant honours and the button refuses is the worst
-- possible outcome.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS house_rules TEXT;

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT game_date, opponent, sub_rules, house_rules
--   FROM games WHERE house_rules IS NOT NULL ORDER BY game_date DESC;
