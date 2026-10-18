"""Browser playback copy, with its frame alignment proved.

Why a copy: phones record HEVC (often 10-bit, often in a .mov), which Chrome
and Firefox frequently cannot play, and phone files can start at a non-zero
timestamp or carry an edit list, which browsers and FFmpeg do not always
interpret the same way. Either problem breaks the coach's contact mark: the
frame they see would not be the frame the analyzer measured.

The copy keeps every source frame, in order, with the same timestamps measured
from the first frame (`setpts=PTS-STARTPTS`, passthrough frame timing), in a
codec browsers decode, with display rotation applied. Then it is CHECKED, not
trusted:

  * timestamps: same frame count, and every frame time within the container's
    rounding (≤1 ms) of the source's;
  * pixels: sampled frames of the copy are compared with the same frames of the
    source, and must match their own frame better than the neighbours — so an
    off-by-one shift is caught even when timestamps look right.

Analysis always runs on the ORIGINAL file; the copy is only for playback.
"""

from __future__ import annotations

import os
import subprocess
import time
from typing import List, Optional

import numpy as np

from .video import AnalyzerError, VideoInfo, decode_frames, probe

CODECS = {
    # H.264 MP4: plays in Chrome, Edge, Safari and Firefox on every platform.
    "h264": {"ext": "mp4", "mime": "video/mp4",
             "args": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                      "-movflags", "+faststart", "-video_track_timescale", "90000"]},
    # VP9 WebM: for open-source Chromium (automated tests), which lacks H.264.
    "vp9": {"ext": "webm", "mime": "video/webm",
            "args": ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "realtime",
                     "-cpu-used", "8", "-pix_fmt", "yuv420p"]},
}
MAX_TIME_ERROR_MS = 1.0
# Neighbouring source frames must differ by more than this (block mean, 0-255)
# for a pixel check to be able to see a one-frame shift.
PIXEL_GAP = 12.0


def make_proxy(src: str, out_dir: str, codec: str = "h264") -> str:
    if codec not in CODECS:
        raise ValueError(f"unknown proxy codec {codec}")
    c = CODECS[codec]
    out = os.path.join(out_dir, f"playback.{c['ext']}")
    tmp = os.path.join(out_dir, f".playback-{os.getpid()}.{c['ext']}")
    # Keyframe every ~0.25 s keeps scrubbing responsive on long-GOP sources.
    info = probe(src)
    fps = info.interval_stats().get("effective_fps") or 30
    gop = max(4, int(round(fps / 4)))
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", src, "-map", "0:v:0", "-an", "-sn", "-dn",
           "-vf", "setpts=PTS-STARTPTS,format=yuv420p", "-fps_mode", "passthrough",
           "-g", str(gop), *c["args"], tmp]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=900)
    except subprocess.TimeoutExpired:
        _rm(tmp)
        raise AnalyzerError("proxy_timeout", "Preparing the video for playback took too long.")
    if proc.returncode != 0 or not os.path.exists(tmp):
        _rm(tmp)
        raise AnalyzerError("proxy_failed", "The video could not be prepared for playback.")
    os.replace(tmp, out)
    return out


def _rm(p: str) -> None:
    try:
        os.remove(p)
    except FileNotFoundError:
        pass


def _sample_indices(n: int, k: int = 9) -> List[int]:
    if n <= 2:
        return list(range(n))
    idx = np.linspace(1, n - 2, num=min(k, n - 2)).round().astype(int)
    return sorted(set(int(i) for i in idx))


def _frames(info: VideoInfo, idx: set, size=(320, 240)) -> dict:
    import cv2
    out = {}
    for i, rgb in decode_frames(info, idx):
        out[i] = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA).astype(np.float32)
    return out


