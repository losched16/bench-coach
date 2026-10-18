# Swing mechanics POC — what is proven, what is not, and how to validate

## Proven on fixtures (2026-10-18)

The fixtures are built from MediaPipe's public test image of an adult in a wide, side-on
stance, slid across the frame by a known amount. **They are not swings.** They prove the
plumbing against ground truth we control:

| Check | Result |
|---|---|
| Real pose inference on every frame of the window | 60/60 frames (30 fps), 480/480 (1080p 240 fps) |
| Known 48 px slide, measured as lead-foot movement | 0.258 measured vs 0.257 expected (× stance shoulder-to-ankle length) |
| Same, head forward move | 0.259 vs 0.257 |
| Variable frame rate (16.7 / 50 ms alternating gaps) | per-frame time error 0.000 ms; contact matched by time |
| Portrait clip stored landscape + 90° rotation flag | landmarks within 0.02 of the unrotated clip |
| Automatic foot strike (full model, 30 fps) | 1 frame after the true end of movement |
| Automatic foot strike (heavy model, 240 fps upscale) | **150 ms early** — the stride value then reads 0.171 instead of 0.257 |
| No person / partial body / two people / corrupt file | failed `no_person` / all `not_assessable` / flagged / `unsupported_format` |
| Overlay sync in the browser | drawn pose timestamp = displayed frame timestamp (1667.0 ms at frame 51) |
| Negative move: known 16 px slide back, then 48 px forward | pelvis 0.089 vs 0.085 expected; head 0.081; "furthest back" frame inside the held-back span; stride still 0.247 vs 0.256 from the stance |
| Phone formats (iPhone HEVC Main10 `hvc1` .mov, 90° rotation, AAC, 240 fps, first frame at 0.022 s; Android H.264 rotated −90°, 60 fps; slow-mo VFR original 30→240 fps; exported slow-mo re-timed to 30 fps) | stride 0.254–0.264 vs 0.257 across all four (export only with `--capture-fps 240`); contact frame = truth in each |
| Exported slow-mo WITHOUT the capture rate | analysis window and timing are 8× off; the analyzer warns, the validation command refuses to run without an explicit answer |
| Browser playback copy (H.264 / VP9), every phone format | same frame count, timestamps within ≤0.5 ms, every sampled frame matches its own source frame (on clips with enough motion to tell neighbours apart); a copy shifted by one frame is caught (9/9 mismatches) |
| Headless Chromium, iPhone HEVC clip, stepping with the UI's seek rule | frame N shows frame N at 10/10 checked frames incl. first, last and contact |
| Automatic foot strike on the iPhone 240 fps HEVC clip (settled-position rule) | **325 ms late** (frame 359 vs 281) — coach must confirm foot strike |

**The heavy-model result matters.** The stride number depends on where foot strike is placed,
and the automatic estimate can be wrong. That is why the coach can move foot strike, and
re-analysis then measures to the coach's mark (tested). Treat every automatic event as a
suggestion.

## Tomorrow's first real swing

Run `bash scripts/swing-poc/validate-real-swing.sh` (RUNBOOK §2) and fill in the manual
review sheet in the report. What the first clip can and cannot tell us:

- **Can:** whether the phone's format, rotation, frame rate and HDR survive the pipeline;
  whether the model finds the hitter in every frame and sees hands and lead foot around
  contact; whether contact and foot strike line up with what a coach sees; whether the
  playback copy and the browser show the analyzer's frames; whether each measured value
  is plausible against the evidence frames; how far the automatic foot strike is from a
  coach's mark.
- **Cannot:** validate any mechanic. One swing gives no repeatability and no reference.
  Record agreement/disagreement; do not tune anything to a single clip.

## Not yet validated — needs real swings

Nothing about youth swing mechanics has been tested, because no real swing video was
available in this environment. Before any number is shown to coaches outside this team:

1. **Detection on youth swings.** About 30 clips, ages 6–12, tee / front toss / live, both
   handednesses, phone 30/60/240 fps, indoor and outdoor. Measure the pose-found rate, joint
   visibility around contact (hands and lead foot blur first), and how often each
   observation comes back `not_assessable`.
2. **Repeatability.** Same hitter, same setup, 5 swings: the spread of each value, and the
   same clip analysed twice (the pipeline should be bit-identical; check it).
3. **Against a reference.** Mark lead-foot position and head position by hand on the evidence
   frames (two coaches, blind to the output), and compare. A dual-camera or motion-capture
   session is needed before any rotational quantity.
4. **Camera sensitivity.** The same swing filmed at 10, 15 and 20 ft and from 15° off
   perpendicular, to measure how much the image-plane values move.

### Before any colour, rating or threshold

Who decides: a named panel of experienced youth hitting coaches, per age band, from
repeatability-tested data, with the camera protocol fixed. Each threshold is published with
its evidence and its error bar. None exists today, and the code refuses to emit one.

## Hip–shoulder separation — feasibility verdict

**Not assessable with one phone camera and MediaPipe.** The rotation happens mostly toward and
away from the lens, the depth axis a monocular model estimates worst. MediaPipe's "world"
landmarks are learned estimates, not triangulated. On a still image the estimated proxy is
steady (0.06–0.1°), which only shows it is deterministic, not that it is right. Credible
routes:

- two synchronised phones (face-on and down-the-line) with triangulated landmarks;
- a baseball-specific pose model validated against motion capture;
- a sports-specific 3D model with published joint-angle error for rotational sports.
