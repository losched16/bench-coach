-- ============================================================================
-- Migration 078: take dead and mismatched videos off drills
-- ============================================================================
-- A link check on 2026-09-30 (docs/audits/drill-video-link-check-2026-09-30.csv)
-- ran every video in the library through YouTube oEmbed: 114 of 118 resolve,
-- 4 return 404. Matching each video back to the drills that use it also found
-- drills showing a video about a different skill.
--
-- Drills are embedded in the app, so a dead video is a broken player in front
-- of a coach, and a wrong one teaches the wrong thing. This migration:
--
--   1. DEAD (9 drills, 4 videos). The video is removed. The drill keeps its
--      written instructions and shows no player until a replacement is chosen.
--   2. WRONG (3 drills). A hitting drill on a throwing or base-running video,
--      and a throwing tip on a base-running video. Removed the same way.
--   3. RETARGET (2 drills). "High Tee" and "High Tee Drill — Hitting Up in the
--      Zone" pointed at the youth throwing video. Their own hidden duplicate
--      row ("High Tee Drill", duplicate_of "High Tee") still carries the right
--      one — "High Ball Tee Drill", Dominate The Diamond — so both move to it.
--
-- A video lives in two places and both are changed, or the old link returns:
--   * drill_resources.youtube_* — legacy columns, still read directly by many
--     surfaces and used as a fallback by lib/drillMedia.ts;
--   * drill_media_resources — the old row is marked 'rejected' and demoted
--     (pickPrimary never shows a rejected link) rather than deleted, so the
--     record of what was there, and why it went, stays in the table.
--
-- Every UPDATE is keyed on the drill id AND the video it is expected to hold,
-- so a row somebody has already corrected by hand is left alone, and running
-- this twice changes nothing the second time.
--
-- No drill is added, deleted, renamed or re-mapped; no pathway, taxonomy or
-- player data is touched. Nothing is stamped as verified.
--
-- Check afterwards: npm run verify:078 (read-only).
-- ============================================================================

-- ── 1 + 2. Remove the video ────────────────────────────────────────────────
-- One statement, so the media rows and the drill row change together or not
-- at all, however this file is run.
WITH r (drill_id, video_id, reason) AS (VALUES
  -- dead: oEmbed 404
  ('4148cfe0-4a27-4abc-a754-dcd5f2544f0e'::uuid, '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Shoulder Swings — Stay Short to the Ball
  ('4fa59dec-86b0-46f7-bb31-f59382b1e9f4', '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Bounce Toss / Angled Toss Drill
  ('26332028-2d32-4f42-817e-c8628f2bdbcd', '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Catch and Crush Drill — Stay Closed
  ('7bff401e-095e-447b-83e8-bc6cc750c85d', '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Barry Larkin / Walk-Through Power Drill
  ('a50f834a-2912-4b0d-9da2-e6856760b644', '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Frisbee Drill — Hip Rotation & Finish
  ('5381544c-f5e5-4e30-a9e8-fe049a090a07', '3Xqb7j2BYTU', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Happy Gilmore / Walking Load Drill
  ('25b42f9f-7769-47ac-ad0e-f9140091660e', '9EAbFFMBBGE', 'video unavailable (oEmbed 404, 2026-09-30)'), -- The Lawnmower Drill — Arm Action & Wrist Snap
  ('0339e559-16cd-4912-94f6-a895ab8dc119', '3NqJh3hfYZc', 'video unavailable (oEmbed 404, 2026-09-30)'), -- 5 Essential Hitting Drills for Youth Baseball
  ('32b31e2c-78f6-47a2-a166-7ce9a3053969', 'k8Lzh6YJLUE', 'video unavailable (oEmbed 404, 2026-09-30)'), -- Hitting Tips for Tee Ball (4-5 Year Olds)
  -- wrong: the video is about a different skill
  ('8f19ecd6-4892-46be-9f0c-b1aef17a86d6', '77r6mWAUecA', 'video is a throwing progression, not this hitting drill'),       -- Knee Drill (Rotational Load)
  ('1a1767cc-35ca-47f3-ad7d-5a920add6597', 'Hk9-ofX19Ig', 'video is about base running, not throwing'),                    -- How to Throw the RIGHT WAY
  ('1c406241-97b4-425d-8f16-89ade2dbbc22', 'hdyY3AoSkyk', 'video is base-running drills, not this hitting drill')         -- Bucket Drill — Stay in Your Legs
),
media AS (
  UPDATE public.drill_media_resources m
     SET verification_status = 'rejected',
         is_primary = false,
         notes = concat_ws(' ', m.notes, 'Rejected by migration 078: ' || r.reason || '.'),
         updated_at = NOW()
    FROM r
   WHERE m.drill_id = r.drill_id
     AND m.external_id = r.video_id
     AND m.verification_status <> 'rejected'
  RETURNING m.id
)
UPDATE public.drill_resources d
   SET youtube_url = NULL,
       youtube_video_id = NULL,
       thumbnail_url = NULL,
       channel = NULL,
       url_verified_at = NULL,
       youtube_start_seconds = NULL,
       youtube_start_source = NULL
  FROM r
 WHERE d.id = r.drill_id
   AND d.youtube_video_id = r.video_id;

-- ── 3. Move the two High Tee drills to the high-tee video ──────────────────
WITH t (drill_id) AS (VALUES
  ('037c8a5a-327f-42cf-a2a1-bd550fed9e68'::uuid),  -- High Tee
  ('ba88a3cd-b2ae-430b-bd5e-d06c53f58838'::uuid)   -- High Tee Drill — Hitting Up in the Zone
),
old_media AS (
  UPDATE public.drill_media_resources m
     SET verification_status = 'rejected',
         is_primary = false,
         notes = concat_ws(' ', m.notes, 'Rejected by migration 078: video is a throwing progression; replaced with iKX-qxQ1X5g.'),
         updated_at = NOW()
    FROM t
   WHERE m.drill_id = t.drill_id
     AND m.external_id = '77r6mWAUecA'
     AND m.verification_status <> 'rejected'
  RETURNING m.drill_id
),
new_media AS (
  -- Only for a drill whose old primary was demoted just now, so a second run
  -- (nothing demoted) adds nothing, and the one-primary index is never hit.
  INSERT INTO public.drill_media_resources
    (drill_id, media_type, provider, external_id, url, title, source_name, thumbnail_url,
     is_primary, verification_status, notes)
  SELECT o.drill_id, 'youtube', 'youtube', 'iKX-qxQ1X5g',
         'https://www.youtube.com/watch?v=iKX-qxQ1X5g', NULL, 'Dominate The Diamond',
         'https://img.youtube.com/vi/iKX-qxQ1X5g/hqdefault.jpg',
         true, 'unverified',
         'Added by migration 078: the video on this drill''s hidden duplicate ("High Tee Drill").'
    FROM old_media o
  ON CONFLICT DO NOTHING
  RETURNING id
)
UPDATE public.drill_resources d
   SET youtube_url = 'https://www.youtube.com/watch?v=iKX-qxQ1X5g',
       youtube_video_id = 'iKX-qxQ1X5g',
       thumbnail_url = 'https://img.youtube.com/vi/iKX-qxQ1X5g/hqdefault.jpg',
       channel = 'Dominate The Diamond',
       url_verified_at = NULL,
       youtube_start_seconds = NULL,
       youtube_start_source = NULL
  FROM t
 WHERE d.id = t.drill_id
   AND d.youtube_video_id = '77r6mWAUecA';
