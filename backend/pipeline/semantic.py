"""SemanticStitch loading with provenance checks.

The seam predictor itself is the notebook's `SemanticStitchSeam` (cell 24), unchanged.
This module only decides whether it may be loaded:

* no checkpoint file            -> SemanticStitchUnavailable("SemanticStitch checkpoint not found at <path>")
* no expected hash configured   -> refuse: unverified weights are not the notebook's weights
* hash mismatch                 -> refuse
There is no fallback to another seam: a run that asked for `semantic` either gets
SemanticStitch or fails that variant with the reason.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from . import config as C


class SemanticStitchUnavailable(RuntimeError):
    pass


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def status() -> dict:
    """Checkpoint status for /health and manifests, without loading the network."""
    ckpt = C.SEMSTITCH_CKPT
    st = dict(repo=str(C.SEMSTITCH_REPO), repo_found=C.SEMSTITCH_REPO.exists(), checkpoint=str(ckpt),
              checkpoint_found=ckpt.exists(), expected_sha256=C.SEMSTITCH_SHA256, sha256=None, verified=False, error=None)
    if not st["repo_found"]:
        st["error"] = f"SemanticStitch repo not found at {C.SEMSTITCH_REPO}"
    elif not ckpt.exists():
        st["error"] = f"SemanticStitch checkpoint not found at {ckpt}"
    else:
        st["sha256"] = sha256_file(ckpt)
        if not C.SEMSTITCH_SHA256:
            st["error"] = ("SemanticStitch checkpoint hash not configured (set UAV_SEMSTITCH_SHA256 to the Windows "
                           "machine's value); refusing to use unverified weights")
        elif st["sha256"] != C.SEMSTITCH_SHA256:
            st["error"] = f"SemanticStitch checkpoint SHA-256 mismatch: file {st['sha256']}, expected {C.SEMSTITCH_SHA256}"
        else:
            st["verified"] = True
    return st


def load() -> tuple[object, dict]:
    """Return (SemanticStitchSeam, status) or raise SemanticStitchUnavailable."""
    st = status()
    if not st["verified"]:
        raise SemanticStitchUnavailable(st["error"])
    from . import _nb_pass_b as B

    seam = B.SemanticStitchSeam(C.SEMSTITCH_REPO, C.SEMSTITCH_CKPT, arch=C.SEMSTITCH_ARCH, max_side=C.SEAM_MAX_SIDE)
    return seam, st
