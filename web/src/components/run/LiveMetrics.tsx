"use client";

import type { RunSnapshot } from "@/services";
import { isTerminal } from "@/services";
import { fmtClock, fmtInt, fmtPct } from "@/lib/format";
import { Stat } from "@/components/ui/primitives";

/** Elapsed/ETA interpolated locally between server metrics events. */
export function LiveMetrics({ snapshot, metricsAt, now }: { snapshot: RunSnapshot; metricsAt: number; now: number }) {
  const m = snapshot.metrics;
  const live = snapshot.run.status === "running" || snapshot.run.status === "cancelling";
  const since = live && metricsAt && now ? Math.max(0, now - metricsAt) : 0;
  const { startedAt, finishedAt } = snapshot.run;
  const elapsed =
    snapshot.run.status === "queued"
      ? 0
      : startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : m.elapsedMs + since;
  const eta = m.etaMs == null ? null : Math.max(0, m.etaMs - since);
  const acceptRate = m.stepsDone ? m.stepsAccepted / m.stepsDone : null;
  const terminal = isTerminal(snapshot.run.status);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-3">
      <Stat
        label="Frames selected"
        value={m.framesSelected != null ? fmtInt(m.framesSelected) : "—"}
        unit={`/ ${fmtInt(snapshot.run.video.frameCount)}`}
        sub={m.framesSelected == null ? "after SELECT" : `${fmtInt(m.stepsTotal)} pairs to match`}
      />
      <Stat
        label="Accept rate"
        value={fmtPct(acceptRate)}
        tone={acceptRate == null ? undefined : acceptRate < 0.7 ? "warn" : undefined}
        sub={m.stepsDone ? `${m.stepsAccepted} / ${m.stepsDone} accepted` : "no steps yet"}
      />
      <Stat label="Elapsed" value={fmtClock(elapsed)} sub={snapshot.run.status === "queued" ? "queued" : terminal ? "final" : "running"} />
      <Stat
        label="ETA"
        value={terminal ? "—" : eta == null ? "…" : fmtClock(eta)}
        sub={
          terminal
            ? snapshot.run.status
            : eta == null
              ? "estimating"
              : `≈ ${new Date(now + eta).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        }
      />
    </div>
  );
}
