"""Per-pair visualisation artifacts. Runs OUTSIDE every timed region, and never touches an RNG.

For each attempted pair it writes runs/<id>/artifacts/pairs/<i>_<j>/:
  ref.jpg, src.jpg     the two frames (long side <= VIZ_FRAME_SIDE)
  canvas.jpg           live preview canvas after this pair (long side <= VIZ_CANVAS_SIDE)
  pair.json            gate evidence, SIFT putatives, DKM inlier subsample, sub-stage timings,
                       verdict, preview quad, and the measured visualisation cost

Everything drawn is data the pipeline produced or deterministically reproducible data:
- SIFT putatives are recomputed from the stored SIFT-500 descriptors with the probe's own
  BFMatcher + Lowe ratio test (deterministic, no RNG), so they are exactly the probe's matches.
  The probe's MAGSAC proxy fit is NOT re-run: it would consume OpenCV's RNG and change the
  pipeline downstream.
- DKM inlier lines come from the correspondence cache the notebook writes for every attempt
  (corr_<attempt>.npz: all DKM samples, residual < tau_r under the fitted H), evenly
  subsampled (no RNG) to at most MAX_LINES.
- The preview canvas places accepted frames by the same accumulated homography the pipeline
  uses (G <- G @ H), first-wins, downscaled. It is NOT the notebook's composition, which runs
  once after the last DKM step with the chosen variant.
"""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

from pipeline import config as C

from .jsonio import write_json_atomic

VIZ_FRAME_SIDE = 640
VIZ_CANVAS_SIDE = 1280
MAX_LINES = 200
JPEG_Q = 80
KEEP_DEFAULT = 50


def _jpeg(path: Path, img: np.ndarray, side: int) -> tuple[int, int, float]:
    h, w = img.shape[:2]
    s = min(1.0, side / max(h, w))
    if s < 1:
        img = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)
    tmp = path.with_suffix(".tmp.jpg")
    cv2.imwrite(str(tmp), img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
    tmp.replace(path)
    return img.shape[1], img.shape[0], s


def _even(idx: np.ndarray, k: int) -> np.ndarray:
    if len(idx) <= k:
        return idx
    return idx[np.linspace(0, len(idx) - 1, k).round().astype(int)]


class PreviewCanvas:
    """Accepted frames, placed by their accumulated homography in frame-0 coordinates, first-wins."""

    def __init__(self, side: int = VIZ_CANVAS_SIDE):
        self.side = side
        self.s = None           # canvas px per working px
        self.x0 = self.y0 = 0.0
        self.img = None         # BGR canvas
        self.cov = None         # bool coverage

    def add(self, frame: np.ndarray, G: np.ndarray) -> list[list[float]]:
        h, w = frame.shape[:2]
        rect = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
        q = cv2.perspectiveTransform(rect, G).reshape(-1, 2)
        if self.img is None:
            self.s = min(1.0, 0.5 * self.side / max(w, h))
            self.x0, self.y0 = float(np.floor(q[:, 0].min())), float(np.floor(q[:, 1].min()))
            self.img = np.zeros((1, 1, 3), np.uint8)
            self.cov = np.zeros((1, 1), bool)
        # grow the extent to include the new quad (pad), then downscale if over the cap
        ch, cw = self.img.shape[:2]
        x1_old, y1_old = self.x0 + cw / self.s, self.y0 + ch / self.s
        nx0, ny0 = min(self.x0, float(np.floor(q[:, 0].min()))), min(self.y0, float(np.floor(q[:, 1].min())))
        nx1, ny1 = max(x1_old, float(np.ceil(q[:, 0].max()))), max(y1_old, float(np.ceil(q[:, 1].max())))
        W, H = int(np.ceil((nx1 - nx0) * self.s)), int(np.ceil((ny1 - ny0) * self.s))
        if (W, H) != (cw, ch) or (nx0, ny0) != (self.x0, self.y0):
            big = np.zeros((H, W, 3), np.uint8)
            bcov = np.zeros((H, W), bool)
            ox, oy = int(round((self.x0 - nx0) * self.s)), int(round((self.y0 - ny0) * self.s))
            big[oy:oy + ch, ox:ox + cw] = self.img[: H - oy, : W - ox]
            bcov[oy:oy + ch, ox:ox + cw] = self.cov[: H - oy, : W - ox]
            self.img, self.cov, self.x0, self.y0 = big, bcov, nx0, ny0
        if max(self.img.shape[:2]) > self.side:
            f = self.side / max(self.img.shape[:2])
            nh, nw = max(1, int(self.img.shape[0] * f)), max(1, int(self.img.shape[1] * f))
            self.img = cv2.resize(self.img, (nw, nh), interpolation=cv2.INTER_AREA)
            self.cov = cv2.resize(self.cov.astype(np.uint8), (nw, nh), interpolation=cv2.INTER_NEAREST).astype(bool)
            self.s *= f
        M = np.array([[self.s, 0, -self.x0 * self.s], [0, self.s, -self.y0 * self.s], [0, 0, 1]]) @ G
        size = (self.img.shape[1], self.img.shape[0])
        warped = cv2.warpPerspective(frame, M, size, flags=cv2.INTER_AREA)
        mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, size, flags=cv2.INTER_NEAREST) > 127
        new = mask & ~self.cov
        self.img[new] = warped[new]
        self.cov |= mask
        qc = cv2.perspectiveTransform(rect, M).reshape(-1, 2)
        return [[round(float(x), 1), round(float(y), 1)] for x, y in qc]


