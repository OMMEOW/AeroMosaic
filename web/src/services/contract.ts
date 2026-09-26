/**
 * UAV mosaicking pipeline — frontend ⇄ backend contract.
 *
 * THIS FILE IS THE SPEC the FastAPI backend implements. Every payload that
 * crosses the wire is typed here; nothing else in the frontend defines wire
 * shapes. Field names are camelCase on the wire (configure pydantic with
 * `alias_generator=to_camel, populate_by_name=True`).
 *
 * Conventions
 *  - Timestamps: ISO-8601 strings in UTC (`"2026-09-26T10:14:03.221Z"`).
 *  - Durations: integer milliseconds, suffixed `Ms`.
 *  - Frame indices: 0-based indices into the *native* decoded frame sequence.
 *  - Ratios: 0..1 floats. Percentages are never sent; the UI formats them.
 *  - IDs: opaque strings. The UI never parses them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REST
 *
 *   GET  /api/health                                       → HealthStatus
 *   POST /api/videos                 multipart `file`      → VideoAsset
 *        Upload + ffprobe. Must return once the file is stored and probed.
 *   GET  /api/videos/{videoId}                             → VideoAsset (re-use an upload for a retry)
 *   GET  /api/videos/{videoId}/thumbnail.jpg               first decoded frame (VideoAsset.thumbnailUrl)
 *   GET  /api/videos/{videoId}/preview.mp4                 browser-playable proxy, e.g. ≤720p H.264 (VideoAsset.previewUrl)
 *   POST /api/runs                   CreateRunRequest      → RunSummary
 *        409 { code: "run_active", runId } if a run is already non-terminal
 *        (one run at a time).
 *   GET  /api/runs                                         → RunSummary[]  (newest first)
 *   GET  /api/runs/active                                  → RunSummary | 204
 *        Used after a page refresh to re-attach to a run that outlived it.
 *   GET  /api/runs/{runId}                                 → RunSnapshot
 *   GET  /api/runs/{runId}/result                          → RunResult     (404 until succeeded)
 *   GET  /api/runs/{runId}/log                             → LogLine[]     (complete, uncapped)
 *   POST /api/runs/{runId}/cancel                          → 202 RunSummary (status "cancelling")
 *        Idempotent. Cancelling a terminal run returns 409.
 *   DELETE /api/runs/{runId}                               → 204
 *        409 { code: "run_active" } while the run is non-terminal.
 *   GET  /api/runs/{runId}/mosaic.png                      full-resolution mosaic (PNG)
 *   GET  /api/runs/{runId}/mosaic_preview.png              downscaled preview (long edge ≤ 1600 px)
 *   GET  /api/runs/{runId}/frames/{frameIndex}.jpg         selected-frame thumbnail
 *
 *   Errors: non-2xx responses carry `ApiError` as JSON.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WEBSOCKET   /api/runs/{runId}/events?since={seq}
 *
 *   Server → client only. Each message is one JSON `PipelineEvent`.
 *
 *   1. On every (re)connect the server FIRST sends `run.snapshot` containing
 *      the complete materialised state and the latest `seq`. `since` is a hint:
 *      the server may replay events after `since` instead, but a snapshot is
 *      always valid and is what the reference mock does.
 *   2. Afterwards it streams events with strictly increasing `seq` (per run,
 *      starting at 1, no gaps). Clients drop any event with seq ≤ the seq they
 *      already hold; a gap (seq > held+1) means the client reconnects.
 *   3. After a terminal event (`run.completed`, `run.failed`, `run.cancelled`)
 *      the server closes with code 1000. Connecting to a terminal run yields
 *      the snapshot followed by close 1000.
 *   4. The server sends `{ "type": "ping" }` heartbeats every 15 s (not
 *      sequenced). No heartbeat for 45 s ⇒ client treats socket as dead.
 *   5. Close code 4404 = unknown run (client stops reconnecting).
 *
 *   How to fold events into a RunSnapshot is defined executably in
 *   `src/lib/runReducer.ts` — the backend's own snapshot must equal the fold
 *   of every event it has emitted.
 */

// ─────────────────────────────────────────────────────────────── primitives

