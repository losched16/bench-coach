"""Mechanics registry: what each observation means, needs, and cannot claim.

Every entry declares its definition, required landmarks and camera view, the
event window it is computed over, the method, the unit, the data-quality gates,
the evidence frames it cites, its limitations and its validation status.

Rules the code enforces, not just the docs:

* No thresholds, ratings, colours or scores. An observation is a number with a
  unit, a window, evidence frames and caveats. Whether it is good or bad for a
  given 9-year-old on a tee is the coach's call.
* Units are relative to the player's own body in the image (stance
  shoulder-to-ankle length). There is no camera calibration, so nothing here is
  inches, feet or degrees of real anatomy.
* If a gate fails the observation is `not_assessable` with the reason, and it
  carries NO value. A partial number is not returned "for information".
* Every entry is `validation_status: unvalidated` until compared against a
  reference (see docs/swing-mechanics-poc/validation.md). The analyzer refuses
  to emit any other status.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from . import pose as P

UNIT_BODY = "× stance shoulder-to-ankle length (image plane)"

# Data-quality gates. These describe the INPUT (could the model see the joints
# steadily enough to measure anything?), not the swing.
GOOD_COVERAGE, FAIR_COVERAGE = 0.90, 0.70
GOOD_REF_CV, FAIR_REF_CV = 0.05, 0.10
MIN_STANCE_FEET_GAP = 0.05  # feet closer than this (× body length) cannot set a forward direction

ALLOWED_VALIDATION = {"unvalidated", "experimental_feasibility"}

REGISTRY: Dict[str, dict] = {
    "lead_foot_movement": {
        "label": "Stride — lead-foot movement",
        "definition": (
            "How far the lead foot travels toward the pitcher, in the image, from the stance "
            "to the estimated foot strike; plus how high it lifts on the way and how wide the "
            "stance was. Observable foot movement, not a calibrated stride length."
        ),
        "required_landmarks": ["lead ankle", "lead heel", "lead foot index", "back ankle", "shoulders"],
        "camera_view": "face_on",
        "camera_view_note": "Camera level with the hips, perpendicular to the line between the feet (facing the hitter's chest or back). From behind the catcher the stride points at the lens and cannot be measured.",
        "requires_handedness": True,
        "event_window": "stance → foot strike (estimated); stance → contact if no foot strike is found",
        "method": (
            "Lead-foot point = mean of the visible lead ankle, heel and foot-index landmarks. "
            "Forward axis = image direction from back ankle to lead ankle in the stance. "
            "Displacement along that axis between the stance reference and foot strike, divided "
            "by the stance shoulder-to-ankle length in pixels."
        ),
        "unit": UNIT_BODY,
        "evidence": ["stance reference frame", "peak lift frame", "foot strike frame"],
        "limitations": [
            "Image-plane only: a stride that angles toward or away from the camera is shortened.",
            "Assumes a static camera; a hand-held pan is read as foot movement.",
            "Foot strike is an automatic estimate from lead-foot speed — check it and move it if wrong.",
            "Not comparable across different camera distances or angles without calibration.",
        ],
        "validation_status": "unvalidated",
        "drill_taxonomy": ["stepping-in-bucket", "lunging"],
    },
    "forward_move": {
        "label": "Head and pelvis forward move",
        "definition": (
            "How far the head (nose landmark) and the pelvis (midpoint of the hips) travel toward "
            "the pitcher in the image, from the stance to contact, and separately from foot strike "
            "to contact."
        ),
        "required_landmarks": ["nose", "both hips", "both ankles", "shoulders"],
        "camera_view": "face_on",
        "camera_view_note": "Same view as the stride. From behind the catcher forward movement points at the lens.",
        "requires_handedness": True,
        "event_window": "stance → contact (coach-marked); foot strike → contact",
        "method": (
            "Nose and hip-midpoint positions at the stance reference and at the contact frame, "
            "projected on the stance forward axis and divided by the stance shoulder-to-ankle length."
        ),
        "unit": UNIT_BODY,
        "evidence": ["stance reference frame", "foot strike frame", "contact frame"],
        "limitations": [
            "Image-plane estimate of movement, not a real-world distance.",
            "The nose landmark moves when the head turns, not only when it translates.",
            "Some forward move is normal and the right amount varies by hitter and age — no target is implied.",
        ],
        "validation_status": "unvalidated",
        "drill_taxonomy": ["lunging", "pulling-head"],
    },
    "hip_shoulder_separation": {
        "label": "Hip–shoulder separation (feasibility only)",
        "definition": (
            "The rotation of the shoulders relative to the pelvis about the vertical axis. "
            "Evaluated here only to decide whether a single phone camera plus a general pose model "
            "can support it."
        ),
        "required_landmarks": ["both shoulders", "both hips (estimated 3D)"],
        "camera_view": "any (needs depth, which one camera does not provide)",
        "requires_handedness": False,
        "event_window": "stance (noise check)",
        "method": (
            "Diagnostic only: the angle between the estimated-3D hip line and shoulder line in the "
            "horizontal plane, examined while the hitter is still. Its frame-to-frame scatter when "
            "nothing is moving is a lower bound on its error."
        ),
        "unit": "diagnostic — not reported as a player measurement",
        "evidence": ["stance window"],
        "limitations": [
            "Axial rotation is mostly motion toward or away from the camera: the depth axis a single "
            "camera measures worst.",
            "MediaPipe's 3D world landmarks are a learned estimate, not triangulated.",
            "No validated reference exists for this setup, so no value is presented as the player's.",
        ],
        "validation_status": "experimental_feasibility",
        "drill_taxonomy": [],
    },
}

for _id, _m in REGISTRY.items():
    assert _m["validation_status"] in ALLOWED_VALIDATION, _id


@dataclass
class Track:
    """The selected hitter's landmarks for the analyzed frames."""

    t_ms: np.ndarray            # (n,) real presentation time of each analyzed frame
    src: np.ndarray             # (n,) source frame index
    px: np.ndarray              # (n, 33, 2) pixel coords in the displayed frame; NaN if no pose
    ok: np.ndarray              # (n, 33) usable joint
    world: np.ndarray           # (n, 33, 3) model-estimated metres; NaN if none
    contact: int                # index into the analyzed frames
    handedness: Optional[str]   # 'R' | 'L' | None
    view: Optional[str]         # 'face_on' | 'down_the_line' | 'other' | None
    notes: List[str] = field(default_factory=list)
    foot_strike: Optional[int] = None  # coach-marked foot strike (index), overrides the estimate

    @property
    def n(self) -> int:
        return len(self.t_ms)


