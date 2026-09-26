"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartSvg } from "@/components/charts/ChartSvg";
import { driftScaleSpec, driftShearSpec, fmScatterSpec, inlierSpec, stageRuntimeSpec } from "@/components/charts/runCharts";
import { paramLine, provenanceOf } from "@/lib/export/provenance";
import { fmtDuration, fmtFrame, fmtRatio, fmtScale, fmtShear } from "@/lib/format";
import { METRICS } from "@/lib/metrics";
import { STAGE_ORDER } from "@/services";
import { buttonClass, Button } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/misc";
import { loadRunData, type RunData } from "./RunDataContext";

/**
 * Print-ready report (Print → Save as PDF). Always rendered in the light
 * palette; the app chrome is hidden by the print stylesheet.
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
        body={data.state === "error" ? data.message : "Reports are available for succeeded runs only."}
        action={
          <Link href={`/runs/${runId}`} className={buttonClass("secondary")}>
            Run details
          </Link>
        }
      />
    );
  }
  const r = data.result;
  const m = r.metrics;
  const prov = provenanceOf(r.run, generatedAt);
  const W = 720;
  const figs = [
    { spec: driftScaleSpec(r.steps), h: 220 },
    { spec: driftShearSpec(r.steps), h: 220 },
    { spec: inlierSpec(r.steps), h: 200 },
    { spec: fmScatterSpec(r.selection, m.nativeFrames), h: 220 },
    { spec: stageRuntimeSpec(m), h: 200 },
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
          <div className="text-2xs tracking-wider text-fg-subtle uppercase">UAV mosaicking run report</div>
          <h1 className="mt-1 text-xl font-semibold">{r.run.video.filename}</h1>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <dt className="text-fg-subtle">Run ID</dt>
            <dd>{r.run.id}</dd>
            <dt className="text-fg-subtle">Run created</dt>
            <dd>{r.run.createdAt}</dd>
            <dt className="text-fg-subtle">Report generated</dt>
            <dd>{prov.exportedAt}</dd>
            <dt className="text-fg-subtle">Video</dt>
            <dd>
              {r.run.video.width}×{r.run.video.height} @ {r.run.video.fps} fps · {r.run.video.frameCount} frames · {r.run.video.codec}
            </dd>
            <dt className="text-fg-subtle">Parameters</dt>
            <dd>{paramLine(r.run.params)}</dd>
            <dt className="text-fg-subtle">Backend</dt>
            <dd>{prov.backend}</dd>
          </dl>
        </header>

        <section className="mt-5 break-inside-avoid">
          {/* eslint-disable-next-line @next/next/no-img-element -- service-provided mosaic URL */}
          <img src={r.mosaic.preview.url} alt={`Mosaic ${r.run.id}`} className="w-full rounded-sm bg-inset" />
          <p className="num mt-1 text-2xs text-fg-subtle">
            Mosaic preview · full resolution {r.mosaic.width}×{r.mosaic.height} px ({m.canvas.megapixels.toFixed(2)} MP)
          </p>
        </section>

        {(["primary", "secondary", "caveat"] as const).map((trust) => (
          <section key={trust} className="mt-5 break-inside-avoid">
            <h2 className="text-sm font-semibold">
              {trust === "primary" ? "Primary metrics" : trust === "secondary" ? "Secondary metrics" : "Caveated metrics — read with the notes"}
            </h2>
            <table className="num mt-2 w-full text-xs">
              <tbody>
                {METRICS.filter((d) => d.trust === trust).map((d) => (
                  <tr key={d.id} className="border-b border-line align-top [&>td]:py-1.5">
                    <td className="w-48 font-sans text-fg-muted">{d.label}</td>
                    <td className="w-40">{d.format(d.get(m))}</td>
                    <td className="font-sans text-2xs text-fg-subtle">{d.caveat ?? d.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trust === "primary" && m.referenceChainBreaks > 0 && (
              <p className="mt-1 text-xs text-warn">Reference chain breaks: {m.referenceChainBreaks} — coverage denominator unreliable.</p>
            )}
            {trust === "primary" && m.terminatedEarly && (
              <p className="mt-1 text-xs text-warn">
                Terminated early at {fmtFrame(m.terminatedEarly.atFrame)}: {m.terminatedEarly.reason}.
              </p>
            )}
          </section>
        ))}

        <section className="mt-5 break-inside-avoid">
          <h2 className="text-sm font-semibold">Runtime by stage</h2>
          <p className="num mt-1 text-xs">
            {STAGE_ORDER.map((s) => `${s.toUpperCase()} ${fmtDuration(m.stageRuntimeMs[s])}`).join(" · ")}
          </p>
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
          <h2 className="text-sm font-semibold">Selected native frame indices ({r.frames.length})</h2>
          <p className="num mt-1 text-2xs break-words text-fg-muted">{r.frames.map((f) => f.frameIndex).join(", ")}</p>
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-semibold">Per-step results</h2>
          <div className="overflow-x-auto print:overflow-visible">
          <table className="num mt-2 w-full text-2xs">
            <thead className="text-fg-subtle">
              <tr className="border-b border-line [&>th]:py-1 [&>th]:text-left [&>th]:font-medium">
                <th>#</th>
                <th>pair</th>
                <th>gap</th>
                <th>f_m</th>
                <th>inlier</th>
                <th>n_inl / n_match</th>
                <th>result</th>
                <th>time</th>
                <th>G_scale</th>
                <th>G_shear</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map((s) => (
                <tr key={s.step} className={`border-b border-line/60 [&>td]:py-0.5 ${s.accepted ? "" : "bg-bad-soft"}`}>
                  <td>{s.step}</td>
                  <td>
                    {fmtFrame(s.fromFrame)}→{fmtFrame(s.toFrame)}
                  </td>
                  <td>{s.gap}</td>
                  <td>{fmtRatio(s.fmScore)}</td>
                  <td>{fmtRatio(s.inlierRatio)}</td>
                  <td>
                    {s.nInliers}/{s.nMatches}
                  </td>
                  <td className={s.accepted ? "" : "text-bad"}>{s.accepted ? "accepted" : "rejected"}</td>
                  <td>{fmtDuration(s.durationMs)}</td>
                  <td>{fmtScale(s.gScale)}</td>
                  <td>{fmtShear(s.gShear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
        <footer className="num mt-6 border-t border-line pt-2 text-2xs text-fg-subtle">
          {r.run.id} · {paramLine(r.run.params)} · generated {prov.exportedAt} · {prov.generator}
        </footer>
      </article>
    </div>
  );
}
