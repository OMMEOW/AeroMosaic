import type { RunMetrics } from "@/services";
import { fmtDuration, fmtInt, fmtPct, fmtSigned } from "./format";

/**
 * Single registry of run metrics: labels, meaning, trust level, and how to format and
 * compare them. Results, Compare, History, Report and Methodology all read from here.
 *
 * Every metric here is a field of metrics.json, which the backend computes with the
 * notebook's own code. Nothing is derived that the pipeline does not compute. Deliberately
 * absent: the old canvas-fill metric (measurably wrong; replaced by absolute coverage) and
 * PSNR/SSIM (not computed by this pipeline — see Methodology).
 *
 * `get` returns null when a value was not measured; the UI shows "—", never 0.
 */
export type Trust = "primary" | "secondary";

/** How a delta between two runs should be judged. */
export type Direction = "higher" | "lower" | "neutral";

export interface MetricDef {
  id: string;
  label: string;
  trust: Trust;
  direction: Direction;
  summary: string;
  caveat?: string;
  get: (m: RunMetrics) => number | null;
  format: (v: number) => string;
  delta: (d: number) => string;
  comparable: boolean;
}

export const aboutHref = (id: string) => `/about#metric-${id}`;

export const METRICS: MetricDef[] = [
  {
    id: "coverage",
    label: "Absolute coverage",
    trust: "primary",
    direction: "higher",
    summary: "|A_method ∩ A_observed| / |A_observed|: the share of the ground the camera observed that the mosaic covers, both placed by the reference chain.",
    caveat: "Unsound for a run whose reference chain has breaks (A_observed is then not continuous).",
    get: (m) => m.absoluteCoverage,
    format: (v) => fmtPct(v, 2),
    delta: (d) => fmtSigned(d * 100, 2, " pp"),
    comparable: true,
  },
  {
    id: "composited",
    label: "Frames composited",
    trust: "primary",
    direction: "neutral",
    summary: "Frames placed in the mosaic: frame 0 plus every accepted DKM step.",
    get: (m) => m.stage2.nComposited,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "dkm-attempts",
    label: "DKM attempts",
    trust: "primary",
    direction: "lower",
    summary: "Pairs sent to DKM, including rejected ones (each rejection bans the edge and re-plans). The expensive calls.",
    get: (m) => m.stage2.attempts,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "dkm-accept",
    label: "DKM accept rate",
    trust: "primary",
    direction: "higher",
    summary: "Accepted / attempted DKM pairs (inlier ratio ≥ 0.35 after the dual-layer constraint).",
    get: (m) => (m.stage2.attempts ? m.stage2.accepted / m.stage2.attempts : null),
    format: (v) => fmtPct(v),
    delta: (d) => fmtSigned(d * 100, 1, " pp"),
    comparable: true,
  },
  {
    id: "chain-breaks",
    label: "Reference chain breaks",
    trust: "primary",
    direction: "lower",
    summary: "Consecutive frames the SIFT-4000 reference chain could not register. > 0 makes the coverage denominator unsound.",
    get: (m) => m.referenceChainBreaks,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "candidate-edges",
    label: "Candidate edges probed",
    trust: "secondary",
    direction: "neutral",
    summary: "Σ over gaps of (n − g): the search space the cheap SIFT probe evaluates. Not cost avoided.",
    get: (m) => m.stage1.candidateEdges,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: false,
  },
  {
    id: "passing-edges",
    label: "Edges passing the gate",
    trust: "secondary",
    direction: "neutral",
    summary: "Candidate edges with proxy IoU ≥ 0.40 and f_m ≥ 0.164.",
    get: (m) => m.stage1.passing,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: false,
  },
  {
    id: "ms-per-attempt",
    label: "Time per DKM attempt",
    trust: "secondary",
    direction: "lower",
    summary: "Measured mean wall time per DKM attempt (match + dual-layer + residuals) on this machine.",
    get: (m) => m.stage2.msPerAttempt,
    format: (v) => fmtDuration(v),
    delta: (d) => fmtSigned(d / 1000, 2, " s"),
    comparable: true,
  },
  {
    id: "runtime",
    label: "Total runtime",
    trust: "secondary",
    direction: "lower",
    summary: "Wall time of the worker from preflight to coverage. Includes decode (possibly cached).",
    get: (m) => m.runtimeMs,
    format: (v) => fmtDuration(v),
    delta: (d) => fmtSigned(d / 1000, 1, " s"),
    comparable: true,
  },
  {
    id: "seam-fallback",
    label: "Seam fallback steps",
    trust: "secondary",
    direction: "lower",
    summary: "Steps composed first-wins instead of by the chosen variant (overlap < 50 px, or the seam network failed on that step). Notebook behaviour, surfaced.",
    get: (m) => m.composition.seamFallbackSteps,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
];

export const metricById = (id: string) => METRICS.find((m) => m.id === id)!;

/** -1 worse, 0 neutral/equal, 1 better. */
export function judgeDelta(def: MetricDef, base: number, value: number): -1 | 0 | 1 {
  if (!def.comparable || def.direction === "neutral" || value === base) return 0;
  const better = def.direction === "higher" ? value > base : value < base;
  return better ? 1 : -1;
}
