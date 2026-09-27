"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Figure } from "@/components/charts/Figure";
import { edgesByGapSpec, fmIouSpec } from "@/components/charts/runCharts";
import { fmtDuration, fmtInt } from "@/lib/format";
import { Panel } from "@/components/ui/primitives";
import { CauseBadge, STAGE1_CAUSES } from "@/components/pairs/cause";
import { EdgesTable } from "@/components/pairs/EdgesTable";
import { useReadyRun } from "./RunDataContext";

/**
 * Stage 1 in full: every candidate edge, why it passed or was dropped, the initial DAG path,
 * and the path DKM actually took after re-planning.
 */
export function SelectionInspector() {
  const state = useReadyRun();
  const { run, selection: sel } = state;
  const m = run.metrics!;
  const frame = Number(useSearchParams().get("frame") ?? NaN);
  const focus = Number.isFinite(frame) ? frame : null;
  const edges = useMemo(() => (focus == null ? state.edges : state.edges.filter((e) => e.frameI === focus || e.frameJ === focus)), [state.edges, focus]);
  if (!sel) return <p className="text-sm text-fg-muted">This run has no selection record.</p>;

  const planned = sel.plannedPath;
  const took = m.stage2.composited;
  const shadow = state.edges.filter((e) => e.rejectCause === "GATE_IOU" && e.fmPasses).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Stage 1 summary" className="lg:col-span-5" bodyClassName="p-3 text-sm">
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-xs text-fg-muted">Candidate edges</dt>
            <dd className="text-right">{fmtInt(sel.candidateEdges)}</dd>
            <dt className="text-xs text-fg-muted">Pass the gate</dt>
            <dd className="text-right">{fmtInt(sel.passing)}</dd>
            <dt className="text-xs text-fg-muted">Gate</dt>
            <dd className="text-right text-xs">
              IoU ≥ {sel.iouTrust} and {sel.gateScore} ≥ {sel.omega}
            </dd>
            <dt className="text-xs text-fg-muted">IoU-rejected where f_m alone would pass</dt>
            <dd className="text-right">{fmtInt(shadow)}</dd>
            <dt className="text-xs text-fg-muted">SIFT-500 describe</dt>
            <dd className="text-right">
              {fmtDuration(sel.describeMs)}
              {sel.describeCached && <span className="text-fg-subtle"> (cached)</span>}
            </dd>
            <dt className="text-xs text-fg-muted">Probe</dt>
            <dd className="text-right">{fmtDuration(sel.probeMs)}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-1">
            {STAGE1_CAUSES.map((c) => (
              <CauseBadge key={c} cause={c}>
                {sel.rejects[c].toLocaleString()}
              </CauseBadge>
            ))}
          </div>
        </Panel>
        <Panel title="Paths" className="lg:col-span-7" bodyClassName="p-3 text-xs">
          <PathRow label="Initial DAG plan" sub="fewest hops, then Σ gap²" path={planned} other={took} />
          <PathRow label="Taken by DKM" sub="after re-planning on rejections" path={took} other={planned} />
          <PathRow label="Greedy (diagnostic)" sub="largest jump each step; not used" path={sel.greedyPath} other={planned} muted />
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Figure spec={edgesByGapSpec(state.edges, sel.candidateGaps)} run={run} file="stage1-edges-by-gap" height={240} />
        <Figure spec={fmIouSpec(state.edges, sel.omega, sel.iouTrust)} run={run} file="stage1-fm-vs-iou" height={240} />
      </div>
      <Panel title={focus == null ? "Candidate edges" : `Candidate edges touching frame ${focus}`}>
        <EdgesTable edges={edges} omega={sel.omega} iouTrust={sel.iouTrust} gaps={sel.candidateGaps} height={440} />
      </Panel>
    </div>
  );
}

function PathRow({ label, sub, path, other, muted }: { label: string; sub: string; path: number[]; other: number[]; muted?: boolean }) {
  const o = new Set(other);
  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className={muted ? "text-fg-muted" : "text-fg"}>{label}</span>
        <span className="num text-2xs text-fg-subtle">
          {path.length} frames · {Math.max(0, path.length - 1)} hops · {sub}
        </span>
      </div>
      <div className="num mt-1 flex flex-wrap gap-1">
        {path.map((f, i) => (
          <span key={f} className={o.has(f) ? "text-fg-muted" : "text-warn"} title={o.has(f) ? undefined : "not in the other path"}>
            {f}
            {i < path.length - 1 && <span className="text-fg-subtle"> →</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
