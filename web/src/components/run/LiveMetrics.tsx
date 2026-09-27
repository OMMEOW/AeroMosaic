"use client";

import { isTerminal } from "@/services";
import type { RunState } from "@/lib/runReducer";
import { fmtClock, fmtDuration, fmtInt } from "@/lib/format";
import { Stat } from "@/components/ui/primitives";

/** Elapsed ticks locally between server events; the ETA is the server's, labelled as an estimate. */
export function LiveMetrics({ state, metricsAt, now }: { state: RunState; metricsAt: number; now: number }) {
  const { run, live, selection } = state;
  const terminal = isTerminal(run.status);
  const since = !terminal && metricsAt && now ? Math.max(0, now - metricsAt) : 0;
  const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const elapsed =
    run.status === "queued" || !started
      ? null
      : run.finishedAt
        ? new Date(run.finishedAt).getTime() - started
        : now
          ? now - started
          : (live?.elapsedMs ?? 0) + since;
  const eta = live?.etaMs == null ? null : Math.max(0, live.etaMs - since);
  const attempts = state.attempts.length;
  const accepted = state.attempts.filter((a) => a.accepted).length;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-3">
      <Stat
        label="Native frames"
        value={state.decoded ? fmtInt(state.decoded.nativeFrames) : "—"}
        sub={state.decoded ? `decoded @ ${state.decoded.fps.toFixed(2)} fps` : "after decode"}
      />
      <Stat
        label="Planned path"
        value={selection ? fmtInt(selection.plannedPath.length) : "—"}
        unit={selection ? "frames" : undefined}
        sub={selection ? `${fmtInt(selection.plannedPath.length - 1)} DKM hops if none rejected` : "after stage 1"}
      />
      <Stat
        label="DKM attempts"
        value={fmtInt(attempts)}
        sub={attempts ? `${accepted} accepted · ${attempts - accepted} rejected` : "none yet"}
        tone={attempts && accepted < attempts ? "warn" : undefined}
      />
      <Stat
        label="Per attempt"
        value={live ? fmtDuration(live.msPerAttempt) : "—"}
        sub="measured mean (match + dual-layer)"
      />
      <Stat label="Elapsed" value={elapsed == null ? "—" : fmtClock(elapsed)} sub={run.status === "queued" ? "queued" : terminal ? "final" : "running"} />
      <Stat
        label="DKM ETA (est.)"
        value={terminal ? "—" : eta == null ? "—" : fmtClock(eta)}
        sub={terminal ? run.status : eta == null ? (live ? "re-planning after a rejection" : "after the first DKM step") : "if no further rejections"}
      />
    </div>
  );
}
