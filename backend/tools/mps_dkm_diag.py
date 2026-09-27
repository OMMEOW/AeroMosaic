"""Diagnose DKM on MPS: are consecutive match() calls correct, and what fixes them?

For two real road5 frame pairs (the notebook's first two DKM attempts), compare MPS
outputs to a CPU reference across repeated consecutive calls, under three conditions:
  none        : no intervention (what the original notebook does)
  empty_cache : torch.mps.empty_cache() before each match (the package patch)
  synchronize : torch.mps.synchronize() before each match (ordering only, no cache release)
Reports NaN/inf counts and max |MPS - CPU| for warp and certainty per call.
"""
import json
import os
import sys
from pathlib import Path

os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
sys.path.insert(0, str(Path.home() / "My Stuff" / "Major" / "DKM"))
import torch  # noqa: E402
from dkm import DKMv3_outdoor  # noqa: E402

F = Path(sys.argv[1])  # frames dir
PAIRS = [(0, 1), (1, 9)]
REPS = 4
fp = lambda i: str(F / f"{i:06d}.png")  # noqa: E731


def model(dev):
    m = DKMv3_outdoor(device=torch.device(dev))
    m.upsample_preds = False
    return m


with torch.no_grad():
    cpu = model("cpu")
    ref = {p: [t.float() for t in cpu.match(fp(p[0]), fp(p[1]), device=torch.device("cpu"))] for p in PAIRS}
    del cpu

    results = {}
    for cond in ("none", "empty_cache", "synchronize"):
        m = model("mps")
        rows = []
        for r in range(REPS):
            for p in PAIRS:
                if cond == "empty_cache":
                    torch.mps.empty_cache()
                elif cond == "synchronize":
                    torch.mps.synchronize()
                warp, cert = m.match(fp(p[0]), fp(p[1]), device=torch.device("mps"))
                w, c = warp.float().cpu(), cert.float().cpu()
                rw, rc = ref[p]
                rows.append(dict(rep=r, pair=p,
                                 warp_nonfinite=int((~torch.isfinite(w)).sum()), cert_nonfinite=int((~torch.isfinite(c)).sum()),
                                 cert_neg=int((c < 0).sum()),
                                 max_d_warp=float((w - rw).abs().nan_to_num(float("inf")).max()),
                                 max_d_cert=float((c - rc).abs().nan_to_num(float("inf")).max())))
        results[cond] = rows
        del m
        torch.mps.empty_cache()

for cond, rows in results.items():
    print(f"\n== {cond}")
    for r in rows:
        print(f"  rep {r['rep']} pair {r['pair']}: nonfinite warp {r['warp_nonfinite']:>8d} cert {r['cert_nonfinite']:>8d} "
              f"neg {r['cert_neg']:>6d} | max|Δ| vs CPU warp {r['max_d_warp']:.3e} cert {r['max_d_cert']:.3e}")
Path(sys.argv[2]).write_text(json.dumps(results, indent=1))
