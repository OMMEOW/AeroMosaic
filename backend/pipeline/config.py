"""Pipeline configuration.

Constants are copied verbatim from NB_L2_full_pipeline.ipynb cells 2 and 4. The only
changes are the gate definition (see GATE_* below, a decision recorded in
INTEGRATION_NOTES.md) and that paths come from the environment instead of a Windows
drive letter.

Do not edit a constant here without updating the notebook: these values produced the
validated runs.
"""
from __future__ import annotations

import os
from pathlib import Path

import cv2

# ---- paths (env, with macOS defaults for this machine) ----------------------------
MAJOR = Path(os.environ.get("UAV_PROJECT_ROOT", Path.home() / "My Stuff" / "Major"))
DATA = Path(os.environ.get("UAV_DATA_ROOT", MAJOR / "data"))
MOVINGDRONE_DIR = DATA / "MovingDrone"
OWN_VIDEOS_DIR = Path(os.environ.get("UAV_OWN_VIDEOS_DIR", DATA / "videos"))   # notebook: DATA/"own_videos"
UMCD_DIR = DATA / "umcd"
DKM_REPO = Path(os.environ.get("UAV_DKM_REPO", MAJOR / "DKM"))
SEMSTITCH_REPO = Path(os.environ.get("UAV_SEMSTITCH_REPO", MAJOR / "OAIV-Coherence"))
SEMSTITCH_CKPT = Path(os.environ.get("UAV_SEMSTITCH_CKPT", SEMSTITCH_REPO / "checkpoints" / "epoch090_model.pth"))
# SHA-256 of the checkpoint used on the Windows machine. Supplied by the project owner;
# loading refuses to run on mismatch and refuses to run while this is unset.
# 2026-09-27: the project owner designated the file at SEMSTITCH_CKPT on this Mac as canonical.
# NOT cross-checked against the Windows machine's copy (see INTEGRATION_NOTES.md).
SEMSTITCH_SHA256_CANONICAL = "412503d5ff0d161c4d4a6f7f02ff74641572839e8269249ae8907cdf46376991"
SEMSTITCH_SHA256 = (os.environ.get("UAV_SEMSTITCH_SHA256", "").strip().lower() or SEMSTITCH_SHA256_CANONICAL)
SEMSTITCH_ARCH = "plain"
CACHE_ROOT = Path(os.environ.get("UAV_CACHE_ROOT", MAJOR / "uav-dashboard" / "backend" / "cache"))
RUNS_ROOT = Path(os.environ.get("UAV_RUNS_ROOT", MAJOR / "uav-dashboard" / "backend" / "runs"))

VAL_SEQS = ["rural8", "suburban3", "road5"]
EVAL_VIDEOS = ["birdseyecity", "redroofcity", "resort", "southroad"]
ALL_VIDEOS = VAL_SEQS + EVAL_VIDEOS

# ---- decode + probe (cell 2, verbatim) --------------------------------------------
MAX_SIDE = 1920
PROBE_NFEATURES, LOWE_RATIO = 500, 0.80
PROBE_RANSAC, PROBE_THRESH, PROBE_CONF = cv2.USAC_MAGSAC, 12.0, 0.99
CANDIDATE_GAPS = [1, 2, 4, 8, 16, 32, 64]
OMEGA, IOU_TRUST = 0.164, 0.40

# Gate (decision 2026-09-26, see INTEGRATION_NOTES.md): an edge is kept iff
#   proxy IoU >= IOU_TRUST   (validity precondition on the proxy homography)  AND
#   f_m >= OMEGA              (worth spending DKM on)
# The notebook used S = min(f_m, f_u); f_u is now recorded for diagnostics only.
GATE_SCORE = "f_m"

# ---- reference chain (cell 2, verbatim) -------------------------------------------
REF_NFEATURES, REF_THRESH, REF_CONF, REF_CANVAS_CAP = 4000, 3.0, 0.999, 6000

# ---- DKM + acceptance (cell 2, verbatim) ------------------------------------------
TAU_R, TAU_S, MIN_RATIO = 4.0, 3.0, 0.35
DKM_NUM_SAMPLES, UPSAMPLE_PREDS = 10000, False
NCC_WIN, MIN_STD = 9, 3.0
CORR_CACHE = True

# ---- composition (cell 2, verbatim) -----------------------------------------------
FEATHER_PX, ERODE_PX, HOLE_FILL, CENTRE_BIAS = 24, 0, True, 0.0
AGE_BIAS = 0.5
NEUTRAL_COST, COST_PCTL, COST_SCALE = 0.5, 95, 1.0
SEAM_MAX_SIDE, SEAM_ROI_MARGIN = 1024, 32
SEAM_MIN_SIDE, SEAM_RETRY_LADDER = 176, (176, 352, 704)
SEAM_MIN_OVERLAP_PX = 50
STEP_OFFSET, BLUR_K, N_BG_SAMPLES = 3, 5, 20000
MAX_CANVAS_MPX, COMPOSE_BATCH = 200, 3

# ---- sweeps (cell 2, verbatim) ----------------------------------------------------
BIAS_GRID = [0.0, 0.2, 0.5, 1.0]
HYBRID_W = [0.0, 0.25, 0.5, 0.75, 1.0]
BIAS_TIE = 0.005
FORCE_RESELECT = False
# Frozen bias recorded by the notebook's selection run (cell 37 output: "frozen bias
# SELECTED and written: 0.0"). Loaded, never re-selected by the server.
FROZEN_BIAS = 0.0

# ---- SLC (cell 2, verbatim) -------------------------------------------------------
SLC_WIN, SLC_THRESH, SLC_MAX_PTS = 15, 0.5, 400

# ---- NB_S5 names read by the verbatim cells (cell 4, verbatim) --------------------
RANDOM_SEED = 0
PREFER_GCRANSAC = True
NUM_SAMPLE = DKM_NUM_SAMPLES
RANSAC_CONF = 0.99
RANSAC_ITERS = 10000

# Composition variants offered by the server. SemanticStitch is the default.
DEFAULT_VARIANT = dict(kind="semantic", bias=FROZEN_BIAS)
UI_VARIANTS = ("semantic", "firstwins", "dgeo")          # random: API/CLI only


# name -> absolute path, registered by the server for videos it enumerated. Pass A keys
# every cache directory by `name`, so names stay short slugs, never paths.
VIDEO_PATHS: dict[str, Path] = {}


def resolve_video(name: str) -> Path:
    """Notebook cell 2 resolver, with this machine's layout.

    Own videos live flat in OWN_VIDEOS_DIR (notebook: own_videos/); MovingDrone ones in
    <seq>/video.mp4. An absolute path is accepted as-is (the server enumerates the data
    root and passes paths).
    """
    if name in VIDEO_PATHS:
        return VIDEO_PATHS[name]
    if name in VAL_SEQS or (MOVINGDRONE_DIR / name / "video.mp4").exists():
        q = MOVINGDRONE_DIR / name / "video.mp4"
        if q.exists():
            return q
    for ext in (".mp4", ".MP4", ".mov", ".MOV"):
        q = OWN_VIDEOS_DIR / f"{name}{ext}"
        if q.exists():
            return q
    raise FileNotFoundError(f"no video found for {name!r}")
