"""Analyzer tests.

    cd analyzer && python -m unittest discover -s tests -v

Pure tests always run. Tests that need the pose model and the fixtures skip
with a reason when either is missing (run scripts/fetch_model.sh and
`python -m swing_analyzer fixtures <pose.jpg> fixtures` first).
"""

import json
import os
import shutil
import tempfile
import time
import unittest

import numpy as np

from swing_analyzer import mechanics as M
from swing_analyzer import pose as P
from swing_analyzer.smoothing import despike
from swing_analyzer.video import AnalyzerError, nearest_frame, probe

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIX = os.path.join(ROOT, "fixtures")
MODEL = os.environ.get("SWING_POSE_MODEL", os.path.join(ROOT, "models", "pose_landmarker_full.task"))
HAVE_FIX = os.path.isfile(os.path.join(FIX, "truth.json"))
HAVE_MODEL = os.path.isfile(MODEL)


def truth():
    with open(os.path.join(FIX, "truth.json")) as f:
        return json.load(f)


# ── pure ────────────────────────────────────────────────────────────────────

class Smoothing(unittest.TestCase):
    def test_single_frame_spike_removed(self):
        s = np.array([[0, 0], [0, 0], [50, 0], [0, 0], [0, 0]], dtype=float)
        out = despike(s, scale=100)
        self.assertTrue(np.allclose(out[2], [0, 0]))

    def test_fast_continuous_motion_kept(self):
        # A hand moving 30 px per frame is a swing, not noise.
        s = np.array([[0, 0], [30, 0], [60, 0], [90, 0], [120, 0]], dtype=float)
        self.assertTrue(np.allclose(despike(s, scale=100), s))

    def test_gaps_are_not_filled(self):
        s = np.array([[0, 0], [np.nan, np.nan], [0, 0]], dtype=float)
        self.assertTrue(np.all(np.isnan(despike(s, scale=100)[1])))


def fake_track(view="face_on", hand="R", n=40, move=20.0, hide=None, fps=30.0, jitter=0.0, seed=1):
    """A synthetic hitter: feet 200 px apart, body length 300 px, everything slides `move` px from k=15..25."""
    px = np.zeros((n, 33, 2))
    ok = np.ones((n, 33), dtype=bool)
    base = {P.NOSE: (300, 100), P.L_SHOULDER: (290, 160), P.R_SHOULDER: (310, 160),
            P.L_HIP: (290, 300), P.R_HIP: (310, 300), P.L_ANKLE: (400, 460), P.R_ANKLE: (200, 460),
            P.L_HEEL: (395, 465), P.R_HEEL: (195, 465), P.L_FOOT: (410, 468), P.R_FOOT: (210, 468)}
    for k in range(n):
        dx = 0 if k <= 15 else move if k >= 25 else move * (k - 15) / 10
        for j, (x, y) in base.items():
            px[k, j] = (x + dx, y)
    if hide:
        for k in range(n):
            for j in hide:
                ok[k, j] = False
    if jitter:
        px += np.random.default_rng(seed).normal(0, jitter, px.shape)
    t = np.arange(n) * (1000.0 / fps)
    return M.Track(t_ms=t, src=np.arange(n), px=px, ok=ok, world=np.full((n, 33, 3), np.nan),
                   contact=35, handedness=hand, view=view)


