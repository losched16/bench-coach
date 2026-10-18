# Swing mechanics registry — the twelve WIN Reality mechanics

<!-- GENERATED from analyzer/swing_analyzer/catalog.py by `python -m swing_analyzer registry-doc`. Edit the Python, not this file; a test fails if they differ. -->

Names follow WIN Reality's list so coaches can compare like with like. Definitions, landmarks and assessments are BenchCoach's own; nothing here reproduces WIN Reality's numbers. Everything is assessed for **one side-on phone camera and a general pose model**.

- **Measurable now (unvalidated)** — an image-plane movement the analyzer measures today, with evidence frames and landmarks. Not validated until the real-swing comparison (validation.md).
- **Experimental** — a single-camera proxy exists but is ambiguous; not shown to coaches as a finding.
- **Not reliably measurable** — needs depth one camera does not give; always `not_assessable`.

Nothing is rated: no cut-offs, colours or best values. Drill links use existing problem-taxonomy slugs (drills come from `drill_problem_map`) and Build the Swing stage keys — no separate drill list.

## Summary

| Phase | Mechanic | Classification | Analyzer output |
|---|---|---|---|
| Balance & Load | Negative Move | Measurable now (unvalidated) | `negative_move` (pelvis_back_move, head_back_move) |
| Balance & Load | Pelvis Load | Experimental | — |
| Balance & Load | Upper Torso Load | Experimental | — |
| Stride | Stride Length | Measurable now (unvalidated) | `lead_foot_movement` (lead_foot_forward_displacement) |
| Stride | Hip Shoulder Separation at Foot Down | Not reliably measurable | `hip_shoulder_separation` — not assessable |
| Power Move | Max Hip Shoulder Separation | Not reliably measurable | — |
| Power Move | Forward Move | Measurable now (unvalidated) | `forward_move` (head_forward_stance_to_contact, pelvis_forward_stance_to_contact, head_forward_foot_strike_to_contact) |
| Power Move | Pelvis Total Rotation Range | Not reliably measurable | — |
| Contact & Follow-Through | Hip Shoulder Separation at Contact | Not reliably measurable | — |
| Contact & Follow-Through | Pelvis Direction at Contact | Experimental | — |
| Contact & Follow-Through | Upper Torso Direction at Contact | Experimental | — |
| Contact & Follow-Through | Upper Torso Total Rotation Range | Not reliably measurable | — |

## Balance & Load

### Negative Move

**Classification:** Measurable now (unvalidated)  
**Phase:** Stance end → foot strike  
**Best camera:** Side-on (face-on to the chest or back), level with the hips, static

**Definition.** The hitter's weight drifting back toward the catcher before the stride goes forward. Measured as the pelvis (hip midpoint) and head moving back along the line of the feet.

**Landmarks.** left/right hip, nose, left/right ankle (forward axis), shoulders + ankles (body length)

**Single-camera feasibility.** A translation across the picture — the thing one camera sees best. Reported in body lengths, with the stance jitter as a noise floor.

**Error sources.**

- Hip landmarks are estimated through clothing (baggy pants/jerseys)
- Head turning moves the nose landmark without the head translating
- Camera panning or zooming reads as body movement
- Camera not perpendicular shortens the movement

**Youth coaching.** Is weight getting into the back hip before going forward? Young hitters often skip the load and lunge, or lean back over the heel instead of loading the hip. A coach watches the evidence frames, not the number alone; some good hitters barely shift back.

**Drill taxonomy:** `lunging`, `flying-open`  
**Build the Swing stages:** `load`, `load-to-launch`  
**To make it measurable:** Validate against frame-by-frame coach marking on real swings (validation.md).

### Pelvis Load

**Classification:** Experimental  
**Phase:** Stance → foot strike  
**Best camera:** From above, or side-on + behind the catcher together

**Definition.** The pelvis turning away from the pitcher (closing) during the load.

**Landmarks.** left/right hip (2D and estimated 3D)

**Single-camera feasibility.** Proxy only: the change in apparent hip width (2D) relative to the stance. It shows THAT the pelvis turned, not which way or how far. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated.

**Error sources.**

- Width ratio is ambiguous in direction
- Hip landmarks under clothing
- Small turns are within landmark jitter

**Youth coaching.** Does the hitter coil the hips at all before striding? A coach can see a coil on video; the proxy may help flag clips to look at, never to rate.

