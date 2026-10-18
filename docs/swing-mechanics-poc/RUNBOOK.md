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
# Test fixtures from MediaPipe's public test image (an adult, not a swing):
curl -fsSL -o /tmp/pose.jpg https://storage.googleapis.com/mediapipe-assets/pose.jpg
.venv/bin/python -m swing_analyzer fixtures /tmp/pose.jpg fixtures
.venv/bin/python -m unittest discover -s tests -v
```

Analyse one clip (contact time in ms from the first frame, as marked by the coach):

```bash
.venv/bin/python -m swing_analyzer analyze my_swing.mov --contact-ms 2140 \
  --handedness R --view face_on --out out/my_swing.json
.venv/bin/python -m swing_analyzer overlay out/my_swing.json my_swing.mov out/my_swing_overlay.mp4 --stills out/stills
```

`--foot-strike-ms` overrides the automatic foot-strike estimate.

## 2. App + worker, end to end

```bash
npm ci
ANALYZER_PYTHON=analyzer/.venv/bin/python VIDEO=analyzer/fixtures/moving.webm \
  bash scripts/swing-poc/run-e2e.sh
```

This starts the fixture Supabase on 127.0.0.1, a dev server with the POC flag on and a
throwaway data directory, and the worker; then drives Chromium through the whole flow and a
cross-team access attempt. Screenshots and `e2e-results.txt` land in `analyzer/out/e2e/`.
(The VP9 copy is used because open-source Chromium cannot decode H.264. Google Chrome and
Safari can.)

To click through it yourself, run the same three processes by hand:

```bash
node scripts/browser/fixture-supabase.mjs &      # or a non-production Supabase project
SWING_MECHANICS_POC=1 SWING_POC_DATA_DIR=$PWD/.swing-poc-data \
SWING_POC_SIGNING_SECRET=$(head -c 48 /dev/urandom | base64) \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key npx next dev -p 3100 &
(cd analyzer && .venv/bin/python -m swing_analyzer worker --data-dir ../.swing-poc-data) &
# then: /dashboard/roster/<playerId>/swing-poc?teamId=<teamId>
```

## 3. Environment variables (names only)

| Name | Where | Purpose |
|---|---|---|
| `SWING_MECHANICS_POC` | app (server) | `1` turns the POC on. Anything else: routes and page are 404. |
| `SWING_POC_DATA_DIR` | app + worker | Private capture directory (git-ignored, outside `public/`). |
| `SWING_POC_SIGNING_SECRET` | app (server) | 32+ chars; signs 5-minute video links. Refused if missing or short. |
| `SWING_POSE_MODEL` | worker | Path to the `.task` model (default `analyzer/models/pose_landmarker_full.task`). |
| `ANALYZER_PYTHON` | e2e runner | The analyzer virtualenv's python. |

No API keys are used. No video or frame leaves the machine.

## 4. Tests

| Command | What it covers |
|---|---|
| `cd analyzer && python -m unittest discover -s tests` | 38 tests: probing, rotation, VFR timestamps, failure codes, real inference on fixtures, known-movement measurement, foot strike, registry rules (`not_assessable`, no thresholds), worker queue/idempotency/failure |
| `npm run test:swing-poc` | app rules: flag, timeline sync, letterboxing, review rules, store (traversal, type/size/empty limits, signed links), routes behind flag + session, no writes to player tables, drill links from library rows |
| `bash scripts/swing-poc/run-e2e.sh` | 27 browser checks: upload → contact → async analysis → overlay sync → evidence seek → review → drills → proposal-only plan → foot-strike correction + re-analysis → 390 px → cross-team 404s → tampered token |

## 5. Retention and deletion (POC)

`DELETE /api/swing-poc/captures/<id>` (capability `decide`) removes the video, analysis,
review and any queued job. The POC has no automatic expiry; the production design below
adds one.