export type RunId = string;
export type VideoId = string;
export type IsoTime = string;

export type StageId = "decode" | "probe" | "select" | "match" | "composite" | "evaluate";

/** Canonical stage order. The backend must run stages in this order. */
export const STAGE_ORDER: readonly StageId[] = [
  "decode",
  "probe",
  "select",
  "match",
  "composite",
  "evaluate",
] as const;

export type StageStatus =
  | "pending"
  | "active"
  | "done"
  | "failed"
  /** The run was cancelled while this stage was active. Later stages stay "pending". */
  | "cancelled";

/**
 * Run lifecycle.
 *   queued → running → succeeded
 *                    → failed
 *                    → cancelling → cancelled
 * `cancelling` is a real state: the backend finishes (or aborts) the in-flight
 * unit of work before confirming `cancelled`.
 */
export type RunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";

export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"];
export const isTerminal = (s: RunStatus) => TERMINAL_STATUSES.includes(s);

// ─────────────────────────────────────────────────────────────── inputs

/** Pipeline parameters. */
export interface PipelineParams {
  /** ω — minimum probe score f_m for a candidate pair to count as chained. */
  selectionThreshold: number;
  /** Candidate forward gaps (in native frames) tried from each anchor; the largest passing gap wins. */
  candidateGaps: number[];
  /** Frames are downscaled so the long edge is at most this many pixels before matching. */
  maxWorkingResolution: number;
  /** Enable DKM's optional refinement pass (≈1.6× slower per pair). */
  denseRefinement: boolean;
}

/** Validated defaults. ω = 0.164 is a calibrated value; deviating from it is deliberate. */
export const DEFAULT_PARAMS: PipelineParams = {
  selectionThreshold: 0.164,
  candidateGaps: [1, 2, 4, 8, 16, 32, 64],
  maxWorkingResolution: 1920,
  denseRefinement: false,
};

/** DKM inlier-ratio floor for accepting a registration step. */
export const MIN_INLIER_RATIO = 0.3;

/** Result of ffprobe on the uploaded file. */
export interface VideoProbe {
  filename: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** Average frame rate (r_frame_rate). */
  fps: number;
  durationMs: number;
  /** Exact decoded frame count (nb_read_frames), not duration × fps. */
  frameCount: number;
  codec: string;
}

export interface VideoAsset {
  id: VideoId;
  probe: VideoProbe;
  uploadedAt: IsoTime;
  /** First decoded frame, JPEG. Null until the backend has extracted it. */
  thumbnailUrl: string | null;
  /**
   * Browser-playable preview of the upload. Originals are often HEVC/4K and
   * won't play in every browser, so the backend should serve an H.264 proxy.
   * Null when no preview is available.
   */
  previewUrl: string | null;
}

export interface CreateRunRequest {
  videoId: VideoId;
  params: PipelineParams;
  /** Mock backend only: deterministic scenario to simulate. The real backend must ignore this field. */
  mockScenario?: MockScenario;
}

export type MockScenario = "success" | "diverged" | "truncated" | "ref-breaks" | "fail-match" | "fail-decode";

export interface HealthStatus {
  ok: boolean;
  /** Human-readable backend identifier, e.g. "fastapi 0.3.1 · cuda:0". */
  backend: string;
  version: string;
}

// ─────────────────────────────────────────────────────────────── run state

export interface StageState {
  id: StageId;
  status: StageStatus;
  startedAt: IsoTime | null;
  finishedAt: IsoTime | null;
  /** 0..1 progress within the stage, or null when indeterminate. */
  progress: number | null;
  /** Unit counter shown under the stage, e.g. { done: 512, total: 2047, unit: "frames" }. */
  counter: { done: number; total: number | null; unit: string } | null;
}

