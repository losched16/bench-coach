# Drill Finder — current state

Phase 2D.1. Written before any UI change, against commit `10e312a` and the
production database as of 2026-09-16.

The point of this document is to stop the redesign being done blind. Several of
the things below look like cosmetic debt and are not: the card leads with a
video frame for a library that has **zero curated timestamps**, and the empty
state is the same screen as a failed load.

---

## 1. Where it lives

| Piece | File | Notes |
|---|---|---|
| Route | `/dashboard/drills` | `app/dashboard/drills/page.tsx`, 668 lines, one `'use client'` component |
| Layout | `app/dashboard/layout.tsx` | standard dashboard chrome |
| Video URL helpers | `lib/drillVideo.ts` | `embedUrl` is the only one the page uses |
| Scope boundary | `lib/drills.ts` → `schedulableDrills` | enforced by `scripts/verify-drill-scope.mjs` |
| Favorites API | `app/api/drills/favorites/route.ts` | GET / POST / DELETE |
| Add-your-own | `components/DrillForm.tsx` | inline, above the grid |
| Analytics | `lib/tracking.ts` → `usePageView('drills')` | page view only |

**It is one file.** There is no `DrillCard`, no `DrillDetail`, no filter
component — the grid, the modal, the filters and the colour maps are all inline
in `page.tsx`. Nothing else in the app imports from it.

### Surfaces that are *not* this one

Three other things are called a drill library and are out of 2D's scope. Worth
naming so a change here does not get assumed to reach them:

- `components/DrillLibrary.tsx` — the picker panel/bottom-sheet inside
  `PlanReview`. Own tab taxonomy (`FOCUS_TO_CATEGORY`), own search, `onAdd`
  callback. This is the one surface that already has a working add-to-practice.
- `app/dashboard/practice/page.tsx` — the "Swap Drill" modal has a *third*
  inline picker with its own search box and category `<select>`.
- `components/seo/DrillLibrary.tsx` — public marketing pages, reads `SeoDrill`
  from a different source entirely. Not connected to `drill_resources`.

---

## 2. Data source

```ts
schedulableDrills(supabase, coachId, '*')
  .order('skill_category')
  .order('progression_level')
```

- Browser Supabase client, anon key, so RLS from migration 041 applies. The
  `created_by_coach_id` filter inside `visibleDrills` is the real boundary; RLS
  is the backstop.
- `select('*')` — every column, once, on page load. No pagination, no
  server-side filter. 154 rows, filtered in memory thereafter.
- `schedulableDrills` (not `visibleDrills`), so `source_collection`,
  `teaching_content` and `duplicate_of_drill_id` rows are already excluded.
  **This part is correct today and must stay correct.**
- `.order('progression_level')` sorts on a column populated on **92 of 154**
  rows. The 62 nulls sort last in PostgREST's default, so a third of the library
  lands at the bottom of its category for no reason a coach can see.

### What is actually populated (154 schedulable rows)

Measured directly against production. This is what the new card is allowed to
promise.

| Fully populated (154/154) | Partial | Empty |
|---|---|---|
| `description`, `ai_coaching_notes`, `success_markers`, `regression_notes`, `progression_notes`, `equipment_needed`, `est_duration_minutes`, `difficulty_level`, `age_range`, `min_age`, `max_age`, `indoor_outdoor`, `space_required`, `requires_partner`, `skill_category`, `primary_skill`, `competition_level` | `practice_roles` 153 · `mechanic_focus` 152 · `channel` 140 · `youtube_url` 140 · `youtube_video_id` 139 · `thumbnail_url` 139 · `common_flaws_fixed` 133 · `progression_level` 92 · `min_coaches` 76 · `throwing_load` 76 · `secondary_skill` 76 · `tags` 74 · `reps_guidance` 69 · `frequency_guidance` 56 · `station_friendly` 49 · `rep_density` 49 · `competition_style` 49 · `activity_format` 49 · `physical_intensity` 49 · `instruction_complexity` 49 · `engagement_level` 49 · `idle_time_risk` 49 · `mixed_skill_friendly` 49 · `min_players` 49 · `ideal_group_size` 45 · `safety_notes` 36 · `activity_family_id` 33 · `variation_type` 33 · `advanced_progression_notes` 1 | `youtube_start_seconds` 0 · `youtube_start_source` 0 · `max_players` 0 · `duration` 0 |

