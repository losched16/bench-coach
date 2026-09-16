-- ============================================================================
-- 064 — A duplicate is not a variation
-- ============================================================================
--
-- WHAT FAMILY MEMBERSHIP COULD NOT SAY
--
-- Phase 1 expressed a merge as shared family membership: "Front Toss" and
-- "Front Toss Drill" joined one family, and the scheduler's family-redundancy
-- rule stopped it putting both in the same practice. That was enough to keep a
-- plan sensible and it was NOT enough for the product, because a coach browsing
-- the drill library still saw two rows that are the same drill.
--
-- Family says "these are related". It cannot say "these are the same thing, and
-- this one is the one to show".
--
-- WHY NOT status='retired', WHICH ALREADY EXISTS
--
-- Because visibleDrills filters on `status.eq.approved,status.is.null`, and
-- visibleDrills is ALSO the historical path — the one that resolves a drill id
-- stored on a finalized player report or a saved practice plan. Retiring a
-- duplicate would hide it from discovery and from history in the same stroke,
-- and a coach's 2026 report would lose the drill it recommended.
--
-- So this is a separate axis, and the whole point of it is that it is read by
-- discovery and ignored by resolution:
--
--   visibleDrills      ignores it   — a stored id still resolves
--   schedulableDrills  excludes it  — it is never offered again
--
-- WHAT IT IS NOT FOR
--
-- Only TRUE duplicates: the same activity, written twice. A variation is a
-- different activity (One-Hand Tee, top hand versus bottom hand). A progression
-- is a different activity (Long Toss versus Long Toss Progression). Both of
-- those are real things a coach might choose between, and both stay in the
-- library as their own rows with their own family roles. Putting either one
-- here would delete a choice the coach should be making.
--
-- THE TWO INVARIANTS, ENFORCED RATHER THAN DOCUMENTED
--
--   1. no self-reference — a row cannot be its own canonical
--   2. no chains — the canonical target cannot itself be a duplicate
--
-- (2) matters more than it looks. A -> B -> C means resolving "the real drill"
-- takes an unbounded walk, and a cycle makes it hang. A CHECK constraint cannot
-- see another row, so it is a trigger, and the trigger refuses in both
-- directions: you cannot point at a duplicate, and you cannot turn a row that
-- others point at into a duplicate.
--
-- Additive and idempotent. No row is deleted and no drill_name, description or
-- video column is touched.
-- ============================================================================

ALTER TABLE public.drill_resources
  ADD COLUMN IF NOT EXISTS duplicate_of_drill_id UUID;

COMMENT ON COLUMN public.drill_resources.duplicate_of_drill_id IS
  'Set when this row is THE SAME ACTIVITY as another, written twice. The row '
  'stays resolvable by id through visibleDrills so history keeps working, and '
  'is excluded from schedulableDrills so it is never offered again. NOT for '
  'variations or progressions — those are different activities.';

-- ON DELETE RESTRICT, deliberately. Nothing in this library is deleted, and if
-- somebody tries to delete a canonical that duplicates point at, the right
-- outcome is a refusal rather than a cascade that takes the duplicates with it
-- or a SET NULL that silently promotes them back into discovery.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.drill_resources'::regclass
                   AND conname = 'drill_resources_duplicate_of_fkey') THEN
    ALTER TABLE public.drill_resources
      ADD CONSTRAINT drill_resources_duplicate_of_fkey
      FOREIGN KEY (duplicate_of_drill_id)
      REFERENCES public.drill_resources(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.drill_resources'::regclass
                   AND conname = 'drill_resources_duplicate_not_self') THEN
    ALTER TABLE public.drill_resources
      ADD CONSTRAINT drill_resources_duplicate_not_self
      CHECK (duplicate_of_drill_id IS NULL OR duplicate_of_drill_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drill_resources_duplicate_of
  ON public.drill_resources (duplicate_of_drill_id)
  WHERE duplicate_of_drill_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- No chains, in both directions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drill_duplicate_no_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_points_at UUID;
  dependents INT;
BEGIN
  IF NEW.duplicate_of_drill_id IS NOT NULL THEN
    SELECT duplicate_of_drill_id INTO target_points_at
      FROM public.drill_resources WHERE id = NEW.duplicate_of_drill_id;

    IF target_points_at IS NOT NULL THEN
      RAISE EXCEPTION
        'drill % cannot duplicate %, which is itself a duplicate of % — point at the canonical row instead',
        NEW.id, NEW.duplicate_of_drill_id, target_points_at;
    END IF;
  END IF;

  -- The other direction: a row other rows already point at is a canonical, and
  -- making it a duplicate would create the chain from the far end.
  IF NEW.duplicate_of_drill_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.duplicate_of_drill_id IS DISTINCT FROM NEW.duplicate_of_drill_id) THEN
    SELECT count(*) INTO dependents
      FROM public.drill_resources WHERE duplicate_of_drill_id = NEW.id;

    IF dependents > 0 THEN
      RAISE EXCEPTION
        'drill % is the canonical for % other row(s) and cannot itself become a duplicate',
        NEW.id, dependents;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_drill_duplicate_no_chain ON public.drill_resources;
CREATE TRIGGER trg_drill_duplicate_no_chain
  BEFORE INSERT OR UPDATE OF duplicate_of_drill_id ON public.drill_resources
  FOR EACH ROW EXECUTE FUNCTION public.drill_duplicate_no_chain();

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Every duplicate points at a canonical that is itself not a duplicate, and no
-- row points at itself. Both must be 0:
--
--   SELECT
--     count(*) FILTER (WHERE d.duplicate_of_drill_id = d.id) AS self_refs,
--     count(*) FILTER (WHERE c.duplicate_of_drill_id IS NOT NULL) AS chains
--   FROM drill_resources d
--   LEFT JOIN drill_resources c ON c.id = d.duplicate_of_drill_id
--   WHERE d.duplicate_of_drill_id IS NOT NULL;
--
-- And every duplicate must still be reachable by id, which is what
-- scripts/test-duplicates.ts asserts rather than this comment.
