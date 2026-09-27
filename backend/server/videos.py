"""Enumerate the data root and probe videos.

Frame count is the DECODED count (read until the decoder stops), never
CAP_PROP_FRAME_COUNT, which overstates by 3 on some of the project's videos. Decoding is
slow, so counts are computed in the background (smallest file first, only while no run
is active), cached by (size, mtime), and reported as null until known. A run's own
decode (notebook cell 6) also writes its count into the cache.
"""
from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

import cv2

from pipeline import config as C

from .jsonio import read_json, write_json_atomic
from .settings import BACKEND_DIR, CACHE_ROOT

PROBE_CACHE = CACHE_ROOT / "video_probe.json"
LINKED = CACHE_ROOT / "linked_videos.json"      # videos added by path (not copied), e.g. on an external drive
UPLOADS = C.DATA / "uploads"                     # videos uploaded through the UI (copied into the data root)
THUMBS = CACHE_ROOT / "thumbs"
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
_lock = threading.Lock()


def _slug(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in s).strip("_").lower()


def enumerate_videos() -> list[dict]:
    """(id, path, group) for every video under the data root, with stable short ids."""
    out: list[dict] = []
    if C.OWN_VIDEOS_DIR.is_dir():
        for p in sorted(C.OWN_VIDEOS_DIR.iterdir()):
            if p.suffix.lower() in VIDEO_EXTS and not p.name.startswith("."):
                out.append(dict(id=_slug(p.stem), path=p, group="Own videos"))
    if C.MOVINGDRONE_DIR.is_dir():
        for d in sorted(C.MOVINGDRONE_DIR.iterdir()):
            if (d / "video.mp4").exists():
                out.append(dict(id=_slug(d.name), path=d / "video.mp4", group="MovingDrone"))
    wt = C.UMCD_DIR / "Videos_Without_Telemetry" / "Mosaicking"
    if wt.is_dir():
        for p in sorted(wt.rglob("*")):
            if p.suffix.lower() in VIDEO_EXTS:
                out.append(dict(id=_slug(f"{p.parent.name}_{p.stem}"), path=p,
                                group=f"UMCD · {p.parent.name} (no telemetry)"))
    tel = C.UMCD_DIR / "Videos_With_Telemetry"
    if tel.is_dir():
        for p in sorted(tel.rglob("*")):
            if p.suffix.lower() in VIDEO_EXTS:
                rel = p.relative_to(tel).with_suffix("")
                out.append(dict(id=_slug("tel_" + "_".join(rel.parts)), path=p,
                                group=f"UMCD · {rel.parts[0].replace('_', ' ')} (telemetry)"))
    if UPLOADS.is_dir():
        for p in sorted(UPLOADS.iterdir()):
            if p.suffix.lower() in VIDEO_EXTS and not p.name.startswith("."):
                out.append(dict(id=_slug("up_" + p.stem), path=p, group="Uploaded"))
    for e in read_json(LINKED, []) or []:
        p = Path(e["path"])
        out.append(dict(id=_slug("ext_" + p.stem), path=p, group="Linked (not copied)", missing=not p.exists()))
    out = [v for v in out if not v.get("missing")]
    seen: dict[str, int] = {}
    for v in out:                                  # ids must be unique: suffix on collision
        k = v["id"]
        seen[k] = seen.get(k, 0) + 1
        if seen[k] > 1:
            v["id"] = f"{k}_{seen[k]}"
    return out


def _sig(p: Path) -> str:
    st = p.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"


def _container(p: Path) -> dict:
    cap = cv2.VideoCapture(str(p))
    try:
        fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
        codec = "".join(chr((fourcc >> 8 * k) & 0xFF) for k in range(4)).strip("\x00 ") or None
        return dict(width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                    fps=float(cap.get(cv2.CAP_PROP_FPS)) or None,
                    containerFrameCount=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or None, codec=codec)
    finally:
        cap.release()


def _cache() -> dict:
    return read_json(PROBE_CACHE, {}) or {}


def record_decoded_count(video_id: str, path: Path, n: int, source: str) -> None:
    with _lock:
        c = _cache()
        e = c.get(video_id, {})
        if e.get("sig") != _sig(path):
            e = dict(sig=_sig(path), **_container(path))
        e.update(decodedFrameCount=int(n), countSource=source)
        c[video_id] = e
        write_json_atomic(PROBE_CACHE, c)


