"""Generate backend/pipeline/_nb_pass_a.py and _nb_pass_b.py from NB_L2_full_pipeline.ipynb.

The notebook is the single source of the algorithm. This script copies the cells that
define it, verbatim, and applies the PATCHES below. Every patch must match exactly once
or generation fails, so a notebook edit that invalidates a patch is caught instead of
silently producing a different pipeline.

Run:  .venv/bin/python tools/extract_notebook.py [path/to/NB_L2_full_pipeline.ipynb]
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
NB = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "web" / "NB_L2_full_pipeline.ipynb"
OUT = HERE / "pipeline"

PASS_A_CELLS = [4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16]
PASS_B_CELLS = [21, 22, 23, 24, 25, 26, 27, 29, 31, 32, 33, 41]

# (cell, old, new, why). `why` is copied into the generated file next to the change.
PATCHES: list[tuple[int, str, str, str]] = [
    # ---------------------------------------------------------------- cell 4: env
    (4, 'DEVICE = "cuda" if torch.cuda.is_available() else "cpu"',
        "DEVICE = resolve_device()",
        "MPS port: one resolver, mps else cpu; no CUDA branch."),
    (4, '''if DEVICE == "cuda":
    print("gpu     ", torch.cuda.get_device_name(0),
          f"{torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB")
''', "",
        "MPS port: CUDA-only device report removed (device is reported by /health)."),
    # ---------------------------------------------------------------- cell 8: gate
    (8, '"""S = min(f_m, f_u) for one candidate pair. Returns a record, never raises."""',
        '"""Gate score S = f_m for one candidate pair (f_u recorded, not gated). Returns a record, never raises."""',
        "Gate decision: f_u leaves the score."),
    (8, "out = dict(f_m=0.0, f_u=0.0, S=0.0, n_put=0, n_in=0, iou=0.0, ok=False)",
        "out = dict(f_m=0.0, f_u=0.0, S=0.0, n_put=0, n_in=0, iou=0.0, ok=False, reject=None)",
        "Additive: record which condition rejected the pair."),
    (8, '''    if len(dA) < 2 or len(dB) < 2:
        return out''', '''    if len(dA) < 2 or len(dB) < 2:
        out["reject"] = "descriptors"; return out''',
        "Additive: reject reason."),
    (8, '''    if n_put < 4:
        out["S"] = 0.0; return out''', '''    if n_put < 4:
        out["S"] = 0.0; out["reject"] = "putative"; return out''',
        "Additive: reject reason."),
    (8, '''    if Hm is None or mask is None:
        out["S"] = 0.0; return out''', '''    if Hm is None or mask is None:
        out["S"] = 0.0; out["reject"] = "proxy_homography"; return out''',
        "Additive: reject reason."),
    (8, '''        out["S"] = 0.0; out["ok"] = False; return out''',
        '''        out["S"] = 0.0; out["ok"] = False; out["reject"] = "iou"; return out''',
        "Additive: reject reason (IoU trust precondition, unchanged)."),
    (8, '''    out["S"] = float(min(out["f_m"], out["f_u"]))
    out["ok"] = out["S"] >= OMEGA''', '''    out["S"] = float(out["f_m"])
    out["ok"] = out["S"] >= OMEGA
    if not out["ok"]:
        out["reject"] = "f_m"''',
        "Gate decision 2026-09-26: S = f_m (was min(f_m, f_u)); IoU >= IOU_TRUST still required above."),
    (8, '''            r = probe_pair(kps[i], des[i], kps[i + g], des[i + g], (H, W))''',
        '''            r = probe_pair(kps[i], des[i], kps[i + g], des[i + g], (H, W))
            PROBES.setdefault(video_name, {})[(i, i + g)] = r''',
        "Additive: keep every probe record (not only passing edges) for the inspector."),
    (8, '''            done += 1''', '''            done += 1
            _progress("probe", done, total)''',
        "Additive: progress hook."),
    # ---------------------------------------------------------------- cell 6/7/10: progress
    (6, '''        i += 1''', '''        i += 1
        _progress("decode", i, None)''', "Additive: progress hook."),
    (7, '''        counts.append(len(k))''', '''        counts.append(len(k))
        _progress("sift", i + 1, n)''', "Additive: progress hook."),
    (10, '''        prev = cur''', '''        prev = cur
        _progress("reference", i + 1, n)''', "Additive: progress hook."),
    # ---------------------------------------------------------------- cell 13: DKM
    (13, '''    warp, cert = model.match(str(img_ref_path), str(img_new_path), device=DEVICE)''',
         '''    with mps_linalg_inv_fix(DEVICE):
        warp, cert = model.match(str(img_ref_path), str(img_new_path), device=DEVICE)''',
         "MPS bug (torch 2.13.0): batched torch.linalg.inv wrong for batch elements >= 1 when N > ~1024; "
         "DKM GP inverts b=2, N=1530. Fix A: per-element inverse during match() on MPS only "
         "(UAV_MPS_INV_MODE=cpu selects fix B). See pipeline/device.py."),
    # ---------------------------------------------------------------- cell 16: re-plan
    (16, '''        a_id = len(attempts) + 1
        t1 = time.time()''',
         '''        a_id = len(attempts) + 1
        _attempt_begin(video_name, a_id, cur, nxt)
        t1 = time.time()
        _substage("load")''',
         "Additive: announce the attempt BEFORE t1 (outside the timed region), so an exception is "
         "attributed to its pair and any visualisation work is not timed; then mark sub-stage 'load'."),
    (16, '''        ok = H is not None and stats.get("inlier_ratio", 0.0) >= MIN_RATIO''',
         '''        ok = H is not None and stats.get("inlier_ratio", 0.0) >= MIN_RATIO
        _pr = PROBES.get(video_name, {}).get((cur, nxt), {})''',
         "Additive: look up the probe record of the attempted edge."),
    (16, '''        if ok:
            G = G @ H''', '''        rec.update(f_m=float(_pr.get("f_m", float("nan"))), f_u=float(_pr.get("f_u", float("nan"))),
                   probe_iou=float(_pr.get("iou", float("nan"))), probe_S=float(_pr.get("S", float("nan"))),
                   estimator=stats.get("estimator"))
        if not ok:
            rec["reject_reason"] = ("homography fit failed" if H is None else
                                    f"inlier ratio {stats.get('inlier_ratio', 0.0):.3f} < {MIN_RATIO}")
        if ok:
            G = G @ H''',
         "Additive: per-attempt f_m/f_u/IoU/estimator and the rejecting condition."),
    (16, '''        attempts.append(rec)''', '''        attempts.append(rec)
        _step(video_name, rec, len(path))''',
         "Additive: step hook (streams the record; raises to cancel)."),
    # ---------------------------------------------------------------- sub-stage markers
    # Each _substage(name) records "name begins now, the previous sub-stage ends now". The
    # default is a no-op; the server's records a perf_counter timestamp and queues an event
    # for a writer thread, so the cost inside the timed region is microseconds.
    (13, '''    with mps_linalg_inv_fix(DEVICE):''',
         '''    _substage("dkm_forward")
    with mps_linalg_inv_fix(DEVICE):''',
         "Additive: sub-stage marker (DKM forward pass)."),
    (13, '''    matches, mconf = model.sample(warp, cert, num=NUM_SAMPLE)''',
         '''    _substage("sample")
    matches, mconf = model.sample(warp, cert, num=NUM_SAMPLE)''',
         "Additive: sub-stage marker (DKM sampling)."),
    (14, '''    F, fmask = cv2.findFundamentalMat(kB, kA, cv2.USAC_MAGSAC, TAU_S, RANSAC_CONF, RANSAC_ITERS)''',
         '''    _substage("strict_fit")
    F, fmask = cv2.findFundamentalMat(kB, kA, cv2.USAC_MAGSAC, TAU_S, RANSAC_CONF, RANSAC_ITERS)''',
         "Additive: sub-stage marker (layer 1, epipolar, tau_s)."),
    (14, '''    H, hmask, est = _fit_homography(kB[keep], kA[keep], TAU_R)''',
         '''    _substage("refit")
    H, hmask, est = _fit_homography(kB[keep], kA[keep], TAU_R)''',
         "Additive: sub-stage marker (layer 2, homography, tau_r)."),
    (16, '''        src = np.asarray(kB, np.float32); dst = np.asarray(kA, np.float32)''',
         '''        _substage("cache")
        src = np.asarray(kB, np.float32); dst = np.asarray(kA, np.float32)''',
         "Additive: sub-stage marker (correspondence cache write, inside the timed region as before)."),
    (16, '''        ok = H is not None and stats.get("inlier_ratio", 0.0) >= MIN_RATIO''',
         '''        _substage(None)
        ok = H is not None and stats.get("inlier_ratio", 0.0) >= MIN_RATIO''',
         "Additive: sub-stage marker (end of the timed region measured by t_step)."),
    (16, '''            d_geo = dense_geo_residual(warp_A, H, A.shape, B.shape)''',
         '''            _substage("residuals")
            d_geo = dense_geo_residual(warp_A, H, A.shape, B.shape)''',
         "Additive: sub-stage marker (residual fields for accepted steps; not in t_step, as before)."),
    # ---------------------------------------------------------------- cell 21: env
    (21, 'DEVICE = "cuda" if torch.cuda.is_available() else "cpu"',
         "DEVICE = resolve_device()",
         "MPS port: one resolver."),
    # ---------------------------------------------------------------- cell 27: progress
    (27, '''    for i in accepted:
        img = cv2.imread(str(Path(frames_dir) / names[i]))''',
         '''    for _k, i in enumerate(accepted):
        _progress("composite", _k, len(accepted))
        img = cv2.imread(str(Path(frames_dir) / names[i]))''',
         "Additive: progress hook."),
]

# Cells whose top-level *driver* code must not run on import: keep only the definitions.
TRUNCATE_AFTER = {
    41: "COV = {v: coverage_vs_observed(v) for v in EVAL_VIDEOS}",   # the rest is a report loop
}
# Cell 32 is a known-answer test that runs on import; wrap its driver in a function.
WRAP_32 = ('print(f"{\'k\':>5s} {\'around\':>8s} {\'through\':>8s}")', "def slc_known_answer_test():")

HEADER_A = '''"""GENERATED by tools/extract_notebook.py from NB_L2_full_pipeline.ipynb — do not edit.

