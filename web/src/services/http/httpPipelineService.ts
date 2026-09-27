/** FastAPI REST + WebSocket client for backend/server (see contract.ts). */
import type { ApiError, ArtifactList, CreateRunRequest, HealthStatus, PairRecord, PipelineEvent, RunId, RunSummary, VideoAsset } from "../contract";
import { ServiceError, type PipelineService } from "../pipelineService";
import { connectRunEvents } from "./reconnectingSocket";

export function createHttpPipelineService(baseUrl: string): PipelineService {
  const api = baseUrl.replace(/\/$/, "");
  const wsBase = api.replace(/^http/, "ws");
  const abs = (u: string) => (/^(https?:|blob:|data:)/.test(u) ? u : `${api}${u.startsWith("/") ? "" : "/"}${u}`);
  const rid = (id: RunId) => encodeURIComponent(id);

  async function raw(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${api}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      });
    } catch (e) {
      throw new ServiceError("network", `Cannot reach the backend at ${api} (${(e as Error).message})`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      throw new ServiceError(body?.code ?? `http_${res.status}`, body?.message ?? `${res.status} ${res.statusText}`, body?.runId);
    }
    return res;
  }
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await raw(path, init);
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }
  const video = (v: VideoAsset): VideoAsset => ({ ...v, thumbnailUrl: abs(v.thumbnailUrl), previewUrl: abs(v.previewUrl) });

  return {
    baseUrl: api,
    url: abs,
    async health() {
      const t0 = performance.now();
      const h = await request<HealthStatus>("/api/health");
      return { ...h, latencyMs: Math.round(performance.now() - t0) };
    },
    listVideos: async () => (await request<VideoAsset[]>("/api/videos")).map(video),
    getVideo: async (id) => video(await request<VideoAsset>(`/api/videos/${encodeURIComponent(id)}`)),
    countVideoFrames: async (id) => video(await request<VideoAsset>(`/api/videos/${encodeURIComponent(id)}/count`, { method: "POST" })),
    linkVideo: async (path) => video(await request<VideoAsset>("/api/videos/link", { method: "POST", body: JSON.stringify({ path }) })),
    uploadVideo(file, onProgress) {
      // XHR rather than fetch: fetch has no upload-progress events.
      return new Promise<VideoAsset>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${api}/api/videos`);
        xhr.responseType = "json";
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(video(xhr.response as VideoAsset));
          else {
            const body = xhr.response as ApiError | null;
            reject(new ServiceError(body?.code ?? `http_${xhr.status}`, body?.message ?? `Upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new ServiceError("network", `Upload to ${api} failed`));
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
    },
    createRun: (req: CreateRunRequest) => request<RunSummary>("/api/runs", { method: "POST", body: JSON.stringify(req) }),
    listRuns: () => request<RunSummary[]>("/api/runs"),
    getActiveRun: () => request<RunSummary | null>("/api/runs/active"),
    getRun: (id) => request<RunSummary>(`/api/runs/${rid(id)}`),
    getEvents: (id, since = 0) => request<PipelineEvent[]>(`/api/runs/${rid(id)}/events?since=${since}`),
    getSteps: (id, stage) => request<PairRecord[]>(`/api/runs/${rid(id)}/steps${stage ? `?stage=${stage}` : ""}`),
    getRunLog: async (id) => (await raw(`/api/runs/${rid(id)}/log`, { headers: { Accept: "text/plain" } })).text(),
    listArtifacts: (id) => request<ArtifactList>(`/api/runs/${rid(id)}/artifacts`),
    cancelRun: (id) => request<RunSummary>(`/api/runs/${rid(id)}/cancel`, { method: "POST" }),
    deleteRun: async (id) => {
      await request<null>(`/api/runs/${rid(id)}`, { method: "DELETE" });
    },
    async getAsset(url: string) {
      const res = await fetch(abs(url)).catch((e: Error) => {
        throw new ServiceError("network", `Cannot fetch ${url}: ${e.message}`);
      });
      if (!res.ok) throw new ServiceError(`http_${res.status}`, `Request for ${url} failed (${res.status})`);
      return res.blob();
    },
    subscribe(runId, handlers) {
      return connectRunEvents((since) => `${wsBase}/api/runs/${rid(runId)}/events?since=${since}`, handlers);
    },
  };
}
