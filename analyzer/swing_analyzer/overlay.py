"""Draw the analyzer's landmarks back onto the source video (proof artifact).

Uses the stored result JSON and the original file — the same data the review
UI draws — so a misaligned frame here is a misaligned frame there.
"""

from __future__ import annotations

import subprocess

import numpy as np

from .pose import CONNECTIONS, VISIBLE
from .video import decode_frames, probe


def render(result: dict, video_path: str, out_path: str, still_dir: str = None) -> dict:
    import cv2

    info = probe(video_path)
    by_i = {f["i"]: f for f in result.get("frames", [])}
    W, H = info.width, info.height
    events = result.get("events") or {}
    marks = {}
    for name in ("contact", "foot_strike"):
        e = events.get(name) or {}
        if e.get("frame") is not None:
            marks[e["frame"]] = name.replace("_", " ")
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(round(info.avg_fps or 30, 3)), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", out_path],
        stdin=subprocess.PIPE,
    )
    stills = []
    written = 0
    for i, rgb in decode_frames(info, set(by_i)):
        img = rgb.copy()
        fr = by_i[i]
        lm = fr.get("lm")
        if lm:
            pts = [(int(x * W), int(y * H)) if (v >= VISIBLE and p >= VISIBLE) else None for x, y, _, v, p in lm]
            for a, b in CONNECTIONS:
                if pts[a] and pts[b]:
                    cv2.line(img, pts[a], pts[b], (0, 255, 120), 2, cv2.LINE_AA)
            for q in pts:
                if q:
                    cv2.circle(img, q, 3, (255, 60, 60), -1, cv2.LINE_AA)
        label = f"frame {i}  t={fr['t_ms']:.1f} ms" + ("  [" + ", ".join(fr["flags"]) + "]" if fr["flags"] else "")
        cv2.putText(img, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        if i in marks:
            cv2.putText(img, marks[i].upper(), (8, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 220, 0), 2, cv2.LINE_AA)
            if still_dir:
                p = f"{still_dir}/frame_{i:05d}_{marks[i].replace(' ', '_')}.png"
                cv2.imwrite(p, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
                stills.append(p)
        proc.stdin.write(np.ascontiguousarray(img).tobytes())
        written += 1
    proc.stdin.close()
    proc.wait()
    return {"frames_written": written, "out": out_path, "stills": stills}