**Drill taxonomy:** `flying-open`  
**Build the Swing stages:** `load`, `lower-half-sequencing`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

### Upper Torso Load

**Classification:** Experimental  
**Phase:** Stance → foot strike  
**Best camera:** From above, or side-on + behind the catcher together

**Definition.** The shoulders turning away from the pitcher during the load (the front shoulder coming in).

**Landmarks.** left/right shoulder (2D and estimated 3D)

**Single-camera feasibility.** Proxy only: change in apparent shoulder width (2D) relative to the stance. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated.

**Error sources.**

- Arms and bat occlude the shoulders
- Width ratio is ambiguous in direction
- Shoulder landmarks shift with shrugging

**Youth coaching.** Does the front shoulder stay closed while the weight goes back? A coach checks the load frames on video.

**Drill taxonomy:** `flying-open`  
**Build the Swing stages:** `load`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

## Stride

### Stride Length

**Classification:** Measurable now (unvalidated)  
**Phase:** Stance → foot strike  
**Best camera:** Side-on, level with the hips, whole body including feet in frame, static

**Definition.** How far the lead foot travels toward the pitcher from the stance to where it plants.

**Landmarks.** lead ankle, heel, foot index, back ankle (forward axis), shoulders + ankles (body length)

**Single-camera feasibility.** A translation across the picture. Reported in body lengths (image plane), not inches: there is no camera calibration.

**Error sources.**

- Stride angled toward/away from the camera is shortened
- Foot strike estimate can be a few frames off — the coach can move it
- Feet hidden by grass, a mat edge or the frame edge
- Not comparable across camera distances/angles without calibration

**Youth coaching.** Is the stride repeatable, and toward the pitcher rather than out toward the dugout? Young hitters often over-stride when trying to hit harder. Compare a hitter with themself across clips filmed the same way, not with a target.

**Drill taxonomy:** `stepping-in-bucket`, `lunging`  
**Build the Swing stages:** `load-to-launch`  
**To make it measurable:** Validate against coach-marked foot positions; calibrate with a known-length object for real units.

### Hip Shoulder Separation at Foot Down

**Classification:** Not reliably measurable  
**Phase:** Foot strike  
**Best camera:** Multi-camera (triangulated) or overhead

**Definition.** The angle between the shoulder line and the hip line, about the vertical, when the lead foot lands.

**Landmarks.** both hips and both shoulders, in 3D

**Single-camera feasibility.** Not reliable. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated. The analyzer measures how much its own 3D estimate scatters while the hitter is still, and that scatter is the reason.

**Error sources.**

- Depth ambiguity
- Learned 3D estimate
- Arm/bat occlusion of the shoulders

**Youth coaching.** Coaches look for the hips starting to open while the shoulders stay closed. Judge it by eye on the foot-strike frame; no number is offered.

**Drill taxonomy:** `flying-open`  
**Build the Swing stages:** `load-to-launch`, `lower-half-sequencing`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

## Power Move

### Max Hip Shoulder Separation

**Classification:** Not reliably measurable  
**Phase:** Foot strike → contact  
**Best camera:** Multi-camera (triangulated) or overhead

**Definition.** The largest shoulder-to-hip angle during the swing.

**Landmarks.** both hips and both shoulders, in 3D

**Single-camera feasibility.** Not reliable. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated. A maximum also picks the noisiest frame.

**Error sources.**

- Depth ambiguity
- Max of a noisy series is biased upward
- Motion blur at swing speed

**Youth coaching.** Same as separation at foot down: hips lead, shoulders follow. Judge by eye.

**Drill taxonomy:** `flying-open`  
**Build the Swing stages:** `lower-half-sequencing`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

### Forward Move

**Classification:** Measurable now (unvalidated)  
**Phase:** Stance → contact (and foot strike → contact)  
**Best camera:** Side-on, level with the hips, static

**Definition.** How far the head and pelvis travel toward the pitcher from the stance to contact.

**Landmarks.** nose, left/right hip, ankles (forward axis), shoulders + ankles (body length)

**Single-camera feasibility.** A translation across the picture. Reported in body lengths (image plane).

**Error sources.**

- Head turning moves the nose landmark
- Camera movement
- Contact frame is the coach's mark — a wrong mark moves the number

