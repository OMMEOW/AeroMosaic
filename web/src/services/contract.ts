/**
 * UAV mosaicking pipeline (NB_L2 on Apple Silicon) — frontend ⇄ backend contract.
 *
 * The backend is backend/server (FastAPI). Every payload that crosses the wire is typed
 * here; nothing else in the frontend defines wire shapes. Shapes follow the pipeline's own
 * records (backend/server/records.py), agreed 2026-09-27. Rules:
 *  - Unmeasured is null, never 0. The UI renders null as "—" with a tooltip, never a zero bar.
 *  - Ratios are 0..1; the UI formats percentages. Durations are integer ms, suffixed `Ms`.
 *  - Frame indices are 0-based indices into the decoded native frame sequence.
 *  - Timestamps are ISO-8601 UTC.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REST (all under /api)
 *   GET    /health                          → HealthStatus
 *   GET    /videos                          → VideoAsset[]      (data root, probed)
 *   GET    /videos/{id}                     → VideoAsset
 *   POST   /videos/{id}/count               → VideoAsset        (decode now for the exact frame count)
 *   GET    /videos/{id}/thumbnail.jpg | /videos/{id}/preview
 *   POST   /runs      CreateRunRequest      → RunSummary (201) · 503 {code:"not_ready"} · 422 {code:"bad_variant"}
 *   GET    /runs                            → RunSummary[] (newest first; a directory scan)
 *   GET    /runs/active                     → RunSummary | 204
 *   GET    /runs/{id}                       → RunSummary
 *   GET    /runs/{id}/events?since=N        → PipelineEvent[]   (REST replay of events.jsonl)
 *   GET    /runs/{id}/steps?stage=1|2       → (CandidateEdge | DkmAttempt)[]  (steps.jsonl)
 *   GET    /runs/{id}/log                   → text/plain (run.log: worker stdout/stderr, full tracebacks)
 *   POST   /runs/{id}/cancel                → 202 RunSummary · 409 if terminal
 *   DELETE /runs/{id}                       → 204 · 409 {code:"run_active"}
 *   GET    /runs/{id}/artifacts             → { files: {name, sizeBytes}[], zip }
 *   GET    /runs/{id}/artifacts/{name}      → the file; name "run.zip" = the whole run directory
 *   GET    /runs/{id}/mosaic.png | /mosaic_preview.png | /frames/{i}.jpg?w=
 *
 * WEBSOCKET  /api/runs/{id}/events?since={seq}
 *   Replays every event in events.jsonl with seq > since, then streams new ones. seq is
 *   strictly increasing from 1 with no gaps; the first event of every run is `run.created`.
 *   After a terminal event (run.completed | run.failed | run.cancelled | run.interrupted)
 *   the server closes 1000. {"type":"ping"} every 15 s (not sequenced). Close 4404 = unknown run.
 *   Folding the events is defined in src/lib/runReducer.ts.
 */

export type RunId = string;
export type VideoId = string;
export type IsoTime = string;

// ─────────────────────────────────────────────────────────────── stages

export type StageId =
  | "preflight"
  | "selftest"
  | "decode"
  | "sift"
  | "probe"
  | "select"
  | "reference"
  | "dkm"
  | "composite"
  | "coverage";

/** Execution order (backend/pipeline/run.py, then composition and coverage). */
export const STAGE_ORDER: readonly StageId[] = [
  "preflight",
  "selftest",
  "decode",
  "sift",
  "probe",
  "select",
  "reference",
  "dkm",
  "composite",
  "coverage",
] as const;

/** 0 = preflight, 1 = pre-DKM selection (cheap, SIFT), 2 = DKM and evaluation (expensive). */
export const STAGE_GROUP: Record<StageId, 0 | 1 | 2> = {
  preflight: 0,
  selftest: 0,
  decode: 1,
  sift: 1,
  probe: 1,
  select: 1,
  reference: 2,
  dkm: 2,
  composite: 2,
  coverage: 2,
};

export type StageStatus = "pending" | "active" | "done" | "failed" | "cancelled";

export type RunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted";
export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled", "interrupted"];
export const isTerminal = (s: RunStatus) => TERMINAL_STATUSES.includes(s);

