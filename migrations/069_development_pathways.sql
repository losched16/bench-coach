-- ============================================================================
-- Migration 069: development pathways — what to teach first, next, and later
-- ============================================================================
-- The library knows what every drill IS (Phase 2C wrote instructions for all
-- 154), what each one FIXES (drill_problem_map, 393 rows), and how HARD it is
-- (progression_level). What nothing in the product knows is what ORDER to
-- teach things in.
--
-- WHY THIS IS NOT lib/progression.ts
--
-- That file already stages a plan, and it stages it by difficulty: get the
-- feel, make it stick, take it live. Three stages, identical for every skill in
-- baseball. It is a HOW HARD axis and it is correct at what it does.
--
-- A pathway is a WHAT NEXT axis. "Athletic stance" before "grip" before "load"
-- before "stride" is not a statement about difficulty — it is a statement about
-- what has to exist before the next thing can be taught. The two are
-- orthogonal, and a single pathway stage routinely contains drills from three
-- different difficulty levels.
--
-- The library's own data proves they cannot be conflated:
--
--   Turn and Take It          level 1   is about not fearing the ball, and is
--                                       not step one of building a swing
--   Freeze at Extension       level 3   teaches a finish position that belongs
--                                       early in bat-path work
--   Front Toss                level –   has NO progression_level at all, and is
--                                       the bridge between tee and live pitching
--
-- 62 of the 154 schedulable drills have no progression_level. Ordering a
-- curriculum by that column would place a third of the library arbitrarily.
--
-- WHY CURATED RATHER THAN DERIVED
--
-- lib/progression.ts argues for deriving rather than generating, and it is
-- right for difficulty: the answer is already in a curated column. It lands the
-- other way here. No column in this schema encodes teaching order, and no
-- combination of them can be made to — so the choice is between a human writing
-- the sequence down and a model improvising a curriculum per request. This is
-- the former, versioned, with the reasoning stored beside each decision.
--
-- WHAT THIS IS NOT ALLOWED TO BECOME
--
--   * a second schedulable filter        lib/drills.ts owns that
--   * a second problem→drill map         drill_problem_map owns that
--   * a second difficulty model          lib/progression.ts owns that
--   * a per-player plan                  prescriptions.development_plan is the
--                                        place for that if it is ever needed
--
-- A pathway RECOMMENDS. It never schedules, and it stores no player state.
--
-- Additive and idempotent. Zero rows are modified in any existing table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The pathway — one teachable skill, ordered
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.development_pathways (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,

  -- The coaching area this belongs under, matching lib/focusAreas.FocusArea
  -- ('hitting', 'throwing', 'fielding', ...). NOT drill_resources.skill_category
  -- — that column holds drill FORMATS like 'Soft Toss' and 'Warmup', which are
  -- not things a coach plans a block of work around. Kept as free text rather
  -- than an enum so adding a focus area is not a migration.
  skill_category  TEXT,

  summary         TEXT,
  -- Who this is for, and who it is not for, in a coach's words. The place to
  -- record "this assumes a player who can already catch" rather than encoding
  -- it as a constraint nobody can read.
  applicability   TEXT,

  min_age         INT,
  max_age         INT,

  -- Bumped when the SEQUENCE changes, not when prose is corrected. A coach
  -- part-way through v1 should be able to tell that v2 renumbered the stages.
  version         INT NOT NULL DEFAULT 1,

  -- draft | published | retired. Retired rather than deleted, the same rule the
  -- drill library follows: a pathway referenced by something historical has to
  -- keep resolving.
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'retired')),

  -- Where the sequence came from and who stands behind it. Phase 2C's lesson:
  -- content without provenance cannot be audited later.
  provenance      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT development_pathways_age_order
    CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
);

COMMENT ON TABLE public.development_pathways IS
  'A canonical teaching sequence for one skill. Above drill_resources, below practice_plans. Recommends; never schedules.';

