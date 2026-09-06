-- ============================================================================
-- 053 — Two policies say USING (true), and they defeat every policy beside them
-- ============================================================================
--
-- WHAT IS WRONG
--
-- `game_notes` and `game_pitch_counts` each carry five RLS policies. Four are
-- migration 034's correct ones, keyed on bc_game_at_least(). The fifth is a
-- leftover from before 034:
--
--   CREATE POLICY "Users can manage game notes"
--     ON public.game_notes FOR ALL TO public USING (true);
--   CREATE POLICY "Users can manage pitch counts"
--     ON public.game_pitch_counts FOR ALL TO public USING (true);
--
-- RLS policies are PERMISSIVE by default, which means they are OR-ed. A policy
-- that permits everything therefore makes the four correct ones beside it
-- irrelevant. FOR ALL with a USING and no WITH CHECK also governs INSERT,
-- because PostgreSQL uses USING as the check when WITH CHECK is absent — so
-- this is read, insert, update and delete, by anyone.
--
-- `TO public` includes `anon`, and both tables carry the Supabase default
-- grants: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE to
-- anon and authenticated. The anon key ships in the JavaScript bundle.
--
-- Verified against production on 2026-09-06 with an unauthenticated request,
-- counts only, no data read and nothing written:
--
--   game_notes          HTTP 200, 2 rows
--   game_pitch_counts   HTTP 200, 13 rows
--
-- Pitch counts are child-safety data. Youth baseball pitch limits exist to
-- protect children's arms, and a record anyone can silently alter or delete is
-- worse than one that is merely readable.
--
-- HOW IT GOT HERE, WHICH IS THE PART WORTH REMEMBERING
--
-- Migration 034 introduced the bc_* model and added its policies. Its cleanup
-- block drops only policies whose names start with `bc_`, so it never removed
-- the ones it superseded. 37 tables now carry both models.
--
-- On 35 of them that is harmless and arguably good: the legacy policy is
-- ownership-scoped (`coach_id IN (SELECT ... WHERE coaches.user_id =
-- auth.uid())`), so OR-ing gives "the owner, or a staff member at rank". These
-- two are the only ones whose legacy policy is USING (true), and on those the
-- OR is not additive, it is total.
--
-- I previously described this coexistence as "additive and correct". That was
-- right for 35 tables and wrong for these two, and the difference is the whole
-- finding.
--
-- WHY REPLACE RATHER THAN DROP
--
-- app/dashboard/game/page.tsx reads and writes both tables from the BROWSER,
-- with the user's own token — not the service role. Simply dropping the
-- permissive policy would leave only the bc_* four, making these two tables
-- strictly stricter than game_events, game_participation, game_position_log
-- and game_opponent_lineup sitting next to them, all of which keep an
-- ownership policy OR-ed alongside bc_*.
--
-- So the permissive policy is replaced with the exact predicate those sibling
-- tables already use. A coach who can edit a game's events can still edit its
-- notes and pitch counts; anon can do neither. This changes what `anon` can
-- reach and nothing else.
--
-- Idempotent. Safe to run twice.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- game_notes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage game notes" ON public.game_notes;

CREATE POLICY "Coaches manage own game notes"
  ON public.game_notes FOR ALL TO public
  USING (
    game_id IN (
      SELECT g.id FROM games g
      JOIN teams t ON t.id = g.team_id
      WHERE t.coach_id IN (
        SELECT coaches.id FROM coaches WHERE coaches.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- game_pitch_counts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage pitch counts" ON public.game_pitch_counts;

CREATE POLICY "Coaches manage own pitch counts"
  ON public.game_pitch_counts FOR ALL TO public
  USING (
    game_id IN (
      SELECT g.id FROM games g
      JOIN teams t ON t.id = g.team_id
      WHERE t.coach_id IN (
        SELECT coaches.id FROM coaches WHERE coaches.user_id = auth.uid()
      )
    )
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- 1. No permissive policy remains on either table. Expect zero rows:
--
--    SELECT tablename, policyname, cmd, qual
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('game_notes', 'game_pitch_counts')
--      AND coalesce(qual, '') IN ('true', '(true)');
--
-- 2. Each table still has five policies — four bc_* plus the new ownership one:
--
--    SELECT tablename, count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('game_notes','game_pitch_counts')
--    GROUP BY tablename;
--
-- 3. From outside, with the public anon key. Both previously returned rows and
--    must now return zero:
--
--    curl -s -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
--      "https://<ref>.supabase.co/rest/v1/game_notes?select=*&limit=1"
--    curl -s -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
--      "https://<ref>.supabase.co/rest/v1/game_pitch_counts?select=*&limit=1"
--
--    Expect [] rather than 401 — the grant remains, RLS now filters.
--
-- 4. AND, signed in as a real coach, confirm the game page still loads notes
--    and pitch counts and can still save them. That is the browser path this
--    migration deliberately preserves, and the one test that cannot be skipped.
