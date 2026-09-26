import type {
  CreateRunRequest,
  HealthStatus,
  LogLine,
  MockScenario,
  PipelineEvent,
  RunId,
  RunResult,
  RunSnapshot,
  RunSummary,
  VideoAsset,
} from "./contract";

/**
 * Transport-level connection state of an event subscription. This is what the
 * UI shows in the connection indicator; it is independent of run status.
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

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
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

/**
 * The only way the UI talks to the backend. Two implementations:
 *   - mock  (src/services/mock)  — deterministic in-browser simulation
 *   - http  (src/services/http)  — FastAPI REST + WebSocket
 * Selected in src/services/index.ts by NEXT_PUBLIC_PIPELINE_BACKEND.
 */
export interface PipelineService {
  readonly kind: "mock" | "http";
  /** Mock-only scenarios offered in the UI; empty for real backends. */
  readonly scenarios: readonly { id: MockScenario; label: string }[];

  /** Health check; resolves with latency, rejects with ServiceError when unreachable. */
  ping(): Promise<HealthStatus & { latencyMs: number }>;
  uploadVideo(file: File, opts?: UploadOptions): Promise<VideoAsset>;
  getVideo(videoId: string): Promise<VideoAsset>;
  createRun(req: CreateRunRequest): Promise<RunSummary>;
  listRuns(): Promise<RunSummary[]>;
  getActiveRun(): Promise<RunSummary | null>;
  getRun(runId: RunId): Promise<RunSnapshot>;
  getRunResult(runId: RunId): Promise<RunResult>;
  getRunLog(runId: RunId): Promise<LogLine[]>;
  cancelRun(runId: RunId): Promise<RunSummary>;
  deleteRun(runId: RunId): Promise<void>;
  /** Fetch a binary asset referenced by a URL this service returned (mosaic, thumbnail). */
  getAsset(url: string): Promise<Blob>;

  /**
   * Stream events for a run. The first event delivered after every (re)connect
   * is `run.snapshot`. Reconnection is handled inside; the returned function
   * unsubscribes and closes the connection.
   */
  subscribe(runId: RunId, handlers: SubscribeHandlers): () => void;
}
