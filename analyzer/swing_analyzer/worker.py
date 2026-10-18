"""File-queue worker: the boundary between the web app and the analyzer.

The web app never runs the model inside an HTTP request. It writes a job file;
this process picks it up, analyses the clip in a child process (so a hang or a
crash cannot take the worker down), and writes the result next to the video.

Layout under the data directory (shared with lib/swingPoc/store.ts):

  captures/<id>/meta.json      app: team, player, file facts, contact history
  captures/<id>/video.<ext>    app: the private upload
  captures/<id>/job.json       worker-owned once claimed: state, attempts, error
  captures/<id>/result.json    worker: the swing-pose/1 output
  captures/<id>/prepare.json   worker: playback-copy state
  captures/<id>/playback.json  worker: frame times + the verified playback copy
  queue/<id>.json              app: "please analyse", with the request snapshot
  queue/<id>.prepare.json      app: "please make the playback copy"
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
import signal
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
    if request.get("capture_fps"):
        cmd += ["--capture-fps", str(request["capture_fps"])]
    env = {**os.environ, "PYTHONPATH": os.path.dirname(os.path.dirname(os.path.abspath(__file__)))}
    # Own process group, so a timeout kills the analyzer AND the ffmpeg it
    # started — otherwise a hung decoder outlives the job.
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
    try:
        _, err = proc.communicate(timeout=JOB_TIMEOUT_S)
        result = read_json(out_tmp)
        if result is None:
            # Never log the video or frames — only the tail of stderr.
            tail = err.decode("utf-8", "replace")[-400:]
            result = {"status": "failed", "error": {"code": "analyzer_crashed", "message": "The analyzer stopped unexpectedly.", "detail": tail}}
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate()
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


def process_prepare(data_dir: str, cap_id: str) -> dict:
    """Make and verify the browser playback copy (see proxy.py)."""
    from .proxy import prepare
    from .video import AnalyzerError

    cap_dir = os.path.join(data_dir, "captures", cap_id)
    claimed = os.path.join(data_dir, "processing", f"{cap_id}.prepare.json")
    state_path = os.path.join(cap_dir, "prepare.json")
    codec = os.environ.get("SWING_POC_PROXY_CODEC", "h264")
    state = {"state": "processing", "updated_at": _now(), "codec": codec}
    try:
        video = _video_in(cap_dir) if os.path.isdir(cap_dir) else None
        if not video:
            raise AnalyzerError("missing_file", "The uploaded video is missing.")
        write_json(state_path, state)
        manifest = prepare(video, cap_dir, codec)
        write_json(os.path.join(cap_dir, "playback.json"), manifest)
        state.update({"state": "done", "aligned": manifest["proxy"]["aligned"], "error": None,
                      "prepare_ms": manifest["prepare_ms"]})
    except AnalyzerError as e:
        state.update({"state": "failed", "error": {"code": e.code, "message": e.message}})
    except Exception as e:  # never leave the job half-claimed
        state.update({"state": "failed", "error": {"code": "prepare_crashed", "message": "Preparing playback failed.", "detail": str(e)[-300:]}})
    state["updated_at"] = _now()
    if os.path.isdir(cap_dir):
        write_json(state_path, state)
    if os.path.exists(claimed):
        os.remove(claimed)
    return state


def purge(data_dir: str, older_than_days: float) -> int:
    """Delete captures (video and everything derived) older than N days."""
    import shutil
    root = os.path.join(data_dir, "captures")
    cutoff = time.time() - older_than_days * 86400
    n = 0
    for name in os.listdir(root) if os.path.isdir(root) else []:
        d = os.path.join(root, name)
        meta = os.path.join(d, "meta.json")
        stamp = os.path.getmtime(meta) if os.path.exists(meta) else os.path.getmtime(d)
        if stamp < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            for q in ("queue", "processing"):
                for suffix in (".json", ".prepare.json"):
                    p = os.path.join(data_dir, q, name + suffix)
                    if os.path.exists(p):
                        os.remove(p)
            n += 1
    return n


def recover_stale(data_dir: str) -> None:
    """Jobs left in processing/ by a worker that died go back to the queue (bounded retries)."""
    pdir = os.path.join(data_dir, "processing")
    for name in os.listdir(pdir):
        path = os.path.join(pdir, name)
        if time.time() - os.path.getmtime(path) < JOB_TIMEOUT_S + 60:
            continue
        if name.endswith(".prepare.json"):
            os.replace(path, os.path.join(data_dir, "queue", name))
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
            is_prepare = name.endswith(".prepare.json")
            cap_id = name[: -len(".prepare.json")] if is_prepare else name[:-5]
            try:
                os.rename(os.path.join(qdir, name), os.path.join(data_dir, "processing", name))
            except FileNotFoundError:
                continue  # another worker claimed it
            t = time.time()
            job = process_prepare(data_dir, cap_id) if is_prepare else process_one(data_dir, cap_id, model_path)
            print(f"swing worker: {cap_id} {'prepare' if is_prepare else 'analyze'} -> {job['state']} in {time.time() - t:.1f}s", flush=True)
            did = True
        if once:
            return
        if not did:
            time.sleep(poll_s)