def _blockdiff(a: np.ndarray, b: np.ndarray, block: int = 8) -> float:
    """Largest mean difference over any 8×8 block. Re-encoding noise is spread
    thinly; a frame from the wrong moment differs strongly somewhere (whatever
    moved), which a whole-frame mean would dilute away."""
    d = np.abs(a - b).mean(axis=2)
    h, w = (d.shape[0] // block) * block, (d.shape[1] // block) * block
    blocks = d[:h, :w].reshape(h // block, block, w // block, block).mean(axis=(1, 3))
    return float(blocks.max())


def verify_proxy(src_info: VideoInfo, proxy_path: str, extra_indices=()) -> dict:
    """Prove the playback copy shows frame i at the time the analyzer calls frame i."""
    px = probe(proxy_path)
    report: dict = {
        "source_frames": src_info.frame_count, "proxy_frames": px.frame_count,
        "proxy_size": [px.width, px.height], "source_size": [src_info.width, src_info.height],
    }
    problems = []
    if px.frame_count != src_info.frame_count:
        problems.append(f"frame count differs ({px.frame_count} vs {src_info.frame_count})")
    n = min(px.frame_count, src_info.frame_count)
    errs = [abs(a - b) * 1000 for a, b in zip(src_info.frame_times[:n], px.frame_times[:n])]
    report["max_time_error_ms"] = round(max(errs), 4) if errs else None
    if errs and max(errs) > MAX_TIME_ERROR_MS:
        problems.append(f"timestamps drift by up to {max(errs):.2f} ms")
    if (px.width, px.height) != (src_info.width, src_info.height):
        problems.append("picture size/orientation differs")

    # Pixel check: each sampled proxy frame must match its own source frame
    # better than the source frames either side.
    # Evenly spaced frames, plus any the caller names (the contact and
    # foot-strike frames: the ones a coach's marks depend on).
    sample = sorted(set(_sample_indices(n)) | {int(i) for i in extra_indices if 0 < int(i) < n - 1})
    want = set()
    for i in sample:
        want.update({i - 1, i, i + 1})
    src_f = _frames(src_info, {i for i in want if 0 <= i < n})
    prx_f = _frames(px, set(sample))
    checks = []
    for i in sample:
        if i not in prx_f or i not in src_f:
            continue
        d = {j: _blockdiff(prx_f[i], src_f[j]) for j in (i - 1, i, i + 1) if j in src_f}
        own = d[i]
        others = {j: v for j, v in d.items() if j != i}
        # Informative only if the SOURCE frames around i are visibly different
        # from frame i (otherwise a shift could not be seen). Judged on the
        # source alone, so a shifted copy cannot make itself uninformative.
        src_gap = min((_blockdiff(src_f[i], src_f[j]) for j in others), default=0.0)
        informative = src_gap > PIXEL_GAP
        matches = (own < min(others.values())) if informative else True
        checks.append({"frame": i, "diff_own": round(own, 3),
                       "diff_neighbours": {str(j): round(v, 3) for j, v in others.items()},
                       "source_neighbour_gap": round(src_gap, 3),
                       "matches": matches, "informative": informative})
    report["pixel_checks"] = checks
    bad = [c for c in checks if not c["matches"]]
    if bad:
        problems.append(f"{len(bad)} sampled frame(s) match a neighbouring frame better than their own")
    report["informative_pixel_checks"] = sum(1 for c in checks if c["informative"])
    report["aligned"] = not problems
    report["problems"] = problems
    return report


def prepare(src: str, out_dir: str, codec: str = "h264", extra_indices=()) -> dict:
    """Probe, make the playback copy, verify it. Returns the playback manifest."""
    t = time.time()
    info = probe(src)
    proxy = make_proxy(src, out_dir, codec)
    check = verify_proxy(info, proxy, extra_indices)
    return {
        "frame_times_ms": [round(x * 1000, 3) for x in info.frame_times],
        "source": {"codec": info.codec, "container": info.container, "width": info.width, "height": info.height,
                   "rotation_deg": info.rotation, "frame_count": info.frame_count,
                   "frame_intervals": info.interval_stats()},
        "proxy": {"file": os.path.basename(proxy), "codec": codec, "mime": CODECS[codec]["mime"], **check},
        "prepare_ms": round((time.time() - t) * 1000),
    }
