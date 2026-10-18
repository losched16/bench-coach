"""Command line: analyze a clip, run the worker, build fixtures, render an overlay.

  python -m swing_analyzer analyze VIDEO --contact-ms 1666 --handedness R --view face_on --out result.json
  python -m swing_analyzer worker --data-dir ../.swing-poc-data
  python -m swing_analyzer fixtures SRC_IMAGE OUTDIR
  python -m swing_analyzer overlay RESULT.json VIDEO OUT.mp4 [--stills DIR]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

DEFAULT_MODEL = os.environ.get(
    "SWING_POSE_MODEL",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "pose_landmarker_full.task"),
)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="swing_analyzer")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze")
    a.add_argument("video")
    a.add_argument("--contact-ms", type=float, required=True, help="coach-marked contact time, ms from the first frame")
    a.add_argument("--handedness", choices=["R", "L"])
    a.add_argument("--view", choices=["face_on", "down_the_line", "other"])
    a.add_argument("--foot-strike-ms", type=float, help="coach-marked foot strike; overrides the automatic estimate")
    a.add_argument("--capture-fps", type=float, help="real capture rate when the file is an exported (re-timed) slow-motion clip")
    a.add_argument("--model", default=DEFAULT_MODEL)
    a.add_argument("--out", required=True)

    w = sub.add_parser("worker")
    w.add_argument("--data-dir", required=True)
    w.add_argument("--model", default=DEFAULT_MODEL)
    w.add_argument("--once", action="store_true")

    f = sub.add_parser("fixtures")
    f.add_argument("src")
    f.add_argument("outdir")
    f.add_argument("--phone", action="store_true", help="also build the phone-format fixtures")

    pg = sub.add_parser("purge", help="delete captures older than N days (retention)")
    pg.add_argument("--data-dir", required=True)
    pg.add_argument("--older-than-days", type=float, required=True)

    pr = sub.add_parser("prepare", help="make and verify a browser playback copy")
    pr.add_argument("video")
    pr.add_argument("outdir")
    pr.add_argument("--codec", choices=["h264", "vp9"], default="h264")

    sub.add_parser("registry-doc", help="print the 12-mechanic registry as Markdown")

    v = sub.add_parser("validate", help="real-swing validation run -> private report folder")
    v.add_argument("video")
    v.add_argument("--contact-ms", type=float, required=True, help="coach-marked contact (use contact-sheet to find it)")
    v.add_argument("--handedness", choices=["R", "L"], required=True)
    v.add_argument("--view", choices=["face_on", "down_the_line", "other"], required=True)
    sm = v.add_mutually_exclusive_group(required=True)
    sm.add_argument("--capture-fps", type=float, help="exported/shared slow-mo: the fps it was RECORDED at")
    sm.add_argument("--not-slowmo", action="store_true", help="original file (normal or slow-mo straight from the phone)")
    v.add_argument("--foot-strike-ms", type=float, help="coach-marked foot strike, compared with the automatic estimate")
    v.add_argument("--out", help="private output folder (default analyzer/out/private/<run>)")
    v.add_argument("--codec", choices=["h264", "vp9"], default="h264", help="playback copy codec (h264 = what the app serves)")
    v.add_argument("--no-browser-check", action="store_true")
    v.add_argument("--model", default=DEFAULT_MODEL)

    cs = sub.add_parser("contact-sheet", help="labelled frames around a time, to find contact by eye")
    cs.add_argument("video")
    cs.add_argument("--around-ms", type=float, required=True)
    cs.add_argument("--span-ms", type=float, default=150.0)
    cs.add_argument("--out", help="private output folder (default analyzer/out/private/contact-<run>)")

    o = sub.add_parser("overlay")
    o.add_argument("result")
    o.add_argument("video")
    o.add_argument("out")
    o.add_argument("--stills")

    args = ap.parse_args(argv)
    if args.cmd == "analyze":
        from .analyze import analyze
        res = analyze(args.video, args.model, contact_ms=args.contact_ms,
                      handedness=args.handedness, camera_view=args.view, foot_strike_ms=args.foot_strike_ms,
                      capture_fps=args.capture_fps)
        with open(args.out, "w") as fh:
            json.dump(res, fh)
        summary = {"status": res.get("status"), "error": res.get("error"),
                   "analysed": (res.get("quality") or {}).get("analysed_frames"),
                   "timing": res.get("timing")}
        print(json.dumps(summary))
        return 0 if res.get("status") == "ok" else 2
    if args.cmd == "worker":
        from .worker import run
        run(args.data_dir, args.model, once=args.once)
        return 0
    if args.cmd == "fixtures":
        from .fixtures import build, build_phone
        print(json.dumps(build(args.src, args.outdir))[:400])
        if args.phone:
            print(json.dumps(build_phone(args.outdir)))
        return 0
    if args.cmd == "purge":
        from .worker import purge
        print(json.dumps({"deleted": purge(args.data_dir, args.older_than_days)}))
        return 0
    if args.cmd == "prepare":
        from .proxy import prepare
        os.makedirs(args.outdir, exist_ok=True)
        m = prepare(args.video, args.outdir, args.codec)
        print(json.dumps({k: v for k, v in m.items() if k != "frame_times_ms"}))
        return 0 if m["proxy"]["aligned"] else 3
    if args.cmd == "validate":
        from .validate import validate
        summary = validate(args.video, args.model, args.contact_ms, args.handedness, args.view,
                           None if args.not_slowmo else args.capture_fps, args.foot_strike_ms, args.out,
                           codec=args.codec, browser_check=not args.no_browser_check)
        print(json.dumps(summary, indent=1))
        return 0 if summary.get("status") == "ok" else 2
    if args.cmd == "contact-sheet":
        import datetime as _dt
        from .validate import DEFAULT_OUT, contact_sheet, ensure_private_dir
        out = ensure_private_dir(args.out or os.path.join(DEFAULT_OUT, "contact-" + _dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")))
        r = contact_sheet(args.video, args.around_ms, args.span_ms, os.path.join(out, "contact-sheet.png"))
        print(json.dumps(r, indent=1))
        return 0
    if args.cmd == "registry-doc":
        from .catalog import render_markdown
        sys.stdout.write(render_markdown())
        return 0
    if args.cmd == "overlay":
        from .overlay import render
        with open(args.result) as fh:
            res = json.load(fh)
        if args.stills:
            os.makedirs(args.stills, exist_ok=True)
        print(json.dumps(render(res, args.video, args.out, args.stills)))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
