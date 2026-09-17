# BenchCoach Phase 2F — Pathway Coverage Expansion Closeout

## Verdict

**COMPLETE.** All seven pathways and both migrations are applied to production,
`verify:pathways-prod` passes 104 checks with zero failures, the three
temporary helper functions are dropped, and the branch is merged to main.

## Production baseline

| | |
|---|---|
| Supabase project | `chdpqsumqospnaztvfqe` |
| Curated drills | 226 (220 + the six 071 adds) |
| Schedulable drills | 160 (154 + six) |
| Taxonomy problems | **49 — unchanged** |
| Drill-problem mappings | 400 (393 + seven) |

The taxonomy number is the one worth watching: 2F.7 said no new problem slug
would be invented as a side effect of adding drills, and 49 is that promise
still holding.

## Deployment

| | |
|---|---|
| **069** pathway schema | APPLIED |
| **070** pathway content | APPLIED — all 7 pathways, 70 stages, 212 links |
| **071** coverage expansion | APPLIED — 6 drills, 7 mappings, 17 links, 6 re-ranks, 1 link removed |
| Stage-drill links, total | **228** across 70 stages |
| `verify:pathways-prod` | **PASS — 104 checks, 0 failures** |
| `pw_st` / `pw_ds` / `pw_ps` | dropped, confirmed absent from `pg_proc` |

### What went wrong on the way, and what it cost

**071 was rejected by production on the first apply.** `practice_roles` was set
to `{teach,prepare}` on three of the six new drills, and `prepare` is not a
valid role — the column has a CHECK constraint listing eleven allowed values
and `prepare` is not among them. I had taken the word from the pathway
sequence vocabulary (`prepare → teach → isolate → …`), which is a different
list for a different table.

It reached production because `test-migration-071.sh` built its
`drill_resources` stub with no CHECK constraints at all, so the local test
proved only that the SQL parsed. The stub now carries the real constraints
copied from production, and the three rows are `{teach,repetition}`, which is
what they actually are. Cost: one failed apply, no data written — the
migration is transactional and nothing partial landed.

**Two assertions in `verify-pathways-production.ts` were stale.** It asserted
exactly four pathways, written when the Phase 2E brief asked for four; three
more were curated and applied afterwards and the number was never moved. And
its library baseline was the Phase 2D snapshot, which 071 deliberately moves.
Both are now the deployed numbers. A count that lags what is deployed passes
while the deployment is incomplete, which is the opposite of the job.

**One check in `verify-071.ts` was single-state.** It asserted the six new
drills did not exist yet, which stopped being true the moment 071 succeeded.
It now asserts the right thing in either state and fails on a partial set.

## Coverage before

| | |
|---|---|
| READY | 43 |
| THIN | 26 |
| GAP | 1 |

| Pathway | READY / THIN / GAP |
|---|---|
| Build the Swing | 9 / 0 / 1 |
| Infield Fundamentals | 10 / 1 / 0 |
| Throwing Development | 11 / 0 / 0 |
| Outfield Development | 7 / 4 / 0 |
| Pitching Development | 3 / 8 / 0 |
| Catching Development | 1 / 5 / 0 |
| Baserunning Development | 2 / 8 / 0 |

## Canonical gap review

All 27 THIN/GAP stages reviewed, one row each, in
`docs/audits/development-pathway-canonical-gap-audit.csv`.

| Disposition | Count |
|---|---|
| Stages reviewed | 27 |
| ADD_CANONICAL | 6 |
| MATCH_EXISTING | 9 |
| VARIATION_OF | 0 |
| PROGRESSION_OF | 0 |
| TEACHING_CONTENT | 0 |
| SKIP | 12 |
| REVIEW | 0 |

The `existing_candidate_disposition` column, which records what was found
rather than what was decided: `ALREADY_COVERED` 17, `DISTINCT_CANONICAL_MISSING`
6, `NO_NEW_DRILL_NEEDED` 2, `VARIATION_ONLY` 2.

**Six of the candidates the brief proposed were rejected as duplicates of rows
the library already holds under different names:**

| Brief's candidate | Already in the library as |
|---|---|
| Segmented Delivery Drill | 4-Part Windup Drill — Breaking Down the Delivery |
| Stride-Line Landing Drill | Stride Direction Drill — Using a Chalk Line or Tape |
| Front-Side Stability Drill | Glove-Side Pull Drill — Front Side Control |
| Tempo / Momentum Delivery Drill | The Swing Shuffle Drill — Momentum & Rhythm |
| Quiet Hands Receiving | Youth Receiving Foundations — Quiet Glove & Soft Hands *(already the stage primary)* |
| Blocking Reaction / Game-Speed Blocking | Game-Speed Reaction Blocking |

