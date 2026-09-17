# BENCHCOACH PHASE 2G — PATHWAYS IN PRACTICE PLAN CLOSEOUT

## Verdict

**COMPLETE**, with one named gap: nobody has opened the shipped picker in a
browser on the production domain, because this environment cannot reach it.
Every other acceptance criterion is met and evidenced.

## Production baseline

| | |
|---|---|
| main at start | `ea4dddb` |
| Published pathways | 7 |
| Stages | 70 |
| Stage-drill links | 228 |
| `verify:pathways-prod` | PASS — 104 checks |
| Migrations applied | 069, 070, 071 |
| Curated / schedulable drills | 226 / 160 |
| Taxonomy problems | 49 |

## Existing architecture reused

- **Pathway loaders** — `loadPathways`, `loadPathway`, `orderedStages`,
  `nextStage`, `previousStage` from `lib/developmentPathways.ts`. Unchanged.
- **API contract** — `pathwaySlug` and `pathwayStage` on
  `POST /api/practice-plan`, accepted since Phase 2E and never sent by any UI.
  Now sent. The route is unchanged.
- **Planner integration** — `getPathwayPracticeRecommendation` inside the
  route, unchanged. No second recommendation system.
- **Builder handoff** — the existing NDJSON `skeleton`/`block`/`plan` flow and
  the existing `PlanReview`. The route has streamed a `pathway` message since
  2E; the page was dropping it and now renders it.
- **Analytics** — `useTracker()` from `lib/tracking.ts`. No parallel system.

## UI shipped

| | |
|---|---|
| **Pathway picker** | Card list inside the Generate Practice modal, above the focus chips. Name, summary, skill category, stage count. `components/pathwayPicker/PathwayPicker.tsx` |
| **Stage navigator** | Previous / Next buttons plus a jump menu. Disabled at both ends. |
| **Objective** | Rendered per stage. |
| **Mastery signals** | Rendered as a list per stage. |
| **Generate action** | The existing Generate button — no second one. Selecting a pathway adds the implied focus chip so the existing `focusAreas.length === 0` gate is satisfied without being removed. |
| **Generated-plan pathway context** | `PathwayContextCard` in the `PlanReview` overview pane, fed by the route's own summary. |

Presentation rules live in `lib/pathwayUi.ts` as pure functions, so what the
picker *says* is unit-testable without rendering anything — the same split
`lib/drillFinder.ts` uses.

## Pathway behavior

| | |
|---|---|
| **Published pathways visible** | 7, loaded through `loadPathways` (published only). Not hard-coded. |
| **Stage count** | 70 across the 7, ordered 1..n and contiguous — asserted against live data. |
| **THIN stage handling** | A stage with 1–2 drills shows **"Focused stage"** and a sentence about what that means for the practice. It stays fully selectable. The words THIN / READY / GAP never reach the DOM — asserted by the browser run at all three widths. 14 stages carry this label, matching 2F's 14 THIN stages exactly. |
| **Invalid stage handling** | `resolveStageNumber` returns null for a stage the pathway does not have rather than clamping to the last one — a stale "stage 11" must not silently become stage 10. |
| **Zero-feasible handling** | The route already returns `warnings[]` when nothing in the stage can run; the context card renders them. `noFeasibleDrillsMessage` names the likely constraint and offers three ways forward. Nothing unrelated is substituted. |

## Normal planning regression

**Non-pathway behavior:** unchanged. `pathwaySlug` and `pathwayStage` are
`undefined` unless a pathway is chosen, and `JSON.stringify` drops undefined
fields — so the request body is *byte-identical* to the pre-2G one.

**Tests:** asserted on the serialized body, not the object, because an object
carrying `pathwaySlug: undefined` looks different in a debugger and identical
on the wire. Also asserted: a stage number with no pathway is not smuggled
through, and the route's own guard ignores every non-string slug.

## Feasibility

All hard filters unchanged — the pathway feeds `getPathwayPracticeRecommendation`,
which runs `stageCandidates` with the same `Feasibility` the planner uses.

| | |
|---|---|
| Age | hard filter, unchanged |
| Players | hard filter, unchanged |
| Coaches | hard filter, unchanged |
| Environment | hard filter, unchanged |
| **Space** | hard filter, unchanged — **and now tested at the stage level** |
| Equipment | hard filter, unchanged |
| Difficulty | **ranks only, never filters** — unchanged |
| Unknown | stays unknown, excludes nothing — unchanged |

The `Full Field` fix is not regressed. Phase 2F tested the predicate; 2G adds
the test at the level 2G exposes: a full-field drill **linked as the chosen
stage's primary** is still excluded for a small-space coach, and the
recommendation the route builds contains it only when space is unstated.

Worth recording: a *drill* may require `Full Field`, but the largest space a
*coach* can declare is `large`. That asymmetry is pre-existing and unchanged
here; my first version of the test passed `space: 'full field'` and moved the
typecheck baseline, which is how I found it.

## Analytics

**Events:** `pathway_picker_opened`, `pathway_selected`,
`pathway_stage_selected`, `pathway_cleared`, `pathway_practice_generated`,
`pathway_load_retried`, `pathway_stage_load_retried`.

**Properties:** `pathway_slug`, `stage_number`, `stage_key`, `via`,
`stage_drill_count`, `duration`, `coach_count`, `age_group`.

**PII:** none. No names, emails, teams or free text. The browser run asserts
nothing name-shaped appears in `pathway_stage_selected` metadata.

