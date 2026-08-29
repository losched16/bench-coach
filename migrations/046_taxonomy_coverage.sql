-- ============================================================================
-- Migration 046: taxonomy coverage — Phase 2A
-- ============================================================================
-- Phase 1 proved the retrieval architecture works and left one clear weakness:
-- coverage. 92 of 412 distinct `common_flaws_fixed` strings resolved to no
-- taxonomy slug, and the flagship example from the brief — "he keeps dropping
-- his back shoulder" — diagnosed to nothing at all.
--
-- WHAT THE AUDIT FOUND, AND WHY IT CHANGES THE FIX
--
-- No drill in the library has ever used the phrase "back shoulder". The
-- library describes that exact fault as "dropping the barrel", "dumping
-- barrel", "Dropping hands / under balls" and "uppercut". So this was never a
-- missing drill or a missing problem — it was a missing translation between
-- how coaches talk and how the library was written.
--
-- That distinction runs through this whole migration. Aliases and mappings do
-- different jobs and had been getting conflated:
--
--   ALIASES  match what a COACH types. They must be phrases a person would
--            actually say, and they must be specific enough not to fire on an
--            unrelated question. "poor communication" is a real flaw string
--            and a terrible alias — it would diagnose a question about team
--            parents as an outfield problem.
--
--   MAPPINGS attach a DRILL to a problem. They never see coach text, so a
--            generic phrase is harmless here.
--
-- So generic flaw strings become mappings only, and only phrases that survive
-- the "would a coach type this, and does it mean one thing?" test become
-- aliases. That is why 44 of the classified strings are handled as mappings
-- and only 11 as aliases.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- 18 strings are not diagnoses at all — "throwing without intent", "low
-- motivation in young players", "no challenge in regular catch". They are
-- drill rationale, habits and goals. Turning them into taxonomy entries would
-- raise a coverage number and make diagnosis worse.
--
-- 12 more are real coaching concepts with no good home yet — glove-side
-- control, catcher stance, pitcher fielding, "poor weight transfer". Each is
-- one or two occurrences and would need a slug with almost nothing mapped to
-- it. They are recorded as debt in the audit rather than guessed at here.
--
-- EVERY NEW MAPPING IS curated = FALSE.
--
-- The curated flag means a human who coaches this game verified the pairing;
-- it is worth 100 in retrieval scoring against 55 for an inferred one. These
-- were inferred by reading drill metadata. Marking them curated would put them
-- level with a hand-built progression, which is not what they are. No existing
-- mapping's flag is touched.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The flagship: how coaches say "uppercutting"
-- ---------------------------------------------------------------------------
-- Kept as an alias set on the existing entry rather than a new slug. The
-- reasoning is in docs/audits/taxonomy-coverage-remediation.md, but in short:
-- dropping the back shoulder is the CAUSE and an uppercut swing plane is the
-- EFFECT, the library holds no drill set that distinguishes them, and
-- `uppercutting` already owns the curated sequence (Tee Work -> Low Tee ->
-- Line Drive Pro) that Phase 1 showed is exactly the right answer. A separate
-- slug would have had to borrow those same three drills.
-- Two-word anchors rather than full sentences. diagnoseByAlias does plain
-- substring matching, so an alias only fires when it appears verbatim in what
-- the coach typed — and "dropping his back shoulder", "drops his back
-- shoulder", "his back shoulder drops" and "back shoulder dips" are four
-- different sentences containing one shared phrase. Enumerating conjugations
-- is a losing game; anchoring on "back shoulder" catches all of them.
--
-- The trade-off is deliberate and worth naming: "his back shoulder is sore"
-- would also diagnose as a swing fault. In this product that phrasing is rare
-- and the cost is a few hitting drills in an answer about arm soreness. The
-- alternative — a dozen brittle conjugations that miss the fifth one a coach
-- types — was the status quo, and it returned pitching drills for a hitting
-- question. Note that bare "shoulder" is deliberately NOT an alias.
UPDATE problem_taxonomy
SET aliases = ARRAY(SELECT DISTINCT unnest(COALESCE(aliases, '{}') || ARRAY['back shoulder', 'rear shoulder', 'shoulder dip', 'shoulder dipping', 'dipping the shoulder', 'back side collapsing', 'rear side collapsing', 'collapsing back side', 'collapsing his back side', 'dropping the barrel', 'dumping the barrel', 'dumping barrel', 'dragging the barrel', 'barrel drag', 'dropping his hands', 'dropping the hands', 'swinging under the ball', 'getting under the ball', 'swings under the ball']::TEXT[]))
WHERE slug = 'uppercutting';

