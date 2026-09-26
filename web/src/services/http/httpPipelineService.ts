/**
 * Real backend implementation: FastAPI REST + WebSocket.
 *
 * TODO(backend): STUB. The endpoints below are exactly those specified in
 * src/services/contract.ts, but no FastAPI server implements them yet (the
 * demo server in /backend speaks an older, smaller protocol). Once the
 * backend exists, set NEXT_PUBLIC_PIPELINE_BACKEND=http and
 * NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 — no component changes.
 *
 * TODO(backend): confirm CORS allows the Next.js origin (default :3000).
 * TODO(backend): decide whether mosaic/thumbnail URLs are absolute or relative
 *                to API base; this client resolves relative URLs against it.
 */
import type {
  ApiError,
  CreateRunRequest,
  HealthStatus,
  LogLine,
  RunId,
  RunResult,
  RunSnapshot,
  RunSummary,
  VideoAsset,
} from "../contract";
import { ServiceError, type PipelineService, type UploadOptions } from "../pipelineService";
import { connectRunEvents } from "./reconnectingSocket";

export function createHttpPipelineService(baseUrl: string): PipelineService {
  const api = baseUrl.replace(/\/$/, "");
  const wsBase = api.replace(/^http/, "ws");
  const abs = (u: string) => (/^(https?:|blob:|data:)/.test(u) ? u : `${api}${u.startsWith("/") ? "" : "/"}${u}`);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${api}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      });
    } catch (e) {
      throw new ServiceError("network", `Cannot reach backend at ${api}: ${(e as Error).message}`);
    }
    if (res.status === 204) return null as T;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      throw new ServiceError(body?.code ?? `http_${res.status}`, body?.message ?? res.statusText, body?.runId);
    }
    return (await res.json()) as T;
  }

  const videoUrls = (v: VideoAsset): VideoAsset => ({
    ...v,
    thumbnailUrl: v.thumbnailUrl ? abs(v.thumbnailUrl) : null,
    previewUrl: v.previewUrl ? abs(v.previewUrl) : null,
  });

  const withAbsoluteUrls = (snap: RunSnapshot): RunSnapshot =>
    snap.mosaic ? { ...snap, mosaic: { ...snap.mosaic, image: { ...snap.mosaic.image, url: abs(snap.mosaic.image.url) } } } : snap;

  return {
    kind: "http",
    scenarios: [],

    async ping() {
      const t0 = performance.now();
      const h = await request<HealthStatus>("/api/health");
      return { ...h, latencyMs: Math.round(performance.now() - t0) };
    },

    async getAsset(url: string) {
      // TODO(backend): assets must be served with CORS headers for the Next.js origin.
      const res = await fetch(abs(url)).catch((e: Error) => {
        throw new ServiceError("network", `Cannot fetch ${url}: ${e.message}`);
      });
      if (!res.ok) throw new ServiceError(`http_${res.status}`, `Asset request failed (${res.status})`);
      return res.blob();
    },

    getVideo: async (videoId: string) => videoUrls(await request<VideoAsset>(`/api/videos/${encodeURIComponent(videoId)}`)),
    getRunLog: (runId: RunId) => request<LogLine[]>(`/api/runs/${encodeURIComponent(runId)}/log`),
    deleteRun: async (runId: RunId) => {
      await request<null>(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
    },

    uploadVideo(file: File, opts: UploadOptions = {}) {
      // XHR rather than fetch: fetch has no upload-progress events.
      return new Promise<VideoAsset>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${api}/api/videos`);
        xhr.responseType = "json";
        xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(videoUrls(xhr.response as VideoAsset));
          else {
            const body = xhr.response as ApiError | null;
            reject(new ServiceError(body?.code ?? `http_${xhr.status}`, body?.message ?? "Upload failed"));
          }
        };
        xhr.onerror = () => reject(new ServiceError("network", `Upload to ${api} failed`));
        opts.signal?.addEventListener("abort", () => {
          xhr.abort();
          reject(new DOMException("Aborted", "AbortError"));
        });
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
    },

    createRun(req: CreateRunRequest) {
      const { mockScenario: _ignored, ...body } = req;
      void _ignored;
      return request<RunSummary>("/api/runs", { method: "POST", body: JSON.stringify(body) });
    },

    listRuns: () => request<RunSummary[]>("/api/runs"),
    getActiveRun: () => request<RunSummary | null>("/api/runs/active"),
    getRun: async (runId: RunId) => withAbsoluteUrls(await request<RunSnapshot>(`/api/runs/${encodeURIComponent(runId)}`)),

    async getRunResult(runId: RunId) {
      const r = await request<RunResult>(`/api/runs/${encodeURIComponent(runId)}/result`);
      return {
        ...r,
        mosaic: {
          ...r.mosaic,
          url: abs(r.mosaic.url),
          downloadUrl: abs(r.mosaic.downloadUrl),
          preview: { ...r.mosaic.preview, url: abs(r.mosaic.preview.url) },
        },
        frames: r.frames.map((f) => ({ ...f, thumbnailUrl: abs(f.thumbnailUrl) })),
      };
    },

    cancelRun: (runId: RunId) =>
      request<RunSummary>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),

    subscribe(runId, handlers) {
      return connectRunEvents(
        (since) => `${wsBase}/api/runs/${encodeURIComponent(runId)}/events?since=${since}`,
        {
          onConnection: handlers.onConnection,
          onEvent: (ev) => {
            if (ev.type === "run.snapshot") handlers.onEvent({ ...ev, snapshot: withAbsoluteUrls(ev.snapshot) });
            else if (ev.type === "mosaic.update")
              handlers.onEvent({ ...ev, mosaic: { ...ev.mosaic, image: { ...ev.mosaic.image, url: abs(ev.mosaic.image.url) } } });
            else handlers.onEvent(ev);
          },
        },
      );
    },
  };
}
