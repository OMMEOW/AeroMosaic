# UAV mosaicking dashboard

A local React + FastAPI dashboard: upload a video, watch the pipeline
register frames step by step, see the resulting mosaic.

Right now the backend runs a **demo stand-in** (fake steps on a timer)
so you can run the whole stack today and see it work end to end. See
`backend/pipeline_adapter.py` for exactly where to plug in your real
`pipeline_a_hwang.py` (or `pipeline_b_zhou.py`) — that's the only file
you should need to touch.

## Run the backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # or use your existing uav venv
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Upload any
video file and click "Run pipeline" — you'll see fake step-by-step
progress and a placeholder mosaic, proving the upload -> WebSocket ->
live dashboard -> result flow works.

## Wiring in your real pipeline

Open `backend/pipeline_adapter.py`. Replace the body of
`run_pipeline_with_progress` with a call into your actual pipeline
module, passing `step_callback` through so it gets called once per
registration step. Full details and the exact expected dict shapes
are in that file's docstring.

If your pipeline function doesn't currently accept a callback, the
minimal addition is one optional kwarg it calls after each step —
nothing about the acceptance/blending logic itself needs to change.
# uav_front
