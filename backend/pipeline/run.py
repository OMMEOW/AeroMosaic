"""Run one video end to end, calling the notebook's functions in the notebook's order.

This is the body of NB_L2 cell 18 (one iteration of `for v in ALL_VIDEOS`), then cell
39 (`run_variants`) and cell 41 (`coverage_vs_observed`) for that one video. It adds no
pipeline logic: only where files go, seeding, and hooks for progress.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from . import _nb_pass_a as A
from . import _nb_pass_b as B
from .config import CANDIDATE_GAPS, PROBE_NFEATURES, RANDOM_SEED
from .device import seed_all, selftest_batched_inverse


def set_workdirs(passa: Path, passb: Path) -> None:
    passa.mkdir(parents=True, exist_ok=True)
    passb.mkdir(parents=True, exist_ok=True)
    for m in (A, B):
        m.PASSA, m.PASSB = passa, passb


class StageHooks:
    """Called around each stage of run_pass_a. The server overrides these; they add no logic."""

    def begin(self, stage: str, cached: bool = False) -> None: ...

    def end(self, stage: str, seconds: float, cached: bool = False) -> None: ...


def run_pass_a(v: str, seed: int = RANDOM_SEED, hooks: StageHooks | None = None) -> dict:
    """NB_L2 cell 18, one video. Returns per-stage wall times (s; 'cached' if served from disk)."""
    hooks = hooks or StageHooks()
    # Refuse to run DKM if the batched inverse it relies on is wrong on this device (see device.py).
    hooks.begin("selftest")
    t0 = time.time()
    selftest = selftest_batched_inverse(A.DEVICE)
    hooks.end("selftest", time.time() - t0)
    seed_all(seed)
    times: dict[str, float | str] = {"inverse_selftest_max_rel_err": selftest["max_rel_err"]}
    d = A.PASSA / v

    def timed(label, fn, cached_check):
        was_cached = cached_check()
        hooks.begin(label, was_cached)
        t0 = time.time()
        out = fn()
        dt = time.time() - t0
        hooks.end(label, dt, was_cached)
        times[label] = "cached" if was_cached else round(dt, 1)
        return out

    A.MANIFESTS[v] = timed("decode", lambda: A.decode_native(v), lambda: (d / "frames_manifest.json").exists())
    A.DESC[v] = timed("sift", lambda: A.build_descriptors(v), lambda: (d / f"sift_{PROBE_NFEATURES}.npz").exists())

    n = A.MANIFESTS[v]["n_frames"]
    e_p = d / "edges.npz"
    if e_p.exists():
        edges = np.load(e_p, allow_pickle=True)["edges"].item()
        times["probe"] = "cached"
    else:
        hooks.begin("probe")
        t0 = time.time()
        edges = A.build_edges(v)
        np.savez_compressed(e_p, edges=np.array(edges, dtype=object))
        times["probe"] = round(time.time() - t0, 1)
        hooks.end("probe", time.time() - t0)
    hooks.begin("select")
    t0 = time.time()
    A.EDGES[v] = set(edges.keys())
    total = sum(max(0, n - g) for g in CANDIDATE_GAPS)
    A.SELECTION[v] = dict(planned=A.solve_path(A.EDGES[v], 0, n),
                          greedy=A.select_greedy(A.EDGES[v], n), n_native=n,
                          n_edges=len(edges), n_candidates=total,
                          gate_binding=bool(len(edges) < total))
    hooks.end("select", time.time() - t0)

    A.REFERENCE[v] = timed("reference", lambda: A.build_reference(v),
                           lambda: (d / "reference" / "chain.npz").exists())
    if not (d / "reference" / "observed.npz").exists():
        A.observed_area(v)

    hooks.begin("dkm")
    t0 = time.time()
    A.TRACES[v] = A.run_geometry_replan(v)
    times["dkm"] = round(time.time() - t0, 1)
    hooks.end("dkm", time.time() - t0)
    return times


def run_single_pair(v: str, ref: int, src: int, seed: int = RANDOM_SEED, hooks: StageHooks | None = None) -> dict:
    """One DKM attempt on an arbitrary pair (demo / investigating an edge).

    Decode and SIFT-500 as in run_pass_a; the probe is run for this one pair only (so the gate
    evidence is real); then ONE iteration of notebook cell 16's attempt body -- same calls, same
    order, same accept rule (H is not None and inlier_ratio >= MIN_RATIO), same record fields.
    The pair is sent to DKM whether or not it passes the gate; the gate verdict is reported.
    """
    import cv2

    hooks = hooks or StageHooks()
    hooks.begin("selftest")
    t0 = time.time()
    selftest_batched_inverse(A.DEVICE)
    hooks.end("selftest", time.time() - t0)
    seed_all(seed)
    d = A.PASSA / v
    for label, fn, chk in (("decode", lambda: A.decode_native(v), lambda: (d / "frames_manifest.json").exists()),
                           ("sift", lambda: A.build_descriptors(v), lambda: (d / f"sift_{PROBE_NFEATURES}.npz").exists())):
        cached = chk()
        hooks.begin(label, cached)
        t0 = time.time()
        out = fn()
        hooks.end(label, time.time() - t0, cached)
        if label == "decode":
            A.MANIFESTS[v] = out
        else:
            A.DESC[v] = out
    n = A.MANIFESTS[v]["n_frames"]
    if not (0 <= ref < src < n):
        raise ValueError(f"pair ({ref}, {src}) is outside 0 <= i < j < {n}")

    hooks.begin("probe")
    t0 = time.time()
    kps, des, _ = A.DESC[v]
    W, H_ = A.MANIFESTS[v]["working_resolution"]
    A.PROBES.setdefault(v, {})[(ref, src)] = A.probe_pair(kps[ref], des[ref], kps[src], des[src], (H_, W))
    hooks.end("probe", time.time() - t0)

    hooks.begin("dkm")
    t0 = time.time()
    out = d
    (out / "steps").mkdir(parents=True, exist_ok=True)
    fp = lambda i: d / "frames" / f"{i:06d}.png"  # noqa: E731
    cur, nxt, a_id = ref, src, 1
    # ---- notebook cell 16, one attempt ----
    A._attempt_begin(v, a_id, cur, nxt)
    t1 = time.time()
    A._substage("load")
    kA, kB, warp_A, cert_A, Ai, Bi = A.dkm_match(fp(cur), fp(nxt))
    Hm, stats = A.dual_layer(kA, kB, Ai.shape, Bi.shape)
    A._substage("cache")
    srcp = np.asarray(kB, np.float32); dstp = np.asarray(kA, np.float32)
    if Hm is not None and len(srcp):
        proj = cv2.perspectiveTransform(srcp.reshape(-1, 1, 2), Hm).reshape(-1, 2)
        inlier = np.linalg.norm(proj - dstp, axis=1) < A.TAU_R
    else:
        inlier = np.zeros(len(srcp), bool)
    np.savez_compressed(out / "steps" / f"corr_{a_id:05d}.npz", ref_frame=cur, src_frame=nxt, src=srcp, dst=dstp,
                        inlier=inlier, H=(np.asarray(Hm) if Hm is not None else np.full((3, 3), np.nan)))
    A._substage(None)
    ok = Hm is not None and stats.get("inlier_ratio", 0.0) >= A.MIN_RATIO
    _pr = A.PROBES[v][(cur, nxt)]
    rec = dict(attempt=a_id, ref_frame=int(cur), src_frame=int(nxt), gap=int(nxt - cur), accepted=bool(ok), planned_len=2,
               t_step=time.time() - t1,
               **{k: float(x) for k, x in stats.items() if not k.startswith("_") and isinstance(x, (int, float, np.floating))})
    rec.update(f_m=float(_pr.get("f_m", float("nan"))), f_u=float(_pr.get("f_u", float("nan"))),
               probe_iou=float(_pr.get("iou", float("nan"))), probe_S=float(_pr.get("S", float("nan"))),
               estimator=stats.get("estimator"))
    if not ok:
        rec["reject_reason"] = ("homography fit failed" if Hm is None else
                                f"inlier ratio {stats.get('inlier_ratio', 0.0):.3f} < {A.MIN_RATIO}")
    if ok:
        A._substage("residuals")
        d_geo = A.dense_geo_residual(warp_A, Hm, Ai.shape, Bi.shape)
        d_phot, _unknown = A.photometric_residual(Ai, Bi, Hm)
        rec["d_geo_p95"] = float(np.nanpercentile(d_geo, 95))
        rec["d_phot_p95"] = float(np.nanpercentile(d_phot, 95))
    A._step(v, rec, 2)
    hooks.end("dkm", time.time() - t0)
    return dict(record=rec, probe=_pr, H=None if Hm is None else np.asarray(Hm).tolist(), n_frames=n)
