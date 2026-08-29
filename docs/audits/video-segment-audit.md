# Where does this drill actually start?

**29 August 2026.** Phase 2D.

Phase 2C measured that 42% of scheduled drill slots hand a coach a compilation
video opening at its introduction. This phase set out to fix that.

**It fixed the mechanism. It did not fix the data, and the data is the half a
coach can feel.** Read section 3 before reading anything else as success.

---

## 1. The audit

| | |
|---|---|
| Approved drills | 206 |
| Drills with a video | 205 (one has none) |
| Unique videos | 118 |
| Videos backing more than one drill | 16 |
| Drills sharing a video | **103** |
| Single-drill videos | 102 |
| Drills with a segment start | **0** |

The worst offenders:

| Video | Drills | Categories |
|---|---|---|
| `4NOo7JSK6eA` | **19** | Pitching / Throwing |
| `YRAjMC5F4sg` | 10 | Throwing |
| `77r6mWAUecA` | 10 | Hitting / Throwing |
| `McHb2hXrTrE` | 9 | Pitching |
| `UeJpXF55kvs` | 8 | Hitting |
| `q7CPS0RYDPM` | 8 | Hitting |
| `ImeXGqKYP7Y` | 8 | Pitching |

Nineteen separately named drills — "The Rocker Drill", "The Heel-Toe Drill",
"Funnel Drill", "Long Toss" — resolve to one URL, at second zero.

### Priority queue

| | Count | Definition |
|---|---|---|
| **P0** | 11 | scheduled by the Phase 2C evaluation AND shared video at 0:00 |
| **P1** | 13 | taxonomy-curated AND shared video at 0:00 |
| **P2** | 79 | other shared-video drills at 0:00 |
| **P3** | 102 | single-drill videos at 0:00 |
| — | 1 | no video |

P3 is last on purpose: a single-drill video opening at 0:00 is usually correct,
because the video *is* the drill.

### A correction to the Phase 2C write-up

That report said Tee Work, Low Tee and Line Drive Pro "all come off the same
film". They do not. **Tee Work and Low Tee share `q7CPS0RYDPM`; Line Drive Pro
is on `UeJpXF55kvs`.** The point stands — two of the three are one video and
currently resolve to an identical URL — but the claim as written was wrong and
has been corrected in the source comment and the 2C document.

---

## 2. What was actually broken in the code

`youtube_start_seconds` has existed since **migration 036** and has been in
`DRILL_FIELDS` the whole time. No new column was needed for the timestamp
itself. The brief was right to ask first.

The defect was that the field reached **two of the ten places that render a
video**. Every other surface built its own URL:

```
href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
```

Written out eight times, in eight files. Note what it does: it prefers the
**stored URL**, which contains no timestamp. So a fully curated
`youtube_start_seconds` would have been ignored by six of the seven links a
coach can click — **including both of chat's**, one of the two surfaces the
brief names explicitly.

Nothing was visibly broken. The links worked. They just went to 0:00.

**This is the finding that mattered most.** Curating 103 timestamps into a
codebase that could only display them in two places would have wasted almost
all of the effort, and nothing would have reported it.

### The fix

`lib/drillVideo.ts` — one module, no I/O:

- `videoIdFor` / `parseVideoId` — handles watch, `youtu.be`, embed and shorts
- `startSecondsFor` — null, zero, negative, NaN and Infinity all collapse to 0
  (a bad `start=` does not degrade gracefully; YouTube fails the whole embed)
- `watchUrl` — re-stamps `t=` from the drill, replacing any existing one rather
  than appending a second that YouTube would ignore
- `embedUrl` — `youtube-nocookie`, `start=`, optional autoplay
- `thumbnailUrl`, `hasVideo`, `hasSegment`
- `parseStartFromUrl` — chat's route in, since chat renders from the model's
  prose and the URL is the only place a timestamp can arrive
- `formatTimestamp` / `parseTimestamp` — `"4:12"` ⟷ `252`, refusing input it
  cannot read rather than returning a plausible wrong number

Migrated: `DrillOptions`, `DrillReview`, `PriorityDrills`, `PlanCards`,
`DrillVideo`, `ChatMessageContent`, `dashboard/prescribe`, `dashboard/drills`.
`DrillVideo`'s private `extractVideoId` was deleted — a second URL parser only
drifts from the first. The drill menus in `drillRetrieval` and `anthropic` now
emit the timestamped link so the model can reproduce it.

