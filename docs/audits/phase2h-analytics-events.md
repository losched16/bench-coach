# Phase 2H — player pathway analytics

## The infrastructure, unchanged

`lib/tracking.ts`, used as-is. No parallel system was built — the same position
Phase 2G took.

```
useTracker() → track(eventName, metadata)
             → POST /api/track
             → { userId, eventType: 'feature_use', eventName, pagePath, metadata }
```

Two things about it that shape every number below:

1. **It resolves the Supabase user id itself and drops the event when nobody is
   signed in.** Every event here is signed-in-coach only.
2. **It is fire-and-forget and swallows failures.** A blocked request, a phone
   with no signal at a field — silently lost. These counts are a **floor**, not
   a census, and must not be reconciled against the database rows they describe.

That second point matters more in 2H than it did in 2G, because here the
analytics event and a durable database row describe the same action. **When they
disagree, `player_pathway_events` is right.** A coach advanced a player if and
only if there is a row saying so; the analytics event is a best-effort copy for
product measurement. Anything that needs to be *correct* — how many sessions,
who advanced whom, when — reads the table, and every product surface does.

## Events

| Event | Fires when | Where |
|---|---|---|
| `player_pathway_started` | a coach enrolls a player in a pathway | `PlayerDevelopment` |
| `player_pathway_opened` | a coach opens a plan from the player profile | `PlayerDevelopment` |
| `player_pathway_stage_advanced` | a coach confirms an advance | development plan page |
| `player_pathway_stage_regressed` | a coach confirms a regression | development plan page |
| `player_pathway_completed` | a coach completes the pathway | development plan page |
| `player_pathway_session_logged` | a coach records today's work | development plan page |
| `player_measurement_recorded` | one benchmark saved, one event each | development plan page |
| `player_pathway_added_to_practice` | a coach hands a stage to the practice builder | development plan page |

### Properties

| Event | Properties |
|---|---|
| `player_pathway_started` | `pathway_slug`, `source_surface` |
| `player_pathway_opened` | `pathway_slug`, `pathway_version`, `stage_number`, `stage_key`, `source_surface` |
| `player_pathway_stage_advanced` / `_regressed` | `pathway_slug`, `pathway_version`, `stage_number` (the stage **landed on**), `stage_key`, `source_surface` |
| `player_pathway_completed` | same shape, `stage_number` is the final stage |
| `player_pathway_session_logged` | `pathway_slug`, `pathway_version`, `stage_number`, `stage_key`, `source_surface` |
| `player_measurement_recorded` | `measurement_type` (the metric slug), `pathway_slug`, `stage_number`, `source_surface` |
| `player_pathway_added_to_practice` | `pathway_slug`, `pathway_version`, `stage_number`, `stage_key`, `source_surface` |

`source_surface` is `player_profile` or `development_plan`. It exists so the
same action taken from two places can be told apart later without guessing from
`pagePath`.

`stage_number` on a move is **where the player landed**, not where they came
from. A coach reading "stage 4 advanced" wants to know they are on 4 now; the
from/to pair is in `player_pathway_events`, which is where anyone reconstructing
a history should be looking anyway.

## PII — and the one rule this phase had to get right

**No `player_id`. No player name. No coach name. No team name. No team id. No
free text.**

This is stricter than 2G, deliberately. The identifiers here are pathway slugs
and stage keys — published curriculum content — plus a metric slug. None of them
say anything about a child.

The notes a coach writes on a session, and the mastery signals they tick, are
**never** sent to analytics. They are observations about a named child and they
live in `player_pathway_events` behind RLS, which is the only place they belong.
`player_measurement_recorded` carries the *type* of measurement and never the
**value** — that a coach timed a 10-yard sprint is a product fact; that the
child ran it in 2.14 seconds is not.

`userId` is attached by `lib/tracking.ts` for every event in the product, as it
always has been. That is pre-existing and 2H does not change it. Note what it
means here: the events identify the **coach**, never the player.

## What these events can and cannot answer

**Can:** do coaches start plans when the feature is in front of them; which
pathways; do they open a plan again after starting it; do they record sessions
or just read; do they ever advance anyone, or does a plan get started and
abandoned at stage 1; do they take a stage into the practice builder; do they
record baselines.

**Cannot:**

- **Whether the work actually happened.** A logged session is a coach saying it
  did. Nothing here watches a field.
- **Whether a player improved.** The measurements are in `player_metrics` and
  deliberately not in analytics.
- **Whether advancing was the right call.** There is no ground truth for that
  and no amount of instrumentation would create one.

## The questions worth watching first

In the order they become answerable, not in the order they are interesting:

1. **Does anyone start a plan at all?** `player_pathway_started` against the
   number of coaches who opened a player profile. If this is near zero, nothing
   below matters and the entry point is the problem, not the curriculum.
2. **Does a plan survive its first stage?** Count coaches with a
   `player_pathway_stage_advanced` event against those with
   `player_pathway_started`. A plan started and never advanced is a plan that
   was tried once. This is the 2H equivalent of 2G's sequence-vs-filter question
   and it is the one that says whether the model is real to a coach.
3. **Is the session log used, or only the stage?** If sessions are never logged
   but stages advance, the adherence half of this phase is dead weight and
   should be simplified rather than extended.
4. **Does `player_pathway_added_to_practice` get used?** That link is the claim
   that individual development and team practice belong to the same product. If
   nobody takes it, they do not — at least not there.

Deliberately **not** a question yet: which pathway "works best". Nothing here
can support that claim and building a dashboard that implies it would be worse
than having no dashboard.