Two consequences for the redesign:

1. **Every field the compact card needs is at 100%** — name, category, purpose,
   duration, difficulty, equipment. The activity-first card is buildable today.
2. **The practice-intelligence block sits at 49/154** (a third). Chips built on
   `station_friendly`, `competition_style`, `rep_density` etc. must render only
   when non-null. Absence is not a "no".

### Value shapes worth knowing

- `indoor_outdoor` holds only `Outdoor` and `Both`. There is **no `Indoor`
  value**. An "indoor" filter means `Both`, and saying "Indoor" on a chip for a
  row that says `Both` is a claim the data does not make.
- `space_required` is not normalized: `Small`, `Medium`, `Medium-large`,
  `Full Field`, `Full field`, `Outfield/large`. Two of those differ only in case.
- `variation_type` holds `base`, `advanced`, `progression`, `regression`,
  `space_variant`. There is no `equipment_variant` and no `competitive_variant`
  in production, so two of the six relationship labels 2D.6 lists have nothing
  behind them yet.
- `est_duration_minutes` is one of `5, 8, 10, 12, 15, 20`.

---

## 3. Search

```ts
d.drill_name | d.description | d.tags | d.common_flaws_fixed | d.mechanic_focus
```

Case-insensitive `includes` across those five, OR'd, **unranked** — results keep
the `skill_category` → `progression_level` order they arrived in.

What it cannot find:

- **The taxonomy.** `problem_taxonomy` (49 problems, every one with aliases —
  "late on faster pitching", "dragging the barrel", "leaking weight") and
  `drill_problem_map` (393 mappings, covering **153 of 154** schedulable drills)
  are not read by this page at all. The single richest retrieval surface in the
  product is invisible to its own search box.
- `ai_coaching_notes`, `success_markers`, `regression_notes`,
  `progression_notes` — all four now populated on every row by Phase 2C, none
  searched.
- `skill_category` itself. Typing "hitting" matches only rows with the word in
  their name or description.

`tags` is on 74/154 and `common_flaws_fixed` on 133/154, so two of the five
fields searched are absent on a fifth to a half of the library.

The placeholder reads **"Search drills, problems, or skills…"** — it promises
problem search and skill search, and does neither.

---

## 4. Filters

Three `<select>`s, all client-side, all exact-equality:

| Filter | Source | Values |
|---|---|---|
| Category | hardcoded `SKILL_CATEGORIES` | 13 + All |
| Difficulty | hardcoded | Beginner / Intermediate / Advanced + All |
| Age | hardcoded | 6U / 8U / 10U / 12U + All, compared against `min_age`/`max_age` |

Plus a **Favorites** toggle in the header (not in the filter row).

- The 13 categories are hand-copied from the data. They currently match, so
  nothing is stranded — but nothing checks that, and a new `skill_category`
  would be invisible under every tab.
- Age treats missing `min_age`/`max_age` as "fits everyone". Both are 154/154
  populated, so the branch is dead today.
- No equipment, environment, duration or practice-role filter — all four of
  which are backed by fully-populated columns.
- No filter exposes `resource_kind`, `variation_type` or `verification_status`.
  **Correct, and must stay that way.**

### Layout

- Desktop (`md:`): three selects inline to the right of the search box.
- Mobile: a "Filters" disclosure button toggling `grid-cols-3` — three selects
  side by side. At 390px that is roughly 110px each, so every option label
  truncates mid-word. It is a disclosure, not a drawer or sheet.

---

## 5. The card

Rendered in `grid md:grid-cols-2 lg:grid-cols-3`.

Top to bottom:

