"use client";

import { useRef } from "react";
import { getPipelineService, STAGE_ORDER, type RunMetrics } from "@/services";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Figure } from "@/components/charts/Figure";
import { stageTimeSpec } from "@/components/charts/runCharts";
import { fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { IconAlert } from "@/components/ui/icons";
import { MetricLabel } from "@/components/ui/MetricLabel";
import { Copyable } from "@/components/ui/misc";
import { Panel } from "@/components/ui/primitives";
import { CauseBadge, STAGE1_CAUSES, STAGE2_CAUSES } from "@/components/pairs/cause";
import { SavingsPanel } from "@/components/run/SavingsPanel";
import { STAGE_META } from "@/components/run/StageStepper";
import { Filmstrip } from "./Filmstrip";
import { MosaicViewer } from "./MosaicViewer";
import { useReadyRun } from "./RunDataContext";

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

function Headline({ m }: { m: RunMetrics }) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-line p-4">
        <div className="flex items-center justify-between gap-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
          <MetricLabel id="coverage" />
          {m.referenceChainBreaks > 0 && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-warn-soft px-1.5 py-0.5 text-warn normal-case">
              <IconAlert size={11} /> {m.referenceChainBreaks} reference chain break{m.referenceChainBreaks > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="num mt-1 text-[3rem] leading-none tracking-tight text-fg">
          <Copyable value={m.absoluteCoverage} label="absolute coverage">
            {fmtPct(m.absoluteCoverage, 2)}
          </Copyable>
        </div>
        <p className="num mt-1 text-2xs text-fg-subtle">of A_observed = {fmtInt(m.observedAreaPx)} px (fixed per-run denominator, reference chain)</p>
        {m.referenceChainBreaks > 0 && <p className="mt-2 text-xs text-warn">The denominator has breaks; treat this percentage as unsound.</p>}
      </div>
      <dl className="px-4 py-2">
        <Row label={<MetricLabel id="composited" />} sub={m.stage2.reachedLast ? "chain reached the last frame" : `chain stopped at frame ${m.stage2.lastFrame}`}>
          {fmtInt(m.stage2.nComposited)}
          <span className="text-fg-subtle"> / {fmtInt(m.nativeFrames)} native</span>
        </Row>
        <Row label={<MetricLabel id="dkm-attempts" />} sub={`${m.stage2.accepted} accepted`}>
          {fmtInt(m.stage2.attempts)}
        </Row>
        <Row label="Stage-2 rejects">
          <span className="inline-flex flex-wrap justify-end gap-1">
            {STAGE2_CAUSES.map((c) => (
              <CauseBadge key={c} cause={c}>
                {m.stage2.rejects[c]}
              </CauseBadge>
            ))}
          </span>
        </Row>
        <Row label={<MetricLabel id="passing-edges" />} sub={`of ${fmtInt(m.stage1.candidateEdges)} candidates`}>
          {fmtInt(m.stage1.passing)}
        </Row>
        <Row label="Stage-1 rejects">
          <span className="inline-flex flex-wrap justify-end gap-1">
            {STAGE1_CAUSES.map((c) => (
              <CauseBadge key={c} cause={c}>
                {m.stage1.rejects[c].toLocaleString()}
              </CauseBadge>
            ))}
          </span>
        </Row>
        <Row label={<MetricLabel id="seam-fallback" />} sub={`variant ${m.composition.variantName}`}>
          <span className={m.composition.seamFallbackSteps && m.composition.variant !== "firstwins" ? "text-warn" : ""}>{fmtInt(m.composition.seamFallbackSteps)}</span>
        </Row>
      </dl>
    </div>
  );
}

export function ResultsOverview() {
  const state = useReadyRun();
  const { run } = state;
  const m = run.metrics!;
  const viewer = useRef<{ fit: () => void; oneToOne: () => void; zoomBy: (f: number) => void } | null>(null);
  useHotkeys([
    { key: "f", description: "Fit mosaic", scope: "Results", handler: () => viewer.current?.fit() },
    { key: "1", description: "Mosaic at 1:1", scope: "Results", handler: () => viewer.current?.oneToOne() },
    { key: "+", description: "Zoom in", scope: "Results", handler: () => viewer.current?.zoomBy(1.25) },
    { key: "-", description: "Zoom out", scope: "Results", handler: () => viewer.current?.zoomBy(0.8) },
  ]);
  const svc = getPipelineService();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          title={`Mosaic · ${m.composition.variantName}`}
          className="h-[420px] lg:col-span-8 lg:h-[560px]"
          actions={
            <span className="num text-2xs text-fg-subtle">
              {fmtInt(m.composition.mosaicWidth)}×{fmtInt(m.composition.mosaicHeight)}
            </span>
          }
        >
          <MosaicViewer
            src={svc.url(`/api/runs/${encodeURIComponent(run.id)}/mosaic.png`)}
            width={m.composition.mosaicWidth}
            height={m.composition.mosaicHeight}
            label={`Mosaic of ${run.video.filename}, ${m.composition.variantName}`}
            actionsRef={viewer}
            className="h-full"
          />
        </Panel>
        <Panel title="Primary" className="lg:col-span-4">
          <Headline m={m} />
        </Panel>
      </div>
      <Panel title={`Composited frames · ${m.stage2.nComposited}`}>
        <Filmstrip frames={m.stage2.composited} runId={run.id} fps={m.fps} />
      </Panel>
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Selection saving" className="lg:col-span-7">
          <SavingsPanel metrics={m} selection={state.selection} />
        </Panel>
        <Panel title="Runtime" className="lg:col-span-5" bodyClassName="p-3">
          <dl>
            <Row label={<MetricLabel id="runtime" />}>{fmtDuration(m.runtimeMs)}</Row>
            <Row label={<MetricLabel id="ms-per-attempt" />} sub={`${m.stage2.attempts} attempts · DKM ${fmtDuration(m.stage2.dkmMs)}`}>
              {fmtDuration(m.stage2.msPerAttempt)}
            </Row>
            <Row label="Probe per candidate edge" sub={`${fmtInt(m.stage1.probed)} edges · ${fmtDuration(m.stage1.probeMs)}`}>
              {m.stage1.msPerProbe != null ? `${m.stage1.msPerProbe.toFixed(2)} ms` : "—"}
            </Row>
            <Row label="Device · estimator" sub={`seed ${m.seed}`}>
              {m.device ?? "—"} · {m.stage2.estimator ?? "—"}
            </Row>
          </dl>
        </Panel>
      </div>
      <Figure spec={stageTimeSpec(m, STAGE_ORDER, (id) => STAGE_META[id].label)} run={run} file="stage-times" height={220} />
    </div>
  );
}