class PairViz:
    def __init__(self, run_dir: Path, run_id: str, A, video: str, keep: int = KEEP_DEFAULT):
        self.dir = run_dir / "artifacts" / "pairs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.run_id, self.A, self.v, self.keep = run_id, A, video, keep
        self.canvas = PreviewCanvas()
        self.G = np.eye(3)
        self.placed_first = False
        self.index: list[dict] = []
        self.cost_ms: list[float] = []
        self.cur: dict | None = None

    def _url(self, name: str, key: str, bust: int | None = None) -> str:
        q = f"?v={bust}" if bust is not None else ""
        return f"/api/runs/{self.run_id}/artifacts/artifacts/pairs/{key}/{name}{q}"

    def _frame(self, i: int) -> np.ndarray:
        return cv2.imread(str(self.A.PASSA / self.v / "frames" / f"{i:06d}.png"))

    # ------------------------------------------------------------------ pair start
    def start(self, attempt: int, ref: int, src: int) -> dict:
        t0 = time.perf_counter()
        key = f"{ref}_{src}"
        d = self.dir / key
        d.mkdir(exist_ok=True)
        A_img, B_img = self._frame(ref), self._frame(src)
        (rw, rh, rs), (sw, sh, ss) = _jpeg(d / "ref.jpg", A_img, VIZ_FRAME_SIDE), _jpeg(d / "src.jpg", B_img, VIZ_FRAME_SIDE)
        if not self.placed_first:            # frame 0 is the canvas origin (G = I), as in the pipeline
            self.canvas.add(A_img, np.eye(3))
            self.placed_first = True
        # SIFT putatives: same descriptors, matcher and ratio test as probe_pair (no RNG).
        kps, des, _ = self.A.DESC[self.v]
        kA, dA, kB, dB = kps[ref], des[ref], kps[src], des[src]
        put = []
        if len(dA) >= 2 and len(dB) >= 2:
            for m in cv2.BFMatcher(cv2.NORM_L2).knnMatch(dB, dA, k=2):
                if len(m) == 2 and m[0].distance < C.LOWE_RATIO * m[1].distance:
                    a, b = kA[m[0].trainIdx], kB[m[0].queryIdx]
                    put.append([round(float(a[0]) * rs, 1), round(float(a[1]) * rs, 1), round(float(b[0]) * ss, 1), round(float(b[1]) * ss, 1)])
        pr = self.A.PROBES.get(self.v, {}).get((ref, src), {})
        self.cur = dict(
            attempt=attempt, frameI=ref, frameJ=src, gap=src - ref, key=key,
            refUrl=self._url("ref.jpg", key), srcUrl=self._url("src.jpg", key),
            refSize=[rw, rh], srcSize=[sw, sh],
            gate=dict(fm=pr.get("f_m"), fu=pr.get("f_u") if pr.get("reject") in (None, "iou", "f_m") else None,
                      proxyIou=pr.get("iou") if pr.get("reject") in (None, "iou", "f_m") else None,
                      nPutative=pr.get("n_put"), nProxyInliers=pr.get("n_in") if pr.get("reject") in (None, "iou", "f_m") else None,
                      passed=pr.get("reject") is None, reject=pr.get("reject"),
                      fmPasses=(pr["f_m"] >= C.OMEGA) if pr.get("reject") != "descriptors" and "f_m" in pr else None,
                      iouPasses=(pr["iou"] >= C.IOU_TRUST) if pr.get("reject") in (None, "iou", "f_m") else None,
                      omega=C.OMEGA, iouTrust=C.IOU_TRUST),
            putatives=put, putativesNote="SIFT-500 ratio-test matches, recomputed from the stored descriptors (identical to the probe's)",
            substages=[], done=None,
        )
        cost = (time.perf_counter() - t0) * 1000
        self.cur["vizStartMs"] = round(cost, 1)
        write_json_atomic(d / "pair.json", self.cur)
        return {k: self.cur[k] for k in ("attempt", "frameI", "frameJ", "gap", "key", "refUrl", "srcUrl", "refSize", "srcSize", "gate")} | {
            "nPutatives": len(put), "pairUrl": self._url("pair.json", key, 0)}

    # ------------------------------------------------------------------ pair done
    def done(self, record: dict, substages: list[dict], corr_path: Path, accepted: bool) -> dict:
        t0 = time.perf_counter()
        cur = self.cur or {}
        key = cur.get("key", f"{record['frameI']}_{record['frameJ']}")
        d = self.dir / key
        rs = cur["refSize"][0] / max(1, self._frame_w())
        lines, n_in = [], None
        try:
            z = np.load(corr_path)
            src, dst, inl = z["src"], z["dst"], z["inlier"].astype(bool)
            n_in = int(inl.sum())
            for k in _even(np.flatnonzero(inl), MAX_LINES):
                lines.append([round(float(dst[k, 0]) * rs, 1), round(float(dst[k, 1]) * rs, 1),
                              round(float(src[k, 0]) * rs, 1), round(float(src[k, 1]) * rs, 1)])
            Hm = z["H"]
        except (FileNotFoundError, KeyError):
            Hm = None
        quad = None
        if accepted and Hm is not None and np.isfinite(Hm).all():
            self.G = self.G @ Hm                              # same accumulation as notebook cell 16
            quad = self.canvas.add(self._frame(record["frameJ"]), self.G)
        cw, ch, _ = _jpeg(d / "canvas.jpg", self.canvas.img, VIZ_CANVAS_SIDE)
        cost = (time.perf_counter() - t0) * 1000 + float(cur.get("vizStartMs", 0))
        self.cost_ms.append(cost)
        cur.update(
            substages=substages,
            done=dict(record=record, inlierLines=lines, nCacheInliers=n_in,
                      linesNote=f"{len(lines)} of {n_in if n_in is not None else 0} DKM inlier correspondences, evenly subsampled for legibility "
                                f"(correspondence cache: all DKM samples with residual < τr {C.TAU_R} px under the fitted H)",
                      canvasUrl=self._url("canvas.jpg", key, record["attempt"]), canvasSize=[cw, ch], quad=quad,
                      canvasNote="Live preview: accepted frames placed by their accumulated homography, first-wins, downscaled. "
                                 "Not the final composition, which runs once after the last DKM step."),
            vizMs=round(cost, 1),
        )
        write_json_atomic(d / "pair.json", cur)
        self.index.append(dict(attempt=record["attempt"], frameI=record["frameI"], frameJ=record["frameJ"], key=key,
                               accepted=accepted, rejectCause=record.get("rejectCause"), inlierRatio=record.get("inlierRatio"),
                               pruned=False))
        pruned = self._prune()
        write_json_atomic(self.dir / "index.json", dict(keep=self.keep, pairs=self.index))
        self.cur = None
        return dict(attempt=record["attempt"], key=key, canvasUrl=cur["done"]["canvasUrl"], canvasSize=[cw, ch], quad=quad,
                    pairUrl=self._url("pair.json", key, record["attempt"]), vizMs=round(cost, 1), pruned=pruned)

    def _frame_w(self) -> int:
        return int(self.A.MANIFESTS[self.v]["working_resolution"][0]) if self.v in self.A.MANIFESTS else \
            int(json.loads((self.A.PASSA / self.v / "frames_manifest.json").read_text())["working_resolution"][0])

    def _prune(self) -> list[str]:
        """Keep the most recent `keep` pairs plus every rejected pair."""
        live = [p for p in self.index if not p["pruned"]]
        recent = {p["key"] for p in live[-self.keep:]}
        out = []
        for p in live:
            if p["key"] not in recent and p["accepted"]:
                shutil.rmtree(self.dir / p["key"], ignore_errors=True)
                p["pruned"] = True
                out.append(p["key"])
        return out

    def summary(self) -> dict:
        c = self.cost_ms
        return dict(pairs=len(self.index), pruned=sum(p["pruned"] for p in self.index), keep=self.keep,
                    meanVizMs=round(sum(c) / len(c), 1) if c else None, maxVizMs=round(max(c), 1) if c else None)
