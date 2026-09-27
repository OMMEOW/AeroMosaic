"""MPS batched-inverse impact study.

Runs the EXACT DKM path the published runs used -- src/pipeline_b_zhou.DKMMatcher
(upsample_preds=False, its MPS flush + CPU sampling + non-finite clamp) followed by
dual_layer_geometric_constraint(ps, pd, tau_s=3.0, tau_r=4.0) and accept iff
n_inliers / n_matches >= 0.35 (calibrate_omega_dkm.py and tau_compare.run_one) -- in three
arms on the same pairs:

  broken : MPS, stock batched torch.linalg.inv (what the UMCD sweep and omega labels ran)
  fixed  : MPS, fix A (per-element inverse during match(), pipeline/device.py)
  cpu    : CPU reference

Every pair is seeded identically in every arm (torch, numpy, OpenCV) immediately before
matching, so arms differ only in the correspondence field DKM produces.

Run with the ORIGINAL environment:  Major/.venv-uav/bin/python tools/mps_inv_impact.py OUTDIR
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
M = Path.home() / "My Stuff" / "Major"
BACKEND = M / "uav-dashboard" / "backend"
sys.path.insert(0, str(M / "src"))
sys.path.insert(0, str(BACKEND))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402

from pipeline_b_zhou import DKMMatcher, dual_layer_geometric_constraint  # noqa: E402

import pipeline.device as DEV  # noqa: E402  (fix A context manager + stock inverse)

TAU_R, TAU_S, MIN_RATIO = 4.0, 3.0, 0.35
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
FR = OUT / "frames"
UMCD = [("dirt_path18", M / "data/umcd/Videos_Without_Telemetry/Mosaicking/Dirt/path18.mp4"),
        ("dirt_path19", M / "data/umcd/Videos_Without_Telemetry/Mosaicking/Dirt/path19.mp4")]
GAPS = [1, 2, 4, 8, 16, 32, 64]
ANCHOR_FRACS = [0.10, 0.30, 0.50, 0.70]
MAX_SIDE = 1920


def build_pairs():
    pairs = []
    cal = json.load(open(M / "results/17_omega_calibration/sample_candidates.json"))
    lab = {(r["video"], r["anchor"], r["gap"]): r for r in json.load(open(M / "results/17_omega_calibration/labeled_results.json"))}
    for c in cal:
        fd = M / "data/frames" / c["video"]
        r = lab.get((c["video"], c["anchor"], c["gap"]), {})
        pairs.append(dict(set="omega_calibration", video=c["video"], anchor=c["anchor"], gap=c["gap"],
                          ref=str(fd / c["ref_file"]), src=str(fd / c["src_file"]),
                          S=c["S"], f_m=c["fm"], f_u=c["fu"], iou=c["iou"],
                          published_accepted=r.get("accepted"), published_ratio=r.get("inlier_ratio")))
    for name, vp in UMCD:
        cap = cv2.VideoCapture(str(vp))
        frames = []
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            frames.append(fr)
        cap.release()
        n = len(frames)
        d = FR / name
        d.mkdir(parents=True, exist_ok=True)
        need = set()
        for f in ANCHOR_FRACS:
            a = int(n * f)
            for g in GAPS:
                if a + g < n:
                    need |= {a, a + g}
                    pairs.append(dict(set="umcd", video=name, anchor=a, gap=g,
                                      ref=str(d / f"frame_{a:06d}.png"), src=str(d / f"frame_{a + g:06d}.png")))
        for i in need:  # validate_all.decode resize, saved lossless like the sweep
            fr = frames[i]
            hh, ww = fr.shape[:2]
            s = MAX_SIDE / float(max(hh, ww))
            if s < 1.0:
                fr = cv2.resize(fr, (int(round(ww * s)), int(round(hh * s))), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(d / f"frame_{i:06d}.png"), fr, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    return pairs


def seed(k):
    torch.manual_seed(10_000 + k)
    np.random.seed(10_000 + k)
    cv2.setRNGSeed(10_000 + k)


def run_arm(arm, pairs):
    dev = "cpu" if arm == "cpu" else "mps"
    mk = DKMMatcher(str(M / "DKM"), device=dev)
    mk.model.upsample_preds = False
    rows = []
    for k, p in enumerate(pairs):
        ref_bgr, src_bgr = cv2.imread(p["ref"]), cv2.imread(p["src"])
        seed(k)
        t0 = time.perf_counter()
        if arm == "fixed":
            with DEV.mps_linalg_inv_fix("mps"):
                ps, pd = mk.match(p["ref"], p["src"], ref_bgr.shape, src_bgr.shape)
        else:
            assert torch.linalg.inv is DEV._STOCK_INV
            ps, pd = mk.match(p["ref"], p["src"], ref_bgr.shape, src_bgr.shape)
        n_matches = len(ps)
        H, mask, st = dual_layer_geometric_constraint(ps, pd, TAU_S, TAU_R)
        if H is None:
            n_in, ratio = 0, 0.0
        else:
            n_in = int(mask.sum())
            ratio = n_in / max(1, n_matches)
        rows.append(dict(k=k, n_matches=n_matches, n_inliers=n_in, inlier_ratio=ratio,
                         accepted=bool(H is not None and ratio >= MIN_RATIO), t_s=round(time.perf_counter() - t0, 2)))
        if k % 20 == 0:
            print(f"  {arm} {k + 1}/{len(pairs)}  {p['video']} gap {p['gap']}: ratio {ratio:.3f} acc {rows[-1]['accepted']}", flush=True)
    del mk
    return rows


_STOCK_PROBE = """
import sys; sys.path.insert(0, %r)
import pipeline.device as DEV
DEV.mps_inv_mode = lambda: "stock"
DEV._replacement = lambda m: DEV._STOCK_INV
try:
    DEV.selftest_batched_inverse("mps"); print("stock: passed")
except RuntimeError as e:
    print("stock:", e)
""" % str(BACKEND)


if __name__ == "__main__":
    # Each arm, and the stock-inverse probe, runs in its own process: exercising the broken
    # batched inverse corrupts MPS state for the rest of the process (observed: ratio 0.000 on a
    # pair the same code scores 0.569 in a fresh process, then a malloc trap in MPSGraph).
    import subprocess
    if len(sys.argv) > 2:  # child: one arm
        arm = sys.argv[2]
        pairs = json.loads((OUT / "pairs.json").read_text())
        if arm == "fixed":
            print("selftest fixed", DEV.selftest_batched_inverse("mps"), flush=True)
        t0 = time.time()
        rows = run_arm(arm, pairs)
        (OUT / f"arm_{arm}.json").write_text(json.dumps(rows, indent=1))
        print(f"arm {arm} done in {time.time() - t0:.0f}s", flush=True)
        sys.exit(0)
    print("torch", torch.__version__, "| python", sys.version.split()[0], flush=True)
    print(subprocess.run([sys.executable, "-c", _STOCK_PROBE], capture_output=True, text=True).stdout.strip(), flush=True)
    if not (OUT / "pairs.json").exists():
        (OUT / "pairs.json").write_text(json.dumps(build_pairs(), indent=1))
    print(f"{len(json.loads((OUT / 'pairs.json').read_text()))} pairs", flush=True)
    for arm in ("broken", "fixed", "cpu"):
        if (OUT / f"arm_{arm}.json").exists():
            print(f"skip {arm} (exists)")
            continue
        rc = subprocess.run([sys.executable, __file__, str(OUT), arm]).returncode
        print(f"arm {arm} rc={rc}", flush=True)
    print("ALL DONE", flush=True)
