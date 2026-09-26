import {
  STAGE_ORDER,
  type LogLine,
  type PipelineEvent,
  type RunSnapshot,
  type RunSummary,
  type StageState,
} from "@/services/contract";

export const MAX_LOG_LINES = 500;

export function initialStages(): StageState[] {
  return STAGE_ORDER.map((id) => ({
    id,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    progress: null,
    counter: null,
  }));
}

export function emptySnapshot(run: RunSummary): RunSnapshot {
  return {
    seq: 0,
    run,
    stages: initialStages(),
    selection: null,
    steps: [],
    metrics: {
      elapsedMs: 0,
      etaMs: null,
      framesDecoded: 0,
      framesSelected: null,
      stepsDone: 0,
      stepsTotal: null,
      stepsAccepted: 0,
    },
    mosaic: null,
    logs: [],
  };
}

function closeActiveStage(stages: StageState[], status: "failed" | "cancelled", ts: string) {
  return stages.map((s) => (s.status === "active" ? { ...s, status, finishedAt: ts } : s));
}

/**
 * Folds one event into a snapshot. Pure; returns the same object when the
 * event is stale (seq already applied). This is the normative definition of
 * event semantics referenced by contract.ts.
 */
export function applyEvent(snap: RunSnapshot, ev: PipelineEvent): RunSnapshot {
  if (ev.type === "run.snapshot") return ev.snapshot;
  if (ev.seq <= snap.seq) return snap;

  const next: RunSnapshot = { ...snap, seq: ev.seq };

  switch (ev.type) {
    case "run.status": {
      next.run = {
        ...snap.run,
        status: ev.status,
        startedAt: snap.run.startedAt ?? (ev.status === "running" ? ev.ts : null),
      };
      return next;
    }
    case "stage.update": {
      next.stages = snap.stages.map((s) => {
        if (s.id !== ev.stage) return s;
        const finished = ev.status === "done" || ev.status === "failed" || ev.status === "cancelled";
        return {
          ...s,
          status: ev.status,
          progress: ev.progress,
          counter: ev.counter,
          startedAt: s.startedAt ?? (ev.status === "active" ? ev.ts : null),
          finishedAt: finished ? ev.ts : null,
        };
      });
      return next;
    }
    case "log": {
      const line: LogLine = { seq: ev.seq, ts: ev.ts, level: ev.level, stage: ev.stage, message: ev.message };
      const logs = snap.logs.length >= MAX_LOG_LINES ? snap.logs.slice(-(MAX_LOG_LINES - 1)) : snap.logs.slice();
      logs.push(line);
      next.logs = logs;
      return next;
    }
    case "selection.done": {
      next.selection = ev.selection;
      return next;
    }
    case "step.result": {
      const steps = snap.steps.filter((s) => s.step !== ev.result.step);
      steps.push(ev.result);
      steps.sort((a, b) => a.step - b.step);
      next.steps = steps;
      return next;
    }
    case "metrics": {
      next.metrics = ev.metrics;
      return next;
    }
    case "mosaic.update": {
      if (snap.mosaic && snap.mosaic.version >= ev.mosaic.version) return next;
      next.mosaic = ev.mosaic;
      return next;
    }
    case "run.completed": {
      next.run = { ...snap.run, status: "succeeded", finishedAt: ev.ts, metrics: ev.metrics };
      next.metrics = { ...snap.metrics, etaMs: 0 };
      return next;
    }
    case "run.failed": {
      next.run = { ...snap.run, status: "failed", finishedAt: ev.ts, error: ev.error };
      next.stages = closeActiveStage(snap.stages, "failed", ev.ts);
      next.metrics = { ...snap.metrics, etaMs: null };
      return next;
    }
    case "run.cancelled": {
      next.run = { ...snap.run, status: "cancelled", finishedAt: ev.ts };
      next.stages = closeActiveStage(snap.stages, "cancelled", ev.ts);
      next.metrics = { ...snap.metrics, etaMs: null };
      return next;
    }
  }
}
