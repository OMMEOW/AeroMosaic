# Integration notes — NB_L2 on Apple Silicon

Status: port, parity and impact study done (PARITY.md, MPS_INV_IMPACT.md). Server, datastore
and frontend integrated against the live API.

End-to-end test: `web/e2e/run_e2e.cjs` (Playwright 1.60, Chromium), 35/35 checks passed on
2026-09-27. Results and screenshots are in `web/e2e/results-2026-09-27/`. It uses the
Playwright library directly because the Playwright MCP was still not visible to the agent
session.

Pending: the SemanticStitch checkpoint and its SHA-256.

## How the package relates to the notebook

`backend/pipeline/_nb_pass_a.py` and `_nb_pass_b.py` are **generated** from
`NB_L2_full_pipeline.ipynb` by `tools/extract_notebook.py`: the defining cells are copied
verbatim and a fixed list of patches is applied, each of which must match exactly once or
generation fails. Every patch appears in the generated source as a `# PATCH:` comment. The
notebook remains the single source of the algorithm; regenerate after editing it.

Cells used — Pass A: 4, 6–11, 13–16. Composition/SLC/coverage: 21–27, 29, 31, 32, 33, 41.
Cell 18's loop body (one video) is `pipeline/run.py:run_pass_a`, with no added logic. Its
stage callbacks (`StageHooks.begin/end`) only report; they do not change the order.

## Changes for MPS, and why (nothing else)