1. **`aspect-video` thumbnail** — the dominant visual, roughly half the card.
2. A hover play overlay with a 64px red play button.
3. **Channel badge** bottom-right over the image.
4. Favorite star top-right; "Yours" badge top-left for coach-authored rows.
5. Category chip + difficulty chip.
6. Drill name, `line-clamp-1`.
7. Description, `line-clamp-2`.
8. `age_range` and `indoor_outdoor` with icons.
9. "Fixes:" — first two `common_flaws_fixed`.

**The card leads with media on every single row.** Media is the largest element,
the channel name is on it, and a play button appears on hover — for a library
where `youtube_start_seconds` is 0/154 and **69 of 154** schedulable drills are
backed by a video shared with at least one other drill. Tapping that play
affordance opens a compilation at 0:00.

When `thumbnail_url` is absent (15 rows) the card renders a grey box with a
`Play` icon in it — **an empty media box that still looks like a video**. 14 of
the 154 have no media at all, by any route.

Nothing on the card says what the drill is *for*, how long it takes, or what
equipment it needs — `est_duration_minutes` and `equipment_needed` are 154/154
populated and neither reaches the card.

---

## 6. The detail modal

`selectedDrill` state; a fixed full-screen overlay, `max-w-4xl`,
`max-h-[90vh] overflow-y-auto`.

Order:

1. Sticky header: category chip, difficulty chip, X.
2. **A full-width `aspect-video` YouTube iframe** (`embedUrl`, nocookie), when
   `youtube_video_id` is set. This is the first content in the modal.
3. Drill name.
4. **"Video by: {channel}"**.
5. Description.
6. Two columns: Who It's For / Equipment Needed / Setting · Problems This Fixes / Mechanics Focus.
7. "💡 Coaching Cues" — `ai_coaching_notes`.
8. "⚠️ Safety Notes" — `safety_notes` (36/154).

Fields **not shown anywhere**, all written or completed during Phase 2C:

`success_markers` (154/154) · `regression_notes` (154/154) ·
`progression_notes` (154/154) · `advanced_progression_notes` ·
`reps_guidance` (69) · `frequency_guidance` (56) · `practice_roles` (153) ·
`station_friendly` · `min_players` / `ideal_group_size` / `min_coaches` ·
`activity_family_id` / `variation_type` · everything in `drill_problem_map`.

So: Phase 2C wrote regression and progression notes onto all 154 rows, and the
Drill Finder renders neither. A coach opening a drill gets the video, the
channel, one paragraph and one cue.

There is no "Add to practice" anywhere in the modal or on the card.

---

## 7. Media behaviour

- **The page does not use `lib/drillMedia.ts`.** It reads `drill.thumbnail_url`,
  `drill.channel` and `drill.youtube_video_id` straight off the row, and calls
  `embedUrl(selectedDrill)`.
- `drill_media_resources` — 219 rows — is never queried here.
- All 219 media rows are `media_type: 'youtube'`,
  `verification_status: 'unverified'`, `start_seconds: null`.
- All 140 schedulable drills that have media have a **media row**; zero are
  legacy-only. The normalized layer already covers this surface completely, so
  migrating the presentation costs nothing in fallback risk.
- `embedUrl` honours `youtube_start_seconds`, which is 0/154 — so every embed
  opens at 0:00, correctly (there is nothing to open at) and unhelpfully.

Nothing on the page claims a timestamp, which is the one thing it gets right by
accident: there is no "jump to drill" affordance to be wrong.

---

## 8. States

| State | Today |
|---|---|
| Loading | Centred grey text, "Loading drill library…". No skeletons. |
| Empty (filters) | "No drills found matching your criteria." + Clear filters. |
| Empty (search) | Same screen. No distinction. |
| **API failure** | **Same screen.** `loadDrills` catches, `console.error`s, leaves `drills` at `[]`. A failed fetch is indistinguishable from an over-narrow filter, and the remedy offered ("Clear filters") does nothing. |
| Not signed in | `setLoading(false)` with an empty list → also the empty state. |
| No media | Grey box with a play icon. |
| Media fails to load | Broken `<img>`; no `onError`. |
| Favorites fetch fails | Swallowed deliberately, stars absent. Correct. |

