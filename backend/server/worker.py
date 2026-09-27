"""One run in its own process:  python -m server.worker <run_dir>

Calls the notebook's functions in the notebook's order (pipeline/run.py:run_pass_a, then
cell 39's run_variants for the one chosen variant, then cell 41's coverage_vs_observed).
Everything here is bookkeeping: events, records, files. No pipeline logic.

Owns events.jsonl / steps.jsonl / manifest.json while alive. SIGTERM requests a cancel; the
next hook call raises Cancelled (a BaseException, so the notebook's own `except` clauses
cannot swallow it). The server SIGKILLs if the worker does not exit in time.
"""
from __future__ import annotations

import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("MPLBACKEND", "Agg")

import hashlib  # noqa: E402
import queue  # noqa: E402
import threading  # noqa: E402
import platform  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402
from pathlib import Path  # noqa: E402

import cv2  # noqa: E402

from pipeline import config as C  # noqa: E402

from . import records as R  # noqa: E402
from .jsonio import EventLog, append_jsonl, now_iso, read_json, update_json, write_json_atomic  # noqa: E402
from .settings import CACHE_ROOT, DKM_WEIGHTS, NOTEBOOK  # noqa: E402

STAGE_UNITS = {"decode": "frames", "sift": "frames", "probe": "pairs", "reference": "frames",
               "composite": "frames", "dkm": "attempts"}
BATCH = 400


SEAM_FIELDS = ("slc_frac_disagree", "slc_p10", "slc_mean", "slc_n", "slc_skipped", "seam_step", "bg_step",
               "seam_step_ratio", "n_seam_px", "sharp_overlap", "seam_grad", "interior_grad", "seam_ratio",
               "seam_new_frac", "t_compose_s", "t_slc_s", "seam_fallback", "sem_degenerate", "sem_padded")


def _seam_fields(row: dict) -> dict:
    """The notebook's seam-line metrics (run_variants / measure / slc_variant), under the
    notebook's own names. Canvas-relative fields (fill, overlap_frac) are excluded."""
    return {k: row.get(k) for k in SEAM_FIELDS if k in row}


class Cancelled(BaseException):
    pass


class StageFailure(Exception):
    def __init__(self, code: str, message: str, hint: str | None = None):
        super().__init__(message)
        self.code, self.hint = code, hint


def _git_commit(path: Path) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() or None
    except Exception:
        return None


