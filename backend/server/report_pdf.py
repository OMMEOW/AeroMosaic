"""Run report as a real PDF, rendered from the run directory's own files (matplotlib, Agg).

Every number comes from manifest.json, metrics.json or steps.jsonl. Nothing is recomputed
except simple aggregates of those records (counts, means) that are also shown in the UI.
Cached at artifacts/report.pdf; regenerated when metrics.json is newer.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

from .jsonio import iter_jsonl, read_json  # noqa: E402

A4 = (8.27, 11.69)
INK, MUTED, OK, WARN, BAD, ACC = "#111827", "#6b7280", "#15803d", "#b45309", "#b91c1c", "#2563eb"


def _fmt(v, d=3):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return "—"
    if isinstance(v, float):
        return f"{v:.{d}f}"
    return str(v)


LOGO = Path(__file__).parent / "assets" / "logo.png"


def _page(pdf, title: str):
    """A4 page with the AeroMosaic mark and a title."""
    fig = plt.figure(figsize=A4)
    w = 0.035
    if LOGO.exists():
        lax = fig.add_axes([0.07, 0.955, w, w * A4[0] / A4[1]])
        lax.imshow(plt.imread(str(LOGO)))
        lax.set_axis_off()
    fig.text(0.07 + w + 0.012, 0.962, title, fontsize=14, weight="bold", color=INK)
    return fig


def _table(fig, rect, rows, col_w=None, fontsize=7.5, header=None):
    ax = fig.add_axes(rect)
    ax.axis("off")
    if not rows:
        ax.text(0, 1, "—", fontsize=fontsize, color=MUTED, va="top")
        return ax
    data = ([header] if header else []) + rows
    t = ax.table(cellText=data, loc="upper left", cellLoc="left", colWidths=col_w, edges="horizontal")
    t.auto_set_font_size(False)
    t.set_fontsize(fontsize)
    t.scale(1, 1.25)
    if header:
        for j in range(len(header)):
            t[0, j].set_text_props(weight="bold", color=MUTED)
    return ax


def build(run_dir: Path) -> Path:
    out = run_dir / "artifacts" / "report.pdf"
    met_p = run_dir / "metrics.json"
    if out.exists() and out.stat().st_mtime >= met_p.stat().st_mtime:
        return out
    man = read_json(run_dir / "manifest.json", {})
    m = read_json(met_p, {})
    recs = list(iter_jsonl(run_dir / "steps.jsonl"))
    edges = [r for r in recs if r.get("stage") == 1]
    atts = [r for r in recs if r.get("stage") == 2]
    variant = (man.get("variant") or {}).get("name", "—")
    s1, s2, comp = m["stage1"], m["stage2"], m["composition"]
    seam = comp.get("seam")
    if not seam:     # runs composed before seam metrics were copied into metrics.json
        row = read_json(run_dir / "artifacts" / "composition_metrics.json", {})
        row = row if isinstance(row, dict) else {}
        from .worker import SEAM_FIELDS
        seam = {k: row.get(k) for k in SEAM_FIELDS if k in row}

    tmp = out.with_name(".report.pdf.part")        # rename only when complete: a failed build never gets cached
    with PdfPages(tmp) as pdf:
        # ---------------------------------------------------------------- page 1
        fig = _page(pdf, "AeroMosaic run report · NB_L2")
        meta = [
            ["Run", man.get("run_id", "")],
            ["Video", f"{man.get('video')} ({man.get('video_id')}) · {m['nativeFrames']} decoded frames @ {_fmt(m.get('fps'), 3)} fps"],
            ["Composition", variant + (f" · SemanticStitch sha256 {(man.get('semstitch') or {}).get('sha256', '')[:16]}…" if (man.get('semstitch') or {}).get("used") else "")],
            ["Device · estimator · seed", f"{man.get('device')} · {man.get('estimator')} · {man.get('seed')}"],
            ["Created · finished", f"{man.get('created_at')} · {man.get('finished_at')}"],
            ["Versions", " · ".join(f"{k} {v}" for k, v in (man.get("versions") or {}).items() if k != "platform")],
        ]
        _table(fig, [0.07, 0.83, 0.86, 0.11], meta, col_w=[0.25, 0.75])
        prev = run_dir / "mosaic_preview.png"
        if prev.exists():
            ax = fig.add_axes([0.07, 0.30, 0.86, 0.50])
            ax.imshow(plt.imread(str(prev)))
            ax.set_axis_off()
            ax.set_title(f"Mosaic ({variant}) · full resolution {comp['mosaicWidth']}×{comp['mosaicHeight']} px", fontsize=8, color=MUTED)
        head = [
            ["Absolute coverage", f"{m['absoluteCoverage'] * 100:.2f} %  of A_observed = {m['observedAreaPx']:,} px"],
            ["Reference chain breaks", str(m["referenceChainBreaks"]) + ("  (denominator unsound)" if m["referenceChainBreaks"] else "")],
            ["Frames composited", f"{s2['nComposited']} of {m['nativeFrames']} native · chain {'reached the last frame' if s2['reachedLast'] else f'stopped at frame {s2['lastFrame']}'}"],
            ["DKM attempts", f"{s2['attempts']} ({s2['accepted']} accepted) · rejects: " + ", ".join(f"{k} {v}" for k, v in s2["rejects"].items())],
            ["Stage-1 candidate edges", f"{s1['candidateEdges']:,} probed · {s1['passing']:,} pass · rejects: " + ", ".join(f"{k} {v}" for k, v in s1["rejects"].items())],
            ["SLC frac disagree (lower = better)", _fmt(seam.get("slc_frac_disagree"), 4)],
        ]
        _table(fig, [0.07, 0.05, 0.86, 0.22], head, col_w=[0.32, 0.68], fontsize=8)
        pdf.savefig(fig)
        plt.close(fig)

        # ---------------------------------------------------------------- page 2: tables
        fig = _page(pdf, "Metrics")
        nf = m["baselines"].get("nfps")
        per = s2.get("msPerAttempt")
        base = [
            ["This run (measured)", f"{s2['nComposited']} composited", str(s2["attempts"]),
             "withheld (SIFT cached)" if s1.get("describeCached") else f"{(s1['describeMs'] + s1['probeMs'] + s2['dkmMs']) / 1000:.1f} s"],
        ]
        if nf:
            base.append([f"N=fps baseline (step {nf['step']})", str(nf["frames"]), str(nf["dkmCalls"]), f"{nf['dkmCalls'] * per / 1000:.1f} s projected" if per else "—"])
        base.append(["Native consecutive chain", str(m["baselines"]["nativeChain"]["frames"]), str(m["baselines"]["nativeChain"]["dkmCalls"]),
                     f"{m['baselines']['nativeChain']['dkmCalls'] * per / 1000:.1f} s projected" if per else "—"])
        fig.text(0.07, 0.93, "Cost against baselines (projected = DKM calls × this run's mean per-attempt time)", fontsize=9, color=MUTED)
        _table(fig, [0.07, 0.80, 0.86, 0.12], base, header=["", "frames", "DKM calls", "time"], col_w=[0.4, 0.2, 0.15, 0.25])
        which = ""
        if comp.get("sweep"):
            w = next((x for x in comp["sweep"] if x["lowestSlc"]), None)
            which = f" — of the lowest-SLC w_sem ({w['wSem']:g}, {w['name']})" if w else ""
        fig.text(0.07, 0.76, "Seam-line metrics (notebook run_variants / slc_variant; names as in the notebook)" + which, fontsize=9, color=MUTED)
        srows = [[k, _fmt(v, 4)] for k, v in seam.items()]
        _table(fig, [0.07, 0.40, 0.86, 0.35], srows, col_w=[0.5, 0.5])
        if comp.get("sweep"):
            fig.text(0.07, 0.37, "Hybrid sweep (w_sem chosen by SLC on this same video: exploratory, no held-out selection)", fontsize=9, color=WARN)
            sw = [[f"{x['wSem']:g}", x["name"], _fmt(x["seam"].get("slc_frac_disagree"), 4), _fmt(x["seam"].get("slc_p10"), 3),
                   _fmt(x["seam"].get("seam_step"), 2), "lowest SLC" if x["lowestSlc"] else ""] for x in comp["sweep"]]
            _table(fig, [0.07, 0.18, 0.86, 0.18], sw, header=["w_sem", "variant", "slc_frac", "slc_p10", "seam_step", ""])
        st = [[k, f"{v / 1000:.2f} s" + ("  (cached)" if m.get("stageCached", {}).get(k) else "")] for k, v in m.get("stageMs", {}).items() if v is not None]
        half = (len(st) + 1) // 2
        rows2 = [st[i] + (st[i + half] if i + half < len(st) else ["", ""]) for i in range(half)]
        fig.text(0.07, 0.15, "Stage wall time", fontsize=9, color=MUTED)
        _table(fig, [0.07, 0.02, 0.86, 0.12], rows2, col_w=[0.22, 0.28, 0.22, 0.28], fontsize=7)
        pdf.savefig(fig)
        plt.close(fig)

        # ---------------------------------------------------------------- page 3: figures
        fig = _page(pdf, "Stage 1 and stage 2")
        gaps = sorted({e["gap"] for e in edges})
        ax = fig.add_axes([0.1, 0.70, 0.82, 0.22])
        cats = [("pass", None, OK), ("GATE_IOU", "GATE_IOU", WARN), ("GATE_FM", "GATE_FM", ACC), ("PROXY_FIT_FAILED", "PROXY_FIT_FAILED", MUTED)]
        w = 0.2
        for k, (lab, cause, col) in enumerate(cats):
            ys = [sum(1 for e in edges if e["gap"] == g and e.get("rejectCause") == cause) for g in gaps]
            ax.bar([i + (k - 1.5) * w for i in range(len(gaps))], ys, w, label=lab, color=col)
        ax.set_xticks(range(len(gaps)), [str(g) for g in gaps])
        ax.set_xlabel("gap")
        ax.set_ylabel("edges")
        ax.set_title("Candidate edges by gap and outcome", fontsize=9)
        ax.legend(fontsize=7, frameon=False)
        ax = fig.add_axes([0.1, 0.38, 0.82, 0.24])
        for lab, cause, col in cats[:3]:
            pts = [(e["fm"], e["proxyIou"]) for e in edges if e.get("rejectCause") == cause and e.get("fm") is not None and e.get("proxyIou") is not None]
            if pts:
                ax.scatter(*zip(*pts), s=4, color=col, label=lab, alpha=0.7)
        ax.axvline(0.164, color=INK, lw=0.8, ls="--")
        ax.axhline(0.40, color=INK, lw=0.8, ls="--")
        ax.set_xlabel("f_m")
        ax.set_ylabel("proxy IoU")
        ax.set_title("f_m against proxy IoU (gate: IoU ≥ 0.40 and f_m ≥ 0.164)", fontsize=9)
        ax.legend(fontsize=7, frameon=False)
        ax = fig.add_axes([0.1, 0.06, 0.82, 0.24])
        xs = [a["attempt"] for a in atts if a.get("inlierRatio") is not None]
        ys = [a["inlierRatio"] for a in atts if a.get("inlierRatio") is not None]
        cs = [OK if a["accepted"] else BAD for a in atts if a.get("inlierRatio") is not None]
        ax.bar(xs, ys, color=cs)
        ax.axhline(0.35, color=INK, lw=0.8, ls="--")
        ax.set_ylim(0, 1)
        ax.set_xlabel("DKM attempt")
        ax.set_ylabel("inlier ratio")
        ax.set_title("DKM inlier ratio per attempt (accept ≥ 0.35)", fontsize=9)
        pdf.savefig(fig)
        plt.close(fig)

        # ---------------------------------------------------------------- DKM attempts table
        rows = [[str(a["attempt"]) + ("↻" if a.get("replanned") else ""), f"{a['frameI']}→{a['frameJ']}", str(a["gap"]), _fmt(a.get("fm")),
                 _fmt(a.get("proxyIou"), 2), _fmt(a.get("inlierRatio")), f"{a.get('nInliers') or '—'}/{a.get('nEpipolar') or '—'}",
                 "accepted" if a["accepted"] else f"{a['rejectCause']}", f"{a['durationMs'] / 1000:.2f}"] for a in atts]
        for k in range(0, max(1, len(rows)), 45):
            fig = _page(pdf, "DKM attempts" + (" (cont.)" if k else ""))
            _table(fig, [0.07, 0.04, 0.86, 0.90], rows[k:k + 45], header=["#", "pair", "gap", "f_m", "IoU", "ratio", "inl/epi", "outcome", "s"], fontsize=6.8)
            pdf.savefig(fig)
            plt.close(fig)
        d = pdf.infodict()
        d["Title"] = f"AeroMosaic run report {man.get('run_id')}"
        d["Creator"] = "AeroMosaic"
        d["Subject"] = json.dumps(dict(variant=variant, device=man.get("device"), estimator=man.get("estimator"), seed=man.get("seed")))
    tmp.replace(out)
    return out
