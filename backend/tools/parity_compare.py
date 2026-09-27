"""Compare parity runs (parity/runs/*) and print Markdown tables for PARITY.md."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

R = Path(__file__).resolve().parents[1] / "parity" / "runs"
CUDA = json.loads((R.parent / "cuda_recorded.json").read_text())
OMEGA, IOU_TRUST, MIN_RATIO = 0.164, 0.40, 0.35


def load(name):
    d = R / name
    if not (d / "summary.json").exists():
        return None
    s = json.loads((d / "summary.json").read_text())
    s["trace"] = json.loads((d / "trace.json").read_text())
    s["edges"] = {tuple(e) for e in json.loads((d / "edges.json").read_text())}
    s["probes"] = json.loads((d / "probes.json").read_text()) if (d / "probes.json").exists() else None
    z = np.load(d / "reference.npz")
    s["G"], s["n_breaks"] = z["G"], int(z["n_breaks"])
    s["man"] = json.loads((d / "manifest.json").read_text())
    return s


def nb_edge_records(name, video):
    """Full probe records of passing edges from the notebook run's own edges.npz."""
    p = R / name / "nb_root" / "passA" / video / "edges.npz"
    return np.load(p, allow_pickle=True)["edges"].item() if p.exists() else {}


def attempts(s):
    return s["trace"].get("attempts", [])


def cmp_attempts(a, b, label_a, label_b):
    n = min(len(a), len(b))
    same_pair = 0
    first_div = None
    d_in, dec_mismatch = [], []
    for k in range(n):
        x, y = a[k], b[k]
        if (x["ref_frame"], x["src_frame"]) != (y["ref_frame"], y["src_frame"]):
            first_div = k + 1
            break
        same_pair += 1
        d_in.append(abs(x.get("inlier_ratio", 0) - y.get("inlier_ratio", 0)))
        if bool(x["accepted"]) != bool(y["accepted"]):
            dec_mismatch.append((k + 1, x["ref_frame"], x["src_frame"], x.get("inlier_ratio"), y.get("inlier_ratio")))
    return dict(n_a=len(a), n_b=len(b), aligned=same_pair, first_divergence=first_div,
                max_d_inlier=max(d_in) if d_in else None, mean_d_inlier=float(np.mean(d_in)) if d_in else None,
                decision_mismatches=dec_mismatch, label=f"{label_a} vs {label_b}")


def fmt_cmp(c):
    dm = c["decision_mismatches"]
    mx = "—" if c["max_d_inlier"] is None else f"{c['max_d_inlier']:.4f}"
    mism = str(len(dm))
    if dm:
        mism += " — " + "; ".join(f"#{k} {r}→{t} {x:.3f} vs {y:.3f}" for k, r, t, x, y in dm)
    return f"| {c['label']} | {c['n_a']} / {c['n_b']} | {c['aligned']} | {c['first_divergence'] or '—'} | {mx} | {mism} |"


