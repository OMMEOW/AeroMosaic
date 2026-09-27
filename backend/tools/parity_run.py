"""Parity runner: Pass A + coverage for one video, from either implementation.

  --impl notebook : executes NB_L2's ORIGINAL cell sources (unpatched: min(f_m, f_u) gate,
                    notebook device logic) in a fresh namespace. Only the Windows project
                    path and the own-videos folder name are substituted. DEVICE is set after
                    cell 4 runs (the notebook's resolver only knows cuda/cpu).
  --impl package  : backend/pipeline (generated from the same cells + patches).

Both seed numpy, OpenCV and torch identically at the start of the video (the notebook
itself never seeds torch; seeding both is what makes a like-for-like comparison possible).

Outputs to --out: trace.json, edges.json (passing edges), probes.json (package only: every
candidate with f_m/f_u/iou/reject), manifest.json, reference.npz, summary.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--impl", choices=["notebook", "package"], required=True)
ap.add_argument("--video", required=True)
ap.add_argument("--device", choices=["mps", "cpu"], default="mps")
ap.add_argument("--out", required=True)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--kde", choices=["fp16", "fp32"], default="fp16",
                help="fp32 = measure the effect of the notebook's half-precision KDE")
ap.add_argument("--max-attempts", type=int, default=0, help="stop DKM after N attempts (package only)")
ap.add_argument("--nb", default=str(Path(__file__).resolve().parents[2] / "web" / "NB_L2_full_pipeline.ipynb"))
args = ap.parse_args()

os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["UAV_DEVICE"] = args.device
os.environ["MPLBACKEND"] = "Agg"
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from pipeline import config as C  # noqa: E402
from pipeline.device import seed_all  # noqa: E402

OUT = Path(args.out)
OUT.mkdir(parents=True, exist_ok=True)
v = args.video
t_start = time.time()


def kde_fp32(x, std=0.1, batch_size=1000):
    # _kde_chunked without the .half() cast -- used only for the fp16-vs-fp32 measurement.
    density = torch.zeros(x.shape[0], device=x.device, dtype=x.dtype)
    for i in range(0, x.shape[0], batch_size):
        d = torch.cdist(x[i:i + batch_size], x)
        density[i:i + batch_size] = (-d ** 2 / (2 * std ** 2)).exp().sum(dim=-1)
    return density


if args.impl == "notebook":
    cells = json.loads(Path(args.nb).read_text())["cells"]
    src = lambda i: "".join(cells[i]["source"])  # noqa: E731
    ns: dict = {"__name__": "nb_l2"}
    c2 = src(2)
    c2 = c2.replace('PROJECT  = Path(r"C:\\Major Project\\UAV_Mosaicking_Project")',
                    f'PROJECT  = Path(r"{C.MAJOR}")')
    c2 = c2.replace('ROOT     = PROJECT / "evaluation_validation" / "leangate"', f'ROOT     = Path(r"{OUT / "nb_root"}")')
    c2 = c2.replace('DATA / "own_videos"', f'Path(r"{C.OWN_VIDEOS_DIR}")')
    assert f'Path(r"{C.MAJOR}")' in c2 and "nb_root" in c2, "cell 2 path substitution failed"
    for i in [2, 4]:
        exec(compile(c2 if i == 2 else src(i), f"<nb cell {i}>", "exec"), ns)
    ns["DEVICE"] = args.device                       # the only non-path override
    ns["DKM_REPO"] = C.DKM_REPO
    for i in [6, 7, 8, 9, 10, 11, 13, 14, 15, 16]:
        exec(compile(src(i), f"<nb cell {i}>", "exec"), ns)
    c41 = src(41)
    exec(compile(c41[:c41.index("COV = {")], "<nb cell 41 def>", "exec"), ns)
    if args.kde == "fp32":
        ns["_kde_mod"].kde = kde_fp32
    for k in ("MANIFESTS", "DESC", "EDGES", "SELECTION", "REFERENCE", "TRACES"):
        ns[k] = {}
    M = ns
    PASSA = ns["PASSA"]
else:
    from pipeline import _nb_pass_a as A, _nb_pass_b as B  # noqa: E402
    from pipeline import run as R  # noqa: E402
    R.set_workdirs(OUT / "passA", OUT / "passB")
    if args.kde == "fp32":
        A._kde_mod.kde = kde_fp32
    if args.max_attempts:
        class _Stop(Exception):
            pass
        def _step(video, rec, planned_len, _n=[0]):
            _n[0] += 1
            if _n[0] >= args.max_attempts:
                raise _Stop()
        A._step = _step
    M = None
    PASSA = A.PASSA

seed_all(args.seed)
times = {}
if args.impl == "notebook":
    # NB_L2 cell 18 body for one video (verbatim order; caching disabled by fresh dirs).
    d = PASSA / v
    t0 = time.time(); M["MANIFESTS"][v] = M["decode_native"](v); times["decode"] = round(time.time() - t0, 1)
    t0 = time.time(); M["DESC"][v] = M["build_descriptors"](v); times["sift"] = round(time.time() - t0, 1)
    n = M["MANIFESTS"][v]["n_frames"]
    t0 = time.time(); edges = M["build_edges"](v); times["probe"] = round(time.time() - t0, 1)
    M["EDGES"][v] = set(edges.keys())
    total = sum(max(0, n - g) for g in M["CANDIDATE_GAPS"])
    M["SELECTION"][v] = dict(planned=M["solve_path"](M["EDGES"][v], 0, n), greedy=M["select_greedy"](M["EDGES"][v], n),
                             n_native=n, n_edges=len(edges), n_candidates=total, gate_binding=bool(len(edges) < total))
    t0 = time.time(); M["REFERENCE"][v] = M["build_reference"](v); times["reference"] = round(time.time() - t0, 1)
    M["observed_area"](v)
    t0 = time.time(); M["TRACES"][v] = M["run_geometry_replan"](v); times["dkm"] = round(time.time() - t0, 1)
    trace, man, sel, ref = M["TRACES"][v], M["MANIFESTS"][v], M["SELECTION"][v], M["REFERENCE"][v]
    cov = M["coverage_vs_observed"](v)
    probes = None
    estimator = "gcransac" if M["HAS_GCRANSAC"] else "magsac"
else:
    try:
        times = R.run_pass_a(v, seed=args.seed)
        trace = A.TRACES[v]
    except Exception as e:  # --max-attempts stop
        if type(e).__name__ != "_Stop":
            raise
        trace = dict(attempts=[], truncated_at=args.max_attempts)
        times["note"] = f"stopped after {args.max_attempts} DKM attempts"
    man, sel, ref = A.MANIFESTS[v], A.SELECTION[v], A.REFERENCE[v]
    cov = B.coverage_vs_observed(v) if v in A.TRACES else None
    probes = [dict(i=i, j=j, gap=j - i, **{k: r[k] for k in ("f_m", "f_u", "iou", "S", "n_put", "n_in", "ok", "reject")})
              for (i, j), r in sorted(A.PROBES[v].items())]
    edges = {k: r for k, r in A.PROBES[v].items() if r["ok"]}
    estimator = "gcransac" if A.HAS_GCRANSAC else "magsac"

(OUT / "trace.json").write_text(json.dumps(trace, indent=1, default=float))
(OUT / "edges.json").write_text(json.dumps(sorted([list(k) for k in edges.keys()])))
if probes is not None:
    (OUT / "probes.json").write_text(json.dumps(probes, default=float))
(OUT / "manifest.json").write_text(json.dumps(man, indent=1, default=str))
np.savez_compressed(OUT / "reference.npz", G=ref[0], n_breaks=ref[1])
summary = dict(impl=args.impl, video=v, device=args.device, seed=args.seed, kde=args.kde, estimator=estimator,
               torch=torch.__version__, n_frames=man["n_frames"], n_edges=len(edges),
               planned=sel["planned"], composited=trace.get("composited_frames"),
               n_attempts=len(trace.get("attempts", [])), coverage=cov, ref_breaks=int(ref[1]),
               times=times, wall_s=round(time.time() - t_start, 1))
(OUT / "summary.json").write_text(json.dumps(summary, indent=1, default=float))
print("SUMMARY", json.dumps({k: summary[k] for k in ("impl", "video", "device", "kde", "estimator", "n_frames", "n_edges", "n_attempts", "coverage", "wall_s")}, default=float))