class Registry(unittest.TestCase):
    def test_every_entry_is_unvalidated_or_experimental(self):
        for mid, m in M.REGISTRY.items():
            self.assertIn(m["validation_status"], M.ALLOWED_VALIDATION, mid)

    def test_registry_declares_the_required_fields(self):
        need = {"label", "definition", "required_landmarks", "camera_view", "event_window",
                "method", "unit", "evidence", "limitations", "validation_status", "drill_taxonomy"}
        for mid, m in M.REGISTRY.items():
            self.assertTrue(need <= set(m), f"{mid} missing {need - set(m)}")

    def test_measures_a_known_movement_in_body_lengths(self):
        res = M.observe(fake_track(move=30.0))
        lf = next(o for o in res["observations"] if o["id"] == "lead_foot_movement")
        self.assertEqual(lf["status"], "observed")
        body = np.linalg.norm(np.array([300, 160]) - np.array([300, 460]))  # 300 px
        disp = next(v for v in lf["values"] if v["name"] == "lead_foot_forward_displacement")["value"]
        self.assertAlmostEqual(disp, 30.0 / body, places=2)
        self.assertEqual(res["events"]["foot_strike"]["status"], "estimated")

    def test_direction_follows_handedness_not_the_screen(self):
        # Same picture, left-handed hitter: the lead foot is the other one, so
        # the same slide is movement AWAY from the pitcher.
        r = M.observe(fake_track(hand="L", move=30.0))
        fm = next(o for o in r["observations"] if o["id"] == "forward_move")
        self.assertLess(fm["values"][0]["value"], 0)

    def test_wrong_view_is_not_assessable_with_no_value(self):
        res = M.observe(fake_track(view="down_the_line"))
        for o in res["observations"]:
            self.assertEqual(o["status"], "not_assessable")
            self.assertEqual(o["values"], [])
            self.assertTrue(o["reason"])

    def test_missing_handedness_is_not_assessable(self):
        res = M.observe(fake_track(hand=None))
        for o in res["observations"][:2]:
            self.assertEqual(o["status"], "not_assessable")

    def test_hidden_feet_is_not_assessable(self):
        res = M.observe(fake_track(hide=[P.L_ANKLE, P.R_ANKLE]))
        self.assertEqual(res["observations"][0]["status"], "not_assessable")

    def test_hip_shoulder_is_never_reported_as_a_measurement(self):
        res = M.observe(fake_track())
        hs = next(o for o in res["observations"] if o["id"] == "hip_shoulder_separation")
        self.assertEqual(hs["status"], "not_assessable")
        self.assertEqual(hs["values"], [])
        self.assertEqual(hs["validation_status"], "experimental_feasibility")

    def test_no_ratings_or_thresholds_in_output(self):
        text = json.dumps(M.observe(fake_track())).lower()
        for word in ("score", "elite", "ideal", "excellent", "poor swing", "red", "yellow", "green", "grade"):
            self.assertNotIn(f'"{word}', text, word)
        self.assertNotIn("validated\"", text.replace("unvalidated\"", ""))

    def test_no_stride_reported_as_no_movement(self):
        res = M.observe(fake_track(move=0.0))
        self.assertEqual(res["events"]["foot_strike"]["status"], "no_movement_detected")

    def test_landmark_jitter_at_240fps_is_not_a_stride(self):
        # 1.5 px of jitter on a 300 px body, frames 4 ms apart: per-frame speed
        # would read ~1.5 body lengths a second. No stride must be reported.
        tr = fake_track(move=0.0, n=600, fps=240.0, jitter=1.5)
        tr.contact = 560
        self.assertEqual(M.observe(tr)["events"]["foot_strike"]["status"], "no_movement_detected")

    def test_load_and_swing_start_are_coach_tags_only(self):
        ev = M.observe(fake_track())["events"]
        self.assertIsNone(ev["load"]["frame"])
        self.assertIsNone(ev["swing_start"]["frame"])

    def test_nearest_frame_uses_time_not_index(self):
        times = [0.0, 0.0167, 0.0667, 0.0833, 0.1333]
        self.assertEqual(nearest_frame(times, 0.07), 2)


# ── video ───────────────────────────────────────────────────────────────────

