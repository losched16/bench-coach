"""The twelve hitting mechanics WIN Reality reports, and what BenchCoach can do with each.

WIN Reality groups twelve swing mechanics into four phases. This catalog uses
those NAMES so a coach can compare like with like. The definitions, landmarks
and assessments are BenchCoach's own working versions, not WIN Reality's, and
nothing here claims to reproduce WIN Reality's numbers.

Each mechanic is classified for ONE side-on phone camera and a general pose
model (MediaPipe):

  measurable_now           an image-plane movement the analyzer measures today,
                           with evidence frames — still UNVALIDATED until the
                           real-swing comparison in validation.md is done;
  experimental             a single-camera proxy exists but is ambiguous or
                           unverified; it is not shown to coaches as a finding;
  not_reliably_measurable  needs depth one camera does not give; reported as
                           not assessable, never as a number.

Nothing is rated: no cut-offs, colours or "best" values. The youth notes
say what a coach might look for and why, not what number is good.

Drill and plan mapping uses what BenchCoach already has — problem taxonomy
slugs (docs/audits/problem-taxonomy-production.json, which drills are mapped
to via drill_problem_map) and the Build the Swing pathway's stage keys
(scripts/fixtures/development-pathways.ts). No drill list lives here.

The Markdown in docs/swing-mechanics-poc/mechanics-registry.md is GENERATED
from this file (`python -m swing_analyzer registry-doc`); a test keeps them in
sync.
"""

from __future__ import annotations

from typing import Dict, List

CLASSES = ("measurable_now", "experimental", "not_reliably_measurable")
CLASS_LABEL = {
    "measurable_now": "Measurable now (unvalidated)",
    "experimental": "Experimental",
    "not_reliably_measurable": "Not reliably measurable",
}
GROUPS = ("Balance & Load", "Stride", "Power Move", "Contact & Follow-Through")

_DEPTH = ("Axial rotation (turning about the spine) moves the hips and shoulders mostly toward or away "
          "from a side-on camera — the depth axis one camera measures worst. A 2D width ratio cannot "
          "tell 30° open from 30° closed, and MediaPipe's 3D landmarks are learned estimates, not "
          "triangulated.")
_TWO_CAMS = ("Two synchronised, calibrated cameras (side-on + from behind or above) with triangulated "
             "landmarks, or a baseball-specific model validated against motion capture.")

