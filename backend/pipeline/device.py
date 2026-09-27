"""One device resolver (MPS, else CPU) and process-level torch setup.

PYTORCH_ENABLE_MPS_FALLBACK must be in the environment before torch is imported, or ops
without an MPS kernel hard-fail. The server entry point sets it first thing; this module
sets it too so the CLI and parity scripts behave the same way.
"""
import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("MPLBACKEND", "Agg")   # composition imports matplotlib; never open a GUI

import torch  # noqa: E402


def resolve_device() -> str:
    """'mps' on Apple Silicon, else 'cpu'. UAV_DEVICE=cpu forces CPU (parity checks)."""
    forced = os.environ.get("UAV_DEVICE", "").strip().lower()
    if forced in ("cpu", "mps"):
        if forced == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("UAV_DEVICE=mps but torch.backends.mps.is_available() is False")
        return forced
    return "mps" if torch.backends.mps.is_available() else "cpu"


def seed_all(seed: int) -> None:
    """numpy + OpenCV (as the notebook) and torch (added: the notebook left torch unseeded,
    so DKM's multinomial sampling was not reproducible even on CUDA)."""
    import cv2
    import numpy as np

    np.random.seed(seed)
    cv2.setRNGSeed(seed)
    torch.manual_seed(seed)


# ---------------------------------------------------------------------------------------
# MPS batched torch.linalg.inv bug (torch 2.13.0, macOS arm64).
#
# On MPS, torch.linalg.inv over a batched 3-D tensor returns the correct inverse for batch
# element 0 and WRONG values (relative error ~1, up to 1e26+) for every element k >= 1 once
# the matrix side exceeds ~1024 (correct at 1024, wrong from 1100). Single-matrix calls are
# correct at every size. DKM's GP.forward inverts K_yy + sigma*I batched over the symmetric
# pair (b=2, N = 34*45 = 1530 at the 16x scale), so the B->A half of DKM's field is garbage.
# It produced plausible output, not a crash, when an MPS cache flush was in place.
#
# UAV_MPS_INV_MODE selects the replacement used during DKM match() on MPS:
#   per_element (default, "fix A") - invert each batch element separately on MPS. DKM itself
#                                    takes this per-element path when N > 2000.
#   cpu         ("fix B")          - invert on CPU and copy back.
# There is deliberately no mode that re-enables the stock batched MPS inverse.
# ---------------------------------------------------------------------------------------
import contextlib  # noqa: E402
import math  # noqa: E402

_STOCK_INV = torch.linalg.inv
MPS_INV_MODES = ("per_element", "cpu")


def mps_inv_mode() -> str:
    mode = os.environ.get("UAV_MPS_INV_MODE", "per_element").strip().lower()
    if mode not in MPS_INV_MODES:
        raise RuntimeError(f"UAV_MPS_INV_MODE={mode!r}; expected one of {MPS_INV_MODES}")
    return mode


def _inv_per_element(A, *args, **kwargs):
    if A.dim() == 3 and A.shape[0] > 1:
        return torch.cat([_STOCK_INV(A[k:k + 1], *args, **kwargs) for k in range(A.shape[0])])
    return _STOCK_INV(A, *args, **kwargs)


def _inv_on_cpu(A, *args, **kwargs):
    return _STOCK_INV(A.cpu(), *args, **kwargs).to(A.device)


def _replacement(mode: str):
    return {"per_element": _inv_per_element, "cpu": _inv_on_cpu}[mode]


@contextlib.contextmanager
def mps_linalg_inv_fix(device: str):
    """Active only on MPS, only for the duration of the wrapped call (DKM match())."""
    if device != "mps":
        yield
        return
    torch.linalg.inv = _replacement(mps_inv_mode())
    try:
        yield
    finally:
        torch.linalg.inv = _STOCK_INV


def selftest_batched_inverse(device: str, b: int = 2, n: int = 1530, tol: float = 1e-3) -> dict:
    """Invert a batch of b SPD n x n matrices on `device` exactly as DKM would (through
    mps_linalg_inv_fix), compare to CPU, and raise if any element's max relative error
    exceeds `tol`. Called at startup; a failure means DKM output cannot be trusted."""
    g = torch.Generator().manual_seed(1234)
    a = torch.randn(b, n, n, generator=g) / n ** 0.5
    A = a @ a.transpose(1, 2) + 0.1 * torch.eye(n)
    ref = _STOCK_INV(A)
    with torch.no_grad(), mps_linalg_inv_fix(device):
        got = torch.linalg.inv(A.to(device)).cpu()
    errs = [float((got[k] - ref[k]).abs().max() / ref[k].abs().max()) for k in range(b)]
    res = dict(device=device, mode=(mps_inv_mode() if device == "mps" else "stock"), b=b, n=n,
               max_rel_err=max(errs), per_element=errs, tol=tol, passed=max(errs) <= tol and all(map(math.isfinite, errs)))
    if not res["passed"]:
        raise RuntimeError(f"batched inverse self-test FAILED on {device}: max relative error {max(errs):.3e} > {tol} "
                           f"(per element {errs}); refusing to run DKM")
    return res

