# Swing mechanics POC — implementation report (2026-10-18)

Branch `claude/latest-code-updates-0vrxpr`, draft PR (not merged, not deployed). Feature is
unreachable unless the server sets `SWING_MECHANICS_POC=1`. No migration, no production data,
no production storage.

## Implemented vs proposed

| Area | Implemented and run | Proposed only |
|---|---|---|
| Audit + decision | `README.md`: PR #10, legacy swing flow, authz, measurements, retrieval | — |
| Pose analyzer | Python CLI + worker: ffprobe per-frame timestamps, rotation, VFR, MediaPipe Pose Landmarker (full) on every frame in a contact-anchored window, raw 2D + estimated 3D landmarks, visibility/presence, quality flags, versioned `swing-pose/1` JSON, actionable failure codes, overlay renderer | GPU, sports-specific model, bat/ball tracking |
| Mechanics | Analyzer registry with 4 entries: negative move, stride/lead-foot movement and head/pelvis forward move measured in body lengths (image plane) with evidence frames, the landmarks behind each, and data-quality gates; hip–shoulder separation = documented `not_assessable` verdict. The twelve WIN Reality mechanics catalogued and classified (`mechanics-registry.md`, generated and sync-tested): 3 measurable now (unvalidated), 4 experimental, 5 not reliably measurable; mapped to existing taxonomy slugs and Build the Swing stages | thresholds, ratings (deliberately none) |
| Phone formats | iPhone HEVC 10-bit rotated .mov with a start offset, Android rotated H.264, slow-mo originals (VFR) and exported slow-mo (coach gives the recorded fps); a browser playback copy per upload whose frame count, timestamps and pixels are checked against the original before it is served | — |
| Real-swing validation | `validate` command → private report (properties, timing, coverage, landmark confidence, contact/foot-strike alignment, 12 mechanics, evidence stills, not-assessable list, playback + headless-browser seek check, manual review sheet); `contact-sheet` helper | — |
| Events | coach-marked contact (anchor, history kept); automatic foot strike (settled-position rule, unvalidated) that the coach can override and re-analyse; load / swing start as coach tags | automatic load / swing start |
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
| analyzer `python -m unittest discover -s tests` | 63 passed, 0 skipped |
| `npm run test:swing-poc` | all pass |
| `bash scripts/swing-poc/run-e2e.sh` | 32/32 |
| `npm run gate` | 8/8 |
| existing CI suites | 12/12 pass |
| `npm run test:browser` | 236/236 |
| `validate` dry run on the iPhone HEVC fixture | report complete; copy aligned 11/11; headless seek check 9/9; 60 s total on CPU |

CI: the analyzer tests now run in the `analyzer` job (FFmpeg + MediaPipe + checksum-verified
model and test image) and fail if any test is skipped.

## Known gaps and risks

- Not validated on any real youth swing; detection rates, blur near contact and repeatability unknown.
- Image-plane values are camera-dependent; not comparable across setups.
- Open-source Chromium (the test browser) plays neither H.264 nor HEVC, so browser tests use a VP9 copy; the H.264 copy and HEVC originals need a manual check in Safari (iPhone) and Chrome (Android).
- The automatic foot strike was 325 ms late on the 240 fps HEVC fixture: foot strike must be coach-confirmed until real swings show otherwise.
- HDR (iPhone default) footage is decoded without tone mapping; its effect on pose detection is unknown until a real clip is run.
- Legacy swing video storage needs owner verification and lock-down (security-audit.md; details sent privately).

## Readiness (implementation phases only — not player mechanics)

| Phase | Status |
|---|---|
| 0 Audit + decision | 🟢 done |
| 1 Video → pose | 🟢 works on fixtures; 🟡 unproven on real swings |
| 2 Mechanics registry | 🟡 3 of 12 mechanics measured (unvalidated), 4 experimental, 5 not feasible with one camera |
| 3 Review UI | 🟢 works end to end locally |
| 4 Drills + plan proposal | 🟢 vetted drills only, proposal only; AI layer 🔴 not built |
| 5 Validation | 🔴 needs real swing video |
| Production readiness | 🔴 storage, schema, worker hosting, consent all still to do |
