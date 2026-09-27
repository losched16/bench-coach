# Current production snapshot — BenchCoach drill system

**Prepared for external review. Read-only: nothing in the database, the drill
library, the taxonomy or the pathways was modified to produce this.**

| | |
|---|---|
| Snapshot taken | 2026-09-27 01:19 UTC |
| Supabase project | `chdpqsumqospnaztvfqe` (production) |
| Repository state | `main` at `67e87ef`, 2026-09-21 17:15:34 -0400 |
| Read method | PostgREST, `service_role`, `SELECT` only |
| Companion files | `current-drill-inventory.csv`, `current-taxonomy-coverage.csv`, `current-pathway-coverage.csv`, `drills-added-since-phase2f.csv` |

Every figure below was read from production at that timestamp. Nothing is
inferred. Where a value does not exist it is marked **unknown** rather than
estimated.

---

## 1. Definitions used

These are taken from the code that ships, not invented for this document. A
reviewer comparing these numbers against the app should use the same ones.

**Curated** — `drill_resources.created_by_coach_id IS NULL`. Coach-authored
drills are excluded. In this snapshot there are **none**, so curated = every
row in the table.

**Schedulable** — `lib/drills.ts → isSchedulable()`, in its order:

1. a row with `duplicate_of_drill_id` set is never schedulable, whatever its kind;
2. `resource_kind` in `['source_collection', 'teaching_content']` is never schedulable;
3. `practice_unit` is schedulable unless the caller passes `practiceUnits: false`;
4. everything else, including a null kind, is schedulable.

**Prescribe-compatible** — the same, with `practiceUnits: false`. This is the
pool `app/api/prescribe/route.ts:239` actually draws from.

---

## 2. Current library counts

| Measure | Count | Source |
|---|---:|---|
| **Total curated** | **245** | `created_by_coach_id IS NULL` |
| Coach-created (excluded) | 0 | |
| **Schedulable** | **179** | `isSchedulable()` |
| **Prescribe-compatible** | **160** | `isSchedulable(practiceUnits:false)` |
| Canonical activities | 178 | `resource_kind='activity'` |
| Practice units | 21 | `resource_kind='practice_unit'` |
| Source collections | 26 | `resource_kind='source_collection'` |
| Teaching content | 20 | `resource_kind='teaching_content'` |
| **Duplicates / hidden** | **20** | `duplicate_of_drill_id IS NOT NULL` |
| **Review-required** | **0** | see note below |
| Activity families | 18 | distinct non-null `activity_family_id` |
| Taxonomy problems | 49 | `problem_taxonomy` |
| Drill→problem mappings | 403 | `drill_problem_map` |

`178 + 21 + 26 + 20 = 245`. The 20 duplicates sit inside those kind counts
(chiefly inside `activity`), which is why schedulable is 179 and not 199.

### Review-required is zero, and that is a real zero

Every one of the 245 rows has `status = 'approved'`. There is no
`review_required`, `retired` or `draft` row in production. The status column
exists and carries exactly one value.

### Variations and progressions

The request asked for "variations" and "progressions" as separate counts. The
column that carries this is `variation_type`, and it has five values. Rather
than collapse them into two buckets and lose information, the full breakdown:

| `variation_type` | Count |
|---|---:|
| (null) | 212 |
| base | 18 |
| progression | 10 |
| advanced | 3 |
| regression | 1 |
| space_variant | 1 |

If "variations" is meant as "rows that are a variant of some base activity",
that is the 15 rows that are `progression`, `advanced`, `regression` or
`space_variant`. If it is meant as "rows participating in a family at all",
that is 33. **The column does not distinguish these, so the choice is the
reviewer's.** Per-drill family relationships are in the inventory CSV
(`activity_family_id`, `variation_type`, `family_siblings`).

---

## 3. Taxonomy coverage

Full detail: **`current-taxonomy-coverage.csv`** — one row per problem, with
schedulable count, prescribe-compatible count, a coverage flag, and the names
of the covering drills.

**All 49 problems have at least one schedulable drill. Zero problems are
uncovered.**

| Coverage | Problems |
|---|---:|
| 0 schedulable drills | **0** |
| exactly 1 | **2** |
| exactly 2 | **6** |
| 3 or more | 41 |

The eight thin ones:

