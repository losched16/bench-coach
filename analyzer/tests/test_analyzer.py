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

    def test_negative_move_known_backward_slide(self):
        nm_t = self.t["negative_move"]
        r = self.analyze(os.path.join(FIX, "negative_move.mp4"), MODEL, contact_ms=self.t["contact_ms"], handedness="R", camera_view="face_on")
        L = r["body_reference"]["length_px"]
        o = self.obs(r, "negative_move")
        self.assertEqual(o["status"], "observed")
        want = nm_t["back_px"] / L
        pel = next(v for v in o["values"] if v["name"] == "pelvis_back_move")
        self.assertAlmostEqual(pel["value"], want, delta=0.01)
        self.assertFalse(pel["within_noise"])
        self.assertAlmostEqual(self.val(r, "negative_move", "head_back_move"), want, delta=0.01)
        back = next(e for e in o["evidence_frames"] if e["label"] == "furthest back")
        self.assertTrue(nm_t["back_end"] - 1 <= back["frame"] <= self.t["move_start"] + 1, back["frame"])
        self.assertIn("left_hip", back["landmarks"])
        # The stride is still measured from the stance, not from the furthest-back point.
        self.assertAlmostEqual(self.val(r, "lead_foot_movement", "lead_foot_forward_displacement"), nm_t["forward_px"] / L, delta=0.01)

    def test_no_backward_move_reads_as_none_within_noise(self):
        o = self.obs(self.moving, "negative_move")
        pel = next(v for v in o["values"] if v["name"] == "pelvis_back_move")
        # A still synthetic stance has ~zero scatter, so the noise floor is ~0
        # here; on real video it is the stance jitter. No floor is invented.
        self.assertLessEqual(pel["value"], 0.005)
        self.assertIn("noise_floor", pel)

    def test_every_observed_value_cites_evidence_landmarks(self):
        for o in self.moving["observations"]:
            if o["status"] != "observed":
                self.assertEqual(o["values"], [])
                continue
            self.assertTrue(o["evidence_frames"], o["id"])
            for e in o["evidence_frames"]:
                self.assertTrue(e["landmarks"], (o["id"], e["label"]))
                for lm in e["landmarks"].values():
                    self.assertIn("visibility", lm)
                    self.assertIn("usable", lm)

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


# ── phone formats, playback copy, slow motion (build with `fixtures … --phone`) ──

PHONE = os.path.join(FIX, "phone_truth.json")
HAVE_PHONE = os.path.isfile(PHONE)


def phone_truth():
    with open(PHONE) as f:
        return json.load(f)


@unittest.skipUnless(HAVE_PHONE, "phone fixtures not built")
class PhoneFormats(unittest.TestCase):
    def test_probe_matches_truth(self):
        for name, t in phone_truth().items():
            info = probe(os.path.join(FIX, name))
            self.assertEqual(info.codec, t["codec"], name)
            self.assertEqual(info.frame_count, t["frames"], name)
            self.assertEqual((info.width, info.height), (t["width"], t["height"]), f"{name}: displayed size after rotation")
            self.assertEqual(info.frame_times[0], 0.0, f"{name}: times are measured from the first frame")
            if t.get("rotation_abs"):
                self.assertEqual(abs(info.rotation), t["rotation_abs"], name)
            if t.get("vfr"):
                self.assertTrue(info.interval_stats()["variable_frame_rate"], name)

    def test_contact_frame_is_found_by_time(self):
        for name, t in phone_truth().items():
            info = probe(os.path.join(FIX, name))
            self.assertEqual(nearest_frame(info.frame_times, t["contact_ms"] / 1000), t["contact_frame"], name)

    def test_playback_copy_keeps_every_frame_at_its_time(self):
        from swing_analyzer.proxy import prepare
        for name in phone_truth():
            for codec in ("h264", "vp9"):
                d = tempfile.mkdtemp()
                try:
                    m = prepare(os.path.join(FIX, name), d, codec)
                    p = m["proxy"]
                    self.assertTrue(p["aligned"], f"{name}/{codec}: {p['problems']}")
                    self.assertEqual(p["proxy_frames"], p["source_frames"])
                    self.assertLessEqual(p["max_time_error_ms"], 1.0)
                    self.assertGreaterEqual(p["informative_pixel_checks"], 5, f"{name}/{codec}: pixel check must be able to see a shift")
                    self.assertEqual(p["proxy_size"], [phone_truth()[name]["width"], phone_truth()[name]["height"]])
                finally:
                    shutil.rmtree(d)

    def test_a_copy_shifted_by_one_frame_is_caught(self):
        import subprocess
        from swing_analyzer.proxy import verify_proxy
        src = os.path.join(FIX, "android_h264_60_rot270.mp4")
        d = tempfile.mkdtemp()
        try:
            bad = os.path.join(d, "shifted.mp4")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf",
                            "tpad=start=1:start_mode=clone,trim=end_frame=120,setpts=N/60/TB",
                            "-fps_mode", "passthrough", "-enc_time_base", "1/600", "-c:v", "libx264",
                            "-pix_fmt", "yuv420p", "-video_track_timescale", "600", bad], check=True)
            r = verify_proxy(probe(src), bad)
            self.assertEqual(r["max_time_error_ms"], 0.0)  # timestamps alone cannot see it…
            self.assertFalse(r["aligned"])                  # …the pixel check does
        finally:
            shutil.rmtree(d)