-- ---------------------------------------------------------------------------
-- 2. The stage — one thing being taught, and how you know it landed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.development_pathway_stages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_id              UUID NOT NULL
                          REFERENCES public.development_pathways(id) ON DELETE CASCADE,

  -- 1-based and contiguous within a pathway. The unique constraint is what
  -- makes "stage 4" mean one thing.
  stage_number            INT NOT NULL CHECK (stage_number >= 1),
  -- Stable across renumbering, the same reasoning as plan_session_log's
  -- session_key: 'load-to-launch' survives a stage being inserted before it,
  -- an array index does not.
  stage_key               TEXT NOT NULL,

  name                    TEXT NOT NULL,

  -- What the player should be able to do at the end. One sentence, observable.
  -- This is the field that decides whether a drill belongs — a drill is in the
  -- stage because it teaches or tests THIS, not because its category matches.
  objective               TEXT NOT NULL,
  why_it_matters          TEXT,

  -- The stage that must land first. Usually the previous one; nullable so a
  -- first stage has none, and a FK so it cannot point at nothing.
  prerequisite_stage_id   UUID REFERENCES public.development_pathway_stages(id)
                          ON DELETE SET NULL,

  -- How a coach knows to advance. Not per-drill success_markers — those say
  -- "this rep was good"; this says "this stage is done". Required in practice
  -- for any stage marked READY; enforced by the coverage audit rather than by
  -- a NOT NULL, so a stage can be checked in as a known gap instead of being
  -- filled with something invented.
  mastery_signals         TEXT[] NOT NULL DEFAULT '{}',
  -- What it looks like when it is going wrong, so a coach can tell "not yet"
  -- from "wrong drill".
  common_failure_modes    TEXT[] NOT NULL DEFAULT '{}',
  coaching_emphasis       TEXT,

  -- How long this usually takes, in practices. A range, because it is a range.
  -- Never used as a timer — advancing is a coach's judgement against the
  -- mastery signals, the same position lib/progression.ts takes.
  estimated_practices_min INT,
  estimated_practices_max INT,

  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (pathway_id, stage_number),
  UNIQUE (pathway_id, stage_key),
  CONSTRAINT development_pathway_stages_practice_order
    CHECK (estimated_practices_min IS NULL OR estimated_practices_max IS NULL
           OR estimated_practices_min <= estimated_practices_max),
  -- A stage cannot require itself.
  CONSTRAINT development_pathway_stages_no_self_prerequisite
    CHECK (prerequisite_stage_id IS NULL OR prerequisite_stage_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_pathway_stages_pathway
  ON public.development_pathway_stages(pathway_id, stage_number);

COMMENT ON COLUMN public.development_pathway_stages.objective IS
  'What the player can do at the end. The test for whether a drill belongs in this stage.';

-- ---------------------------------------------------------------------------
-- 3. The stage's drills — several, each doing a different job
-- ---------------------------------------------------------------------------
-- Deliberately many-to-many with a ROLE on the link. A stage needs something to
-- teach with, something to get reps with, something easier for the player who
-- cannot do it yet, and something that proves it transferred. One drill per
-- stage would make the pathway a playlist.
--
-- The role vocabulary is NOT invented here. drill_resources.practice_roles is
-- already curated on 153 of the 154 schedulable rows with almost exactly these
-- words, and nothing in the product sequences with it. This reuses that
-- vocabulary so a stage's roles and a drill's own roles are speaking the same
-- language.
CREATE TABLE IF NOT EXISTS public.development_pathway_stage_drills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id    UUID NOT NULL
              REFERENCES public.development_pathway_stages(id) ON DELETE CASCADE,

  -- ON DELETE RESTRICT, not CASCADE. The drill library retires rows, it does
  -- not delete them (four phases of curation have held that line), so a DELETE
  -- reaching here means something has gone wrong and should fail loudly rather
  -- than silently emptying a stage.
  drill_id    UUID NOT NULL
              REFERENCES public.drill_resources(id) ON DELETE RESTRICT,

  role        TEXT NOT NULL CHECK (role IN (
                'primary',          -- teach the objective
                'regression',       -- the easier version, for a player not there yet
                'reinforcement',    -- reps once it is understood
                'progression',      -- the harder version, once it holds
                'assessment',       -- proves the mastery signal
                'game_application'  -- does it survive a game
              )),

  -- Order within (stage, role). 1 is the one to reach for first.
  rank        INT NOT NULL DEFAULT 1 CHECK (rank >= 1),

  -- WHY this drill serves this objective. Required, and the hardest field to
  -- fill honestly — which is the point. "Its category matches" is not a
  -- rationale, and a stage whose rationales all say that is a stage that has
  -- not been curated.
  rationale   TEXT NOT NULL,
  notes       TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same drill may appear once per role in a stage — Tee Work is
  -- legitimately both the primary and the reinforcement in some stages — but
  -- not twice in the same role.
  UNIQUE (stage_id, drill_id, role)
);