**`pathway_practice_saved` is NOT implemented.** The brief lists it. Saving
goes through the shared `saveDraft`, and nothing carries the pathway onto the
saved row — there is no pathway column on `practice_plans`, and 2G.17 forbids a
migration. Emitting it from in-memory state would claim something the database
does not record. Documented in
`docs/audits/phase2g-analytics-events.md` rather than faked.

## Accessibility

| | |
|---|---|
| Keyboard | Picker reached and operated by Tab + Enter alone — asserted at all three widths. |
| Focus | Visible focus ring on the focused control — asserted. |
| Dialog/sheet semantics | **No new dialog was introduced.** The picker renders inline in the existing modal, so there is no new focus trap or Escape contract to get wrong. The surrounding Generate modal has no `role="dialog"`, no `aria-modal` and no Escape handler — **pre-existing across the whole page and not fixed here.** Claiming the page is accessible would be false; claiming what 2G ships is keyboard-operable is true and is what is asserted. |
| Mobile | Tap targets ≥32px, no horizontal scroll, no clipped names — at 1440, 430 and 390. |
| Button semantics | Real `<button>` elements; prev/next carry `aria-label`s naming the destination stage; the jump menu is a labelled `<select>`. |

## Browser acceptance

```
npm run accept:pathway-ui     90 passed, 0 failed
```

30 checks × 1440 / 430 / 390, driving the **real** components via
`app/dev/pathway-harness`.

| | |
|---|---|
| Desktop 1440 | PASS, 30/30 |
| Mobile 430 | PASS, 30/30 |
| Mobile 390 | PASS, 30/30 |
| **Live production page** | **NOT VERIFIED.** `mybenchcoach.com` answers 403 to CONNECT from this environment and the Vercel aliases are behind Vercel SSO, so nobody here can log in and open the modal. |

The run found a real defect: the "Clear" button was under 32px tall at every
width — the one control a coach uses one-handed to get back to normal
planning. Fixed and re-run clean.

## Production verification

| | |
|---|---|
| `verify:pathway-ui-prod` | **PASS** — 7 pathways, 70 stages, 228 links, 0 empty pathways |
| `verify:pathways-prod` | **PASS** — 104 checks, 0 failures |

The new verifier asserts **structural invariants, not snapshot counts** —
explicitly avoiding 2F's stale-verifier mistake, where `pathways.length === 4`
passed at four of seven and failed at seven. It asserts: every pathway has ≥1
stage, numbers start at 1 and are contiguous, every stage has an objective and
a mastery signal, every link resolves to a schedulable drill, the final stage
returns no next stage, a stage past the end resolves to null. Today's counts
are **printed, not asserted**.

## Tests

| | |
|---|---|
| Unit — new | `npm run test:pathway-ui` — **60 passed, 0 failed** |
| Unit — pathway layer | `npm run test:pathways` — **96 passed** (was 92; +4 for 2G.6) |
| Unit — drill finder | `npm run test:drill-finder` — **114 passed** |
| Integration — 071 | `npm run verify:071` — PASS |
| Browser | `npm run accept:pathway-ui` — **90 passed** |
| Typecheck | `npm run typecheck:baseline` — **196, unchanged** |
| Build | clean, from a removed `.next` |
| `verify:authz` | PASS — 65 route files |
| `verify:claude` | PASS |
| `verify:video-links` | **red on `components/PlanReview.tsx:67` — identical with and without this change.** Verified by stashing: same single finding either way. Pre-existing, not touched. |
| `npm run lint` | **not configured in this repo.** Not claimed. |

## Data/schema changes

| | |
|---|---|
| **Migrations** | **NONE** |
| **Database writes** | **NONE** — every pathway read is a SELECT through existing loaders |
| New tables / columns | none |
| RLS changes | none |

Pathways are published content under RLS that already makes them publicly
readable (migration 069), so the picker reads them client-side through the
existing Supabase component client. No new API route was needed.

## Known limits

1. **The shipped picker has not been seen on the production domain.** Real
   components verified in a real browser at three widths; the *composition* —
   picker inside the real modal, real team, behind login — is unverified. One
   person opening the modal on a phone closes this.

2. **Pathway selection does not survive a refresh.** Every field on the
   generate form is `useState` and none is URL-backed; the one field that reads
   the URL does so once, because the layout calls `router.replace`. 2G.12 says
   not to introduce a second state system, so pathway state follows the form's
   existing convention. A coach who refreshes mid-form loses the pathway along
   with everything else they had typed.

3. **The pathway is not persisted on the saved plan.** It shapes the generated
   practice and appears in the review, but a plan reopened later does not know
   which pathway built it. This is what blocks `pathway_practice_saved`, and it
   needs a schema change.

4. **The surrounding Generate modal is not a real dialog.** Pre-existing; not
   fixed here; stated rather than claimed as accessible.

5. **`pitching-development` implies the `throwing` focus chip.** There is no
   pitching chip in the practice form. Honest neighbour, not a perfect fit.

## Recommendation for next phase

**Persist the pathway on the practice plan.** It is a one-column change and it
unblocks three things at once: `pathway_practice_saved`, a reopened plan
knowing what built it, and any future question about whether pathway-guided
practices actually get run. It is also the smallest possible step toward
progression tracking without building progression tracking.

Before that, **let this run and look at the numbers.** 2G exists to find out
whether coaches want a sequence or just a drill, and the events now answer
that. Building stage-completion state before seeing whether anyone picks a
second stage would be building on an assumption.

Still outstanding and unrelated: production `service_role` key rotation (P0,
operator action).
