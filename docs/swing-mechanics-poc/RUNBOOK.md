# Swing mechanics POC — runbook

Everything below runs locally or in an isolated test environment. Nothing here
deploys, migrates a database, or reads production data.

## 1. Analyzer (Python)

Requirements: Python 3.11, FFmpeg/ffprobe 6+, and on Linux the EGL/GLES
libraries MediaPipe loads even on CPU (`apt-get install libegl1 libgles2 libgl1`).

```bash
cd analyzer
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
scripts/fetch_model.sh            # MediaPipe Pose Landmarker (full), sha256-checked
# Test fixtures from MediaPipe's public test image (an adult, not a swing), sha256-checked:
scripts/fetch_test_image.sh .cache/pose.jpg
.venv/bin/python -m swing_analyzer fixtures .cache/pose.jpg fixtures --phone
.venv/bin/python -m unittest discover -s tests -v
```

Analyse one clip (contact time in ms from the first frame, as marked by the coach):

```bash
.venv/bin/python -m swing_analyzer analyze my_swing.mov --contact-ms 2140 \
  --handedness R --view face_on --out out/my_swing.json
.venv/bin/python -m swing_analyzer overlay out/my_swing.json my_swing.mov out/my_swing_overlay.mp4 --stills out/stills
```

`--foot-strike-ms` overrides the automatic foot-strike estimate. `--capture-fps 240` is
required for a slow-motion clip that was **shared or exported** (it plays back slower than
real time); a slow-mo original straight from the phone carries its real timestamps.

Other commands: `prepare VIDEO OUTDIR` (browser playback copy + alignment proof, exit 3 if
not aligned), `purge --data-dir D --older-than-days N` (retention), `registry-doc`
(regenerates `mechanics-registry.md`), `contact-sheet` and `validate` (below).

## 2. Real-swing validation

One command, one private folder, one report. Nothing is uploaded; the folder is
git-ignored (the command refuses a folder git would track) and owner-only.

**Getting the video onto the machine.** The clip is a child's image. Never commit it,
attach it to an issue or PR, put it in a public or link-shared folder, or paste frames into
a chat. Prefer a consenting adult's swing for the first run. For a player, have the
parent's consent for this test. Copy the file straight into `analyzer/out/private/`
(git-ignored); delete it and the run folder when the review is done. If the run happens in
a cloud session, say explicitly that the clip may be processed there; the analyzer runs
on that machine and sends no frame to any AI service, and no evidence image is opened by
an assistant unless you ask.

