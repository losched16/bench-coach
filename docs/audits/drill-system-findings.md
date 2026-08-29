# Drill system — assessment of the current state

Discovery pass, 29 Aug 2026. Nothing here is implemented; this names what is
true today and what looks worth evaluating.

---

## Strong today

**The problem taxonomy is the real asset.** `problem_taxonomy` +
`drill_problem_map` with a `curated` flag is a genuine controlled vocabulary
mapping coach language to named deficiencies. It is exactly the structure a
recommendation system needs, it already exists, and it is hand-verified where
`curated = TRUE`. Any redesign should build on this rather than around it.

**`diagnose()` is well-judged.** It maps free text to slugs and is explicitly
permitted to return nothing: *"Many requests are goals rather than flaws… Do
not force a bad match."* It falls back to alias substring matching if the model
call fails. Refusing to force a match is the right instinct and is rarer than
it should be.

**Scope enforcement is real.** `visibleDrills` is mandatory and
`scripts/verify-drill-scope.mjs` fails the build if a query bypasses it. One
coach cannot see another's drills, and that is checked mechanically rather than
remembered.

**Prior failures are encoded as comments.** `scoreDrillRelevance` excludes
`skill_category` with a note explaining that including it recommended a
changeup-grip video for a velocity question. The pool comment states the
keyword score "must not decide inclusion". This is institutional memory in the
right place.

**The two-phase practice generator** is a sound latency design, and the printed
sheet's derivation layer (`lib/practicePlan.ts`) already does real duration
arithmetic.

## Weak today

**Chat has no retrieval.** `app/api/chat/route.ts:276` dumps the first 100
drills, unordered and unfiltered, into the prompt. The user's question does not
participate in selection. This is the surface a coach most naturally uses, and
it is the weakest path in the system.

**The two paths do not share code.** Prescribe understands problems; chat does
not; nothing routes a coach from one to the other. The same question gets a
materially different answer depending on which screen it was typed into.

**The age filter rarely fires.** It requires `playerAge && min_age && max_age`
all present, and does not run at all for a team-scope request.

**Category matching is worked around, not fixed.** `ilike`-any with a comment
about inconsistent casing, plus a hardcoded spelling list in
`lib/focusAreas.ts`. Any category not on that list is invisible to the planner.

**Free-text classification everywhere.** `skill_category`, `difficulty_level`,
`common_flaws_fixed`, `mechanic_focus` are all uncontrolled strings. Some code
paths compare them case-insensitively and some do not.

**`est_duration_minutes` is not selected by the practice planner.** The column
exists; the surface that most needs it never asks for it.

**Nothing validates model output against the library.** No returned
`youtube_video_id` or `drill_name` is checked before a plan is saved.

## Missing metadata

Concepts with no column at all. The operational cluster is the most
consequential:

- **Player counts** — min / max / ideal. Nothing.
- **Coaches required.** Nothing. The practice request has no field for it either.
- **Space** — indoor/outdoor, cage vs field vs backyard. Nothing.
- **Practice-plan role** — warmup / teaching / repetition / station / game /
  assessment / conditioning / cooldown. The generator emits these per block but
  they are not properties of a drill.
- **Teach vs rehearse.** No field distinguishes a drill that introduces a skill
  from one that accumulates reps on it.
- **Prerequisites.** Nothing.
- **Related / progression / regression drill links.** `progression_level` is an
  ordinal, not a relationship.
- **Structured coaching intelligence.** `ai_coaching_notes` is one prose blob.
  No cue list, no common mistakes, no corrections — even though the generator
  produces all three per block and the SEO layer stores them per drill.
- **Tags / keywords / embeddings.** None, and no vector search.
- **Equipment counts.** `equipment_needed[]` says *what*, never *how many*.
- **Slug.** No stable human-readable identifier.
- **Practice ↔ drill foreign key.** Plans store drill names as text in JSONB.

## Retrieval risks

1. **Chat recommends by vibes.** No filtering means age, equipment, player
   count and skill level cannot influence the answer except by the model
   reading a wall of text.
2. **The 100-drill ceiling is non-deterministic.** No `ORDER BY`, so *which*
   100 chat sees is undefined and can change between calls. If the library
   exceeds 100, some drills are permanently invisible on some requests.
