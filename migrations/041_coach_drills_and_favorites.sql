-- ============================================================================
-- Migration 041: a coach's own drills, and the ones they keep coming back to
-- ============================================================================
-- Two things a coach with any experience wants immediately, and neither
-- existed.
--
-- FAVOURITES. The library is ~150 drills. A coach uses maybe twelve. Right now
-- there is no way to say which twelve, so every practice plan and every drill
-- swap starts from the whole pile, and the drills they trust are no easier to
-- reach than the ones they have never run.
--
-- THEIR OWN DRILLS. Every coach who has been doing this a while has a station
-- they invented, or one they learned from someone, that is not on YouTube and
-- never will be. Today there is nowhere to put it: the library is a fixed
-- catalogue, so their best drill is the one thing the app cannot help them
-- run.
--
-- The scoping rule that matters
-- -----------------------------
-- Coach drills live in drill_resources alongside the curated ones, so
-- everything that already reads drills — practice plans, the prescription
-- engine, swap, chat — picks them up with no change to how it selects.
--
-- The cost of that is a filter every read path now has to apply, and getting
-- it wrong means one coach's drills appear in another coach's library. That is
-- the same line the scouting data sits behind: nothing a coach records is
-- pooled across accounts. lib/drills.ts owns the filter and
-- scripts/verify-drill-scope.mjs fails the build if a read path skips it,
-- because "remember to add the filter" is not a control.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Whose drill is this
-- ---------------------------------------------------------------------------
ALTER TABLE drill_resources
  -- NULL means the curated library: visible to everyone, editable by nobody
  -- through the app. Set means one coach wrote it, and only they ever see it.
  ADD COLUMN IF NOT EXISTS created_by_coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE;

-- Every library read filters on this, so it is worth an index even though most
-- rows are NULL.
CREATE INDEX IF NOT EXISTS idx_drill_resources_created_by
  ON drill_resources (created_by_coach_id);

-- ---------------------------------------------------------------------------
-- 2. Favorites
-- ---------------------------------------------------------------------------
-- Keyed on the coach, not the team. "Drills I trust" travels with the person —
-- a coach running a 10U team and their own kid's workouts does not want two
-- separate sets of favorites, and the ones they love do not stop being loved
-- when the season changes.
CREATE TABLE IF NOT EXISTS drill_favorites (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id   UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  drill_id   UUID REFERENCES drill_resources(id) ON DELETE CASCADE NOT NULL,
  -- Why this one. Optional, and the most valuable field here when it is filled
  -- in: "the version where they start on one knee" is the thing a coach will
  -- have forgotten by March.
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coach_id, drill_id)
);

CREATE INDEX IF NOT EXISTS idx_drill_favorites_coach ON drill_favorites (coach_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE drill_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches manage their own drill favorites" ON drill_favorites;
CREATE POLICY "Coaches manage their own drill favorites" ON drill_favorites
  FOR ALL USING (
    coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
  );

-- drill_resources is read through the service role by every API route, so RLS
-- there is not what protects coach drills — lib/drills.ts is. This policy
-- exists for anything reading the table with the anon key (the drill library
-- page does), so a coach browsing sees the curated set plus their own.
ALTER TABLE drill_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Curated drills and your own" ON drill_resources;
CREATE POLICY "Curated drills and your own" ON drill_resources
  FOR SELECT USING (
    created_by_coach_id IS NULL
    OR created_by_coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Coaches write their own drills" ON drill_resources;
CREATE POLICY "Coaches write their own drills" ON drill_resources
  FOR ALL USING (
    created_by_coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect the column, the table, and three policies.
SELECT 'column' AS kind, column_name AS name FROM information_schema.columns
WHERE table_name = 'drill_resources' AND column_name = 'created_by_coach_id'
UNION ALL
SELECT 'table', table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'drill_favorites'
UNION ALL
SELECT 'policy', policyname FROM pg_policies
WHERE tablename IN ('drill_favorites', 'drill_resources')
ORDER BY kind, name;

-- The library, split by who owns it. curated should match what you started
-- with; coach_written grows as people add their own.
SELECT
  count(*) FILTER (WHERE created_by_coach_id IS NULL)     AS curated,
  count(*) FILTER (WHERE created_by_coach_id IS NOT NULL) AS coach_written
FROM drill_resources;
