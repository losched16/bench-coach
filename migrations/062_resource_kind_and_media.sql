-- ============================================================================
-- 062 — What a row IS, and where its media lives
-- ============================================================================
--
-- THE PROBLEM THIS SOLVES
--
-- drill_resources holds 208 curated rows and treats every one of them as a
-- drill. It is not. An audit of all 208 (docs/audits/drill-canonicalization-
-- decisions.csv) found 26 rows that are compilation videos — "10 Best Baseball
-- Hitting Drills for Kids" is a row, twice — and 20 that are mechanics
-- tutorials with nothing to arrange on a field. A coach is currently offered
-- all 46 as things to schedule on a Tuesday.
--
-- The canonical activity is the product. A video is media attached to it.
--
-- TWO COLUMNS THIS DOES NOT ADD, AND WHY
--
--   status            already carries approved / pending_review / retired
--   source            already records where a drill came from
--   activity_format   already says how the activity is organised on the field
--   difficulty_level  already carries the ability axis
--
-- None of them answers "is this one runnable activity, a sequence, a
-- compilation, or a lecture". Overloading any of them would give the table two
-- answers to one question and the two would drift. 056 made the same call in
-- the other direction and it is worth making consistently.
--
-- WHY resource_kind IS NULLABLE AND STAYS NULL FOR MOST ROWS
--
-- NULL means "nobody has classified this yet", and a NULL row stays fully
-- usable. That is deliberate in two directions:
--
--   * coach-authored drills are NULL forever and behave as activities. They are
--     the coach's own writing; classifying them is not ours to do.
--   * a curated row nobody has reviewed keeps working. Demoting on uncertainty
--     would silently shrink the library, which is the exact failure the drill
--     audit standing rule exists to prevent — coverage beats quality.
--
-- Only an explicit source_collection or teaching_content stops being offered.
-- Absence is not a constraint, same rule this codebase already runs on.
--
-- Additive and idempotent. Nothing is deleted, no row is modified by this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. resource_kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.drill_resources
  ADD COLUMN IF NOT EXISTS resource_kind TEXT;

COMMENT ON COLUMN public.drill_resources.resource_kind IS
  'What this row IS. activity = one runnable drill. practice_unit = a sequence '
  'run as one block (a warm-up routine, a three-phase progression). '
  'source_collection = a compilation of several drills; never offered as a drill. '
  'teaching_content = mechanics instruction with nothing to arrange; never offered '
  'as a drill. NULL = unclassified, and treated as runnable.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.drill_resources'::regclass
                   AND conname = 'drill_resources_resource_kind_check') THEN
    ALTER TABLE public.drill_resources ADD CONSTRAINT drill_resources_resource_kind_check
      CHECK (resource_kind IS NULL OR resource_kind = ANY (ARRAY[
        'activity', 'practice_unit', 'source_collection', 'teaching_content'
      ]));
  END IF;
END $$;

-- Retrieval loads the library once and ranks in memory, so this is not a hot
-- WHERE clause. The partial index earns its keep for the admin and audit reads
-- that ask "what is demoted", which are the ones that scan by kind.
CREATE INDEX IF NOT EXISTS idx_drill_resources_resource_kind
  ON public.drill_resources (resource_kind)
  WHERE resource_kind IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. drill_media_resources
--
-- Today a drill has exactly one video, spelled across five columns on the drill
-- itself. That shape cannot hold a second camera angle, an Instagram reel, a
-- diagram, or an article — and those are the things that make an activity
-- teachable. One row per piece of media, one drill, many media.
--
-- The legacy youtube_* columns on drill_resources STAY. Every reader still
-- falls back to them (lib/drillMedia.ts), and dropping them would be a
-- migration whose failure mode is a coach's video link going dead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drill_media_resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id    UUID NOT NULL REFERENCES public.drill_resources(id) ON DELETE CASCADE,

  media_type  TEXT NOT NULL,
  provider    TEXT,
  external_id TEXT,
  url         TEXT NOT NULL,

  title        TEXT,
  source_name  TEXT,
  thumbnail_url TEXT,

  -- Where in the media the activity actually is. NULL means nobody has said —
  -- which is NOT the same as zero, and must never be written as zero. 205 of
  -- the 208 curated rows carry a video and NONE of them carries a start time;
  -- writing 0 for all of them would turn "unknown" into a claim that every
  -- drill begins at the first frame of a twelve-minute compilation.
  start_seconds INT,
  end_seconds   INT,
  start_source  TEXT,

  -- One piece of media per drill is the one a surface shows by default.
  is_primary  BOOLEAN NOT NULL DEFAULT false,

  -- Whether a human has confirmed the link points where it claims. A backfilled
  -- row is 'unverified' even when it carries a timestamp: having a number is
  -- not the same as somebody having checked it.
  verification_status TEXT NOT NULL DEFAULT 'unverified',

  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT drill_media_media_type_check CHECK (media_type = ANY (ARRAY[
    'youtube', 'instagram', 'article', 'illustration', 'animation'
  ])),
  CONSTRAINT drill_media_verification_check CHECK (verification_status = ANY (ARRAY[
    'unverified', 'verified', 'rejected'
  ])),
  CONSTRAINT drill_media_start_source_check CHECK (start_source IS NULL OR start_source = ANY (ARRAY[
    'curated', 'publisher', 'heuristic', 'imported'
  ])),
  -- A negative offset is a data-entry error, and an end at or before the start
  -- describes an empty segment. Both are cheaper to reject here than to debug
  -- as a video that opens on a black frame.
  CONSTRAINT drill_media_timestamps_check CHECK (
    (start_seconds IS NULL OR start_seconds >= 0) AND
    (end_seconds   IS NULL OR end_seconds   >= 0) AND
    (start_seconds IS NULL OR end_seconds IS NULL OR end_seconds > start_seconds)
  ),
  CONSTRAINT drill_media_url_present CHECK (length(btrim(url)) > 0)
);