def main():
    out = []
    for v in ("road5", "suburban3"):
        nb, pk = load(f"nb_cpu_{v}"), load(f"pkg_mps_{v}")
        out.append(f"\n### {v}\n")
        if not nb or not pk:
            out.append(f"_missing run(s): nb={bool(nb)} pkg={bool(pk)}_\n")
            continue
        # decode / reference
        out.append("| Stage | notebook reference (Mac, CPU) | package (Mac, MPS, fix A) | Match |\n|---|---|---|---|")
        out.append(f"| Decoded frames | {nb['n_frames']} | {pk['n_frames']} | {'yes' if nb['n_frames'] == pk['n_frames'] else 'NO'} |")
        dG = float(np.abs(nb["G"] - pk["G"]).max())
        out.append(f"| Reference chain G (max abs diff) | — | — | {dG:.3e} ({'identical' if dG == 0 else 'differs'}) |")
        out.append(f"| Reference breaks | {nb['n_breaks']} | {pk['n_breaks']} | {'yes' if nb['n_breaks'] == pk['n_breaks'] else 'NO'} |")
        # gate
        pk_min = set()
        for p in pk["probes"]:
            ok = p["iou"] >= IOU_TRUST and p["n_put"] >= 4 and min(p["f_m"], p["f_u"]) >= OMEGA and p["reject"] not in ("descriptors", "putative", "proxy_homography")
            if ok:
                pk_min.add((p["i"], p["j"]))
        out.append(f"| Passing edges | {len(nb['edges'])} (min(f_m,f_u)) | {len(pk['edges'])} (f_m) | "
                   f"{'identical sets' if nb['edges'] == pk['edges'] else str(len(nb['edges'] ^ pk['edges'])) + ' differ'} |")
        out.append(f"| Package probes re-gated with min(f_m,f_u) | {len(nb['edges'])} | {len(pk_min)} | "
                   f"{'identical sets → probe stage reproduces exactly' if pk_min == nb['edges'] else 'DIFFER'} |")
        only_fm = sorted(pk["edges"] - nb["edges"])
        only_min = sorted(nb["edges"] - pk["edges"])
        if only_fm or only_min:
            recs = {(p["i"], p["j"]): p for p in pk["probes"]}
            for e in only_fm + only_min:
                p = recs.get(e, {})
                out.append(f"|  ↳ edge {e} | f_m {p.get('f_m', float('nan')):.3f}, f_u {p.get('f_u', float('nan')):.3f}, IoU {p.get('iou', float('nan')):.3f} | "
                           f"{'passes f_m gate only' if e in only_fm else 'passes min gate only'} | gate difference |")
        out.append(f"| Planned path | {len(nb['planned'])} frames | {len(pk['planned'])} frames | {'identical' if nb['planned'] == pk['planned'] else 'DIFFER'} |")
        out.append(f"| Composited frames | {len(nb['composited'] or [])} | {len(pk['composited'] or [])} | {'identical' if nb['composited'] == pk['composited'] else 'DIFFER'} |")
        out.append(f"| Absolute coverage | {nb['coverage']*100:.3f}% | {pk['coverage']*100:.3f}% | Δ {abs(nb['coverage']-pk['coverage'])*100:.4f} pp |")
        out.append(f"| DKM attempts / rejected | {len(attempts(nb))} / {sum(not a['accepted'] for a in attempts(nb))} | {len(attempts(pk))} / {sum(not a['accepted'] for a in attempts(pk))} | |")
        out.append(f"| Wall clock (s) | {nb['wall_s']} | {pk['wall_s']} | |")
        out.append(f"| Stage times (s) | {nb['times']} | {pk['times']} | |")
        c = cmp_attempts(attempts(nb), attempts(pk), "notebook CPU", "package MPS")
        pc = load(f"pkg_cpu_{v}")
        c_same = cmp_attempts(attempts(nb), attempts(pc), "notebook CPU", "package CPU (extraction fidelity)") if pc else None
        out.append("\nPer-attempt (aligned by attempt order):\n")
        out.append("| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |\n|---|---|---|---|---|---|")
        out.append(fmt_cmp(c))
        if c_same:
            out.append(fmt_cmp(c_same))
            dG2 = float(np.abs(nb["G"] - pc["G"]).max())
            out.append(f"\nPackage CPU vs notebook CPU: reference chain max |ΔG| = {dG2:.3e}; edges identical after re-gating: see above; coverage Δ {abs(nb['coverage'] - pc['coverage'])*100:.6f} pp; composited identical: {nb['composited'] == pc['composited']}.\n")
        out.append("\nProbe values (f_m, f_u, IoU) per edge: the notebook harness keeps only the passing-edge set, not per-edge "
                   "values, so values are compared through the edge sets (identical above) rather than number by number.\n")
        # CUDA recorded (cross-configuration)
        cu = CUDA["videos"].get(v)
        if cu:
            cu_att = [dict(ref_frame=s["ref"], src_frame=s["src"], inlier_ratio=s["inlier"], accepted=s["accepted"]) for s in cu["steps"]]
            c2 = cmp_attempts(cu_att, attempts(pk), "CUDA recorded (Windows, GC-RANSAC, min gate)", "package (Mac, MPS, MAGSAC, f_m gate)")
            out.append("Cross-configuration measurement (NOT a parity reference — different estimator, gate, decoder, platform):\n")
            out.append("| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |\n|---|---|---|---|---|---|")
            out.append(fmt_cmp(c2))
            out.append(f"\nCUDA recorded: {cu.get('n_edges')} edges, A_observed {cu.get('A_observed')}; composited {cu.get('n_composited')}, "
                       f"{cu.get('n_attempts')} attempts ({cu.get('n_rejected')} rejected). Package: {len(pk['edges'])} edges, "
                       f"{len(pk['composited'] or [])} composited, {len(attempts(pk))} attempts ({sum(not a['accepted'] for a in attempts(pk))} rejected).\n")

    # controls on road5 (first 12 attempts)
    base = load("pkg_mps_road5")
    out.append("\n### Controls on road5 (first 12 DKM attempts)\n")
    out.append("| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |\n|---|---|---|---|---|---|")
    for name, label in (("pkg_mps_road5_fp32", "fp32 KDE vs fp16 KDE (MPS)"),
                        ("pkg_mps_road5_seed1", "seed 1 vs seed 0 (MPS) — sampling noise")):
        s = load(name)
        if s and base:
            a = attempts(s)
            b = attempts(base)[:len(a)] if a else []
            # truncated runs keep no trace; fall back to the log
            if not a:
                a = parse_log_attempts(R / f"{name}.log")
                b = attempts(base)[:len(a)]
            out.append(fmt_cmp(cmp_attempts(a, b, label.split(' vs ')[0], label.split(' vs ')[1])))
        else:
            out.append(f"| {label} | missing | | | | |")
    print("\n".join(out))


def parse_log_attempts(p):
    import re
    res = []
    for line in p.read_text(errors="ignore").splitlines():
        m = re.match(r"\s*\[(OK |REJ)\] #\s*(\d+)\s+(\d+) ->\s+(\d+) \(gap\s+(\d+)\)\s+inlier ([\d.]+)", line)
        if m:
            res.append(dict(ref_frame=int(m.group(3)), src_frame=int(m.group(4)), inlier_ratio=float(m.group(6)), accepted=m.group(1) == "OK "))
    return res


if __name__ == "__main__":
    main()
