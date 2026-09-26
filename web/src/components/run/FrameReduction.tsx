"use client";

import { useMemo } from "react";
import type { RunSnapshot } from "@/services";
import { fmtDuration, fmtInt, fmtPct } from "@/lib/format";

/**
 * The key idea of the pipeline, made visible: SELECT shrinks thousands of
 * native frames to a few dozen before the slow dense matcher runs.
 */
export function FrameReduction({ snapshot }: { snapshot: RunSnapshot }) {
  const N = snapshot.run.video.frameCount;
  const sel = snapshot.selection;
  const decoded = snapshot.metrics.framesDecoded;
  const steps = snapshot.steps;
  const current = snapshot.stages.find((s) => s.id === "match")?.status === "active" ? steps.length : -1;

  const stepByTo = useMemo(() => new Map(steps.map((s) => [s.toFrame, s])), [steps]);
  const meanStep = steps.length ? steps.reduce((a, s) => a + s.durationMs, 0) / steps.length : null;

  const W = 1000;
  const x = (f: number) => (N <= 1 ? 0 : (f / (N - 1)) * W);

  return (
    <div className="p-3">
      <div className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">Frame selection</div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="num text-xl text-fg">
          {fmtInt(N)}
          <span className="mx-1.5 text-fg-subtle">→</span>
          <span className={sel ? "text-fg" : "text-fg-subtle"}>{sel ? fmtInt(sel.selectedFrames.length) : "···"}</span>
          <span className="ml-1.5 text-xs text-fg-subtle">frames</span>
        </div>
        <div className="num text-sm text-fg-muted">
          {sel ? (
            <>
              <span className="text-fg">{fmtPct(1 - sel.selectedFrames.length / N)}</span> reduction
            </>
          ) : (
            "selecting…"
          )}
        </div>
      </div>

      {/* Native frame timeline: every selected frame is a tick. */}
      <svg viewBox={`0 0 ${W} 28`} preserveAspectRatio="none" className="mt-2.5 h-7 w-full" aria-hidden="true">
        <rect x={0} y={11} width={W} height={6} fill="var(--surface-3)" rx={1} />
        {!sel && <rect x={0} y={11} width={(decoded / Math.max(1, N)) * W} height={6} fill="var(--fg-subtle)" opacity={0.6} rx={1} />}
        {sel?.selectedFrames.map((f, i) => {
          const st = stepByTo.get(f);
          const color =
            i === current ? "var(--accent)" : st ? (st.accepted ? "var(--fg)" : "var(--bad)") : i === 0 && steps.length ? "var(--fg)" : "var(--fg-subtle)";
          return <rect key={f} x={x(f) - 1.5} y={i === current ? 2 : 6} width={3} height={i === current ? 24 : 16} fill={color} />;
        })}
      </svg>
      <div className="num mt-0.5 flex justify-between text-2xs text-fg-subtle">
        <span>f0000</span>
        <span>native frame index</span>
        <span>f{String(N - 1).padStart(4, "0")}</span>
      </div>

      <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2.5 text-xs">
        <dt className="font-sans text-fg-muted">Dense-match pairs</dt>
        <dd className="text-right text-fg">
          {sel ? fmtInt(sel.selectedFrames.length - 1) : "—"}
          <span className="text-fg-subtle"> of {fmtInt(N - 1)}</span>
        </dd>
        <dt className="font-sans text-fg-muted">Probe pairs (SIFT)</dt>
        <dd className="text-right text-fg">{sel ? fmtInt(sel.probePairs) : "—"}</dd>
        <dt className="font-sans text-fg-muted">
          All-frames DKM at {meanStep ? "this" : "~5 s"} rate
        </dt>
        <dd className="text-right text-fg-muted">
          {fmtDuration((N - 1) * (meanStep ?? 5000))}
          {sel && (
            <span className="text-fg-subtle"> vs {fmtDuration((sel.selectedFrames.length - 1) * (meanStep ?? 5000))}</span>
          )}
        </dd>
      </dl>
    </div>
  );
}