// ─────────────────────────────────────────────────────────────── constants (read-only)

/** Pipeline constants as reported by /health. Not editable from the UI: they are calibrated. */
export interface PipelineConstants {
  omega: number;
  iouTrust: number;
  gateScore: string;
  minInlierRatio: number;
  tauS: number;
  tauR: number;
  candidateGaps: number[];
  probeNFeatures: number;
  dkmNumSamples: number;
  upsamplePreds: boolean;
  maxSide: number;
}

// ─────────────────────────────────────────────────────────────── health, videos

export interface HealthStatus {
  ok: boolean;
  state: "pending" | "ready" | "error";
  version: string;
  backend: string;
  /** Why runs cannot start right now (empty when runsAllowed). */
  blockers: string[];
  runsAllowed: boolean;
  info: {
    device: string;
    torch: string;
    opencv: string;
    python: string;
    mpsInverseMode: string | null;
    inverseSelftest: { passed: boolean; maxRelErr: number | null; tol: number; b: number; n: number; mode: string | null; error: string | null };
    estimator: "magsac" | "gcransac";
    dkm: { repo: string; repoFound: boolean; weights: string; weightsFound: boolean };
    semstitch: {
      repo: string;
      repoFound: boolean;
      checkpoint: string;
      checkpointFound: boolean;
      sha256: string | null;
      expectedSha256: string | null;
      verified: boolean;
      error: string | null;
    };
  } | null;
  error: string | null;
  defaultVariant: VariantKind;
  variants: VariantKind[];
  activeRunId: RunId | null;
  queued: number;
  frameCounter: VideoId | null;
  runsRoot: string;
  dataRoot: string;
  constants: PipelineConstants;
}

export interface VideoProbe {
  filename: string;
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  fps: number | null;
  /** Decoded frame count (read until the decoder stops). null until the file has been decoded once. */
  frameCount: number | null;
  frameCountSource: "decode-count" | "run-decode" | null;
  /** CAP_PROP_FRAME_COUNT from the container. Informational only; it overstates on some files. */
  containerFrameCount: number | null;
  durationMs: number | null;
  codec: string | null;
}

export interface VideoAsset {
  id: VideoId;
  group: string;
  probe: VideoProbe;
  thumbnailUrl: string;
  previewUrl: string;
}

// ─────────────────────────────────────────────────────────────── runs

export type VariantKind = "semantic" | "firstwins" | "dgeo" | "random";

export interface Variant {
  kind: VariantKind;
  bias: number | null;
  w_sem: number | null;
  /** Notebook variant name (vname): "firstwins", "sem_b0", "dgeo_b0", … */
  name: string;
}

export interface CreateRunRequest {
  videoId: VideoId;
  /** Omit for the server default (health.defaultVariant). */
  variant?: VariantKind;
  seed?: number;
}

export interface RunError {
  code: string;
  exceptionType: string | null;
  message: string;
  stage: StageId;
  hint: string | null;
  /** Last lines of the traceback; the full traceback is in run.log. */
  tracebackTail: string | null;
}

export interface RunSummary {
  id: RunId;
  videoId: VideoId;
  videoGroup: string | null;
  status: RunStatus;
  createdAt: IsoTime;
  startedAt: IsoTime | null;
  finishedAt: IsoTime | null;
  video: {
    filename: string;
    path: string;
    width: number | null;
    height: number | null;
    fps: number | null;
    /** Decoded native frames; null until this run has decoded the video. */
    frameCount: number | null;
    durationMs: number | null;
  };
  variant: Variant;
  seed: number;
  device: string | null;
  estimator: "magsac" | "gcransac" | null;
  semstitch: {
    repo: string;
    repo_commit: string | null;
    checkpoint: string;
    checkpoint_found: boolean;
    sha256: string | null;
    expected_sha256: string | null;
    verified: boolean;
    used: boolean;
  } | null;
  inverseSelftest: { max_rel_err: number; tol: number; passed: boolean } | null;
  failedStage: StageId | null;
  error: RunError | null;
  interruptedReason: string | null;
  metrics: RunMetrics | null;
}

