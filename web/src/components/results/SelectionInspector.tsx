"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Figure } from "@/components/charts/Figure";
import { fmScatterSpec, gapByFrameSpec, gapHistogramSpec, motionSpec, selectionStripSpec } from "@/components/charts/runCharts";
import type { Pt } from "@/components/charts/chartSpec";
import { download } from "@/lib/export/runExports";
import { fmtFrame, fmtInt, fmtPct, fmtRatio, fmtVideoTime } from "@/lib/format";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Copyable, EmptyState } from "@/components/ui/misc";
import { Button, cn, Panel } from "@/components/ui/primitives";
import { useReadyRun } from "./RunDataContext";

/**
 * Explains why these frames were chosen: where they sit on the native
 * timeline, how wide each gap is (and why — ground motion), and every probed
 * candidate's f_m against ω. Click any frame for its selection record.
 */
export function SelectionInspector() {
  const data = useReadyRun();
  const sp = useSearchParams();
  const initial = sp.get("frame") ? Number(sp.get("frame")) : null;
  const [selected, setSelectedState] = useState<number | null>(initial);
  const r = data?.result;

  const setSelected = (f: number | null) => {
    setSelectedState(f);
    const url = new URL(window.location.href);
    if (f == null) url.searchParams.delete("frame");
    else url.searchParams.set("frame", String(f));
    window.history.replaceState(null, "", url);
  };

  const specs = useMemo(() => {
    if (!r) return null;
    return {
      strip: selectionStripSpec(r),
      gapByFrame: gapByFrameSpec(r),
      motion: motionSpec(r),
      hist: gapHistogramSpec(r.selection, r.frames.slice(1).map((f) => f.gapFromPrev)),
      scatter: fmScatterSpec(r.selection, r.metrics.nativeFrames),
    };
  }, [r]);

  const idx = r && selected != null ? r.frames.findIndex((f) => f.frameIndex === selected) : -1;
  useHotkeys([
    { key: "arrowright", description: "Next selected frame", scope: "Frame selection", handler: () => r && setSelected(r.frames[Math.min(r.frames.length - 1, idx + 1)].frameIndex) },
    { key: "arrowleft", description: "Previous selected frame", scope: "Frame selection", handler: () => r && setSelected(r.frames[Math.max(0, idx - 1)].frameIndex) },
    { key: "escape", description: "Clear frame selection", scope: "Frame selection", handler: () => setSelected(null) },
  ]);

  if (!r || !specs) return null;
  const sel = r.selection;
  const frame = idx >= 0 ? r.frames[idx] : null;
  const prev = idx > 0 ? r.frames[idx - 1] : null;
  const candidates = prev ? sel.candidates.filter((c) => c.from === prev.frameIndex).sort((a, b) => a.gap - b.gap) : [];
  const step = frame ? r.steps.find((s) => s.toFrame === frame.frameIndex) : null;
  const pickFrame = (p: Pt) => typeof p.key === "number" && r.frames.some((f) => f.frameIndex === p.key) && setSelected(p.key);
  const gaps = r.frames.slice(1).map((f) => f.gapFromPrev);
  const meanGap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-1 p-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Native frames", fmtInt(r.metrics.nativeFrames), r.metrics.nativeFrames],
          ["Selected", fmtInt(r.frames.length), r.frames.length],
          ["Reduction", fmtPct(1 - r.frames.length / r.metrics.nativeFrames), 1 - r.frames.length / r.metrics.nativeFrames],
          ["Mean gap", meanGap.toFixed(1), meanGap],
          ["Probed pairs", fmtInt(sel.probePairs), sel.probePairs],
          ["ω · forced", `${sel.omega} · ${sel.forcedSteps}`, sel.omega],
        ].map(([label, v, copy]) => (
          <div key={label as string}>
            <div className="text-2xs tracking-wide text-fg-subtle uppercase">{label}</div>
            <div className={cn("num mt-0.5 text-lg", label === "ω · forced" && sel.forcedSteps > 0 ? "text-warn" : "text-fg")}>
              <Copyable value={copy as number}>{v as string}</Copyable>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 xl:col-span-8">
          <Figure spec={specs.strip} run={r.run} file="selection_strip" height={96} onPick={pickFrame} selectedKey={selected} aboutId="stage-select" />
          <Figure spec={specs.gapByFrame} run={r.run} file="gap_by_frame" height={140} onPick={pickFrame} selectedKey={selected} />
          <Figure spec={specs.motion} run={r.run} file="ground_motion" height={140} />
        </div>
        <Panel
          title={frame ? `Frame ${fmtFrame(frame.frameIndex)}` : "Frame detail"}
          className="xl:col-span-4"
          actions={
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => download.frames(r.run, r.frames.map((f) => f.frameIndex), "txt")}>
                indices .txt
              </Button>
              <Button size="sm" variant="ghost" onClick={() => download.frames(r.run, r.frames.map((f) => f.frameIndex), "json")}>
                .json
              </Button>
            </div>
          }
        >
          {!frame ? (
            <EmptyState
              title="Click a selected frame"
              body="Pick a tick on the timeline, a bar in the gap chart, or a point in the f_m chart to see why that frame was chosen."
              action={
                <Button size="sm" onClick={() => setSelected(r.frames[1]?.frameIndex ?? r.frames[0].frameIndex)}>
                  Inspect the first chosen edge
                </Button>
              }
            />
          ) : (
            <div className="p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- service-provided thumbnail */}
              <img src={frame.thumbnailUrl} alt={`Frame ${frame.frameIndex}`} width={384} height={216} className={cn("aspect-video w-full rounded-md bg-inset object-cover", !frame.used && "opacity-50 grayscale")} />
              <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="font-sans text-2xs text-fg-subtle uppercase">Native index</dt>
                  <dd>
                    <Copyable value={frame.frameIndex}>{fmtFrame(frame.frameIndex)}</Copyable>
                  </dd>
                </div>
                <div>
                  <dt className="font-sans text-2xs text-fg-subtle uppercase">Timestamp</dt>
                  <dd>
                    <Copyable value={frame.timestampMs / 1000}>{fmtVideoTime(frame.timestampMs)}</Copyable>
                  </dd>
                </div>
                <div>
                  <dt className="font-sans text-2xs text-fg-subtle uppercase">f_m of reaching edge</dt>
                  <dd className={frame.fmScore != null && frame.fmScore < sel.omega ? "text-warn" : ""}>
                    {frame.fmScore == null ? "— (chain start)" : `${fmtRatio(frame.fmScore)} vs ω ${sel.omega}`}
                  </dd>
                </div>
                <div>
                  <dt className="font-sans text-2xs text-fg-subtle uppercase">Gap</dt>
                  <dd>{frame.gapFromPrev ? `+${frame.gapFromPrev} from ${fmtFrame(prev!.frameIndex)}` : "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-sans text-2xs text-fg-subtle uppercase">Outcome</dt>
                  <dd className="font-sans text-xs">
                    {frame.forced && <span className="mr-2 text-warn">forced — no candidate cleared ω</span>}
                    {frame.used ? (
                      <span className="text-ok">composited</span>
                    ) : (
                      <span className="text-bad">rejected in MATCH{step?.rejectReason ? ` (${step.rejectReason})` : ""}</span>
                    )}
                    {step && (
                      <Link href={`/runs/${r.run.id}/results?step=${step.step}`} className="ml-2 text-accent hover:underline">
                        step {step.step} →
                      </Link>
                    )}
                  </dd>
                </div>
              </dl>
              {candidates.length > 0 && (
                <div className="mt-3">
                  <div className="text-2xs tracking-wide text-fg-subtle uppercase">Candidates probed from {fmtFrame(prev!.frameIndex)}</div>
                  <table className="num mt-1 w-full text-xs">
                    <thead className="text-2xs text-fg-subtle">
                      <tr className="[&>th]:py-1 [&>th]:text-left [&>th]:font-medium">
                        <th>gap</th>
                        <th>target</th>
                        <th>f_m</th>
                        <th>≥ ω</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr key={c.to} className={cn("[&>td]:py-0.5", c.chosen && "text-fg", !c.chosen && "text-fg-muted")}>
                          <td>{c.gap}</td>
                          <td>{fmtFrame(c.to)}</td>
                          <td className={c.passed ? "" : "text-fg-subtle"}>{fmtRatio(c.fm)}</td>
                          <td>{c.passed ? "yes" : <span className="text-fg-subtle">no</span>}</td>
                          <td>{c.chosen && <span className={c.passed ? "text-accent" : "text-warn"}>{c.passed ? "← chosen (largest passing)" : "← forced"}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-2xs text-fg-subtle">← / → step through selected frames · Esc clears</p>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Figure className="lg:col-span-5" spec={specs.hist} run={r.run} file="gap_histogram" height={230} />
        <Figure className="lg:col-span-7" spec={specs.scatter} run={r.run} file="fm_vs_omega" height={230} onPick={pickFrame} selectedKey={selected} aboutId="param-omega" />
      </div>
    </div>
  );
}
