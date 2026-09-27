import type { CandidateEdge, DkmAttempt, RunMetrics, StageId } from "@/services";
import { fmtDuration } from "@/lib/format";
import { CAUSE_META } from "@/components/pairs/cause";
import { SERIES, type ChartSpec, type Pt } from "./chartSpec";

/** Figures derived from run records. Each returns a ChartSpec; Figure renders and exports it. */

const intFmt = (v: number) => String(Math.round(v));
const pairLabel = (r: { frameI: number; frameJ: number }) => `${r.frameI}→${r.frameJ}`;

/** Stage 1: how every candidate edge at each gap was decided. */
export function edgesByGapSpec(edges: CandidateEdge[], gaps: number[]): ChartSpec {
  const count = (pred: (e: CandidateEdge) => boolean) =>
    gaps.map((g, i) => ({ x: i, y: edges.filter((e) => e.gap === g && pred(e)).length, label: `gap ${g}` }));
  return {
    title: "Candidate edges by gap and outcome",
    caption: "Stage 1. Each edge (i, i+g) is probed once with SIFT-500; causes follow the notebook's check order (proxy fit, IoU, then f_m).",
    x: { label: "gap", categories: gaps.map(String) },
    y: { label: "edges", format: intFmt },
    series: [
      { id: "pass", label: "pass gate", color: "var(--ok)", kind: "bars", points: count((e) => !e.rejectCause), format: intFmt },
      { id: "iou", label: CAUSE_META.GATE_IOU.label, color: "var(--warn)", kind: "bars", points: count((e) => e.rejectCause === "GATE_IOU"), format: intFmt },
      { id: "fm", label: CAUSE_META.GATE_FM.label, color: SERIES[0], kind: "bars", points: count((e) => e.rejectCause === "GATE_FM"), format: intFmt },
      {
        id: "proxy",
        label: CAUSE_META.PROXY_FIT_FAILED.label,
        color: "var(--fg-subtle)",
        kind: "bars",
        points: count((e) => e.rejectCause === "PROXY_FIT_FAILED"),
        format: intFmt,
      },
    ],
  };
}

/** Stage 1: f_m against proxy IoU for every edge where both were measured. */
export function fmIouSpec(edges: CandidateEdge[], omega: number, iouTrust: number): ChartSpec {
  const pts = (pred: (e: CandidateEdge) => boolean): Pt[] =>
    edges
      .filter((e) => e.fm != null && e.proxyIou != null && pred(e))
      .map((e) => ({ x: e.fm!, y: e.proxyIou!, label: `${pairLabel(e)} · gap ${e.gap}`, key: `${e.frameI}-${e.frameJ}` }));
  const unmeasured = edges.filter((e) => e.fm == null || e.proxyIou == null).length;
  return {
    title: "f_m against proxy IoU",
    caption: `Kept iff IoU ≥ ${iouTrust} and f_m ≥ ${omega}. Points in the lower-right were rejected by IoU although f_m would pass.${
      unmeasured ? ` ${unmeasured} edges without a fitted proxy are not plotted.` : ""
    }`,
    x: { label: "f_m (putative / 500)", domain: [0, 1], format: (v) => v.toFixed(2) },
    y: { label: "proxy IoU", domain: [0, 1], format: (v) => v.toFixed(2) },
    series: [
      { id: "pass", label: "pass gate", color: "var(--ok)", kind: "dots", points: pts((e) => !e.rejectCause) },
      { id: "iou", label: CAUSE_META.GATE_IOU.label, color: "var(--warn)", kind: "dots", points: pts((e) => e.rejectCause === "GATE_IOU") },
      { id: "fm", label: CAUSE_META.GATE_FM.label, color: SERIES[0], kind: "dots", hollow: true, points: pts((e) => e.rejectCause === "GATE_FM") },
    ],
    refs: [
      { axis: "x", value: omega, label: `ω ${omega}`, kind: "threshold" },
      { axis: "y", value: iouTrust, label: `IoU ${iouTrust}`, kind: "threshold" },
    ],
  };
}

/** Stage 2: inlier ratio per DKM attempt. */
export function attemptRatioSpec(attempts: DkmAttempt[], minRatio: number): ChartSpec {
  return {
    title: "DKM inlier ratio per attempt",
    caption: `Inliers (τr 4.0) over post-epipolar matches. Accepted iff ≥ ${minRatio}. Attempts with no homography have no ratio and are not drawn.`,
    x: { label: "attempt", format: intFmt },
    y: { label: "inlier ratio", domain: [0, 1], format: (v) => v.toFixed(2) },
    series: [
      {
        id: "ratio",
        label: "inlier ratio",
        color: SERIES[0],
        kind: "bars",
        hideInLegend: true,
        points: attempts
          .filter((a) => a.inlierRatio != null)
          .map((a) => ({
            x: a.attempt,
            y: a.inlierRatio!,
            tone: a.accepted ? undefined : "bad",
            label: `${pairLabel(a)} · gap ${a.gap}${a.accepted ? "" : " · rejected"}${a.replanned ? " · re-planned" : ""}`,
            key: a.attempt,
          })),
        format: (v) => v.toFixed(3),
      },
    ],
    refs: [{ axis: "y", value: minRatio, label: `accept ≥ ${minRatio}`, kind: "threshold" }],
    legendExtras: [
      { label: "accepted", color: SERIES[0], shape: "rect" },
      { label: "rejected", color: "var(--bad)", shape: "rect" },
    ],
  };
}

/** Stage 2: measured wall time per attempt. */
export function attemptTimeSpec(attempts: DkmAttempt[]): ChartSpec {
  return {
    title: "DKM time per attempt",
    caption: "Measured wall time: DKM match + dual-layer constraint + residual fields.",
    x: { label: "attempt", format: intFmt },
    y: { label: "seconds", format: (v) => v.toFixed(1) },
    series: [
      {
        id: "t",
        label: "time",
        color: SERIES[1],
        kind: "bars",
        hideInLegend: true,
        points: attempts.map((a) => ({ x: a.attempt, y: a.durationMs / 1000, tone: a.accepted ? undefined : "bad", label: pairLabel(a), key: a.attempt })),
        format: (v) => fmtDuration(v * 1000),
      },
    ],
  };
}

/** Wall time per stage (cached stages are marked). */
export function stageTimeSpec(m: RunMetrics, order: readonly StageId[], label: (id: StageId) => string): ChartSpec {
  const ids = order.filter((id) => m.stageMs[id] != null);
  return {
    title: "Wall time per stage",
    caption: "Measured by the worker. Decode and SIFT-500 marked 'cached' were served from the shared per-video cache.",
    x: { label: "stage", categories: ids.map((id) => `${label(id)}${m.stageCached[id] ? " (cached)" : ""}`) },
    y: { label: "seconds", format: (v) => v.toFixed(1) },
    series: [
      {
        id: "t",
        label: "time",
        color: SERIES[0],
        kind: "bars",
        hideInLegend: true,
        points: ids.map((id, i) => ({ x: i, y: (m.stageMs[id] ?? 0) / 1000, tone: m.stageCached[id] ? "muted" : undefined, label: label(id) })),
        format: (v) => fmtDuration(v * 1000),
      },
    ],
  };
}