| Change | Where | Why | Numerical effect |
|---|---|---|---|
| `DEVICE = resolve_device()` (mps, else cpu) | cells 4, 21 | one resolver, no dangling CUDA branch | none |
| CUDA device-name print removed | cell 4 | CUDA-only API | none |
| `PYTORCH_ENABLE_MPS_FALLBACK=1` set before `import torch` | `pipeline/device.py`, server entry | ops without MPS kernels fall back instead of failing | none |
| **Fix A:** per-element `torch.linalg.inv` during DKM `match()` on MPS only | cell 13 `dkm_match`, `pipeline/device.py` | torch 2.13.0 MPS batched-inverse bug (below). `UAV_MPS_INV_MODE=cpu` selects fix B (inverse on CPU) for A/B runs; no mode re-enables the stock batched MPS inverse | makes MPS match CPU (≤ 1.5e-4 normalised coords) |
| Startup self-test: invert b=2 × 1530² on the active device through the same path, compare to CPU, refuse to run if max relative error > 1e-3 | `device.selftest_batched_inverse`, called at the start of every run | this bug produced plausible output instead of a crash | none |
| torch seeded at run start (np, cv2 as before) | `device.seed_all` | the notebook never seeded torch, so DKM sampling was not reproducible even on CUDA | makes runs reproducible |
| Paths from env/config, `pathlib` | `pipeline/config.py` | no `C:\` | none |

Not needed on torch 2.13 (tested): moving DKM `sample()` to CPU, and `pipeline_b_zhou.py`'s
non-finite-probability clamp. `torch.multinomial` and fp16 `cdist` both run on MPS. The
clamp would have been a behaviour change, so it was not added.

**Kept as in the notebook:** the chunked KDE's `x.half()` cast. The recorded CUDA numbers
were produced with it (this DKM build imports `kde` at call time, so the notebook's patch
was active). Its measured effect vs fp32 is in PARITY.md.

## MPS blocker found: batched `torch.linalg.inv` (torch 2.13, macOS arm64)

**Op:** `torch.linalg.inv` on a batched 3-D tensor on MPS. **Symptom:** batch element 0 is
correct; every element k ≥ 1 is wrong (relative error ≈ 1, sometimes 1e26+) once the matrix
side exceeds ~1024 (correct at 1024, wrong at 1100+). Reproduced without DKM on random SPD
matrices; independent of allocator state. Per-element calls are correct at every size.

**Where DKM hits it:** `GP.forward` (dkm/models/dkm.py) inverts `K_yy + σI` batched over the
symmetric pair (b = 2) at the 16× scale, N = 34 × 45 = 1530 (< DKM's own 2000 cut-off, above
which it already loops per element). The coarse GP output for the B→A half is therefore wrong on MPS.
After DKM's finer-scale refiners, the final B→A field is mostly corrected. It was measured
on 3 impact-study pairs with the flush in place:
- A→B is bit-identical.
- B→A has a median difference of 0, but is wrong in local regions: up to 0.58 normalised
  coords, with certainty off by up to 0.98.

Without an MPS cache flush it overflows to inf/NaN and `sample()` raises
`AcceleratorError: probability tensor contains either inf, nan or element < 0` (the error
`pipeline_b_zhou.py` worked around by clamping). With the flush it is finite but still wrong.
`sample()` draws from the whole symmetric field, so every MPS correspondence set can contain wrong matches from those regions. MPS_INV_IMPACT.md measures the effect on decisions.

**Fallback cost (measured, road5 pairs, vs CPU DKM):** per-element inverse on MPS — both
halves within ≤ 1.5e-4 (B→A) / ≤ 9e-4 (A→B) normalised coords, certainty ≤ 9e-5, 2.30 s/match
(stock MPS 2.38 s, CPU 7.29 s). Inverse on CPU — same accuracy, 2.20 s/match. **Applied: fix A** (decision
2026-09-26), fix B selectable via `UAV_MPS_INV_MODE=cpu`. All MPS parity runs made before the
fix are set aside in `parity/invalid_mps_batched_inv/`.

**The `torch.mps.empty_cache()` patch was removed.** It had been added for the "degrading
successive MPS matches" noted in `pipeline_b_zhou.py`. Diagnosis showed it only **masked** this
bug: without the flush the wrong half overflows to inf/NaN and `sample()` crashes; with it the
wrong half is finite, locally wrong, and the run completes. It never made results correct. Do not
reinstate it; the startup self-test is what guards against this class of failure.

**Running the stock batched inverse once can poison the whole process.** In the impact study,
one in-process call of the stock b=2 × 1530² inverse (made to show that the self-test rejects
it) was followed by DKM scoring 0.000 on a pair that scores 0.569 in a fresh process. A few
pairs later the process died with a malloc trap (SIGTRAP) inside an MPSGraph convolution
compile. The self-test therefore only ever runs the **fixed** path in-process. Anything that
needs to exercise the stock path does it in a child process (`tools/mps_inv_impact.py`).

## Decisions (2026-09-26)

- **Gate:** keep a pair iff proxy IoU ≥ 0.40 **and** f_m ≥ 0.164. The notebook used
  `S = min(f_m, f_u)`; f_u is now recorded for diagnostics only. The IoU check is a validity
  precondition on the proxy homography and is unchanged. Each probe record carries `reject`
  ∈ {descriptors, putative, proxy_homography, iou, f_m}; each DKM attempt carries f_m, f_u,
  probe IoU, estimator, and `reject_reason` when rejected.
- **RANSAC:** the notebook's values (see NOTEBOOK_INVENTORY.md for every call site).
  **Correction:** the brief's "USAC_MAGSAC, conf 0.999, max iters 20000" line, and SIFT 4000,
  are reference-truth bundle values (the once-computed, method-independent cross-check
  layer), not pipeline values; they were listed among the pipeline constants by mistake and
  have been deleted from that list. SIFT 500 is the probe budget and f_m's denominator; the
  reference chain keeps its own 4000. The two are deliberately not normalised.
- **Homography estimator:** MAGSAC (the notebook's own fallback). pygcransac has no
  macOS-arm64 / Python 3.14 wheel and is not built from source. The CUDA runs used
  GC-RANSAC. The estimator is recorded per attempt and per run.
- **Composition:** SemanticStitch is the default variant. firstwins and dgeo are selectable
  comparisons; random is API/CLI only. Missing checkpoint → that variant fails with
  "SemanticStitch checkpoint not found at <path>"; unverified or mismatched SHA-256 → refuse.
  No silent fallback.

## Server integration (2026-09-27)

**Additive hooks only.** The server gets its records through hooks the notebook code already
calls (`_progress`, `_step`, `_log`) plus one new one, `_attempt_begin(video, attempt, ref, src)`,
called just before `dkm_match`. It exists so that if DKM raises, the `EXCEPTION` record can name
the pair. It changes nothing: the regenerated module differs from the previous one only by that
call.

**Record shapes (agreed 2026-09-27).**
- Stage 1: one record per candidate edge. Stage 2: one record per DKM attempt. Both go into
  `steps.jsonl` and over the WebSocket.
- Reject causes: stage 1 is `PROXY_FIT_FAILED`, `GATE_IOU` or `GATE_FM`, in the notebook's
  check order (IoU before f_m). Stage 2 is `DEGENERATE_H`, `RATIO_BELOW_MIN` or `EXCEPTION`.
- `rejectDetail` keeps the notebook's own sub-reason.
- Unmeasured is null: the notebook's `0.0` placeholders are never reported as measurements.

What `probe_pair` actually measures on each early-exit path:

| Path | Measured | Null |
|---|---|---|
| `descriptors` | nothing | f_m, f_u, IoU, n_put |
| `putative<4` | n_put, f_m | f_u, IoU |
| `proxy_homography` | n_put, f_m | f_u, IoU |

So f_m is non-null on those two `PROXY_FIT_FAILED` paths because the notebook really
computed it.

**Stage 2: `DEGENERATE_H` only ever comes from layer 2.** In `dual_layer`, a failed F fit
(layer 1) does not reject: the notebook keeps every match and goes on to the homography. The
same happens when fewer than 8 matches survive layer 1. `DEGENERATE_H` therefore always means
"layer 2 returned no H", and `rejectDetail` states what layer 1 did. `dual_layer` writes
`inlier_ratio = 0.0` and `n_inliers = 0` as placeholders when there is no H; these are
reported as null.

**`EXCEPTION`:**
- the attempt is recorded with the exception and its location;
- the run fails with status `failed`, the failing stage and a full traceback in `run.log`;
- `steps.jsonl` and `events.jsonl` are already flushed;
- there is no catch-and-continue.

**Composition.**
- firstwins is the temporary default (`UAV_DEFAULT_VARIANT`).
- A semantic run fails at preflight with "SemanticStitch checkpoint not found at <path>"
  when the checkpoint is missing or unverified. There is no fallback.
- The notebook's own per-step first-wins behaviour (overlap < 50 px, or the seam net raising
  on a step) is counted as `seam_fallback` and shown on every run.
- The fill metric that `run_variants` computes is dropped before anything is written.

**Shared caches.** Decoded frames and SIFT-500 descriptors are deterministic (they use no RNG)
and are shared per video file (`cache/decode/<id>-<size>-<mtime>-<MAX_SIDE>`). Everything from
the probe onwards is recomputed per run, so the reference chain and A_observed are per run.
Consequence: when SIFT is served from cache, that run did not measure its SIFT cost, and the
UI withholds the time comparison against the baselines rather than mixing measurements from
different runs.

**Frame counts.** `/videos` reports the decoded count, never CAP_PROP_FRAME_COUNT. It is null
until the file has been decoded once: either by a run (notebook cell 6) or by the background
counter, which only runs while no run is active, smallest file first, niced.

**N=fps baseline** (savings panel): every `round(fps)`-th decoded frame, chained. This is the
definition in `src/uav_common.py` and `native_gate_validate.py`. `validate_dag_native.py` used
the container frame count; the server uses the decoded count.

**Removed:**
- the old demo server (`backend/main.py`, `pipeline_adapter.py`, `placeholder_mosaic.png`),
  which faked step progress on a timer;
- `web/src/services/mock/` and the service-selection indirection;
- `NEXT_PUBLIC_PIPELINE_BACKEND` / `NEXT_PUBLIC_MOCK_SPEED`;
- the mock-era Playwright snapshots and fixtures in `.playwright-mcp/`.

**Not ours:** `web/OAIV-Coherence` is a second clone of SemanticStitch (same commit, 3d6d1c2,
created 2026-09-27 01:41, no checkpoint). Nothing references it. Config points only at
`Major/OAIV-Coherence`.

## Per-pair visualisation (2026-09-27)

**What is emitted, per attempted pair. Everything is a real record or a deterministic
recomputation:**
- **`pair.start`**, written before the notebook's `t1`, so it is outside `durationMs`:
  - the two frames;
  - the stage-1 gate evidence (f_m, f_u, IoU, n_put, n_in, passed / would-pass flags);
  - the SIFT putatives, recomputed from the stored SIFT-500 descriptors with the probe's own
    BFMatcher and ratio test. These are deterministic, so they are exactly the probe's
    matches. The probe's MAGSAC proxy fit is **not** re-run: it would consume OpenCV's RNG and
    change everything downstream.
- **`pair.substage`**, one event per real boundary, from additive `_substage(name)` markers:
  - inside the timed region: `load` (`get_model()` plus `imread`; on the first attempt this
    includes the DKM model load, as `durationMs` always has), `dkm_forward`, `sample`,
    `strict_fit` (layer 1, τs 3.0), `refit` (layer 2, τr 4.0) and `cache` (writing
    `corr_<a>.npz`);
  - then the end of the timed region;
  - then `residuals` (accepted steps only, outside `durationMs` as before).
  - A marker only takes `perf_counter()` and enqueues; a writer thread emits the event. The
    DKM forward pass is one opaque call, and the UI shows only its name and elapsed time.
- **Per-pair "warp" and "compose" stages do not exist in this pipeline.** The notebook
  composes once, after every DKM step (Pass B). What the panel shows instead is a
  **preview canvas**: accepted frames placed by the same accumulated homography
  (`G ← G @ H`, with H taken from the attempt's correspondence cache), first-wins and
  downscaled. It is labelled as a preview, not the final composition, and it is built outside
  the timed region.
- **`pair.done`**:
  - the verdict and `reject_cause`;
  - DKM inlier lines from `corr_<a>.npz`, evenly subsampled (no RNG) to 200, and the caption
    says so;
  - the ratio against 0.35;
  - the canvas, with the new frame's quad.

**Timing integrity, measured on dirt_path13 (14 attempts each, same seed, same code):**

| Run | viz | mean `durationMs` | median |
|---|---|---|---|
| A | on | 2924 | 2831 |
| B | off | 2933 | 2866 |
| C | on | 2920 | 2856 |
| D | off | 2942 | 2877 |

- `durationMs` is not inflated by the feature; the differences are noise.
- Inlier ratios and the pair sequence are **identical** between on and off, which confirms
  the visualisation never touches the pipeline's RNG streams.
- `_attempt_begin` (added earlier for `EXCEPTION` attribution) was **moved before `t1`**. It
  had been inside the timed region, emitting an fsync'd event there.

**Added wall-clock per pair** (JPEG encoding, putatives, canvas; outside `durationMs`):
77.6 ms mean, 90.2 ms max. That is 2.6% of the ~2.93 s mean match time, under the 10% budget,
so no extra downscaling was needed. Overlays are JPEG q80:
- frames: long side ≤ 640;
- canvas: long side ≤ 1280.

**Option and retention:**
- `vizEnabled` is recorded in `manifest.json`. The API defaults it to **off**, so
  benchmark and batch callers get the untouched path; the web UI turns it on.
- Single-pair runs always visualise.
- Overlays go to `artifacts/pairs/<i>_<j>/`, with `index.json`.
- Retention keeps the most recent `UAV_VIZ_KEEP` (default 50) pairs plus every rejected pair.
  Pruning was verified on a real run (keep 5: 9 of 14 pruned, 1.2 MB total) and by a unit
  check that rejected pairs survive. The UI says when overlays were pruned.
- Images are streamed by URL, never base64 inside WS frames.

**Single-pair mode** (`POST /api/runs {videoId, pair:[i,j]}`, `pipeline/run.py:run_single_pair`):
- decode and SIFT-500 (cached);
- the probe for that one pair (so the gate verdict is real);
- then **one iteration of cell 16's attempt body**: same calls, order, accept rule and record
  fields.
- The pair goes to DKM whether or not the gate admits it, and the gate verdict is shown beside
  the DKM verdict. Example: 0→64 on dirt_path13 has gate IoU 0.02 < 0.40, and DKM gives
  ratio 0.102 < 0.35. The two stages agree.
- There is no reference chain, composition or coverage.

## Composition, seam metrics, videos, PDF (2026-09-27, later)

**SemanticStitch checkpoint.** `OAIV-Coherence/checkpoints/epoch090_model.pth` has sha256
`412503d5ff0d161c4d4a6f7f02ff74641572839e8269249ae8907cdf46376991`. The project owner
designated it canonical. **It was not cross-checked against the Windows machine's copy.** It
is the default expected hash (`config.SEMSTITCH_SHA256_CANONICAL`, overridable with
`UAV_SEMSTITCH_SHA256`), is verified on every load, and is recorded in every manifest. It
loads on MPS (46 tensors, 3.3 s).

**Variants in the UI:** SemanticStitch (the default), hybrid and d_geo. firstwins and random
are API/CLI only.
- **Hybrid** requires `wSem` from the notebook grid {0, 0.25, 0.5, 0.75, 1}. There is no
  default and nothing is pre-selected: the UI will not start, and the API returns 422. The
  value is recorded as `hyb_w<w>_b0`.
- **Hybrid sweep** (`variant: "hybrid_sweep"`) is the notebook's procedure (cell 39):
  - every w_sem is composed at bias 0.0 and scored with SLC;
  - the lowest-SLC value is marked;
  - `mosaic.png` is that w_sem's mosaic, for inspection;
  - all five previews are in `artifacts/sweep/`.
  - The UI states the ~5× composition cost before starting, and states next to the SLC column
    that the choice is made on the evaluation signal with no held-out selection.
  - The winner is never carried forward as a default.
  - On dirt_path13 the sweep's w_sem 0.5 row equals an independent hybrid run at 0.5
    (slc 0.1219).

**Seam-line metrics.** `metrics.json` → `composition.seam` holds the notebook's
`run_variants` row under its own names: `slc_frac_disagree`, `slc_p10`, `slc_mean`, `slc_n`,
`seam_step`, `bg_step`, `sharp_overlap`, `seam_new_frac` and the rest. The canvas-relative
`fill` and `overlap_frac` are excluded. Runs composed before this change get the fields from
`artifacts/composition_metrics.json`. Only `slc_frac_disagree` is judged for direction
("lower = better" in the notebook); the others are shown without a judgement.

**Videos:**
- `POST /api/videos` (multipart) copies a file into `<data root>/uploads/`, checking it decodes
  first.
- `POST /api/videos/link {path}` registers a file by path without copying it (external
  drives), in `cache/linked_videos.json`.

**PDF report:** `GET /api/runs/{id}/report.pdf`, rendered with matplotlib from `manifest.json`,
`metrics.json` and `steps.jsonl`. It has four or more pages: summary and mosaic; metrics with
baselines, seam metrics and the sweep; stage-1 and stage-2 figures; the DKM attempts table.
It is written atomically and cached as `artifacts/report.pdf`, so it is included in the run
zip. The UI offers it from the run header, the Run files menu and History; the older printable
page is still at `/runs/{id}/report`.

**Finding (not changed): the proxy IoU can exceed 1.**
- In `probe_pair`, `union = area + contourArea(warped) − inter`. When the SIFT proxy
  homography folds the frame, `contourArea` of the self-intersecting quad is small or signed,
  so the IoU exceeds 1 and passes the IoU ≥ 0.40 trust check.
- dirt_path13 has 2 such edges of 1,273: (48,112) with IoU 5.63 and (66,130) with IoU 6.72.
  Both were fitted from 4 proxy inliers out of 7–10 putatives, and both were rejected by f_m.
- road5 and suburban3 have none. No such edge has passed the gate in any run checked.
- The IoU check alone does not reject folded proxies. The notebook's check is unchanged
  pending the owner's decision.

## Could not be made identical to the CUDA runs

See PARITY.md for measured deltas.