MECHANICS: List[Dict] = [
    # ── Balance & Load ──────────────────────────────────────────────────────
    {
        "id": "negative_move", "name": "Negative Move", "group": "Balance & Load",
        "classification": "measurable_now",
        "phase": "Stance end → foot strike",
        "definition": "The hitter's weight drifting back toward the catcher before the stride goes forward. "
                      "Measured as the pelvis (hip midpoint) and head moving back along the line of the feet.",
        "required_landmarks": ["left/right hip", "nose", "left/right ankle (forward axis)", "shoulders + ankles (body length)"],
        "best_camera": "Side-on (face-on to the chest or back), level with the hips, static",
        "single_camera_feasibility": "A translation across the picture — the thing one camera sees best. "
                                     "Reported in body lengths, with the stance jitter as a noise floor.",
        "error_sources": ["Hip landmarks are estimated through clothing (baggy pants/jerseys)",
                          "Head turning moves the nose landmark without the head translating",
                          "Camera panning or zooming reads as body movement",
                          "Camera not perpendicular shortens the movement"],
        "youth_interpretation": "Is weight getting into the back hip before going forward? Young hitters often skip "
                                "the load and lunge, or lean back over the heel instead of loading the hip. A coach "
                                "watches the evidence frames, not the number alone; some good hitters barely shift back.",
        "drill_taxonomy": ["lunging", "flying-open"],
        "pathway_stages": ["load", "load-to-launch"],
        "implemented_as": {"observation": "negative_move", "values": ["pelvis_back_move", "head_back_move"]},
        "path_to_measurable": "Validate against frame-by-frame coach marking on real swings (validation.md).",
    },
    {
        "id": "pelvis_load", "name": "Pelvis Load", "group": "Balance & Load",
        "classification": "experimental",
        "phase": "Stance → foot strike",
        "definition": "The pelvis turning away from the pitcher (closing) during the load.",
        "required_landmarks": ["left/right hip (2D and estimated 3D)"],
        "best_camera": "From above, or side-on + behind the catcher together",
        "single_camera_feasibility": "Proxy only: the change in apparent hip width (2D) relative to the stance. "
                                     "It shows THAT the pelvis turned, not which way or how far. "
                                     + _DEPTH,
        "error_sources": ["Width ratio is ambiguous in direction", "Hip landmarks under clothing",
                          "Small turns are within landmark jitter"],
        "youth_interpretation": "Does the hitter coil the hips at all before striding? A coach can see a coil on "
                                "video; the proxy may help flag clips to look at, never to rate.",
        "drill_taxonomy": ["flying-open"],
        "pathway_stages": ["load", "lower-half-sequencing"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    {
        "id": "upper_torso_load", "name": "Upper Torso Load", "group": "Balance & Load",
        "classification": "experimental",
        "phase": "Stance → foot strike",
        "definition": "The shoulders turning away from the pitcher during the load (the front shoulder coming in).",
        "required_landmarks": ["left/right shoulder (2D and estimated 3D)"],
        "best_camera": "From above, or side-on + behind the catcher together",
        "single_camera_feasibility": "Proxy only: change in apparent shoulder width (2D) relative to the stance. "
                                     + _DEPTH,
        "error_sources": ["Arms and bat occlude the shoulders", "Width ratio is ambiguous in direction",
                          "Shoulder landmarks shift with shrugging"],
        "youth_interpretation": "Does the front shoulder stay closed while the weight goes back? A coach checks the "
                                "load frames on video.",
        "drill_taxonomy": ["flying-open"],
        "pathway_stages": ["load"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    # ── Stride ──────────────────────────────────────────────────────────────
    {
        "id": "stride_length", "name": "Stride Length", "group": "Stride",
        "classification": "measurable_now",
        "phase": "Stance → foot strike",
        "definition": "How far the lead foot travels toward the pitcher from the stance to where it plants.",
        "required_landmarks": ["lead ankle, heel, foot index", "back ankle (forward axis)", "shoulders + ankles (body length)"],
        "best_camera": "Side-on, level with the hips, whole body including feet in frame, static",
        "single_camera_feasibility": "A translation across the picture. Reported in body lengths (image plane), "
                                     "not inches: there is no camera calibration.",
        "error_sources": ["Stride angled toward/away from the camera is shortened",
                          "Foot strike estimate can be a few frames off — the coach can move it",
                          "Feet hidden by grass, a mat edge or the frame edge",
                          "Not comparable across camera distances/angles without calibration"],
        "youth_interpretation": "Is the stride repeatable, and toward the pitcher rather than out toward the dugout? "
                                "Young hitters often over-stride when trying to hit harder. Compare a hitter with "
                                "themself across clips filmed the same way, not with a target.",
        "drill_taxonomy": ["stepping-in-bucket", "lunging"],
        "pathway_stages": ["load-to-launch"],
        "implemented_as": {"observation": "lead_foot_movement", "values": ["lead_foot_forward_displacement"]},
        "path_to_measurable": "Validate against coach-marked foot positions; calibrate with a known-length object for real units.",
    },
    {
        "id": "hip_shoulder_separation_foot_down", "name": "Hip Shoulder Separation at Foot Down", "group": "Stride",
        "classification": "not_reliably_measurable",
        "phase": "Foot strike",
        "definition": "The angle between the shoulder line and the hip line, about the vertical, when the lead foot lands.",
        "required_landmarks": ["both hips and both shoulders, in 3D"],
        "best_camera": "Multi-camera (triangulated) or overhead",
        "single_camera_feasibility": "Not reliable. " + _DEPTH + " The analyzer measures how much its own 3D "
                                     "estimate scatters while the hitter is still, and that scatter is the reason.",
        "error_sources": ["Depth ambiguity", "Learned 3D estimate", "Arm/bat occlusion of the shoulders"],
        "youth_interpretation": "Coaches look for the hips starting to open while the shoulders stay closed. "
                                "Judge it by eye on the foot-strike frame; no number is offered.",
        "drill_taxonomy": ["flying-open"],
        "pathway_stages": ["load-to-launch", "lower-half-sequencing"],
        "implemented_as": {"observation": "hip_shoulder_separation", "values": []},
        "path_to_measurable": _TWO_CAMS,
    },
    # ── Power Move ──────────────────────────────────────────────────────────
    {
        "id": "max_hip_shoulder_separation", "name": "Max Hip Shoulder Separation", "group": "Power Move",
        "classification": "not_reliably_measurable",
        "phase": "Foot strike → contact",
        "definition": "The largest shoulder-to-hip angle during the swing.",
        "required_landmarks": ["both hips and both shoulders, in 3D"],
        "best_camera": "Multi-camera (triangulated) or overhead",
        "single_camera_feasibility": "Not reliable. " + _DEPTH + " A maximum also picks the noisiest frame.",
        "error_sources": ["Depth ambiguity", "Max of a noisy series is biased upward", "Motion blur at swing speed"],
        "youth_interpretation": "Same as separation at foot down: hips lead, shoulders follow. Judge by eye.",
        "drill_taxonomy": ["flying-open"],
        "pathway_stages": ["lower-half-sequencing"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    {
        "id": "forward_move", "name": "Forward Move", "group": "Power Move",
        "classification": "measurable_now",
        "phase": "Stance → contact (and foot strike → contact)",
        "definition": "How far the head and pelvis travel toward the pitcher from the stance to contact.",
        "required_landmarks": ["nose", "left/right hip", "ankles (forward axis)", "shoulders + ankles (body length)"],
        "best_camera": "Side-on, level with the hips, static",
        "single_camera_feasibility": "A translation across the picture. Reported in body lengths (image plane).",
        "error_sources": ["Head turning moves the nose landmark", "Camera movement",
                          "Contact frame is the coach's mark — a wrong mark moves the number"],
        "youth_interpretation": "Does the head stay fairly quiet while the body goes forward, or does the hitter "
                                "lunge at the ball? Some forward move is normal; the right amount varies.",
        "drill_taxonomy": ["lunging", "pulling-head"],
        "pathway_stages": ["load-to-launch", "lower-half-sequencing"],
        "implemented_as": {"observation": "forward_move",
                           "values": ["head_forward_stance_to_contact", "pelvis_forward_stance_to_contact",
                                      "head_forward_foot_strike_to_contact"]},
        "path_to_measurable": "Validate against coach marking on real swings.",
    },
    {
        "id": "pelvis_total_rotation_range", "name": "Pelvis Total Rotation Range", "group": "Power Move",
        "classification": "not_reliably_measurable",
        "phase": "Load → follow-through",
        "definition": "How far the pelvis turns from its most closed to its most open position.",
        "required_landmarks": ["both hips, in 3D, through the whole swing"],
        "best_camera": "Overhead or multi-camera",
        "single_camera_feasibility": "Not reliable. " + _DEPTH + " The range passes through edge-on (hips "
                                     "overlapping in the image), where 2D landmarks swap and 3D estimates jump.",
        "error_sources": ["Depth ambiguity", "Left/right hip swaps when edge-on", "Follow-through often leaves the frame"],
        "youth_interpretation": "Do the hips actually turn through, or does the hitter swing with arms only? "
                                "Visible on video at the finish.",
        "drill_taxonomy": [],
        "pathway_stages": ["lower-half-sequencing"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    # ── Contact & Follow-Through ────────────────────────────────────────────
    {
        "id": "hip_shoulder_separation_contact", "name": "Hip Shoulder Separation at Contact",
        "group": "Contact & Follow-Through",
        "classification": "not_reliably_measurable",
        "phase": "Contact",
        "definition": "The shoulder-to-hip angle at contact.",
        "required_landmarks": ["both hips and both shoulders, in 3D"],
        "best_camera": "Multi-camera (triangulated) or overhead",
        "single_camera_feasibility": "Not reliable. " + _DEPTH,
        "error_sources": ["Depth ambiguity", "Motion blur at contact", "Bat and arms occlude the shoulders"],
        "youth_interpretation": "Judge by eye on the contact frame.",
        "drill_taxonomy": [],
        "pathway_stages": ["lower-half-sequencing", "contact-point"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    {
        "id": "pelvis_direction_contact", "name": "Pelvis Direction at Contact", "group": "Contact & Follow-Through",
        "classification": "experimental",
        "phase": "Contact",
        "definition": "Which way the pelvis faces at contact (how open to the pitcher).",
        "required_landmarks": ["left/right hip (2D and estimated 3D)"],
        "best_camera": "Side-on + behind the catcher, or overhead",
        "single_camera_feasibility": "Proxy only: apparent hip width at contact relative to the stance. From a side-on "
                                     "camera a pelvis facing the pitcher and one still closed can look alike. " + _DEPTH,
        "error_sources": ["Width ratio is ambiguous in direction", "Motion blur at contact", "Hip landmarks under clothing"],
        "youth_interpretation": "Are the hips open at contact rather than still closed (arms-only swing)? Visible on "
                                "the contact frame; the proxy only flags clips to look at.",
        "drill_taxonomy": [],
        "pathway_stages": ["lower-half-sequencing", "contact-point"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    {
        "id": "upper_torso_direction_contact", "name": "Upper Torso Direction at Contact", "group": "Contact & Follow-Through",
        "classification": "experimental",
        "phase": "Contact",
        "definition": "Which way the shoulders face at contact.",
        "required_landmarks": ["left/right shoulder (2D and estimated 3D)"],
        "best_camera": "Side-on + behind the catcher, or overhead",
        "single_camera_feasibility": "Proxy only: apparent shoulder width at contact relative to the stance. " + _DEPTH,
        "error_sources": ["Arms and bat occlude the shoulders at contact", "Width ratio is ambiguous in direction",
                          "Motion blur"],
        "youth_interpretation": "Have the shoulders flown open before contact (pulling off the ball)? Judge on the "
                                "contact frame.",
        "drill_taxonomy": ["flying-open", "pulling-head"],
        "pathway_stages": ["contact-point"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
    {
        "id": "upper_torso_total_rotation_range", "name": "Upper Torso Total Rotation Range",
        "group": "Contact & Follow-Through",
        "classification": "not_reliably_measurable",
        "phase": "Load → follow-through",
        "definition": "How far the shoulders turn from most closed to most open.",
        "required_landmarks": ["both shoulders, in 3D, through the whole swing"],
        "best_camera": "Overhead or multi-camera",
        "single_camera_feasibility": "Not reliable. " + _DEPTH + " Shoulders pass edge-on and are occluded by the "
                                     "arms and bat for much of the swing.",
        "error_sources": ["Depth ambiguity", "Occlusion by arms and bat", "Follow-through leaves the frame"],
        "youth_interpretation": "Does the hitter finish the turn, or stop short? Visible at the finish.",
        "drill_taxonomy": [],
        "pathway_stages": ["lower-half-sequencing"],
        "implemented_as": None,
        "path_to_measurable": _TWO_CAMS,
    },
]

REQUIRED_FIELDS = ("id", "name", "group", "classification", "phase", "definition", "required_landmarks",
                   "best_camera", "single_camera_feasibility", "error_sources", "youth_interpretation",
                   "drill_taxonomy", "pathway_stages", "implemented_as", "path_to_measurable")


def render_markdown() -> str:
    out = [
        "# Swing mechanics registry — the twelve WIN Reality mechanics",
        "",
        "<!-- GENERATED from analyzer/swing_analyzer/catalog.py by `python -m swing_analyzer registry-doc`. "
        "Edit the Python, not this file; a test fails if they differ. -->",
        "",
        "Names follow WIN Reality's list so coaches can compare like with like. Definitions, landmarks and "
        "assessments are BenchCoach's own; nothing here reproduces WIN Reality's numbers. Everything is "
        "assessed for **one side-on phone camera and a general pose model**.",
        "",
        "- **Measurable now (unvalidated)** — an image-plane movement the analyzer measures today, with "
        "evidence frames and landmarks. Not validated until the real-swing comparison (validation.md).",
        "- **Experimental** — a single-camera proxy exists but is ambiguous; not shown to coaches as a finding.",
        "- **Not reliably measurable** — needs depth one camera does not give; always `not_assessable`.",
        "",
        "Nothing is rated: no cut-offs, colours or best values. Drill links use existing problem-taxonomy slugs "
        "(drills come from `drill_problem_map`) and Build the Swing stage keys — no separate drill list.",
        "",
        "## Summary",
        "",
        "| Phase | Mechanic | Classification | Analyzer output |",
        "|---|---|---|---|",
    ]
    for m in MECHANICS:
        impl = m["implemented_as"]
        shown = (f"`{impl['observation']}`" + (f" ({', '.join(impl['values'])})" if impl["values"] else " — not assessable"))if impl else "—"
        out.append(f"| {m['group']} | {m['name']} | {CLASS_LABEL[m['classification']]} | {shown} |")
    for g in GROUPS:
        out += ["", f"## {g}"]
        for m in [x for x in MECHANICS if x["group"] == g]:
            out += [
                "", f"### {m['name']}", "",
                f"**Classification:** {CLASS_LABEL[m['classification']]}  ",
                f"**Phase:** {m['phase']}  ",
                f"**Best camera:** {m['best_camera']}", "",
                f"**Definition.** {m['definition']}", "",
                f"**Landmarks.** {', '.join(m['required_landmarks'])}", "",
                f"**Single-camera feasibility.** {m['single_camera_feasibility']}", "",
                "**Error sources.**", "",
                *[f"- {e}" for e in m["error_sources"]], "",
                f"**Youth coaching.** {m['youth_interpretation']}", "",
                "**Drill taxonomy:** " + (", ".join(f"`{s}`" for s in m["drill_taxonomy"]) or
                                          "none — no existing problem matches; the coach chooses") + "  ",
                "**Build the Swing stages:** " + ", ".join(f"`{s}`" for s in m["pathway_stages"]) + "  ",
                f"**To make it measurable:** {m['path_to_measurable']}",
            ]
    return "\n".join(out) + "\n"
