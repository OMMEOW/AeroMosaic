"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import type { RunMetrics } from "@/services";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Figure } from "@/components/charts/Figure";
import { stageRuntimeSpec } from "@/components/charts/runCharts";
import { download } from "@/lib/export/runExports";
import { fmtDuration, fmtFrame, fmtInt, fmtPct, fmtRatio, fmtScale, fmtScaleDev, fmtShear } from "@/lib/format";
import { driftLevel } from "@/lib/metrics";
import { IconAlert, IconChevron, IconDownload } from "@/components/ui/icons";
import { MetricLabel } from "@/components/ui/MetricLabel";
import { Copyable } from "@/components/ui/misc";
import { Banner, Button, cn, Panel } from "@/components/ui/primitives";
import { Filmstrip } from "./Filmstrip";
import { MosaicViewer } from "./MosaicViewer";
import { useReadyRun } from "./RunDataContext";
import { StepsTableFull } from "./StepsTableFull";

function Row({ label, children, sub }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="num text-right text-sm text-fg">
        {children}
        {sub && <div className="text-2xs text-fg-subtle">{sub}</div>}
      </dd>
    </div>
  );
}

const DRIFT_BADGE = {
  ok: { cls: "bg-ok-soft text-ok", label: "within band" },
  elevated: { cls: "bg-warn-soft text-warn", label: "elevated" },
  diverged: { cls: "bg-bad-soft text-bad", label: "diverged" },
};