`Clear filters` resets search, category, difficulty and age — but **not**
`showOnlyFavorites`, which is the one most likely to have emptied the list.

---

## 9. Practice Builder handoff

**There is none from this page.** A coach who finds a drill here cannot put it
in a practice; they have to remember the name and go find it again in the
builder.

The two flows that do exist:

1. `PlanReview` → `DrillLibrary` → `blockFromDrill` (`lib/planEdits.ts:182`).
2. `app/dashboard/practice/page.tsx` → swap modal → `handleLibraryPick`.

Both build a plan block from a drill row, and **neither records the drill id**:

```ts
// lib/planEdits.ts:182
export function blockFromDrill(drill: any, minutes = 10): PlanBlock {
  return {
    type: 'drill',
    title: drill?.drill_name || 'Drill',
    drill_name: drill?.drill_name || undefined,   // ← name only
    ...
  }
}
```

Every downstream reader therefore resolves by **name**, through
`useDrillResources().findDrill`, which does exact-then-substring matching over
the full visible set. That is why the substring fallback exists, and it is a
real hazard now: "Wall Ball" is a substring of "Wall Ball Solo Drill — Partner-
Free Mechanics Builder", and both are schedulable members of the
`solo-throwing-reps` family.

2D.7 requires the handoff to use the canonical drill id. That is a change to
`blockFromDrill`, not just to this page.

---

## 10. Accessibility and keyboard

Gaps, in rough order of severity:

- **The card is a `<div onClick>`.** Not focusable, not in the tab order, no
  `role`, no keyboard activation. The grid is unreachable without a mouse.
- **The detail modal is a plain `<div>`** — no `role="dialog"`, no
  `aria-modal`, no focus trap, no focus restore, and **no Escape handler**.
  Once opened it can only be closed by clicking X, and clicking the backdrop
  does nothing either.
- Body scroll is not locked behind the modal.
- The "Filters" disclosure has no `aria-expanded` / `aria-controls`.
- Search has a placeholder and no label.
- No `aria-live` on the result count, so a screen reader gets no feedback when
  filtering changes the list.
- The favorite star does have a correct `aria-label` and `stopPropagation`.
  It is the best-behaved control on the page.
- `line-clamp-1` on the drill name truncates silently with no `title`.

---

## 11. Duplicate / collection filtering

Correct today, via `schedulableDrills`:

- `duplicate_of_drill_id IS NULL`
- `resource_kind NOT IN ('source_collection', 'teaching_content')`, with NULL
  treated as runnable
- `created_by_coach_id IS NULL OR = me`
- `status = 'approved' OR status IS NULL`

20 duplicate rows and 46 demoted rows are excluded. Historical resolution goes
through `visibleDrills` elsewhere and is untouched by this page.

The family model is *not* used: 33 of 154 rows carry an `activity_family_id`
across 18 families, 11 of which have more than one schedulable member. Those 11
render today as unrelated adjacent cards — "One-Hand Tee Drill (Bottom Hand)",
"One Hand Drill" and "One-Hand Tee Drill (Top Hand)" sit next to each other in
the Hitting grid with nothing saying one is the regression and one the
progression of the other.

---

## 12. What this means for the redesign

Ranked by what it costs a coach:

1. **Media leads every card, and the media is weak.** 0 timestamps, 0 verified,
   69/154 compilation-backed. The card's largest element is its least
   trustworthy content.
2. **The detail modal omits most of Phase 2C.** Success markers, regression and
   progression notes are on all 154 rows and none of them render.
3. **Search cannot reach the taxonomy**, despite the placeholder promising
   problems, 49 aliased problems existing, and 153/154 drills being mapped.
4. **No path into Practice Builder**, and the two paths that exist elsewhere
   carry a name instead of an id.
5. **A failed load renders as an empty filter**, offering a remedy that cannot
   work.
6. **The grid is keyboard-unreachable** and the modal is not a dialog.
7. Mobile filters are three selects in a 390px row.
8. `progression_level` ordering strands the 62 rows that lack one.

None of these need a timestamp to fix.
