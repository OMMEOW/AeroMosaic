"""Run directory store + run manager. The directories are the only source of truth.

runs/<run_id>/  manifest.json  steps.jsonl  events.jsonl  metrics.json  mosaic.png
                mosaic_preview.png  observed_area.json  run.log  artifacts/  work/ (scratch)

- GET /runs is a directory scan; there is no index to go stale.
- One run executes at a time, in a worker subprocess in its own session; the rest queue.
- On startup: a run marked running/cancelling whose worker process is still alive is
  re-adopted; one whose worker is gone becomes `interrupted` (never stuck at running).
  A queued run cannot have outlived the in-memory queue, so it also becomes interrupted.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

from pipeline import config as C

from .jsonio import EventLog, iter_jsonl, now_iso, read_json, update_json, write_json_atomic
from .settings import BACKEND_DIR, CANCEL_GRACE_S, PYTHON, RUNS_ROOT

RUN_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[a-z0-9_\-]+-[0-9a-f]{6}$")
NON_TERMINAL = ("queued", "running", "cancelling")
TERMINAL = ("succeeded", "failed", "cancelled", "interrupted")


class Conflict(Exception):
    def __init__(self, code: str, message: str, run_id: str | None = None):
        super().__init__(message)
        self.code, self.run_id = code, run_id


def pipeline_params() -> dict:
    """Every pipeline constant, recorded verbatim in each manifest."""
    out = {}
    for k in dir(C):
        if k.isupper():
            v = getattr(C, k)
            if isinstance(v, (int, float, str, bool, list, tuple)) or v is None:
                out[k] = list(v) if isinstance(v, tuple) else v
    return out


def variant_spec(kind: str, w_sem: float | None = None) -> dict:
    if kind == "firstwins":
        return dict(kind="firstwins", bias=None, w_sem=None, name="firstwins")
    b = C.FROZEN_BIAS
    if kind == "hybrid":
        if w_sem is None or float(w_sem) not in [float(x) for x in C.HYBRID_W]:
            raise ValueError(f"hybrid needs w_sem from the notebook grid {list(C.HYBRID_W)}; none is chosen by default")
        return dict(kind="hybrid", bias=b, w_sem=float(w_sem), name=f"hyb_w{float(w_sem):g}_b{b:g}")
    if kind == "hybrid_sweep":
        return dict(kind="hybrid_sweep", bias=b, w_sem=None, grid=[float(x) for x in C.HYBRID_W], name=f"hyb_sweep_b{b:g}")
    name = {"dgeo": f"dgeo_b{b:g}", "semantic": f"sem_b{b:g}", "random": f"random_b{b:g}"}[kind]
    return dict(kind=kind, bias=b, w_sem=None, name=name)


def run_dir(run_id: str) -> Path | None:
    if not RUN_ID_RE.match(run_id):
        return None
    d = RUNS_ROOT / run_id
    return d if (d / "manifest.json").exists() else None


def summary(d: Path) -> dict:
    """RunSummary (contract.ts) from manifest.json (+ metrics.json)."""
    m = read_json(d / "manifest.json", {}) or {}
    kind = m.get("kind", "video")
    done = read_json(d / "metrics.json") if m.get("status") == "succeeded" else None
    if done and kind == "video" and "seam" not in (done.get("composition") or {}):
        row = read_json(d / "artifacts" / "composition_metrics.json")
        if isinstance(row, dict):     # runs composed before seam metrics were surfaced
            keep = ("slc_frac_disagree", "slc_p10", "slc_mean", "slc_n", "slc_skipped", "seam_step", "bg_step",
                    "seam_step_ratio", "n_seam_px", "sharp_overlap", "seam_grad", "interior_grad", "seam_ratio",
                    "seam_new_frac", "t_compose_s", "t_slc_s", "seam_fallback", "sem_degenerate", "sem_padded")
            done["composition"]["seam"] = {k: row.get(k) for k in keep if k in row}
    metrics = done if kind == "video" else None
    n, fps = m.get("native_frames"), m.get("fps")
    return dict(
        id=m.get("run_id", d.name), videoId=m.get("video_id"), videoGroup=m.get("video_group"),
        status=m.get("status"), createdAt=m.get("created_at"), startedAt=m.get("started_at"),
        finishedAt=m.get("finished_at"),
        video=dict(filename=m.get("video"), path=m.get("video_path"), width=m.get("width"), height=m.get("height"),
                   fps=fps, frameCount=n, durationMs=int(round(n / fps * 1000)) if (n and fps) else None),
        variant=m.get("variant"), seed=m.get("seed"), device=m.get("device"), estimator=m.get("estimator"),
        semstitch=m.get("semstitch"), inverseSelftest=m.get("inverse_selftest"),
        failedStage=m.get("failed_stage"), error=m.get("error"), interruptedReason=m.get("interrupted_reason"),
        metrics=metrics, kind=kind, pair=m.get("pair"), pairResult=done if kind == "pair" else None,
        vizEnabled=bool(m.get("vizEnabled")),
    )


def list_runs() -> list[dict]:
    if not RUNS_ROOT.is_dir():
        return []
    out = [summary(d) for d in RUNS_ROOT.iterdir() if d.is_dir() and (d / "manifest.json").exists()]
    return sorted(out, key=lambda s: s.get("createdAt") or "", reverse=True)


def _pid_is_worker(pid: int | None, d: Path) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    try:
        cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return False
    return "server.worker" in cmd and d.name in cmd


def _last_active_stage(d: Path) -> str | None:
    latest: dict[str, str] = {}
    for e in iter_jsonl(d / "events.jsonl"):
        if e.get("type") == "stage.update":
            latest.pop(e["stage"], None)
            latest[e["stage"]] = e.get("status")     # re-insert: dict order = order of last update
    active = [s for s, st in latest.items() if st == "active"]
    return active[-1] if active else None


class RunManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.queue: deque[str] = deque()
        self.active: dict | None = None      # {id, dir, proc | None, pid, cancel_at}
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True, name="run-supervisor")

    # ---------------------------------------------------------------- lifecycle
    def startup(self):
        RUNS_ROOT.mkdir(parents=True, exist_ok=True)
        for d in sorted(RUNS_ROOT.iterdir()):
            m = read_json(d / "manifest.json")
            if not m or m.get("status") not in NON_TERMINAL:
                continue
            pid = m.get("worker_pid")
            if m["status"] in ("running", "cancelling") and _pid_is_worker(pid, d) and self.active is None:
                self.active = dict(id=d.name, dir=d, proc=None, pid=pid,
                                   cancel_at=time.time() if m["status"] == "cancelling" else None)
                continue
            reason = ("the server restarted before this queued run started" if m["status"] == "queued"
                      else f"worker process {pid} is gone (server or machine restarted mid-run)")
            self._interrupt(d, reason)
        self.thread.start()

    def shutdown(self):
        self.stop.set()

    def _interrupt(self, d: Path, reason: str):
        ev = EventLog(d, d.name)
        if ev.has_terminal():
            return
        stage = _last_active_stage(d)
        items = []
        if stage:
            items.append(("stage.update", dict(stage=stage, status="failed", progress=None, counter=None,
                                               cached=False, durationMs=None)))
        items.append(("run.interrupted", dict(reason=reason, stage=stage)))
        ev.emit_many(items)
        update_json(d / "manifest.json", status="interrupted", interrupted_reason=reason,
                    failed_stage=stage, finished_at=now_iso())

    # ---------------------------------------------------------------- API
    def create(self, video: dict, variant_kind: str | None, seed: int, viz: bool = False,
               pair: tuple[int, int] | None = None, w_sem: float | None = None) -> dict:
        kind = "pair" if pair else "video"
        variant = variant_spec(variant_kind, w_sem) if kind == "video" else None
        viz = True if kind == "pair" else bool(viz)
        params = pipeline_params()
        h = hashlib.sha256(json.dumps(dict(params=params, variant=variant, seed=seed, video=str(video["path"]),
                                           pair=list(pair) if pair else None, viz=viz), sort_keys=True).encode()).hexdigest()[:6]
        ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run_id = f"{ts}-{video['id']}-{h}"
        d = RUNS_ROOT / run_id
        if d.exists():
            raise Conflict("run_exists", f"run {run_id} already exists (same second, same parameters)", run_id)
        (d / "artifacts").mkdir(parents=True)
        p = Path(video["path"])
        probe = video.get("probe") or {}
        write_json_atomic(d / "manifest.json", dict(
            run_id=run_id, video=p.name, video_id=video["id"], video_path=str(p), video_group=video.get("group"),
            fps=probe.get("fps"), native_frames=None, width=probe.get("width"), height=probe.get("height"),
            duration_s=None, chain_breaks=None, params=params, seed=int(seed), variant=variant,
            kind=kind, pair=list(pair) if pair else None, vizEnabled=viz,
            vizKeep=int(os.environ.get("UAV_VIZ_KEEP", "50")),
            status="queued", created_at=now_iso(), started_at=None, finished_at=None, computed_at=None,
            server_pid=os.getpid(),
        ))
        (d / "steps.jsonl").touch()
        s = summary(d)
        EventLog(d, run_id).emit_many([("run.created", dict(run=s)), ("run.status", dict(status="queued"))])
        with self.lock:
            self.queue.append(run_id)
        return summary(d)

    def active_id(self) -> str | None:
        with self.lock:
            return self.active["id"] if self.active else None

    def is_idle(self) -> bool:
        with self.lock:
            return self.active is None and not self.queue

    def cancel(self, run_id: str) -> dict:
        d = run_dir(run_id)
        if d is None:
            raise KeyError(run_id)
        with self.lock:
            m = read_json(d / "manifest.json", {})
            if m.get("status") in TERMINAL:
                raise Conflict("run_terminal", f"run is already {m.get('status')}", run_id)
            if run_id in self.queue:
                self.queue.remove(run_id)
                EventLog(d, run_id).emit("run.cancelled", stage=None, killed=False)
                update_json(d / "manifest.json", status="cancelled", finished_at=now_iso())
                return summary(d)
            if self.active and self.active["id"] == run_id:
                if self.active["cancel_at"] is None:
                    self.active["cancel_at"] = time.time()
                    EventLog(d, run_id).emit("run.status", status="cancelling")
                    update_json(d / "manifest.json", status="cancelling")
                    self._signal(signal.SIGTERM)
                return summary(d)
        raise Conflict("run_not_active", "run is not queued or running in this server", run_id)

    def delete(self, run_id: str):
        d = run_dir(run_id)
        if d is None:
            raise KeyError(run_id)
        m = read_json(d / "manifest.json", {})
        if m.get("status") in NON_TERMINAL:
            raise Conflict("run_active", "cancel the run before deleting it", run_id)
        shutil.rmtree(d)

    # ---------------------------------------------------------------- supervisor
    def _signal(self, sig):
        a = self.active
        if not a:
            return
        try:
            os.killpg(a["pid"], sig)       # worker is a session leader: its pgid is its pid
        except ProcessLookupError:
            pass

    def _alive(self) -> bool:
        a = self.active
        if a["proc"] is not None:
            return a["proc"].poll() is None
        return _pid_is_worker(a["pid"], a["dir"])

    def _finalize(self):
        a = self.active
        d, ev = a["dir"], EventLog(a["dir"], a["id"])
        m = read_json(d / "manifest.json", {}) or {}
        if m.get("native_frames"):   # the run's own decode (notebook cell 6) is an exact count
            try:
                from . import videos as V
                V.record_decoded_count(m["video_id"], Path(m["video_path"]), int(m["native_frames"]), "run-decode")
            except Exception:  # noqa: BLE001 -- a cache update must never break finalisation
                pass
        if not ev.has_terminal():
            stage = _last_active_stage(d)
            items = []
            if a["cancel_at"] is not None:
                if stage:
                    items.append(("stage.update", dict(stage=stage, status="cancelled", progress=None, counter=None,
                                                       cached=False, durationMs=None)))
                items.append(("run.cancelled", dict(stage=stage, killed=True)))
                ev.emit_many(items)
                update_json(d / "manifest.json", status="cancelled", finished_at=now_iso(), cancelled_stage=stage)
            else:
                code = a["proc"].returncode if a["proc"] is not None else None
                err = dict(code="worker_exited", exceptionType=None, stage=stage or "preflight", hint="See run.log.",
                           message=f"worker exited{f' with code {code}' if code is not None else ''} without reporting "
                                   f"a result (killed or crashed outside Python)", tracebackTail=None)
                if stage:
                    items.append(("stage.update", dict(stage=stage, status="failed", progress=None, counter=None,
                                                       cached=False, durationMs=None)))
                items.append(("run.failed", dict(error=err)))
                ev.emit_many(items)
                update_json(d / "manifest.json", status="failed", finished_at=now_iso(), failed_stage=err["stage"],
                            error=err)
        self.active = None

    def _spawn(self, run_id: str):
        d = RUNS_ROOT / run_id
        log = open(d / "run.log", "ab")
        env = dict(os.environ, PYTORCH_ENABLE_MPS_FALLBACK="1", PYTHONUNBUFFERED="1", MPLBACKEND="Agg")
        proc = subprocess.Popen([PYTHON, "-m", "server.worker", str(d)], cwd=BACKEND_DIR, stdout=log,
                                stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, start_new_session=True)
        log.close()
        self.active = dict(id=run_id, dir=d, proc=proc, pid=proc.pid, cancel_at=None)
        update_json(d / "manifest.json", worker_pid=proc.pid)

    def _loop(self):
        while not self.stop.wait(0.5):
            with self.lock:
                if self.active:
                    if not self._alive():
                        self._finalize()
                    elif self.active["cancel_at"] and time.time() - self.active["cancel_at"] > CANCEL_GRACE_S:
                        self._signal(signal.SIGKILL)
                if self.active is None and self.queue:
                    self._spawn(self.queue.popleft())