function PrimaryMetrics({ m }: { m: RunMetrics }) {
  const level = driftLevel(m);
  return (
    <div className="flex flex-col">
      {/* Headline: ground coverage */}
      <div className="border-b border-line p-4">
        <div className="flex items-center justify-between gap-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
          <MetricLabel id="coverage" />
          {m.referenceChainBreaks > 0 && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-warn-soft px-1.5 py-0.5 text-warn normal-case" title="Coverage denominator unreliable">
              <IconAlert size={11} /> {m.referenceChainBreaks} reference chain break{m.referenceChainBreaks > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="num mt-1 text-[3rem] leading-none tracking-tight text-fg">
          <Copyable value={m.groundCoverage} label="ground coverage">
            {fmtPct(m.groundCoverage)}
          </Copyable>
        </div>
        {m.referenceChainBreaks > 0 && (
          <p className="mt-2 text-xs text-warn">The reference used as the denominator has breaks; treat this percentage as unreliable.</p>
        )}
        {/* Fill ratio is never shown without coverage beside it. */}
        <div className="mt-3 flex items-baseline justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
          <span className="text-fg-muted">
            <MetricLabel id="fill" /> <span className="text-warn">· not a quality score</span>
          </span>
          <span className="num text-fg-muted">{fmtPct(m.fillRatio)}</span>
        </div>
      </div>
      <dl className="px-4 py-2">
        <Row label={<MetricLabel id="frames" />} sub={`${fmtPct(1 - m.framesSelected / m.nativeFrames)} reduction`}>
          <Copyable value={m.framesSelected}>{fmtInt(m.framesSelected)}</Copyable>
          <span className="text-fg-subtle"> / {fmtInt(m.nativeFrames)}</span>
        </Row>
        <Row label={<MetricLabel id="accept-rate" />} sub={`${m.stepsAccepted} / ${m.stepsAttempted} steps`}>
          <Copyable value={m.acceptRate}>{fmtPct(m.acceptRate)}</Copyable>
        </Row>
        <Row label={<MetricLabel id="g-scale" />} sub={`ideal 1.0 · deviation ${fmtScaleDev(m.drift.gScale)}`}>
          <Copyable value={m.drift.gScale}>{fmtScale(m.drift.gScale)}</Copyable>
        </Row>
        <Row label={<MetricLabel id="g-shear" />} sub="ideal 0.0">
          <Copyable value={m.drift.gShear}>{fmtShear(m.drift.gShear)}</Copyable>
        </Row>
        <div className="flex items-center justify-between gap-2 pt-2 text-xs">
          <span className="text-fg-muted">Drift</span>
          <span className={cn("rounded-sm px-1.5 py-0.5 text-2xs font-medium uppercase", DRIFT_BADGE[level].cls)} title="Display heuristic: |G_scale−1| > 4% or |G_shear| > 0.02 elevated; > 10% or > 0.05 diverged. Not a pipeline threshold.">
            {DRIFT_BADGE[level].label}
          </span>
        </div>
      </dl>
    </div>
  );
}

function SecondaryMetrics({ m }: { m: RunMetrics }) {
  const ratio = m.match.msPerPair / Math.max(0.001, m.probe.msPerPair);
  return (
    <div className="grid gap-x-6 gap-y-1 p-4 md:grid-cols-2">
      <dl>
        <Row label={<MetricLabel id="runtime" />}>
          <Copyable value={m.runtimeMs}>{fmtDuration(m.runtimeMs)}</Copyable>
        </Row>
        <Row label={<MetricLabel id="match-per-pair" />} sub={`${m.match.pairs} pairs · ${fmtDuration(m.match.totalMs)} total`}>
          {fmtDuration(m.match.msPerPair)}
        </Row>
        <Row label={<MetricLabel id="probe-per-pair" />} sub={`${fmtInt(m.probe.pairs)} pairs · ${fmtDuration(m.probe.totalMs)} total`}>
          {m.probe.msPerPair.toFixed(1)} ms
        </Row>
        <Row label={<MetricLabel id="forced" />}>
          <span className={m.forcedSteps > 0 ? "text-warn" : ""}>{fmtInt(m.forcedSteps)}</span>
        </Row>
        {m.forcedSteps > 0 && <p className="pb-2 text-xs text-warn">Non-zero: the footage has segments no candidate pair could register.</p>}
        <Row label={<MetricLabel id="canvas" />}>
          <Copyable value={`${m.canvas.width}x${m.canvas.height}`}>
            {fmtInt(m.canvas.width)}×{fmtInt(m.canvas.height)}
          </Copyable>
          <span className="text-fg-subtle"> · {m.canvas.megapixels.toFixed(2)} MP</span>
        </Row>
        <Row label={<MetricLabel id="ref-breaks" />}>
          <span className={m.referenceChainBreaks > 0 ? "text-warn" : ""}>{m.referenceChainBreaks}</span>
        </Row>
      </dl>
      <div>
        <div className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">Probe cost vs matcher cost (per pair)</div>
        <div className="mt-2 space-y-2 text-xs">
          {[
            { label: "PROBE · SIFT", v: m.probe.msPerPair },
            { label: "MATCH · DKM", v: m.match.msPerPair },
          ].map((r) => (
            <div key={r.label}>
              <div className="num flex justify-between text-fg-muted">
                <span>{r.label}</span>
                <span className="text-fg">{r.v < 1000 ? `${r.v.toFixed(1)} ms` : fmtDuration(r.v)}</span>
              </div>
              <div className="mt-1 h-2 rounded-sm bg-surface-3">
                <div className="h-full rounded-sm bg-series-1" style={{ width: `${Math.max(0.6, (r.v / m.match.msPerPair) * 100)}%` }} />
              </div>
            </div>
          ))}
          <p className="text-fg-muted">
            One dense match costs as much as <span className="num text-fg">{fmtInt(ratio)}</span> probes. Matching all{" "}
            <span className="num text-fg">{fmtInt(m.nativeFrames - 1)}</span> consecutive pairs would take ≈{" "}
            <span className="num text-fg">{fmtDuration((m.nativeFrames - 1) * m.match.msPerPair)}</span> at this rate, versus{" "}
            <span className="num text-fg">{fmtDuration(m.match.totalMs + m.probe.totalMs)}</span> for probe + match here.
          </p>
        </div>
      </div>
    </div>
  );
}

function CaveatedQuality({ m }: { m: RunMetrics }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-warn/30 bg-surface-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <IconChevron size={12} className={cn("text-fg-subtle transition-transform", open && "rotate-90")} />
        <span className="text-xs font-medium tracking-wide text-fg-muted uppercase">Pairwise quality</span>
        <span className="text-xs text-warn">not comparable across runs</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line p-4 md:grid-cols-[1fr_2fr]">
          <dl>
            <Row label={<MetricLabel id="psnr" />} sub={`${m.pairwiseQuality.stepsMeasured} accepted steps`}>
              {m.pairwiseQuality.psnrDb.toFixed(2)} dB
            </Row>
            <Row label={<MetricLabel id="ssim" />}>{fmtRatio(m.pairwiseQuality.ssim)}</Row>
          </dl>
          <p className="text-xs text-fg-muted">
            PSNR and SSIM are computed on each pair&apos;s overlap region and averaged over <em>accepted steps only</em>. Wider frame gaps
            change which pixels are measured, so these numbers are not comparable between runs with different frame counts. Use them
            to compare steps within this run, not runs with each other.{" "}
            <Link className="text-accent hover:underline" href="/about#metric-psnr">
              Methodology
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

export function ResultsOverview() {
  const data = useReadyRun();
  const sp = useSearchParams();
  const highlight = sp.get("step") ? Number(sp.get("step")) : null;
  const viewer = useRef<{ fit: () => void; oneToOne: () => void; zoomBy: (f: number) => void } | null>(null);
  useHotkeys([
    { key: "f", description: "Mosaic: zoom to fit", scope: "Results", handler: () => viewer.current?.fit() },
    { key: "1", description: "Mosaic: zoom 1:1", scope: "Results", handler: () => viewer.current?.oneToOne() },
    { key: "+", description: "Mosaic: zoom in", scope: "Results", handler: () => viewer.current?.zoomBy(1.5) },
    { key: "=", description: "Mosaic: zoom in", scope: "Results", handler: () => viewer.current?.zoomBy(1.5) },
    { key: "-", description: "Mosaic: zoom out", scope: "Results", handler: () => viewer.current?.zoomBy(1 / 1.5) },
  ]);
  if (!data) return null;
  const { result } = data;
  const m = result.metrics;
  const run = result.run;

  return (
    <div className="flex flex-col gap-3">
      {m.terminatedEarly && (
        <Banner tone="warn" icon={<IconAlert />} title={`Chain lost at ${fmtFrame(m.terminatedEarly.atFrame)} — run terminated early`}>
          {m.terminatedEarly.reason}. Frames after this point were never registered. The canvas is small, so fill ratio looks high; read
          ground coverage instead.
        </Banner>
      )}
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-8">
          <MosaicViewer
            src={result.mosaic.url}
            width={result.mosaic.width}
            height={result.mosaic.height}
            label={`Mosaic for ${run.id}`}
            className="h-[300px] sm:h-[420px] lg:h-[520px]"
            actionsRef={viewer}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Button size="sm" variant="secondary" icon={<IconDownload size={12} />} onClick={() => download.mosaic(run, result.mosaic.downloadUrl, "full")}>
              Full-res PNG
            </Button>
            <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => download.mosaic(run, result.mosaic.preview.url, "preview")}>
              Preview PNG
            </Button>
            <span className="num ml-auto text-2xs text-fg-subtle">F fit · 1 1:1 · +/− zoom · drag to pan</span>
          </div>
        </div>
        <Panel title="Primary metrics" className="lg:col-span-4">
          <PrimaryMetrics m={m} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Secondary metrics" className="lg:col-span-7">
          <SecondaryMetrics m={m} />
        </Panel>
        <Figure className="lg:col-span-5" spec={stageRuntimeSpec(m)} run={run} file="runtime_by_stage" height={200} aboutId="metric-runtime" />
      </div>

      <CaveatedQuality m={m} />

      <Panel
        title={`Selected frames · ${result.frames.length}`}
        actions={
          <span className="num text-2xs text-fg-subtle">
            <Link className="text-accent hover:underline" href={`/runs/${run.id}/selection`}>
              why these frames →
            </Link>
          </span>
        }
      >
        <Filmstrip frames={result.frames} runId={run.id} />
      </Panel>

      <Panel
        title="Per-step results"
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => download.stepsCsv(run, result.steps)}>
              CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => download.stepsJson(run, result.steps)}>
              JSON
            </Button>
          </>
        }
      >
        <StepsTableFull steps={result.steps} highlight={highlight} />
      </Panel>
    </div>
  );
}
