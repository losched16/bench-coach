# Drill Intelligence Pilot — Instagram calibration

How to prepare Instagram drill discoveries for multimodal comparison against
the **current** BenchCoach production library.

**Safety rule, stated first:** nothing under `scripts/pilot/` writes to
production. The only Supabase access is `SELECT` over PostgREST. There is no
code path here that can reach `drill_resources`, `problem_taxonomy` or
`drill_problem_map` with a write, and `test-pilot.mjs` asserts that no pilot
script contains one. Discoveries go into `pilot/` for a human/AI review layer.
They do not go into the database.

---

## The shape of the data

One Instagram post is **not** one drill. A reel might be one drill, a variation
of one the library has, a four-drill circuit, a coaching cue with no drill at
all, or something to reject. So:

```
source (one Instagram post)
  └── extracted_units[]        zero, one or many
        ├── unit_type          drill | variation | progression | regression |
        │                      coaching_insight | taxonomy_insight |
        │                      questionable | reject
        ├── source_evidence    caption span, transcript span, frame refs
        ├── visual_notes       what the frames show          ← review layer
        ├── inferred_fields    mirrors drill_resources cols  ← review layer
        ├── benchcoach_candidates                            ← review layer
        ├── final_classification                             ← review layer
        └── human_decision                                   ← human
```

Shortcode `DccQM89N1vx` is why this matters — it names at least four drills in
one post. A model that forced it into one row would lose three of them.

Ingest populates **none** of the judgement fields. It records what Instagram
said and leaves every conclusion empty, because pre-filling them would bias
the calibration.

---

## Layout

```
pilot/
  reference/                  current production, read-only export
    drills.json
    problem_taxonomy.json
    drill_problem_map.json
  input/
    instagram-calibration.json    normalized Apify export
  media/<shortcode>/
    source.mp4                    stable local copy (gitignored)
    download-status.json          exact outcome of the fetch
    frames/                       (gitignored)
    frames.json                   filename + timestamp_seconds per frame
    contact-sheet.jpg
  calibration-manifest.json   the one file a reviewer opens
  .tools/                     local ffmpeg (gitignored)
```

---

## Commands, in order

### 0. ffmpeg

The build environment cannot reach GitHub releases, which is where
`ffmpeg-static` downloads from. `imageio-ffmpeg` ships the binary inside its
PyPI wheel, so:

```
pip install --target pilot/.tools/py imageio-ffmpeg
```

`lib.mjs` resolves ffmpeg from `$FFMPEG_PATH`, then `PATH`, then that wheel.
A system ffmpeg on `PATH` works too.

### 1. Export current production reference data

```
NODE_USE_ENV_PROXY=1 node scripts/pilot/export-reference.mjs
```

`NODE_USE_ENV_PROXY=1` matters in the remote environment: Node's `fetch`
ignores `HTTPS_PROXY` without it and Supabase calls fail with a 403 that reads
like an auth error.

Do **not** use `cowork-expansion/existing_drills.json`. It is an August 5th
snapshot that predates the taxonomy coverage migration, the durations, and the
metadata normalization; comparing against it produces "new drill" verdicts for
things already in the library.

### 2. Ingest the Apify export

```
node scripts/pilot/ingest-apify.mjs path/to/apify-export.json
```

Tolerant of Apify's field-name variants (`shortCode`/`shortcode`,
`videoUrl`/`downloadedVideo`, `timestamp`/`takenAtTimestamp`) and records
which raw field names were present. Refuses malformed shortcodes and duplicate
records.

Before the export is available:

```
node scripts/pilot/ingest-apify.mjs --stub DZvJFoNgz8C Dcrq_gmgUp5 DccQM89N1vx Dcd4H4gIb6v Dce5HRzxL8B
```

writes a clearly-flagged placeholder so the manifest has the five expected
posts as `pending`. A real ingest replaces it entirely.

### 3. Download the videos

```
NODE_USE_ENV_PROXY=1 node scripts/pilot/download-media.mjs            # all
NODE_USE_ENV_PROXY=1 node scripts/pilot/download-media.mjs DccQM89N1vx
```

Copies each `downloaded_video_url` to `pilot/media/<shortcode>/source.mp4`,
verifies it with ffmpeg, and writes `download-status.json` with the exact
outcome. A failure is reported with its HTTP status; nothing substitutes a
different video. An existing valid copy is kept, not re-fetched — Instagram
CDN URLs expire.