def probe(v: dict) -> dict:
    """VideoAsset for one enumerated video (contract.ts)."""
    p: Path = v["path"]
    with _lock:
        c = _cache()
        e = c.get(v["id"])
        if not e or e.get("sig") != _sig(p):
            e = dict(sig=_sig(p), **_container(p))
            c[v["id"]] = e
            write_json_atomic(PROBE_CACHE, c)
    n = e.get("decodedFrameCount")
    fps = e.get("fps")
    return dict(
        id=v["id"], group=v["group"],
        probe=dict(filename=p.name, path=str(p), sizeBytes=p.stat().st_size, width=e["width"], height=e["height"],
                   fps=fps, frameCount=n, frameCountSource=e.get("countSource") if n is not None else None,
                   containerFrameCount=e.get("containerFrameCount"),
                   durationMs=int(round(n / fps * 1000)) if (n is not None and fps) else None,
                   codec=e.get("codec")),
        thumbnailUrl=f"/api/videos/{v['id']}/thumbnail.jpg",
        previewUrl=f"/api/videos/{v['id']}/preview",
    )


def count_decoded(path: Path) -> int:
    """Same loop as notebook cell 6 (read until !ok); grab() decodes without the colour convert."""
    cap = cv2.VideoCapture(str(path))
    n = 0
    try:
        while cap.grab():
            n += 1
    finally:
        cap.release()
    return n


def thumbnail(v: dict) -> Path:
    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{v['id']}-{_sig(v['path']).replace(':', '_')}.jpg"
    if not out.exists():
        cap = cv2.VideoCapture(str(v["path"]))
        ok, fr = cap.read()
        cap.release()
        if not ok:
            raise FileNotFoundError(f"could not decode a frame from {v['path']}")
        h, w = fr.shape[:2]
        s = min(1.0, 480 / max(h, w))
        if s < 1:
            fr = cv2.resize(fr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out), fr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return out


class BackgroundCounter(threading.Thread):
    """Counts decoded frames for uncounted videos, one at a time, smallest first, only while
    `idle()` is true. Runs the count in a niced subprocess so the API stays responsive."""

    def __init__(self, idle):
        super().__init__(daemon=True, name="frame-counter")
        self.idle = idle
        self.stop = threading.Event()
        self.current: str | None = None

    def run(self):
        while not self.stop.wait(5.0):
            if not self.idle():
                continue
            c = _cache()
            todo = [v for v in enumerate_videos()
                    if (c.get(v["id"]) or {}).get("decodedFrameCount") is None
                    or (c.get(v["id"]) or {}).get("sig") != _sig(v["path"])]
            if not todo:
                continue
            v = min(todo, key=lambda x: x["path"].stat().st_size)
            self.current = v["id"]
            try:
                r = subprocess.run(["nice", "-n", "15", sys.executable, "-m", "server.videos", str(v["path"])],
                                   cwd=BACKEND_DIR, capture_output=True, text=True, timeout=3600)
                if r.returncode == 0 and r.stdout.strip().isdigit():
                    record_decoded_count(v["id"], v["path"], int(r.stdout.strip()), "decode-count")
            except subprocess.TimeoutExpired:
                pass
            finally:
                self.current = None


if __name__ == "__main__":
    print(count_decoded(Path(sys.argv[1])))


def safe_upload_path(filename: str) -> Path:
    UPLOADS.mkdir(parents=True, exist_ok=True)
    stem, ext = Path(filename).stem, Path(filename).suffix.lower()
    if ext not in VIDEO_EXTS:
        raise ValueError(f"unsupported file type {ext!r}; expected one of {sorted(VIDEO_EXTS)}")
    base = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in stem).strip("._") or "video"
    p = UPLOADS / f"{base}{ext}"
    k = 2
    while p.exists():
        p = UPLOADS / f"{base}_{k}{ext}"
        k += 1
    return p


def check_decodable(p: Path) -> None:
    cap = cv2.VideoCapture(str(p))
    ok, _ = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"OpenCV could not decode a frame from {p}")


def add_link(path: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_file():
        raise ValueError(f"no file at {p}")
    if p.suffix.lower() not in VIDEO_EXTS:
        raise ValueError(f"unsupported file type {p.suffix!r}")
    check_decodable(p)
    with _lock:
        links = read_json(LINKED, []) or []
        if str(p.resolve()) not in {e["path"] for e in links}:
            links.append(dict(path=str(p.resolve())))
            write_json_atomic(LINKED, links)
    return p.resolve()
