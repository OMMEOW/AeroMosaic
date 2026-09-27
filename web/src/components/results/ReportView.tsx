"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartSvg } from "@/components/charts/ChartSvg";
import { attemptRatioSpec, edgesByGapSpec, fmIouSpec, stageTimeSpec } from "@/components/charts/runCharts";
import { configLine, provenanceOf } from "@/lib/export/provenance";
import { fmtDuration, fmtInt } from "@/lib/format";
import { METRICS } from "@/lib/metrics";
import { getPipelineService, STAGE_ORDER } from "@/services";
import { buttonClass, Button } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/misc";
import { rejectSentence } from "@/components/pairs/cause";
import { SavingsPanel } from "@/components/run/SavingsPanel";
import { STAGE_META } from "@/components/run/StageStepper";
import { LogoMark } from "@/components/brand/Logo";
import { loadRunData, type RunData } from "./RunDataContext";

/**
 * Print-ready report (Print → Save as PDF). Always rendered in the light palette; the app
 * chrome is hidden by the print stylesheet. Every number comes from the run's own files.
 */
export function ReportView({ runId }: { runId: string }) {
  const [data, setData] = useState<RunData>({ state: "loading" });
  const [generatedAt] = useState(() => new Date());
  useEffect(() => {
    let c = false;
    loadRunData(runId).then((d) => !c && setData(d));
    return () => {
      c = true;
    };
  }, [runId]);

  if (data.state === "loading") return <div className="mx-auto mt-6 h-[1100px] max-w-[820px] animate-pulse rounded-md bg-surface-1" aria-busy="true" />;
  if (data.state !== "ready") {
    return (
      <EmptyState
        title={`No report for ${runId}`}
        body={data.state === "error" ? data.message : "Reports are available for succeeded runs only; a failed run's record is on its run page."}
        action={
          <Link href={`/runs/${runId}`} className={buttonClass("secondary")}>
            Run details
          </Link>
        }
      />
    );
  }
  const st = data.run;
  const run = st.run;
  const m = run.metrics!;
  const sel = st.selection!;
  const prov = provenanceOf(run, generatedAt);
  const W = 720;
  const figs = [
    { spec: edgesByGapSpec(st.edges, sel.candidateGaps), h: 220 },
    { spec: fmIouSpec(st.edges, sel.omega, sel.iouTrust), h: 240 },
    { spec: attemptRatioSpec(st.attempts, 0.35), h: 200 },
    { spec: stageTimeSpec(m, STAGE_ORDER, (id) => STAGE_META[id].label), h: 200 },
  ];

  return (
    <div>
      <div className="mx-auto mb-3 flex max-w-[820px] items-center justify-between gap-2 print:hidden">
        <Link href={`/runs/${runId}/results`} className="text-sm text-accent hover:underline">
          ← Back to results
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </div>
      <article data-theme="light" className="report mx-auto max-w-[820px] rounded-md bg-surface-1 p-8 text-fg shadow-pop print:max-w-none print:p-0 print:shadow-none">
        <header className="border-b border-line pb-4">
          <div className="flex items-center gap-2 text-2xs tracking-wider text-fg-subtle uppercase">
            <LogoMark size={18} /> AeroMosaic run report · NB_L2
          </div>
          <h1 className="mt-1 text-xl font-semibold">
            {run.video.filename} <span className="text-sm font-normal text-fg-muted">({run.videoId})</span>
          </h1>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <dt className="text-fg-subtle">Run ID</dt>
            <dd>{run.id}</dd>
            <dt className="text-fg-subtle">Run created</dt>
            <dd>{run.createdAt}</dd>
            <dt className="text-fg-subtle">Report generated</dt>
            <dd>{prov.exportedAt}</dd>
            <dt className="text-fg-subtle">Video</dt>
            <dd>
              {run.video.width}×{run.video.height} @ {run.video.fps?.toFixed(3)} fps · {fmtInt(m.nativeFrames)} decoded frames
            </dd>
            <dt className="text-fg-subtle">Composition</dt>
            <dd>
              {m.composition.variantName}
              {run.semstitch?.used && run.semstitch.sha256 ? ` · SemanticStitch sha256 ${run.semstitch.sha256}` : ""}
            </dd>
            <dt className="text-fg-subtle">Configuration</dt>
            <dd>{configLine(run)}</dd>
          </dl>
        </header>

        <section className="mt-5 break-inside-avoid">
          {/* eslint-disable-next-line @next/next/no-img-element -- backend mosaic preview */}
          <img src={getPipelineService().url(`/api/runs/${encodeURIComponent(run.id)}/mosaic_preview.png`)} alt={`Mosaic ${run.id}`} className="w-full rounded-sm bg-inset" />
          <p className="num mt-1 text-2xs text-fg-subtle">
            Mosaic ({m.composition.variantName}) · full resolution {fmtInt(m.composition.mosaicWidth)}×{fmtInt(m.composition.mosaicHeight)} px
          </p>
        </section>

        {(["primary", "secondary"] as const).map((trust) => (
          <section key={trust} className="mt-5 break-inside-avoid">
            <h2 className="text-sm font-semibold">{trust === "primary" ? "Primary metrics" : "Secondary metrics"}</h2>
            <table className="num mt-2 w-full text-xs">
              <tbody>
                {METRICS.filter((d) => d.trust === trust).map((d) => {
                  const v = d.get(m);
                  return (
                    <tr key={d.id} className="border-b border-line align-top [&>td]:py-1.5">
                      <td className="w-48 font-sans text-fg-muted">{d.label}</td>
                      <td className="w-40">{v == null ? "—" : d.format(v)}</td>
                      <td className="font-sans text-2xs text-fg-subtle">{d.caveat ?? d.summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {trust === "primary" && m.referenceChainBreaks > 0 && (
              <p className="mt-1 text-xs text-warn">Reference chain breaks: {m.referenceChainBreaks}. The coverage denominator is unsound.</p>
            )}
            {trust === "primary" && !m.stage2.reachedLast && (
              <p className="mt-1 text-xs text-warn">
                The chain stopped at frame {m.stage2.lastFrame} of {m.nativeFrames - 1}: no vetted edge was left out of that frame.
              </p>
            )}
          </section>
        ))}

        <section className="mt-5 break-inside-avoid">
          <h2 className="text-sm font-semibold">Selection saving</h2>
          <SavingsPanel metrics={m} selection={sel} />
        </section>

        {figs.map((f) => (
          <section key={f.spec.title} className="mt-5 break-inside-avoid">
            <h2 className="text-sm font-semibold">{f.spec.title}</h2>
            {f.spec.caption && <p className="text-2xs text-fg-subtle">{f.spec.caption}</p>}
            <div className="mt-2 overflow-hidden">
              <ChartSvg spec={f.spec} width={W} height={f.h} />
            </div>
          </section>
        ))}

        <section className="mt-5 break-inside-avoid">
          <h2 className="text-sm font-semibold">Frames</h2>
          <p className="num mt-1 text-2xs break-words text-fg-muted">
            Initial plan ({sel.plannedPath.length}): {sel.plannedPath.join(", ")}
          </p>
          <p className="num mt-1 text-2xs break-words text-fg-muted">
            Composited ({m.stage2.nComposited}): {m.stage2.composited.join(", ")}
          </p>
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-semibold">DKM attempts</h2>
          <table className="num mt-2 w-full text-2xs">
            <thead className="text-fg-subtle">
              <tr className="border-b border-line [&>th]:py-1 [&>th]:text-left [&>th]:font-medium">
                <th>#</th>
                <th>pair</th>
                <th>gap</th>
                <th>f_m</th>
                <th>IoU</th>
                <th>ratio</th>
                <th>inliers / epipolar</th>
                <th>outcome</th>
                <th>time</th>
              </tr>
            </thead>
            <tbody>
              {st.attempts.map((a) => (
                <tr key={a.attempt} className={`border-b border-line/60 [&>td]:py-0.5 ${a.accepted ? "" : "bg-bad-soft"}`}>
                  <td>
                    {a.attempt}
                    {a.replanned ? "↻" : ""}
                  </td>
                  <td>
                    {a.frameI}→{a.frameJ}
                  </td>
                  <td>{a.gap}</td>
                  <td>{a.fm?.toFixed(3) ?? "—"}</td>
                  <td>{a.proxyIou?.toFixed(2) ?? "—"}</td>
                  <td>{a.inlierRatio?.toFixed(3) ?? "—"}</td>
                  <td>
                    {a.nInliers ?? "—"} / {a.nEpipolar ?? "—"}
                  </td>
                  <td className={a.accepted ? "" : "text-bad"}>{a.accepted ? "accepted" : `${a.rejectCause}: ${rejectSentence(a)}`}</td>
                  <td>{fmtDuration(a.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <footer className="num mt-6 border-t border-line pt-2 text-2xs text-fg-subtle">
          {run.id} · {configLine(run)} · generated {prov.exportedAt} · {prov.generator}
        </footer>
      </article>
    </div>
  );
}
