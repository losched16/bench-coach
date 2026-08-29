# How chat picks a drill today

Discovery pass, 29 Aug 2026. No behaviour changed.

Traced query: *"My 8-year-old keeps dropping his back shoulder when he swings.
What drill should we do?"*

**Two different systems can answer this, and which one runs depends entirely on
which button the coach pressed.** That is the single most important finding in
this document.

---

## Path A — the chat box (`/dashboard/chat`)

`app/api/chat/route.ts` → `generateChatResponse` (`lib/anthropic.ts`)

```
user query
  → POST /api/chat
  → assembleCoachContext()            team, roster, priorities, stats
  → visibleDrills(...).limit(100)     ← NO FILTER. NO SEARCH. NO RANKING.
  → drills rendered into system prompt (lib/anthropic.ts:490)
  → Claude Sonnet 5
  → prose response
```

### There is no retrieval step

`app/api/chat/route.ts:276`:

```ts
const { data: resources } = await visibleDrills(
  supabaseAdmin, team.coach_id,
  'id, drill_name, skill_category, description, youtube_url, youtube_video_id,
   channel, age_range, difficulty_level, mechanic_focus, common_flaws_fixed,
   equipment_needed, ai_coaching_notes, safety_notes, created_by_coach_id'
).limit(100)
```

No `.eq()`, no `.ilike()`, no `.or()`, no ordering, no relevance scoring. The
user's question is **not used to select drills**. The first 100 rows the
database returns — in unspecified order — are pasted into the system prompt,
and the model does the selection by reading them.

**Steps that do not exist on this path:** filtering, database search, vector
search, ranking, candidate scoring, re-ranking. Stating that explicitly because
the request asked.

### What the model sees per drill

`lib/anthropic.ts:494-500`:

```
- "Drill Name" (Skill Category, Difficulty)
     Fixes: <common_flaws_fixed joined>
     Ages: <age_range or 'all ages'>
     📹 Video: <youtube_url>
     Source: <channel>
     <description>
```

## Path B — Get a Plan (`/dashboard/prescribe`)

`app/api/prescribe/route.ts`. This is materially better and is a genuine
retrieval pipeline:

```
complaint
  → diagnose()                       Claude maps text → 1-3 problem slugs + categories
  → drill_problem_map join           .in('problem_slug', slugs)
  → status filter                    approved or null only
  → age filter                       ONLY if playerAge AND min_age AND max_age
  → competition_level filter
  → dedupe, score, sort              curated → sort_order → progression → difficulty
  → curated-only if >= 2 curated
  → IF < 2 selected: keyword fallback
        visibleDrills(limit 400) → scoreDrillRelevance → top 40
        → pickRelevantDrills() — a second Claude call picks from the pool
  → top 4
  → analysis prose
```

`diagnose()` is the piece that maps a symptom to a deficiency. It sends the
whole `problem_taxonomy` (slug, category, label, up to 6 aliases each) to
Claude and asks for matching slugs, explicitly permitting an empty result:
*"Many requests are goals rather than flaws… that is fine, return an empty
array. Do not force a bad match."* It falls back to substring matching against
`label` and `aliases` if the model call fails.

---

## Question by question

Answers are for **Path A (chat)** first, since that is where a coach most
naturally asks the traced question, then Path B.

