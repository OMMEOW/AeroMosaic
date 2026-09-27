"""Durable JSON I/O for the run directory.

- write_json_atomic: temp file in the same directory + fsync + os.replace.
- append_jsonl: append-and-flush (fsync) so a crashed run is still inspectable.
- EventLog: sequenced append to events.jsonl, safe with two writers (worker + server)
  through an exclusive flock held while the last seq is read and the next line written.
- clean(): NaN/inf -> None. Unmeasured is null, never 0, and never invalid JSON.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import fcntl
import json
import math
import os
from pathlib import Path
from typing import Any, Iterable, Iterator

import numpy as np


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if math.isfinite(f) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    if isinstance(obj, Path):
        return str(obj)
    return obj


def dumps(obj: Any, **kw) -> str:
    return json.dumps(clean(obj), allow_nan=False, separators=(",", ":"), **kw)


def write_json_atomic(path: Path, obj: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(tmp, "w") as f:
        f.write(json.dumps(clean(obj), allow_nan=False, indent=1))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def append_jsonl(path: Path, objs: Iterable[Any]) -> None:
    lines = "".join(dumps(o) + "\n" for o in objs)
    if not lines:
        return
    with open(path, "a") as f:
        f.write(lines)
        f.flush()
        os.fsync(f.fileno())


def iter_jsonl(path: Path) -> Iterator[dict]:
    """Complete lines only; a torn final line (crash mid-write) is skipped."""
    try:
        with open(path) as f:
            for line in f:
                if not line.endswith("\n"):
                    break
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        return


@contextlib.contextmanager
def locked(path: Path):
    """Exclusive advisory lock on <path>.lock (manifest read-modify-write, event appends)."""
    lp = Path(str(path) + ".lock")
    with open(lp, "a") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def update_json(path: Path, **fields) -> dict:
    """Locked read-modify-write of a JSON object file (manifest.json)."""
    with locked(path):
        obj = read_json(path, {}) or {}
        obj.update(fields)
        write_json_atomic(path, obj)
        return obj


class EventLog:
    """events.jsonl writer. seq is strictly increasing from 1 with no gaps."""

    TERMINAL = ("run.completed", "run.failed", "run.cancelled", "run.interrupted")

    def __init__(self, run_dir: Path, run_id: str):
        self.path = Path(run_dir) / "events.jsonl"
        self.run_id = run_id

    def _last_seq_and_repair(self) -> int:
        try:
            size = self.path.stat().st_size
        except FileNotFoundError:
            return 0
        if size == 0:
            return 0
        with open(self.path, "rb+") as f:
            f.seek(size - 1)
            if f.read(1) != b"\n":                # torn write from a killed process: drop it
                f.seek(0)
                data = f.read()
                cut = data.rfind(b"\n")
                f.truncate(cut + 1 if cut >= 0 else 0)
                size = cut + 1 if cut >= 0 else 0
            window = 1 << 16
            while size:
                start = max(0, size - window)
                f.seek(start)
                lines = f.read(size - start).splitlines()
                # the first line is only whole if the window reached the start of the file
                for line in reversed(lines if start == 0 else lines[1:]):
                    try:
                        return int(json.loads(line)["seq"])
                    except (ValueError, KeyError, json.JSONDecodeError):
                        continue
                if start == 0:
                    break
                window *= 8
        return 0

    def emit_many(self, items: list[tuple[str, dict]]) -> list[dict]:
        if not items:
            return []
        with locked(self.path):
            seq = self._last_seq_and_repair()
            evs = []
            for typ, payload in items:
                seq += 1
                evs.append({"runId": self.run_id, "seq": seq, "ts": now_iso(), "type": typ, **payload})
            append_jsonl(self.path, evs)
        return evs

    def emit(self, typ: str, **payload) -> dict:
        return self.emit_many([(typ, payload)])[0]

    def has_terminal(self) -> bool:
        return any(e.get("type") in self.TERMINAL for e in iter_jsonl(self.path))