-- ---------------------------------------------------------------------------
-- 2. One new entry: losing posture in the swing
-- ---------------------------------------------------------------------------
-- The only new slug this migration adds, and the only cluster that earned one.
--
-- Six flaw strings across five drills describe a hitter standing up out of
-- their legs — "losing bend in knees", "tall posture through contact",
-- "popping up out of stance during swing", "standing too upright". One of
-- those drills ("Bucket Drill — Stay in Your Legs") is mapped to NOTHING today
-- and is therefore invisible to taxonomy retrieval entirely.
--
-- It is distinct from `lunging`, which is weight drifting FORWARD. A hitter can
-- stand up without drifting and drift without standing up, and the fixes
-- differ: one is about staying in your legs, the other about staying back.
INSERT INTO problem_taxonomy (slug, label, skill_category, description, aliases)
VALUES (
  'loses-posture',
  'Loses posture / stands up in the swing',
  'Hitting',
  'Hitter comes out of their legs during the swing — knee bend disappears and the head rises, so the barrel never stays on plane.',
  ARRAY['loses posture', 'losing posture', 'loss of posture', 'standing up in the swing', 'standing too upright', 'standing upright', 'stands straight up', 'tall posture', 'tall through contact', 'losing bend in knees', 'no knee bend', 'popping up out of his stance', 'popping out of the stance', 'not staying in his legs', 'not staying in their legs', 'doesn''t stay in his legs']::TEXT[]
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Drill -> problem mappings for flaw strings that had no home
-- ---------------------------------------------------------------------------
-- 37 pairings across 30 drills. All inferred, all curated = FALSE.
-- sort_order 100 is the schema default and means "unsequenced" — these join
-- the pool without claiming a position in anyone's curated progression.
INSERT INTO drill_problem_map (drill_id, problem_slug, curated, sort_order)
VALUES
    ('253fee8d-d86f-497b-83db-44e622fb0a2d', 'throwing-mechanics', FALSE, 100),
    ('0339e559-16cd-4912-94f6-a895ab8dc119', 'flying-open', FALSE, 100),
    ('a54d536f-e4f0-4dd5-91d2-d007bd274250', 'inconsistent-stride', FALSE, 100),
    ('4fa59dec-86b0-46f7-bb31-f59382b1e9f4', 'cant-hit-offspeed', FALSE, 100),
    ('1c406241-97b4-425d-8f16-89ade2dbbc22', 'loses-posture', FALSE, 100),
    ('3269f5db-7541-42a7-b085-0b209f0dd8a6', 'throwing-mechanics', FALSE, 100),
    ('73f5fef2-af64-4577-998d-da854cebb0cf', 'fielding-flat-footed', FALSE, 100),
    ('f1bf25fb-0167-4b61-b196-675b2ba14280', 'uppercutting', FALSE, 100),
    ('97efe128-5367-4ad5-959e-9c32f3b565e3', 'slow-transfer', FALSE, 100),
    ('012241e0-c2ce-4a32-b037-39f90bd35437', 'throwing-mechanics', FALSE, 100),
    ('41ff62cc-fb54-4266-8d0c-083a1c341161', 'throwing-mechanics', FALSE, 100),
    ('a663b235-d115-4a52-a9d4-b33ba37e0e2a', 'cold-arm', FALSE, 100),
    ('267777ed-01d2-4985-a4aa-5a1c41299f11', 'poor-fielding-footwork', FALSE, 100),
    ('64b38072-cd1c-4f0f-a3e1-9958c8cb0736', 'throwing-mechanics', FALSE, 100),
    ('ce798b52-883f-4cf3-a6b8-311ef084a1be', 'inconsistent-release', FALSE, 100),
    ('ce798b52-883f-4cf3-a6b8-311ef084a1be', 'throwing-mechanics', FALSE, 100),
    ('874e0c3a-14d6-4edd-beed-e943c1373d6d', 'uppercutting', FALSE, 100),
    ('ba88a3cd-b2ae-430b-bd5e-d06c53f58838', 'late-timing', FALSE, 100),
    ('38d1c493-6e09-4708-8cb7-7fab7eda189f', 'loses-posture', FALSE, 100),
    ('6759598d-9bfc-47b2-91f1-31c77fc97cb5', 'cold-arm', FALSE, 100),
    ('6759598d-9bfc-47b2-91f1-31c77fc97cb5', 'throwing-mechanics', FALSE, 100),
    ('3f2af696-fe22-4fb6-936f-fefe7d86681a', 'arm-fatigue', FALSE, 100),
    ('2b5adf22-f8b1-4cfe-87e9-fe7ec1a1957e', 'arm-fatigue', FALSE, 100),
    ('2b5adf22-f8b1-4cfe-87e9-fe7ec1a1957e', 'weak-throws', FALSE, 100),
    ('0e5e88b4-7b3c-4325-b658-179e638a8c24', 'inconsistent-contact', FALSE, 100),
    ('0e5e88b4-7b3c-4325-b658-179e638a8c24', 'rolling-over', FALSE, 100),
    ('966c4b46-bc36-4589-9bce-ca0682e24c13', 'inconsistent-contact', FALSE, 100),
    ('9e9405f3-80fb-4ad6-928c-e7749be5e0f6', 'flying-open', FALSE, 100),
    ('9300e679-69a7-4757-b74d-172103654860', 'late-timing', FALSE, 100),
    ('0200c065-9f6f-4a76-bd9a-22e46141a6ce', 'throwing-mechanics', FALSE, 100),
    ('b22aa9c8-7cd1-4dc0-bba3-c66b03396e21', 'no-hip-lead', FALSE, 100),
    ('25b42f9f-7769-47ac-ad0e-f9140091660e', 'cold-arm', FALSE, 100),
    ('25b42f9f-7769-47ac-ad0e-f9140091660e', 'throwing-mechanics', FALSE, 100),
    ('3a2f690d-095d-46ea-98e8-088a7a7ea7db', 'inaccurate-throws', FALSE, 100),
    ('3a2f690d-095d-46ea-98e8-088a7a7ea7db', 'rushing-delivery', FALSE, 100),
    ('3a2f690d-095d-46ea-98e8-088a7a7ea7db', 'throwing-mechanics', FALSE, 100),
    ('73c7c466-4de3-45a1-ad1b-bfc7100bb5a0', 'no-follow-through-throw', FALSE, 100)
ON CONFLICT (drill_id, problem_slug) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect: uppercutting alias count risen from 8, one new taxonomy row.
SELECT slug, cardinality(aliases) AS aliases
FROM problem_taxonomy WHERE slug IN ('uppercutting', 'loses-posture');

-- Expect: 49 problems (was 48), 348 mappings (was 311), 75 curated (UNCHANGED).
SELECT
  (SELECT count(*) FROM problem_taxonomy)                          AS problems,
  (SELECT count(*) FROM drill_problem_map)                          AS mappings,
  (SELECT count(*) FROM drill_problem_map WHERE curated)            AS curated,
  (SELECT count(*) FROM drill_problem_map WHERE NOT curated)        AS auto;

-- Expect: the three barrel/posture orphans now reachable.
SELECT d.drill_name, m.problem_slug, m.curated
FROM drill_resources d JOIN drill_problem_map m ON m.drill_id = d.id
WHERE d.drill_name IN ('High Tee Drill', 'Don''t Dump the Barrel', 'Bucket Drill — Stay in Your Legs')
ORDER BY d.drill_name, m.problem_slug;