def side(handedness: str) -> dict:
    """Lead/back joint ids. MediaPipe left/right are the PERSON's left/right."""
    if handedness == "R":  # right-handed hitter leads with the left side
        return {"lead_ankle": P.L_ANKLE, "lead_heel": P.L_HEEL, "lead_foot": P.L_FOOT, "back_ankle": P.R_ANKLE}
    return {"lead_ankle": P.R_ANKLE, "lead_heel": P.R_HEEL, "lead_foot": P.R_FOOT, "back_ankle": P.L_ANKLE}


def _frame_ref(tr: Track, k: Optional[int]) -> Optional[dict]:
    if k is None:
        return None
    return {"frame": int(tr.src[k]), "t_ms": round(float(tr.t_ms[k]), 3), "k": int(k)}


def _mid(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a + b) / 2.0


# ── events ──────────────────────────────────────────────────────────────────

def stance_window(tr: Track) -> List[int]:
    """Analyzed frames treated as the stance reference.

    The first 250 ms of the window that are also at least 400 ms before
    contact, using only frames where the core joints are visible. The window is
    chosen to start before the swing; if the clip starts mid-motion the
    stillness check in `body_reference` will say so.
    """
    if tr.n == 0:
        return []
    t0 = tr.t_ms[0]
    limit = min(t0 + 250.0, tr.t_ms[tr.contact] - 400.0)
    ks = [k for k in range(tr.n) if tr.t_ms[k] <= limit and all(tr.ok[k, j] for j in P.CORE_JOINTS)]
    return ks


def body_reference(tr: Track, stance: List[int]) -> Optional[dict]:
    """Stance shoulder-to-ankle length in pixels, and how steady it was."""
    if len(stance) < 3:
        return None
    lens = []
    for k in stance:
        sh = _mid(tr.px[k, P.L_SHOULDER], tr.px[k, P.R_SHOULDER])
        an = _mid(tr.px[k, P.L_ANKLE], tr.px[k, P.R_ANKLE])
        lens.append(float(np.linalg.norm(sh - an)))
    arr = np.array(lens)
    med = float(np.median(arr))
    if med <= 0:
        return None
    return {"length_px": med, "cv": float(np.std(arr) / med), "frames": len(stance)}


