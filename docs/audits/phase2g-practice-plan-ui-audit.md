# Phase 2G.1 — The Practice Plan flow as it stands

Read before anything was edited, at `ea4dddb`. Nothing in this file is a plan;
it is what the code does today.

## Routes

| Route | What it is |
|---|---|
| `app/dashboard/practice/page.tsx` | The whole surface. 1,949 lines, `'use client'`, one component. Plan list, generate modal, draft review, saved-plan expansion, swap modal and template picker all live here. |
| `app/dashboard/practice/[id]/page.tsx` | Print/one-page sheet for a saved plan. Not part of this phase. |
| `app/api/practice-plan/route.ts` | POST, NDJSON streaming. 875 lines. |
| `app/api/practice-plan/swap/route.ts` | Replace one block. Not part of this phase. |
| `app/api/track/route.ts` | The analytics sink. |

There is no wizard and no multi-step form. **Generate Practice Plan is a single
modal** (`showPlanModal && !draft`) containing a vertical stack of fields, and
`Generate` at the bottom.

## Component tree, generate path

```
PracticePage                              'use client', all state is useState
 └─ {showPlanModal && !draft} modal       plain div, fixed inset-0, NOT a <dialog>
     ├─ genError banner
     ├─ "Practice date"                       (scheduleReady-gated)
     ├─ "Start time"
     ├─ "What's the one thing you want out of tonight?"  → objective
     ├─ "Duration (minutes)"                   → duration
     ├─ "How many coaches will be there?"      → coachCount
     ├─ "What are we working on? (up to 5)"    → focusAreas, FOCUS_OPTIONS chips
     ├─ "Use any of your favorites?"           → pickedDrills (+ Drill Finder handoff)
     ├─ "What will you have?"                  → equipmentAvailable
     ├─ "Anything specific?"                   → specifics
     └─ Generate                 disabled={focusAreas.length === 0 || generating}
 └─ {showPlanModal && draft} draft review → PlanReview
```

There is **no player-count field on this form.** The route derives attendance
from the roster. An earlier draft of this audit listed one; that was me
pattern-matching a label list rather than reading the JSX, and it would have
put a null `player_count` into analytics implying we had asked the coach.

`focusAreas.length === 0` disables Generate, and `handleGeneratePlan` returns
early on the same condition. **That is the gate a pathway selection has to
either satisfy or relax** — see Risks.

## API contract, as it is

`POST /api/practice-plan`, JSON body. Fields the page sends today:

```
teamId, duration, focus[], constraints?, priorAnswer?, isRefine,
mustIncludeDrillIds[], objective?, equipmentAvailable[],
coachCount?, previousBlocks?
```

Fields the route **accepts and the page has never sent**:

```
pathwaySlug?   string
pathwayStage?  number
```

Response is NDJSON, one JSON object per line:

| `type` | Payload | Page handles it? |
|---|---|---|
| `skeleton` | `{ plan }` — shape of the practice, arrives in seconds | yes |
| `block` | `{ index, block }` — one written block | yes |
| `plan` | `{ plan }` — the finished plan | yes |
| `error` | `{ error }` | yes |
| **`pathway`** | **`{ pathway: summary }`** | **NO — silently dropped** |

`route.ts:682` already sends `{ type: 'pathway', pathway: pathwaySummary }`
whenever a pathway was requested. The page's NDJSON loop has no branch for it,
so it falls through. Nothing is broken; the data simply arrives and is thrown
away.

### The pathway summary already being sent

Built at `route.ts:459`, from `getPathwayPracticeRecommendation`:

```
{ pathway, stage: "4 of 10 — Load to launch, and the stride",
  objective, drills: string[], masterySignals: string[],
  nextStage: string | null, warnings: string[] }
```

Coach-facing already. No ranking numbers, no database ids, no internal status.

## Pathway support already present

| Piece | Where | State |
|---|---|---|
| `loadPathways(supabase)` | `lib/developmentPathways.ts:110` | published only, ordered by name |
| `loadPathway(supabase, slug)` | `:123` | one pathway with stages, links, problems |
| `orderedStages` / `currentStage` / `nextStage` / `previousStage` / `stageByKey` | `:169`–`:230` | `nextStage` returns null at the end — no fake next stage |
| `getPathwayPracticeRecommendation` | | feasibility-aware, returns `warnings[]` |
| Route wiring | `route.ts:442`–`:497` | guarded by `if (typeof pathwaySlug === 'string' && pathwaySlug.trim())` |
| Failure behaviour | `route.ts:494` | pathway load failure is caught, logged, costs the pathway section and nothing else |

**The backend is done.** 2G is a UI phase and a wiring phase.

## Exact point where pathway selection enters

Two edits, both additive:

