import { MIN_INLIER_RATIO, STAGE_ORDER, type RunMetrics, type RunResult, type SelectionSummary, type StepResult } from "@/services";
import { fmtDuration, fmtFrame, fmtRatio } from "@/lib/format";
import { DRIFT_BAND } from "@/lib/metrics";
import { SERIES, type ChartSpec, type Pt } from "./chartSpec";

/** Figures derived from run data. Each returns a ChartSpec; Figure renders and exports it. */

const stepLabel = (s: StepResult) => `step ${s.step} · ${fmtFrame(s.fromFrame)} → ${fmtFrame(s.toFrame)}${s.accepted ? "" : " · rejected"}${s.forced ? " · forced" : ""}`;
const intFmt = (v: number) => String(Math.round(v));

export function driftScaleSpec(steps: StepResult[]): ChartSpec {
  return {
    title: "Accumulated scale drift G_scale",
    caption: "Ideal 1.0. A curve that runs away from the band means the chain is diverging.",
    x: { label: "step", format: intFmt },
    y: { label: "G_scale", format: (v) => v.toFixed(3), include: [1] },
    series: [
      {
        id: "gscale",
        label: "G_scale",
        color: SERIES[0],
        kind: "line",
        points: steps.map((s) => ({ x: s.step, y: s.gScale, tone: s.accepted ? undefined : "bad", label: stepLabel(s) })),
        format: (v) => `${v.toFixed(4)} (${v >= 1 ? "+" : "−"}${Math.abs((v - 1) * 100).toFixed(2)}%)`,
      },
    ],
    refs: [{ axis: "y", value: 1, label: "ideal 1.0", kind: "ideal" }],
    band: { y0: 1 - DRIFT_BAND.scale, y1: 1 + DRIFT_BAND.scale, label: `display band ±${DRIFT_BAND.scale * 100}%` },
    legendExtras: steps.some((s) => !s.accepted) ? [{ label: "rejected step", color: "var(--bad)", shape: "dot" }] : undefined,
  };
}