If the direct URL fails and `APIFY_TOKEN` is set and the record carries an
Apify key-value-store URL, that is tried second. Without a token it is reported
as skipped.

Exit code 2 if any download failed.

In this export every `downloadedVideo` is an **Apify key-value-store URL**
(`api.apify.com/v2/key-value-stores/…`), not an Instagram CDN link. That is
better for durability — KV records do not expire the way CDN URLs do — but
`api.apify.com` is blocked in the remote build container. The status file
records the real cause rather than undici's bare "fetch failed":

```
fetch failed <- Request was cancelled. <- UND_ERR_ABORTED: Proxy response (403) !== 200 when HTTP Tunneling
```

The Instagram CDN link is kept as `media.alternate_video_url` in case the
Apify store is ever unreachable from a machine that *can* reach Instagram.

### 4. Extract frames and contact sheets

```
node scripts/pilot/extract-frames.mjs                # every downloaded source
node scripts/pilot/extract-frames.mjs DccQM89N1vx
node scripts/pilot/extract-frames.mjs --video any.mp4 --out some/dir
```

Strategy: opening frame, a cadence (4s for ≤45s, 6s to 90s, 8s beyond), the
final frame, plus every point ffmpeg's scene detector sees the picture change.
Anything within 1.5s of a kept frame is dropped, which is what keeps a
164-second source at a few dozen frames rather than a hundred. A 30-second reel
lands at 9–12 frames.

Writes `frames/frame-NNN-<t>s.jpg`, `frames.json` (filename, timestamp,
reason), and `contact-sheet.jpg` with timestamps burned in.

### 5. Build the manifest

```
node scripts/pilot/build-manifest.mjs
```

Assembles `pilot/calibration-manifest.json` from the ingested input, the
download statuses and the frame manifests. Re-runnable: judgement fields from a
previous manifest are carried forward so a review in progress is not wiped.

**One narrow exception to "never pre-populate."** The brief said `DccQM89N1vx`
names four drills. The manifest checks that claim against the caption
deterministically and records the outcome in `hints` either way. When every
expected name is found verbatim — as it is: the caption lists them in a
"Name - benefit" structure and says "reps of each drill" — the four names and
their caption lines are seeded as units marked `seeded_by: caption-parse`.
That is transcription of what the creator wrote, not a judgement about what
the video shows. Every field a reviewer has to decide — `inferred_fields`,
`benchcoach_candidates`, `final_classification` — stays empty, and the test
suite asserts it. No other source is seeded.

### 6. Search candidate BenchCoach drills

```
node scripts/pilot/search-drills.mjs split grip swing
node scripts/pilot/search-drills.mjs --age 10 --category hitting "side flip"
node scripts/pilot/search-drills.mjs --json --top 5 jump back
```

Term matching over `drill_name`, `common_flaws_fixed`, `mechanic_focus`,
`primary_skill`, `secondary_skill`, `tags`, `description`,
`ai_coaching_notes` and `skill_category`, with optional age and category
filters. Every hit says which field matched.

**Candidate retrieval only.** No result means no *term* match — it says
nothing about whether the drill is new. A high score means the words overlap,
not that the mechanics do. Whether an Instagram reel duplicates a library
drill is a judgement for the review layer. No embeddings: the library is 206
rows and a reviewer needs to see *why* a candidate surfaced.

### 7. Validate

```
node scripts/pilot/test-pilot.mjs
```

Infrastructure checks pass with no network and no Apify export (they use a
synthetic fixture and a locally generated video). Pilot state is reported, not
asserted — an undownloaded reel is a blocked network, not a bug.

---

## Environment limitations in the remote build container

| Host | Status | Effect |
|---|---|---|
| Supabase (PostgREST) | reachable | Task 1 works |
| PyPI, npm | reachable | ffmpeg via imageio-ffmpeg works |
| instagram.com, `*.cdninstagram.com`, `*.fbcdn.net` | **403 at proxy** | Task 3 cannot run here |
| api.apify.com | **403 at proxy** | Apify fallback cannot run here |
| GitHub releases | **403 at proxy** | `ffmpeg-static` postinstall fails; use the wheel |

Tasks 3–5 run anywhere with ffmpeg and open egress — a laptop, or a CI job
with network access. Commit the resulting `frames.json`, contact sheets,
`download-status.json` and the manifest; the MP4s and frame directories are
gitignored.
