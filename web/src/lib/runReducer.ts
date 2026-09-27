import {
  STAGE_ORDER,
  type CandidateEdge,
  type DkmAttempt,
  type LiveMetrics,
  type LogLevel,
  type MosaicInfo,
  type PipelineEvent,
  type ReferenceSummary,
  type RunSummary,
  type SelectionSummary,
  type StageId,
  type StageStatus,
} from "@/services/contract";

export const MAX_LOG_LINES = 2000;

export interface StageState {
  id: StageId;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  progress: number | null;
  counter: { done: number; total: number | null; unit: string } | null;
  /** Served from the shared decode cache (decode, sift) rather than recomputed. */
  cached: boolean;
  durationMs: number | null;
}

export interface LogLine {
  seq: number;
  ts: string;
  level: LogLevel;
  stage: StageId | null;
  message: string;
}

/** Everything the UI knows about a run: the fold of its events (events.jsonl). */
export interface RunState {
  seq: number;
  run: RunSummary;
  stages: StageState[];
  decoded: { nativeFrames: number; fps: number; workingResolution: [number, number] } | null;
  edges: CandidateEdge[];
  selection: SelectionSummary | null;
  reference: ReferenceSummary | null;
  attempts: DkmAttempt[];
  live: LiveMetrics | null;
  mosaic: MosaicInfo | null;
  logs: LogLine[];
}

export function initialStages(): StageState[] {
  return STAGE_ORDER.map((id) => ({
    id,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    progress: null,
    counter: null,
    cached: false,
    durationMs: null,
  }));
}

export function initialState(run: RunSummary, seq = 0): RunState {
  return {
    seq,
    run,
    stages: initialStages(),
    decoded: null,
    edges: [],
    selection: null,
    reference: null,
    attempts: [],
    live: null,
    mosaic: null,
    logs: [],
  };
}

function closeActive(stages: StageState[], status: "failed" | "cancelled", ts: string) {
  return stages.map((s) => (s.status === "active" ? { ...s, status, finishedAt: ts } : s));
}

/**
 * Folds one event. Pure. `run.created` (always seq 1) starts the state; an event whose seq
 * was already applied returns the same object.
 */
export function applyEvent(state: RunState | null, ev: PipelineEvent): RunState | null {
  if (ev.type === "run.created") return state ?? initialState(ev.run, ev.seq);
  if (!state || ev.seq <= state.seq) return state;
  const next: RunState = { ...state, seq: ev.seq };

  switch (ev.type) {
    case "run.status":
      next.run = {
        ...state.run,
        status: ev.status,
        startedAt: state.run.startedAt ?? (ev.status === "running" ? ev.ts : null),
      };
      return next;
    case "run.info":
      next.run = { ...state.run, ...ev.info };
      return next;
    case "stage.update":
      next.stages = state.stages.map((s) => {
        if (s.id !== ev.stage) return s;
        const finished = ev.status === "done" || ev.status === "failed" || ev.status === "cancelled";
        return {
          ...s,
          status: ev.status,
          progress: ev.progress ?? (finished ? s.progress : null),
          counter: ev.counter ?? (finished ? s.counter : s.counter),
          cached: ev.cached || s.cached,
          durationMs: ev.durationMs ?? s.durationMs,
          startedAt: s.startedAt ?? ev.ts,
          finishedAt: finished ? ev.ts : null,
        };
      });
      return next;
    case "log": {
      const logs = state.logs.length >= MAX_LOG_LINES ? state.logs.slice(-(MAX_LOG_LINES - 1)) : state.logs.slice();
      logs.push({ seq: ev.seq, ts: ev.ts, level: ev.level, stage: ev.stage, message: ev.message });
      next.logs = logs;
      return next;
    }
    case "video.decoded":
      next.decoded = { nativeFrames: ev.nativeFrames, fps: ev.fps, workingResolution: ev.workingResolution };
      next.run = { ...state.run, video: { ...state.run.video, frameCount: ev.nativeFrames, fps: ev.fps } };
      return next;
    case "edges.batch":
      next.edges = state.edges.concat(ev.records);
      return next;
    case "selection.done":
      next.selection = ev.selection;
      return next;
    case "reference.done":
      next.reference = ev.reference;
      return next;
    case "dkm.attempt":
      next.attempts = state.attempts.filter((a) => a.attempt !== ev.record.attempt).concat(ev.record);
      return next;
    case "metrics":
      next.live = ev.metrics;
      return next;
    case "mosaic.ready":
      next.mosaic = ev.mosaic;
      return next;
    case "run.completed":
      next.run = { ...state.run, status: "succeeded", finishedAt: ev.ts, metrics: ev.metrics };
      return next;
    case "run.failed":
      next.run = { ...state.run, status: "failed", finishedAt: ev.ts, error: ev.error, failedStage: ev.error.stage };
      next.stages = closeActive(state.stages, "failed", ev.ts);
      return next;
    case "run.cancelled":
      next.run = { ...state.run, status: "cancelled", finishedAt: ev.ts };
      next.stages = closeActive(state.stages, "cancelled", ev.ts);
      return next;
    case "run.interrupted":
      next.run = { ...state.run, status: "interrupted", finishedAt: ev.ts, interruptedReason: ev.reason, failedStage: ev.stage };
      next.stages = closeActive(state.stages, "failed", ev.ts);
      return next;
  }
}

export function foldEvents(events: PipelineEvent[]): RunState | null {
  let s: RunState | null = null;
  for (const e of events) s = applyEvent(s, e);
  return s;
}
