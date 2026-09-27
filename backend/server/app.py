"""FastAPI service for the NB_L2 pipeline.  Run:  .venv/bin/uvicorn server.app:app --port 8000

REST under /api, WebSocket /api/runs/{id}/events?since=N. The event stream is a replay of
events.jsonl (seq > since) followed by a live tail; a client that reconnects mid-run
recovers full state by folding the replay (web/src/lib/runReducer.ts).
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import subprocess
import threading
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from pipeline import config as C

from . import manager as M
from . import videos as V
from .jsonio import EventLog, iter_jsonl
from .settings import API_VARIANTS, BACKEND_DIR, CORS_ORIGINS, DEFAULT_VARIANT, PYTHON, RUNS_ROOT, UI_VARIANTS

VERSION = "1.0.0"
RUNS = M.RunManager()
_health: dict = {"state": "pending"}
_health_lock = threading.Lock()
_counter: V.BackgroundCounter | None = None


def _run_preflight():
    """Device, torch, self-test, weights, checkpoint -- probed once in a subprocess."""
    global _health
    t0 = time.time()
    try:
        r = subprocess.run([PYTHON, "-m", "server.preflight"], cwd=BACKEND_DIR, capture_output=True, text=True,
                           timeout=600, env=dict(os.environ, PYTORCH_ENABLE_MPS_FALLBACK="1"))
        line = next((ln for ln in reversed(r.stdout.splitlines()) if ln.startswith("{")), None)
        info = json.loads(line) if line else None
        err = None if info else (r.stderr.strip().splitlines() or ["preflight produced no output"])[-1]
    except Exception as e:  # noqa: BLE001
        info, err = None, str(e)
    with _health_lock:
        _health = dict(state="ready" if info else "error", info=info, error=err, probedInMs=int((time.time() - t0) * 1000))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _counter
    RUNS.startup()
    threading.Thread(target=_run_preflight, daemon=True).start()
    _counter = V.BackgroundCounter(idle=RUNS.is_idle)
    _counter.start()
    yield
    RUNS.shutdown()
    if _counter:
        _counter.stop.set()


app = FastAPI(title="AeroMosaic API (NB_L2)", version=VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["Content-Disposition", "Content-Length"])


def err(status: int, code: str, message: str, run_id: str | None = None):
    body = {"code": code, "message": message}
    if run_id:
        body["runId"] = run_id
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(HTTPException)
async def _http_exc(_req: Request, exc: HTTPException):
    d = exc.detail if isinstance(exc.detail, dict) else {"code": f"http_{exc.status_code}", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=d)


def _not_found(what: str):
    raise HTTPException(404, {"code": "not_found", "message": f"{what} not found"})


# ---------------------------------------------------------------------------- health
@app.get("/api/health")
def health():
    with _health_lock:
        h = dict(_health)
    info = h.get("info") or {}
    st = info.get("inverseSelftest") or {}
    blockers = []
    if h["state"] == "pending":
        blockers.append("startup self-test still running")
    elif h["state"] == "error":
        blockers.append(f"startup probe failed: {h.get('error')}")
    else:
        if not st.get("passed"):
            blockers.append(f"batched-inverse self-test failed: {st.get('error')}")
        if not (info.get("dkm") or {}).get("weightsFound"):
            blockers.append(f"DKM weights not found at {(info.get('dkm') or {}).get('weights')}")
    return dict(
        ok=h["state"] == "ready" and not blockers, state=h["state"], version=VERSION,
        backend=f"fastapi · {info.get('device', '?')}", blockers=blockers, runsAllowed=not blockers,
        info=info or None, error=h.get("error"),
        defaultVariant=DEFAULT_VARIANT, variants=list(UI_VARIANTS), hybridGrid=[float(x) for x in C.HYBRID_W],
        activeRunId=RUNS.active_id(), queued=len(RUNS.queue),
        frameCounter=_counter.current if _counter else None,
        runsRoot=str(RUNS_ROOT), dataRoot=str(C.DATA),
        constants=dict(omega=C.OMEGA, iouTrust=C.IOU_TRUST, gateScore=C.GATE_SCORE, minInlierRatio=C.MIN_RATIO,
                       tauS=C.TAU_S, tauR=C.TAU_R, candidateGaps=list(C.CANDIDATE_GAPS),
                       probeNFeatures=C.PROBE_NFEATURES, dkmNumSamples=C.DKM_NUM_SAMPLES,
                       upsamplePreds=C.UPSAMPLE_PREDS, maxSide=C.MAX_SIDE),
    )


@app.post("/api/health/refresh")
def health_refresh():
    threading.Thread(target=_run_preflight, daemon=True).start()
    return {"state": "pending"}


# ---------------------------------------------------------------------------- videos
def _video(video_id: str) -> dict:
    for v in V.enumerate_videos():
        if v["id"] == video_id:
            return v
    _not_found(f"video {video_id!r}")


@app.get("/api/videos")
def list_videos():
    return [V.probe(v) for v in V.enumerate_videos()]


@app.post("/api/videos", status_code=201)
def upload_video(file: UploadFile = File(...)):
    """Copy an uploaded video into <data root>/uploads/ and return it probed."""
    try:
        dest = V.safe_upload_path(file.filename or "video.mp4")
    except ValueError as e:
        raise HTTPException(422, {"code": "bad_file", "message": str(e)})
    tmp = dest.with_name("." + dest.name + ".part")
    with open(tmp, "wb") as f:
        while chunk := file.file.read(8 << 20):
            f.write(chunk)
    try:
        V.check_decodable(tmp)
    except ValueError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(422, {"code": "undecodable", "message": f"{file.filename}: {e}"})
    os.replace(tmp, dest)
    v = next(x for x in V.enumerate_videos() if Path(x["path"]) == dest)
    return V.probe(v)


class LinkVideo(BaseModel):
    path: str


@app.post("/api/videos/link", status_code=201)
def link_video(req: LinkVideo):
    """Register a video by path without copying it (e.g. on an external drive)."""
    try:
        p = V.add_link(req.path)
    except ValueError as e:
        raise HTTPException(422, {"code": "bad_path", "message": str(e)})
    v = next(x for x in V.enumerate_videos() if Path(x["path"]).resolve() == p)
    return V.probe(v)


@app.get("/api/videos/{video_id}")
def get_video(video_id: str):
    return V.probe(_video(video_id))


@app.post("/api/videos/{video_id}/count")
def count_video(video_id: str):
    """Decode the whole file now to get its exact frame count (blocking; can take minutes)."""
    v = _video(video_id)
    V.record_decoded_count(v["id"], v["path"], V.count_decoded(v["path"]), "decode-count")
    return V.probe(v)


@app.get("/api/videos/{video_id}/thumbnail.jpg")
def video_thumb(video_id: str):
    try:
        return FileResponse(V.thumbnail(_video(video_id)), media_type="image/jpeg")
    except FileNotFoundError as e:
        raise HTTPException(422, {"code": "undecodable", "message": str(e)})


@app.get("/api/videos/{video_id}/preview")
def video_preview(video_id: str):
    v = _video(video_id)
    return FileResponse(v["path"], media_type="video/mp4" if v["path"].suffix.lower() in (".mp4", ".m4v") else None)


# ---------------------------------------------------------------------------- runs
class CreateRun(BaseModel):
    videoId: str
    variant: str | None = None
    seed: int = C.RANDOM_SEED
    # Per-pair visualisation. Off unless asked for (benchmark/batch callers get the untouched
    # path); the web UI asks for it on interactive runs. Always on for single-pair runs.
    viz: bool = False
    # Single-pair mode: [i, j] native frame indices, i < j.
    pair: list[int] | None = None
    # Hybrid only: one of the notebook grid values; required, never defaulted.
    wSem: float | None = None


@app.post("/api/runs", status_code=201)
def create_run(req: CreateRun):
    kind = req.variant or DEFAULT_VARIANT
    if req.pair is not None:
        if len(req.pair) != 2 or not (0 <= req.pair[0] < req.pair[1]):
            raise HTTPException(422, {"code": "bad_pair", "message": "pair must be [i, j] with 0 <= i < j"})
    if kind not in API_VARIANTS:
        raise HTTPException(422, {"code": "bad_variant", "message": f"variant must be one of {list(API_VARIANTS)}"})
    h = health()
    if not h["runsAllowed"]:
        raise HTTPException(503, {"code": "not_ready", "message": "; ".join(h["blockers"])})
    v = _video(req.videoId)
    probe = V.probe(v)
    n = probe["probe"]["frameCount"]
    if req.pair is not None and n is not None and req.pair[1] >= n:
        raise HTTPException(422, {"code": "bad_pair", "message": f"frame {req.pair[1]} is out of range: {v['id']} has {n} decoded frames (0..{n - 1})"})
    try:
        return RUNS.create(probe | {"path": v["path"], "group": v["group"]}, kind, req.seed, viz=req.viz,
                           pair=tuple(req.pair) if req.pair else None, w_sem=req.wSem)
    except ValueError as e:
        raise HTTPException(422, {"code": "bad_variant", "message": str(e)})


@app.get("/api/runs")
def list_runs():
    return M.list_runs()


@app.get("/api/runs/active")
def active_run():
    rid = RUNS.active_id()
    if not rid:
        return Response(status_code=204)
    return M.summary(RUNS_ROOT / rid)


def _dir(run_id: str) -> Path:
    d = M.run_dir(run_id)
    if d is None:
        _not_found(f"run {run_id!r}")
    return d


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    return M.summary(_dir(run_id))


@app.get("/api/runs/{run_id}/events")
def get_events(run_id: str, since: int = 0):
    """REST replay of events.jsonl (same objects the WebSocket sends)."""
    d = _dir(run_id)
    body = "[" + ",".join(json.dumps(e) for e in iter_jsonl(d / "events.jsonl") if e.get("seq", 0) > since) + "]"
    return Response(body, media_type="application/json")


@app.get("/api/runs/{run_id}/steps")
def get_steps(run_id: str, stage: int | None = None):
    d = _dir(run_id)
    recs = [r for r in iter_jsonl(d / "steps.jsonl") if stage is None or r.get("stage") == stage]
    return Response("[" + ",".join(json.dumps(r) for r in recs) + "]", media_type="application/json")


@app.get("/api/runs/{run_id}/log")
def get_log(run_id: str):
    p = _dir(run_id) / "run.log"
    return Response(p.read_bytes() if p.exists() else b"", media_type="text/plain; charset=utf-8")


@app.post("/api/runs/{run_id}/cancel", status_code=202)
def cancel_run(run_id: str):
    try:
        return RUNS.cancel(run_id)
    except KeyError:
        _not_found(f"run {run_id!r}")
    except M.Conflict as e:
        raise HTTPException(409, {"code": e.code, "message": str(e), "runId": e.run_id})


@app.delete("/api/runs/{run_id}", status_code=204)
def delete_run(run_id: str):
    try:
        RUNS.delete(run_id)
    except KeyError:
        _not_found(f"run {run_id!r}")
    except M.Conflict as e:
        raise HTTPException(409, {"code": e.code, "message": str(e), "runId": e.run_id})
    return Response(status_code=204)


# ---------------------------------------------------------------------------- artifacts
TOP_FILES = ("manifest.json", "steps.jsonl", "events.jsonl", "metrics.json", "mosaic.png", "mosaic_preview.png",
             "observed_area.json", "run.log")
MEDIA = {".json": "application/json", ".jsonl": "application/x-ndjson", ".png": "image/png", ".log": "text/plain",
         ".txt": "text/plain", ".jpg": "image/jpeg", ".zip": "application/zip"}


def _artifact_list(d: Path) -> list[dict]:
    out = []
    for name in TOP_FILES:
        p = d / name
        if p.exists():
            out.append(dict(name=name, sizeBytes=p.stat().st_size))
    art = d / "artifacts"
    if art.is_dir():
        for p in sorted(art.rglob("*")):
            if p.is_file() and not p.name.startswith("."):
                out.append(dict(name=str(p.relative_to(d)), sizeBytes=p.stat().st_size))
    return out


@app.get("/api/runs/{run_id}/artifacts")
def list_artifacts(run_id: str):
    d = _dir(run_id)
    return dict(files=_artifact_list(d), zip=f"/api/runs/{run_id}/artifacts/run.zip")


def _zip_bytes(d: Path) -> bytes:
    """Everything in the run directory except work/ (scratch: symlinked decoded frames and
    per-attempt caches)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in _artifact_list(d):
            z.write(d / f["name"], f"{d.name}/{f['name']}")
    return buf.getvalue()


