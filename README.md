# AeroMosaic

UAV video mosaicking on Apple Silicon: the NB_L2 pipeline (SIFT-gated frame selection,
DKM dense matching with a dual-layer geometric constraint, SemanticStitch composition),
served by a local FastAPI backend and driven from a Next.js web app.

```
backend/   pipeline package (generated from the notebook), FastAPI server, run datastore
web/       AeroMosaic web app (Next.js), end-to-end test in web/e2e/
```

## Run

```sh
# backend  (http://localhost:8000)
cd backend
python3.14 -m venv .venv && .venv/bin/pip install -r requirements.txt    # once
.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000

# web app  (http://localhost:3000)
cd web
npm install                                                             # once
npm run dev
```

`GET /api/health` reports the device, the batched-inverse self-test, the DKM weights and the
SemanticStitch checkpoint. Runs are refused until the self-test passes.

## What to read

| File | What it answers |
|---|---|
| `backend/README.md` | configuration, datastore layout, API |
| `backend/INTEGRATION_NOTES.md` | every change made for MPS and the server, and why; open findings |
| `backend/PARITY.md` | the port reproduces the notebook (CPU: identical; MPS: within DKM sampling noise) |
| `backend/MPS_INV_IMPACT.md` | the torch 2.13 MPS batched-inverse bug did not change the published results |
| `backend/NOTEBOOK_INVENTORY.md` | the notebook, cell by cell |
| `web/src/services/contract.ts` | every wire shape between the app and the backend |

## Test

```sh
cd web/e2e && node run_e2e.cjs     # needs the backend on :8000 and the web app on :3100 (edit WEB in the script)
```
