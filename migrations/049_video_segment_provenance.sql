-- 049_video_segment_provenance.sql
--
-- Where did this timestamp come from?
--
-- youtube_start_seconds already exists (migration 036) and needs no change.
-- What is missing is any way to tell a curated segment from a guessed one
-- after the fact.
--
-- This matters more than it might sound. A wrong timestamp is WORSE than no
-- timestamp: at 0:00 a coach knows where they are and can scrub, but dropped
-- forty seconds into the wrong drill they conclude the recommendation is
-- broken. So the library needs to be able to answer "who put that number
-- there and how did they know", and to find every value later if a source
-- turns out to be unreliable.
--
-- One nullable text column rather than a table. There is exactly one
-- timestamp per drill, it has one origin, and a join table for a single
-- string would be ceremony.
--
-- Expected values, though the column is deliberately not constrained to them
-- so a future source does not need a migration:
--
--   'chapter'        read off the video's own chapter markers
--   'description'    a timestamp the uploader wrote into the description
--   'manual-review'  a person watched the video and wrote down where it starts
--   'imported'       carried in from wherever the drill row came from
--
-- NULL means no timestamp has been set, or one was set before this column
-- existed. Both are "unknown provenance" and both should be re-reviewed.

BEGIN;

ALTER TABLE drill_resources
  ADD COLUMN IF NOT EXISTS youtube_start_source text;

COMMENT ON COLUMN drill_resources.youtube_start_source IS
  'How youtube_start_seconds was determined: chapter, description, '
  'manual-review, imported. NULL means unknown or unset. A wrong segment start '
  'is worse than none, so every value should be traceable to a source.';

-- A timestamp with no stated source is the thing this column exists to
-- prevent, so it is worth being able to find them in one query.
CREATE INDEX IF NOT EXISTS idx_drill_resources_unsourced_start
  ON drill_resources (id)
  WHERE youtube_start_seconds IS NOT NULL AND youtube_start_source IS NULL;

COMMIT;

-- Verification.
--
-- SELECT count(*) FILTER (WHERE youtube_start_seconds IS NOT NULL) AS with_start,
--        count(*) FILTER (WHERE youtube_start_seconds IS NOT NULL
--                           AND youtube_start_source IS NULL)      AS unsourced,
--        youtube_start_source, count(*)
--   FROM drill_resources WHERE status = 'approved'
--  GROUP BY youtube_start_source ORDER BY 4 DESC;
--
-- Immediately after this migration: with_start = 0, unsourced = 0, one row
-- with youtube_start_source NULL and count 206.
