-- ============================================================================
-- Migration 077: Swing capture foundation
-- ============================================================================
-- A phone-recorded swing is not a second measurement system. The video is
-- provenance for objective measurements that already belong in player_metrics.
--
-- This migration therefore adds only what player_metrics cannot represent:
--   1. the video/capture and its analysis/review lifecycle;
--   2. the camera calibration facts needed to turn pixels into real units;
--   3. a provenance link from derived readings back to that capture; and
--   4. projected hit distance as a system metric preset.
--
-- Exit velocity already exists as the canonical `exit_velo` preset from 019.
-- Launch angle intentionally DOES NOT become a trend metric yet. There is no
-- universally correct "higher is better" or "lower is better" direction for
-- launch angle, while metric_types currently requires one of those two. It is
-- stored on swing_captures as descriptive evidence instead of lying to the
-- development trend engine.
--
-- `projected_hit_distance` is explicitly projected, not actual landing
-- distance. The app must preserve that wording anywhere the value is shown.
--
-- Additive and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The one new metric that fits the existing trend model honestly
-- ---------------------------------------------------------------------------
INSERT INTO public.metric_types (
  coach_id, slug, label, unit, shape, direction, hint, sort_order
)
SELECT
  NULL::uuid,
  'projected_hit_distance',
  'Projected hit distance',
  'ft',
  'measurement',
  'higher',
  'Estimated carry from the measured ball flight. Treat it as projected distance, not a tape-measured landing spot.',
  11
WHERE NOT EXISTS (
  SELECT 1
  FROM public.metric_types
  WHERE coach_id IS NULL AND slug = 'projected_hit_distance'
);

