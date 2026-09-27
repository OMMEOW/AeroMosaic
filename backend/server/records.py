"""Map the pipeline's own records to the wire shapes in web/src/services/contract.ts.

Rules (agreed 2026-09-27):
- unmeasured is null, never 0 — a placeholder the notebook initialises but never computes
  on that path is reported as null;
- reject_cause mirrors the notebook's check order (stage 1: descriptors, putative,
  proxy homography, IoU, f_m; stage 2: homography fit, then the 0.35 ratio);
- rejectDetail keeps the notebook's own sub-reason.
"""
from __future__ import annotations

import math
import traceback

from pipeline import config as C

STAGE1_CAUSE = {
    None: None,
    "descriptors": "PROXY_FIT_FAILED",
    "putative": "PROXY_FIT_FAILED",
    "proxy_homography": "PROXY_FIT_FAILED",
    "iou": "GATE_IOU",
    "f_m": "GATE_FM",
}


def _num(x):
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def candidate_edge(i: int, j: int, r: dict, on_path: bool) -> dict:
    """Stage-1 record from probe_pair()'s output (notebook cell 8)."""
    rej = r.get("reject")
    # What probe_pair actually computed before returning on each path:
    #   descriptors      -> nothing
    #   putative         -> n_put, f_m
    #   proxy_homography -> n_put, f_m
    #   iou / f_m / pass -> n_put, f_m, n_in, IoU, f_u
    has_put = rej != "descriptors"
    has_geo = rej in (None, "iou", "f_m")
    fm = _num(r.get("f_m")) if has_put else None
    fu = _num(r.get("f_u")) if has_geo else None
    iou = _num(r.get("iou")) if has_geo else None
    n_put = int(r["n_put"]) if has_put else None
    if rej == "descriptors":
        detail = "descriptors: fewer than 2 SIFT descriptors in one of the frames"
    elif rej == "putative":
        detail = f"putative<4: {n_put} ratio-test match{'es' if n_put != 1 else ''}"
    elif rej == "proxy_homography":
        detail = "proxy_homography: MAGSAC returned no proxy homography"
    elif rej == "iou":
        detail = f"IoU {iou:.2f} < {C.IOU_TRUST:.2f}"
    elif rej == "f_m":
        detail = f"f_m {fm:.3f} < {C.OMEGA}"
    else:
        detail = ""
    return dict(
        stage=1, frameI=int(i), frameJ=int(j), gap=int(j - i),
        fm=fm, fu=fu, proxyIou=iou, inlierRatio=None,
        accepted=rej is None, rejectCause=STAGE1_CAUSE[rej], rejectDetail=detail,
        nPutative=n_put, nProxyInliers=int(r["n_in"]) if has_geo else None,
        fmPasses=(fm >= C.OMEGA) if fm is not None else None,
        iouPasses=(iou >= C.IOU_TRUST) if iou is not None else None,
        onPlannedPath=bool(on_path),
    )


def dkm_attempt(rec: dict, replanned: bool) -> dict:
    """Stage-2 record from run_geometry_replan()'s attempt record (notebook cell 16)."""
    ok = bool(rec["accepted"])
    h_failed = rec.get("reject_reason") == "homography fit failed"
    if ok:
        cause, detail = None, ""
    elif h_failed:
        cause = "DEGENERATE_H"
        if rec.get("epipolar_ok"):
            l1 = f"layer 1 (epipolar F, τs={C.TAU_S}) kept {int(rec.get('n_epipolar', 0))} of {int(rec.get('n_matches', 0))}"
        else:
            l1 = f"layer 1 (epipolar F, τs={C.TAU_S}) found no F, so all {int(rec.get('n_matches', 0))} matches passed through"
        detail = f"layer 2 (homography, τr={C.TAU_R}) returned no H; {l1}"
    else:
        cause, detail = "RATIO_BELOW_MIN", rec.get("reject_reason", "")
    return dict(
        stage=2, attempt=int(rec["attempt"]), frameI=int(rec["ref_frame"]), frameJ=int(rec["src_frame"]),
        gap=int(rec["gap"]),
        fm=_num(rec.get("f_m")), fu=_num(rec.get("f_u")), proxyIou=_num(rec.get("probe_iou")),
        # dual_layer writes inlier_ratio=0.0 / n_inliers=0 as placeholders when no H was fit
        inlierRatio=None if h_failed else _num(rec.get("inlier_ratio")),
        accepted=ok, rejectCause=cause, rejectDetail=detail,
        nMatches=int(rec.get("n_matches", 0)),
        nEpipolar=int(rec["n_epipolar"]) if "n_epipolar" in rec else None,
        epipolarOk=bool(rec.get("epipolar_ok")) if "epipolar_ok" in rec else None,
        nInliers=None if h_failed else int(rec.get("n_inliers", 0)),
        residMedianPx=_num(rec.get("resid_median")), residP95Px=_num(rec.get("resid_p95")),
        dGeoP95=_num(rec.get("d_geo_p95")), dPhotP95=_num(rec.get("d_phot_p95")),
        estimator=rec.get("estimator"),
        durationMs=int(round(float(rec.get("t_step", 0.0)) * 1000)),
        plannedLen=int(rec.get("planned_len", 0)),
        replanned=bool(replanned),
    )


def exception_attempt(attempt: int, ref: int, src: int, probe: dict, exc: BaseException, duration_s: float) -> dict:
    tb = traceback.extract_tb(exc.__traceback__)
    where = f" at {tb[-1].filename.rsplit('/', 1)[-1]}:{tb[-1].lineno} in {tb[-1].name}" if tb else ""
    return dict(
        stage=2, attempt=int(attempt), frameI=int(ref), frameJ=int(src), gap=int(src - ref),
        fm=_num(probe.get("f_m")), fu=_num(probe.get("f_u")), proxyIou=_num(probe.get("iou")),
        inlierRatio=None, accepted=False, rejectCause="EXCEPTION",
        rejectDetail=f"{type(exc).__name__}: {exc}{where}",
        nMatches=None, nEpipolar=None, epipolarOk=None, nInliers=None,
        residMedianPx=None, residP95Px=None, dGeoP95=None, dPhotP95=None,
        estimator=None, durationMs=int(round(duration_s * 1000)), plannedLen=None, replanned=False,
    )


def nfps_baseline(n_native: int, fps: float | None) -> dict | None:
    """The project's N=fps baseline: every round(fps)-th native frame (src/uav_common.py,
    native_gate_validate.py), registered as a chain -> len - 1 DKM calls."""
    if not fps or fps <= 0 or n_native <= 0:
        return None
    step = max(1, int(round(fps)))
    frames = len(range(0, n_native, step))
    return dict(step=step, frames=frames, dkmCalls=max(0, frames - 1),
                definition="every round(fps)-th decoded frame, chained (src/uav_common.py)")
