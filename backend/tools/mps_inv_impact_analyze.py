"""Analyse parity/impact: decision flips between arms, and omega re-derivation per arm."""
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

D = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "parity" / "impact")
pairs = json.loads((D / "pairs.json").read_text())
arms = {a: json.loads((D / f"arm_{a}.json").read_text()) for a in ("broken", "fixed", "cpu")}
n = len(pairs)


def flips(a, b, idx=None):
    idx = range(n) if idx is None else idx
    idx = list(idx)
    f = [k for k in idx if arms[a][k]["accepted"] != arms[b][k]["accepted"]]
    return len(f), len(idx), f


def dratio(a, b, idx):
    return [abs(arms[a][k]["inlier_ratio"] - arms[b][k]["inlier_ratio"]) for k in idx]


groups = {"all": list(range(n))}
for k, p in enumerate(pairs):
    groups.setdefault(f"set={p['set']}", []).append(k)
    groups.setdefault(f"video={p['video']}", []).append(k)
    groups.setdefault(f"gap={p['gap']}", []).append(k)

print("## Decision flips\n")
print("| Group | pairs | broken vs fixed | fixed vs CPU | broken vs CPU | median / max |Δ ratio| broken−fixed |")
print("|---|---|---|---|---|---|")
for g, idx in groups.items():
    bf, nn, _ = flips("broken", "fixed", idx)
    fc, _, _ = flips("fixed", "cpu", idx)
    bc, _, _ = flips("broken", "cpu", idx)
    dr = dratio("broken", "fixed", idx)
    print(f"| {g} | {nn} | {bf} ({100 * bf / nn:.1f}%) | {fc} ({100 * fc / nn:.1f}%) | {bc} ({100 * bc / nn:.1f}%) | "
          f"{np.median(dr):.3f} / {max(dr):.3f} |")

_, _, fl = flips("broken", "fixed")
print("\n## Every broken↔fixed flip\n")
print("| # | set | video | anchor | gap | ratio broken | ratio fixed | ratio CPU | accepted broken→fixed | CPU |")
print("|---|---|---|---|---|---|---|---|---|---|")
for k in fl:
    p = pairs[k]
    print(f"| {k} | {p['set']} | {p['video']} | {p['anchor']} | {p['gap']} | {arms['broken'][k]['inlier_ratio']:.3f} | "
          f"{arms['fixed'][k]['inlier_ratio']:.3f} | {arms['cpu'][k]['inlier_ratio']:.3f} | "
          f"{arms['broken'][k]['accepted']}→{arms['fixed'][k]['accepted']} | {arms['cpu'][k]['accepted']} |")

print("\n## Inlier ratio level, by arm\n")
for a in arms:
    r = [x["inlier_ratio"] for x in arms[a]]
    print(f"- {a}: mean {np.mean(r):.4f}, accepted {sum(x['accepted'] for x in arms[a])}/{n}")

cal = groups["set=omega_calibration"]
pub = [pairs[k]["published_accepted"] for k in cal]
rep = sum(arms["broken"][k]["accepted"] == pairs[k]["published_accepted"] for k in cal)
print(f"\n## Reproduction check: broken arm vs the published calibration labels\n\n{rep}/{len(cal)} decisions match "
      f"the published labels (labeled_results.json).")
dpub = [abs(arms["broken"][k]["inlier_ratio"] - (pairs[k]["published_ratio"] or 0)) for k in cal if pairs[k]["published_ratio"] is not None]
print(f"median |Δ inlier ratio| broken vs published: {np.median(dpub):.4f}, max {max(dpub):.4f}")


def youden(score, y):
    ts = np.concatenate([[0], np.unique(score), [1]])
    P, N = y.sum(), (1 - y).sum()
    best = None
    for t in sorted(ts):
        pr = score >= t
        tp, fp = (pr & (y == 1)).sum(), (pr & (y == 0)).sum()
        j = tp / P - fp / N
        if best is None or j > best[0] + 1e-12:
            best = (j, t, int(tp), int(fp), int(P), int(N))
    return best


print("\n## omega re-derived per arm (same 121 candidates, same Youden procedure as calibrate_omega_analyze.py)\n")
print("| Labels from | accepted | S = min(f_m, f_u): t*, J | f_m alone: t*, J |")
print("|---|---|---|---|")
S = np.array([pairs[k]["S"] for k in cal])
FM = np.array([pairs[k]["f_m"] for k in cal])
for lab, y in (("published labels", np.array([1 if v else 0 for v in pub])),
               ("broken arm (re-run)", np.array([1 if arms["broken"][k]["accepted"] else 0 for k in cal])),
               ("fixed arm (A)", np.array([1 if arms["fixed"][k]["accepted"] else 0 for k in cal])),
               ("CPU reference", np.array([1 if arms["cpu"][k]["accepted"] else 0 for k in cal]))):
    a, b = youden(S, y), youden(FM, y)
    print(f"| {lab} | {int(y.sum())}/{len(y)} | {a[1]:.3f}, {a[0]:.4f} | {b[1]:.3f}, {b[0]:.4f} |")