-- ---------------------------------------------------------------------------
-- 2. Capture provenance and analysis lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.swing_captures (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id                UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  -- The video stays in private Supabase storage. Store only the object path;
  -- clients receive short-lived signed URLs when they are allowed to read it.
  storage_bucket           TEXT NOT NULL DEFAULT 'journal-media',
  storage_path             TEXT NOT NULL,
  original_filename        TEXT,
  mime_type                TEXT,
  size_bytes               BIGINT,

  source                    TEXT NOT NULL DEFAULT 'video_upload'
                            CHECK (source IN ('video_upload', 'native_ios', 'native_android')),
  capture_fps               INT,
  frame_width               INT,
  frame_height              INT,
  duration_ms               INT,
  -- Monocular video has no real-world scale by itself. The setup flow asks for
  -- the perpendicular lens-to-ball distance at contact; the analyzer combines
  -- this with camera intrinsics / the stationary tee ball to calibrate motion.
  camera_distance_ft        NUMERIC(5,2),
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_on               DATE NOT NULL DEFAULT CURRENT_DATE,

  -- uploaded  : video exists, no analysis has been attempted
  -- queued    : handed to an analyzer
  -- processing: analyzer is actively working
  -- review    : numbers exist but a human has not approved them
  -- confirmed : approved and synced into player_metrics
  -- failed    : analysis failed; the video remains available for retry/review
  status                    TEXT NOT NULL DEFAULT 'uploaded'
                            CHECK (status IN ('uploaded', 'queued', 'processing', 'review', 'confirmed', 'failed')),

  exit_velocity_mph         NUMERIC(6,2),
  launch_angle_deg          NUMERIC(6,2),
  projected_distance_ft     NUMERIC(7,2),
  confidence                NUMERIC(5,4),

  analysis_provider         TEXT,
  analysis_version          TEXT,
  analysis_payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_error            TEXT,
  analyzed_at               TIMESTAMPTZ,

  reviewed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at               TIMESTAMPTZ,
  confirmed_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at              TIMESTAMPTZ,
  created_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT swing_captures_storage_path_not_blank
    CHECK (length(trim(storage_path)) > 0 AND length(storage_path) <= 700),
  CONSTRAINT swing_captures_size_valid
    CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT swing_captures_fps_valid
    CHECK (capture_fps IS NULL OR capture_fps BETWEEN 24 AND 1000),
  CONSTRAINT swing_captures_dimensions_valid
    CHECK ((frame_width IS NULL OR frame_width > 0) AND (frame_height IS NULL OR frame_height > 0)),
  CONSTRAINT swing_captures_duration_valid
    CHECK (duration_ms IS NULL OR duration_ms > 0),
  CONSTRAINT swing_captures_camera_distance_valid
    CHECK (camera_distance_ft IS NULL OR camera_distance_ft BETWEEN 3 AND 30),
  CONSTRAINT swing_captures_exit_velo_valid
    CHECK (exit_velocity_mph IS NULL OR exit_velocity_mph BETWEEN 1 AND 200),
  CONSTRAINT swing_captures_launch_angle_valid
    CHECK (launch_angle_deg IS NULL OR launch_angle_deg BETWEEN -90 AND 90),
  CONSTRAINT swing_captures_projected_distance_valid
    CHECK (projected_distance_ft IS NULL OR projected_distance_ft BETWEEN 0 AND 1000),
  CONSTRAINT swing_captures_confidence_valid
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT swing_captures_confirmed_has_results
    CHECK (
      status <> 'confirmed'
      OR (exit_velocity_mph IS NOT NULL AND projected_distance_ft IS NOT NULL)
    ),
  CONSTRAINT swing_captures_confirmed_has_audit
    CHECK (
      status <> 'confirmed'
      OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
    ),

  UNIQUE (team_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_swing_captures_player_date
  ON public.swing_captures (player_id, team_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_swing_captures_status
  ON public.swing_captures (team_id, status, created_at DESC);

COMMENT ON TABLE public.swing_captures IS
  'Private video provenance and human-review state for phone-recorded swings. Confirmed objective readings are copied into player_metrics.';
COMMENT ON COLUMN public.swing_captures.projected_distance_ft IS
  'Projected carry distance, not an observed or tape-measured landing distance.';
COMMENT ON COLUMN public.swing_captures.launch_angle_deg IS
  'Descriptive launch angle. Not a player_metrics trend until target-range semantics exist.';
COMMENT ON COLUMN public.swing_captures.camera_distance_ft IS
  'Perpendicular lens-to-ball distance at contact, captured during setup to provide monocular scale.';

-- ---------------------------------------------------------------------------
-- 3. Derived player_metrics point back to their source capture
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_metrics
  ADD COLUMN IF NOT EXISTS source_capture_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.player_metrics'::regclass
      AND conname = 'player_metrics_source_capture_fk'
  ) THEN
    ALTER TABLE public.player_metrics
      ADD CONSTRAINT player_metrics_source_capture_fk
      FOREIGN KEY (source_capture_id)
      REFERENCES public.swing_captures(id)
      ON DELETE SET NULL;
  END IF;

  -- NULL capture ids are allowed many times. For derived readings, one capture
  -- may contribute only one row of a given metric type. This makes confirmation
  -- idempotent and lets a reviewed result be corrected without duplicating the
  -- player's chart.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.player_metrics'::regclass
      AND conname = 'player_metrics_capture_metric_unique'
  ) THEN
    ALTER TABLE public.player_metrics
      ADD CONSTRAINT player_metrics_capture_metric_unique
      UNIQUE (source_capture_id, metric_type_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_player_metrics_source_capture
  ON public.player_metrics (source_capture_id)
  WHERE source_capture_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bc_touch_swing_capture()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_touch_swing_capture ON public.swing_captures;
CREATE TRIGGER trg_touch_swing_capture
  BEFORE UPDATE ON public.swing_captures
  FOR EACH ROW EXECUTE FUNCTION public.bc_touch_swing_capture();

-- ---------------------------------------------------------------------------
-- 5. RLS — a swing video is child data, never public content
-- ---------------------------------------------------------------------------
ALTER TABLE public.swing_captures ENABLE ROW LEVEL SECURITY;

-- Guarded because migration tests run against plain Postgres without the
-- production team-access helper.
DO $$
BEGIN
  IF to_regprocedure('public.bc_team_at_least(uuid, text)') IS NULL THEN
    RAISE NOTICE 'bc_team_at_least absent — skipping swing capture policies (plain Postgres).';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='swing_captures' AND policyname='bc_read_swing_captures') THEN
    CREATE POLICY bc_read_swing_captures ON public.swing_captures
      FOR SELECT TO public USING (public.bc_team_at_least(team_id, 'viewer'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='swing_captures' AND policyname='bc_ins_swing_captures') THEN
    CREATE POLICY bc_ins_swing_captures ON public.swing_captures
      FOR INSERT TO public WITH CHECK (public.bc_team_at_least(team_id, 'contributor'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='swing_captures' AND policyname='bc_upd_swing_captures') THEN
    CREATE POLICY bc_upd_swing_captures ON public.swing_captures
      FOR UPDATE TO public
      USING (public.bc_team_at_least(team_id, 'contributor'))
      WITH CHECK (public.bc_team_at_least(team_id, 'contributor'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='swing_captures' AND policyname='bc_del_swing_captures') THEN
    CREATE POLICY bc_del_swing_captures ON public.swing_captures
      FOR DELETE TO public USING (public.bc_team_at_least(team_id, 'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.swing_captures TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.swing_captures TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.metric_types
    WHERE coach_id IS NULL AND slug = 'projected_hit_distance') AS projected_distance_presets,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='swing_captures') AS swing_capture_tables,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='player_metrics'
      AND column_name='source_capture_id') AS provenance_columns;