| Problem | Schedulable | Prescribe-compatible |
|---|---:|---:|
| `fear-fly-balls` | 1 | 1 |
| `plate-confidence` | 1 | 1 |
| `balance-leg-lift` | 2 | 2 |
| `catcher-blocking` | 2 | 2 |
| `inconsistent-stride` | 2 | 2 |
| `no-changeup` | 2 | 2 |
| `no-situational-hitting` | 2 | 2 |
| `two-strike-approach` | 2 | 2 |

For every problem in this snapshot the schedulable and prescribe-compatible
counts are equal, meaning no problem depends on a `practice_unit` for its
coverage.

**17 of the 179 schedulable drills carry no taxonomy mapping at all.** They are
findable and plannable but will never be prescribed for a named problem. Those
rows are identifiable in the inventory CSV by `taxonomy_mapping_count = 0`.

---

## 4. Pathway coverage

Full detail: **`current-pathway-coverage.csv`** — one row per stage, with
objective, linked drill count, distinct schedulable activities, every linked
drill and its role, and the under-three flag.

**8 published pathways, 80 stages, 272 stage-drill links.** All 8 pathways have
`status = 'published'`; there are no drafts.

**No stage has zero schedulable drills.**

**14 of 80 stages have fewer than 3 distinct schedulable activities** — 1 stage
with one, 13 with two:

| Pathway | Stage | Distinct | Stage name |
|---|---:|---:|---|
| baserunning-development | 2 | 2 | Through it or around it |
| baserunning-development | 4 | 2 | Sliding: the shape |
| baserunning-development | **8** | **1** | Tagging up |
| baserunning-development | 9 | 2 | Reading a ball in the dirt |
| build-the-swing | 2 | 2 | Grip |
| catching-development | 2 | 2 | Framing and working the zone |
| catching-development | **3** | **1** | Blocking: the shape |
| catching-development | 4 | 2 | Blocking at game speed |
| catching-development | 6 | 2 | The one-knee setup |
| outfield-development | 2 | 2 | Drop step |
| outfield-development | 10 | 2 | Do or die |
| pitching-development | 2 | 2 | Balance at the leg lift |
| pitching-development | 9 | 2 | Finish and follow-through |
| pitching-development | 11 | 2 | A second pitch |

This figure is not new or hidden: `verify:pathway-ui-prod` prints
`focused stages 14` in its own output, and the picker labels them
**"Focused stage"** to the coach. Whether 14 thin stages is acceptable is a
curation judgement this snapshot does not make.

`speed-and-agility-development` and `throwing-development` have **no** stage
under three.

---

## 5. Drill inventory

**`current-drill-inventory.csv`** — 179 rows, one per schedulable drill, 41
columns: identity, category, kind, family and variation relationships with
named siblings, taxonomy mappings, difficulty, age fit, practice roles,
duration, equipment, space, environment, player and coach counts, media
presence and verification, provenance, status, created_at, pathway memberships
with stage and role, and prescribe-compatibility.

Non-schedulable rows (collections, teaching content, duplicates) are **not** in
this file, matching the request for "every schedulable drill". Their counts are
in §2.

### Media

| | Count |
|---|---:|
| Schedulable drills | 179 |
| With a YouTube video | 139 |
| **With no media at all** | **40** |
| Of those with video, `url_verified_at` set | **38** |
| With video but never verified | **101** |

**101 of 139 videos carry no verification timestamp.** `url_verified_at` is
null for them, so this snapshot reports them as `unverified` — it does not
assert the links are broken, only that nothing recorded a check.

### Pathway membership

| | Count |
|---|---:|
| Schedulable drills used by ≥1 pathway stage | 165 |
| Used by no pathway | 14 |

---

## 6. Drills added since Phase 2F / migration 071

**`drills-added-since-phase2f.csv`** — 19 rows.

### How the boundary was established

Not by timestamp guessing. `created_at` in production clusters like this:

| Date | Rows | Cumulative |
|---|---:|---:|
| 2026-02-23 | 163 | 163 |
| 2026-08-04 | 43 | 206 |
| 2026-09-07 | 2 | 208 |
| 2026-09-15 | 3 | 211 |
| 2026-09-16 | 9 | 220 |
| 2026-09-17 | 6 | **226** |
| 2026-09-20 | **19** | **245** |

226 is exactly the figure Phase 2F recorded, and the 6 rows on 2026-09-17 are
migration 071's documented "six canonical drills". Everything after that
boundary is the 19 rows of 2026-09-20.

