/**
 * Declarative chart description. One pure renderer (ChartSvg) draws every
 * figure in the app, so on-screen charts and exported SVG/PNG are identical.
 * Colours are CSS token references (var(--…)); the exporter resolves them.
 */
export type Tone = "accent" | "bad" | "warn" | "muted" | "ok";

export interface Pt {
  x: number;
  y: number;
  tone?: Tone;
  /** Shown in the tooltip/table; e.g. "step 12 · f0704 → f0768". */
  label?: string;
  /** Opaque key passed back on click. */
  key?: string | number;
}

export interface Series {
  id: string;
  label: string;
  /** CSS colour, normally a token: var(--series-1) */
  color: string;
  kind: "line" | "dots" | "bars" | "ticks";
  points: Pt[];
  /** Hollow markers (e.g. candidates below ω). */
  hollow?: boolean;
  /** Excluded from legend (e.g. helper series). */
  hideInLegend?: boolean;
  /** Value formatter for tooltip/table. */
  format?: (v: number) => string;
}

export interface RefLine {
  axis: "x" | "y";
  value: number;
  label: string;
  kind: "ideal" | "threshold";
}

export interface ChartSpec {
  title: string;
  /** Short caption under the title. */
  caption?: string;
  x: {
    label: string;
    domain?: [number, number];
    /** Categorical x: bars at integer positions 0..n-1. */
    categories?: string[];
    format?: (v: number) => string;
  };
  y: {
    label: string;
    domain?: [number, number];
    format?: (v: number) => string;
    /** Always include these values in the domain (e.g. the ideal 1.0). */
    include?: number[];
  };
  series: Series[];
  refs?: RefLine[];
  /** A display band around an ideal; everything outside it is tinted warn. */
  band?: { y0: number; y1: number; label: string };
  /** Extra legend entries for tones used inside a single series. */
  legendExtras?: { label: string; color: string; shape: "dot" | "line" | "rect" | "tick" | "ring" }[];
}

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;
export const TONE_COLOR: Record<Tone, string> = {
  accent: "var(--series-1)",
  bad: "var(--bad)",
  warn: "var(--warn)",
  muted: "var(--fg-subtle)",
  ok: "var(--ok)",
};
