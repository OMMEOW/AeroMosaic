"""Inlier-ratio distribution for fixed road5 pairs across seeds, on one device.

Separates device differences (CPU vs MPS) from DKM sampling noise: CPU and MPS draw
torch.multinomial from different RNG streams, so a single-seed CPU-vs-MPS diff mixes both.
Usage: UAV_DEVICE=cpu|mps .venv/bin/python tools/pair_noise.py FRAMES_DIR OUT.json
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline import _nb_pass_a as A  # noqa: E402
from pipeline.device import seed_all  # noqa: E402

F = Path(sys.argv[1])
PAIRS = [(201, 217), (137, 153), (41, 73)]   # the flipped step, and two steadier ones
SEEDS = range(10)
out = {"device": A.DEVICE, "pairs": {}}
for a, b in PAIRS:
    vals = []
    for s in SEEDS:
        seed_all(s)
        kA, kB, warp_A, cert_A, IA, IB = A.dkm_match(F / f"{a:06d}.png", F / f"{b:06d}.png")
        H, st = A.dual_layer(kA, kB, IA.shape, IB.shape)
        vals.append(float(st.get("inlier_ratio", 0.0)))
    out["pairs"][f"{a}->{b}"] = vals
    print(f"{A.DEVICE} {a}->{b}: mean {sum(vals)/len(vals):.4f} min {min(vals):.4f} max {max(vals):.4f} "
          f"accepted {sum(v >= A.MIN_RATIO for v in vals)}/{len(vals)}", flush=True)
Path(sys.argv[2]).write_text(json.dumps(out, indent=1))