SPEED_SPAN_MS = 50.0       # speed is measured over this much time, not per frame
MIN_TRAVEL = 0.03          # lead foot must move this far (× body length) to count as a stride


def estimate_foot_strike(tr: Track, stance: List[int], ref_len: float) -> dict:
    """Automatic, unvalidated estimate of lead-foot strike before contact.

    Lead-foot speed is measured over a fixed 50 ms span (not frame to frame:
    per-frame landmark jitter divided by 1/240 s looks like fast movement in a
    slow-motion clip, so a per-frame rule would behave differently at every
    frame rate). If the lead foot never travels more than 3% of a body length
    from its stance position, no stride is reported. Otherwise foot strike is
    the first frame after the fastest movement where the speed has fallen
    below 20% of that peak and stays there for two frames. These numbers
    locate an EVENT; they say nothing about whether the stride was good.
    """
    if tr.handedness not in ("R", "L") or not stance:
        return {"frame": None, "source": "auto_estimate", "status": "not_estimated",
                "reason": "Needs the hitter's handedness to know which foot leads."}
    s = side(tr.handedness)
    pts = foot_points(tr, s)
    start = stance[-1]
    stance_pt = np.nanmedian(np.array([pts[k] for k in stance]), axis=0)
    seg = range(start + 1, tr.contact + 1)
    travel = [float(np.linalg.norm(pts[k] - stance_pt)) / ref_len for k in seg if np.all(np.isfinite(pts[k]))]
    if not travel:
        return {"frame": None, "source": "auto_estimate", "status": "not_estimated",
                "reason": "The lead foot was not visible between the stance and contact."}
    if max(travel) < MIN_TRAVEL:
        return {"frame": None, "source": "auto_estimate", "status": "no_movement_detected",
                "reason": "The lead foot did not move measurably before contact (e.g. a no-stride swing)."}
    speeds = np.full(tr.n, np.nan)
    for k in seg:
        k0 = k
        while k0 > start and tr.t_ms[k] - tr.t_ms[k0 - 1] <= SPEED_SPAN_MS:
            k0 -= 1
        if k0 == k:
            k0 = k - 1
        a, b = pts[k0], pts[k]
        dt = (tr.t_ms[k] - tr.t_ms[k0]) / 1000.0
        if np.all(np.isfinite(a)) and np.all(np.isfinite(b)) and dt > 0:
            speeds[k] = float(np.linalg.norm(b - a)) / ref_len / dt
    window = speeds[start + 1: tr.contact + 1]
    if not np.any(np.isfinite(window)):
        return {"frame": None, "source": "auto_estimate", "status": "not_estimated",
                "reason": "The lead foot was not visible long enough to follow its movement."}
    peak_k = start + 1 + int(np.nanargmax(window))
    peak = float(speeds[peak_k])
    for k in range(peak_k + 1, tr.contact):
        nxt = speeds[k + 1]
        if np.isfinite(speeds[k]) and speeds[k] < 0.2 * peak and (not np.isfinite(nxt) or nxt < 0.2 * peak):
            return {**_frame_ref(tr, k), "source": "auto_estimate", "status": "estimated",
                    "confidence": "low",
                    "method": "lead-foot speed over 50 ms fell below 20% of its peak for two frames",
                    "peak_speed_body_lengths_per_s": round(peak, 3)}
    return {"frame": None, "source": "auto_estimate", "status": "not_estimated",
            "reason": "The lead foot was still moving at contact; no foot strike could be placed before it."}


def foot_points(tr: Track, s: dict) -> np.ndarray:
    """Per-frame lead-foot point: mean of the visible ankle/heel/toe. NaN when the ankle is not usable."""
    out = np.full((tr.n, 2), np.nan)
    for k in range(tr.n):
        if not tr.ok[k, s["lead_ankle"]]:
            continue
        js = [j for j in (s["lead_ankle"], s["lead_heel"], s["lead_foot"]) if tr.ok[k, j]]
        out[k] = np.mean([tr.px[k, j] for j in js], axis=0)
    return out