export function driftShearSpec(steps: StepResult[]): ChartSpec {
  return {
    title: "Accumulated shear drift G_shear",
    caption: "Ideal 0.0. Sign shows direction; distance from 0 is the error.",
    x: { label: "step", format: intFmt },
    y: { label: "G_shear", format: (v) => v.toFixed(3), include: [0] },
    series: [
      {
        id: "gshear",
        label: "G_shear",
        color: SERIES[0],
        kind: "line",
        points: steps.map((s) => ({ x: s.step, y: s.gShear, tone: s.accepted ? undefined : "bad", label: stepLabel(s) })),
        format: (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(4),
      },
    ],
    refs: [{ axis: "y", value: 0, label: "ideal 0.0", kind: "ideal" }],
    band: { y0: -DRIFT_BAND.shear, y1: DRIFT_BAND.shear, label: `display band ±${DRIFT_BAND.shear}` },
    legendExtras: steps.some((s) => !s.accepted) ? [{ label: "rejected step", color: "var(--bad)", shape: "dot" }] : undefined,
  };
}

export function inlierSpec(steps: StepResult[]): ChartSpec {
  return {
    title: "Inlier ratio per step",
    caption: `DKM inlier ratio after RANSAC. Steps below ${MIN_INLIER_RATIO.toFixed(2)} are rejected.`,
    x: { label: "step", format: intFmt },
    y: { label: "inlier ratio", domain: [0, 1], format: (v) => v.toFixed(2) },
    series: [
      {
        id: "inlier",
        label: "inlier ratio",
        color: SERIES[0],
        kind: "bars",
        hideInLegend: true,
        points: steps.map((s) => ({ x: s.step, y: s.inlierRatio, tone: s.accepted ? undefined : "bad", label: stepLabel(s), key: s.step })),
        format: (v) => fmtRatio(v),
      },
    ],
    refs: [{ axis: "y", value: MIN_INLIER_RATIO, label: `accept ≥ ${MIN_INLIER_RATIO.toFixed(2)}`, kind: "threshold" }],
    legendExtras: [
      { label: "accepted", color: SERIES[0], shape: "rect" },
      { label: "rejected", color: "var(--bad)", shape: "rect" },
    ],
  };
}

/** Ordinary least squares fit y = a + b·x. */
function trend(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

export function stepDurationSpec(steps: StepResult[]): ChartSpec {
  const pts = steps.map((s) => ({ x: s.step, y: s.durationMs / 1000 }));
  const t = trend(pts);
  const first = steps[0]?.step ?? 0;
  const last = steps[steps.length - 1]?.step ?? 0;
  return {
    title: "Step duration",
    caption: t
      ? `Linear trend ${t.b >= 0 ? "+" : "−"}${Math.abs(t.b * 1000).toFixed(0)} ms per step${t.b > 0 ? " — rising, consistent with canvas growth" : ""}.`
      : undefined,
    x: { label: "step", format: intFmt },
    y: { label: "seconds", format: (v) => v.toFixed(2), include: [0] },
    series: [
      {
        id: "dur",
        label: "step time",
        color: SERIES[0],
        kind: "dots",
        points: steps.map((s) => ({ x: s.step, y: s.durationMs / 1000, tone: s.accepted ? undefined : "bad", label: stepLabel(s) })),
        format: (v) => fmtDuration(v * 1000),
      },
      ...(t
        ? [
            {
              id: "trend",
              label: "linear trend",
              color: "var(--fg-muted)",
              kind: "line" as const,
              points: [
                { x: first, y: t.a + t.b * first },
                { x: last, y: t.a + t.b * last },
              ],
              format: (v: number) => fmtDuration(v * 1000),
            },
          ]
        : []),
    ],
  };
}

export function gapHistogramSpec(selection: SelectionSummary, gaps: number[]): ChartSpec {
  const chosen = selection.candidates.filter((c) => c.chosen);
  const cats = [...new Set([...gaps, ...chosen.map((c) => c.gap)])].sort((a, b) => a - b);
  return {
    title: "Gap distribution",
    caption: "Native frames skipped between consecutive selected frames.",
    x: { label: "gap (native frames)", categories: cats.map(String) },
    y: { label: "selected edges", format: intFmt },
    series: [
      {
        id: "gaps",
        label: "edges",
        color: SERIES[0],
        kind: "bars",
        points: cats.map((g, i) => ({
          x: i,
          y: chosen.filter((c) => c.gap === g).length,
          tone: chosen.some((c) => c.gap === g && !c.passed) ? "warn" : undefined,
          label: `gap ${g}${chosen.some((c) => c.gap === g && !c.passed) ? " · includes forced" : ""}`,
        })),
        format: intFmt,
      },
    ],
    legendExtras: chosen.some((c) => !c.passed)
      ? [
          { label: "chosen by ω", color: SERIES[0], shape: "rect" },
          { label: "includes forced", color: "var(--warn)", shape: "rect" },
        ]
      : undefined,
  };
}

export function fmScatterSpec(selection: SelectionSummary, nativeFrames: number): ChartSpec {
  const pts = (pred: (c: SelectionSummary["candidates"][number]) => boolean, tone?: Pt["tone"]): Pt[] =>
    selection.candidates.filter(pred).map((c) => ({
      x: c.to,
      y: c.fm,
      tone,
      label: `${fmtFrame(c.from)} → ${fmtFrame(c.to)} · gap ${c.gap}`,
      key: c.to,
    }));
  return {
    title: "Probe score f_m per candidate pair",
    caption: `Every probed candidate, plotted at its target frame. The chain takes the largest gap with f_m ≥ ω = ${selection.omega}.`,
    x: { label: "target native frame", domain: [0, Math.max(1, nativeFrames - 1)], format: intFmt },
    y: { label: "f_m", format: (v) => v.toFixed(2), include: [0, selection.omega] },
    series: [
      { id: "below", label: "below ω", color: "var(--fg-subtle)", kind: "dots", hollow: true, points: pts((c) => !c.passed), format: (v) => fmtRatio(v) },
      { id: "passed", label: "passed, not taken", color: "var(--fg-subtle)", kind: "dots", points: pts((c) => c.passed && !c.chosen), format: (v) => fmtRatio(v) },
      { id: "chosen", label: "chosen edge", color: SERIES[0], kind: "dots", points: pts((c) => c.chosen && c.passed), format: (v) => fmtRatio(v) },
      ...(selection.candidates.some((c) => c.chosen && !c.passed)
        ? [{ id: "forced", label: "forced (fallback)", color: "var(--warn)", kind: "dots" as const, points: pts((c) => c.chosen && !c.passed), format: (v: number) => fmtRatio(v) }]
        : []),
    ],
    refs: [{ axis: "y", value: selection.omega, label: `ω = ${selection.omega}`, kind: "threshold" }],
  };
}

export function selectionStripSpec(result: RunResult): ChartSpec {
  const usedSet = new Set(result.frames.filter((f) => f.used).map((f) => f.frameIndex));
  const N = result.metrics.nativeFrames;
  return {
    title: "Selected frames across the native timeline",
    x: { label: "native frame", domain: [0, N - 1], format: intFmt },
    y: { label: " ", domain: [0, 1], format: () => "" },
    series: [
      {
        id: "frames",
        label: "used",
        color: "var(--fg)",
        kind: "ticks",
        points: result.frames.map((f) => ({
          x: f.frameIndex,
          y: 1,
          tone: f.forced ? "warn" : !usedSet.has(f.frameIndex) ? "bad" : undefined,
          label: `${fmtFrame(f.frameIndex)} · gap ${f.gapFromPrev}${f.forced ? " · forced" : ""}${!f.used ? " · rejected" : ""}`,
          key: f.frameIndex,
        })),
        format: () => "selected",
      },
    ],
    legendExtras: [
      { label: "rejected in MATCH", color: "var(--bad)", shape: "tick" },
      { label: "forced", color: "var(--warn)", shape: "tick" },
    ],
  };
}

export function gapByFrameSpec(result: RunResult): ChartSpec {
  const N = result.metrics.nativeFrames;
  return {
    title: "Gap to each selected frame",
    x: { label: "native frame", domain: [0, N - 1], format: intFmt },
    y: { label: "gap", format: intFmt, include: [0] },
    series: [
      {
        id: "gap",
        label: "gap",
        color: SERIES[0],
        kind: "bars",
        points: result.frames.slice(1).map((f) => ({ x: f.frameIndex, y: f.gapFromPrev, tone: f.forced ? "warn" : undefined, key: f.frameIndex, label: fmtFrame(f.frameIndex) })),
        format: intFmt,
      },
    ],
  };
}

export function motionSpec(result: RunResult): ChartSpec {
  const N = result.metrics.nativeFrames;
  return {
    title: "Apparent ground motion",
    caption: "Slow footage (low motion) permits wide gaps; fast footage forces tight ones.",
    x: { label: "native frame", domain: [0, N - 1], format: intFmt },
    y: { label: "px / frame", format: (v) => v.toFixed(1), include: [0] },
    series: [
      {
        id: "motion",
        label: "px / frame",
        color: SERIES[0],
        kind: "line",
        points: result.motionProfile.map((m) => ({ x: m.frame, y: m.pxPerFrame })),
        format: (v) => `${v.toFixed(2)} px/frame`,
      },
    ],
  };
}

export function stageRuntimeSpec(m: RunMetrics): ChartSpec {
  const stages = STAGE_ORDER;
  return {
    title: "Runtime by stage",
    caption: "Wall time per stage. SELECT exists so that MATCH runs on a few dozen pairs, not thousands.",
    x: { label: "stage", categories: stages.map((s) => s.toUpperCase()) },
    y: { label: "seconds", format: (v) => v.toFixed(1) },
    series: [
      {
        id: "rt",
        label: "runtime",
        color: SERIES[0],
        kind: "bars",
        points: stages.map((s, i) => ({ x: i, y: (m.stageRuntimeMs[s] ?? 0) / 1000, label: s })),
        format: (v) => fmtDuration(v * 1000),
      },
    ],
  };
}

export function compareDriftSpec(runs: { id: string; steps: StepResult[] }[]): ChartSpec {
  return {
    title: "G_scale by step, per run",
    caption: "Ideal 1.0. Colour follows the run column above.",
    x: { label: "step", format: intFmt },
    y: { label: "G_scale", format: (v) => v.toFixed(3), include: [1] },
    series: runs.map((r, i) => ({
      id: r.id,
      label: r.id,
      color: SERIES[i % SERIES.length],
      kind: "line" as const,
      points: r.steps.map((s) => ({ x: s.step, y: s.gScale })),
      format: (v: number) => v.toFixed(4),
    })),
    refs: [{ axis: "y", value: 1, label: "ideal 1.0", kind: "ideal" }],
    band: { y0: 1 - DRIFT_BAND.scale, y1: 1 + DRIFT_BAND.scale, label: `display band ±${DRIFT_BAND.scale * 100}%` },
  };
}
