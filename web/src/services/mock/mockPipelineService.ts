/**
 * Mock implementation of PipelineService. Runs entirely in the browser.
 *
 *  - Deterministic: each run is a pure function of its stored record, so a
 *    run in progress survives a page refresh and resumes at the right point.
 *  - Streams the exact PipelineEvent protocol from contract.ts, including a
 *    snapshot-first handshake on every (re)connect.
 *  - Scenarios: success, GPU OOM during MATCH, corrupt stream during DECODE.
 *  - Dev hook: `window.__uavMock.dropConnection()` simulates a socket drop so
 *    the reconnect UI can be exercised.
 */
import { applyEvent, emptySnapshot } from "@/lib/runReducer";
import {
  isTerminal,
  type CreateRunRequest,
  type LogLine,
  type MosaicPreview,
  type PipelineEvent,
  type RunId,
  type RunResult,
  type RunSnapshot,
  type RunSummary,
  type VideoAsset,
  type VideoProbe,
} from "../contract";
import {
  ServiceError,
  type ConnectionState,
  type PipelineService,
  type SubscribeHandlers,
  type UploadOptions,
} from "../pipelineService";
import { renderMosaic, renderThumbnail } from "./render";
import { deleteRunRecord, loadRuns, loadVideo, newId, saveRun, saveVideo } from "./store";
import { buildTimeline, forgetTimeline, type MockRunRecord, type TimelineItem } from "./timeline";

const PREVIEW_WIDTH = 1600;
const MOCK_SPEED = Number(process.env.NEXT_PUBLIC_MOCK_SPEED ?? "1") || 1;

const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function baseSummary(rec: MockRunRecord): RunSummary {
  return {
    id: rec.id,
    videoId: rec.videoId,
    status: "queued",
    createdAt: iso(rec.createdAt),
    startedAt: null,
    finishedAt: null,
    video: rec.video,
    params: rec.params,
    metrics: null,
    error: null,
  };
}

function toWire(rec: MockRunRecord, item: TimelineItem, seq: number, mosaic?: MosaicPreview): PipelineEvent | null {
  const envelope = { runId: rec.id, seq, ts: iso(rec.createdAt + item.at) };
  if (item.body.type === "mosaic.render") {
    return mosaic ? { ...envelope, type: "mosaic.update", mosaic } : null;
  }
  return { ...envelope, ...item.body } as PipelineEvent;
}

/** Fold items[0..count) into a snapshot (mosaic left for the caller to render). */
function fold(rec: MockRunRecord, items: TimelineItem[], count: number): RunSnapshot {
  let snap = emptySnapshot(baseSummary(rec));
  for (let i = 0; i < count; i++) {
    const ev = toWire(rec, items[i], i + 1);
    if (ev) snap = applyEvent(snap, ev);
  }
  return { ...snap, seq: count };
}

function positionAt(items: TimelineItem[], offset: number) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].at <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function mosaicFor(rec: MockRunRecord, item: TimelineItem): Promise<MosaicPreview | undefined> {
  if (item.body.type !== "mosaic.render") return undefined;
  const { sim } = buildTimeline(rec);
  const img = await renderMosaic(rec.id, sim, item.body.frames, PREVIEW_WIDTH);
  return {
    version: item.body.version,
    framesComposited: item.body.frames.length,
    image: { url: img.url, width: img.width, height: img.height },
    latestFootprint: item.body.final ? null : img.latestFootprint,
  };
}

// Keep the last few preview URLs alive; revoke older ones.
const livePreviewUrls: string[] = [];
function trackPreviewUrl(url: string) {
  if (livePreviewUrls.includes(url)) return;
  livePreviewUrls.push(url);
  while (livePreviewUrls.length > 6) URL.revokeObjectURL(livePreviewUrls.shift()!);
}

class MockSubscription {
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private epoch = 0;

  constructor(
    private runId: RunId,
    private handlers: SubscribeHandlers,
  ) {}

  private record() {
    return loadRuns().find((r) => r.id === this.runId) ?? null;
  }