def _sha256(path: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while b := f.read(1 << 20):
                h.update(b)
        return h.hexdigest()
    except FileNotFoundError:
        return None


class Worker:
    def __init__(self, run_dir: Path):
        self.dir = run_dir
        self.man_p = run_dir / "manifest.json"
        self.man = read_json(self.man_p)
        self.id = self.man["run_id"]
        self.v = self.man["video_id"]
        self.ev = EventLog(run_dir, self.id)
        self.steps_p = run_dir / "steps.jsonl"
        self.cancel = False
        self.stage: str | None = None
        self.stage_ms: dict[str, int | None] = {}
        self.stage_cached: dict[str, bool] = {}
        self._last_progress: dict[str, float] = {}
        self.inflight: tuple[int, int, int, float] | None = None
        self.n_attempts = self.n_accepted = 0
        self.last_rejected = False
        self.attempt_ms: list[int] = []
        self.t0 = time.time()
        signal.signal(signal.SIGTERM, self._on_term)
        # Per-pair visualisation (interactive runs only; recorded in the manifest as vizEnabled).
        self.viz_enabled = bool(self.man.get("vizEnabled"))
        self.viz = None
        self.sub_q: queue.Queue = queue.Queue()
        self.sub_log: dict[int, list[dict]] = {}
        if self.viz_enabled:
            threading.Thread(target=self._substage_writer, daemon=True).start()

    # ------------------------------------------------------------------ plumbing
    def _on_term(self, *_):
        self.cancel = True

    def check(self):
        if self.cancel:
            raise Cancelled()

    def manifest(self, **fields):
        self.man = update_json(self.man_p, **fields)

    def log(self, *a, **_k):
        msg = " ".join(str(x) for x in a).rstrip()
        print(msg, flush=True)
        if msg.strip():
            self.ev.emit("log", level="warn" if "!!" in msg else "info", stage=self.stage, message=msg.strip())

    def begin(self, stage: str, cached: bool = False):
        self.check()
        if stage == "dkm" and self.man.get("kind", "video") == "video":
            self._write_observed()   # reference + observed_area() have run by now (run_pass_a order)
        self.stage = stage
        self.ev.emit("stage.update", stage=stage, status="active", progress=0.0 if not cached else None,
                     counter=None, cached=cached, durationMs=None)

    def end(self, stage: str, seconds: float, cached: bool = False):
        ms = int(round(seconds * 1000))
        self.stage_ms[stage] = ms
        self.stage_cached[stage] = cached
        self.ev.emit("stage.update", stage=stage, status="done", progress=1.0, counter=None,
                     cached=cached, durationMs=ms)
        if stage == "decode":
            self._after_decode()
        elif stage == "select":
            self._after_select()
        self.check()

    def progress(self, stage: str, done: int, total: int | None):
        self.check()
        now = time.time()
        final = total is not None and done >= total
        if not final and now - self._last_progress.get(stage, 0) < 0.3:
            return
        self._last_progress[stage] = now
        self.ev.emit("stage.update", stage=stage, status="active",
                     progress=(done / total) if total else None,
                     counter=dict(done=int(done), total=int(total) if total is not None else None,
                                  unit=STAGE_UNITS.get(stage, "items")),
                     cached=False, durationMs=None)

    # ------------------------------------------------------------------ run
    def run(self) -> int:
        self.manifest(status="running", started_at=now_iso(), worker_pid=os.getpid())
        self.ev.emit("run.status", status="running")
        try:
            self._run()
            return 0
        except Cancelled:
            self._finish_cancelled()
            return 0
        except BaseException as e:  # noqa: BLE001 -- every failure is recorded, then the process exits non-zero
            self._finish_failed(e)
            return 1

    def _preflight(self):
        self.begin("preflight")
        t0 = time.time()
        variant = self.man["variant"]
        if not DKM_WEIGHTS.exists():
            raise StageFailure("dkm_weights_missing", f"DKM weights not found at {DKM_WEIGHTS}",
                               "DKMv3_outdoor.pth must be present locally; the server does not download it.")
        from pipeline import semantic
        sem = semantic.status()
        self.manifest(semstitch=dict(repo=sem["repo"], repo_commit=_git_commit(C.SEMSTITCH_REPO),
                                     checkpoint=sem["checkpoint"], checkpoint_found=sem["checkpoint_found"],
                                     sha256=sem["sha256"], expected_sha256=sem["expected_sha256"],
                                     verified=sem["verified"], used=variant["kind"] in ("semantic", "hybrid", "hybrid_sweep")))
        if variant["kind"] in ("semantic", "hybrid", "hybrid_sweep") and not sem["verified"]:
            raise StageFailure("semstitch_unavailable", sem["error"],
                               "No fallback: a run that asks for SemanticStitch gets SemanticStitch or fails.")
        self.log(f"preflight: variant {variant['name']}, DKM weights {DKM_WEIGHTS}")
        self.end("preflight", time.time() - t0)

    def _import_pipeline(self):
        import numpy as np
        import torch

        from pipeline import _nb_pass_a as A
        from pipeline import _nb_pass_b as B
        from pipeline import run as RUN

        self.np, self.A, self.B, self.RUN = np, A, B, RUN
        A._log = B._log = self.log
        A._progress = B._progress = self.progress
        A._attempt_begin = self._attempt_begin
        A._step = self._step
        A._substage = self._substage
        import cv2
        import torchvision
        self.manifest(
            device=A.DEVICE, estimator="gcransac" if A.HAS_GCRANSAC else "magsac",
            versions=dict(python=platform.python_version(), torch=torch.__version__, torchvision=torchvision.__version__,
                          opencv=cv2.__version__, numpy=np.__version__, platform=platform.platform()),
            git_commit=_git_commit(Path(__file__).resolve().parents[2]),
            notebook_sha256=_sha256(NOTEBOOK), dkm=dict(repo=str(C.DKM_REPO), repo_commit=_git_commit(C.DKM_REPO),
                                                        weights=str(DKM_WEIGHTS)),
        )
        self.ev.emit("run.info", info=dict(device=self.man["device"], estimator=self.man["estimator"],
                                           semstitch=self.man.get("semstitch")))

    def _link_caches(self):
        """Decoded frames and SIFT-500 descriptors are deterministic (no RNG) and shared per video
        file; everything from the probe on is recomputed per run."""
        vp = Path(self.man["video_path"])
        st = vp.stat()
        key = f"{self.v}-{st.st_size}-{st.st_mtime_ns}-{C.MAX_SIDE}"
        cache = CACHE_ROOT / "decode" / key
        cache.mkdir(parents=True, exist_ok=True)
        (cache / "frames").mkdir(exist_ok=True)
        d = self.dir / "work" / "passA" / self.v
        d.mkdir(parents=True, exist_ok=True)
        for name in ("frames", "frames_manifest.json", f"sift_{C.PROBE_NFEATURES}.npz"):
            link = d / name
            if not link.is_symlink():
                link.symlink_to(cache / name)
        self.manifest(decode_cache=str(cache))
        C.VIDEO_PATHS[self.v] = vp

    def _run(self):
        if self.man.get("kind") == "pair":
            return self._run_pair()
        self._preflight()
        self._import_pipeline()
        self._link_caches()
        A, B, RUN = self.A, self.B, self.RUN
        RUN.set_workdirs(self.dir / "work" / "passA", self.dir / "work" / "passB")

        seed = int(self.man["seed"])
        times = RUN.run_pass_a(self.v, seed=seed, hooks=self)
        self.manifest(inverse_selftest=dict(max_rel_err=times["inverse_selftest_max_rel_err"], tol=1e-3, passed=True))
        self.ev.emit("run.info", info=dict(inverseSelftest=self.man["inverse_selftest"]))
        trace = A.TRACES[self.v]
        if self.viz is not None:
            self.manifest(viz=self.viz.summary())
        self.check()

        # ---- composition (notebook cell 39, one variant) ----
        variant = self.man["variant"]
        self.begin("composite")
        t0 = time.time()
        if variant["kind"] in ("semantic", "hybrid", "hybrid_sweep"):
            from pipeline import semantic
            B.seam_obj, _ = semantic.load()
        sweep = None
        if variant["kind"] == "hybrid_sweep":
            # the notebook's procedure (cell 39): every hybrid w_sem at the frozen bias, each scored by SLC
            vdicts = [dict(kind="hybrid", bias=variant["bias"], w_sem=w) for w in variant["grid"]]
        else:
            vdicts = [{k: variant[k] for k in ("kind", "bias", "w_sem") if variant.get(k) is not None}]
        rows = B.run_variants(self.v, vdicts, save=True)
        rows = [{k: v for k, v in r.items() if "fill" not in k and k != "overlap_frac"} for r in rows]   # canvas-relative: not reported
        if variant["kind"] == "hybrid_sweep":
            import math
            score = [r.get("slc_frac_disagree") for r in rows]
            finite = [(s, k) for k, s in enumerate(score) if s is not None and math.isfinite(s)]
            win = min(finite)[1] if finite else 0
            sweep = []
            for k, (vd, r) in enumerate(zip(vdicts, rows)):
                nm = B.vname(**vd)
                src_png = self.dir / "work" / "passB" / self.v / nm / "mosaic.png"
                im = cv2.imread(str(src_png))
                (self.dir / "artifacts" / "sweep").mkdir(exist_ok=True)
                s_ = min(1.0, 1280 / max(im.shape[:2]))
                cv2.imwrite(str(self.dir / "artifacts" / "sweep" / f"{nm}.jpg"),
                            cv2.resize(im, (int(im.shape[1] * s_), int(im.shape[0] * s_)), interpolation=cv2.INTER_AREA) if s_ < 1 else im,
                            [cv2.IMWRITE_JPEG_QUALITY, 85])
                sweep.append(dict(wSem=vd["w_sem"], name=nm, lowestSlc=(k == win), seam=_seam_fields(r),
                                  previewUrl=f"/api/runs/{self.id}/artifacts/artifacts/sweep/{nm}.jpg"))
            vdict = vdicts[win]
            row = rows[win]
        else:
            vdict = vdicts[0]
            row = rows[0]
        name = B.vname(**vdict)
        src = self.dir / "work" / "passB" / self.v / name / "mosaic.png"
        shutil.copyfile(src, self.dir / ".mosaic.png.tmp")
        os.replace(self.dir / ".mosaic.png.tmp", self.dir / "mosaic.png")
        img = cv2.imread(str(self.dir / "mosaic.png"))
        mh, mw = img.shape[:2]
        s = min(1.0, 1600 / max(mh, mw))
        prev = cv2.resize(img, (max(1, int(mw * s)), max(1, int(mh * s))), interpolation=cv2.INTER_AREA) if s < 1 else img
        cv2.imwrite(str(self.dir / ".mosaic_preview.png.tmp.png"), prev)
        os.replace(self.dir / ".mosaic_preview.png.tmp.png", self.dir / "mosaic_preview.png")
        write_json_atomic(self.dir / "artifacts" / "composition_metrics.json", rows if sweep else row)
        self._sweep = sweep
        self.end("composite", time.time() - t0)
        mosaic = dict(url=f"/api/runs/{self.id}/mosaic.png", width=mw, height=mh,
                      previewUrl=f"/api/runs/{self.id}/mosaic_preview.png",
                      previewWidth=prev.shape[1], previewHeight=prev.shape[0])
        self.ev.emit("mosaic.ready", mosaic=mosaic, variant=variant)

        # ---- absolute coverage (notebook cell 41) ----
        self.begin("coverage")
        t0 = time.time()
        cov = B.coverage_vs_observed(self.v)
        self.end("coverage", time.time() - t0)

        shutil.copyfile(A.PASSA / self.v / "trace.json", self.dir / "artifacts" / "trace.json")
        metrics = self._metrics(trace, cov, row, variant, mw, mh)
        metrics["viz"] = dict(enabled=self.viz_enabled, **(self.viz.summary() if self.viz else {}))
        write_json_atomic(self.dir / "metrics.json", metrics)
        self.manifest(status="succeeded", finished_at=now_iso(), computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
                      absolute_coverage=cov)
        self.ev.emit("run.completed", metrics=metrics)

    # ------------------------------------------------------------------ single-pair mode
    def _run_pair(self):
        """One DKM attempt on a chosen pair (pipeline/run.py:run_single_pair), fully visualised.
        No reference chain, composition or coverage: those need the whole video."""
        self.begin("preflight")
        t0 = time.time()
        if not DKM_WEIGHTS.exists():
            raise StageFailure("dkm_weights_missing", f"DKM weights not found at {DKM_WEIGHTS}")
        self.end("preflight", time.time() - t0)
        self._import_pipeline()
        self._link_caches()
        RUN = self.RUN
        RUN.set_workdirs(self.dir / "work" / "passA", self.dir / "work" / "passB")
        i, j = (int(x) for x in self.man["pair"])
        out = RUN.run_single_pair(self.v, i, j, seed=int(self.man["seed"]), hooks=self)
        attempt = R.dkm_attempt(out["record"], False)
        gate = R.candidate_edge(i, j, out["probe"], False)
        result = dict(kind="pair", frameI=i, frameJ=j, gap=j - i, attempt=attempt, gate=gate,
                      nativeFrames=out["n_frames"], H=out["H"], device=self.man.get("device"), seed=int(self.man["seed"]),
                      sentToDkmAlthoughGateRejected=gate["rejectCause"] is not None,
                      viz=dict(enabled=self.viz_enabled, **(self.viz.summary() if self.viz else {})),
                      runtimeMs=int((time.time() - self.t0) * 1000), stageMs=self.stage_ms)
        write_json_atomic(self.dir / "metrics.json", result)
        self.manifest(status="succeeded", finished_at=now_iso(), computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
                      inverse_selftest=dict(tol=1e-3, passed=True))
        self.ev.emit("run.completed", metrics=None, pair=result)

    # ------------------------------------------------------------------ stage hooks
    def _after_decode(self):
        # end("decode") fires inside run_pass_a before MANIFESTS is assigned; the notebook's
        # decode_native has already written this file
        man = read_json(self.A.PASSA / self.v / "frames_manifest.json")
        self.manifest(native_frames=man["n_frames"], fps=man["fps"], working_resolution=man["working_resolution"],
                      source_resolution=man["source_resolution"], duration_s=man["duration_s"])
        self.ev.emit("video.decoded", nativeFrames=man["n_frames"], fps=man["fps"],
                     workingResolution=man["working_resolution"], sourceResolution=man["source_resolution"])

    def _after_select(self):
        A, v = self.A, self.v
        sel = A.SELECTION[v]
        planned = [int(x) for x in sel["planned"]]
        hops = set(zip(planned, planned[1:]))
        recs = [R.candidate_edge(i, j, r, (i, j) in hops) for (i, j), r in sorted(A.PROBES[v].items())]
        for k in range(0, len(recs), BATCH):
            chunk = recs[k:k + BATCH]
            append_jsonl(self.steps_p, chunk)
            self.ev.emit("edges.batch", records=chunk)
        rej = {c: 0 for c in ("PROXY_FIT_FAILED", "GATE_IOU", "GATE_FM")}
        for r in recs:
            if r["rejectCause"]:
                rej[r["rejectCause"]] += 1
        selection = dict(
            nativeFrames=sel["n_native"], candidateGaps=list(C.CANDIDATE_GAPS), candidateEdges=sel["n_candidates"],
            probed=len(recs), passing=sel["n_edges"], rejects=rej, gateBinding=sel["gate_binding"],
            plannedPath=planned, greedyPath=[int(x) for x in sel["greedy"]],
            omega=C.OMEGA, iouTrust=C.IOU_TRUST, gateScore=C.GATE_SCORE,
            describeMs=self.stage_ms.get("sift"), describeCached=self.stage_cached.get("sift", False),
            probeMs=self.stage_ms.get("probe"),
        )
        write_json_atomic(self.dir / "artifacts" / "selection.json", selection)
        self.ev.emit("selection.done", selection=selection)

    def _write_observed(self):
        np = self.np
        d = self.A.PASSA / self.v / "reference"
        obs = np.load(d / "observed.npz")
        ch = np.load(d / "chain.npz")
        T, s = obs["T"], float(obs["scale"])
        cw, chh = (int(x) for x in obs["canvas"])
        px = int(obs["mask"].sum())
        origin = [float(-T[0, 2] / s), float(-T[1, 2] / s)]
        write_json_atomic(self.dir / "observed_area.json",
                          dict(A_observed_px=px, canvas_w=cw, canvas_h=chh, origin=origin, scale=s))
        import cv2
        cv2.imwrite(str(self.dir / "artifacts" / "observed_area_mask.png"), obs["mask"].astype("uint8") * 255)
        breaks = [int(b) for b in ch["breaks"]] if "breaks" in ch.files else []
        self.manifest(chain_breaks=breaks, observed_area_px=px)
        self.ev.emit("reference.done", reference=dict(observedAreaPx=px, canvasW=cw, canvasH=chh, scale=s,
                                                      chainBreaks=len(breaks), breakFrames=breaks))

    # ------------------------------------------------------------------ per-pair visualisation
    # _attempt_begin runs BEFORE the notebook's t1, so nothing here is inside durationMs.
    # _substage runs INSIDE the timed region: it only takes a timestamp and enqueues it; a
    # writer thread turns the timestamps into events. With viz off it returns immediately.
    def _substage(self, name):
        if self.viz_enabled:
            self.sub_q.put(("mark", name, time.perf_counter()))

    def _substage_writer(self):
        attempt, last, last_t, t_start = None, None, None, None
        while True:
            kind, a, t = self.sub_q.get()
            try:
                if kind == "begin":
                    attempt, last, last_t, t_start = a, None, t, t
                    self.sub_log[attempt] = []
                    continue
                if attempt is None:       # a marker with no pair in flight (e.g. failure before DKM)
                    continue
                name = a
                prev_ms = round((t - last_t) * 1000, 1) if last is not None else None
                if last is not None:
                    self.sub_log[attempt].append(dict(name=last, ms=prev_ms))
                self.ev.emit("pair.substage", attempt=attempt, stage=None if name in (None, "__done__") else name,
                             timedEnd=name is None, prev=last, prevMs=prev_ms,
                             sinceStartMs=round((t - t_start) * 1000, 1))
                last, last_t = (None if name in (None, "__done__") else name), t
            finally:
                self.sub_q.task_done()

    def _attempt_begin(self, video, a_id, ref, src):
        self.check()
        self.inflight = (int(a_id), int(ref), int(src), time.time())
        self.ev.emit("stage.update", stage="dkm", status="active", progress=None,
                     counter=dict(done=int(a_id) - 1, total=None, unit="attempts"), cached=False, durationMs=None)
        if self.viz_enabled:
            if self.viz is None:
                from .viz import PairViz
                self.viz = PairViz(self.dir, self.id, self.A, self.v, keep=int(self.man.get("vizKeep", 50)))
            self.ev.emit("pair.start", pair=self.viz.start(int(a_id), int(ref), int(src)))
            self.sub_q.put(("begin", int(a_id), time.perf_counter()))
            self.sub_q.join()

    def _step(self, video, rec, planned_len):
        r = R.dkm_attempt(rec, replanned=self.last_rejected)
        if self.viz_enabled and self.viz is not None:
            self._substage("__done__")
            self.sub_q.join()          # every sub-stage event is on disk before the verdict
            corr = self.A.PASSA / self.v / "steps" / f"corr_{r['attempt']:05d}.npz"
            done = self.viz.done(r, self.sub_log.get(r["attempt"], []), corr, bool(r["accepted"]))
            self.ev.emit("pair.done", pair=done, record=r)
        self.inflight = None
        self.n_attempts += 1
        self.n_accepted += int(r["accepted"])
        self.last_rejected = not r["accepted"]
        self.attempt_ms.append(r["durationMs"])
        append_jsonl(self.steps_p, [r])
        remaining = (planned_len - 2) if r["accepted"] else None
        mean = sum(self.attempt_ms) / len(self.attempt_ms)
        self.ev.emit_many([
            ("dkm.attempt", dict(record=r)),
            ("stage.update", dict(stage="dkm", status="active", progress=None, cached=False, durationMs=None,
                                  counter=dict(done=self.n_attempts, total=None, unit="attempts"))),
            ("metrics", dict(metrics=dict(
                elapsedMs=int((time.time() - self.t0) * 1000), attempts=self.n_attempts, accepted=self.n_accepted,
                msPerAttempt=mean, remainingHopsOnPlan=remaining,
                # an estimate that assumes no further rejections; null right after a rejection
                etaMs=int(remaining * mean) if remaining is not None else None))),
        ])
        self.check()

    # ------------------------------------------------------------------ results
    def _metrics(self, trace, cov, row, variant, mw, mh) -> dict:
        A, v = self.A, self.v
        man, sel = A.MANIFESTS[v], A.SELECTION[v]
        n, fps = int(man["n_frames"]), man["fps"]
        obs = read_json(self.dir / "observed_area.json", {})
        s2 = {c: 0 for c in ("DEGENERATE_H", "RATIO_BELOW_MIN", "EXCEPTION")}
        attempts = [R.dkm_attempt(a, False) for a in trace["attempts"]]
        for a in attempts:
            if a["rejectCause"]:
                s2[a["rejectCause"]] += 1
        s1 = {c: 0 for c in ("PROXY_FIT_FAILED", "GATE_IOU", "GATE_FM")}
        for (i, j), r in A.PROBES[v].items():
            c = R.STAGE1_CAUSE[r["reject"]]
            if c:
                s1[c] += 1
        dur = [a["durationMs"] for a in attempts]
        comp = [int(x) for x in trace["composited_frames"]]
        return dict(
            absoluteCoverage=cov, observedAreaPx=obs.get("A_observed_px"),
            referenceChainBreaks=len(self.man.get("chain_breaks") or []),
            nativeFrames=n, fps=fps, workingResolution=man["working_resolution"],
            stage1=dict(candidateEdges=sel["n_candidates"], probed=len(A.PROBES[v]), passing=sel["n_edges"], rejects=s1,
                        plannedPath=[int(x) for x in sel["planned"]], gateBinding=sel["gate_binding"],
                        describeMs=self.stage_ms.get("sift"), describeCached=self.stage_cached.get("sift", False),
                        probeMs=self.stage_ms.get("probe"),
                        msPerProbe=(self.stage_ms["probe"] / max(1, len(A.PROBES[v]))) if self.stage_ms.get("probe") is not None else None),
            stage2=dict(attempts=len(attempts), accepted=sum(a["accepted"] for a in attempts), rejects=s2,
                        composited=comp, nComposited=len(comp), reachedLast=bool(trace["reached_last"]),
                        lastFrame=comp[-1] if comp else None, dkmMs=self.stage_ms.get("dkm"),
                        msPerAttempt=(sum(dur) / len(dur)) if dur else None, estimator=self.man.get("estimator")),
            composition=dict(variant=variant["kind"], variantName=variant["name"], composeMs=self.stage_ms.get("composite"),
                             seam=_seam_fields(row), sweep=getattr(self, "_sweep", None),
                             seamFallbackSteps=int(row.get("seam_fallback", 0)), semPadded=int(row.get("sem_padded", 0)),
                             semDegenerate=int(row.get("sem_degenerate", 0)), mosaicWidth=mw, mosaicHeight=mh),
            baselines=dict(nfps=R.nfps_baseline(n, fps), nativeChain=dict(frames=n, dkmCalls=max(0, n - 1))),
            runtimeMs=int((time.time() - self.t0) * 1000), stageMs=self.stage_ms, stageCached=self.stage_cached,
            device=self.man.get("device"), seed=int(self.man["seed"]),
        )

    # ------------------------------------------------------------------ terminal paths
    def _finish_cancelled(self):
        stage = self.stage
        if stage:
            self.ev.emit("stage.update", stage=stage, status="cancelled", progress=None, counter=None,
                         cached=False, durationMs=None)
        self.manifest(status="cancelled", finished_at=now_iso(), cancelled_stage=stage)
        self.ev.emit("run.cancelled", stage=stage, killed=False)
        print(f"cancelled during stage {stage}", flush=True)

    def _finish_failed(self, e: BaseException):
        stage = self.stage or "preflight"
        traceback.print_exc()               # full traceback -> run.log (stderr)
        if self.viz_enabled:
            self._substage("__done__")
            self.sub_q.join()
        sys.stderr.flush()
        if self.inflight is not None and stage == "dkm":
            a_id, ref, src, t0 = self.inflight
            probe = (getattr(self, "A", None) and self.A.PROBES.get(self.v, {}).get((ref, src))) or {}
            r = R.exception_attempt(a_id, ref, src, probe, e, time.time() - t0)
            append_jsonl(self.steps_p, [r])
            self.ev.emit("dkm.attempt", record=r)
        tb = traceback.format_exception(e)
        err = dict(code=getattr(e, "code", None) or type(e).__name__, exceptionType=type(e).__name__,
                   message=str(e) or type(e).__name__, stage=stage, hint=getattr(e, "hint", None),
                   tracebackTail="".join(tb[-3:])[-2000:])
        self.ev.emit("stage.update", stage=stage, status="failed", progress=None, counter=None,
                     cached=False, durationMs=None)
        self.manifest(status="failed", finished_at=now_iso(), failed_stage=stage, error=err)
        self.ev.emit("run.failed", error=err)


def main() -> int:
    run_dir = Path(sys.argv[1]).resolve()
    (run_dir / "artifacts").mkdir(exist_ok=True)
    return Worker(run_dir).run()


if __name__ == "__main__":
    sys.exit(main())