@unittest.skipUnless(HAVE_PHONE and HAVE_MODEL, "phone fixtures and model needed")
class PhoneAnalysis(unittest.TestCase):
    def run_one(self, name, **kw):
        from swing_analyzer.analyze import analyze
        t = phone_truth()[name]
        return t, analyze(os.path.join(FIX, name), MODEL, contact_ms=t["contact_ms"], handedness="R", camera_view="face_on", **kw)

    def stride(self, r):
        lf = next(o for o in r["observations"] if o["id"] == "lead_foot_movement")
        return next(v["value"] for v in lf["values"] if v["name"] == "lead_foot_forward_displacement")

    def test_hevc_10bit_portrait_iphone_style(self):
        t, r = self.run_one("iphone_hevc10_240.mov")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["inputs"]["contact_frame"], t["contact_frame"])
        self.assertEqual(r["quality"]["pose_detected_frames"], r["quality"]["analysed_frames"])
        L = r["body_reference"]["length_px"]
        self.assertAlmostEqual(self.stride(r), 48 / L, delta=0.02)

    def test_exported_slow_motion_needs_its_capture_rate(self):
        t, r = self.run_one("slomo_export_30.mp4", capture_fps=240)
        self.assertAlmostEqual(r["time_model"]["time_scale"], 0.125, places=3)
        L = r["body_reference"]["length_px"]
        self.assertAlmostEqual(self.stride(r), 48 / L, delta=0.02)
        _, r2 = self.run_one("slomo_export_30.mp4")
        self.assertTrue(any("slow-motion" in w for w in r2["quality"]["warnings"]),
                        "without the capture rate the clip must carry a warning, not silently pass")

    def test_evidence_names_the_landmarks_used(self):
        _, r = self.run_one("android_h264_60_rot270.mp4")
        lf = next(o for o in r["observations"] if o["id"] == "lead_foot_movement")
        for e in lf["evidence_frames"]:
            self.assertIn("left_ankle", e["landmarks"])  # right-handed hitter: lead = left
            self.assertIsNotNone(e["landmarks"]["left_ankle"]["visibility"])
        lc = r["quality"]["landmark_confidence"]
        self.assertIn("usable_pct_near_contact", lc["left_ankle"])