**Youth coaching.** Does the head stay fairly quiet while the body goes forward, or does the hitter lunge at the ball? Some forward move is normal; the right amount varies.

**Drill taxonomy:** `lunging`, `pulling-head`  
**Build the Swing stages:** `load-to-launch`, `lower-half-sequencing`  
**To make it measurable:** Validate against coach marking on real swings.

### Pelvis Total Rotation Range

**Classification:** Not reliably measurable  
**Phase:** Load → follow-through  
**Best camera:** Overhead or multi-camera

**Definition.** How far the pelvis turns from its most closed to its most open position.

**Landmarks.** both hips, in 3D, through the whole swing

**Single-camera feasibility.** Not reliable. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated. The range passes through edge-on (hips overlapping in the image), where 2D landmarks swap and 3D estimates jump.

**Error sources.**

- Depth ambiguity
- Left/right hip swaps when edge-on
- Follow-through often leaves the frame

**Youth coaching.** Do the hips actually turn through, or does the hitter swing with arms only? Visible on video at the finish.

**Drill taxonomy:** none — no existing problem matches; the coach chooses  
**Build the Swing stages:** `lower-half-sequencing`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

## Contact & Follow-Through

### Hip Shoulder Separation at Contact

**Classification:** Not reliably measurable  
**Phase:** Contact  
**Best camera:** Multi-camera (triangulated) or overhead

**Definition.** The shoulder-to-hip angle at contact.

**Landmarks.** both hips and both shoulders, in 3D

**Single-camera feasibility.** Not reliable. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated.

**Error sources.**

- Depth ambiguity
- Motion blur at contact
- Bat and arms occlude the shoulders

**Youth coaching.** Judge by eye on the contact frame.

**Drill taxonomy:** none — no existing problem matches; the coach chooses  
**Build the Swing stages:** `lower-half-sequencing`, `contact-point`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

### Pelvis Direction at Contact

**Classification:** Experimental  
**Phase:** Contact  
**Best camera:** Side-on + behind the catcher, or overhead

**Definition.** Which way the pelvis faces at contact (how open to the pitcher).

**Landmarks.** left/right hip (2D and estimated 3D)

**Single-camera feasibility.** Proxy only: apparent hip width at contact relative to the stance. From a side-on camera a pelvis facing the pitcher and one still closed can look alike. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated.

**Error sources.**

- Width ratio is ambiguous in direction
- Motion blur at contact
- Hip landmarks under clothing

**Youth coaching.** Are the hips open at contact rather than still closed (arms-only swing)? Visible on the contact frame; the proxy only flags clips to look at.

**Drill taxonomy:** none — no existing problem matches; the coach chooses  
**Build the Swing stages:** `lower-half-sequencing`, `contact-point`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

### Upper Torso Direction at Contact

**Classification:** Experimental  
**Phase:** Contact  
**Best camera:** Side-on + behind the catcher, or overhead

**Definition.** Which way the shoulders face at contact.

**Landmarks.** left/right shoulder (2D and estimated 3D)

**Single-camera feasibility.** Proxy only: apparent shoulder width at contact relative to the stance. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated.

**Error sources.**

- Arms and bat occlude the shoulders at contact
- Width ratio is ambiguous in direction
- Motion blur

**Youth coaching.** Have the shoulders flown open before contact (pulling off the ball)? Judge on the contact frame.

**Drill taxonomy:** `flying-open`, `pulling-head`  
**Build the Swing stages:** `contact-point`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.

### Upper Torso Total Rotation Range

**Classification:** Not reliably measurable  
**Phase:** Load → follow-through  
**Best camera:** Overhead or multi-camera

**Definition.** How far the shoulders turn from most closed to most open.

**Landmarks.** both shoulders, in 3D, through the whole swing

**Single-camera feasibility.** Not reliable. Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not triangulated. Shoulders pass edge-on and are occluded by the arms and bat for much of the swing.

**Error sources.**

- Depth ambiguity
- Occlusion by arms and bat
- Follow-through leaves the frame

**Youth coaching.** Does the hitter finish the turn, or stop short? Visible at the finish.

**Drill taxonomy:** none — no existing problem matches; the coach chooses  
**Build the Swing stages:** `lower-half-sequencing`  
**To make it measurable:** Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated landmarks, or a baseball-specific model validated against motion capture.