  private setConn(s: ConnectionState) {
    if (!this.closed || s.status === "closed") this.handlers.onConnection(s);
  }

  start(attempt = 1) {
    const epoch = ++this.epoch;
    this.setConn({ status: "connecting", attempt });
    setTimeout(() => void this.open(epoch), 160);
  }

  private async open(epoch: number) {
    if (this.closed || epoch !== this.epoch) return;
    const rec = this.record();
    if (!rec) {
      this.closed = true;
      this.handlers.onConnection({ status: "closed", reason: "not_found" });
      return;
    }
    this.setConn({ status: "open" });
    const { items } = buildTimeline(rec);
    const pos = positionAt(items, Date.now() - rec.createdAt);
    const snap = fold(rec, items, pos);
    const lastMosaic = [...items.slice(0, pos)].reverse().find((it) => it.body.type === "mosaic.render");
    if (lastMosaic) {
      const m = await mosaicFor(rec, lastMosaic);
      if (m) {
        trackPreviewUrl(m.image.url);
        snap.mosaic = m;
      }
    }
    if (this.closed || epoch !== this.epoch) return;
    this.cursor = pos;
    this.handlers.onEvent({ type: "run.snapshot", runId: rec.id, seq: pos, ts: iso(Date.now()), snapshot: snap });
    this.scheduleNext(epoch);
  }

  /** Re-read the record (e.g. after a cancel request) and continue from the cursor. */
  reschedule() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.scheduleNext(this.epoch);
  }

  private scheduleNext(epoch: number) {
    if (this.closed || epoch !== this.epoch) return;
    const rec = this.record();
    if (!rec) return;
    const { items } = buildTimeline(rec);
    if (this.cursor >= items.length) {
      this.closed = true;
      this.handlers.onConnection({ status: "closed", reason: "terminal" });
      return;
    }
    const wait = Math.max(0, rec.createdAt + items[this.cursor].at - Date.now());
    this.timer = setTimeout(() => void this.deliver(epoch), wait);
  }

  private async deliver(epoch: number) {
    const rec = this.record();
    if (!rec || this.closed || epoch !== this.epoch) return;
    const { items } = buildTimeline(rec);
    const due = positionAt(items, Date.now() - rec.createdAt);
    // Render only the newest preview in this batch; earlier ones in the batch reuse it.
    let lastMosaicIdx = -1;
    for (let i = this.cursor; i < due; i++) if (items[i].body.type === "mosaic.render") lastMosaicIdx = i;
    const rendered = lastMosaicIdx >= 0 ? await mosaicFor(rec, items[lastMosaicIdx]) : undefined;
    if (rendered) trackPreviewUrl(rendered.image.url);
    if (this.closed || epoch !== this.epoch) return;
    for (let i = this.cursor; i < due; i++) {
      const it = items[i];
      let mosaic: MosaicPreview | undefined;
      if (it.body.type === "mosaic.render" && rendered) {
        mosaic = { ...rendered, version: it.body.version, framesComposited: it.body.frames.length };
      }
      const ev = toWire(rec, it, i + 1, mosaic);
      if (ev) this.handlers.onEvent(ev);
    }
    this.cursor = Math.max(this.cursor, due);
    this.scheduleNext(epoch);
  }

  drop() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.epoch++;
    const retryIn = 1200;
    this.setConn({ status: "reconnecting", attempt: 1, retryAt: Date.now() + retryIn, lastError: "socket closed (1006)" });
    setTimeout(() => !this.closed && this.start(2), retryIn);
  }

  close() {
    this.closed = true;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.handlers.onConnection({ status: "closed", reason: "unsubscribed" });
  }
}

const subscriptions = new Set<MockSubscription>();

function summaryOf(rec: MockRunRecord): RunSummary {
  const { items } = buildTimeline(rec);
  return fold(rec, items, positionAt(items, Date.now() - rec.createdAt)).run;
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120];

