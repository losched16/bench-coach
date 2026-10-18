# Swing mechanics POC — audit and decision record

Status: **internal proof of concept**. Off by default (`SWING_MECHANICS_POC=1` to enable),
not deployed, no production migration, no player data written.

## What already exists (audited 2026-10-17 against `main` @ 65772a0)

| Piece | Where | Verdict |
|---|---|---|
| PR #10 "Swing Metrics MVP" | branch `feature/swing-metrics-mvp`, draft, **conflicts with main** | Do not merge. Its migration is numbered **077**, which `main` already used for `077_practice_plan_pathway_link.sql` (applied in production). It models *performance* readings (exit velocity, launch angle, projected distance) that a pose model cannot produce. Reused as a **pattern**: path-scoped signed upload, private object paths `…/<team>/<player>/<uuid>.<ext>`, server-side authorization before any storage work, and "nothing reaches `player_metrics` without a coach confirming it". |
| Legacy swing analysis | `app/api/swing-analysis`, `components/SwingAnalysis{Upload,View}.tsx`, `swing_analyses` (000 baseline), external `SWING_ANALYZER_URL` | Not reused. The upload component is not mounted anywhere. It authorizes by `players.coach_id` only (assistants and team scope are not handled), and it links the video with `getPublicUrl` on a `swing-videos` bucket. **That only works if the bucket is public — a child-video exposure risk to check in the Supabase dashboard before anything is built on it.** It could not be verified from this session. |
| Authorization | `lib/authz.ts` (`authorizePlayer`, `authorizeTeam`, capabilities) and `lib/playerScope.ts` | **Reused unchanged.** Every POC route resolves the capture's stored team and player, not ids from the request. |
| Measurements | `player_metrics`, `metric_types`, `/api/metrics` | **Not written to.** POC findings are review data only. |
| Drill retrieval | `lib/drillRetrieval.ts → retrieveDrills` | **Reused**, called with an explicit diagnosis (taxonomy slugs from the registry), so no model call is made and only schedulable library drills come back. |
| Background jobs | none in the app (Vercel functions only; one weekly cron) | New: an out-of-process Python worker. Nothing long-running inside a request. |

## Decision

A **new isolated vertical slice off `main`**, not PR #10:

1. **Analyzer (Python, CPU):** FFmpeg/ffprobe for decoding and per-frame presentation
   timestamps, **MediaPipe Pose Landmarker** (full model, `VIDEO` mode) for 33 landmarks
   per frame (normalized image coordinates + model-estimated metric "world" coordinates),
   OpenCV for frame quality. Versioned JSON output (`swing-pose/1`). Runs as a CLI and as a
   polling worker. Chosen over in-browser inference because a phone browser cannot be relied
   on to decode a 240 fps file and run the model on every frame, and because it keeps model
   versions deterministic for re-analysis. Chosen over a hosted vision API because child
   imagery must not leave our infrastructure without explicit authorization.
2. **Mechanics registry (Python, shared to the UI through the output):** each metric declares
   its definition, required landmarks and camera view, event window, method, unit, quality
   rules, evidence frames, limitations and validation status. Anything that cannot be
   measured returns `not_assessable` with a reason. **No thresholds, ratings, scores or
   "ideal swing".**
3. **App (Next.js, behind a server-side flag):** private local capture store with short-lived
   HMAC-signed video URLs, file-queue job handoff, contact-frame scrubber, 2D overlay synced
   to the video by frame timestamps, an estimated-3D viewer, coach review states, and drill
   candidates from `retrieveDrills`. "Add to plan" is shown as a proposal and writes nothing.

### Local-only storage, on purpose

The POC stores captures under `SWING_POC_DATA_DIR` (outside `public/`, git-ignored) rather
than a Supabase bucket, so running it cannot touch production storage. The production shape
is in `docs/swing-mechanics-poc/proposed-schema.sql`, which is deliberately **not** in
`migrations/`.

## In / out of this POC

