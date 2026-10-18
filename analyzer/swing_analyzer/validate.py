"""Real-swing validation run: one command, one private folder, one report.

    python -m swing_analyzer validate VIDEO --contact-ms MS --handedness R|L \\
        --view face_on (--not-slowmo | --capture-fps 240) [--foot-strike-ms MS]

Writes, into a git-ignored private folder (default analyzer/out/private/<run>/):

    report.md          everything below, for a person to read
    result.json        the analyzer's full output (auto foot strike)
    result-coach-fs.json  the same with the coach's foot strike (if given)
    playback.json      the browser copy's alignment proof
    playback.mp4/.webm the browser copy
    overlay.mp4        landmarks drawn on every analysed frame (viewing aid)
    evidence/*.png     each evidence frame, with the landmarks behind the number
    browser-check/     reference frames + the headless-browser seek check

PRIVACY. The video and everything derived from it are a child's image. The
folder must be git-ignored (checked; the run refuses otherwise), is created
owner-only (0700), and nothing is uploaded anywhere. Standard output carries
no file names, paths of the input, or images — only counts and timings. The
report identifies the input by a hash prefix, not its name. Delete the folder
when the review is done.

This validates the PIPELINE on real footage and sets up the comparison with a
coach's eye. It does not validate any mechanic on its own, and nothing it
writes is a rating.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from typing import List, Optional

import numpy as np

from . import ANALYZER_VERSION as __version__
from . import catalog as C
from . import pose as P
from .video import AnalyzerError, decode_frames, probe

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYZER_ROOT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(ANALYZER_ROOT)
DEFAULT_OUT = os.path.join(ANALYZER_ROOT, "out", "private")


# ── privacy guards ──────────────────────────────────────────────────────────

def ensure_private_dir(path: str, allow_unignored: bool = False) -> str:
    """Create `path` owner-only, and refuse if git would track it."""
    path = os.path.abspath(path)
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)
    if allow_unignored:
        return path
    probe_file = os.path.join(path, "report.md")
    try:
        r = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "-q", probe_file], capture_output=True)
    except FileNotFoundError:
        return path  # no git: nothing can be committed by accident from here
    inside = os.path.commonpath([path, REPO_ROOT]) == REPO_ROOT
    if inside and r.returncode != 0:
        raise SystemExit(f"refusing to write private output to a folder git would track: {path}\n"
                         "use the default (analyzer/out/private/) or a folder outside the repository")
    return path


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ── extra probe facts the analyzer does not need but a reviewer does ────────

def stream_facts(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                         capture_output=True, timeout=60)
    meta = json.loads(out.stdout or b"{}")
    v = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"), {})
    a = [s for s in meta.get("streams", []) if s.get("codec_type") == "audio"]
    transfer = v.get("color_transfer")
    side = [d.get("side_data_type", "") for d in v.get("side_data_list", []) or []]
    tags = (meta.get("format") or {}).get("tags") or {}
    return {
        "container": (meta.get("format") or {}).get("format_name"),
        "codec": v.get("codec_name"), "profile": v.get("profile"), "codec_tag": v.get("codec_tag_string"),
        "pix_fmt": v.get("pix_fmt"), "bits_per_raw_sample": v.get("bits_per_raw_sample"),
        "color_transfer": transfer, "color_primaries": v.get("color_primaries"),
        "hdr": transfer in ("arib-std-b67", "smpte2084") or any("DOVI" in s or "Dolby" in s for s in side),
        "side_data": side,
        "audio_streams": len(a),
        "start_time_s": float(v["start_time"]) if v.get("start_time") not in (None, "N/A") else None,
        "has_creation_time": "creation_time" in tags,
        "has_location_tag": any("location" in k.lower() for k in tags),
    }


def browser_notes(f: dict) -> List[str]:
    """What is likely to happen playing the ORIGINAL in each browser. Stated as
    likely, not tested — the verified copy is what the app plays."""
    notes = []
    codec, pix = f.get("codec"), f.get("pix_fmt") or ""
    ten_bit = "10" in pix
    if codec == "hevc":
        notes.append("HEVC original: plays in Safari (iPhone/Mac). Chrome/Edge only with hardware support"
                     + (" and 10-bit HEVC often not at all" if ten_bit else "") + "; Firefox generally not. "
                     "The app plays the verified copy instead.")
    elif codec == "h264":
        notes.append("H.264 original: plays in all major browsers (not in the open-source Chromium used by the automated test).")
    else:
        notes.append(f"{codec} original: browser support varies; the app plays the verified copy.")
    if f.get("hdr"):
        notes.append("HDR source (HLG/PQ/Dolby Vision): browsers show it differently, and the analyzer decodes it "
                     "WITHOUT tone mapping (flat/dim colours). Check pose coverage below; if it is poor, re-record "
                     "with HDR off (iPhone: Settings → Camera → Record Video → HDR Video off).")
    if (f.get("start_time_s") or 0) > 0.001:
        notes.append(f"The file's first frame is at {f['start_time_s']:.3f} s, not 0. Frame times are measured from the "
                     "first frame; the copy is re-timed to start at 0 so browsers agree.")
    if f.get("has_location_tag"):
        notes.append("The file carries a location tag in its metadata. The playback copy does not (metadata is not "
                     "copied); the original stays private.")
    return notes


# ── evidence stills ─────────────────────────────────────────────────────────

def render_evidence(video_path: str, result: dict, out_dir: str) -> List[dict]:
    import cv2

    os.makedirs(out_dir, exist_ok=True)
    by_i = {f["i"]: f for f in result.get("frames", [])}
    wanted = {}
    for o in result.get("observations", []):
        for e in o.get("evidence_frames") or []:
            wanted.setdefault(e["frame"], []).append((o["id"], e))
    info = probe(video_path)
    W, H = info.width, info.height
    name_to_idx = {v: k for k, v in P.JOINT_NAMES.items()}
    written = []
    for i, rgb in decode_frames(info, set(wanted)):
        for oid, e in wanted[i]:
            img = rgb.copy()
            lm = (by_i.get(i) or {}).get("lm")
            if lm:
                pts = [(int(x * W), int(y * H)) if (v >= P.VISIBLE and p >= P.VISIBLE) else None for x, y, _, v, p in lm]
                for a, b in P.CONNECTIONS:
                    if pts[a] and pts[b]:
                        cv2.line(img, pts[a], pts[b], (0, 200, 100), 1, cv2.LINE_AA)
            for name, l in (e.get("landmarks") or {}).items():
                if l.get("x_px") is None:
                    continue
                c = (int(l["x_px"]), int(l["y_px"]))
                colour = (255, 220, 0) if l.get("usable") else (255, 60, 60)
                cv2.circle(img, c, 6, colour, 2, cv2.LINE_AA)
                if name_to_idx.get(name) is not None:
                    cv2.putText(img, name.replace("_", " "), (c[0] + 7, c[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35,
                                colour, 1, cv2.LINE_AA)
            label = f"{oid} | {e['label']} | frame {i} | t={e['t_ms']:.1f} ms"
            cv2.rectangle(img, (0, 0), (W, 22), (0, 0, 0), -1)
            cv2.putText(img, label, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
            fn = f"{oid}__{e['label'].replace(' ', '_').replace('(', '').replace(')', '')}__f{i:05d}.png"
            cv2.imwrite(os.path.join(out_dir, fn), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
            written.append({"observation": oid, "label": e["label"], "frame": i, "file": f"evidence/{fn}"})
    return written


def contact_sheet(video_path: str, around_ms: float, span_ms: float, out_path: str, cols: int = 6) -> dict:
    """Frames within ±span of a time, labelled with index and time — to find contact by eye."""
    import cv2

    info = probe(video_path)
    t = np.array(info.frame_times) * 1000
    ks = [int(k) for k in np.nonzero(np.abs(t - around_ms) <= span_ms)[0]]
    if not ks:
        raise SystemExit("no frames in that range")
    if len(ks) > 48:  # keep the sheet readable: every nth frame, always including the nearest
        step = int(np.ceil(len(ks) / 48))
        near = int(np.argmin(np.abs(t - around_ms)))
        ks = sorted(set(ks[::step]) | {near})
    tw = 320
    th = int(round(info.height * tw / info.width))
    tiles = []
    for i, rgb in decode_frames(info, set(ks)):
        tile = cv2.resize(rgb, (tw, th), interpolation=cv2.INTER_AREA)
        cv2.rectangle(tile, (0, 0), (tw, 18), (0, 0, 0), -1)
        cv2.putText(tile, f"frame {i}  {t[i]:.1f} ms", (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)
    rows = [tiles[r:r + cols] for r in range(0, len(tiles), cols)]
    blank = np.zeros_like(tiles[0])
    grid = np.vstack([np.hstack(r + [blank] * (cols - len(r))) for r in rows])
    cv2.imwrite(out_path, cv2.cvtColor(grid, cv2.COLOR_RGB2BGR))
    return {"frames": [{"frame": i, "t_ms": round(float(t[i]), 3)} for i in ks], "out": out_path}


# ── experimental diagnostics (NOT findings) ─────────────────────────────────

def width_proxies(result: dict) -> Optional[dict]:
    """Apparent 2D hip and shoulder width relative to the stance, at the events.

    For the Pelvis/Upper Torso Load and Direction-at-Contact mechanics, which
    the catalog classifies as experimental: a width change says the segment
    turned toward or away from the camera, NOT which way or by how much. For a
    reviewer comparing against the video; never shown to a coach as a finding.
    """
    frames = result.get("frames") or []
    src = result.get("source") or {}
    W, H = src.get("width"), src.get("height")
    ref = (result.get("body_reference") or {}).get("length_px")
    stance = (result.get("events") or {}).get("stance")
    if not (frames and W and H and ref and stance):
        return None

    def width(f, a, b):
        lm = f.get("lm")
        if not lm or min(lm[a][3], lm[b][3], lm[a][4], lm[b][4]) < P.VISIBLE:
            return None
        return float(np.hypot((lm[a][0] - lm[b][0]) * W, (lm[a][1] - lm[b][1]) * H)) / ref

    s0, s1 = stance["start"]["frame"], stance["end"]["frame"]
    ev = result.get("events") or {}
    fs = (ev.get("foot_strike") or {}).get("frame")
    ct = (ev.get("contact") or {}).get("frame")
    by_i = {f["i"]: f for f in frames}
    out = {}
    for seg, (a, b) in {"hips": (P.L_HIP, P.R_HIP), "shoulders": (P.L_SHOULDER, P.R_SHOULDER)}.items():
        base = [w for f in frames if s0 <= f["i"] <= s1 for w in [width(f, a, b)] if w is not None]
        if len(base) < 3:
            out[seg] = None
            continue
        b0 = float(np.median(base))
        load = [(width(f, a, b) / b0, f["i"]) for f in frames
                if s1 < f["i"] <= (fs if fs is not None else ct) and width(f, a, b) is not None]
        at = lambda i: (None if i is None or i not in by_i or width(by_i[i], a, b) is None
                        else round(width(by_i[i], a, b) / b0, 3))
        out[seg] = {
            "stance_width_body_lengths": round(b0, 4),
            "stance_scatter_ratio_sd": round(float(np.std(np.array(base) / b0)), 4),
            "ratio_min_before_foot_strike": ({"ratio": round(min(load)[0], 3), "frame": min(load)[1]} if load else None),
            "ratio_max_before_foot_strike": ({"ratio": round(max(load)[0], 3), "frame": max(load)[1]} if load else None),
            "ratio_at_foot_strike": at(fs),
            "ratio_at_contact": at(ct),
        }
    out["note"] = ("Experimental proxy, not a finding: apparent width ÷ stance width. 1.0 = as in the stance. "
                   "Smaller or larger means the segment turned relative to the camera; the direction and angle "
                   "cannot be recovered from one view.")
    return out


# ── browser seek check ──────────────────────────────────────────────────────

def write_browser_check(video_path: str, manifest: dict, out_dir: str, indices: List[int]) -> Optional[dict]:
    """Reference frames from the ORIGINAL for the headless-browser seek check
    (scripts/swing-poc/browser-frame-check.ts)."""
    import cv2
    from .proxy import PIXEL_GAP, _blockdiff

    proxy_file = manifest["proxy"]["file"]
    n = len(manifest["frame_times_ms"])
    idx = sorted({i for i in indices if 0 < i < n - 1})
    if not idx:
        return None
    d = os.path.join(out_dir, "browser-check")
    os.makedirs(d, exist_ok=True)
    want = set()
    for i in idx:
        want |= {i - 1, i, i + 1}
    frames = {}
    for i, rgb in decode_frames(probe(video_path), want):
        frames[i] = cv2.resize(rgb, (320, 240), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(d, f"ref_{i:05d}.png"), cv2.cvtColor(frames[i], cv2.COLOR_RGB2BGR))
    checks = []
    for i in idx:
        gap = min(_blockdiff(frames[i].astype(np.float32), frames[j].astype(np.float32)) for j in (i - 1, i + 1))
        checks.append({"frame": i, "refs": {str(j): f"ref_{j:05d}.png" for j in (i - 1, i, i + 1)},
                       "informative": gap > PIXEL_GAP, "source_neighbour_gap": round(gap, 3)})
    shutil.copy(os.path.join(out_dir, proxy_file), os.path.join(d, proxy_file))
    m = {"video": proxy_file, "mime": manifest["proxy"]["mime"], "frame_times_ms": manifest["frame_times_ms"], "checks": checks}
    with open(os.path.join(d, "manifest.json"), "w") as f:
        json.dump(m, f)
    return m


def run_browser_check(out_dir: str) -> dict:
    script = os.path.join(REPO_ROOT, "scripts", "swing-poc", "browser-frame-check.ts")
    try:
        r = subprocess.run(["npx", "--yes", "tsx", script, os.path.join(out_dir, "browser-check")],
                           cwd=REPO_ROOT, capture_output=True, timeout=300)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return {"ran": False, "reason": f"could not run the browser check ({type(e).__name__})"}
    path = os.path.join(out_dir, "browser-check", "result.json")
    if not os.path.exists(path):
        return {"ran": False, "reason": (r.stderr or b"").decode(errors="replace")[-400:]}
    with open(path) as f:
        return {"ran": True, **json.load(f)}


# ── the run ─────────────────────────────────────────────────────────────────

def validate(video: str, model: str, contact_ms: float, handedness: str, view: str,
             capture_fps: Optional[float], foot_strike_ms: Optional[float], out_dir: Optional[str],
             codec: str = "h264", browser_check: bool = True, allow_unignored: bool = False) -> dict:
    from .analyze import analyze
    from .overlay import render
    from .proxy import prepare

    run_id = _dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    os.umask(0o077)  # every file and folder this run writes is owner-only
    out = ensure_private_dir(out_dir or os.path.join(DEFAULT_OUT, run_id), allow_unignored)
    timings = {}
    t0 = time.time()
    info = probe(video)
    facts = stream_facts(video)
    timings["probe_ms"] = round((time.time() - t0) * 1000)

    t = time.time()
    res = analyze(video, model, contact_ms=contact_ms, handedness=handedness, camera_view=view, capture_fps=capture_fps)
    timings["analysis_ms"] = round((time.time() - t) * 1000)
    with open(os.path.join(out, "result.json"), "w") as f:
        json.dump(res, f)
    if res.get("status") != "ok":
        summary = {"status": res.get("status"), "error": res.get("error"), "out": out}
        _write_report(out, video, info, facts, res, None, None, None, [], None, timings, contact_ms, foot_strike_ms,
                      capture_fps, handedness, view)
        return summary

    res_coach = None
    if foot_strike_ms is not None:
        t = time.time()
        res_coach = analyze(video, model, contact_ms=contact_ms, handedness=handedness, camera_view=view,
                            capture_fps=capture_fps, foot_strike_ms=foot_strike_ms)
        timings["analysis_coach_fs_ms"] = round((time.time() - t) * 1000)
        with open(os.path.join(out, "result-coach-fs.json"), "w") as f:
            json.dump(res_coach, f)

    ev = res["events"]
    key_frames = [x for x in [ev["contact"]["frame"], (ev.get("foot_strike") or {}).get("frame"),
                              ((res_coach or {}).get("events") or {}).get("foot_strike", {}).get("frame")] if x is not None]
    t = time.time()
    manifest = prepare(video, out, codec, extra_indices=key_frames)
    timings["playback_copy_ms"] = round((time.time() - t) * 1000)
    with open(os.path.join(out, "playback.json"), "w") as f:
        json.dump(manifest, f)

    t = time.time()
    shown = res_coach if res_coach and res_coach.get("status") == "ok" else res
    ov = render(shown, video, os.path.join(out, "overlay.mp4"), None)
    evidence = render_evidence(video, shown, os.path.join(out, "evidence"))
    timings["overlay_and_evidence_ms"] = round((time.time() - t) * 1000)

    browser = None
    if browser_check:
        # The browser check needs a codec open-source Chromium decodes.
        bdir = os.path.join(out, "_vp9")
        os.makedirs(bdir, exist_ok=True)
        t = time.time()
        vp9 = prepare(video, bdir, "vp9", extra_indices=key_frames)
        n = len(vp9["frame_times_ms"])
        idx = sorted(set(key_frames) | {int(x) for x in np.linspace(1, n - 2, num=min(6, max(n - 2, 0))).round()})
        if write_browser_check(video, vp9, bdir, idx):
            browser = run_browser_check(bdir)
            browser["copy_aligned"] = vp9["proxy"]["aligned"]
        timings["browser_check_ms"] = round((time.time() - t) * 1000)

    timings["total_ms"] = round((time.time() - t0) * 1000)
    proxies = width_proxies(shown)
    _write_report(out, video, info, facts, res, res_coach, manifest, ov, evidence, browser, timings, contact_ms,
                  foot_strike_ms, capture_fps, handedness, view, proxies)
    return {
        "status": "ok", "out": out,
        "frames_analysed": res["quality"]["analysed_frames"], "pose_frames": res["quality"]["pose_detected_frames"],
        "observed": [o["id"] for o in shown["observations"] if o["status"] == "observed"],
        "not_assessable": [o["id"] for o in shown["observations"] if o["status"] != "observed"],
        "playback_copy_aligned": manifest["proxy"]["aligned"],
        "browser_check": None if browser is None else (browser.get("all_match") if browser.get("ran") else "not run"),
        "timings_ms": timings,
    }


def _fmt_ms(x) -> str:
    return "—" if x is None else f"{x:.1f} ms"


def _write_report(out, video, info, facts, res, res_coach, manifest, ov, evidence, browser, timings, contact_ms,
                  foot_strike_ms, capture_fps, handedness, view, proxies=None) -> None:
    L: List[str] = []
    add = L.append
    add("# Real-swing validation report")
    add("")
    add("**PRIVATE — contains a child's image. Do not commit, upload, share or paste into chat. "
        "Delete this folder when the review is done.**")
    add("")
    add(f"- Run: {_dt.datetime.utcnow().isoformat(timespec='seconds')}Z · analyzer {__version__}")
    add(f"- Input: sha256 `{_sha256(video)[:16]}…` (file name deliberately not recorded)")
    add(f"- Coach inputs: contact {contact_ms} ms · handedness {handedness} · view {view} · "
        f"slow-motion export captured at {capture_fps} fps" if capture_fps else
        f"- Coach inputs: contact {contact_ms} ms · handedness {handedness} · view {view} · not an exported slow-motion clip")
    if foot_strike_ms is not None:
        add(f"- Coach foot strike: {foot_strike_ms} ms")
    add("")
    add("This checks the pipeline on real footage and lines its output up against a coach's eye. It validates no "
        "mechanic by itself; every number below is unvalidated and nothing is a rating.")

    add("")
    add("## 1. Video properties")
    add("")
    fi = info.interval_stats()
    rows = [
        ("Container / codec", f"{facts.get('container')} / {facts.get('codec')} ({facts.get('profile')}, tag {facts.get('codec_tag')})"),
        ("Pixel format / bit depth", f"{facts.get('pix_fmt')} / {facts.get('bits_per_raw_sample') or '—'}"),
        ("HDR", f"{'yes' if facts.get('hdr') else 'no'} (transfer {facts.get('color_transfer')})"),
        ("Stored size → displayed", f"{info.coded_width}×{info.coded_height} → {info.width}×{info.height} (rotation {info.rotation}°)"),
        ("Frames / duration", f"{info.frame_count} / {info.duration_s:.3f} s"),
        ("Frame interval min / median / max", f"{fi.get('min_ms')} / {fi.get('median_ms')} / {fi.get('max_ms')} ms"),
        ("Effective fps / variable frame rate", f"{fi.get('effective_fps')} / {'yes' if fi.get('variable_frame_rate') else 'no'}"),
        ("First-frame time in file", f"{facts.get('start_time_s')} s"),
        ("Audio streams", str(facts.get("audio_streams"))),
        ("Size", f"{info.size_bytes / 1e6:.1f} MB"),
    ]
    add("| Property | Value |")
    add("|---|---|")
    for k, v in rows:
        add(f"| {k} | {v} |")
    if res.get("time_model"):
        add("")
        add(f"Timing model: {res['time_model']['basis']}.")

    add("")
    add("## 2. Processing time")
    add("")
    add("| Step | Time |")
    add("|---|---|")
    for k, v in timings.items():
        add(f"| {k.replace('_ms', '').replace('_', ' ')} | {v / 1000:.1f} s |")
    if res.get("timing"):
        add(f"| inference per analysed frame | {res['timing'].get('inference_ms_per_frame')} ms |")

    if res.get("status") != "ok":
        add("")
        add(f"## Analysis failed: `{(res.get('error') or {}).get('code')}`")
        add("")
        add((res.get("error") or {}).get("message", ""))
        _flush(out, L)
        return

    q = res["quality"]
    add("")
    add("## 3. Pose coverage and landmark confidence")
    add("")
    add(f"- Analysed {q['analysed_frames']} frames ({res['sampling']['rule']}); a person was found in {q['pose_detected_frames']}.")
    add(f"- Frame flags: {json.dumps(q['flags'])}")
    for w in q["warnings"]:
        add(f"- ⚠ {w}")
    add("")
    add(f"| Joint | median visibility | usable, all frames | usable, ±50 ms of contact ({q.get('near_contact_frames')} frames) |")
    add("|---|---|---|---|")
    for name, c in (q.get("landmark_confidence") or {}).items():
        add(f"| {name.replace('_', ' ')} | {c['median_visibility']} | {c['usable_pct']}% | "
            f"{'—' if c['usable_pct_near_contact'] is None else str(c['usable_pct_near_contact']) + '%'} |")

    ev = res["events"]
    add("")
    add("## 4. Contact and foot strike")
    add("")
    times = np.array(info.frame_times) * 1000
    ci = ev["contact"]["frame"]
    add(f"- Contact (coach): asked {contact_ms} ms → frame {ci} at {times[ci]:.3f} ms "
        f"(offset {times[ci] - contact_ms:+.3f} ms; neighbouring frames at "
        f"{_fmt_ms(times[ci - 1] if ci > 0 else None)} and {_fmt_ms(times[ci + 1] if ci + 1 < len(times) else None)}).")
    fs = ev.get("foot_strike") or {}
    if fs.get("frame") is not None:
        add(f"- Foot strike (automatic estimate): frame {fs['frame']} at {fs['t_ms']:.1f} ms — {fs.get('method')}.")
    else:
        add(f"- Foot strike (automatic estimate): none — {fs.get('reason')}")
    if res_coach and res_coach.get("status") == "ok":
        cfs = res_coach["events"]["foot_strike"]
        add(f"- Foot strike (coach): frame {cfs['frame']} at {cfs['t_ms']:.1f} ms.")
        if fs.get("frame") is not None:
            scale = (res.get("time_model") or {}).get("time_scale") or 1.0
            add(f"- **Automatic vs coach: {fs['frame'] - cfs['frame']:+d} frames, "
                f"{(fs['t_ms'] - cfs['t_ms']) * scale:+.1f} ms real time.** Measurements below use the coach's mark.")
    stance = ev.get("stance")
    add(f"- Stance reference: {'frames ' + str(stance['start']['frame']) + '–' + str(stance['end']['frame']) if stance else 'not found'}.")
    if manifest:
        checks = {c["frame"]: c for c in manifest["proxy"].get("pixel_checks", [])}
        for label, k in (("contact", ci), ("automatic foot strike", fs.get("frame"))):
            if k is not None and k in checks:
                c = checks[k]
                add(f"- Playback copy at the {label} frame: {'shows the same frame' if c['matches'] else 'DOES NOT match'}"
                    f"{'' if c['informative'] else ' (frames around it too similar to tell apart — not informative)'}.")

    shown = res_coach if res_coach and res_coach.get("status") == "ok" else res
    add("")
    add("## 5. Measurements (the twelve mechanics)")
    add("")
    add("Units: body lengths = stance shoulder-to-ankle length in the image. Unvalidated. No good/bad cut-offs.")
    add("")
    obs = {o["id"]: o for o in shown["observations"]}
    add("| Phase | Mechanic | Classification | Result |")
    add("|---|---|---|---|")
    for m in C.MECHANICS:
        impl = m["implemented_as"]
        o = obs.get(impl["observation"]) if impl else None
        if m["classification"] != "measurable_now":
            r = "not assessable from one camera" if m["classification"] == "not_reliably_measurable" else "experimental — see §8, not a finding"
        elif o is None:
            r = "—"
        elif o["status"] != "observed":
            r = f"not assessable: {o['reason']}"
        else:
            vals = {v["name"]: v for v in o["values"]}
            parts = []
            for name in impl["values"]:
                if name in vals:
                    v = vals[name]
                    extra = f" (noise floor {v['noise_floor']}{', within it' if v.get('within_noise') else ''})" if "noise_floor" in v else ""
                    parts.append(f"{v['label']}: **{v['value']}**{extra}")
            r = "<br>".join(parts) + f"<br>input quality: {o['data_quality']}"
        add(f"| {m['group']} | {m['name']} | {C.CLASS_LABEL[m['classification']]} | {r} |")
    other = [v for o in shown["observations"] if o["status"] == "observed" for v in o["values"]
             if not any(v["name"] in (m["implemented_as"] or {}).get("values", []) for m in C.MECHANICS)]
    if other:
        add("")
        add("Also measured: " + "; ".join(f"{v['label']}: {v['value']}" for v in other) + ".")

    add("")
    add("## 6. Evidence frames and the landmarks behind each number")
    add("")
    for o in shown["observations"]:
        if o["status"] != "observed":
            continue
        add(f"### {o['label']}")
        add("")
        for e in o["evidence_frames"]:
            add(f"- **{e['label']}** — frame {e['frame']}, {e['t_ms']:.1f} ms")
            lms = ", ".join(f"{n.replace('_', ' ')} ({l['x_px']}, {l['y_px']}) vis {l['visibility']}{'' if l['usable'] else ' NOT USABLE'}"
                            for n, l in (e.get("landmarks") or {}).items())
            add(f"  - {lms}")
        add("")
    if evidence:
        add("Images: " + ", ".join(f"[{e['label']} f{e['frame']}]({e['file']})" for e in evidence))
    if ov:
        add("")
        add(f"Overlay video: [overlay.mp4](overlay.mp4) ({ov['frames_written']} frames; frame number and time burned in; "
            "a viewing aid — its playback rate is nominal, the burned-in times are the real ones).")

    add("")
    add("## 7. Not assessable")
    add("")
    for o in shown["observations"]:
        if o["status"] != "observed":
            add(f"- **{o['label']}** — {o['reason']}")
    for m in C.MECHANICS:
        if m["classification"] == "not_reliably_measurable":
            add(f"- **{m['name']}** — not reliably measurable from one camera (see mechanics-registry.md).")

    add("")
    add("## 8. Experimental diagnostics (not findings, never shown to a coach)")
    add("")
    if proxies:
        add(proxies["note"])
        add("")
        for seg in ("hips", "shoulders"):
            p = proxies.get(seg)
            add(f"- {seg}: " + ("not enough visible stance frames" if not p else json.dumps(p)))
        add("")
        add("Use: Pelvis Load / Upper Torso Load (ratio change before foot strike) and Pelvis / Upper Torso Direction at "
            "Contact (ratio at contact). Compare with what you see on the video; record agreement in §10.")
    else:
        add("Not computed (no stance reference).")
    hs = obs.get("hip_shoulder_separation") or {}
    if hs.get("feasibility"):
        add("")
        add(f"Hip–shoulder 3D-proxy scatter while still: {json.dumps(hs['feasibility'])}")

    add("")
    add("## 9. Playback and browsers")
    add("")
    if manifest:
        p = manifest["proxy"]
        add(f"- Playback copy ({p['codec']}): **{'aligned' if p['aligned'] else 'NOT aligned'}** — {p['proxy_frames']}/{p['source_frames']} frames, "
            f"timestamps within {p['max_time_error_ms']} ms, pixel checks {sum(1 for c in p['pixel_checks'] if c['matches'])}/{len(p['pixel_checks'])} "
            f"({p['informative_pixel_checks']} informative). Problems: {p['problems'] or 'none'}.")
    if browser is not None:
        if browser.get("ran"):
            add(f"- Headless Chromium seek check on a VP9 copy (the UI's seek rule, the browser's decoder): "
                f"**{'all frames match' if browser.get('all_match') else 'MISMATCH'}** — "
                + ", ".join(f"f{r['frame']}:{'ok' if r['matches'] else 'NO'}{'' if r['informative'] else '(n/i)'}" for r in browser.get("results", [])))
        else:
            add(f"- Headless browser check not run: {browser.get('reason')}")
    for n in browser_notes(facts):
        add(f"- {n}")
    add("- Not testable here, check by hand: iPhone Safari and Android Chrome on the review page — step frame by frame "
        "around contact and confirm the frame number matches the evidence stills above.")

    add("")
    add("## 10. Manual review sheet (fill in while watching)")
    add("")
    add("| # | Check | Analyzer says | Coach sees (frame / Y-N) | Notes |")
    add("|---|---|---|---|---|")
    rows = [
        ("Contact frame is the bat–ball contact", f"frame {ci}"),
        ("Foot strike frame is when the lead foot is planted", f"auto: {fs.get('frame', '—')}"
         + (f"; coach: {res_coach['events']['foot_strike']['frame']}" if res_coach and res_coach.get("status") == "ok" else "")),
        ("Stance frames: hitter is still, whole body visible", f"{stance['start']['frame']}–{stance['end']['frame']}" if stance else "none"),
        ("Skeleton on the overlay follows the body at contact (hands, lead foot)", "see overlay.mp4"),
        ("Hitter tracked throughout (not a coach/sibling)", f"multiple people flagged in {q['flags'].get('multiple_people', 0)} frames"),
    ]
    for o in shown["observations"]:
        if o["status"] == "observed":
            for v in o["values"]:
                rows.append((f"{v['label']} — plausible from the video?", str(v["value"])))
            for e in o["evidence_frames"]:
                rows.append((f"{o['label']}: '{e['label']}' frame shows that moment", f"frame {e['frame']}"))
    if proxies:
        for seg in ("hips", "shoulders"):
            p = proxies.get(seg) or {}
            if p.get("ratio_at_contact") is not None:
                rows.append((f"Experimental: {seg} look turned at contact vs stance?", f"width ratio {p['ratio_at_contact']}"))
    rows.append(("Same swing measured by another system (e.g. WIN Reality)? Record its values here — units differ, compare direction and order of magnitude only", "—"))
    for i, (check, says) in enumerate(rows, 1):
        add(f"| {i} | {check} | {says} | | |")
    _flush(out, L)


def _flush(out: str, lines: List[str]) -> None:
    with open(os.path.join(out, "report.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(os.path.join(out, "report.md"), 0o600)
