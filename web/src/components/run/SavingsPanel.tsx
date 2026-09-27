"use client";

import type { ReactNode } from "react";
import type { RunMetrics, SelectionSummary } from "@/services";
import { fmtDuration, fmtInt } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/primitives";

/**
 * The headline comparison, computed from this run — never hardcoded.
 *
 *  - Search space: candidate edges the cheap probe evaluated. This is NOT cost avoided.
 *  - Primary baseline: N=fps (every round(fps)-th frame, chained) — the method the published
 *    comparison used. Secondary: the native consecutive chain (n − 1 pairs).
 *  - Actual cost = measured SIFT describe + probe + DKM time. Baseline cost = its DKM calls ×
 *    this run's measured per-attempt cost, always labelled "projected".
 *  - When the arms cannot be compared cleanly (chain stopped early, SIFT served from cache,
 *    no DKM attempts), the time comparison is withheld with the reason, not footnoted.
 */
export function SavingsPanel({ metrics, selection }: { metrics: RunMetrics | null; selection: SelectionSummary | null }) {
  const s1 = metrics?.stage1 ?? (selection && { candidateEdges: selection.candidateEdges, passing: selection.passing, plannedPath: selection.plannedPath });
  if (!s1) return <p className="px-3 py-6 text-center text-xs text-fg-muted">Appears once stage 1 (selection) has finished.</p>;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">Search space explored by the cheap probe</div>
        <p className="num mt-1 text-sm">
          {fmtInt(s1.candidateEdges)} candidate edges evaluated · {fmtInt(s1.passing)} passed the gate ·{" "}
          {metrics ? (
            <>
              <b className="text-fg">{fmtInt(metrics.stage2.attempts)}</b> pairs sent to DKM
            </>
          ) : (
            <>{fmtInt(s1.plannedPath.length - 1)} hops on the initial plan</>
          )}
        </p>
        <p className="mt-0.5 text-2xs text-fg-subtle">
          The size of the search, not cost avoided: gap-32/64 candidates exist to be tested cheaply and discarded, and nobody would run DKM on all of them.
        </p>
      </div>
      {metrics ? <Baselines m={metrics} /> : <p className="text-2xs text-fg-muted">The baseline comparison is computed when the run completes.</p>}
    </div>
  );
}

function Baselines({ m }: { m: RunMetrics }) {
  const nfps = m.baselines.nfps;
  const per = m.stage2.msPerAttempt;
  const describe = m.stage1.describeMs;
  const probe = m.stage1.probeMs;
  const dkm = m.stage2.dkmMs;

  const blockers: string[] = [];
  if (!m.stage2.reachedLast)
    blockers.push(`the chain stopped at frame ${m.stage2.lastFrame} of ${m.nativeFrames - 1}, while the baselines span the whole video`);
  if (m.stage1.describeCached) blockers.push("SIFT descriptors were served from the decode cache, so this run did not measure their cost");
  if (per == null || !m.stage2.attempts) blockers.push("no DKM attempt was measured");
  if (describe == null || probe == null || dkm == null) blockers.push("a stage time is missing");
  const timeOk = blockers.length === 0;
  const actual = timeOk ? describe! + probe! + dkm! : null;
  const proj = (calls: number) => (per != null ? calls * per : null);

  const rows: { label: ReactNode; frames: ReactNode; calls: number; time: number | null; projected: boolean; primary?: boolean }[] = [
    {
      label: "This run (measured)",
      frames: `${fmtInt(m.stage2.nComposited)} composited`,
      calls: m.stage2.attempts,
      time: actual,
      projected: false,
    },
  ];
  if (nfps)
    rows.push({
      label: (
        <Tooltip content={`${nfps.definition}; step = ${nfps.step}`}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">N=fps baseline</span>
        </Tooltip>
      ),
      frames: fmtInt(nfps.frames),
      calls: nfps.dkmCalls,
      time: proj(nfps.dkmCalls),
      projected: true,
      primary: true,
    });
  rows.push({
    label: "Native consecutive chain",
    frames: fmtInt(m.baselines.nativeChain.frames),
    calls: m.baselines.nativeChain.dkmCalls,
    time: proj(m.baselines.nativeChain.dkmCalls),
    projected: true,
  });

  const delta = (b: (typeof rows)[number]) => {
    const dc = b.calls - m.stage2.attempts;
    return (
      <span className="num">
        {dc === 0 ? "same DKM calls" : `${fmtInt(Math.abs(dc))} ${dc > 0 ? "fewer" : "more"} DKM calls`}
        {timeOk && b.time != null && actual != null && (
          <>
            {" · "}
            <span className={b.time - actual >= 0 ? "text-ok" : "text-warn"}>
              {fmtDuration(Math.abs(b.time - actual))} {b.time - actual >= 0 ? "less" : "more"} time
            </span>{" "}
            <span className="text-fg-subtle">(vs projected)</span>
          </>
        )}
        {" "}than {b.primary ? "N=fps" : "the native chain"}
      </span>
    );
  };

  return (
    <div>
      <div className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">Cost against baselines</div>
      <table className="mt-1 w-full text-xs">
        <thead className="text-2xs text-fg-subtle">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-normal" />
            <th className="py-1 text-right font-normal">frames</th>
            <th className="py-1 text-right font-normal">DKM calls</th>
            <th className="py-1 text-right font-normal">time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-line/50", r.primary && "bg-accent-soft/40")}>
              <td className="py-1 pr-2">{r.label}</td>
              <td className="num py-1 text-right text-fg-muted">{r.frames}</td>
              <td className="num py-1 text-right">{fmtInt(r.calls)}</td>
              <td className="num py-1 text-right">
                {timeOk && r.time != null ? (
                  <>
                    {fmtDuration(r.time)}
                    {r.projected && <span className="ml-1 text-2xs text-fg-subtle">projected</span>}
                  </>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 flex flex-col gap-0.5 text-xs">
        {rows.slice(1).map((r, i) => (
          <li key={i} className={cn(r.primary ? "text-fg" : "text-fg-muted")}>
            {delta(r)}
          </li>
        ))}
      </ul>
      {timeOk ? (
        <p className="mt-2 text-2xs text-fg-subtle">
          Measured: SIFT describe {fmtDuration(describe)} + probe {fmtDuration(probe)} + DKM {fmtDuration(dkm)}. Projected = DKM calls × this run&apos;s mean{" "}
          {fmtDuration(per)} per attempt (match + dual-layer): an extrapolation, not a measurement.
        </p>
      ) : (
        <p className="mt-2 text-2xs text-warn">Time comparison withheld: {blockers.join("; ")}.</p>
      )}
    </div>
  );
}