Two more were classified rather than written: the **outfield knee-down block**
is the routine ground ball with the urgency removed, so it lives inside that
drill as its easier version rather than taking a row; the **outfield fence
carom** is a genuinely absent teaching job but is deferred, because most fields
these teams play on have no fence.

The duplication checks were run against the whole schedulable pool, not a
sample. `npm run index:library` was added for this — it prints all 154 rows
with what each trains and what it is mapped to fix.

## New canonical drills

Six. Review sheet: `docs/audits/new-canonical-review.csv`.

**1. Grip Check — Find It Without Looking** · Hitting · `2578d426`
- *Teaching job:* find and check the grip as its own rep
- *Stage:* Build the Swing / `grip` — primary
- *Taxonomy:* `rolling-over`
- *Provenance:* BenchCoach original. Searched all 47 Hitting, 3 Soft Toss and 3 Bunting rows; exactly one carries "grip" in `mechanic_focus` — the stance drill, where grip is one of five things it trains.
- *Distinct because:* the stance drill gives the grip one clause of set-up and one mastery signal. This makes the pick-up itself the rep, which is the only way it is a drill rather than teaching content.

**2. Pick Your Hop — Read It and Move to It** · Fielding (Infield) · `31f82124`
- *Teaching job:* choose the hop — charge to create a long one, give ground to take a short one
- *Stage:* Infield Fundamentals / `reading-hops` — primary
- *Taxonomy:* `poor-fielding-footwork`, `fielding-flat-footed`
- *Provenance:* BenchCoach original. All 20 Fielding (Infield) rows checked.
- *Distinct because:* Recovery Drill handles a hop after it has gone wrong, Advanced First Base picks short hops at the bag, Wall Ball gives solo short hops. None makes the fielder *decide*. Highest-confidence candidate in the audit.

**3. Ready and Go — Outfield First Step** · Fielding (Fly Balls) · `cef00f99`
- *Teaching job:* pre-pitch ready position and a first step in any direction
- *Stage:* Outfield Development / `ready-and-first-step` — primary
- *Taxonomy:* `slow-first-step`
- *Provenance:* BenchCoach original.
- *Distinct because:* the drop-step drill covers balls hit overhead only; On the Run starts the fielder already moving. **Conditional:** written as balls in four directions from a set start. If it drifts into balls over the head it is a renamed drop step and should be withdrawn.

**4. Routine Outfield Ground Ball — Field It and Come Up Throwing** · Fielding (Fly Balls) · `93566e0d`
- *Teaching job:* the ordinary single through the infield, plus the knee-down block
- *Stage:* Outfield Development / `ground-ball-approach` — primary
- *Taxonomy:* `poor-fielding-footwork`
- *Provenance:* BenchCoach original.
- *Distinct because:* Do-or-Die is explicitly the highest-urgency version. Different feet, different risk, different right answer. Do-or-Die moves to the progression slot it belongs in.

**5. Changeup Off the Mound — Same Arm Speed, Real Sequence** · Pitching · `20d240e9`
- *Teaching job:* the second pitch from a mound, in sequence, to a hitter
- *Stage:* Pitching Development / `second-pitch` — progression
- *Taxonomy:* `no-changeup`
- *Provenance:* BenchCoach original.
- *Distinct because:* the only changeup drill in the library is flat-ground catch play. Changeup only — no breaking ball is proposed for this age band. Carries a throwing-load safety note.

**6. Catcher's Stance — Set Up to Receive** · Catching · `43aa8d15`
- *Teaching job:* the stance every other catching drill assumes
- *Stage:* Catching Development / `receiving-foundation` — regression
- *Taxonomy:* `catcher-receiving`
- *Provenance:* BenchCoach original. All 6 Catching rows checked.
- *Distinct because:* all six assume a catcher already crouched. Distinct from One-Knee Receiving, which is a later setup for a catcher who has outgrown two knees.

All six are runnable with **no video at all**. None references media.

## Existing drills reused

The main finding of the phase. Nine stages were thin because a drill the
library already held was attached to no stage that wanted it.