COMMENT ON TABLE public.drill_media_resources IS
  'Media attached to a drill. The activity is the product; this is what supports it. '
  'A drill may have many, or none.';

-- The same drill, the same url, the same segment, twice is always a mistake —
-- usually a backfill run a second time. COALESCE so that NULL start times
-- collide with each other, which plain UNIQUE would not do.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drill_media_unique_attachment
  ON public.drill_media_resources (drill_id, url, COALESCE(start_seconds, -1));

CREATE INDEX IF NOT EXISTS idx_drill_media_drill
  ON public.drill_media_resources (drill_id);

-- One default per drill. A partial unique index rather than a constraint,
-- because "at most one true" is exactly what this expresses and a CHECK cannot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drill_media_one_primary
  ON public.drill_media_resources (drill_id)
  WHERE is_primary;

-- ---------------------------------------------------------------------------
-- 3. RLS — media follows its parent drill, and ONLY its parent drill
--
-- READ THIS BEFORE COPYING THE drill_resources POLICIES.
--
-- drill_resources currently carries BOTH "Curated drills and your own" (the
-- ownership rule) AND "Drill resources are publicly readable" USING (true).
-- Postgres ORs permissive policies together, so the second one defeats the
-- first: RLS on drill_resources does not in fact keep one coach's private
-- drills from another coach. lib/drills.ts is the only control that does, which
-- is why scripts/verify-drill-scope.mjs fails the build over it.
--
-- That is a pre-existing fault and this migration does not change it — altering
-- the policies on a live table every surface reads is its own change with its
-- own blast radius. It IS the reason there is no blanket-true policy below.
-- Media metadata names a coach's private drill, so it gets the ownership rule
-- and nothing that overrides it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.drill_media_resources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drill_media_resources'
      AND policyname = 'Media for curated drills and your own'
  ) THEN
    CREATE POLICY "Media for curated drills and your own"
      ON public.drill_media_resources FOR SELECT TO public
      USING (
        EXISTS (
          SELECT 1 FROM public.drill_resources d
          WHERE d.id = drill_media_resources.drill_id
            AND (
              d.created_by_coach_id IS NULL
              OR d.created_by_coach_id IN (
                SELECT c.id FROM public.coaches c WHERE c.user_id = auth.uid()
              )
            )
        )
      );
  END IF;

  -- A coach may attach media to a drill they wrote, and only to one they wrote.
  -- Curated media is editorial and stays service-role only.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drill_media_resources'
      AND policyname = 'Coaches write media on their own drills'
  ) THEN
    CREATE POLICY "Coaches write media on their own drills"
      ON public.drill_media_resources FOR ALL TO public
      USING (
        EXISTS (
          SELECT 1 FROM public.drill_resources d
          WHERE d.id = drill_media_resources.drill_id
            AND d.created_by_coach_id IN (
              SELECT c.id FROM public.coaches c WHERE c.user_id = auth.uid()
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.drill_resources d
          WHERE d.id = drill_media_resources.drill_id
            AND d.created_by_coach_id IN (
              SELECT c.id FROM public.coaches c WHERE c.user_id = auth.uid()
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drill_media_resources'
      AND policyname = 'Service role can manage drill media'
  ) THEN
    CREATE POLICY "Service role can manage drill media"
      ON public.drill_media_resources FOR ALL TO public
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Wrapped because the bootstrap test runs this against a plain Postgres where
-- Supabase's roles do not exist.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.drill_media_resources TO %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT INSERT, UPDATE, DELETE ON public.drill_media_resources TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT INSERT, UPDATE, DELETE ON public.drill_media_resources TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Immediately after this migration, expect 208 / 0 / 0 — every curated row
-- still unclassified, and no media rows until the backfill runs:
--
--   SELECT count(*) AS total,
--          count(resource_kind) AS classified,
--          (SELECT count(*) FROM drill_media_resources) AS media
--   FROM drill_resources WHERE created_by_coach_id IS NULL;
--
-- After scripts/backfill-drill-media.ts, media should equal the number of rows
-- carrying a youtube_video_id (205 at time of writing) and every one of those
-- should be is_primary with verification_status 'unverified'.
