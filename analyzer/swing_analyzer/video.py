"""Video probing and decoding with frame-accurate timestamps.

Why ffprobe/ffmpeg rather than cv2.VideoCapture alone:

* Phone slow-motion files are frequently variable-frame-rate. A frame's time is
  its presentation timestamp, not index / fps. ffprobe reports the timestamp of
  every frame; the decoder emits frames in the same order with
  `-fps_mode passthrough` (no duplication, no dropping), so frame i of the
  decode is frame i of the probe.
* Phones record portrait video as landscape pixels plus a display-rotation
  flag. ffmpeg applies that rotation when decoding (as a browser <video> does),
  so landmark coordinates are in the orientation the coach sees. The rotation
  is still recorded as provenance.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
from dataclasses import dataclass, field
from typing import Iterator, List, Optional

import numpy as np

# Limits. A swing clip is a few seconds; anything far larger is the wrong file
# or a whole at-bat, and decoding it costs minutes of CPU for nothing.
MAX_BYTES = 300 * 1024 * 1024
MAX_DURATION_S = 60.0
MAX_PIXELS = 3840 * 2160
SUPPORTED_CODECS = {"h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "prores", "mjpeg"}


class AnalyzerError(Exception):
    """An actionable failure: `code` is stable, `message` is for a coach."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class VideoInfo:
    path: str
    size_bytes: int
    container: str
    codec: str
    coded_width: int
    coded_height: int
    rotation: int  # degrees, as stored (display matrix); 0 when none
    width: int  # as displayed, after rotation
    height: int
    avg_fps: Optional[float]
    r_fps: Optional[float]
    duration_s: float
    frame_times: List[float] = field(default_factory=list)  # seconds, per decoded frame

    @property
    def frame_count(self) -> int:
        return len(self.frame_times)

    def interval_stats(self) -> dict:
        dts = [b - a for a, b in zip(self.frame_times, self.frame_times[1:]) if b > a]
        if not dts:
            return {"min_ms": None, "median_ms": None, "max_ms": None, "variable_frame_rate": False}
        med = statistics.median(dts)
        vfr = (max(dts) - min(dts)) > 0.1 * med
        return {
            "min_ms": round(min(dts) * 1000, 3),
            "median_ms": round(med * 1000, 3),
            "max_ms": round(max(dts) * 1000, 3),
            "variable_frame_rate": vfr,
            "effective_fps": round(1.0 / med, 3) if med > 0 else None,
        }


def _run(cmd: List[str], timeout: float = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise AnalyzerError("decode_timeout", "Reading the video took too long. Try a shorter clip.")


def _ratio(s: Optional[str]) -> Optional[float]:
    if not s or s in ("0/0", "N/A"):
        return None
    if "/" in s:
        a, b = s.split("/", 1)
        try:
            return float(a) / float(b) if float(b) else None
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def probe(path: str) -> VideoInfo:
    if not os.path.isfile(path):
        raise AnalyzerError("missing_file", "The video file could not be found.")
    size = os.path.getsize(path)
    if size == 0:
        raise AnalyzerError("empty_file", "The video file is empty — the upload may have been interrupted.")
    if size > MAX_BYTES:
        raise AnalyzerError("too_large", f"The video is larger than {MAX_BYTES // (1024 * 1024)} MB. Trim it to the swing.")

    out = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", "-select_streams", "v:0", path,
    ])
    if out.returncode != 0:
        raise AnalyzerError("unsupported_format", "This file could not be read as a video.")
    meta = json.loads(out.stdout or b"{}")
    streams = meta.get("streams") or []
    if not streams:
        raise AnalyzerError("no_video_stream", "The file has no video track.")
    s = streams[0]
    codec = str(s.get("codec_name") or "")
    if codec not in SUPPORTED_CODECS:
        raise AnalyzerError("unsupported_codec", f"Video codec '{codec or 'unknown'}' is not supported. Export as MP4 (H.264/HEVC).")

    rotation = 0
    for sd in s.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                rotation = int(round(float(sd["rotation"])))
            except (TypeError, ValueError):
                pass
    if not rotation:
        tag = (s.get("tags") or {}).get("rotate")
        if tag:
            try:
                rotation = -int(tag)  # legacy tag is clockwise; side data is counter-clockwise
            except ValueError:
                pass
    rotation = ((rotation + 180) % 360) - 180  # normalise to (-180, 180]

    cw, ch = int(s.get("width") or 0), int(s.get("height") or 0)
    if cw <= 0 or ch <= 0:
        raise AnalyzerError("bad_dimensions", "The video has no usable picture size.")
    if cw * ch > MAX_PIXELS:
        raise AnalyzerError("too_high_resolution", "The video resolution is above 4K. Record at 1080p or 4K.")
    w, h = (ch, cw) if abs(rotation) == 90 else (cw, ch)

    duration = _ratio((meta.get("format") or {}).get("duration")) or _ratio(s.get("duration")) or 0.0
    if duration > MAX_DURATION_S:
        raise AnalyzerError("too_long", f"The clip is {duration:.0f}s long. Trim it to the swing (under {MAX_DURATION_S:.0f}s).")

    info = VideoInfo(
        path=path, size_bytes=size,
        container=str((meta.get("format") or {}).get("format_name") or ""),
        codec=codec, coded_width=cw, coded_height=ch, rotation=rotation,
        width=w, height=h,
        avg_fps=_ratio(s.get("avg_frame_rate")), r_fps=_ratio(s.get("r_frame_rate")),
        duration_s=float(duration),
    )
    info.frame_times = frame_times(path)
    if not info.frame_times:
        raise AnalyzerError("no_frames", "No frames could be read from the video.")
    return info


def frame_times(path: str) -> List[float]:
    """Presentation time of every frame, in decode order, zero-based."""
    out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "frame=best_effort_timestamp_time,pts_time",
        "-of", "csv=p=0", path,
    ], timeout=300)
    if out.returncode != 0:
        raise AnalyzerError("decode_failed", "The video's frames could not be read.")
    times: List[float] = []
    for line in out.stdout.decode("utf-8", "replace").splitlines():
        parts = [p for p in line.strip().split(",") if p and p != "N/A"]
        if not parts:
            continue
        try:
            times.append(float(parts[0]))
        except ValueError:
            continue
    if not times:
        return []
    t0 = times[0]
    return [round(t - t0, 6) for t in times]


def decode_frames(info: VideoInfo, keep: Optional[set] = None) -> Iterator[tuple]:
    """Yield (index, rgb ndarray HxWx3) for every frame (or the indices in `keep`).

    Every frame is decoded — skipping is done here, after decode, because
    seeking in a long-GOP phone video lands on keyframes, not on the frame
    asked for.
    """
    frame_bytes = info.width * info.height * 3
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", info.path, "-map", "0:v:0",
         "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    assert proc.stdout is not None
    i = 0
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            if keep is None or i in keep:
                yield i, np.frombuffer(buf, dtype=np.uint8).reshape(info.height, info.width, 3)
            i += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()
    if i == 0:
        raise AnalyzerError("decode_failed", "No frames could be decoded from the video.")
    info_decoded = i
    if info_decoded != info.frame_count:
        # Keep going with what we have, but say so: timestamps past the decoded
        # count would otherwise point at frames that never reached the model.
        info.frame_times = info.frame_times[:info_decoded]


def nearest_frame(times: List[float], t_s: float) -> int:
    """Index of the frame whose presentation time is nearest `t_s`."""
    arr = np.asarray(times)
    return int(np.argmin(np.abs(arr - t_s)))