| | Chat | Prescribe |
|---|---|---|
| Understands the player's age? | **No.** Age never reaches drill selection. `age_range` is displayed as text; nothing filters on it | **Partially** — see below |
| Understands specific mechanical problems? | **No mechanism.** The model reads `common_flaws_fixed` strings and infers | **Yes** — `diagnose()` → `problem_taxonomy` |
| Maps symptom → deficiency? | **No** | **Yes**, via slugs + aliases |
| Distinguishes teaching a skill from practising it? | **No** | **No.** `progression_level` orders drills but is a difficulty ladder, not a teach/rehearse distinction. Nothing stores drill intent |
| Considers equipment? | **No.** `equipment_needed` is shown, never filtered | **No** |
| Considers number of players? | **No — the column does not exist** | **No** |
| Considers number of coaches? | **No — the column does not exist** | **No** |
| Considers location / indoor-outdoor / space? | **No — the column does not exist** | **No** |
| Considers skill level? | **No.** `difficulty_level` is displayed only | **Weakly** — used as the final tiebreak in sorting, never as a filter |
| Considers prerequisites? | **No — the column does not exist** | **No** |
| Knows when NOT to recommend a drill? | **Partially.** `do_not_coach_flag` / `do_not_coach_note` exist (migration 011) but **are not in the chat select list**, so chat cannot see them | **Yes for status** (approved only). `do_not_coach_*` is loaded on `problem_taxonomy` rows, not enforced against drills in the selection code |
| How are candidates ranked? | **They are not** | curated → `sort_order` → `progression_level` → `difficulty_level` |
| Could a generic keyword match beat a better drill? | N/A — no keyword matching | **Yes.** See below |
| Could the model recommend drills not in the library? | **Yes.** See below | Lower risk, but yes |

### The age filter is narrower than it looks

`app/api/prescribe/route.ts:216`:

```ts
if (playerAge && drill.min_age && drill.max_age &&
    (playerAge < drill.min_age || playerAge > drill.max_age)) continue
```

Three conditions must all hold. A drill missing either bound is **never
excluded**, and a team-scope request has no `playerAge` at all, so the filter
does not run. Whether that means "almost always off" depends on how many drills
carry both bounds — `scripts/drill-audit.mjs taxonomy` reports it.

### Generic matches can beat better drills

`scoreDrillRelevance` (`lib/analysis.ts:101`) is stemmed token overlap. The
weighting is thoughtful — `common_flaws_fixed` ×4 over `description` ×1, and
`skill_category` deliberately excluded with a comment explaining that including
it once caused a changeup-grip video to be recommended for a velocity question.

But it is still bag-of-words. For our traced query, a drill whose
`common_flaws_fixed` contains "dropping back shoulder" scores on *dropping*,
*back*, *shoulder*. So does a **shoulder** mobility arm-care drill, and so does
a drill about **backhands**. There is no notion of a phrase, and stemming makes
*back*/*backhand* collide.

The code partly knows this. There is a guard requiring a substantive hit rather
than description-only, and a comment on the pool construction states the score
"must not decide inclusion" — it only bounds the 40 candidates handed to
`pickRelevantDrills`, where a model does the real judging. **The scorer is a
recall filter, not the ranker.** Its failure mode is a good drill never
reaching the model, which is invisible.

### The model can invent drills

Nothing validates the response against the library on either path.

Chat's instructions (`lib/anthropic.ts:504`) say "ALWAYS check this library
first" and "include the YouTube link" — guidance, not enforcement. Nothing
parses the reply, and no drill ID round-trips.

The practice planner is stricter: the skeleton prompt says *"Use these by their
exact drill_name and youtube_video_id. Never invent an ID"*, and its JSON has
`drill_name` / `youtube_video_id` fields. But it is still an instruction. **No
code checks a returned `youtube_video_id` against `drill_resources` before the
plan is saved and rendered.**

Risk in practice: a hallucinated ID renders a dead video embed; a hallucinated
name renders a drill that has no page and cannot be favourited or swapped.

### The 100-drill ceiling

Chat takes the first 100 rows with no `ORDER BY`. Postgres does not guarantee
order without one, so **which** 100 is not defined and can change between
queries. If the library is larger than 100, some drills are invisible to chat —
non-deterministically. `scripts/drill-audit.mjs` reports the true count.

The practice planner caps at 45 after category filtering.

---

## Summary

Chat has no drill retrieval system — it has a prompt containing up to 100
drills and a model that reads them. Prescribe has a real pipeline with a
controlled problem vocabulary, and it is the only place BenchCoach understands
that "dropping his back shoulder" is a named, mappable deficiency.

The two do not share code. A coach who types the traced question into chat gets
the weaker system, and nothing routes them to the stronger one.