@unittest.skipUnless(HAVE_FIX, "fixtures not built")
class Video(unittest.TestCase):
    def test_moving_properties(self):
        t = truth()
        info = probe(os.path.join(FIX, "moving.mp4"))
        self.assertEqual((info.width, info.height), (t["width"], t["height"]))
        self.assertEqual(info.frame_count, t["frames"])
        self.assertFalse(info.interval_stats()["variable_frame_rate"])

    def test_rotation_is_applied_for_display(self):
        info = probe(os.path.join(FIX, "rotated.mp4"))
        self.assertEqual(abs(info.rotation), 90)
        self.assertEqual((info.coded_width, info.coded_height), (truth()["height"], truth()["width"]))
        self.assertEqual((info.width, info.height), (truth()["width"], truth()["height"]))

    def test_vfr_frame_times_are_the_files_not_index_over_fps(self):
        info = probe(os.path.join(FIX, "vfr.mp4"))
        self.assertTrue(info.interval_stats()["variable_frame_rate"])
        for got, want in zip(info.frame_times, truth()["vfr_times_s"]):
            self.assertAlmostEqual(got, want, places=3)

    def test_corrupt_file_is_an_actionable_error(self):
        with self.assertRaises(AnalyzerError) as cm:
            probe(os.path.join(FIX, "corrupt.mp4"))
        self.assertEqual(cm.exception.code, "unsupported_format")

    def test_empty_file(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            with self.assertRaises(AnalyzerError) as cm:
                probe(f.name)
        self.assertEqual(cm.exception.code, "empty_file")

    def test_size_limit(self):
        import swing_analyzer.video as V
        old = V.MAX_BYTES
        V.MAX_BYTES = 1000
        try:
            with self.assertRaises(AnalyzerError) as cm:
                probe(os.path.join(FIX, "moving.mp4"))
            self.assertEqual(cm.exception.code, "too_large")
        finally:
            V.MAX_BYTES = old


# ── full pipeline (real model, real frames) ────────────────────────────────

@unittest.skipUnless(HAVE_FIX and HAVE_MODEL, "needs fixtures and the pose model")
class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from swing_analyzer.analyze import analyze
        cls.analyze = staticmethod(analyze)
        t = truth()
        cls.t = t
        cls.moving = analyze(os.path.join(FIX, "moving.mp4"), MODEL, contact_ms=t["contact_ms"], handedness="R", camera_view="face_on")

    def obs(self, res, mid):
        return next(o for o in res["observations"] if o["id"] == mid)

    def val(self, res, mid, name):
        return next(v["value"] for v in self.obs(res, mid)["values"] if v["name"] == name)

    def test_real_inference_on_every_frame(self):
        r = self.moving
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["quality"]["pose_detected_frames"], self.t["frames"])
        f = r["frames"][0]
        self.assertEqual(len(f["lm"]), 33)
        self.assertEqual(len(f["world"]), 33)
        self.assertTrue(r["model"]["file_sha256"])

    def test_known_slide_is_measured(self):
        r = self.moving
        L = r["body_reference"]["length_px"]
        want = self.t["shift_px"] / L
        got = self.val(r, "lead_foot_movement", "lead_foot_forward_displacement")
        self.assertAlmostEqual(got, want, delta=0.02 * max(want, 0.1) + 0.005)
        self.assertAlmostEqual(self.val(r, "forward_move", "head_forward_stance_to_contact"), want, delta=0.01)

    def test_foot_strike_lands_where_the_movement_stops(self):
        fs = self.moving["events"]["foot_strike"]
        self.assertEqual(fs["status"], "estimated")
        self.assertLessEqual(abs(fs["frame"] - self.t["move_end"]), 2)

    def test_contact_anchor_is_the_coach_mark(self):
        ev = self.moving["events"]["contact"]
        self.assertEqual(ev["frame"], self.t["contact_frame"])
        self.assertEqual(ev["source"], "coach")

    def test_landmarks_are_in_display_orientation(self):
        rot = self.analyze(os.path.join(FIX, "rotated.mp4"), MODEL, contact_ms=self.t["contact_ms"], handedness="R", camera_view="face_on")
        self.assertEqual(rot["status"], "ok")
        self.assertEqual(rot["source"]["rotation_deg"] in (90, -90), True)
        a = np.array(self.moving["frames"][0]["lm"])[:, :2]
        b = np.array(rot["frames"][0]["lm"])[:, :2]
        self.assertLess(float(np.max(np.abs(a - b))), 0.02)

    def test_vfr_contact_is_matched_by_time(self):
        vt = self.t["vfr_times_s"]
        r = self.analyze(os.path.join(FIX, "vfr.mp4"), MODEL, contact_ms=vt[51] * 1000, handedness="R", camera_view="face_on")
        self.assertEqual(r["inputs"]["contact_frame"], 51)
        for f in r["frames"]:
            self.assertAlmostEqual(f["t_ms"], vt[f["i"]] * 1000, places=1)

    def test_no_person_fails_honestly(self):
        r = self.analyze(os.path.join(FIX, "no_person.mp4"), MODEL, contact_ms=500, handedness="R", camera_view="face_on")
        self.assertEqual(r["status"], "failed")
        self.assertEqual(r["error"]["code"], "no_person")

    def test_partial_body_is_not_assessable(self):
        r = self.analyze(os.path.join(FIX, "partial.mp4"), MODEL, contact_ms=900, handedness="R", camera_view="face_on")
        self.assertEqual(r["status"], "ok")
        self.assertGreater(r["quality"]["flags"]["partial_body"], 0)
        for o in r["observations"]:
            self.assertEqual(o["status"], "not_assessable")

    def test_multiple_people_are_flagged(self):
        r = self.analyze(os.path.join(FIX, "two_people.mp4"), MODEL, contact_ms=900, handedness="R", camera_view="face_on")
        self.assertGreater(r["quality"]["flags"]["multiple_people"], 0)
        self.assertTrue(any("More than one person" in w for w in r["quality"]["warnings"]))

    def test_coach_foot_strike_overrides_the_estimate(self):
        fs_ms = (self.t["move_end"] + 2) * 1000 / self.t["fps"]
        r = self.analyze(os.path.join(FIX, "moving.mp4"), MODEL, contact_ms=self.t["contact_ms"], handedness="R",
                         camera_view="face_on", foot_strike_ms=fs_ms)
        self.assertEqual(r["events"]["foot_strike"]["source"], "coach")
        self.assertEqual(r["events"]["foot_strike"]["frame"], self.t["move_end"] + 2)
        lf = self.obs(r, "lead_foot_movement")
        self.assertTrue(any("coach-marked" in e["label"] for e in lf["evidence_frames"]))

    def test_foot_strike_after_contact_is_refused(self):
        r = self.analyze(os.path.join(FIX, "moving.mp4"), MODEL, contact_ms=self.t["contact_ms"], handedness="R",
                         camera_view="face_on", foot_strike_ms=self.t["contact_ms"] + 100)
        self.assertEqual(r["error"]["code"], "bad_input")

    def test_contact_outside_video_fails(self):
        r = self.analyze(os.path.join(FIX, "moving.mp4"), MODEL, contact_ms=99999, handedness="R", camera_view="face_on")
        self.assertEqual(r["error"]["code"], "contact_out_of_range")

    def test_contact_is_required(self):
        r = self.analyze(os.path.join(FIX, "moving.mp4"), MODEL, contact_ms=None)
        self.assertEqual(r["error"]["code"], "contact_required")