# ── observations ────────────────────────────────────────────────────────────

def _base(mid: str) -> dict:
    m = REGISTRY[mid]
    return {
        "id": mid,
        "label": m["label"],
        "definition": m["definition"],
        "method": m["method"],
        "unit": m["unit"],
        "camera_view_required": m["camera_view"],
        "limitations": m["limitations"],
        "validation_status": m["validation_status"],
        "drill_taxonomy": m["drill_taxonomy"],
    }


def _not_assessable(mid: str, reason: str, **extra) -> dict:
    return {**_base(mid), "status": "not_assessable", "reason": reason, "values": [], **extra}


def _coverage(tr: Track, ks: List[int], joints: List[int]) -> float:
    if not ks:
        return 0.0
    return sum(1 for k in ks if all(tr.ok[k, j] for j in joints)) / len(ks)


def _quality(coverage: float, ref_cv: float) -> Optional[str]:
    if coverage >= GOOD_COVERAGE and ref_cv <= GOOD_REF_CV:
        return "good"
    if coverage >= FAIR_COVERAGE and ref_cv <= FAIR_REF_CV:
        return "fair"
    return None


def _common_gates(mid: str, tr: Track, stance: List[int], ref: Optional[dict]) -> Optional[dict]:
    m = REGISTRY[mid]
    if tr.view != "face_on":
        reason = ("Camera view not given." if tr.view is None
                  else f"Needs a face-on view; this clip is marked '{tr.view}'. {m['camera_view_note']}")
        return _not_assessable(mid, reason)
    if m["requires_handedness"] and tr.handedness not in ("R", "L"):
        return _not_assessable(mid, "Needs the hitter's handedness to know which side leads.")
    if len(stance) < 3 or ref is None:
        return _not_assessable(mid, "No steady stance with the whole body visible before the swing — start recording earlier and keep head to feet in frame.")
    if ref["cv"] > FAIR_REF_CV:
        return _not_assessable(mid, f"The body-length reference was unsteady during the stance (varied {ref['cv'] * 100:.0f}%). The hitter may already be moving, or the camera is.")
    return None


def forward_axis(tr: Track, stance: List[int], ref_len: float) -> Optional[np.ndarray]:
    s = side(tr.handedness)
    vecs = [tr.px[k, s["lead_ankle"]] - tr.px[k, s["back_ankle"]] for k in stance]
    v = np.median(np.array(vecs), axis=0)
    norm = float(np.linalg.norm(v))
    if norm < MIN_STANCE_FEET_GAP * ref_len:
        return None
    return v / norm


def _near_usable(tr: Track, k: int, joints: List[int], radius: int = 2) -> Optional[int]:
    """The frame itself if the joints are usable there, else the nearest within `radius`."""
    for d in range(radius + 1):
        for c in (k - d, k + d):
            if 0 <= c < tr.n and all(tr.ok[c, j] for j in joints):
                return c
    return None