| Stage | Drill attached | Result |
|---|---|---|
| Pitching / `delivery-in-parts` | Throwing Progression — Knee, Hip, Full | THIN → READY |
| Pitching / `stride-and-landing` | Towel Drill | THIN → READY |
| Pitching / `front-side` | Square Hips / Hip Lock Drill | THIN → READY |
| Pitching / `release-point` | Wrist Snap Drill | THIN → READY |
| Pitching / `momentum-and-tempo` | The Rocker Drill | THIN → READY |
| Baserunning / `out-of-the-box` | Base Running Circuit + Simple Base Running Drills | THIN → READY |
| Baserunning / `turns-and-angles` | First Base Decision | THIN → READY |
| Baserunning / `pop-up-slide` | Sliding Practice Stations | THIN → READY |
| Baserunning / `leads` | Pro Base-Stealing Package + Steal Breaks | THIN → READY |

Nine stages, zero new content.

### A curation defect of mine, corrected

Baserunning stage 1 reinforced *"out of the box"* with **Baseball Dynamic
Stretches for Youth Players** — an Athletic Development row whose teaching job
is warming up, mapped to `cold-arm`. That is exactly the category-match error
Phase 2E's own curation rules forbid, and I made it. 071 removes the link and
attaches two rows that actually train the first step.

## Coverage after

Measured by applying 069, 070 and 071 to a real PostgreSQL and reading the
resulting database, not by arithmetic on the before-table.

| | Before | After |
|---|---|---|
| READY | 43 | **56** |
| THIN | 26 | **14** |
| GAP | 1 | **0** |

| Pathway | Before | After |
|---|---|---|
| Build the Swing | 9 / 0 / 1 | 9 / 1 / 0 |
| Infield Fundamentals | 10 / 1 / 0 | **11 / 0 / 0** |
| Throwing Development | 11 / 0 / 0 | 11 / 0 / 0 |
| Outfield Development | 7 / 4 / 0 | 9 / 2 / 0 |
| Pitching Development | 3 / 8 / 0 | 8 / 3 / 0 |
| Catching Development | 1 / 5 / 0 | 2 / 4 / 0 |
| Baserunning Development | 2 / 8 / 0 | 6 / 4 / 0 |

**Build the Swing's grip stage goes GAP → THIN, not READY.** It has two drills
and the threshold is three. The threshold was not moved. Neither was a third
grip drill invented to clear it.

**Pitching's second-pitch stage stays THIN** for the same reason: two changeup
drills, threshold three, and a breaking-ball drill is not something this
library should have for 11–14 year olds.

## Highest-leverage additions

Leverage is low by design, and that is the honest headline: **nine of the
fourteen stages that improved needed no new drill at all.**

