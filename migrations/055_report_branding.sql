-- ============================================================================
-- Migration 055: Player report branding
-- ============================================================================
-- What the top and bottom of a development report say. A coach writing on
-- behalf of Springford Little League does not want a family's copy to open
-- with our name; they want it to open with theirs. So the wordmark, the line
-- beside it and the footer become the coach's to set.
--
-- PER COACH, ON THE COACH'S OWN ROW
--
-- Branding is a letterhead, and a letterhead belongs to the person signing,
-- not to one of their teams. One nullable JSONB column on coaches:
--
--   { "brand_name": "Springford Little League",
--     "header_line": "Player Development Report",
--     "footer_text": "Springford Little League — Player Development" }
--
-- Any key may be null or absent, in which case the report prints the
-- BenchCoach default for that slot. NULL for the whole column means "never
-- set" and prints exactly what reports printed before this migration.
--
-- WHY NOT coach_preferences
--
-- That table looks like the obvious home and is the wrong one: it is CoachAI's
-- memory. The chat route writes remembered facts into it and lib/anthropic.ts
-- reads it back into prompts. A letterhead stored there would appear on the
-- Memory page as something the app "learned", and be fed to a model as
-- coaching context. Branding is configuration, not a fact about the coach.
--
-- FINALIZED REPORTS DO NOT CHANGE
--
-- buildContext() copies the branding into player_reports.context at
-- finalization, next to the team, season and coach names. A coach who
-- rebrands in March does not alter the PDF a family received in September.
--
-- No RLS change: coaches already lets a user read and update their own row
-- and nobody else's, and the API writes through the service role behind
-- guard(request, 'own') — owner only, the same line as staff and billing.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS report_branding JSONB;

COMMENT ON COLUMN coaches.report_branding IS
  'Letterhead for player development reports: { brand_name, header_line, footer_text }. Any slot null prints the BenchCoach default. Snapshotted into player_reports.context at finalization.';

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
--   SELECT id, display_name, report_branding FROM coaches
--   WHERE report_branding IS NOT NULL;