`scripts/verify-video-links.mjs` fails the build if any file outside the helper
constructs a YouTube URL. Two exemptions: the helper, and the admin link
checker, which calls oembed to see whether a video still exists — a different
job that deliberately wants no timestamp.

---

## 3. What was NOT delivered, and why

**No timestamps were written.** 0/206 before, 0/206 after.

Not an oversight, and not a decision taken lightly. There is no timestamp
evidence in this library and none reachable from this environment. Checked
exhaustively:

| Source | Result |
|---|---|
| `youtube_start_seconds` | 0 / 206 |
| `duration` column | empty on every row |
| Timestamps in `description`, `ai_coaching_notes`, `reps_guidance`, `frequency_guidance`, `safety_notes` | **zero matches, any format** |
| `t=` or `start=` in any stored `youtube_url` | **zero** |
| YouTube chapter markers / descriptions | **unreachable — 403 at the network proxy** |

So a timestamp written here would have been invented. And a **wrong segment
start is worse than none**: at 0:00 a coach knows where they are and scrubs;
dropped forty seconds into a different drill they conclude the link is broken
and stop trusting the rest. The brief's own closing line is the standard —
"the phase succeeds when a coach clicking the specific recommended drill lands
at the specific drill segment" — and inventing numbers would have produced a
green test suite and a worse product.

The library's standing rule against manufacturing data applies exactly here.

### What was built instead

`scripts/curate-video-segments.mjs`:

```
node scripts/curate-video-segments.mjs audit         the priority breakdown
node scripts/curate-video-segments.mjs worksheet     CSV to fill in
node scripts/curate-video-segments.mjs ingest <csv>  emits migration 050
```

The worksheet (`docs/audits/video-segment-worksheet.csv`, 205 rows, P0 first)
carries the video URL and every drill sharing it, so one pass through a video
resolves all of its drills at once. `ingest` accepts `"4:12"` or raw seconds,
requires a provenance value, and **refuses the whole file** on any malformed
row rather than applying it partially — verified both ways.

Migration **049** adds `youtube_start_source` (`chapter` / `description` /
`manual-review` / `imported`) plus a partial index to find any timestamp
lacking one, because a value nobody can trace is a value nobody can re-check.

---

## 4. Tests

`npm run test:drill-video` — **176 assertions**, deliberately split:

**Mechanism** (delivered): URL construction in every shape; every degenerate
`startSeconds` collapsing to 0; `t=` replaced not duplicated; the 19-drill
compilation producing 19 distinct URLs when dated and 1 when not; Tee Work and
Low Tee distinguishable once dated; chat, plan cards and the video component
all importing the helper.

**Invariance**: the six representative prompts run against the library with and
without segment starts on every row, asserting identical ids, order, scores to
four decimals and eligibility — and identical schedules at 30/60/90 minutes.
Duplicate suppression is asserted not to key on the timestamp. A timestamp is
presentation and must not become a ranking signal by accident.

**Data** (not delivered): the current state asserted as measured fact —
`0` drills with a segment, `103` shared-video drills at 0:00. These fail the
moment curation begins, which forces the numbers here to be updated with it.

---

## 5. The scoreboard

| | Before | After |
|---|---|---|
| Unique videos | 118 | 118 |
| Shared videos | 16 | 16 |
| Shared-video drills | 103 | 103 |
| **Shared-video drills at 0:00** | **103** | **103** |
| P0 fixed | — | **0 / 11** |
| P1 fixed | — | **0 / 13** |
| Phase 2C scheduled slots at 0:00 | 24 / 24 | 24 / 24 |
| — of those on a shared video | 10 / 24 | 10 / 24 |
| Curated taxonomy matches at 0:00 | 13 | 13 |
| Surfaces that apply a timestamp | **2 / 10** | **10 / 10** |

Only the last row moved. It is the row that had to move first — every other
row is now one curation pass away from moving, and before this phase it was
not.

---

## 6. What to do next

Fill in the worksheet, starting with the 11 P0 rows. They cluster on seven
videos, so this is roughly seven videos watched, not eleven — and `4NOo7JSK6eA`
alone resolves 19 drills in one sitting. Then:

```
node scripts/curate-video-segments.mjs ingest segments.csv > migrations/050_video_segments.sql
```

Run 050, re-run `npm run test:drill-video`, and update the table in section 5.
