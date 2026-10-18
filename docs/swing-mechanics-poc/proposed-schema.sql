-- ============================================================================
-- PROPOSED production schema for swing mechanics captures — NOT A MIGRATION.
-- ============================================================================
-- Deliberately outside migrations/: nothing here has been applied anywhere.
-- When the POC graduates, this becomes the next free migration number (077 is
-- taken by practice_plan_pathway_link; PR #10's 077 must be renumbered too).
--
-- Reuses the PR #10 patterns: private bucket, path-scoped signed uploads,
-- team-scoped RLS via bc_team_at_least, coach confirmation before anything
-- reaches player_metrics. Unlike PR #10 it stores MECHANICS observations, not
-- exit velocity / launch angle / distance, which a pose model cannot produce.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.swing_mechanics_captures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- private bucket 'swing-mechanics' (public = false); path <team>/<player>/<uuid>.<ext>
  storage_path    TEXT NOT NULL UNIQUE,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 209715200),
  handedness      TEXT CHECK (handedness IN ('R', 'L')),
  camera_view     TEXT CHECK (camera_view IN ('face_on', 'down_the_line', 'other')),
  setting         TEXT CHECK (setting IN ('tee', 'front_toss', 'live', 'other')),
  -- every contact / event mark, newest last (provenance)
  annotations     JSONB NOT NULL DEFAULT '{"contact": [], "events": {}}'::jsonb,
  -- retention: purge video + analysis after this unless the coach keeps it
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days')
);

CREATE TABLE IF NOT EXISTS public.swing_mechanics_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID NOT NULL REFERENCES public.swing_mechanics_captures(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'done', 'failed')),
  request         JSONB NOT NULL,                -- contact_ms, handedness, view, foot_strike_ms
  input_hash      TEXT,                          -- video + request + analyzer + model: idempotency
  attempts        INT NOT NULL DEFAULT 0,
  claimed_at      TIMESTAMPTZ,                   -- worker claims with SELECT … FOR UPDATE SKIP LOCKED
  error           JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.swing_mechanics_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID NOT NULL REFERENCES public.swing_mechanics_captures(id) ON DELETE CASCADE,
  input_hash      TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  model_sha256    TEXT NOT NULL,
  observations    JSONB NOT NULL,                -- small: the registry output
  -- per-frame landmarks are large (~1 MB per 500 frames): stored as a private
  -- object beside the video, not in the row
  landmarks_path  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (capture_id, input_hash)
);

CREATE TABLE IF NOT EXISTS public.swing_mechanics_reviews (
  result_id       UUID NOT NULL REFERENCES public.swing_mechanics_results(id) ON DELETE CASCADE,
  finding_id      TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('accepted', 'edited', 'rejected', 'not_assessable')),
  note            TEXT CHECK (note IS NULL OR length(note) <= 600),
  reviewed_by     UUID NOT NULL REFERENCES auth.users(id),
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (result_id, finding_id)
);

-- RLS: read = viewer+, insert/annotate = contributor+ ('record'), review = 'decide',
-- delete = admin — mirroring bc_team_at_least as in PR #10. Service-role routes
-- must still authorize with lib/authz.ts (RLS does not protect service-role reads).