// ─────────────────────────────────────────────────────────────── per-pair records

export type Stage1Cause = "PROXY_FIT_FAILED" | "GATE_IOU" | "GATE_FM";
export type Stage2Cause = "DEGENERATE_H" | "RATIO_BELOW_MIN" | "EXCEPTION";
export type RejectCause = Stage1Cause | Stage2Cause;

interface PairRecordBase {
  frameI: number;
  frameJ: number;
  gap: number;
  /** f_m = n_putative / 500 (the gate score). null when not computed on this record's path. */
  fm: number | null;
  /** f_u (diagnostic, not gated). null when not computed. */
  fu: number | null;
  /** IoU of the proxy homography's footprint. null when not computed. */
  proxyIou: number | null;
  /** DKM inlier ratio (stage 2). Always null in stage 1. */
  inlierRatio: number | null;
  accepted: boolean;
  rejectCause: RejectCause | null;
  /** The notebook's own reason, e.g. "IoU 0.39 < 0.40", "putative<4: 2 ratio-test matches". */
  rejectDetail: string;
}

/**
 * Stage 1 — one per candidate edge (i, i+g) for g in the candidate gaps.
 * Check order (notebook cell 8): descriptors, putative<4, proxy homography → PROXY_FIT_FAILED;
 * then IoU < 0.40 → GATE_IOU; then f_m < 0.164 → GATE_FM.
 */
export interface CandidateEdge extends PairRecordBase {
  stage: 1;
  rejectCause: Stage1Cause | null;
  nPutative: number | null;
  nProxyInliers: number | null;
  /** Whether f_m alone would clear ω (null if f_m unmeasured). Shows whether the IoU check does independent work. */
  fmPasses: boolean | null;
  iouPasses: boolean | null;
  /** Hop of the initial DAG shortest path. */
  onPlannedPath: boolean;
}

/** Stage 2 — one per DKM attempt (notebook cell 16, re-plan on rejection). */
export interface DkmAttempt extends PairRecordBase {
  stage: 2;
  attempt: number;
  rejectCause: Stage2Cause | null;
  nMatches: number | null;
  nEpipolar: number | null;
  epipolarOk: boolean | null;
  nInliers: number | null;
  residMedianPx: number | null;
  residP95Px: number | null;
  dGeoP95: number | null;
  dPhotP95: number | null;
  estimator: "magsac" | "gcransac" | null;
  durationMs: number;
  plannedLen: number | null;
  /** This attempt followed a rejection (the path was re-solved from the same reference). */
  replanned: boolean;
}

export type PairRecord = CandidateEdge | DkmAttempt;

// ─────────────────────────────────────────────────────────────── summaries

export interface SelectionSummary {
  nativeFrames: number;
  candidateGaps: number[];
  /** Σ over gaps of (n − g): the search space the cheap probe explores. */
  candidateEdges: number;
  probed: number;
  passing: number;
  rejects: Record<Stage1Cause, number>;
  gateBinding: boolean;
  plannedPath: number[];
  /** Largest-jump path over the same edges (diagnostic; not used). */
  greedyPath: number[];
  omega: number;
  iouTrust: number;
  gateScore: string;
  describeMs: number | null;
  describeCached: boolean;
  probeMs: number | null;
}

export interface ReferenceSummary {
  observedAreaPx: number;
  canvasW: number;
  canvasH: number;
  scale: number;
  chainBreaks: number;
  breakFrames: number[];
}

export interface LiveMetrics {
  elapsedMs: number;
  attempts: number;
  accepted: number;
  msPerAttempt: number;
  /** Hops left on the current plan; null right after a rejection (the plan is re-solved next). */
  remainingHopsOnPlan: number | null;
  /** remainingHopsOnPlan × msPerAttempt — an estimate assuming no further rejections. */
  etaMs: number | null;
}

export interface MosaicInfo {
  url: string;
  width: number;
  height: number;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
}