@app.get("/api/runs/{run_id}/artifacts/{name:path}")
def get_artifact(run_id: str, name: str):
    d = _dir(run_id)
    if name == "run.zip":
        data = _zip_bytes(d)
        return Response(data, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{d.name}.zip"'})
    allowed = {f["name"] for f in _artifact_list(d)}
    if name not in allowed:
        _not_found(f"artifact {name!r}")
    p = d / name
    return FileResponse(p, media_type=MEDIA.get(p.suffix, "application/octet-stream"),
                        filename=p.name if p.suffix not in (".png", ".jpg") else None)


@app.get("/api/runs/{run_id}/report.pdf")
def report_pdf(run_id: str):
    """The run report as a PDF, rendered from the run's own files (also saved as artifacts/report.pdf)."""
    d = _dir(run_id)
    m = json.loads((d / "manifest.json").read_text())
    if m.get("status") != "succeeded" or m.get("kind", "video") != "video":
        raise HTTPException(409, {"code": "no_report", "message": "PDF reports exist for succeeded whole-video runs only"})
    from . import report_pdf as RP
    p = RP.build(d)
    return FileResponse(p, media_type="application/pdf", filename=f"{run_id}_report.pdf")


@app.get("/api/runs/{run_id}/mosaic.png")
def mosaic(run_id: str):
    p = _dir(run_id) / "mosaic.png"
    if not p.exists():
        _not_found("mosaic")
    return FileResponse(p, media_type="image/png")


@app.get("/api/runs/{run_id}/mosaic_preview.png")
def mosaic_preview(run_id: str):
    p = _dir(run_id) / "mosaic_preview.png"
    if not p.exists():
        _not_found("mosaic preview")
    return FileResponse(p, media_type="image/png")


@app.get("/api/runs/{run_id}/frames/{index}.jpg")
def frame_thumb(run_id: str, index: int, w: int = Query(320, ge=32, le=1920)):
    import cv2
    d = _dir(run_id)
    m = json.loads((d / "manifest.json").read_text())
    cache = m.get("decode_cache")
    if not cache:
        _not_found("decoded frames")
    src = Path(cache) / "frames" / f"{index:06d}.png"
    if not src.exists():
        _not_found(f"frame {index}")
    out = Path(cache) / "thumbs" / f"{index:06d}_{w}.jpg"
    if not out.exists():
        out.parent.mkdir(exist_ok=True)
        img = cv2.imread(str(src))
        h, ww = img.shape[:2]
        s = min(1.0, w / ww)
        if s < 1:
            img = cv2.resize(img, (int(ww * s), int(h * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return FileResponse(out, media_type="image/jpeg")


# ---------------------------------------------------------------------------- websocket
@app.websocket("/api/runs/{run_id}/events")
async def ws_events(ws: WebSocket, run_id: str, since: int = 0):
    await ws.accept()
    d = M.run_dir(run_id)
    if d is None:
        await ws.close(code=4404)
        return
    path = d / "events.jsonl"
    offset, last_ping = 0, time.time()
    try:
        while True:
            sent_terminal = False
            try:
                with open(path, "rb") as f:
                    f.seek(offset)
                    chunk = f.read()
            except FileNotFoundError:
                chunk = b""
            if chunk:
                end = chunk.rfind(b"\n")
                if end >= 0:
                    offset += end + 1
                    for line in chunk[: end + 1].splitlines():
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if e.get("type") in EventLog.TERMINAL:
                            sent_terminal = True      # close after this read, even if already held
                        if e.get("seq", 0) <= since:
                            continue
                        await ws.send_text(line.decode())
                        since = e["seq"]
            if sent_terminal:
                await ws.close(code=1000)
                return
            if time.time() - last_ping > 15:
                await ws.send_text('{"type":"ping"}')
                last_ping = time.time()
            await asyncio.sleep(0.25)
    except (WebSocketDisconnect, RuntimeError):
        return
