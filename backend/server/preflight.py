"""Startup health probe, run as a subprocess by the server (keeps torch out of the API
process):  python -m server.preflight  -> one JSON object on stdout.

The batched-inverse self-test runs the FIXED path only. Never exercise the stock batched
MPS inverse in a process that will go on to run DKM: it corrupts MPS state (see
INTEGRATION_NOTES.md).
"""
from __future__ import annotations

import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import json  # noqa: E402
import platform  # noqa: E402

from pipeline import config as C  # noqa: E402


def main() -> dict:
    import cv2
    import torch

    from pipeline import semantic
    from pipeline.device import mps_inv_mode, resolve_device, selftest_batched_inverse

    from .settings import DKM_WEIGHTS

    dev = resolve_device()
    try:
        st = selftest_batched_inverse(dev)
        st = dict(passed=True, maxRelErr=st["max_rel_err"], tol=st["tol"], b=st["b"], n=st["n"], mode=st.get("mode"),
                  error=None)
    except RuntimeError as e:
        st = dict(passed=False, maxRelErr=None, tol=1e-3, b=2, n=1530, mode=None, error=str(e))
    sem = semantic.status()
    try:
        import pygcransac  # noqa: F401
        estimator = "gcransac"
    except ImportError:
        estimator = "magsac"
    return dict(
        device=dev, torch=torch.__version__, opencv=cv2.__version__, python=platform.python_version(),
        mpsInverseMode=mps_inv_mode() if dev == "mps" else None,
        inverseSelftest=st, estimator=estimator,
        dkm=dict(repo=str(C.DKM_REPO), repoFound=C.DKM_REPO.exists(), weights=str(DKM_WEIGHTS),
                 weightsFound=DKM_WEIGHTS.exists()),
        semstitch=dict(repo=sem["repo"], repoFound=sem["repo_found"], checkpoint=sem["checkpoint"],
                       checkpointFound=sem["checkpoint_found"], sha256=sem["sha256"],
                       expectedSha256=sem["expected_sha256"], verified=sem["verified"], error=sem["error"]),
    )


if __name__ == "__main__":
    print(json.dumps(main()))
