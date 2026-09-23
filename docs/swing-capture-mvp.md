# BenchCoach Phone Swing Capture — MVP

Status: **private beta foundation**

This feature turns a short high-frame-rate phone video into reviewable hitting measurements without creating a second player-development data system.

## Product loop

1. Coach opens a player's **Measurements** tab.
2. Coach records a short slow-motion tee swing from a fixed side-on phone.
3. Coach enters the recording frame rate and the perpendicular lens-to-ball distance at contact.
4. BenchCoach stores the private source video and its capture metadata.
5. A swing analyzer proposes:
   - exit velocity (mph)
   - launch angle (degrees)
   - projected hit distance (ft)
   - confidence
6. The coach reviews or edits the proposal.
7. Only after explicit confirmation does BenchCoach write objective readings into `player_metrics`.
8. The existing Measurements trend system, player-development loop, reports and future AI context can consume the confirmed readings.

The analyzer assists. It does not silently publish a measurement about a child.

## Why this reuses `player_metrics`

BenchCoach already has the correct long-term model for objective development evidence:

- multiple readings can belong to one dated session;
- best and average are both preserved;
- trend direction is explicit;
- fewer than three sessions is not treated as a trend;
- the measurement system is already available to player-development reasoning.

A phone-captured 53.4 mph exit velocity is still an exit-velocity reading. The new `swing_captures` table exists for the things a scalar measurement cannot explain: source video, camera setup, analyzer version, confidence, review state and audit provenance.

## Metrics

### Exit velocity

Canonical system metric: `exit_velo` (`mph`, higher is better).

A confirmed phone result becomes one normal `player_metrics` row linked back to its source capture with `source_capture_id`.

### Projected hit distance

New system metric: `projected_hit_distance` (`ft`, higher is better).

This is deliberately called **projected distance** everywhere. It is an estimate from launch conditions, not a claim that the ball physically landed at that distance.

### Launch angle

Launch angle is stored on `swing_captures`, but it is **not** currently a `metric_types` trend.

The existing metric model requires `higher` or `lower` to mean improvement. Neither is generally true for launch angle: a better angle depends on the hitter, batted-ball goal and context. Adding it to that trend engine today would encode a false coaching rule.

If BenchCoach later adds target ranges / optimal zones to the metric model, launch angle can become a first-class longitudinal metric honestly.

## Capture setup

Initial beta is designed around **tee work** because the stationary ball gives the tracker a cleaner contact/calibration problem.

Recommended setup:

- phone on a tripod;
- camera side-on and approximately perpendicular to the ball at contact;
- 240 fps when available, otherwise 120 fps;
- bright lighting;
- contact point and early ball flight fully visible;
- short 2–3 second clip centered around contact;
- measure lens-to-ball distance at contact and enter it in feet.

### Why camera distance is required

Frame rate tells us how much **time** elapsed. Pixel displacement tells us how far the ball moved **in the image**. Neither tells us real-world feet by itself.

The analyzer therefore receives `cameraDistanceFt` along with video dimensions and FPS. The stationary tee ball and camera geometry can then be used to establish scale. We do not convert pixels/frame directly into mph without calibration.

## Upload architecture

The first private-beta web flow uses the existing private `journal-media` Supabase bucket and limits clips to 45 MB.

That is intentionally temporary. High-frame-rate mobile video should use resumable uploads in production, especially on cellular connections. The native/mobile upload slice should move to Supabase TUS/resumable transfer rather than relying on a single standard upload request.

Videos remain private. The browser and analyzer receive short-lived signed URLs only after BenchCoach authorization succeeds.

## Analyzer boundary

BenchCoach calls an external service through:

- `SWING_ANALYSIS_URL`
- optional `SWING_ANALYSIS_API_KEY`
- endpoint: `POST /v1/analyze-swing`

Request contract lives in `lib/swingCapture.ts` and includes:

```text
schemaVersion
captureId
videoUrl
captureFps
frameWidth
frameHeight
durationMs
cameraDistanceFt
```

Expected response:

```text
schemaVersion
exitVelocityMph
launchAngleDeg
projectedDistanceFt
confidence
provider
modelVersion
diagnostics?
```

The route validates bounds before storing a proposed result.

No analyzer result writes directly to `player_metrics`. It first enters `review` state.

## Computer-vision implementation sequence

Do not begin with a giant end-to-end AI model. The first analyzer should make each failure legible.

1. Decode the high-FPS source at its true frame timing.
2. Identify the stationary tee ball before contact.
3. Detect contact / first departure frame.
4. Track ball candidates across consecutive frames using temporal motion, not single-frame appearance alone.
5. Reject implausible trajectories using continuity, acceleration and direction gates.
6. Calibrate image motion into real-world motion using camera setup + stationary-ball geometry.
7. Fit the initial post-contact trajectory.
8. Calculate exit velocity and launch angle.
9. Calculate projected distance using an explicitly versioned flight model.
10. Return diagnostics and confidence so BenchCoach can explain *why* a swing could not be measured.

Important: a failed measurement is better than a confident-looking wrong measurement.

## Accuracy gate before public claims

BenchCoach should not market this as radar-equivalent until it has a reference-device validation set.

### Reference data

Record the same swings simultaneously with:

- BenchCoach phone capture; and
- a trusted reference such as Pocket Radar, HitTrax, Rapsodo or TrackMan where available.

Store the reference reading separately from the model output so calibration never overwrites ground truth.

### Report at minimum

For exit velocity:

- sample size;
- mean absolute error (MAE);
- root mean square error (RMSE);
- signed bias;
- percentage within ±1, ±2, ±3 and ±5 mph;
- analysis-success rate (do not hide failed swings).

For launch angle / projected distance:

- same error metrics in degrees / feet;
- clearly separate projected-distance error from actual observed landing-distance error.

Stratify by:

- 120 vs 240 fps;
- indoor cage vs outdoor field;
- bright vs difficult lighting;
- camera distance;
- exit-velocity bands;
- phone model when the sample supports it.

### Initial product gate

Until the validation set supports a tighter standard, automated results stay **beta estimates** and require coach confirmation.

A future release gate should be numeric (for example, an agreed EV MAE plus minimum successful-analysis rate), based on actual validation data rather than a target invented in advance.

## Native iOS / Android direction

The data/API contract intentionally does not depend on the web uploader.

### iOS

Use AVFoundation high-frame-rate formats where the device supports them. Native capture can preserve exact frame timing and camera metadata more reliably than camera-roll upload.

### Android

Use Camera2 constrained high-speed capture on devices advertising the appropriate high-speed capability. Device support will vary more than iOS, so capability detection must be explicit.

Both native clients should write the same capture record and pass the same analyzer contract. BenchCoach remains the system of record for player history.

## Feature flag

The UI is hidden unless:

```text
NEXT_PUBLIC_SWING_CAPTURE_BETA=true
```

Automated analysis additionally requires `SWING_ANALYSIS_URL`.

This allows the database/API foundation and manual calibration flow to ship without pretending the computer-vision analyzer is ready before it is validated.
