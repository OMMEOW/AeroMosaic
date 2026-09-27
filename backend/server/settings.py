"""Server settings. Pipeline constants live in pipeline/config.py; nothing here changes them."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")   # before anything can import torch

from pipeline import config as C  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
RUNS_ROOT: Path = C.RUNS_ROOT
CACHE_ROOT: Path = C.CACHE_ROOT
PYTHON = sys.executable

# SemanticStitch is the default (its checkpoint is present and designated canonical,
# 2026-09-27). It still fails loudly if the checkpoint is missing or its hash changes.
# UI: semantic, hybrid (w_sem required, no default), d_geo; plus the hybrid sweep as a separate
# action. firstwins and random stay available to the API/CLI only.
DEFAULT_VARIANT = os.environ.get("UAV_DEFAULT_VARIANT", "semantic")
UI_VARIANTS = ("semantic", "hybrid", "dgeo")
API_VARIANTS = UI_VARIANTS + ("hybrid_sweep", "firstwins", "random")

CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "UAV_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3100,http://127.0.0.1:3100").split(",") if o.strip()]

# Cancellation: SIGTERM, then SIGKILL if the worker has not exited after this long.
CANCEL_GRACE_S = float(os.environ.get("UAV_CANCEL_GRACE_S", "15"))

DKM_WEIGHTS = Path(os.environ.get("TORCH_HOME", Path.home() / ".cache" / "torch")) / "hub" / "checkpoints" / "DKMv3_outdoor.pth"
NOTEBOOK = BACKEND_DIR.parent / "web" / "NB_L2_full_pipeline.ipynb"
