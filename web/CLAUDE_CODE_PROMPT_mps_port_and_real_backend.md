# Claude Code Prompt — Port `NB_L2_full_pipeline.ipynb` to Apple Silicon (MPS), wire it to the frontend as the *only* backend, and use a local directory as the datastore

## Role

You are a research engineer working on a UAV video-mosaicking system that is being written up for an IEEE journal. The numerical behaviour of this pipeline has already been calibrated and validated across 40+ videos. **Your job is a port and an integration, not a redesign.** Do not change algorithms, thresholds, or the order of operations. If you believe something in the pipeline is wrong, stop and tell me — do not "improve" it.

## Hard rules (read these before writing any code)

1. **Functional parity is the acceptance criterion.** The MPS pipeline must produce the same frame selections and the same mosaic (within float/backend tolerance) as the CUDA notebook on the same input. Anything that can't be made bit-comparable must be explicitly reported as a numerical-backend difference, with a measured delta — not hand-waved.
2. **Do not touch the calibrated constants.** They are:
   - `OMEGA = 0.164` — gate threshold, applied to **f_m only** (`f_m = n_putative / 500`). `f_u` is *not* gated; it is recorded for diagnostics. (`f_u` never binds: 0 of 29,578 edges in the ablation.)
   - `TAU_S = 3.0` (strict fit), `TAU_R = 4.0` (inlier refit), `MIN_RATIO = 0.35` (accept threshold on refit inlier ratio)
   - `MAX_SIDE = 1920`, `SIFT_NFEATURES = 500`, Lowe ratio `0.8`, `USAC_MAGSAC`, conf `0.999`, max iters `20000`
   - candidate gaps `[1, 2, 4, 8, 16, 32, 64]`, `IOU_TRUST = 0.40`
   - `upsample_preds = False` on the DKM model (this is a validated 2.75–2.90× speedup with unchanged quality — keep it off)
   - If the notebook disagrees with any value above, **do not silently reconcile**. Report the discrepancy and ask.
3. **No mocks anywhere when you are done.** Not as a fallback, not behind a flag, not "in case the backend is down".
4. **No database server.** The datastore is a plain directory tree on disk.

---

## Step 1 — Read before you write

Do not assume anything about the notebook's structure. First:

- Open `NB_L2_full_pipeline.ipynb` and read **every** cell. Produce a short written inventory before coding: each cell's purpose, every top-level function/class it defines, every global constant, every file path, every place it touches `cuda`, `torch.device`, `.cuda()`, `amp`/`autocast`, `pin_memory`, `torch.backends.cudnn`, `float16`/`bfloat16`, Windows path separators, drive letters (`C:\...`), `os.startfile`, or MSVC-only deps.
- Note where the notebook reads its videos from and where it writes outputs.
- Identify the entry point that runs one video end-to-end. That function is what the API will call.

Jupyter MCP is live — you may use it to execute cells against the real notebook to establish the reference behaviour, but **do not leave the system depending on a running Jupyter kernel.** The shipped backend must be plain Python modules.

---

## Step 2 — The MPS port

Extract the notebook into a real Python package (suggested `backend/pipeline/`) with the notebook's functions moved over unchanged in logic. Keep the notebook working as a research artifact; the package is what the server imports. Do not leave two diverging copies of the algorithm — the notebook should import from the package, or be regenerated from it.

Required Apple-Silicon changes, and nothing beyond them:

