-- ============================================================================
-- Migration 079: replacement videos for six drills 078 left without one
-- ============================================================================
-- Run AFTER 078. Candidates were found by a separate search
-- (docs/audits/drill-video-replacements-2026-10-01.csv), each passing YouTube
-- oEmbed (public and embeddable). Only the six with strong evidence are used:
--
--   * four single-drill YouGoProBaseball videos whose own write-ups describe
--     the drill the way the library does (Shoulder Swings, Catch and Crush,
--     Frisbee, Happy Gilmore);
--   * the original "5 Essential Hitting Drills" video, re-uploaded by the same
--     coach under a new id;
--   * the Bucket Drill segment of a Dominate The Diamond five-drill video.
--     Its start time was not confirmed, so none is written — the coach lands
--     at 0:00, as for every other compilation in the library.
--
-- The other five candidates (Knee Drill, Bounce Toss, Barry Larkin, How to
-- Throw, Tee Ball hitting) were matched on titles only and wait for someone to
-- watch them. The Lawnmower Drill had no suitable match. Those drills stay
-- without a video.
--
-- A drill gets its video only if it has none now (no legacy video and no live
-- media row), so this cannot overwrite a video added by hand, does nothing if
-- 078 has not run, and changes nothing the second time. Nothing is stamped
-- verified. No other drill, pathway or player data is touched.
--
-- Check afterwards: npm run verify:078 (read-only; covers 078 and 079).
-- ============================================================================

WITH v (drill_id, video_id, title, channel) AS (VALUES
  ('4148cfe0-4a27-4abc-a754-dcd5f2544f0e'::uuid, 'jGSbbHXX7NU', 'Shoulder Swings - Baseball Hitting Drill', 'YouGoProBaseball'),                          -- Shoulder Swings — Stay Short to the Ball
  ('26332028-2d32-4f42-817e-c8628f2bdbcd',       'XZZ80KnHuOU', 'Catch and Crush Hitting Drill', 'YouGoProBaseball'),                                    -- Catch and Crush Drill — Stay Closed
  ('a50f834a-2912-4b0d-9da2-e6856760b644',       'g72wLGj2kq4', 'The Frisbee Hitting Drill', 'YouGoProBaseball'),                                        -- Frisbee Drill — Hip Rotation & Finish
  ('5381544c-f5e5-4e30-a9e8-fe049a090a07',       'LpJg_9FK4rk', 'The Happy Gilmore Baseball Hitting Drill', 'YouGoProBaseball'),                         -- Happy Gilmore / Walking Load Drill
  ('0339e559-16cd-4912-94f6-a895ab8dc119',       'fPRAqPcEPYA', '5 ESSENTIAL Baseball Hitting Drills for Youth Baseball Players', 'Jermaine Curtis'),    -- 5 Essential Hitting Drills for Youth Baseball
  ('1c406241-97b4-425d-8f16-89ade2dbbc22',       'xRx1xE_byNc', 'Top 5 ways to Hit For More POWER in Baseball', 'Dominate The Diamond')                  -- Bucket Drill — Stay in Your Legs
),
eligible AS (
  SELECT v.* FROM v
    JOIN public.drill_resources d ON d.id = v.drill_id
   WHERE d.youtube_video_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.drill_media_resources m
                      WHERE m.drill_id = v.drill_id AND m.verification_status <> 'rejected')
),
media AS (
  INSERT INTO public.drill_media_resources
    (drill_id, media_type, provider, external_id, url, title, source_name, thumbnail_url,
     is_primary, verification_status, notes)
  SELECT e.drill_id, 'youtube', 'youtube', e.video_id,
         'https://www.youtube.com/watch?v=' || e.video_id, e.title, e.channel,
         'https://img.youtube.com/vi/' || e.video_id || '/hqdefault.jpg',
         true, 'unverified',
         'Added by migration 079: replacement for a video removed by 078.'
    FROM eligible e
  ON CONFLICT DO NOTHING
  RETURNING drill_id
)
UPDATE public.drill_resources d
   SET youtube_url = 'https://www.youtube.com/watch?v=' || e.video_id,
       youtube_video_id = e.video_id,
       thumbnail_url = 'https://img.youtube.com/vi/' || e.video_id || '/hqdefault.jpg',
       channel = e.channel,
       url_verified_at = NULL,
       youtube_start_seconds = NULL,
       youtube_start_source = NULL
  FROM eligible e
 WHERE d.id = e.drill_id;
