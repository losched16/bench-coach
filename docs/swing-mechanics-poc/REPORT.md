# Swing mechanics POC — implementation report (2026-10-18)

Branch `claude/latest-code-updates-0vrxpr`, draft PR (not merged, not deployed). Feature is
unreachable unless the server sets `SWING_MECHANICS_POC=1`. No migration, no production data,
no production storage.

## Implemented vs proposed

| Area | Implemented and run | Proposed only |
|---|---|---|
| Audit + decision | `README.md`: PR #10, legacy swing flow, authz, measurements, retrieval | — |
| Pose analyzer | Python CLI + worker: ffprobe per-frame timestamps, rotation, VFR, MediaPipe Pose Landmarker (full) on every frame in a contact-anchored window, raw 2D + estimated 3D landmarks, visibility/presence, quality flags, versioned `swing-pose/1` JSON, actionable failure codes, overlay renderer | GPU, sports-specific model, bat/ball tracking |
| Mechanics | Registry with 3 entries; stride/lead-foot movement and head/pelvis forward move measured in body lengths (image plane) with evidence frames and data-quality gates; hip–shoulder separation = documented `not_assessable` verdict | thresholds, ratings (deliberately none) |
| Events | coach-marked contact (anchor, history kept); automatic foot strike (unvalidated) that the coach can override and re-analyse; load / swing start as coach tags | automatic load / swing start |
| App | flagged page under the player, upload/record, frame-accurate scrubber, contact marking, async analysis with polling/retry, synced 2D overlay, evidence seek, estimated-3D viewer (Three.js), coach review states, provenance panel | resumable upload, native high-fps capture |
| Drills | accepted findings → `retrieveDrills` with explicit taxonomy diagnosis (no model call) → library rows with stored video links; "add to plan" as a proposal that writes nothing | writing priorities/plans |
| AI interpretation | not built (documented design: structured evidence only) | yes |
| Storage | private local store, 5-min HMAC links + session re-authorization, range streaming, delete | Supabase private bucket + tables (`proposed-schema.sql`) |

## Evidence

Fixtures are synthetic, made from MediaPipe's public test image of an adult. **No real swing
has been analysed.** See `validation.md` for the numbers; highlights:

- Known slide measured 0.258 vs 0.257 expected; VFR timestamps exact; rotation handled.
- CPU, 4 cores: 41 ms/frame (full model); 480 frames of 1080p/240 fps in 27 s.
- Browser: the drawn pose's timestamp equals the displayed frame's (1667.0 ms at frame 51);
  evidence button seeks to 1.202 s for a 1.200 s frame.
- Heavy model placed foot strike 150 ms early on the 240 fps clip, changing the stride value —
  the reason foot strike is coach-adjustable.

Artifacts (generated locally, git-ignored): `analyzer/out/e2e/*.png`, `analyzer/out/moving_overlay.mp4`,
`analyzer/out/stills/*.png`, `analyzer/out/e2e/e2e-results.txt`.

## Tests (all run 2026-10-18)

| Command | Result |
|---|---|
| analyzer `python -m unittest discover -s tests` | 38 passed |
| `npm run test:swing-poc` | all pass |
| `bash scripts/swing-poc/run-e2e.sh` | 27/27 |
| `npm run gate` | 8/8 |
| existing CI suites | all pass (unchanged) |
| `npm run test:browser` | 236/236 on rerun; first run had 2 failures on untouched pages (CoachAI and Scouting guide links) that did not reproduce |

## Known gaps and risks

- Not validated on any real youth swing; detection rates, blur near contact and repeatability unknown.
- Image-plane values are camera-dependent; not comparable across setups.
- Open-source Chromium (the test browser) cannot play H.264, so the browser test used a VP9 copy; H.264/HEVC playback needs a manual check in Chrome and Safari.
- The legacy `swing-videos` flow links videos publicly — check that bucket's setting.
- Python tests are not in CI yet (they need FFmpeg, MediaPipe and the model download).

## Readiness (implementation phases only — not player mechanics)

| Phase | Status |
|---|---|
| 0 Audit + decision | 🟢 done |
| 1 Video → pose | 🟢 works on fixtures; 🟡 unproven on real swings |
| 2 Mechanics registry | 🟡 two observations implemented, unvalidated; hip–shoulder not feasible |
| 3 Review UI | 🟢 works end to end locally |
| 4 Drills + plan proposal | 🟢 vetted drills only, proposal only; AI layer 🔴 not built |
| 5 Validation | 🔴 needs real swing video |
| Production readiness | 🔴 storage, schema, worker hosting, consent all still to do |
