# Drill & Problem Library — Expansion Brief (for Cowork)

**Goal:** Add **new** problems (domains) and **new** drills. Additive only — build on
what exists, no overlap, no schema changes.

**What's here:**
- `existing_problems.json` — all **35** current problems (slug, label, skill_category, description, aliases). Dedupe against these.
- `existing_drills.json` — all **163** current drills (id, drill_name, youtube_video_id, skill_category, difficulty_level, progression_level). Dedupe against these.

---

## Where new records go (3 Supabase Postgres tables)
- **`drill_resources`** — the drills (each backed by a real YouTube video).
- **`problem_taxonomy`** — the problems/domains.
- **`drill_problem_map`** — links drills → problems (which drill fixes which problem).

Write via the Supabase REST API (PostgREST). No DDL — we're only inserting rows, the
tables already exist. Credentials are in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) — **read them from env, never hardcode**.

---

## Hard dedupe rules
1. **Drill dedupe key = `youtube_video_id`.** Never add a drill whose video id is already in `existing_drills.json`. One video = one drill.
2. **No near-duplicate drills.** Don't add a drill with essentially the same name/purpose as an existing one in the same `skill_category`.
3. **New problems must be genuinely new.** A new `slug` must not exist in `existing_problems.json`, and its meaning must not overlap an existing problem or its `aliases` (e.g., don't re-add "casting" as a new "long swing" problem — it's already `casting`).

## Priority: fill the gaps, don't pile onto Hitting
Current coverage is lopsided:
- **Drills:** Hitting 48 · Throwing 36 · Pitching 30 · Fielding-Infield 14 · Fly Balls 8 · Baserunning 7 · Catching 7 · Bunting 3 · Arm Care 2. → **114 of 163 are hitting/throwing/pitching.**
- **Difficulty:** Beginner 95 · Intermediate 66 · **Advanced 2.**
- **Problems by category:** Hitting 12 · Throwing 7 · Pitching 5 · Baserunning 3 · Fielding-Infield 3 · Catching 2 · Fly Balls 2 · Arm Care 1.

**Prioritize (roughly in this order):**
1. **Advanced / progression-ceiling drills** — the library dead-ends at Intermediate. Add Advanced drills across all skills so plans can escalate.
2. **Under-covered existing categories:** Baserunning, Catching, Fielding (Infield + Fly Balls), Bunting, Arm Care.
3. **Missing domains entirely** (no problems today): catcher receiving/framing/blocking, sliding, cutoffs & relays, rundowns, first-base footwork, outfield communication/priority calls, pitch grips & the changeup, off-speed/pitch recognition at the plate, situational hitting, base-stealing/leads, conditioning & agility, and true T-ball / first-timer fundamentals.

---

## `drill_resources` — field spec (populate all that apply)
| Field | Type | Notes |
|---|---|---|
| `drill_name` | text | Required. Distinct, specific. |
| `description` | text | 1–2 sentences: what it is + what it fixes. |
| `youtube_url` | text | Required. Real, working video. |
| `youtube_video_id` | text | Required. The 11-char id. **Dedupe key.** |
| `thumbnail_url` | text | `https://img.youtube.com/vi/<id>/hqdefault.jpg` |
| `channel` | text | Source channel (attribution). |
| `skill_category` | text | **Use EXACT canonical string** (see vocab below). |
| `primary_skill` / `secondary_skill` | text | usually mirrors category / a sub-skill |
| `tags` | text[] | keywords |
| `age_range` | text | e.g. `"8-12"` |
| `min_age` / `max_age` | int | numeric bounds (used for age gating) |
| `difficulty_level` | text | `Beginner` \| `Intermediate` \| `Advanced` |
| `progression_level` | int | 1–5, foundational→advanced |
| `indoor_outdoor` | text | e.g. `Indoor/Outdoor`, `Outdoor`, `Both` |
| `space_required` | text | `Small` \| `Medium` \| `Full field` |
| `requires_partner` | bool | |
| `equipment_needed` | text[] | e.g. `["bat","tee","balls"]` |
| `mechanic_focus` | text[] | mechanics it targets |
| `common_flaws_fixed` | text[] | plain-language problems it fixes — **align to problem labels/aliases** so auto-mapping works |
| `safety_notes` | text | required for throwing/pitching/arm work |
| `ai_coaching_notes` | text | concrete coaching cues |
| `reps_guidance` | text | e.g. `"3 sets of 10"` |
| `frequency_guidance` | text | e.g. `"2-3x/week"` |
| `success_markers` | text[] | observable "you'll know it's working when…" |

**`skill_category` canonical vocab (use these EXACT strings):**
`Hitting`, `Soft Toss`, `Bunting`, `Pitching`, `Throwing`, `Fielding (Infield)`,
`Fielding (Fly Balls)`, `Catching`, `Baserunning`, `Arm Care`, `Athletic Development`, `Warmup`.
If you introduce a genuinely new category, keep the same casing/format and list it in your output notes.

## `problem_taxonomy` — field spec
| Field | Type | Notes |
|---|---|---|
| `slug` | text (PK) | kebab-case, unique, **new**. e.g. `changeup-grip` |
| `label` | text | coach-facing. e.g. `"Doesn't have a changeup"` |
| `skill_category` | text | same vocab |
| `description` | text | one line |
| `aliases` | text[] | plain-English phrases a coach would type **+** likely flaw strings. This is what routes a complaint → this problem and auto-maps drills. Be generous. |

## `drill_problem_map` — field spec
| Field | Notes |
|---|---|
| `drill_id` | the new drill's uuid |
| `problem_slug` | the problem it fixes |
| `sort_order` | 1..N, foundational→advanced within that problem |
| `curated` | `true` if you hand-sequenced it with reps + success markers (quality tier) |

---

## Recommended output flow (review-first, then apply)
Produce three staged files, then apply:
1. `cowork-expansion/new_problems.json` — array of problem_taxonomy rows.
2. `cowork-expansion/new_drills.json` — array of drill_resources rows.
3. `cowork-expansion/new_mappings.json` — array of `{drill_ref, problem_slug, sort_order, curated}` where `drill_ref` is the new drill's `youtube_video_id` (resolve to `drill_id` at insert time, since ids are DB-generated).

**Apply (REST upsert, reads key from env):**
```bash
# problems
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/problem_taxonomy" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
  --data-binary @cowork-expansion/new_problems.json

# drills (returns the inserted rows incl. generated ids)
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/drill_resources?select=id,youtube_video_id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  --data-binary @cowork-expansion/new_drills.json
# then map youtube_video_id -> id from the response, build drill_problem_map rows, POST them.
```
Alternative: emit a single `NNN_expansion.sql` of INSERTs to paste in the Supabase SQL editor.

## Quality bar
- Real, working YouTube videos from reputable youth-baseball channels (verify the id resolves).
- Age-appropriate and safe; include `safety_notes` for anything throwing/pitching/arm.
- Concrete `ai_coaching_notes`; observable `success_markers`.
- For each **new problem**, attach **2–4 curated drills** sequenced foundational→advanced (`curated: true`, real reps + success markers) — same standard as the existing 12 curated problems.
- Re-verify dedupe (video id + problem slug) right before writing.

## Guardrails
- **Do not** `ALTER`/`DROP` tables or touch existing rows — additive inserts only.
- **Do not** modify the 35 existing problems or 163 existing drills.
- Keep the service-role key out of any committed file.