**Cross-checked independently:** the 19 UUIDs were parsed directly out of the
`INSERT INTO public.drill_resources` block in
`migrations/074_speed_agility_pathway.sql` and matched against production. All
19 matched; zero rows in the post-boundary set were absent from that SQL, and
zero ids in the SQL were missing from production.

### What the 19 are, and why

Only two migrations at or after 071 insert into `drill_resources`: **071** and
**074**. All 19 came from 074.

| Field | Value |
|---|---|
| Migration | `074_speed_agility_pathway.sql` |
| Commit | `c8dbd14` — *Apply 074 to production, in chunks that could be checked* |
| Applied | 2026-09-20 |
| Reason | *"The library holds almost no movement content — two rows under Athletic Development, one of which is a stretching routine — so stages 1-7 could not be built from it."* (074 header) |
| Intended gap | Speed & Agility pathway stages 1–7. Stages 8–10 were built entirely from 14 pre-existing drills. |
| Provenance | *"GENERATED by scripts/emit-speed-pathway.ts from scripts/fixtures/speed-agility.ts. Edit the fixture, not this file."* |
| Duplicate check documented | **Yes** |

The duplicate check is explicit in the migration header. The emitter refuses to
produce the file if a drill name does not resolve, **resolves to more than one
row**, resolves to something unschedulable, or **names a drill it is also
creating (a duplicate)**. The header also records that no existing drill row is
modified or deleted, no media attached, no timestamp written and nothing marked
verified.

`verify:speed-drills` re-checks all 19 against the fixture and passes.

---

## 7. Production verification scripts — exact results

Run against production at snapshot time, from `main` at `67e87ef`. Output is
reproduced as printed.

| Script | Result | Exit |
|---|---|---:|
| `verify:pathways-prod` | **PASS** | 0 |
| `verify:pathway-ui-prod` | **PASS** | 0 |
| `verify:player-pathways-prod` | **PASS** | 0 |
| `verify:071` | **PASS** | 0 |
| `verify:speed-drills` | **PASS** — all 19 drills match the fixture exactly | 0 |
| `verify:finder-prod` | **FAIL — 1 check** | 1 |

### The one failure, in full

```
FAIL the schedulable pool is the expected size            179 of 245 curated
```

```
ok   the mapping read succeeds under RLS                  403 mappings
ok   all four reads inside a sensible page load           869ms for four queries
FAIL the schedulable pool is the expected size            179 of 245 curated
ok   no collection, tutorial or duplicate in the pool     0 leaked
ok   every card has a purpose line                        179/179
...
ok   every drill is findable by its own name              179/179
ok   the channel is not searchable                        0 hits
ok   drills carry their curated problems                  162/179 show a "Use it when" section
ok   the variations row has real content                  26 drills show labelled variations
ok   context chips render where defensible                179/179 carry at least one chip
FAIL — 1 check(s)
```

**This is a stale assertion in the script, not a defect in production.**
`scripts/verify-finder-production.ts:84` reads:

```ts
check('the schedulable pool is the expected size', drills.length === 154, …)
```

154 was the Phase 2D figure. The pool went to 160 by Phase 2F and is 179 now.
The constant was never moved. Every other check in that script — including
`no collection, tutorial or duplicate in the pool: 0 leaked` — passes against
the current 179.

**It has not been changed**, per the instruction not to modify anything. An
identical stale-constant failure was corrected in
`scripts/verify-pathways-production.ts` on 2026-09-21 (`9daf3ab`), where the
exact equalities were replaced with floors; this script was not part of that
change.

---

## 8. Unknowns and limits

Stated rather than papered over.

1. **`url_verified_at` is null on 101 of 139 videos.** Reported as
   `unverified`. This snapshot did **not** fetch any video URL, so it makes no
   claim about whether those links resolve.
2. **"Variations" is ambiguous** against the schema — see §2. Two defensible
   readings are given; neither is presented as the answer.
3. **`source` is the only provenance column** on `drill_resources` and is
   carried verbatim into the inventory CSV. For rows where it is null, the
   inventory shows empty. No provenance was reconstructed from elsewhere.
4. **The "reason added" and "duplicate check" fields** in
   `drills-added-since-phase2f.csv` are quoted from the migration file header.
   They are documentation of intent, not independent confirmation that the
   check ran on every row.
5. **Coverage counts are of mappings, not of quality.** A problem with three
   mapped drills is not asserted to be well served, only to be mapped.
6. **No coach-created drills exist**, so nothing here describes how the library
   behaves once coaches author their own.
