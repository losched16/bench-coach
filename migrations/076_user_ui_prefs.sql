-- ============================================================================
-- Migration 076: per-user interface preferences
-- ============================================================================
-- Contextual help has to remember that a coach dismissed it. That is the whole
-- requirement, and it needs one small table.
--
-- WHY NOT coach_preferences, WHICH LOOKS PERFECT
--
-- It is (coach_id, key, value), it has RLS, it has grants. It is also AI
-- MEMORY: app/api/chat/route.ts loads it into the CoachAI prompt as what the
-- coach prefers, and app/dashboard/memory/page.tsx renders it as the AI Memory
-- page. A row saying help.practice.dismissed = true would appear in front of a
-- coach as something the assistant has learned about them.
--
-- Two more reasons, either of which would be enough:
--
--   * it is keyed on coach_id, and lib/authz.ts is explicit that an invited
--     assistant may have no coach row — so the users this feature most needs to
--     guide would silently fail to save a dismissal;
--   * its write policies use bc_coach_at_least(coach_id, 'decide'), which is
--     the capability-name-where-a-role-belongs defect reported in the Phase 2H
--     closeout, and anon holds full grants on it.
--
-- KEYED ON auth.uid(), NOT ON A COACH
--
-- Every signed-in human has a user id; not everyone has a coach row. A
-- preference is about a person and their browser, not about a workspace they
-- may not own.
--
-- WHAT DOES NOT GO IN HERE
--
-- Anything a coach would expect to find in the product. This is for interface
-- state — dismissed cards, a checklist that has been skipped. It is not a
-- general key-value store for domain data, and nothing here is ever shown to a
-- coach as content.
--
-- Additive and idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Namespaced by the caller, e.g. 'help.dismissed.practice-plans' or
  -- 'onboarding.first-practice'. Text rather than an enum so adding a card is
  -- not a migration — this table holds interface state, and the set of
  -- interface state changes every release.
  key        TEXT NOT NULL,

  -- JSONB rather than TEXT because the second thing anyone stores is a shape,
  -- not a string. The onboarding checklist keeps { skipped, startedAt } here.
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, key),

  -- A runaway client cannot fill the table with junk keys or a huge blob.
  CONSTRAINT user_ui_prefs_key_sane CHECK (length(key) BETWEEN 1 AND 120),
  CONSTRAINT user_ui_prefs_value_sane CHECK (length(value::text) <= 4000)
);

COMMENT ON TABLE public.user_ui_prefs IS
  'Interface state per signed-in user: dismissed help, onboarding progress. Never shown to a coach as content, and not AI memory.';

-- ---------------------------------------------------------------------------
-- RLS — your own row and nothing else
-- ---------------------------------------------------------------------------
-- No team, no role, no capability. A preference belongs to one person, so the
-- policy is the simplest true statement: user_id = auth.uid(). This uses the
-- real predicate rather than a bc_* helper precisely because there is no role
-- question to ask here.
ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE NOTICE 'auth.uid() absent — skipping user_ui_prefs policies (plain Postgres).';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='user_ui_prefs' AND policyname='bc_read_own_ui_prefs') THEN
    CREATE POLICY bc_read_own_ui_prefs ON public.user_ui_prefs
      FOR SELECT TO public USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='user_ui_prefs' AND policyname='bc_ins_own_ui_prefs') THEN
    CREATE POLICY bc_ins_own_ui_prefs ON public.user_ui_prefs
      FOR INSERT TO public WITH CHECK (user_id = auth.uid());
  END IF;

  -- USING and WITH CHECK both, so a row cannot be updated to belong to
  -- somebody else.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='user_ui_prefs' AND policyname='bc_upd_own_ui_prefs') THEN
    CREATE POLICY bc_upd_own_ui_prefs ON public.user_ui_prefs
      FOR UPDATE TO public
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='user_ui_prefs' AND policyname='bc_del_own_ui_prefs') THEN
    CREATE POLICY bc_del_own_ui_prefs ON public.user_ui_prefs
      FOR DELETE TO public USING (user_id = auth.uid());
  END IF;
END
$do$;

-- No grant to anon. A signed-out visitor has no preferences to keep, and the
-- blanket anon grants on coach_preferences are part of why this is a new table.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_prefs TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_prefs TO service_role;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='user_ui_prefs')            AS table_present,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='user_ui_prefs')               AS policies,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_name='user_ui_prefs' AND grantee='anon')                   AS anon_grants_expect_zero,
  -- Untouched. Named so a diff is visible rather than assumed.
  (SELECT count(*) FROM public.coach_preferences)                           AS ai_memory_untouched;