Pass A (decode, SIFT probe, gate, DAG selection, reference chain, DKM re-plan) — notebook
cells {cells}. Notebook sha256: {sha}. Patches applied: {n} (listed inline as `# PATCH`).
"""
# fmt: off
# ruff: noqa
from pathlib import Path
from .config import *                      # constants, verbatim from cells 2 and 4
from .config import resolve_video
from .device import resolve_device, mps_linalg_inv_fix

PASSA = None     # set per run by pipeline.run.set_workdirs()
PASSB = None
MANIFESTS, DESC, EDGES, SELECTION, REFERENCE, TRACES = {{}}, {{}}, {{}}, {{}}, {{}}, {{}}
PROBES = {{}}    # additive: every probe record, keyed by video then (i, j)

# Hooks (additive). The server replaces these; defaults print only.
def _progress(stage, done, total): pass
def _step(video, rec, planned_len): pass
def _attempt_begin(video, attempt, ref, src): pass
def _substage(name): pass
def _log(*a, **k): print(*a, **k)
'''

HEADER_B = '''"""GENERATED by tools/extract_notebook.py from NB_L2_full_pipeline.ipynb — do not edit.

Composition + SLC + coverage (Pass B) — notebook cells {cells}. Notebook sha256: {sha}.
Patches applied: {n} (listed inline as `# PATCH`).
"""
# fmt: off
# ruff: noqa
from pathlib import Path
from .config import *
from .device import resolve_device
from ._nb_pass_a import MANIFESTS, TRACES

PASSA = None
PASSB = None
seam_obj = None  # SemanticStitchSeam, set by pipeline.run

def _progress(stage, done, total): pass
def _log(*a, **k): print(*a, **k)
'''


def cell_source(cells, i):
    return "".join(cells[i]["source"])


def main():
    raw = NB.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    cells = json.loads(raw)["cells"]
    srcs = {i: cell_source(cells, i) for i in PASS_A_CELLS + PASS_B_CELLS}

    for c, old, new, why in PATCHES:
        n = srcs[c].count(old)
        if n != 1:
            raise SystemExit(f"patch for cell {c} matched {n} times (expected 1): {why}\n---\n{old}")
        pos = srcs[c].index(old)
        line_prefix = srcs[c][srcs[c].rfind("\n", 0, pos) + 1:pos]
        lead = re.match(r"\s*", old).group(0)
        indent = line_prefix + lead
        marked = (lead + f"# PATCH: {why}\n" + indent + new.lstrip()) if new else f"{lead}# PATCH (removed): {why}\n"
        srcs[c] = srcs[c].replace(old, marked)

    for c, marker in TRUNCATE_AFTER.items():
        k = srcs[c].index(marker)
        srcs[c] = srcs[c][:k] + f"# (notebook driver code below this point omitted: {marker!r} ...)\n"

    s32 = srcs[32]
    k = s32.index(WRAP_32[0])
    body = s32[k:]
    body = "\n".join(("    " + ln) if ln.strip() else ln for ln in body.splitlines())
    srcs[32] = s32[:k] + WRAP_32[1] + "\n" + body + "\n    return ok\n"

    # print -> _log, so output reaches the run log and the event stream.
    for i in srcs:
        srcs[i] = re.sub(r"(?<![\w.])print\(", "_log(", srcs[i])

    def build(header, cells_):
        parts = [header.format(cells=cells_, sha=sha, n=sum(1 for p in PATCHES if p[0] in cells_))]
        for i in cells_:
            parts.append(f"\n# {'=' * 76}\n# notebook cell {i}\n# {'=' * 76}\n{srcs[i]}\n")
        return "".join(parts)

    (OUT / "_nb_pass_a.py").write_text(build(HEADER_A, PASS_A_CELLS))
    (OUT / "_nb_pass_b.py").write_text(build(HEADER_B, PASS_B_CELLS))
    print(f"wrote {OUT/'_nb_pass_a.py'} and {OUT/'_nb_pass_b.py'} from {NB.name} (sha256 {sha[:12]}), {len(PATCHES)} patches")


if __name__ == "__main__":
    main()