Of the six new rows:
- 4 moved a stage THIN → READY (hop reading, outfield first step, routine outfield ground ball, catcher's stance)
- 1 closed the library's only GAP, to THIN (grip check)
- 1 changed no status (changeup off the mound — the stage goes from 1 drill to 2, still under threshold)

≈0.83 stage improvements per new drill. No new drill improved more than one
stage, because each was written for a teaching job that was missing in exactly
one place. A drill that improved three stages would be a sign it was written
vaguely.

## Taxonomy

| | |
|---|---|
| Mappings added | 7 |
| New problem slugs invented | **0** |
| Problems strengthened | 6 |
| Starved (<3 schedulable drills) before | 10 |
| Starved after | **10** |
| Problems with zero prescribable drills, before and after | **0** |

| Problem | Before | After |
|---|---|---|
| `poor-fielding-footwork` | 14 | 16 |
| `fielding-flat-footed` | 7 | 8 |
| `rolling-over` | 6 | 7 |
| `slow-first-step` | 3 | 4 |
| `catcher-receiving` | 1 | **2** |
| `no-changeup` | 1 | **2** |

The starved count does not move. Two starved problems doubled their coverage
and neither crossed the threshold of three. Reporting 10 → 10 is the accurate
number; the two that improved are named above rather than hidden in it.

Still starved: `plate-confidence` (1), `fear-fly-balls` (1), `bad-base-turns` (2),
`balance-leg-lift` (2), `catcher-receiving` (2), `catcher-blocking` (2),
`no-situational-hitting` (2), `arm-fatigue` (2), `two-strike-approach` (2),
`no-changeup` (2).

Two mappings are acknowledged half-fits, recorded as such in the gap audit: the
grip station maps to `rolling-over` because rolled knuckles limit the wrist
hinge, and the routine outfield ground ball maps to `poor-fielding-footwork`,
an infield-framed slug doing double duty. No new slug was proposed — that is a
taxonomy decision and should not be made as a side effect of adding six drills.

## Data writes

All figures are what migration 071 *will* write. Nothing is applied.

| | |
|---|---|
| Drill rows inserted | 6 |
| Drill rows updated | 0 |
| Drill rows retired | 0 |
| Taxonomy mappings inserted | 7 |
| Pathway stage-drill links inserted | 17 |
| Pathway stage-drill links updated (re-rank / re-role) | 6 |
| Pathway stage notes rewritten | 6 |
| **Rows deleted from the drill library** | **ZERO** |
| Rows deleted, total | 1 — the mis-curated Baserunning stage-1 link, which is Phase 2E data, not library data |
| Functions dropped | 3 — `pw_st`, `pw_ds`, `pw_ps` |

## Media

| | |
|---|---|
| Media attached | 0 |
| Timestamps added | 0 |
| Verified media added | 0 |

All three are zero and were always going to be. No new row references a video,
and `verify:071` check 7 asserts the migration does not touch the media table,
`start_seconds` or `verification_status` at all.

## Tests

| Suite | Result |
|---|---|
| `npm run test:pathways` | **92 passed, 0 failed** (was 91 — one added this phase) |
| `npm run verify:071` | **10 of 10 pass**, against live production |
| `npm run test:migration-071` | **14 of 14 pass** against a real PostgreSQL 16 |
| `npm run test:migration-070` | **11 of 11 pass** |
| `npm run verify:pathways-prod` | **PASS — 104 checks, 0 failures**, against live production |
| `npm run typecheck:baseline` | **196** — baseline held |
| `npm run emit:pathways` (reproducibility) | 070 regenerates byte-identical from the fixture |
| `npm run lint` | **not configured in this repo** — not claimed |

`test:migration-071` matters most here. 071 is hand-written, so the quoting
class of bug that generated SQL cannot have is back, and it has never run in
production. It now runs, applies on top of 069+070, adds exactly six rows,
removes none, invents no problem slug, leaves no stage empty, is idempotent on
a second run, and drops the three helpers.

### A defect found and fixed in `lib/developmentPathways.ts`

Not part of the 2F brief, but production surfaced it while verifying 2E.
`planPracticeBlock` clears its used-drill set at a stage boundary so the next
stage still leads with its own primary. The side effect: a drill attached to
two stages came back in a later practice and the note still read *"All new
drills for this stage."* In Build the Swing the stance drill is stage 1's
primary and stage 2's only option, so a coach running a three-practice block
got it twice and was told everything was new. Fixed by keeping the per-stage
set for ordering and adding a block-wide set for reporting. Regression test
added. Committed as `dd5e8de`.

## Remaining thin areas

14 stages, and most of them should stay that way.

- **Catching (4 THIN)** — the genuinely thinnest area, 7 drills after 071. Real missing teaching jobs, none invented here: **pop-ups and foul balls**, **fielding bunts and plays at the plate**, **throws to bases other than second**. None has a pathway stage yet, so none appears in the gap audit; they are pathway gaps, not stage gaps.
- **Baserunning (4 THIN)** — all four are two-drill stages where two is the right number. Sliding deliberately so: a third sliding drill means more repetitions on grass in cleats, which is a safety cost and not a coaching gain.
- **Pitching (3 THIN)** — second pitch (2 changeup drills), finish and follow-through (one drill that does the whole job), balance (the library's only two balance drills, both attached).
- **Outfield (2 THIN)** — drop step and do-or-die, each one play with two drills. Plus the deferred fence carom.
- **Build the Swing (1 THIN)** — the grip stage at two drills.

Per 2F.10, none of these is chased. Twelve of the 27 reviewed stages were
marked SKIP precisely because a third drill would turn a row green and teach a
coach nothing.

## Recommendation for next phase

The deployment is done, so the list is shorter than it was:

1. ~~Finish 070, then 071.~~ **Done.** Both applied, verification green, helpers
   dropped, branch merged.
2. **Rotate the production `service_role` key.** Still outstanding from Phase
   1.5, still P0, still an operator action. The committed credential has not
   been confirmed rotated. The Anthropic API key pasted into chat earlier is in
   the same position.
3. **Phase 2G.** The candidate with the most leverage is
   not more drills — it is putting the pathways in front of a coach. The
   Practice Plan API accepts a `pathwaySlug` today and no interface passes one,
   so the whole layer is invisible. A pathway picker on the practice page would
   make 70 stages and 229 curated links reachable, and would tell us within a
   week whether coaches want a sequence or just a drill.

Carried, unchanged: `verify:video-links` is red on `components/PlanReview.tsx:67`
and predates all of this.