3. **Bag-of-words collisions.** Stemmed token overlap has no phrase concept.
   "dropping his back shoulder" matches shoulder mobility drills and backhand
   drills. Mitigated by handing 40 candidates to a model, but a good drill that
   scores poorly never reaches it — and that failure is silent.
4. **Hallucinated drills.** Nothing validates output. A fabricated video ID
   renders a dead embed.
5. **`do_not_coach_flag` is invisible to chat and the planner.** Neither
   `DRILL_SELECT` includes it. A drill explicitly marked do-not-coach can be
   recommended.
6. **Unrecognised `difficulty_level` values sort last** via `DIFFICULTY_RANK`,
   silently.
7. **The widen-on-thin fallback is unsignalled.** Fewer than 8 matches
   re-queries with no category filter, so the model may be picking from
   unrelated drills with nothing indicating it.

## Practice-planning risks

1. **Simultaneous equipment demand is unmodelled.** Two stations needing the one
   tee is consistent with every rule the system enforces. Most likely cause of a
   plan that cannot physically be run.
2. **Coach count never reaches the model.** The prompt asks it to flag "one
   adult against two places to stand" without telling it how many adults there
   are.
3. **Durations are never verified.** "Must add to about N minutes" is an
   instruction; no code sums the blocks.
4. **Drill durations are invisible** — `est_duration_minutes` not selected.
5. **No transition or setup budget.** Blocks are assumed to abut exactly.
6. **Space is free text at best.** "One batting cage" arrives, if at all, inside
   `constraints`.
7. **No throwing-volume arithmetic**, despite `pitch_counts` existing elsewhere
   in the app.
8. **No cross-practice variety memory.** Nothing detects the same drill three
   weeks running.
9. **Station maths is entirely the model's.** Nothing computes players ÷
   stations or resulting queue length.

## Highest-leverage opportunities

Ranked by expected improvement per unit of work. **Not recommendations to
implement — candidates to evaluate.**

1. **Give chat the prescribe pipeline.** The single biggest gap. A real
   retrieval path already exists and is well-designed; the most-used surface
   does not use it. Largest quality gain available, and mostly wiring rather
   than new invention.
2. **Add the operational columns** — min/max/ideal players, coaches required,
   space, indoor/outdoor, practice-plan role. These are what make a generated
   practice *runnable*, and none of them exist. Cheap schema, expensive to
   backfill.
3. **Validate model output against the library.** Reject or strip any
   `drill_name` / `youtube_video_id` not present in `drill_resources` before a
   plan is saved. Small, self-contained, removes a whole failure class.
4. **Select `est_duration_minutes` and check the arithmetic.** The column and
   the maths (`lib/practicePlan.ts`) both already exist; they just are not
   connected to generation.
5. **Controlled vocabularies for `skill_category` and `difficulty_level`.**
   Would remove the `ilike` workaround, the hardcoded spelling list, and the
   silent `DIFFICULTY_RANK` sort failure.
6. **Structure the coaching intelligence** — cues, common mistakes,
   corrections as arrays rather than one prose blob. The app already generates
   these repeatedly and throws them away; `lib/seoResource.ts` `SeoDrill` is a
   ready-made shape.
7. **Model equipment as a countable resource** and check concurrent blocks
   against it.
8. **Fix the age representation.** Four columns expressing the same idea, one of
   which filters and one of which (`age_relevance`) appears to have no reader.
9. **Drill relationships** — related / progression / regression as real links,
   enabling "they've got this, what's next".
10. **Practice ↔ drill foreign keys**, so usage is queryable and "don't repeat
    last week" becomes possible.

**Two outstanding bugs found in passing**, both pre-existing and unrelated to
this audit's scope:

- `stageOf()` in `lib/progression.ts` clamps to 3 while live data contains
  `progression_level = 4`.
- `do_not_coach_flag` is not selected by chat or the practice planner.

## The thing worth deciding first

Most items above are metadata work, and metadata work is only worth doing if
something reads it. Today, three of the four surfaces read almost nothing: chat
filters on nothing, the planner filters on one field, and the model is doing the
reasoning in all cases.

**So the prior question is architectural, not editorial: does BenchCoach want a
retrieval system that filters and ranks, or a well-fed prompt?** The current
answer is "a well-fed prompt, except in prescribe". Adding twelve columns
nothing queries would change nothing.
