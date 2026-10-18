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

**The heavy-model result matters.** The stride number depends on where foot strike is placed,
and the automatic estimate can be wrong. That is why the coach can move foot strike, and
re-analysis then measures to the coach's mark (tested). Treat every automatic event as a
suggestion.

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
