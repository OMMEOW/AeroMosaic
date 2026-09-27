import type {
  ArtifactList,
  CreateRunRequest,
  HealthStatus,
  PairRecord,
  PipelineEvent,
  RunId,
  RunSummary,
  VideoAsset,
} from "./contract";

/**
 * Transport-level connection state of an event subscription (shown in the connection
 * indicator); independent of run status.
 */
export type ConnectionState =
  | { status: "connecting"; attempt: number }
  | { status: "open" }
  /** Dropped unexpectedly; a retry is scheduled at `retryAt` (epoch ms). */
  | { status: "reconnecting"; attempt: number; retryAt: number; lastError: string | null }
  /** Closed for good: run reached a terminal state, run unknown, or unsubscribed. */
  | { status: "closed"; reason: "terminal" | "not_found" | "unsubscribed" | "gave_up" };

export interface SubscribeHandlers {
  onEvent: (event: PipelineEvent) => void;
  onConnection: (state: ConnectionState) => void;
}

/** Thrown by service methods; `code` mirrors ApiError.code where applicable. */
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public runId?: RunId,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** The only way the UI talks to the backend. */
export interface PipelineService {
  readonly baseUrl: string;
  /** Resolves with latency; rejects with ServiceError("network") when unreachable. */
  health(): Promise<HealthStatus & { latencyMs: number }>;
  listVideos(): Promise<VideoAsset[]>;
  getVideo(videoId: string): Promise<VideoAsset>;
  countVideoFrames(videoId: string): Promise<VideoAsset>;
  /** Copies a local file into the data root (uploads/). */
  uploadVideo(file: File, onProgress?: (fraction: number) => void): Promise<VideoAsset>;
  /** Registers a video by absolute path on the backend machine, without copying it. */
  linkVideo(path: string): Promise<VideoAsset>;
  createRun(req: CreateRunRequest): Promise<RunSummary>;
  listRuns(): Promise<RunSummary[]>;
  getActiveRun(): Promise<RunSummary | null>;
  getRun(runId: RunId): Promise<RunSummary>;
  /** REST replay of events.jsonl — the same events the WebSocket delivers. */
  getEvents(runId: RunId, since?: number): Promise<PipelineEvent[]>;
  getSteps(runId: RunId, stage?: 1 | 2): Promise<PairRecord[]>;
  getRunLog(runId: RunId): Promise<string>;
  listArtifacts(runId: RunId): Promise<ArtifactList>;
  cancelRun(runId: RunId): Promise<RunSummary>;
  deleteRun(runId: RunId): Promise<void>;
  /** Absolute URL for a server path such as a mosaic or artifact. */
  url(path: string): string;
  getAsset(url: string): Promise<Blob>;
  /** Live events: replay from `since` then tail. Reconnects internally; returns unsubscribe. */
  subscribe(runId: RunId, handlers: SubscribeHandlers): () => void;
}