CREATE INDEX IF NOT EXISTS idx_pathway_stage_drills_stage
  ON public.development_pathway_stage_drills(stage_id, role, rank);
CREATE INDEX IF NOT EXISTS idx_pathway_stage_drills_drill
  ON public.development_pathway_stage_drills(drill_id);

-- ---------------------------------------------------------------------------
-- 4. Which named problems a stage addresses
-- ---------------------------------------------------------------------------
-- A reference, not a copy. drill_problem_map already holds 393 curated
-- drill→problem rows and remains the only place that mapping lives; this says
-- which problems a STAGE is aimed at, which is a different and coarser claim.
--
-- It is what lets a coach who arrives with "he keeps dropping his hands" be
-- pointed at a stage rather than at a loose drill.
CREATE TABLE IF NOT EXISTS public.development_pathway_stage_problems (
  stage_id      UUID NOT NULL
                REFERENCES public.development_pathway_stages(id) ON DELETE CASCADE,
  -- By slug, matching drill_problem_map's own convention — problem_taxonomy
  -- exposes slug to the anon role and id is not part of the public shape.
  problem_slug  TEXT NOT NULL
                REFERENCES public.problem_taxonomy(slug) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, problem_slug)
);

-- ---------------------------------------------------------------------------
-- 5. RLS — reference data, same shape as the drill library
-- ---------------------------------------------------------------------------
-- Readable by anyone, written only by the service role. The pathway layer holds
-- no player data and no coach data; it is curriculum, exactly like
-- drill_activity_families.
--
-- Wrapped in DO blocks so this also applies on a plain Postgres, where
-- Supabase's roles and auth.role() do not exist — the bootstrap and migration
-- tests run there.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'development_pathways',
    'development_pathway_stages',
    'development_pathway_stage_drills',
    'development_pathway_stage_problems'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'Pathways are publicly readable'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Pathways are publicly readable" ON public.%I FOR SELECT TO public USING (true)', t);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'Service role can manage pathways'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Service role can manage pathways" ON public.%I FOR ALL TO public USING (auth.role() = ''service_role'')', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE t TEXT; r TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'development_pathways',
    'development_pathway_stages',
    'development_pathway_stage_drills',
    'development_pathway_stage_problems'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT SELECT ON public.%I TO %I', t, r);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 4 tables, 0 rows each, and every existing count unchanged.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name LIKE 'development_pathway%')                      AS pathway_tables,
  (SELECT count(*) FROM public.development_pathways)                    AS pathways,
  (SELECT count(*) FROM public.development_pathway_stages)              AS stages,
  (SELECT count(*) FROM public.development_pathway_stage_drills)        AS stage_drills,
  (SELECT count(*) FROM public.development_pathway_stage_problems)      AS stage_problems,
  -- Unchanged by this migration. Named so a diff is visible rather than assumed.
  (SELECT count(*) FROM public.drill_resources)                         AS drills_untouched,
  (SELECT count(*) FROM public.drill_problem_map)                       AS mappings_untouched,
  (SELECT count(*) FROM public.problem_taxonomy)                        AS problems_untouched;