/**
 * Browser stand-in for ffprobe. Width/height/duration come from the element;
 * frame rate is measured by playing a few frames with requestVideoFrameCallback
 * and snapping to the nearest standard rate (59.94 if frame timing can't be
 * measured). Files the browser can't decode are rejected rather than given
 * invented properties. The real backend uses ffprobe.
 * Also captures the first decoded frame as a JPEG thumbnail (the backend's
 * thumbnail.jpg), or null if the browser cannot decode the codec.
 */
async function probeInBrowser(file: File): Promise<{ probe: VideoProbe; thumbnail: string | null }> {
  const fallback = { width: 0, height: 0, durationMs: 0, fps: 59.94 }; // "unreadable" sentinel
  let meta = fallback;
  let thumbnail: string | null = null;
  if (typeof document !== "undefined" && file.size > 0) {
    const url = URL.createObjectURL(file);
    try {
      meta = await new Promise((resolve) => {
        const v = document.createElement("video");
        let settled = false;
        const done = (m: typeof fallback) => {
          if (settled) return;
          settled = true;
          v.pause();
          v.removeAttribute("src");
          v.load();
          resolve(m);
        };
        const t = setTimeout(() => done(fallback), 5000);
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        let base: Omit<typeof fallback, "fps"> | null = null;
        v.onloadedmetadata = () => {
          const ok = v.videoWidth > 0 && Number.isFinite(v.duration) && v.duration > 0;
          if (!ok) return (clearTimeout(t), done(fallback));
          base = { width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(v.duration * 1000) };
        };
        // First frame is decoded and displayable: grab it, then measure fps by playing.
        v.onloadeddata = () => {
          if (!base) return;
          const b = base;
          try {
            const c = document.createElement("canvas");
            c.width = 480;
            c.height = Math.round((480 * v.videoHeight) / v.videoWidth);
            c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
            thumbnail = c.toDataURL("image/jpeg", 0.82);
          } catch {
            thumbnail = null;
          }
          const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number })
            .requestVideoFrameCallback;
          if (!rvfc) return (clearTimeout(t), done({ ...b, fps: fallback.fps }));
          const times: number[] = [];
          const onFrame = (_: number, m: { mediaTime: number }) => {
            times.push(m.mediaTime);
            if (times.length < 12) rvfc.call(v, onFrame);
            else {
              clearTimeout(t);
              const deltas = times.slice(1).map((x, i) => x - times[i]).filter((d) => d > 0).sort((a, b) => a - b);
              const median = deltas[Math.floor(deltas.length / 2)];
              const raw = median ? 1 / median : fallback.fps;
              const fps = COMMON_FPS.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
              done({ ...b, fps });
            }
          };
          rvfc.call(v, onFrame);
          v.play().catch(() => (clearTimeout(t), done({ ...b, fps: fallback.fps })));
        };
        v.onerror = () => {
          clearTimeout(t);
          done(fallback);
        };
        v.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!meta.width || !meta.durationMs) {
    // Never invent properties: a real backend's ffprobe would reject an unreadable file too.
    throw new ServiceError(
      "probe_failed",
      `Couldn't read ${file.name}: this browser can't decode it, and the mock backend probes videos in the browser. A real backend reads it with ffprobe.`,
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return {
    probe: {
      filename: file.name,
      sizeBytes: file.size,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      durationMs: meta.durationMs,
      frameCount: Math.max(2, Math.round((meta.durationMs / 1000) * meta.fps)),
      codec: ext === "mov" ? "hevc" : "h264",
    },
    thumbnail,
  };
}

/**
 * The mock keeps uploaded File objects in memory as the "preview proxy":
 * playable for this browser session only (a real backend serves preview.mp4).
 */
const previewFiles = new Map<string, string>();

/** Seeded demo videos have no real file: render frame 0 of the simulated flight as their thumbnail. */
const demoThumbs = new Map<string, Promise<string | null>>();
function demoThumbnail(videoId: string): Promise<string | null> {
  const hit = demoThumbs.get(videoId);
  if (hit) return hit;
  const rec = loadRuns().find((r) => r.videoId === videoId);
  const p = rec ? renderThumbnail(buildTimeline(rec).sim, 0, 480) : Promise.resolve(null);
  demoThumbs.set(videoId, p);
  return p;
}

async function withMedia(asset: VideoAsset): Promise<VideoAsset> {
  return {
    ...asset,
    thumbnailUrl: asset.thumbnailUrl ?? (await demoThumbnail(asset.id)),
    previewUrl: previewFiles.get(asset.id) ?? null,
  };
}

export function createMockPipelineService(): PipelineService {
  if (typeof window !== "undefined") {
    (window as unknown as { __uavMock: unknown }).__uavMock = {
      dropConnection: () => subscriptions.forEach((s) => s.drop()),
    };
  }

  const service: PipelineService = {
    kind: "mock",
    scenarios: [
      { id: "success", label: "Success" },
      { id: "diverged", label: "Completes, drift diverges" },
      { id: "truncated", label: "Completes, chain lost early" },
      { id: "ref-breaks", label: "Completes, reference chain breaks" },
      { id: "fail-match", label: "Fails · GPU OOM in MATCH" },
      { id: "fail-decode", label: "Fails · corrupt stream in DECODE" },
    ],

    async ping() {
      const t0 = performance.now();
      await sleep(8 + Math.random() * 12);
      return { ok: true, backend: "in-browser mock", version: "mock-2", latencyMs: Math.round(performance.now() - t0) };
    },

    async getVideo(videoId: string) {
      const v = loadVideo(videoId);
      if (!v) throw new ServiceError("video_not_found", `Video ${videoId} not found; upload it again.`);
      return withMedia(v);
    },

    async getRunLog(runId: RunId): Promise<LogLine[]> {
      const rec = loadRuns().find((r) => r.id === runId);
      if (!rec) throw new ServiceError("not_found", `Run ${runId} not found.`);
      const { items } = buildTimeline(rec);
      const pos = positionAt(items, Date.now() - rec.createdAt);
      const out: LogLine[] = [];
      for (let i = 0; i < pos; i++) {
        const b = items[i].body;
        if (b.type === "log") out.push({ seq: i + 1, ts: iso(rec.createdAt + items[i].at), level: b.level, stage: b.stage, message: b.message });
      }
      return out;
    },

    async getAsset(url: string) {
      const res = await fetch(url);
      if (!res.ok) throw new ServiceError("asset_unavailable", `Asset not available (${res.status}).`);
      return res.blob();
    },

    async deleteRun(runId: RunId) {
      const rec = loadRuns().find((r) => r.id === runId);
      if (!rec) throw new ServiceError("not_found", `Run ${runId} not found.`);
      if (!isTerminal(summaryOf(rec).status)) throw new ServiceError("run_active", "Cancel the run before deleting it.", runId);
      deleteRunRecord(runId);
      forgetTimeline(runId);
    },

    async uploadVideo(file: File, opts: UploadOptions = {}): Promise<VideoAsset> {
      const probePromise = probeInBrowser(file);
      probePromise.catch(() => {}); // surfaced below, after the simulated transfer
      const steps = 12;
      for (let k = 1; k <= steps; k++) {
        await sleep(70, opts.signal);
        opts.onProgress?.(k / steps);
      }
      const { probe, thumbnail } = await probePromise;
      const asset: VideoAsset = { id: newId("v"), probe, uploadedAt: iso(Date.now()), thumbnailUrl: thumbnail, previewUrl: null };
      // Persist without the session-only preview URL.
      saveVideo(asset);
      if (file.size > 0) previewFiles.set(asset.id, URL.createObjectURL(file));
      return withMedia(asset);
    },

    async createRun(req: CreateRunRequest): Promise<RunSummary> {
      const active = await service.getActiveRun();
      if (active) throw new ServiceError("run_active", "Another run is still in progress.", active.id);
      const video = loadVideo(req.videoId);
      if (!video) throw new ServiceError("video_not_found", "Uploaded video not found; upload it again.");
      const seedBytes = new Uint32Array(1);
      crypto.getRandomValues(seedBytes);
      const rec: MockRunRecord = {
        id: newId("r"),
        videoId: video.id,
        seed: seedBytes[0] % 1_000_000,
        createdAt: Date.now(),
        video: video.probe,
        params: req.params,
        scenario: req.mockScenario ?? "success",
        speed: MOCK_SPEED,
      };
      saveRun(rec);
      return summaryOf(rec);
    },

    async listRuns() {
      return loadRuns()
        .map(summaryOf)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async getActiveRun() {
      const runs = await service.listRuns();
      return runs.find((r) => !isTerminal(r.status)) ?? null;
    },

    async getRun(runId) {
      const rec = loadRuns().find((r) => r.id === runId);
      if (!rec) throw new ServiceError("not_found", `Run ${runId} not found.`);
      const { items } = buildTimeline(rec);
      const pos = positionAt(items, Date.now() - rec.createdAt);
      const snap = fold(rec, items, pos);
      const lastMosaic = [...items.slice(0, pos)].reverse().find((it) => it.body.type === "mosaic.render");
      if (lastMosaic) snap.mosaic = (await mosaicFor(rec, lastMosaic)) ?? null;
      return snap;
    },

    async getRunResult(runId): Promise<RunResult> {
      const rec = loadRuns().find((r) => r.id === runId);
      if (!rec) throw new ServiceError("not_found", `Run ${runId} not found.`);
      const { sim, items } = buildTimeline(rec);
      const snap = fold(rec, items, positionAt(items, Date.now() - rec.createdAt));
      const summary = snap.run;
      if (summary.status !== "succeeded" || !summary.metrics || !snap.selection) {
        throw new ServiceError("not_ready", `Run ${runId} has no result (status: ${summary.status}).`);
      }
      const [full, preview] = await Promise.all([
        renderMosaic(`${rec.id}/full`, sim, sim.usedFrames, Number.MAX_SAFE_INTEGER),
        renderMosaic(`${rec.id}/preview`, sim, sim.usedFrames, PREVIEW_WIDTH),
      ]);
      const usedSet = new Set(sim.usedFrames);
      const frames = await Promise.all(
        sim.selected.map(async (f, i) => {
          const edge = sim.edgeInto.get(f);
          return {
            frameIndex: f,
            timestampMs: Math.round((f / rec.video.fps) * 1000),
            gapFromPrev: i === 0 ? 0 : f - sim.selected[i - 1],
            fmScore: edge?.fm ?? null,
            forced: edge?.forced ?? false,
            used: usedSet.has(f),
            thumbnailUrl: await renderThumbnail(sim, f),
          };
        }),
      );
      const workW = Math.min(rec.video.width, rec.params.maxWorkingResolution);
      const samples = 160;
      const motionProfile = Array.from({ length: samples }, (_, k) => {
        const frame = Math.round((k / (samples - 1)) * (rec.video.frameCount - 1));
        return { frame, pxPerFrame: Math.round(sim.motionAt(frame) * (workW / sim.footprintA) * 100) / 100 };
      });
      return {
        runId,
        run: summary,
        metrics: summary.metrics,
        stages: snap.stages,
        mosaic: {
          url: full.url,
          width: full.width,
          height: full.height,
          downloadUrl: full.url,
          downloadName: `${rec.id}_mosaic.png`,
          preview: { url: preview.url, width: preview.width, height: preview.height },
        },
        frames,
        steps: snap.steps,
        selection: snap.selection,
        motionProfile,
      };
    },

    async cancelRun(runId) {
      const rec = loadRuns().find((r) => r.id === runId);
      if (!rec) throw new ServiceError("not_found", `Run ${runId} not found.`);
      const current = summaryOf(rec);
      if (isTerminal(current.status)) throw new ServiceError("run_terminal", `Run is already ${current.status}.`);
      if (rec.cancelRequestedAt === undefined) {
        rec.cancelRequestedAt = Date.now();
        saveRun(rec);
      }
      subscriptions.forEach((s) => s.reschedule());
      return { ...current, status: "cancelling" };
    },

    subscribe(runId, handlers) {
      const sub = new MockSubscription(runId, handlers);
      subscriptions.add(sub);
      sub.start();
      return () => {
        subscriptions.delete(sub);
        sub.close();
      };
    },
  };
  return service;
}