/** One dense-matching step (stage MATCH): registering `toFrame` against the chain. */
export interface StepResult {
  /** 1-based step number. */
  step: number;
  fromFrame: number;
  toFrame: number;
  /** Native frames skipped between the two frames. */
  gap: number;
  accepted: boolean;
  /** DKM inlier ratio after RANSAC homography fit, 0..1; accepted iff ≥ MIN_INLIER_RATIO. */
  inlierRatio: number;
  /** Correspondences sampled by DKM (n_matches). */
  nMatches: number;
  /** RANSAC inliers among them (n_inliers). */
  nInliers: number;
  durationMs: number;
  /** Probe score f_m of this edge during SELECT. */
  fmScore: number;
  /** ω the edge was judged against. */
  omega: number;
  /** True if no candidate cleared ω and the chain fell back to the smallest gap. */
  forced: boolean;
  /** Accumulated chain scale G_scale after this step (ideal 1.0). */
  gScale: number;
  /** Accumulated chain shear G_shear after this step (ideal 0.0). */
  gShear: number;
  /** Pairwise PSNR (dB) on the overlap region; null when rejected. Not comparable across runs. */
  psnr: number | null;
  /** Pairwise SSIM on the overlap region; null when rejected. Not comparable across runs. */
  ssim: number | null;
  /** Present only when rejected. Human-readable. */
  rejectReason?: string;
}

/** A probed candidate pair (SELECT). */
export interface CandidatePair {
  from: number;
  to: number;
  gap: number;
  /** Probe score f_m (SIFT inlier-based, cheap). */
  fm: number;
  /** fm ≥ ω */
  passed: boolean;
  /** The edge the chain actually took from `from`. */
  chosen: boolean;
}

export interface SelectionSummary {
  nativeFrameCount: number;
  /** Native indices of the selected frames, ascending. */
  selectedFrames: number[];
  /** Number of probe pairs evaluated. */
  probePairs: number;
  /** Steps where no candidate cleared ω and the chain fell back. */
  forcedSteps: number;
  omega: number;
  /** Every probed candidate, one per (anchor, gap). */
  candidates: CandidatePair[];
}

export interface LiveMetrics {
  /** Server-side wall time since the run started running. */
  elapsedMs: number;
  /** Server's estimate of remaining time; null when it cannot estimate yet. */
  etaMs: number | null;
  framesDecoded: number;
  framesSelected: number | null;
  stepsDone: number;
  stepsTotal: number | null;
  stepsAccepted: number;
}

/** A 4-point polygon in mosaic-image pixel coordinates (clockwise from top-left of the frame). */
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export interface MosaicImage {
  url: string;
  width: number;
  height: number;
}

export interface MosaicPreview {
  /** Monotonic per run. The URL changes with every version (cache-busted). */
  version: number;
  framesComposited: number;
  image: MosaicImage;
  /** Footprint of the most recently composited frame, in `image` pixel coordinates. */
  latestFootprint: Quad | null;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  seq: number;
  ts: IsoTime;
  level: LogLevel;
  stage: StageId | null;
  message: string;
}

export interface RunError {
  /** Stable machine code, e.g. "gpu_oom", "decode_corrupt_stream". */
  code: string;
  message: string;
  stage: StageId;
  /** Optional operator hint. */
  hint?: string;
  /** Machine-applicable parameter changes the backend suggests for a retry. */
  suggestedParams?: Partial<PipelineParams>;
}

export interface RunSummary {
  id: RunId;
  videoId: VideoId;
  status: RunStatus;
  createdAt: IsoTime;
  startedAt: IsoTime | null;
  finishedAt: IsoTime | null;
  video: VideoProbe;
  params: PipelineParams;
  /** Present once the run has succeeded. */
  metrics: RunMetrics | null;
  error: RunError | null;
}

/** Complete materialised state of a run. Sent as `run.snapshot` and by GET /api/runs/{id}. */
export interface RunSnapshot {
  /** seq of the last event folded into this snapshot (0 if none). */
  seq: number;
  run: RunSummary;
  stages: StageState[];
  selection: SelectionSummary | null;
  steps: StepResult[];
  metrics: LiveMetrics;
  mosaic: MosaicPreview | null;
  /** Most recent log lines, at most 500. The complete log is GET /api/runs/{id}/log. */
  logs: LogLine[];
}

// ─────────────────────────────────────────────────────────────── results