@unittest.skipUnless(HAVE_FIX and HAVE_MODEL, "needs fixtures and the pose model")
class Worker(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        for sub in ("queue", "processing", "captures"):
            os.makedirs(os.path.join(self.d, sub))

    def tearDown(self):
        shutil.rmtree(self.d)

    def enqueue(self, cap, video="moving.mp4", contact=None):
        cd = os.path.join(self.d, "captures", cap)
        os.makedirs(cd, exist_ok=True)
        if video:
            shutil.copy(os.path.join(FIX, video), os.path.join(cd, "video.mp4"))
        req = {"contact_ms": contact if contact is not None else truth()["contact_ms"], "handedness": "R", "camera_view": "face_on"}
        with open(os.path.join(self.d, "queue", f"{cap}.json"), "w") as f:
            json.dump(req, f)

    def test_job_runs_and_rerun_reuses_result(self):
        from swing_analyzer.worker import run, read_json
        self.enqueue("cap1")
        run(self.d, MODEL, once=True)
        job = read_json(os.path.join(self.d, "captures", "cap1", "job.json"))
        res = read_json(os.path.join(self.d, "captures", "cap1", "result.json"))
        self.assertEqual(job["state"], "done")
        self.assertEqual(res["status"], "ok")
        self.assertTrue(res["input_hash"])
        self.enqueue("cap1")
        t = time.time()
        run(self.d, MODEL, once=True)
        job = read_json(os.path.join(self.d, "captures", "cap1", "job.json"))
        self.assertTrue(job.get("reused_result"))
        self.assertLess(time.time() - t, 3)

    def test_missing_video_fails_cleanly(self):
        from swing_analyzer.worker import run, read_json
        self.enqueue("cap2", video=None)
        run(self.d, MODEL, once=True)
        job = read_json(os.path.join(self.d, "captures", "cap2", "job.json"))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error"]["code"], "missing_file")

    def test_bad_video_records_the_analyzer_error(self):
        from swing_analyzer.worker import run, read_json
        self.enqueue("cap3", video="corrupt.mp4")
        run(self.d, MODEL, once=True)
        job = read_json(os.path.join(self.d, "captures", "cap3", "job.json"))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error"]["code"], "unsupported_format")


if __name__ == "__main__":
    unittest.main()
