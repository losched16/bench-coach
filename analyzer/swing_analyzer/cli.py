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
    a.add_argument("--model", default=DEFAULT_MODEL)
    a.add_argument("--out", required=True)

    w = sub.add_parser("worker")
    w.add_argument("--data-dir", required=True)
    w.add_argument("--model", default=DEFAULT_MODEL)
    w.add_argument("--once", action="store_true")

    f = sub.add_parser("fixtures")
    f.add_argument("src")
    f.add_argument("outdir")

    o = sub.add_parser("overlay")
    o.add_argument("result")
    o.add_argument("video")
    o.add_argument("out")
    o.add_argument("--stills")

    args = ap.parse_args(argv)
    if args.cmd == "analyze":
        from .analyze import analyze
        res = analyze(args.video, args.model, contact_ms=args.contact_ms,
                      handedness=args.handedness, camera_view=args.view, foot_strike_ms=args.foot_strike_ms)
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
        from .fixtures import build
        print(json.dumps(build(args.src, args.outdir))[:400])
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