/**
 * Final metrics. Trust levels (the UI presents them differently):
 *  PRIMARY    groundCoverage, frames, acceptRate, drift
 *  SECONDARY  runtimes, probe/match cost, forcedSteps, canvas, referenceChainBreaks
 *  CAVEATED   fillRatio (never without coverage), pairwiseQuality (not comparable across runs)
 */
export interface RunMetrics {
  /** Fraction of observed ground (independent reference) present in the mosaic, 0..1. */
  groundCoverage: number;
  /** Breaks in the reference chain; > 0 ⇒ the coverage denominator is unreliable. */
  referenceChainBreaks: number;
  nativeFrames: number;
  framesSelected: number;
  /** Frames actually composited (selected minus rejected). */
  framesUsed: number;
  stepsAttempted: number;
  stepsAccepted: number;
  /** stepsAccepted / stepsAttempted */
  acceptRate: number;
  /** Accumulated chain distortion at the last step. */
  drift: {
    /** G_scale, ideal 1.0 */
    gScale: number;
    /** G_shear, ideal 0.0 */
    gShear: number;
  };
  runtimeMs: number;
  stageRuntimeMs: Record<StageId, number>;
  probe: { pairs: number; totalMs: number; msPerPair: number };
  match: { pairs: number; totalMs: number; msPerPair: number };
  forcedSteps: number;
  canvas: { width: number; height: number; megapixels: number };
  /** Filled px / canvas px. Misleading on its own: a truncated run has a small, easy-to-fill canvas. */
  fillRatio: number;
  /** Means over accepted steps, on pairwise overlap regions. NOT comparable across runs. */
  pairwiseQuality: { psnrDb: number; ssim: number; stepsMeasured: number };
  /** Set when the chain was lost and the run stopped registering frames before the end of the video. */
  terminatedEarly: { atFrame: number; reason: string } | null;
}

export interface SelectedFrame {
  frameIndex: number;
  /** Time of the frame in the source video. */
  timestampMs: number;
  /** Native frames skipped since the previous selected frame (0 for the first). */
  gapFromPrev: number;
  /** f_m of the edge that reached this frame (null for the first). */
  fmScore: number | null;
  forced: boolean;
  /** false if its registration step was rejected (frame excluded from mosaic). */
  used: boolean;
  thumbnailUrl: string;
}

export interface RunResult {
  runId: RunId;
  run: RunSummary;
  metrics: RunMetrics;
  stages: StageState[];
  mosaic: MosaicImage & {
    downloadUrl: string;
    downloadName: string;
    preview: MosaicImage;
  };
  frames: SelectedFrame[];
  steps: StepResult[];
  selection: SelectionSummary;
  /** Apparent ground motion (working-res px / frame), sampled along the video. Explains gap widths. */
  motionProfile: { frame: number; pxPerFrame: number }[];
}

// ─────────────────────────────────────────────────────────────── events

interface EventBase {
  runId: RunId;
  /** Strictly increasing per run, starting at 1. */
  seq: number;
  ts: IsoTime;
}

export type PipelineEvent =
  | (EventBase & { type: "run.snapshot"; snapshot: RunSnapshot })
  | (EventBase & { type: "run.status"; status: RunStatus })
  | (EventBase & {
      type: "stage.update";
      stage: StageId;
      status: StageStatus;
      progress: number | null;
      counter: StageState["counter"];
    })
  | (EventBase & { type: "log"; level: LogLevel; stage: StageId | null; message: string })
  | (EventBase & { type: "selection.done"; selection: SelectionSummary })
  | (EventBase & { type: "step.result"; result: StepResult })
  | (EventBase & { type: "metrics"; metrics: LiveMetrics })
  | (EventBase & { type: "mosaic.update"; mosaic: MosaicPreview })
  | (EventBase & { type: "run.completed"; metrics: RunMetrics })
  | (EventBase & { type: "run.failed"; error: RunError })
  | (EventBase & { type: "run.cancelled" });

export type PipelineEventType = PipelineEvent["type"];

/** Heartbeat frame; not a PipelineEvent, never sequenced. */
export interface PingFrame {
  type: "ping";
}

export interface ApiError {
  code: string;
  message: string;
  /** e.g. the active runId for code "run_active". */
  runId?: RunId;
}