**Recording.** Phone on a tripod or wall, level with the hips, side-on (facing the
hitter's chest or back), 10–15 ft, whole body head to feet in frame, one hitter, good light,
start a second before the swing. Slow-mo if available. iPhone: HDR Video on is fine for the
first run (the report checks it), but if pose coverage is poor, turn it off.

```bash
# 1. Find contact by eye: a labelled sheet of frames around a time you estimate.
bash scripts/swing-poc/validate-real-swing.sh --contact-sheet analyzer/out/private/swing.mov --around-ms 1800
# 2. Run it. You must say whether the file is an exported slow-mo clip.
bash scripts/swing-poc/validate-real-swing.sh analyzer/out/private/swing.mov \
  --contact-ms 1834.2 --handedness R --view face_on --not-slowmo [--foot-strike-ms 1501.0]
#   exported/shared slow-mo: replace --not-slowmo with --capture-fps 240
```

`--foot-strike-ms` (your mark) is compared with the automatic estimate, and the numbers
are measured to yours. The report (`analyzer/out/private/<run>/report.md`) covers: video
properties (codec, bit depth, HDR, rotation, frame intervals, start offset), processing
time, pose coverage and per-joint confidence (overall and ±50 ms of contact), contact and
foot-strike alignment, all twelve mechanics (measured / experimental / not assessable),
evidence frames with the landmarks behind each number (plus annotated stills), the
experimental width proxies, the playback copy's alignment, a headless-browser seek check,
browser notes, and a manual review sheet to fill in. Standard output prints counts and
timings only.

## 3. App + worker, end to end

```bash
npm ci
ANALYZER_PYTHON=analyzer/.venv/bin/python bash scripts/swing-poc/run-e2e.sh
```

This starts the fixture Supabase on 127.0.0.1, a dev server with the POC flag on and a
throwaway data directory, and the worker; then drives Chromium through the whole flow and a
cross-team access attempt, then uploads the iPhone-style HEVC fixture and checks that
stepping to frame N shows frame N. Screenshots and `e2e-results.txt` land in
`analyzer/out/e2e/`. The worker runs with `SWING_POC_PROXY_CODEC=vp9` because open-source
Chromium decodes neither H.264 nor HEVC; production would use the default H.264 copy.

To click through it yourself, run the same three processes by hand:

```bash
node scripts/browser/fixture-supabase.mjs &      # or a non-production Supabase project
SWING_MECHANICS_POC=1 SWING_POC_DATA_DIR=$PWD/.swing-poc-data \
SWING_POC_SIGNING_SECRET=$(head -c 48 /dev/urandom | base64) \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key npx next dev -p 3100 &
(cd analyzer && .venv/bin/python -m swing_analyzer worker --data-dir ../.swing-poc-data) &   # SWING_POC_PROXY_CODEC=vp9 for Chromium
# then: /dashboard/roster/<playerId>/swing-poc?teamId=<teamId>
```

## 4. Environment variables (names only)

| Name | Where | Purpose |
|---|---|---|
| `SWING_MECHANICS_POC` | app (server) | `1` turns the POC on. Anything else: routes and page are 404. |
| `SWING_POC_DATA_DIR` | app + worker | Private capture directory (git-ignored, outside `public/`). |
| `SWING_POC_SIGNING_SECRET` | app (server) | 32+ chars; signs 5-minute video links. Refused if missing or short. |
| `SWING_POSE_MODEL` | worker | Path to the `.task` model (default `analyzer/models/pose_landmarker_full.task`). |
| `SWING_POC_PROXY_CODEC` | worker | Playback copy codec: `h264` (default) or `vp9`. |
| `ANALYZER_PYTHON` | e2e runner | The analyzer virtualenv's python. |

No API keys are used. No video or frame leaves the machine.

## 5. Tests

| Command | What it covers |
|---|---|
| `cd analyzer && python -m unittest discover -s tests` | 63 tests: probing, rotation, VFR, phone formats (iPhone HEVC 10-bit rotated with a start offset, Android rotated H.264, slow-mo original and exported), playback-copy alignment incl. a negative control, failure codes, real inference, known-movement measurements incl. negative move, foot strike + coach override, evidence landmarks, the 12-mechanic catalog (taxonomy slugs and pathway stages exist, doc in sync, no cut-offs), worker idempotency / timeout kill / stale recovery / purge, the validation command (privacy: owner-only files, input name never recorded, refuses tracked folders). Runs in CI (`analyzer` job) and fails if any test is skipped. |
| `npm run test:swing-poc` | app rules: flag, timeline sync, letterboxing, review rules, store (traversal, type/size/empty limits, signed links, slow-mo capture rate, playback copy only when aligned and only the worker's file names), routes behind flag + session, no writes to player tables, drill links from library rows, no video/model/frame file tracked by git |
| `bash scripts/swing-poc/run-e2e.sh` | 32 browser checks: upload → verified playback copy → contact → async analysis → overlay sync → evidence seek → review → drills → proposal-only plan → foot-strike correction + re-analysis → iPhone HEVC frame-exact stepping → 390 px → cross-team 404s → tampered token |

## 6. Retention and deletion (POC)

`DELETE /api/swing-poc/captures/<id>` (capability `decide`) removes the video, playback
copy, analysis, review and any queued job. `python -m swing_analyzer purge --data-dir D
--older-than-days N` deletes captures older than N days (run it on a schedule wherever a
worker runs). Validation runs live in `analyzer/out/private/` until you delete them.
