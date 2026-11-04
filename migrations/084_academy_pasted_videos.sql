-- ============================================================================
-- Migration 084: Academy drill videos can point at a pasted YouTube video
-- ============================================================================
-- NOT APPLIED to any database yet. Additive and idempotent. Needs the owner's review first.
--
-- 083 lets a lesson drill borrow the video of a drill in the BenchCoach library. When the library
-- has no video for a drill, the owner pastes a YouTube link instead. A mapping now has exactly one
-- source: a library drill (drill_id) or a pasted video (youtube_video_id with its title and channel
-- as YouTube reported them). Approval rules are unchanged: only approved rows reach a learner, and
-- approval needs a reviewer name and a date.
-- ============================================================================

ALTER TABLE public.academy_drill_videos ALTER COLUMN drill_id DROP NOT NULL;
ALTER TABLE public.academy_drill_videos ADD COLUMN IF NOT EXISTS youtube_video_id text;
ALTER TABLE public.academy_drill_videos ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.academy_drill_videos ADD COLUMN IF NOT EXISTS channel text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_drill_videos_one_source') THEN
    ALTER TABLE public.academy_drill_videos ADD CONSTRAINT academy_drill_videos_one_source
      CHECK ((drill_id IS NOT NULL) <> (youtube_video_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_drill_videos_youtube_id_shape') THEN
    ALTER TABLE public.academy_drill_videos ADD CONSTRAINT academy_drill_videos_youtube_id_shape
      CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
  END IF;
END $$;
