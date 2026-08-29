# Duplicate and near-duplicate candidates

From the production export, 29 Aug 2026. **Nothing was merged, deleted or
changed.** These are candidates for a human to judge.

Detection used four signals: normalised name equality, identical/near-identical
description text (SequenceMatcher > 0.85 within a category), shared
`youtube_video_id`, and category + mechanic overlap.

---

## Cluster 1 — "10 Best Baseball Hitting Drills for Kids"

Two records, **same name, same video, same category, same difficulty.**

| | A | B |
|---|---|---|
| id | `0d6f53b2-ca7d-45ae-b0d2-eac1d8c13f9a` | `ebd5359b-cccd-4249-b2d9-6e66987535eb` |
| video | `gOE484Meo_o` | `gOE484Meo_o` |
| category / difficulty | Hitting / Beginner | Hitting / Beginner |
| progression_level | null | null |
| status | approved | approved |
| coach-authored | no | no |
| **mappings** | inconsistent-contact, fear-of-ball, stepping-in-bucket | throwing-mechanics, fear-of-ball, late-timing, inconsistent-contact, plate-confidence |
| description | "A compilation of 10 kid-friendly hitting drills from MOJO Sports including tee work, soft…" | "MOJO Sports presents 10 kid-friendly hitting drills including tee work, soft toss variatio…" |

**Why flagged:** identical name and video; descriptions are paraphrases of each
other.

**Key difference:** the mappings diverge. B carries `throwing-mechanics` on a
*hitting* compilation, which looks like a mis-mapping regardless of the
duplication question. Merging naively would inherit it.

---

## Cluster 2 — "Soft Toss From the Side"

| | A | B |
|---|---|---|
| id | `d38bd8d0-2293-41ce-a97d-b5cb15f47fbc` | `18e0cf1e-7f9b-4e51-9125-db81b04811a3` |
| video | `O7FHkj4EUpY` | `O7FHkj4EUpY` |
| category / difficulty | Hitting / Beginner | Hitting / Beginner |
| **progression_level** | **null** | **2** |
| status | approved | approved |
| coach-authored | no | no |
| mappings | inconsistent-contact, pulling-head, late-timing | inconsistent-contact, late-timing, pulling-head |
| description | "A partner kneels to the side and tosses balls underhand into the hitter's strike zone…" | "A fundamental soft toss drill from Ripken Baseball where a partner kneels to the side…" |

**Why flagged:** same name, same video, same three mappings (different order),
descriptions describe the same drill.

**Key difference:** B has `progression_level = 2`; A has none. If these are
consolidated, B is the better-populated record.

Note a third record, plain "Soft Toss", also uses video `O7FHkj4EUpY`.

---

## Cluster 3 — "Tee Drill" / "Tee Work"

| | A | B |
|---|---|---|
| id | `bd106179-ca57-47ef-9e7e-5f8f235405b0` | `6a2c9dc7-f08c-47fd-9a08-f9e117f466cb` |
| name | Tee Drill | Tee Work |
| description similarity | **1.000 — byte-identical** | |
| category | Hitting | Hitting |

**Why flagged:** different names, **identical description text**. Both share
video `q7CPS0RYDPM` with six other drills.

---

## The bigger pattern: 16 videos backing 103 drills

Not duplication in the usual sense, and more consequential than the three
clusters above.

**103 of 206 drills (50%) share a `youtube_video_id` with at least one other
drill, and `youtube_start_seconds` is null on every single one.**

| Video | Drills | Examples |
|---|---|---|
| `4NOo7JSK6eA` | **19** | The Rocker Drill · Heel-Toe Drill · Square Hips / Hip Lock · Glove-Side Pull · Wall Ball · Long Toss · Funnel Drill … |
| `YRAjMC5F4sg` | 10 | Foul Line Throw · Extreme Catch · Bullseye Challenge · Over-Under · Point-and-Go Glove … |
| `77r6mWAUecA` | 10 | High Tee Drill · Knee Drill · Throwing Progression · Kneel-Down Throw · Partner Catch … |
| `McHb2hXrTrE` | 9 | Stride Drill · Kneel-Down (Wrist Snap) · Stride Direction · Follow-Through Hold · Knee Drill … |
| `UeJpXF55kvs` | 8 | PVC Pipe Hip Rotation · Stance Drill · Stride Pause to Stride Swing · Swing Rail … |
| `q7CPS0RYDPM` | 8 | Tee Drill · Front Toss · Two-Tee Drill · Tee Work · Low Tee … |
| `ImeXGqKYP7Y` | 8 | Flamingo Balance · Towel Drill · Balance Drill · Leg Lift · Balance Point … |
| `3Xqb7j2BYTU` | 6 | Catch and Crush · Shoulder Swings · Frisbee Drill · Barry Larkin Power … |
| `9XkdpzNrswo` | 5 | One Hand Hitting · One-Hand Tee (Bottom) · One-Hand Tee (Top) · Inside-Out Swing … |
| 7 more | 20 | |

**This is almost certainly intentional decomposition** — one long instructional
video broken into the individual drills it teaches — and it is a reasonable way
to build a library. `youtube_start_seconds` exists precisely for it (migration
036).

**But it was never filled in.** So every one of those 103 drills links to the
same video opening at 0:00. A coach who taps "Heel-Toe Drill — Front Foot
Landing" gets a 14-minute mechanics breakdown and has to hunt for the segment.

**Recommendation for triage: do not treat these as duplicates.** They are
distinct drills with a broken deep-link. The fix is populating
`youtube_start_seconds`, not merging records. Only clusters 1–3 above are
genuine duplicate candidates.

---

## Mapping-quality observations

Not duplicates, but surfaced by the same pass. **Observations, not corrections.**

- **412 distinct `common_flaws_fixed` strings; 92 (22%) match no taxonomy label
  or alias.** Recurring unmatched ones include `incorrect grip` / `improper
  grip` (3× each — synonyms of each other), `poor weight transfer` (3×), `lack
  of coordination` (3×), `stiffness` / `stiff arm` / `stiff hands` (2× each),
  `downhill shoulders`, `standing too upright`, `wide arm circle`. These look
  like genuine taxonomy gaps.
- **309 of 412 flaw strings are used exactly once.** The vocabulary is very
  long-tailed.
- **One case variant:** `"slow transfer"` (5×) vs `"Slow transfer"` (2×). The
  exact-match paths treat these as different strings.
- **3 of 166 mapped drills** are mapped to a problem that none of their own flaw
  strings points at — consistent with the 236 auto-backfilled mappings.
- **7 drills have flaw strings but no taxonomy mapping at all.**
- **33 drills have neither flaws nor mappings** — invisible to problem-based
  retrieval entirely.
