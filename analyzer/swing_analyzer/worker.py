"""File-queue worker: the boundary between the web app and the analyzer.

The web app never runs the model inside an HTTP request. It writes a job file;
this process picks it up, analyses the clip in a child process (so a hang or a
crash cannot take the worker down), and writes the result next to the video.

Layout under the data directory (shared with lib/swingPoc/store.ts):

  captures/<id>/meta.json      app: team, player, file facts, contact history
  captures/<id>/video.<ext>    app: the private upload
  captures/<id>/job.json       worker-owned once claimed: state, attempts, error
  captures/<id>/result.json    worker: the swing-pose/1 output
  queue/<id>.json              app: "please analyse", with the request snapshot
  processing/<id>.json         worker: claimed (atomic rename from queue/)

Idempotent: the result records an input hash (video bytes + request +
analyzer version + model file). A job whose hash matches the stored result is
marked done without re-running the model.

A production version would replace the directory queue with a database-backed
job table (see docs/swing-mechanics-poc/proposed-schema.sql); the contract —
claim atomically, run in isolation, write versioned output, record failure —
stays the same.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from typing import Optional

from . import ANALYZER_VERSION

JOB_TIMEOUT_S = 600
MAX_ATTEMPTS = 3


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path: str, data: dict) -> None:
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read_json(path: str) -> Optional[dict]:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def input_hash(video_path: str, request: dict, model_path: str) -> str:
    h = hashlib.sha256()
    for path in (video_path, model_path):
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    h.update(json.dumps(request, sort_keys=True).encode())
    h.update(ANALYZER_VERSION.encode())
    return h.hexdigest()


def _video_in(cap_dir: str) -> Optional[str]:
    for name in sorted(os.listdir(cap_dir)):
        if name.startswith("video."):
            return os.path.join(cap_dir, name)
    return None


def process_one(data_dir: str, cap_id: str, model_path: str) -> dict:
    cap_dir = os.path.join(data_dir, "captures", cap_id)
    claimed = os.path.join(data_dir, "processing", f"{cap_id}.json")
    request = read_json(claimed) or {}
    job_path = os.path.join(cap_dir, "job.json")
    job = read_json(job_path) or {}
    job.update({"state": "processing", "updated_at": _now(), "attempts": int(job.get("attempts") or 0) + 1,
                "request": request, "analyzer_version": ANALYZER_VERSION})
    write_json(job_path, job)

    video = _video_in(cap_dir) if os.path.isdir(cap_dir) else None
    if not video:
        job.update({"state": "failed", "updated_at": _now(), "error": {"code": "missing_file", "message": "The uploaded video is missing."}})
        write_json(job_path, job)
        os.remove(claimed)
        return job

    ih = input_hash(video, request, model_path)
    existing = read_json(os.path.join(cap_dir, "result.json"))
    if existing and existing.get("input_hash") == ih:
        job.update({"state": "done", "updated_at": _now(), "reused_result": True, "error": None})
        write_json(job_path, job)
        os.remove(claimed)
        return job

    out_tmp = os.path.join(cap_dir, f"result.json.tmp-{os.getpid()}")
    cmd = [sys.executable, "-m", "swing_analyzer", "analyze", video, "--model", model_path,
           "--out", out_tmp, "--contact-ms", str(request.get("contact_ms"))]
    if request.get("handedness"):
        cmd += ["--handedness", request["handedness"]]
    if request.get("camera_view"):
        cmd += ["--view", request["camera_view"]]
    if request.get("foot_strike_ms") is not None:
        cmd += ["--foot-strike-ms", str(request["foot_strike_ms"])]
    env = {**os.environ, "PYTHONPATH": os.path.dirname(os.path.dirname(os.path.abspath(__file__)))}
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=JOB_TIMEOUT_S, env=env)
        result = read_json(out_tmp)
        if result is None:
            # Never log the video or frames — only the tail of stderr.
            tail = proc.stderr.decode("utf-8", "replace")[-400:]
            result = {"status": "failed", "error": {"code": "analyzer_crashed", "message": "The analyzer stopped unexpectedly.", "detail": tail}}
    except subprocess.TimeoutExpired:
        result = {"status": "failed", "error": {"code": "timeout", "message": f"Analysis took longer than {JOB_TIMEOUT_S}s and was stopped."}}
    finally:
        if os.path.exists(out_tmp):
            os.remove(out_tmp)

    result["input_hash"] = ih
    result["request"] = request
    result["analyzed_at"] = _now()
    write_json(os.path.join(cap_dir, "result.json"), result)
    ok = result.get("status") == "ok"
    job.update({"state": "done" if ok else "failed", "updated_at": _now(),
                "error": None if ok else result.get("error")})
    write_json(job_path, job)
    os.remove(claimed)
    return job


def recover_stale(data_dir: str) -> None:
    """Jobs left in processing/ by a worker that died go back to the queue (bounded retries)."""
    pdir = os.path.join(data_dir, "processing")
    for name in os.listdir(pdir):
        path = os.path.join(pdir, name)
        if time.time() - os.path.getmtime(path) < JOB_TIMEOUT_S + 60:
            continue
        cap_id = name[:-5]
        job_path = os.path.join(data_dir, "captures", cap_id, "job.json")
        job = read_json(job_path) or {}
        if int(job.get("attempts") or 0) >= MAX_ATTEMPTS:
            job.update({"state": "failed", "updated_at": _now(), "error": {"code": "gave_up", "message": "Analysis failed repeatedly."}})
            write_json(job_path, job)
            os.remove(path)
        else:
            os.replace(path, os.path.join(data_dir, "queue", name))


def run(data_dir: str, model_path: str, once: bool = False, poll_s: float = 1.0) -> None:
    for d in ("queue", "processing", "captures"):
        os.makedirs(os.path.join(data_dir, d), exist_ok=True)
    print(f"swing worker: data={data_dir} model={os.path.basename(model_path)} analyzer={ANALYZER_VERSION}", flush=True)
    while True:
        recover_stale(data_dir)
        qdir = os.path.join(data_dir, "queue")
        names = sorted(os.listdir(qdir), key=lambda n: os.path.getmtime(os.path.join(qdir, n)))
        did = False
        for name in names:
            if not name.endswith(".json"):
                continue
            cap_id = name[:-5]
            try:
                os.rename(os.path.join(qdir, name), os.path.join(data_dir, "processing", name))
            except FileNotFoundError:
                continue  # another worker claimed it
            t = time.time()
            job = process_one(data_dir, cap_id, model_path)
            print(f"swing worker: {cap_id} -> {job['state']} in {time.time() - t:.1f}s", flush=True)
            did = True
        if once:
            return
        if not did:
            time.sleep(poll_s)