- **Device selection:** `mps` if `torch.backends.mps.is_available()`, else `cpu`. No CUDA branch left dangling as dead code — one clean resolver.
- **`PYTORCH_ENABLE_MPS_FALLBACK=1`** must be set *before* `import torch` — set it in the server process entry point, not only in a shell script, or ops that lack MPS kernels will hard-fail.
- **Chunked KDE sampling.** DKM's `sample()` builds a dense N×N density matrix; at `N=10000` this OOMs on unified memory. Override `sample()` with a chunked implementation that accumulates the density in blocks and produces the *same* selection given the same RNG seed. This is a known, required workaround — implement it, don't lower N to dodge it.
- **Half precision:** MPS `float16` behaves differently from CUDA's. Default to `float32` unless the notebook's numbers depend on fp16; if they do, measure and report the delta.
- **`torch.backends.cudnn.*`, `autocast(device_type="cuda")`, `pin_memory=True`, non-blocking H2D copies** — remove or make no-ops, with a one-line comment saying why.
- **`to_cpu = (device.type == "mps")`** — the existing codebase already does this in `pipeline_b_zhou.py`; match that pattern where DKM output is post-processed with numpy/OpenCV.
- **Paths:** `pathlib.Path` everywhere, no hard-coded `C:\`. Data root, model-weights path, and run-store root all come from config/env with sane macOS defaults.
- **Determinism:** seed numpy/torch/cv2 RNG at run start and record the seed in the run manifest, so a re-run is reproducible.

After the port, run a **parity check** and write the result into the repo as `PARITY.md`: pick at least 2 videos, run both notebook (CUDA numbers if you have them recorded, otherwise CPU) and the MPS package, and compare — selected frame indices (exact set), per-edge `f_m`/`f_u`/inlier ratio (numeric diff), accepted/rejected decision per edge (must match), final absolute coverage %, wall-clock. Any divergence in the *decision* column is a bug, not a tolerance.

---

## Step 3 — Serve it

Expose the pipeline as a FastAPI service the frontend already expects:

- `POST /runs` — start a run: `{video_id | video_path, params_override?}` → `{run_id}`. Runs execute in a worker (subprocess or thread pool) so the API stays responsive; one run at a time by default, queue the rest.
- `GET /runs` — list runs with status/summary.
- `GET /runs/{id}` — full run record.
- `GET /runs/{id}/artifacts/{name}` — stream any artifact file (mosaic PNG, logs, JSON, figures, zip of the whole run).
- `DELETE /runs/{id}`
- `GET /videos` — enumerate what's in the data root, with probed metadata (fps, native frame count, resolution, duration). **Use the actually-decoded frame count, not `CAP_PROP_FRAME_COUNT`** — the container count overstates by 3 on some of our videos.
- `WS /runs/{id}/events` — progress stream.
- `GET /health` — reports device (`mps`/`cpu`), torch version, whether DKM weights were found.

**The WebSocket contract must match the frontend's existing typed events exactly.** Read the frontend's type definitions first and make the server conform to them; do not redefine the shapes and then patch the frontend. Progress events should carry at minimum: stage, current/total, per-step record (frame indices, gap, `f_m`, `f_u`, inlier ratio, accept/reject, reason on reject), elapsed, ETA. Emit a terminal `completed` or `failed` event with a structured error (stage, exception type, message, traceback in the log artifact) — failures must be first-class, because some videos legitimately defeat the method (e.g. `dirt_path18` at 0.01%, `dirt_path19` at 36.85%). A failed or poor run must render, not blank the UI.

Long runs are the norm — a single UMCD video takes 4–45 minutes on MPS. Design for reconnect: the WS replays the event log from the run directory on connect, so a page refresh mid-run recovers full state. Cancellation must actually kill the worker and leave the run directory in a `cancelled` state.

---

## Step 4 — Local directory as the datastore

No SQLite server, no Postgres, no ORM. One directory per run:

```
runs/
  <run_id>/            # run_id = <UTC timestamp>-<video slug>-<short hash of params>
    manifest.json      # video, fps, native_frames, w, h, duration, all params, seed,
                       # device, torch/cv2 versions, git commit, started/finished, status
    steps.jsonl        # one JSON object per attempted edge, append-only, flushed as it goes
    events.jsonl       # the exact WS events emitted, for replay
    metrics.json       # absolute coverage, n_frames_selected, chain_breaks, timings
    mosaic.png
    observed_area.json # A_observed_px, canvas_w, canvas_h, origin, scale
    run.log            # stdout/stderr of the worker
    artifacts/         # figures, intermediate overlays, anything else produced
```

Rules: writes are atomic (temp file + `os.replace`); `steps.jsonl` and `events.jsonl` are append-and-flush so a crashed run is still inspectable; the index (`GET /runs`) is built by scanning directories — if you add an index cache, it must be rebuildable from the directories alone, which stay the source of truth. Runs must survive a server restart with correct status (a run marked `running` whose worker is gone becomes `interrupted`, not stuck at `running` forever). Keep the existing `manifest.json`/`observed_area.json` field names — we already have tooling that reads them.

---

## Step 5 — Delete the mock backend

- Delete `mockPipelineService` (and any mock fixtures, fake timers, simulated progress generators, seeded demo runs) **from the source tree**. Not commented out.
- `httpPipelineService` becomes the only implementation. Remove the service-selection indirection if it now has one branch.
- Remove any `VITE_USE_MOCK`-style flag and its references.
- `grep` the repo for `mock`, `fake`, `simulate`, `dummy`, `stub`, `TODO: replace`, `lorem` and report every remaining hit with a one-line justification (test fixtures for unit tests are fine — say so; anything on a user-visible path is not).
- The frontend must show honest empty states: no runs yet, backend unreachable, DKM weights missing, no videos in the data root. It must never invent numbers.

While wiring: **do not display the old `fill` metric** (it is measurably wrong — replaced by absolute coverage against a fixed method-independent denominator), and do not present PSNR/SSIM as mosaic quality without the caveat the earlier frontend spec described.

---

## Step 6 — Prove it works

Do not report success on the basis of the code looking right.

1. Start the backend, start the frontend, and drive a **real run of a real video end to end** with Playwright: pick a video, start the run, observe live progress arriving over the WS, wait for completion, view the mosaic, open the frame-selection inspector, download the run zip, confirm the file on disk is non-empty and opens.
2. Refresh the page mid-run and confirm state recovers from the event log.
3. Kill the backend mid-run and confirm the UI shows a clear disconnected state and recovers when it comes back.
4. Run a deliberately failing case and confirm the failure renders with its reason.
5. Confirm `runs/<id>/` on disk contains every file listed above, and that `GET /runs` after a server restart lists it correctly.

Use the shortest video available for the loop so iteration isn't 40 minutes. Attach the Playwright output, and paste the real `metrics.json` and the first/last few lines of `steps.jsonl` from the run you did.

---

## Deliverables

- `backend/` — the ported package, the FastAPI app, the run store, a README with exact macOS setup (venv, torch for MPS, DKM weights location, env vars, how to start).
- `PARITY.md` — the parity evidence from Step 2, with real numbers.
- Frontend diff removing the mock layer and pointing at the live API.
- A short `INTEGRATION_NOTES.md`: what changed for MPS and why, anything that could not be made identical to CUDA with the measured delta, what is still stubbed at the UI level, and what minor UI work remains.

## Working style

Explain your reasoning **before** making a change that affects pipeline behaviour, and wait for me on anything that would alter the algorithm, a constant, or the metric definitions. Work in small verified increments: port → parity check → serve → de-mock → Playwright. Tell me when a stage passes; don't batch it all up and present it at the end. If you hit a blocker in MPS kernel support, tell me exactly which op and what the fallback costs — don't quietly rewrite the math around it.