1. **Request** — `handleGeneratePlan`, `app/dashboard/practice/page.tsx:493`,
   inside the existing `JSON.stringify({ … })`. Add `pathwaySlug` and
   `pathwayStage`, both `undefined` when no pathway is chosen. An `undefined`
   field is omitted by `JSON.stringify`, so a non-pathway request is
   byte-identical to today's.

2. **UI** — a new section in the generate modal, directly above
   *"What are we working on? (up to 5)"* (`:1447`). Focus areas say what the
   session covers; the pathway says what is being developed. Putting the
   pathway first reads in that order and keeps the two visibly separate, which
   is the governing principle.

3. **Response** — a `msg.type === 'pathway'` branch in the NDJSON loop
   (`:570`), storing the summary so the draft review can show it.

## Mobile constraints

The modal is `max-w-md w-full max-h-[92vh] overflow-y-auto` inside
`fixed inset-0 … p-4`. At 390px that is a 358px-wide column that already
scrolls vertically. Anything added must:

- fit 358px of usable width with no horizontal scroll
- not add a second scroll container (a nested `overflow-y-auto` inside a
  scrolling modal is the thing that traps a thumb)
- keep tap targets at the existing `px-3 py-2` / `py-3` rhythm

The favorites list at `:1490` already uses `max-h-52 overflow-y-auto` inside
the modal, so a bounded inner list is an established pattern here — but it is
a list of one-line rows, not cards.

## Analytics hooks

Real infrastructure exists and the practice page barely uses it.

- `lib/tracking.ts` — `usePageView(name)` and `useTracker()`.
- `useTracker()` returns `track(eventName, metadata)`, which POSTs to
  `/api/track` with `{ userId, eventType: 'feature_use', eventName, metadata }`.
- It resolves the Supabase user id itself and **drops the event when there is
  no signed-in user**. Fire-and-forget; failures are swallowed.
- The practice page currently calls `usePageView('practice')` at `:78` and
  **nothing else**. No feature events at all.
- Drill Finder (Phase 2D) uses an `onTrack` prop wired to `useTracker()` by its
  page, so the component stays testable. That is the pattern to follow.

## Auth / team context

- `app/api/practice-plan/route.ts:44` — `guard(request, 'decide', { needs: 'teamFeatures' })`.
- The page resolves `teamId` from search params / team list, and
  `handleGeneratePlan` returns early without one.
- Pathways are published content, not team data. `loadPathways` needs no team
  scope, and RLS (migration 069) makes `development_pathways` publicly
  readable by design — so a client-side read is safe, and there is no need for
  a new API route just to list them.

## Existing skill / problem selectors

- `FOCUS_OPTIONS` — flat string chips, the practice page's own list. Not the
  pathway taxonomy and not the drill taxonomy.
- Drill Finder has a problem filter over `problem_taxonomy`.
- **No existing selector maps a coach onto a development pathway.** Nothing to
  reuse; the picker is new UI over an existing loader.

## Risks and compatibility concerns

1. **The `focusAreas.length === 0` gate.** A coach who picks a pathway and no
   focus chips currently cannot press Generate. Two options: derive a default
   focus from the pathway's `skill_category`, or relax the gate when a pathway
   is selected. Deriving is the smaller change and keeps the request shape
   honest — the route still receives a real `focus[]`. **Decision: derive, and
   let the coach override.** Never silently *replace* a focus the coach chose.

2. **Non-pathway requests must not change.** `undefined` fields are dropped by
   `JSON.stringify`, so this holds structurally rather than by convention — and
   a test should assert the serialized body, not the object.

3. **One 1,949-line client component.** Adding a picker inline makes it worse
   and makes it untestable. Follow Drill Finder: extract presentational
   components under `components/pathwayPicker/` with an `onTrack` prop, and
   leave the page as the data layer.

4. **The modal is not a real dialog.** No `role="dialog"`, no `aria-modal`, no
   Escape handler, no focus trap. Pre-existing across the page. 2G.13 asks for
   dialog semantics on *what this phase ships* — I can meet that for the
   pathway sheet without rewriting the surrounding modal, and should say so
   rather than claiming the page is accessible.

5. **No URL state for the generate form.** Every field is `useState`; a refresh
   loses all of it. `handoffDrillId` (`:173`) reads `searchParams` once in a
   `useState` initializer because the layout calls `router.replace`. Putting
   pathway state in the URL would be the *only* URL-backed field in the form
   and would fight that `router.replace`. **2G.12 says not to introduce a
   second state system — so pathway selection stays in component state, and
   that limit gets documented rather than worked around.**

6. **`verify:video-links` is red on `components/PlanReview.tsx:67`** and
   predates this work. If 2G touches PlanReview, that verifier stays red for
   the same pre-existing reason and must not be reported as newly broken.
