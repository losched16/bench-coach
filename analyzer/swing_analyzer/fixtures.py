"""Non-sensitive test fixtures built from MediaPipe's public test image.

The source is `pose.jpg` from MediaPipe's own test assets
(https://storage.googleapis.com/mediapipe-assets/pose.jpg): one adult, full
body, side-on, wide stance. It is NOT a baseball swing and nothing here
validates swing mechanics. What these fixtures can prove is plumbing, against
ground truth we control:

  moving.webm    the same frames as VP9/WebM (for browsers without H.264).
  moving.mp4     30 fps, the whole picture slides a known number of pixels
                 between two known frames — so "forward move" and "lead-foot
                 movement" have an exact expected value.
  vfr.mp4        the same frames with irregular, known presentation times.
  rotated.mp4    moving.mp4 stored landscape with a 90° display-rotation flag,
                 as a phone stores a portrait clip.
  two_people.mp4 two copies of the person side by side.
  partial.mp4    the top 55% of the picture — no legs or feet.
  no_person.mp4  an image with no people in it (sky region of the source).
  corrupt.mp4    random bytes with a video extension.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile

import numpy as np

FPS = 30
N_FRAMES = 60          # 2.0 s
MOVE_START, MOVE_END = 20, 35  # frames over which the picture slides
SHIFT_PX = 48          # total slide, in output pixels, positive = to the right
OUT_W, OUT_H = 640, 428
CONTACT_FRAME = 50


def _load(src: str) -> np.ndarray:
    import cv2
    img = cv2.imread(src)
    if img is None:
        raise SystemExit(f"cannot read {src}")
    return cv2.cvtColor(cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)


def shift_at(k: int) -> float:
    if k <= MOVE_START:
        return 0.0
    if k >= MOVE_END:
        return float(SHIFT_PX)
    return SHIFT_PX * (k - MOVE_START) / (MOVE_END - MOVE_START)


def _canvas(img: np.ndarray, dx: float) -> np.ndarray:
    import cv2
    m = np.float32([[1, 0, dx], [0, 1, 0]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REPLICATE)


def _encode(frames, out: str, times=None) -> None:
    """Encode RGB frames to H.264 MP4. With `times`, write those exact PTS (VFR)."""
    with tempfile.TemporaryDirectory() as d:
        import cv2
        for k, f in enumerate(frames):
            cv2.imwrite(os.path.join(d, f"{k:05d}.png"), cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
        if times is None:
            cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(d, "%05d.png"),
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15", out]
        else:
            lst = os.path.join(d, "list.txt")
            with open(lst, "w") as fh:
                for k in range(len(frames)):
                    fh.write(f"file '{os.path.join(d, f'{k:05d}.png')}'\n")
                    dur = (times[k + 1] - times[k]) if k + 1 < len(times) else (times[k] - times[k - 1])
                    fh.write(f"duration {dur:.6f}\n")
                fh.write(f"file '{os.path.join(d, f'{len(frames) - 1:05d}.png')}'\n")
            cmd = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                   "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-video_track_timescale", "90000", out]
        subprocess.run(cmd, check=True)


def vfr_times() -> list:
    """Irregular but increasing times: every odd frame is pulled 1/60 s earlier,
    so the gaps alternate 1/60 s and 1/20 s (a real VFR pattern, not a constant rate)."""
    return [round(k / FPS - (k % 2) / 60.0, 6) for k in range(N_FRAMES)]


def _make_vfr(src_mp4: str, out: str) -> None:
    # The encoder time base must be fine enough to hold the new timestamps,
    # and passthrough stops ffmpeg resampling them back to a constant rate.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src_mp4,
                    "-vf", "setpts='if(mod(N,2),PTS-(1/60)/TB,PTS)'",
                    "-enc_time_base", "1/600", "-fps_mode", "passthrough",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-video_track_timescale", "600", out], check=True)


def build(src: str, outdir: str) -> dict:
    os.makedirs(outdir, exist_ok=True)
    img = _load(src)
    frames = [_canvas(img, shift_at(k)) for k in range(N_FRAMES)]
    _encode(frames, os.path.join(outdir, "moving.mp4"))
    vt = vfr_times()
    _make_vfr(os.path.join(outdir, "moving.mp4"), os.path.join(outdir, "vfr.mp4"))
    # The same frames as VP9/WebM: open-source Chromium (the automated browser
    # test) cannot decode H.264, so the browser proof plays this copy.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(outdir, "moving.mp4"), "-c:v", "libvpx-vp9",
                    "-b:v", "0", "-crf", "30", "-row-mt", "1", os.path.join(outdir, "moving.webm")], check=True)
    # Rotated: store the frames rotated 90° clockwise with a display matrix that
    # rotates them back, exactly as a phone stores a portrait recording.
    rot_frames = [np.ascontiguousarray(np.rot90(f, k=-1)) for f in frames]
    tmp = os.path.join(outdir, "_rot_raw.mp4")
    _encode(rot_frames, tmp)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-display_rotation", "90", "-i", tmp, "-c", "copy",
                    os.path.join(outdir, "rotated.mp4")], check=True)
    os.remove(tmp)
    half = _load(src)[:, OUT_W // 4: OUT_W * 3 // 4]
    pair = np.concatenate([half, half], axis=1)
    _encode([pair] * 30, os.path.join(outdir, "two_people.mp4"))
    partial = img[: int(OUT_H * 0.55)]
    partial = np.ascontiguousarray(partial[: partial.shape[0] // 2 * 2])
    _encode([partial] * 30, os.path.join(outdir, "partial.mp4"))
    sky = np.ascontiguousarray(img[: OUT_H // 3, : OUT_W // 3])
    sky = np.ascontiguousarray(sky[: sky.shape[0] // 2 * 2, : sky.shape[1] // 2 * 2])
    _encode([sky] * 30, os.path.join(outdir, "no_person.mp4"))
    with open(os.path.join(outdir, "corrupt.mp4"), "wb") as f:
        f.write(np.random.default_rng(7).bytes(4096))
    truth = {
        "source_image": "https://storage.googleapis.com/mediapipe-assets/pose.jpg",
        "fps": FPS, "frames": N_FRAMES, "width": OUT_W, "height": OUT_H,
        "shift_px": SHIFT_PX, "move_start": MOVE_START, "move_end": MOVE_END,
        "contact_frame": CONTACT_FRAME, "contact_ms": CONTACT_FRAME * 1000 / FPS,
        "vfr_times_s": vt,
        "note": "Synthetic plumbing fixtures. Not a swing; validates nothing about mechanics.",
    }
    with open(os.path.join(outdir, "truth.json"), "w") as f:
        json.dump(truth, f, indent=1)
    return truth
