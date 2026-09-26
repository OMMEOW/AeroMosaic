import type { RunMetrics } from "@/services";
import { fmtDuration, fmtInt, fmtPct, fmtRatio, fmtScale, fmtScaleDev, fmtShear, fmtSigned } from "./format";

/**
 * Single registry of run metrics: labels, meaning, trust level, and how to
 * format and compare them. Results, Compare, History, Report and the About
 * page all read from here so a metric means the same thing everywhere.
 */
export type Trust = "primary" | "secondary" | "caveat";

/** How a delta between two runs should be judged. */
export type Direction = "higher" | "lower" | "toward-one" | "toward-zero" | "neutral";

export interface MetricDef {
  id: string;
  label: string;
  trust: Trust;
  direction: Direction;
  /** One-line meaning, used in tooltips. */
  summary: string;
  /** Why this metric misleads, for caveated metrics. */
  caveat?: string;
  get: (m: RunMetrics) => number;
  format: (v: number) => string;
  /** Delta formatting for Compare. */
  delta: (d: number) => string;
  /** Unit-less comparability: false ⇒ Compare shows the value but no judged delta. */
  comparable: boolean;
}

export const aboutHref = (id: string) => `/about#metric-${id}`;

export const METRICS: MetricDef[] = [
  {
    id: "coverage",
    label: "Ground coverage",
    trust: "primary",
    direction: "higher",
    summary: "Fraction of the ground the camera observed that made it into the mosaic, against a fixed independent reference.",
    get: (m) => m.groundCoverage,
    format: (v) => fmtPct(v),
    delta: (d) => fmtSigned(d * 100, 1, " pp"),
    comparable: true,
  },
  {
    id: "frames",
    label: "Frames selected",
    trust: "primary",
    direction: "neutral",
    summary: "Frames kept by SELECT out of the native decoded frames. Fewer means less dense matching.",
    get: (m) => m.framesSelected,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "reduction",
    label: "Frame reduction",
    trust: "primary",
    direction: "neutral",
    summary: "1 − selected / native. How much dense matching SELECT avoided.",
    get: (m) => 1 - m.framesSelected / m.nativeFrames,
    format: (v) => fmtPct(v),
    delta: (d) => fmtSigned(d * 100, 1, " pp"),
    comparable: true,
  },
  {
    id: "accept-rate",
    label: "Accept rate",
    trust: "primary",
    direction: "higher",
    summary: "Accepted registration steps / attempted steps.",
    get: (m) => m.acceptRate,
    format: (v) => fmtPct(v),
    delta: (d) => fmtSigned(d * 100, 1, " pp"),
    comparable: true,
  },
  {
    id: "g-scale",
    label: "G_scale (drift)",
    trust: "primary",
    direction: "toward-one",
    summary: "Accumulated chain scale at the last step. Ideal 1.0; shown as deviation from ideal.",
    get: (m) => m.drift.gScale,
    format: (v) => `${fmtScale(v)} (${fmtScaleDev(v)})`,
    delta: (d) => fmtSigned(d, 4),
    comparable: true,
  },
  {
    id: "g-shear",
    label: "G_shear (drift)",
    trust: "primary",
    direction: "toward-zero",
    summary: "Accumulated chain shear at the last step. Ideal 0.0; the sign shows direction.",
    get: (m) => m.drift.gShear,
    format: (v) => fmtShear(v),
    delta: (d) => fmtSigned(d, 4),
    comparable: true,
  },
  {
    id: "runtime",
    label: "Total runtime",
    trust: "secondary",
    direction: "lower",
    summary: "Wall time from start of DECODE to end of EVALUATE.",
    get: (m) => m.runtimeMs,
    format: (v) => fmtDuration(v),
    delta: (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtDuration(Math.abs(d))}`,
    comparable: true,
  },
  {
    id: "match-per-pair",
    label: "Mean time per matched pair",
    trust: "secondary",
    direction: "lower",
    summary: "MATCH stage time / dense-matching steps.",
    get: (m) => m.match.msPerPair,
    format: (v) => fmtDuration(v),
    delta: (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtDuration(Math.abs(d))}`,
    comparable: true,
  },
  {
    id: "probe-per-pair",
    label: "Probe time per pair",
    trust: "secondary",
    direction: "lower",
    summary: "PROBE stage time / probed candidate pairs.",
    get: (m) => m.probe.msPerPair,
    format: (v) => `${v.toFixed(1)} ms`,
    delta: (d) => fmtSigned(d, 1, " ms"),
    comparable: true,
  },
  {
    id: "forced",
    label: "Forced steps",
    trust: "secondary",
    direction: "lower",
    summary: "Steps where no candidate cleared ω and the chain fell back. Non-zero ⇒ unregistrable segments.",
    get: (m) => m.forcedSteps,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "ref-breaks",
    label: "Reference chain breaks",
    trust: "secondary",
    direction: "lower",
    summary: "Breaks in the reference used for coverage. > 0 ⇒ the coverage denominator is unreliable.",
    get: (m) => m.referenceChainBreaks,
    format: (v) => fmtInt(v),
    delta: (d) => fmtSigned(d, 0),
    comparable: true,
  },
  {
    id: "canvas",
    label: "Canvas",
    trust: "secondary",
    direction: "neutral",
    summary: "Mosaic canvas size in megapixels.",
    get: (m) => m.canvas.megapixels,
    format: (v) => `${v.toFixed(2)} MP`,
    delta: (d) => fmtSigned(d, 2, " MP"),
    comparable: true,
  },
  {
    id: "fill",
    label: "Fill ratio",
    trust: "caveat",
    direction: "neutral",
    summary: "Filled pixels / canvas pixels.",
    caveat:
      "A run that terminates early produces a small canvas that is easy to fill, so a failed run can score high. Read it only beside ground coverage.",
    get: (m) => m.fillRatio,
    format: (v) => fmtPct(v),
    delta: (d) => fmtSigned(d * 100, 1, " pp"),
    comparable: false,
  },
  {
    id: "psnr",
    label: "Pairwise PSNR",
    trust: "caveat",
    direction: "neutral",
    summary: "Mean PSNR on pairwise overlap regions, accepted steps only.",
    caveat:
      "Measured on each pair's overlap and averaged over accepted steps only. Wider frame gaps change which pixels are measured, so it is not comparable between runs with different frame counts.",
    get: (m) => m.pairwiseQuality.psnrDb,
    format: (v) => `${v.toFixed(2)} dB`,
    delta: (d) => fmtSigned(d, 2, " dB"),
    comparable: false,
  },
  {
    id: "ssim",
    label: "Pairwise SSIM",
    trust: "caveat",
    direction: "neutral",
    summary: "Mean SSIM on pairwise overlap regions, accepted steps only.",
    caveat:
      "Same measurement region problem as PSNR: depends on which frames were selected, so it is not comparable between runs with different frame counts.",
    get: (m) => m.pairwiseQuality.ssim,
    format: (v) => fmtRatio(v),
    delta: (d) => fmtSigned(d, 3),
    comparable: false,
  },
];

export const metricById = (id: string) => METRICS.find((m) => m.id === id)!;

/** +1 better, −1 worse, 0 neutral/equal — for delta colouring in Compare. */
export function judgeDelta(def: MetricDef, base: number, value: number): -1 | 0 | 1 {
  if (!def.comparable || value === base) return 0;
  switch (def.direction) {
    case "higher":
      return value > base ? 1 : -1;
    case "lower":
      return value < base ? 1 : -1;
    case "toward-one":
      return Math.abs(value - 1) < Math.abs(base - 1) ? 1 : -1;
    case "toward-zero":
      return Math.abs(value) < Math.abs(base) ? 1 : -1;
    default:
      return 0;
  }
}

/** Drift status for badges: within display band, elevated, or diverged. */
export function driftLevel(m: Pick<RunMetrics, "drift">): "ok" | "elevated" | "diverged" {
  const s = Math.abs(m.drift.gScale - 1);
  const h = Math.abs(m.drift.gShear);
  if (s > 0.1 || h > 0.05) return "diverged";
  if (s > 0.04 || h > 0.02) return "elevated";
  return "ok";
}

/** Display bands for drift charts. Visual aids only — not pipeline thresholds. */
export const DRIFT_BAND = { scale: 0.05, shear: 0.05 };
