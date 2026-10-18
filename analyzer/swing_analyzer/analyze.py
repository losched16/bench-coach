"""The analysis pipeline: video file in, `swing-pose/1` JSON out."""

from __future__ import annotations

import time
from typing import Optional

import numpy as np

from . import ANALYZER_NAME, ANALYZER_VERSION, SCHEMA
from . import mechanics as M
from . import pose as P
from .smoothing import despike
from .video import AnalyzerError, VideoInfo, decode_frames, nearest_frame, probe

# Analyse densely around the swing: from 2.5 s before contact to 0.75 s after.
# Every source frame in that window goes to the model — a 240 fps clip gets
# 240 frames per second, a 30 fps clip 30; nothing is resampled to a fixed rate.
PRE_CONTACT_S = 2.5
POST_CONTACT_S = 0.75
# Upper bound on frames sent to the model. A 960 fps clip would otherwise send
# 3,000; above the cap frames are taken at an even stride and that is recorded.
MAX_ANALYZED = 1200

VIEWS = {"face_on", "down_the_line", "other"}


def _r(x: float, n: int = 4) -> float:
    return float(round(float(x), n))


def analyze(
    video_path: str,
    model_path: str,
    contact_ms: Optional[float] = None,
    handedness: Optional[str] = None,
    camera_view: Optional[str] = None,
    backend: Optional[P.PoseBackend] = None,
    foot_strike_ms: Optional[float] = None,
    capture_fps: Optional[float] = None,
) -> dict:
    """Run the full analysis. Never raises for a bad video — returns status 'failed'."""
    started = time.time()
    timing = {}
    inputs = {
        "contact_ms": contact_ms, "handedness": handedness, "camera_view": camera_view,
        "contact_source": "coach" if contact_ms is not None else None,
        "foot_strike_ms": foot_strike_ms,
        "capture_fps": capture_fps,
    }
    base = {
        "schema": SCHEMA,
        "analyzer": {"name": ANALYZER_NAME, "version": ANALYZER_VERSION},
        "inputs": inputs,
    }
    if handedness not in (None, "R", "L"):
        return {**base, "status": "failed", "error": {"code": "bad_input", "message": "Handedness must be R or L."}}
    if capture_fps is not None and not (1 <= capture_fps <= 2000):
        return {**base, "status": "failed", "error": {"code": "bad_input", "message": "Capture frame rate must be between 1 and 2000."}}
    if camera_view is not None and camera_view not in VIEWS:
        return {**base, "status": "failed", "error": {"code": "bad_input", "message": f"Camera view must be one of {sorted(VIEWS)}."}}

    try:
        t = time.time()
        info = probe(video_path)
        timing["probe_ms"] = round((time.time() - t) * 1000)
    except AnalyzerError as e:
        return {**base, "status": "failed", "error": {"code": e.code, "message": e.message}}

    times = info.frame_times
    source = _source(info)

    if contact_ms is None:
        return {**base, "source": source, "status": "failed",
                "error": {"code": "contact_required", "message": "Mark the contact frame first — the analysis is anchored to it."}}
    if contact_ms < 0 or contact_ms / 1000.0 > times[-1] + 0.05:
        return {**base, "source": source, "status": "failed",
                "error": {"code": "contact_out_of_range", "message": "The contact mark is outside the video."}}

    c_idx = nearest_frame(times, contact_ms / 1000.0)
    inputs["contact_frame"] = c_idx
    inputs["contact_frame_t_ms"] = _r(times[c_idx] * 1000, 3)

    # Slow-motion that was EXPORTED (re-timed to play at 30 fps) stretches time:
    # the file says 1/30 s between frames that were 1/240 s apart in real life.
    # Displacements are unaffected; anything per-second (event detection, the
    # analysis window) must use real time. Originals straight off the phone keep
    # real timestamps and need no correction.
    med_dt = source["frame_intervals"]["median_ms"] or 0
    time_scale = 1.0
    if capture_fps and med_dt:
        real_dt_ms = 1000.0 / capture_fps
        time_scale = 1.0 if abs(real_dt_ms - med_dt) <= 0.05 * med_dt else real_dt_ms / med_dt
    time_model = {
        "time_scale": _r(time_scale, 6),
        "basis": "file timestamps" if time_scale == 1.0 else f"file timestamps × {time_scale:.4f} (coach said captured at {capture_fps:g} fps)",
        "note": "Event times shown to the coach are file (playback) times; real-time is used only for speed-based event detection and the analysis window.",
    }
    lo_t = times[c_idx] - PRE_CONTACT_S / time_scale
    hi_t = times[c_idx] + POST_CONTACT_S / time_scale
    window = [i for i, ts in enumerate(times) if lo_t <= ts <= hi_t]
    step = max(1, int(np.ceil(len(window) / MAX_ANALYZED)))
    chosen = window[::step]
    if c_idx not in chosen:  # the anchor is always analysed
        chosen = sorted(set(chosen) | {c_idx})
    sampling = {
        "window_start_ms": _r(times[window[0]] * 1000, 3), "window_end_ms": _r(times[window[-1]] * 1000, 3),
        "frames_in_window": len(window), "analyzed_frames": len(chosen), "stride": step,
        "rule": f"every source frame from {PRE_CONTACT_S}s before contact to {POST_CONTACT_S}s after"
                + (f", every {step}th above {MAX_ANALYZED} frames" if step > 1 else ""),
    }

    own_backend = backend is None
    try:
        if own_backend:
            backend = P.MediaPipeBackend(model_path)
    except Exception as e:  # model missing / runtime library missing
        return {**base, "source": source, "status": "failed",
                "error": {"code": "model_unavailable", "message": str(e)}}

    frames = []
    keep = set(chosen)
    t_decode = 0.0
    t_infer = 0.0
    prev_hip = None
    blur = {}
    raw = {}
    try:
        t_last = time.time()
        for i, rgb in decode_frames(info, keep):
            t_decode += time.time() - t_last
            t = time.time()
            poses = backend.detect(rgb, int(round(times[i] * 1000)))
            t_infer += time.time() - t
            blur[i] = P.blur_score(rgb)
            person = P.select_person(poses, prev_hip)
            if person is not None:
                prev_hip = P.hip_mid(person["lm"])
            raw[i] = (person, len(poses))
            t_last = time.time()
    except AnalyzerError as e:
        return {**base, "source": source, "status": "failed", "error": {"code": e.code, "message": e.message}}
    finally:
        if own_backend and backend is not None:
            backend.close()
    timing["decode_ms"] = round(t_decode * 1000)
    timing["inference_ms"] = round(t_infer * 1000)

    analysed = [i for i in chosen if i in raw]
    n = len(analysed)
    if n == 0:
        return {**base, "source": source, "status": "failed",
                "error": {"code": "decode_failed", "message": "No frames in the analysis window could be decoded."}}

    W, H = info.width, info.height
    px = np.full((n, 33, 2), np.nan)
    ok = np.zeros((n, 33), dtype=bool)
    vis = np.zeros((n, 33))
    world = np.full((n, 33, 3), np.nan)
    blur_med = float(np.median(list(blur.values()))) if blur else 0.0
    detected = 0
    for k, i in enumerate(analysed):
        person, count = raw[i]
        if person is None:
            continue
        detected += 1
        lm = person["lm"]
        px[k] = np.stack([lm[:, 0] * W, lm[:, 1] * H], axis=1)
        ok[k] = [P.joint_ok(lm, j) for j in range(33)]
        vis[k] = np.minimum(lm[:, 3], lm[:, 4])
        if person["world"] is not None:
            world[k] = person["world"]

    if detected == 0:
        return {**base, "source": source, "sampling": sampling, "status": "failed",
                "error": {"code": "no_person", "message": "No person was detected in the swing window. Check the hitter is in frame and well lit."}}

    # Despike the pixel tracks used for measurement (the raw landmarks are what
    # gets stored and drawn). Body length for the spike scale comes from the
    # median shoulder-to-ankle span over all usable frames.
    spans = [float(np.linalg.norm((px[k, 11] + px[k, 12]) / 2 - (px[k, 27] + px[k, 28]) / 2))
             for k in range(n) if all(ok[k, j] for j in (11, 12, 27, 28))]
    scale = float(np.median(spans)) if spans else float("nan")
    smooth = px.copy()
    for j in range(33):
        series = np.where(ok[:, j:j + 1], px[:, j], np.nan)
        smooth[:, j] = despike(series, scale)

    t_ms = np.array([times[i] * 1000 for i in analysed])
    contact_k = analysed.index(c_idx)
    fs_k = None
    if foot_strike_ms is not None:
        fs_k = int(np.argmin(np.abs(t_ms - foot_strike_ms)))
        if fs_k >= contact_k:
            return {**base, "source": source, "status": "failed",
                    "error": {"code": "bad_input", "message": "The foot strike mark must come before contact."}}
    track = M.Track(t_ms=t_ms, src=np.array(analysed), px=smooth, ok=ok, world=world,
                    contact=contact_k, handedness=handedness, view=camera_view, foot_strike=fs_k,
                    time_scale=time_scale, vis=vis)
    mech = M.observe(track)

    out_frames = []
    flags_total = {"no_pose": 0, "multiple_people": 0, "partial_body": 0, "blur_suspected": 0}
    for k, i in enumerate(analysed):
        person, count = raw[i]
        flags = []
        if person is None:
            flags.append("no_pose")
        else:
            if count > 1:
                flags.append("multiple_people")
            if not all(ok[k, j] for j in P.CORE_JOINTS):
                flags.append("partial_body")
        if blur_med > 0 and blur[i] < 0.35 * blur_med:
            flags.append("blur_suspected")
        for f in flags:
            flags_total[f] += 1
        fr = {"i": int(i), "t_ms": _r(times[i] * 1000, 3), "flags": flags, "blur": _r(blur[i], 1)}
        if person is not None:
            lm = person["lm"]
            fr["model_ts_ms"] = int(person["model_ts_ms"])
            fr["lm"] = [[_r(a), _r(b), _r(c), _r(v, 3), _r(p, 3)] for a, b, c, v, p in lm]
            if person["world"] is not None:
                fr["world"] = [[_r(a), _r(b), _r(c)] for a, b, c in person["world"]]
        out_frames.append(fr)

    warnings = []
    if detected < n:
        warnings.append(f"No pose in {n - detected} of {n} analysed frames.")
    if flags_total["multiple_people"]:
        warnings.append(f"More than one person detected in {flags_total['multiple_people']} frames; the hitter was tracked as the largest / nearest person.")
    if flags_total["partial_body"] > 0.2 * n:
        warnings.append("Part of the body (head, hips or feet) was missing in many frames — frame the hitter head to toe.")
    if flags_total["blur_suspected"] > 0.2 * n:
        warnings.append("Many frames look blurred relative to the rest of the clip — use slow-motion or more light.")
    if source["frame_intervals"]["variable_frame_rate"]:
        warnings.append("Variable frame rate: frame times are taken from the file, not assumed from an average rate.")
    if step > 1:
        warnings.append(f"Very high frame rate: every {step}th frame was analysed.")
    fi = source["frame_intervals"]
    if not capture_fps and (fi.get("effective_fps") or 0) <= 61 and info.duration_s > 6:
        warnings.append("Long clip at normal frame rate: if this is a slow-motion clip that was shared or exported, "
                        "set the frame rate it was recorded at — otherwise timing-based events and the analysis window are wrong.")

    # How well the model saw each joint that the mechanics use: over the whole
    # window, and in the 50 ms (real time) either side of contact, where hands
    # and the lead foot blur first.
    near = [k for k in range(n) if abs(t_ms[k] - t_ms[contact_k]) * time_scale <= 50.0]
    landmark_confidence = {}
    for j, name in P.JOINT_NAMES.items():
        landmark_confidence[name] = {
            "median_visibility": _r(float(np.median(vis[:, j])), 3),
            "usable_pct": _r(100.0 * float(ok[:, j].mean()), 1),
            "usable_pct_near_contact": _r(100.0 * float(ok[near, j].mean()), 1) if near else None,
        }
    timing["total_ms"] = round((time.time() - started) * 1000)
    timing["inference_ms_per_frame"] = round(t_infer * 1000 / max(1, n), 1)
    return {
        **base,
        "status": "ok",
        "model": {
            "name": backend.name if backend else None,
            "version": backend.version if backend else None,
            "file_sha256": getattr(backend, "model_sha256", None),
            "running_mode": "VIDEO",
            "num_poses": getattr(backend, "num_poses", None),
            "landmarks": 33,
            "coordinates": {
                "lm": "x, y normalised to the DISPLAYED frame (after rotation), z relative depth (unitless), visibility, presence",
                "world": "model-ESTIMATED metres relative to the hip centre — not calibrated 3D; y is down",
            },
        },
        "source": source,
        "time_model": time_model,
        "sampling": sampling,
        "frames": out_frames,
        "events": mech["events"],
        "observations": mech["observations"],
        "body_reference": mech["body_reference"],
        "quality": {"pose_detected_frames": detected, "analysed_frames": n, "flags": flags_total, "warnings": warnings,
                    "landmark_confidence": landmark_confidence, "near_contact_frames": len(near)},
        "smoothing": "single-frame spike removal on measurement tracks only; gaps are never filled; stored/drawn landmarks are raw",
        "timing": timing,
    }


def _source(info: VideoInfo) -> dict:
    return {
        "container": info.container, "codec": info.codec, "size_bytes": info.size_bytes,
        "coded_width": info.coded_width, "coded_height": info.coded_height,
        "rotation_deg": info.rotation, "width": info.width, "height": info.height,
        "avg_fps": _r(info.avg_fps, 3) if info.avg_fps else None,
        "r_fps": _r(info.r_fps, 3) if info.r_fps else None,
        "duration_ms": _r(info.duration_s * 1000, 1),
        "frame_count": info.frame_count,
        "frame_intervals": info.interval_stats(),
    }