@unittest.skipUnless(HAVE_FIX and HAVE_MODEL, "needs fixtures and the pose model")
class WorkerReliability(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        for sub in ("queue", "processing", "captures"):
            os.makedirs(os.path.join(self.d, sub))

    def tearDown(self):
        shutil.rmtree(self.d)

    def test_timeout_kills_the_whole_job(self):
        import swing_analyzer.worker as W
        cd = os.path.join(self.d, "captures", "slow")
        os.makedirs(cd)
        shutil.copy(os.path.join(FIX, "moving.mp4"), os.path.join(cd, "video.mp4"))
        with open(os.path.join(self.d, "queue", "slow.json"), "w") as f:
            json.dump({"contact_ms": truth()["contact_ms"], "handedness": "R", "camera_view": "face_on"}, f)
        old = W.JOB_TIMEOUT_S
        W.JOB_TIMEOUT_S = 0.3
        try:
            W.run(self.d, MODEL, once=True)
        finally:
            W.JOB_TIMEOUT_S = old
        job = W.read_json(os.path.join(cd, "job.json"))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error"]["code"], "timeout")
        self.assertFalse([n for n in os.listdir(cd) if ".tmp" in n], "no temp files left behind")
        self.assertEqual(os.listdir(os.path.join(self.d, "processing")), [])

    def test_prepare_job_makes_a_verified_copy(self):
        import swing_analyzer.worker as W
        cd = os.path.join(self.d, "captures", "prep")
        os.makedirs(cd)
        shutil.copy(os.path.join(FIX, "rotated.mp4"), os.path.join(cd, "video.mp4"))
        open(os.path.join(self.d, "queue", "prep.prepare.json"), "w").write("{}")
        os.environ["SWING_POC_PROXY_CODEC"] = "vp9"
        try:
            W.run(self.d, MODEL, once=True)
        finally:
            os.environ.pop("SWING_POC_PROXY_CODEC", None)
        st = W.read_json(os.path.join(cd, "prepare.json"))
        self.assertEqual(st["state"], "done")
        self.assertTrue(st["aligned"])
        man = W.read_json(os.path.join(cd, "playback.json"))
        self.assertEqual(len(man["frame_times_ms"]), truth()["frames"])
        self.assertTrue(os.path.exists(os.path.join(cd, "playback.webm")))

    def test_purge_removes_old_captures_and_their_queue_entries(self):
        import swing_analyzer.worker as W
        cd = os.path.join(self.d, "captures", "old")
        os.makedirs(cd)
        open(os.path.join(cd, "meta.json"), "w").write("{}")
        open(os.path.join(self.d, "queue", "old.prepare.json"), "w").write("{}")
        past = time.time() - 40 * 86400
        os.utime(os.path.join(cd, "meta.json"), (past, past))
        self.assertEqual(W.purge(self.d, 30), 1)
        self.assertFalse(os.path.exists(cd))
        self.assertFalse(os.path.exists(os.path.join(self.d, "queue", "old.prepare.json")))


# ── the 12-mechanic registry ────────────────────────────────────────────────

class MechanicsCatalog(unittest.TestCase):
    REPO = os.path.dirname(ROOT)

    def setUp(self):
        from swing_analyzer import catalog as C
        self.C = C

    def test_twelve_mechanics_in_four_groups(self):
        names = [m["name"] for m in self.C.MECHANICS]
        self.assertEqual(len(names), 12)
        self.assertEqual(len(set(m["id"] for m in self.C.MECHANICS)), 12)
        want = {"Balance & Load": 3, "Stride": 2, "Power Move": 3, "Contact & Follow-Through": 4}
        for g in self.C.GROUPS:
            self.assertEqual(sum(1 for m in self.C.MECHANICS if m["group"] == g), want[g], g)
        self.assertIn("Upper Torso Total Rotation Range", names)

    def test_every_entry_is_complete_and_classified(self):
        for m in self.C.MECHANICS:
            for f in self.C.REQUIRED_FIELDS:
                self.assertIn(f, m, (m["id"], f))
            self.assertIn(m["classification"], self.C.CLASSES, m["id"])
            for f in ("definition", "single_camera_feasibility", "youth_interpretation", "phase", "best_camera"):
                self.assertTrue(m[f].strip(), (m["id"], f))
            self.assertTrue(m["error_sources"] and m["required_landmarks"] and m["pathway_stages"], m["id"])

    def test_no_thresholds_or_grades(self):
        import re
        text = self.C.render_markdown().lower()
        for bad in ("threshold", "red/yellow", "green", "grade", "score", "ideal", "elite", "target of"):
            self.assertNotIn(bad, text, bad)
        self.assertIsNone(re.search(r"\d+\s*(mph|inches|in\.|feet|ft|%)", text))

    def test_measurable_now_matches_what_the_analyzer_emits(self):
        for m in self.C.MECHANICS:
            impl = m["implemented_as"]
            if m["classification"] == "measurable_now":
                self.assertTrue(impl and impl["values"], m["id"])
                reg = M.REGISTRY[impl["observation"]]
                self.assertEqual(reg["validation_status"], "unvalidated")
                # One source for drill routing: the analyzer's registry.
                self.assertEqual(m["drill_taxonomy"], reg["drill_taxonomy"], m["id"])
            elif impl:
                self.assertEqual(impl["values"], [], m["id"])  # never a value for a not-measurable mechanic
        emitted = {"negative_move", "lead_foot_movement", "forward_move", "hip_shoulder_separation"}
        self.assertEqual(set(M.REGISTRY), emitted)

    def test_drill_slugs_are_existing_taxonomy_problems(self):
        with open(os.path.join(self.REPO, "docs", "audits", "problem-taxonomy-production.json")) as f:
            slugs = {r["slug"] for r in json.load(f)["rows"]}
        used = {s for m in self.C.MECHANICS for s in m["drill_taxonomy"]} | {s for r in M.REGISTRY.values() for s in r["drill_taxonomy"]}
        self.assertTrue(used)
        self.assertEqual(used - slugs, set())

    def test_pathway_stages_are_build_the_swing_stages(self):
        import re
        with open(os.path.join(self.REPO, "scripts", "fixtures", "development-pathways.ts")) as f:
            src = f.read()
        start = src.index("slug: 'build-the-swing'")
        nxt = src.find("\n  slug: '", start + 10)
        block = src[start: nxt if nxt > 0 else len(src)]
        keys = set(re.findall(r"\n\s+key: '([a-z0-9-]+)'", block))
        self.assertIn("load-to-launch", keys)
        for m in self.C.MECHANICS:
            self.assertEqual(set(m["pathway_stages"]) - keys, set(), m["id"])

    def test_generated_doc_is_in_sync(self):
        path = os.path.join(self.REPO, "docs", "swing-mechanics-poc", "mechanics-registry.md")
        with open(path) as f:
            self.assertEqual(f.read(), self.C.render_markdown(),
                             "regenerate: python -m swing_analyzer registry-doc > docs/swing-mechanics-poc/mechanics-registry.md")


# ── the real-swing validation command (run here on a synthetic clip) ────────

@unittest.skipUnless(HAVE_FIX and HAVE_MODEL, "needs fixtures and the pose model")
class ValidationRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from swing_analyzer.validate import validate
        cls.tmp = tempfile.mkdtemp(prefix="swing-validate-")
        cls.out = os.path.join(cls.tmp, "run")
        src = os.path.join(cls.tmp, "Sam_Carter_10U_swing.mp4")  # a name that must not leak
        shutil.copy(os.path.join(FIX, "negative_move.mp4"), src)
        cls.summary = validate(src, MODEL, truth()["contact_ms"], "R", "face_on", None,
                               (truth()["move_end"]) * 1000 / truth()["fps"], cls.out, browser_check=False)
        with open(os.path.join(cls.out, "report.md")) as f:
            cls.report = f.read()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_runs_and_writes_the_private_folder(self):
        self.assertEqual(self.summary["status"], "ok")
        for name in ("report.md", "result.json", "result-coach-fs.json", "playback.json", "overlay.mp4"):
            self.assertTrue(os.path.exists(os.path.join(self.out, name)), name)
        self.assertTrue(os.listdir(os.path.join(self.out, "evidence")))
        self.assertTrue(self.summary["playback_copy_aligned"])

    def test_everything_is_owner_only(self):
        for root, dirs, files in os.walk(self.out):
            for n in dirs + files:
                mode = os.stat(os.path.join(root, n)).st_mode & 0o077
                self.assertEqual(mode, 0, os.path.join(root, n))

    def test_input_name_never_recorded(self):
        self.assertNotIn("Sam_Carter", self.report)
        self.assertNotIn("Sam_Carter", json.dumps(self.summary))
        with open(os.path.join(self.out, "result.json")) as f:
            self.assertNotIn("Sam_Carter", f.read())

    def test_report_covers_every_required_section(self):
        for h in ("Video properties", "Processing time", "Pose coverage and landmark confidence", "Contact and foot strike",
                  "Measurements (the twelve mechanics)", "Evidence frames", "Not assessable", "Playback and browsers",
                  "Manual review sheet"):
            self.assertIn(h, self.report)
        from swing_analyzer import catalog as C
        for m in C.MECHANICS:
            self.assertIn(f"| {m['name']} |", self.report)
        self.assertIn("Automatic vs coach", self.report)

    def test_refuses_a_folder_git_would_track(self):
        from swing_analyzer.validate import REPO_ROOT, ensure_private_dir
        target = os.path.join(REPO_ROOT, "docs", "swing-validate-should-not-exist")
        try:
            with self.assertRaises(SystemExit):
                ensure_private_dir(target)
        finally:
            shutil.rmtree(target, ignore_errors=True)
        ok = ensure_private_dir(os.path.join(REPO_ROOT, "analyzer", "out", "private", "_t"))
        self.assertTrue(os.path.isdir(ok))
        shutil.rmtree(ok, ignore_errors=True)