def lead_foot_movement(tr: Track, stance: List[int], ref: Optional[dict], fs: dict) -> dict:
    mid = "lead_foot_movement"
    gated = _common_gates(mid, tr, stance, ref)
    if gated:
        return gated
    L = ref["length_px"]
    axis = forward_axis(tr, stance, L)
    if axis is None:
        return _not_assessable(mid, "The feet overlap in the image during the stance, so the direction toward the pitcher can't be set — this usually means the camera is behind or in front of the hitter, not face-on.")
    s = side(tr.handedness)
    pts = foot_points(tr, s)
    end_k = fs.get("k") if fs.get("frame") is not None else tr.contact
    window = list(range(stance[0], end_k + 1))
    cov = _coverage(tr, window, [s["lead_ankle"], s["back_ankle"]])
    q = _quality(cov, ref["cv"])
    if q is None:
        return _not_assessable(mid, f"The lead foot was usable in only {cov * 100:.0f}% of frames from stance to foot strike.")
    stance_pt = np.nanmedian(np.array([pts[k] for k in stance]), axis=0)
    k_end = _near_usable(tr, end_k, [s["lead_ankle"]])
    if k_end is None or not np.all(np.isfinite(stance_pt)):
        return _not_assessable(mid, "The lead foot was not visible at the end of the stride.")
    disp = float(np.dot(pts[k_end] - stance_pt, axis)) / L
    # Lift: image y grows downward, so "up" is negative y.
    lifts = [(float(stance_pt[1] - pts[k][1]) / L, k) for k in window if np.all(np.isfinite(pts[k]))]
    lift, lift_k = max(lifts) if lifts else (0.0, None)
    back = np.nanmedian(np.array([tr.px[k, s["back_ankle"]] for k in stance]), axis=0)
    width = float(np.linalg.norm(stance_pt - back)) / L
    end_label = ("foot strike (coach-marked)" if fs.get("source") == "coach" else "foot strike (estimated)") if fs.get("frame") is not None else "contact (no foot strike estimated)"
    return {
        **_base(mid),
        "status": "observed",
        "data_quality": q,
        "values": [
            {"name": "lead_foot_forward_displacement", "label": f"Lead foot moved toward the pitcher (stance → {end_label})",
             "value": round(disp, 3), "unit": UNIT_BODY},
            {"name": "lead_foot_peak_lift", "label": "Highest lead-foot lift before foot strike",
             "value": round(max(lift, 0.0), 3), "unit": UNIT_BODY},
            {"name": "stance_width", "label": "Stance width (lead foot to back ankle)",
             "value": round(width, 3), "unit": UNIT_BODY},
        ],
        "window": {"start": _frame_ref(tr, stance[0]), "end": _frame_ref(tr, k_end)},
        "evidence_frames": [x for x in [
            {**_frame_ref(tr, stance[len(stance) // 2]), "label": "stance reference"},
            {**_frame_ref(tr, lift_k), "label": "peak lift"} if lift_k is not None and lift > 0.01 else None,
            {**_frame_ref(tr, k_end), "label": end_label},
        ] if x],
        "inputs": {"landmark_coverage": round(cov, 3), "body_reference_px": round(L, 2),
                   "body_reference_cv": round(ref["cv"], 4), "forward_axis_image": [round(float(a), 4) for a in axis]},
    }


def forward_move(tr: Track, stance: List[int], ref: Optional[dict], fs: dict) -> dict:
    mid = "forward_move"
    gated = _common_gates(mid, tr, stance, ref)
    if gated:
        return gated
    L = ref["length_px"]
    axis = forward_axis(tr, stance, L)
    if axis is None:
        return _not_assessable(mid, "The feet overlap in the image during the stance, so the direction toward the pitcher can't be set (camera not face-on).")
    joints = [P.NOSE, P.L_HIP, P.R_HIP]
    window = list(range(stance[0], tr.contact + 1))
    cov = _coverage(tr, window, joints)
    q = _quality(cov, ref["cv"])
    if q is None:
        return _not_assessable(mid, f"Head and hips were usable in only {cov * 100:.0f}% of frames from stance to contact.")
    kc = _near_usable(tr, tr.contact, joints)
    if kc is None:
        return _not_assessable(mid, "Head or hips were not visible at the contact frame.")
    head0 = np.median(np.array([tr.px[k, P.NOSE] for k in stance]), axis=0)
    pel0 = np.median(np.array([_mid(tr.px[k, P.L_HIP], tr.px[k, P.R_HIP]) for k in stance]), axis=0)
    head = lambda k: tr.px[k, P.NOSE]
    pel = lambda k: _mid(tr.px[k, P.L_HIP], tr.px[k, P.R_HIP])
    along = lambda a, b: round(float(np.dot(b - a, axis)) / L, 3)
    values = [
        {"name": "head_forward_stance_to_contact", "label": "Head moved toward the pitcher (stance → contact)",
         "value": along(head0, head(kc)), "unit": UNIT_BODY},
        {"name": "pelvis_forward_stance_to_contact", "label": "Pelvis moved toward the pitcher (stance → contact)",
         "value": along(pel0, pel(kc)), "unit": UNIT_BODY},
    ]
    evidence = [{**_frame_ref(tr, stance[len(stance) // 2]), "label": "stance reference"}]
    kf = _near_usable(tr, fs["k"], joints) if fs.get("frame") is not None else None
    if kf is not None:
        values.append({"name": "head_forward_foot_strike_to_contact", "label": "Head moved toward the pitcher (foot strike → contact)",
                       "value": along(head(kf), head(kc)), "unit": UNIT_BODY})
        evidence.append({**_frame_ref(tr, kf), "label": "foot strike (coach-marked)" if fs.get("source") == "coach" else "foot strike (estimated)"})
    evidence.append({**_frame_ref(tr, kc), "label": "contact (coach-marked)"})
    return {
        **_base(mid), "status": "observed", "data_quality": q, "values": values,
        "window": {"start": _frame_ref(tr, stance[0]), "end": _frame_ref(tr, kc)},
        "evidence_frames": evidence,
        "inputs": {"landmark_coverage": round(cov, 3), "body_reference_px": round(L, 2),
                   "body_reference_cv": round(ref["cv"], 4), "forward_axis_image": [round(float(a), 4) for a in axis]},
    }


def hip_shoulder_feasibility(tr: Track, stance: List[int]) -> dict:
    """Always `not_assessable` as an observation. Returns the evidence for that verdict."""
    mid = "hip_shoulder_separation"
    ks = [k for k in stance if np.all(np.isfinite(tr.world[k, [P.L_HIP, P.R_HIP, P.L_SHOULDER, P.R_SHOULDER]]))]
    diag: dict = {"stance_frames_with_3d": len(ks)}
    if len(ks) >= 3:
        def yaw(a, b, k):
            v = tr.world[k, b] - tr.world[k, a]
            return math.degrees(math.atan2(v[2], v[0]))  # x-z plane: MediaPipe world y is vertical
        sep = []
        for k in ks:
            d = yaw(P.L_SHOULDER, P.R_SHOULDER, k) - yaw(P.L_HIP, P.R_HIP, k)
            sep.append((d + 180) % 360 - 180)
        arr = np.array(sep)
        jumps = np.abs(np.diff(arr))
        diag.update({
            "proxy_sd_while_still_deg": round(float(np.std(arr)), 2),
            "proxy_max_frame_jump_while_still_deg": round(float(jumps.max()), 2) if len(jumps) else None,
            "note": "Model diagnostic, not a measurement of the player: scatter of an estimated-3D proxy while the body is still.",
        })
    reason = (
        "Not assessable from one camera with a general pose model. Hip–shoulder separation is a "
        "rotation mostly toward or away from the lens — the depth that a single camera measures "
        "worst — and the model's 3D landmarks are learned estimates with no validated reference for "
        "this setup. A credible version needs either two synchronised cameras (triangulated "
        "landmarks) or a baseball-specific model validated against motion capture."
    )
    return _not_assessable(mid, reason, feasibility=diag)


def observe(tr: Track) -> dict:
    stance = stance_window(tr)
    ref = body_reference(tr, stance)
    if tr.foot_strike is not None:
        # The coach's mark wins: the automatic estimate is unvalidated and the
        # stride value depends on where this event sits.
        fs = {**_frame_ref(tr, tr.foot_strike), "source": "coach", "status": "marked"}
    elif ref:
        fs = estimate_foot_strike(tr, stance, ref["length_px"])
    else:
        fs = {"frame": None, "source": "auto_estimate", "status": "not_estimated",
              "reason": "No steady full-body stance to measure from."}
    events = {
        "contact": {**_frame_ref(tr, tr.contact), "source": "coach"},
        "stance": ({"start": _frame_ref(tr, stance[0]), "end": _frame_ref(tr, stance[-1]),
                    "source": "auto", "frames": len(stance)} if stance else None),
        "foot_strike": fs,
        # Not estimated in this POC. The review UI lets the coach tag them; an
        # automatic guess with no validation would only look authoritative.
        "load": {"frame": None, "source": "coach_tag_only", "status": "not_estimated"},
        "swing_start": {"frame": None, "source": "coach_tag_only", "status": "not_estimated"},
    }
    observations = [
        lead_foot_movement(tr, stance, ref, fs),
        forward_move(tr, stance, ref, fs),
        hip_shoulder_feasibility(tr, stance),
    ]
    for o in observations:
        assert o["validation_status"] in ALLOWED_VALIDATION
        if o["status"] == "not_assessable":
            assert not o["values"], o["id"]
    return {"events": events, "observations": observations,
            "body_reference": ({k: (round(v, 4) if isinstance(v, float) else v) for k, v in ref.items()} if ref else None)}
