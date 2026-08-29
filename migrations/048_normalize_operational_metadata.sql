-- 048_normalize_operational_metadata.sql
--
-- One value, spelled one way.
--
-- Two controlled columns that retrieval filters on have been storing the same
-- meaning under more than one spelling:
--
--   space_required   "Full Field" (14 rows) and "Full field" (13 rows)
--   indoor_outdoor   "Both" (93 rows) and "Indoor/Outdoor" (45 rows)
--
-- To be precise about the blast radius, because it would be easy to overstate
-- this: retrieval is NOT currently returning wrong results because of it.
-- Both spaceEligible() and environmentEligible() lowercase before matching,
-- and environmentEligible() treats a value containing "/" as "either", so
-- every one of these four spellings already behaves correctly today.
--
-- This is therefore data hygiene, not a bug fix. It is worth doing anyway:
-- a controlled column with two spellings of one value is a trap for the next
-- person who writes a GROUP BY, an admin filter, or a query that does not
-- happen to lowercase — and the variants split across provenance (both appear
-- under source = ai_expansion_008 AND source IS NULL), so they are genuine
-- inconsistency rather than a batch marker worth preserving.
--
-- Deliberately NOT done here: widening the matching in lib/drillRetrieval.ts.
-- The lowercasing that exists is right, but making the filters more forgiving
-- than that would hide the next malformed value instead of surfacing it.
-- scripts/test-practice-scheduler.ts asserts every historical variant still
-- resolves identically, so this migration cannot quietly change eligibility.
--
-- Canonical forms chosen as the majority spelling already in the table.

BEGIN;

-- "Full field" -> "Full Field"  (13 rows)
UPDATE drill_resources
SET space_required = 'Full Field'
WHERE space_required = 'Full field';

-- "Indoor/Outdoor" -> "Both"  (45 rows)
--
-- These mean the same thing to every consumer: the drill works in either
-- place. "Both" wins on count and reads better in the one place this column
-- is shown to a human.
UPDATE drill_resources
SET indoor_outdoor = 'Both'
WHERE indoor_outdoor = 'Indoor/Outdoor';

COMMIT;

-- Verification. Expect exactly:
--   space_required   Small 90, Medium 82, Full Field 27, Outfield/large 5, Medium-large 2
--   indoor_outdoor   Both 138, Outdoor 68
--
-- SELECT space_required, count(*) FROM drill_resources
--  WHERE status = 'approved' GROUP BY 1 ORDER BY 2 DESC;
-- SELECT indoor_outdoor, count(*) FROM drill_resources
--  WHERE status = 'approved' GROUP BY 1 ORDER BY 2 DESC;
--
-- And no variant survives:
-- SELECT count(*) FROM drill_resources
--  WHERE space_required = 'Full field' OR indoor_outdoor = 'Indoor/Outdoor';
-- -- expect 0