export interface RunMetrics {
  /** |A_method ∩ A_observed| / |A_observed| (notebook cell 41). */
  absoluteCoverage: number;
  /** Fixed per-run denominator: reference-chain observed area, px. */
  observedAreaPx: number;
  /** > 0 ⇒ A_observed is not continuous; the coverage denominator is unsound. */
  referenceChainBreaks: number;
  nativeFrames: number;
  fps: number | null;
  workingResolution: [number, number];
  stage1: {
    candidateEdges: number;
    probed: number;
    passing: number;
    rejects: Record<Stage1Cause, number>;
    plannedPath: number[];
    gateBinding: boolean;
    describeMs: number | null;
    describeCached: boolean;
    probeMs: number | null;
    msPerProbe: number | null;
  };
  stage2: {
    attempts: number;
    accepted: number;
    rejects: Record<Stage2Cause, number>;
    composited: number[];
    nComposited: number;
    reachedLast: boolean;
    lastFrame: number | null;
    dkmMs: number | null;
    /** Mean measured wall time per DKM attempt (match + dual-layer + residuals). */
    msPerAttempt: number | null;
    estimator: "magsac" | "gcransac" | null;
  };
  composition: {
    variant: VariantKind;
    variantName: string;
    composeMs: number | null;
    /** Steps composed first-wins instead of by the variant (overlap < 50 px, or seam net failed on that step). */
    seamFallbackSteps: number;
    semPadded: number;
    semDegenerate: number;
    mosaicWidth: number;
    mosaicHeight: number;
  };
  baselines: {
    /** N=fps: every round(fps)-th decoded frame, chained → frames − 1 DKM calls. */
    nfps: { step: number; frames: number; dkmCalls: number; definition: string } | null;
    /** Sequential registration at native rate: n − 1 DKM calls. */
    nativeChain: { frames: number; dkmCalls: number };
  };
  runtimeMs: number;
  stageMs: Partial<Record<StageId, number>>;
  stageCached: Partial<Record<StageId, boolean>>;
  device: string | null;
  seed: number;
}

// ─────────────────────────────────────────────────────────────── events

interface EventBase {
  runId: RunId;
  seq: number;
  ts: IsoTime;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type PipelineEvent =
  | (EventBase & { type: "run.created"; run: RunSummary })
  | (EventBase & { type: "run.status"; status: RunStatus })
  /** Facts the worker learns after start (manifest fields); merged into the run summary. */
  | (EventBase & { type: "run.info"; info: Partial<Pick<RunSummary, "device" | "estimator" | "semstitch" | "inverseSelftest">> })
  | (EventBase & {
      type: "stage.update";
      stage: StageId;
      status: StageStatus;
      progress: number | null;
      counter: { done: number; total: number | null; unit: string } | null;
      cached: boolean;
      durationMs: number | null;
    })
  | (EventBase & { type: "log"; level: LogLevel; stage: StageId | null; message: string })
  | (EventBase & { type: "video.decoded"; nativeFrames: number; fps: number; workingResolution: [number, number]; sourceResolution: [number, number] })
  | (EventBase & { type: "edges.batch"; records: CandidateEdge[] })
  | (EventBase & { type: "selection.done"; selection: SelectionSummary })
  | (EventBase & { type: "reference.done"; reference: ReferenceSummary })
  | (EventBase & { type: "dkm.attempt"; record: DkmAttempt })
  | (EventBase & { type: "metrics"; metrics: LiveMetrics })
  | (EventBase & { type: "mosaic.ready"; mosaic: MosaicInfo; variant: Variant })
  | (EventBase & { type: "run.completed"; metrics: RunMetrics })
  | (EventBase & { type: "run.failed"; error: RunError })
  | (EventBase & { type: "run.cancelled"; stage: StageId | null; killed: boolean })
  | (EventBase & { type: "run.interrupted"; reason: string; stage: StageId | null });

export type PipelineEventType = PipelineEvent["type"];
export const TERMINAL_EVENTS: readonly PipelineEventType[] = ["run.completed", "run.failed", "run.cancelled", "run.interrupted"];

export interface PingFrame {
  type: "ping";
}

export interface ApiError {
  code: string;
  message: string;
  runId?: RunId;
}

export interface ArtifactList {
  files: { name: string; sizeBytes: number }[];
  zip: string;
}
