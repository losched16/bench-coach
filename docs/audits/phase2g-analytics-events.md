# Phase 2G.10 — Pathway analytics

## The infrastructure that already exists

`lib/tracking.ts`, used unchanged. No parallel system was built.

```
useTracker() → track(eventName, metadata)
             → POST /api/track
             → { userId, eventType: 'feature_use', eventName, pagePath, metadata }
```

Two things about it worth knowing before reading the numbers it produces:

1. **It resolves the Supabase user id itself and drops the event when there is
   no signed-in user.** Every event below is therefore signed-in-coach only.
   There is no anonymous funnel here and these events cannot be used to measure
   one.
2. **It is fire-and-forget and swallows failures.** A blocked request, an
   offline phone at a field, a failed `/api/track` — all silently lost. These
   counts are a floor, not a census, and should not be reconciled against
   anything that must balance.

Before 2G the practice page called `usePageView('practice')` and emitted no
feature events at all. The events below are the first.

## Events

| Event | Fires when | Where |
|---|---|---|
| `pathway_picker_opened` | the Generate Practice modal opens for the first time in a session | `app/dashboard/practice/page.tsx` |
| `pathway_selected` | a coach taps a pathway | `PathwayPicker` |
| `pathway_stage_selected` | a coach moves stage — previous, next, or the jump menu | `PathwayPicker` |
| `pathway_cleared` | a coach clears the pathway and returns to normal planning | `PathwayPicker` |
| `pathway_practice_generated` | Generate is pressed **with** a pathway selected | `app/dashboard/practice/page.tsx` |
| `pathway_load_retried` | the retry link on a failed pathway list | `PathwayPicker` |
| `pathway_stage_load_retried` | the retry link on a failed stage load | `PathwayPicker` |

### Properties

| Event | Properties |
|---|---|
| `pathway_picker_opened` | — |
| `pathway_selected` | `pathway_slug`, `stage_count` |
| `pathway_stage_selected` | `pathway_slug`, `stage_number`, `stage_key`, `via` (`previous` / `next` / `jump`) |
| `pathway_cleared` | `pathway_slug` |
| `pathway_practice_generated` | `pathway_slug`, `stage_number`, `stage_key`, `stage_drill_count`, `duration`, `coach_count`, `age_group` |
| retry events | `pathway_slug` where one is selected |

## What is deliberately not recorded

**`pathway_practice_saved` is not implemented.** The brief lists it. Saving a
draft goes through `saveDraft`, which is shared by every plan however it was
built, and the page does not carry the pathway forward onto the saved row —
there is no pathway column on `practice_plans` and 2G.17 forbids a migration.
Emitting a "saved" event from the page's in-memory pathway state would be a
claim about a database row that does not record it, and a stale one as soon as
a coach edits and re-saves. **Recorded here as a gap rather than faked.**
Closing it properly means persisting the pathway on the plan, which is a schema
change and belongs to a later phase.

**No player count.** The generate form has no player-count field — the route
derives attendance from the roster. Recording `player_count: null` would imply
we had asked the coach and they had declined.

**Our curation vocabulary.** `stage_drill_count` is a number. `THIN` / `READY`
/ `GAP` are our words for our audit state; the number is the fact underneath
them and survives a change to the threshold.

## PII

No player names, no coach names, no email addresses, no team names, no free
text. The only identifiers are pathway slugs and stage keys, which are
published content, plus `age_group` (`"8U"`), which is a team-level band
already present elsewhere in analytics context and identifies nobody.

`userId` is attached by `lib/tracking.ts` itself, as it is for every other
event in the product. That is pre-existing behaviour and 2G does not change it.

The browser acceptance run asserts the shape of `pathway_stage_selected`
metadata and fails if anything name-shaped appears in it.

## What these events can and cannot answer

**Can:** do coaches open the picker; do they choose a pathway once they see it;
which pathways; do they move stages before generating or accept stage 1; do
focused stages get chosen as often as broad ones; how many pathway-guided
practices are generated.

**Cannot:** whether a pathway-guided practice was actually run; whether it was
saved; whether the coach came back to the next stage a week later. All three
need the pathway persisted on the plan, which this phase does not do.