**In:** real pose inference on real video frames; VFR-safe timestamps; rotation; quality and
failure flags; contact anchor; three candidate observations (stride / lead-foot movement,
head and pelvis forward move, hip–shoulder separation feasibility); synced 2D overlay;
estimated-3D viewer labelled as such; coach review; vetted drill candidates; tests; runbook.

**Out:** bat or ball tracking; real-world units (no calibration); any rating; any write to
`player_metrics`, prescriptions or development plans; parent-facing output; the AI
interpretation layer (structured-evidence design is documented, not built); production
storage, migration or deploy; a 12-dimension product.

## Risk and rollback

The feature is unreachable unless `SWING_MECHANICS_POC=1` is set on the server: routes
return 404 and the page renders a 404. Nothing is migrated, so rollback is deleting the
branch and the local data directory.

## Technical decisions

**Browser vs worker inference.** Browser-side MediaPipe (WASM/WebGL) would keep video on the
phone, but a mid-range phone browser cannot reliably decode a 240 fps HEVC file frame by
frame and run the model on ~800 frames in reasonable time, results would vary by device, and
re-analysis with a newer model would be impossible. The worker gives one model version per
result and deterministic re-runs. Measured on 4 CPU cores: **41 ms/frame (full model)**, so
480 frames of 1080p at 240 fps took **27 s measured** including decode (a full 3.25 s window,
~780 frames, extrapolates to ~40 s);
the heavy model is ~2× slower and was no better on the fixtures. No GPU is needed yet.
Hosting: a small always-on container (2–4 vCPU) or a queue-triggered job (Cloud Run / Fly
Machines); Vercel functions are the wrong place (no FFmpeg, time limits).

**Queue, retries, idempotency.** The POC uses a directory queue with atomic claim
(rename), a child process per job with a 600 s timeout, stale-claim recovery and 3 attempts.
Results carry an input hash (video + request + analyzer + model); a matching re-run is
skipped. Production: the job table in `proposed-schema.sql`, claimed with
`SELECT … FOR UPDATE SKIP LOCKED`.

**Coordinates and sync.** Landmarks are normalised to the **displayed** frame (ffmpeg applies
the file's rotation, as the browser does). Every analysed frame keeps its presentation time
from ffprobe; the UI draws the latest analysed frame at or before the playhead, read from
`requestVideoFrameCallback` where available, and draws nothing for frames the analysis
skipped. There is no mirroring: lead and back come from handedness plus MediaPipe's
anatomical left/right, and "toward the pitcher" is the stance direction from back ankle to
lead ankle, so the camera side does not matter. World landmarks (y down, metres around the
hips) are an estimate and only drive the labelled 3D view.

**Smoothing.** Only isolated single-frame spikes are removed, on measurement tracks; stored and
drawn landmarks are raw; gaps are never filled.

**Better models later.** If stride and forward move hold up on real swings, the next steps are
bat tracking (a small detector on the barrel and hands), two-phone synchronised capture for
rotation, and evaluating sports-specific pose models. Each is a new backend behind the same
`PoseBackend` / `swing-pose/1` contract.

## Privacy and children's video

- Video is private: stored outside the web root, served only through an authorized route that
  re-checks team access **and** a 5-minute HMAC link bound to the user and capture. Cross-team
  access returns 404 (tested).
- Upload limits enforced on bytes received (200 MB), video types only, empty or interrupted
  uploads refused and cleaned up.
- Logs carry error codes and messages only, never frames, landmarks or file contents.
- No child imagery goes to any outside service. The optional AI interpretation layer is
  **not built**; if added, it would receive only the structured observations (numbers, units,
  coach-accepted wording), never video or frames.
- Deletion removes video, analysis, review and queued work. The production schema adds a
  default 180-day expiry.
- **Before any public release:** parental notice and consent for recording minors
  (COPPA applies to under-13s for an online service collecting their images), a retention
  policy, a deletion path for parents via the coach, and a review of the legacy
  `swing-videos` bucket, which the old flow links publicly.
