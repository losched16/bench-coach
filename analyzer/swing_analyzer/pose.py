"""Pose inference: a replaceable backend plus per-frame person selection.

The backend contract is deliberately small (`detect(rgb, timestamp_ms) ->
list of poses`) so MediaPipe can be swapped for a baseball-specific or
multi-view model without touching the mechanics code.

What MediaPipe gives us, stated plainly:
  * 33 body landmarks per person, in normalised image coordinates (x, y in
    0..1 of the displayed frame; z is a relative depth estimate, not metres);
  * "world" landmarks: the model's ESTIMATE of metric 3D positions relative to
    the hip centre, from a single camera. They are not calibrated motion
    capture, and axial rotation (pelvis / torso turning about the vertical)
    is the least reliable part of them;
  * visibility and presence scores per landmark.
It does not know what a baseball swing is and does not see the bat or ball.
"""

from __future__ import annotations

import hashlib
import os
from typing import List, Optional, Protocol

import numpy as np

# MediaPipe Pose landmark indices (the subset the mechanics use).
NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28
L_HEEL, R_HEEL = 29, 30
L_FOOT, R_FOOT = 31, 32

# The joints a swing view must contain for anything below to be measured.
CORE_JOINTS = [NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_ANKLE, R_ANKLE]

# Skeleton edges for rendering (same topology the UI draws).
CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
    (24, 26), (26, 28), (28, 30), (30, 32), (28, 32),
    (0, 11), (0, 12),
]

VISIBLE = 0.5  # visibility AND presence at or above this = usable


class PoseBackend(Protocol):
    name: str
    version: str

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> List[dict]:
        """Poses in the frame: [{'lm': (33,5) array x,y,z,vis,pres, 'world': (33,3)}]."""
        ...

    def close(self) -> None: ...


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class MediaPipeBackend:
    """MediaPipe Tasks Pose Landmarker, VIDEO running mode, CPU."""

    def __init__(self, model_path: str, num_poses: int = 2):
        import mediapipe as mp  # imported here so tests of pure code need no model
        from mediapipe.tasks.python import BaseOptions, vision

        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"Pose model not found at {model_path}. Run analyzer/scripts/fetch_model.sh."
            )
        self._mp = mp
        self.model_path = model_path
        self.model_sha256 = sha256_file(model_path)
        self.name = "mediapipe-pose-landmarker"
        self.version = f"mediapipe {mp.__version__}; model {os.path.basename(model_path)}"
        self.num_poses = num_poses
        opts = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path, delegate=BaseOptions.Delegate.CPU),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=num_poses,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._lm = vision.PoseLandmarker.create_from_options(opts)
        self._last_ts = -1

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> List[dict]:
        # VIDEO mode needs strictly increasing integer milliseconds. A 960 fps
        # file has frames ~1 ms apart, so the model timestamp is nudged forward
        # when two frames round to the same millisecond. The REAL frame time is
        # kept separately and is what everything downstream uses.
        ts = max(int(timestamp_ms), self._last_ts + 1)
        self._last_ts = ts
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        res = self._lm.detect_for_video(image, ts)
        poses = []
        for i, lms in enumerate(res.pose_landmarks or []):
            lm = np.array([[p.x, p.y, p.z, p.visibility or 0.0, p.presence or 0.0] for p in lms], dtype=np.float64)
            world = None
            if res.pose_world_landmarks and i < len(res.pose_world_landmarks):
                world = np.array([[p.x, p.y, p.z] for p in res.pose_world_landmarks[i]], dtype=np.float64)
            poses.append({"lm": lm, "world": world, "model_ts_ms": ts})
        return poses

    def close(self) -> None:
        try:
            self._lm.close()
        except Exception:
            pass


def joint_ok(lm: np.ndarray, j: int) -> bool:
    """Visible, present, and inside the frame (a joint the model placed off-picture is a guess)."""
    x, y, _, v, p = lm[j]
    return v >= VISIBLE and p >= VISIBLE and -0.02 <= x <= 1.02 and -0.02 <= y <= 1.02


def bbox_area(lm: np.ndarray) -> float:
    xs, ys = lm[:, 0], lm[:, 1]
    return float((xs.max() - xs.min()) * (ys.max() - ys.min()))


def hip_mid(lm: np.ndarray) -> np.ndarray:
    return (lm[L_HIP, :2] + lm[R_HIP, :2]) / 2.0


def select_person(poses: List[dict], previous: Optional[np.ndarray]) -> Optional[dict]:
    """Which detected person is the hitter.

    First frame: the largest person (the hitter is framed to fill the shot).
    After that: the person nearest the hitter's previous hip position, so a
    coach or sibling walking through does not steal the track.
    """
    if not poses:
        return None
    if previous is None:
        return max(poses, key=lambda p: bbox_area(p["lm"]))
    return min(poses, key=lambda p: float(np.linalg.norm(hip_mid(p["lm"]) - previous)))


def blur_score(rgb: np.ndarray) -> float:
    """Variance of the Laplacian on a downscaled grey frame — higher is sharper.

    Only meaningful RELATIVE to the same video's other frames (lighting, codec
    and resolution all move it), which is how quality.py uses it.
    """
    import cv2

    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    h, w = grey.shape
    scale = 480.0 / max(h, w)
    if scale < 1:
        grey = cv2.resize(grey, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())
