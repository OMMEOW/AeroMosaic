# backend — NB_L2 on Apple Silicon, served

- `pipeline/`: the notebook, as a package. `_nb_pass_a.py` and `_nb_pass_b.py` are generated
  from `web/NB_L2_full_pipeline.ipynb` by `tools/extract_notebook.py`; don't edit them.
- `server/`: a FastAPI service plus one worker process per run.
- `runs/`: the datastore, one directory per run.
- `cache/`: decoded frames and SIFT-500 descriptors, shared per video file.

See PARITY.md (does the port match the notebook), MPS_INV_IMPACT.md (did the MPS inverse
bug change published results), and INTEGRATION_NOTES.md (every change and decision).

## Run it

```sh
# backend (from backend/)
python3.14 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000

# frontend (from web/)
npm install                                                             # once
npm run dev            # http://localhost:3000; API base: NEXT_PUBLIC_API_BASE_URL (default http://localhost:8000)
```

`GET /api/health` reports the device, torch version, batched-inverse self-test result, DKM
weights and SemanticStitch checkpoint status. Runs are refused until the self-test passes and
the DKM weights are present.

## Environment

| Variable | Default | |
|---|---|---|
| `UAV_PROJECT_ROOT` | `~/My Stuff/Major` | |
| `UAV_DATA_ROOT` | `$UAV_PROJECT_ROOT/data` | Videos come from `videos/`, `MovingDrone/*/video.mp4` and `umcd/**` |
| `UAV_RUNS_ROOT` | `backend/runs` | Datastore |
| `UAV_CACHE_ROOT` | `backend/cache` | Decode and SIFT-500 cache, frame counts, thumbnails |
| `UAV_DKM_REPO` | `$UAV_PROJECT_ROOT/DKM` | Weights: `$TORCH_HOME/hub/checkpoints/DKMv3_outdoor.pth` (never downloaded by the server) |
| `UAV_SEMSTITCH_REPO` | `$UAV_PROJECT_ROOT/OAIV-Coherence` | The canonical clone (3d6d1c2) |
| `UAV_SEMSTITCH_CKPT` | `<repo>/checkpoints/epoch090_model.pth` | |
| `UAV_SEMSTITCH_SHA256` | unset | Required. Semantic runs refuse to start without a matching hash |
| `UAV_DEFAULT_VARIANT` | `firstwins` | **Temporary** (2026-09-27), until the checkpoint arrives |
| `UAV_DEVICE` | `mps` if available, else `cpu` | |
| `UAV_MPS_INV_MODE` | `per_element` | `cpu` selects fix B (see INTEGRATION_NOTES.md) |
| `UAV_CORS_ORIGINS` | `localhost` and `127.0.0.1` on ports 3000 and 3100 | |
| `UAV_CANCEL_GRACE_S` | `15` | SIGTERM, then SIGKILL after this |

## Datastore

```
runs/<UTC timestamp>-<video id>-<hash of params, variant, seed, video>/
  manifest.json        video, fps, native_frames (decoded), width, height, duration_s,
                       chain_breaks, params (every constant), seed, variant, device,
                       versions, estimator, notebook/DKM/SemanticStitch provenance,
                       inverse self-test, status, created/started/finished, failed_stage, error
  steps.jsonl          one record per candidate edge (stage 1) and per DKM attempt (stage 2)
  events.jsonl         every event sent over the WebSocket, in seq order (replayed on connect)
  metrics.json         absolute coverage, stage counts and reject causes, timings, baselines
  mosaic.png, mosaic_preview.png
  observed_area.json   A_observed_px, canvas_w, canvas_h, origin, scale (existing field names)
  run.log              worker stdout/stderr, full tracebacks
  artifacts/           trace.json, selection.json, composition_metrics.json, observed_area_mask.png
  work/                scratch (symlinked frames, per-attempt caches); excluded from run.zip
```

- JSON files are written atomically (temp file, fsync, `os.replace`).
- The `.jsonl` files are append-and-fsync, under an flock shared by the worker and the server.
- `GET /api/runs` is a directory scan; there is no index to go stale.
- On startup, a `running` run whose worker is still alive is re-adopted. One whose worker is
  gone becomes `interrupted`.

## API

See `web/src/services/contract.ts`, the single definition of every wire shape. In short:
- `/api/health`
- `/api/videos[/{id}]`
- `POST /api/runs {videoId, variant?, seed?}`
- `GET /api/runs[/{id}]`
- `/api/runs/{id}/events` (REST replay) and `WS /api/runs/{id}/events?since=`
- `/api/runs/{id}/steps`, `/log`, `/artifacts[/{name}]` (`run.zip` = the whole run)
- `POST /api/runs/{id}/cancel`, `DELETE /api/runs/{id}`

## Regenerating the package

```sh
.venv/bin/python tools/extract_notebook.py   # fails if any patch no longer matches exactly once
```
