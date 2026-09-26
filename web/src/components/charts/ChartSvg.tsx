import type { ChartSpec, Pt, Series } from "./chartSpec";
import { TONE_COLOR } from "./chartSpec";

/**
 * Pure SVG renderer for a ChartSpec. No hooks, no DOM reads: the same
 * component renders on screen and into exported SVG/PNG files.
 */
export interface ChartLayout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xScale: (v: number) => number;
  yScale: (v: number) => number;
  xInvert: (px: number) => number;
  xDomain: [number, number];
  yDomain: [number, number];
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const hasLegend = (spec: ChartSpec) =>
  spec.series.filter((s) => !s.hideInLegend).length >= 2 || (spec.legendExtras?.length ?? 0) > 0;

export function layoutChart(spec: ChartSpec, width: number, height: number): ChartLayout {
  const left = 56;
  const right = 18;
  const top = hasLegend(spec) ? 30 : 12;
  const bottom = 42;
  const cats = spec.x.categories;
  const all = spec.series.flatMap((s) => s.points);

  let xDomain: [number, number];
  if (cats) xDomain = [-0.5, cats.length - 0.5];
  else if (spec.x.domain) xDomain = spec.x.domain;
  else {
    const xs = all.map((p) => p.x);
    xDomain = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
    if (xDomain[0] === xDomain[1]) xDomain = [xDomain[0] - 1, xDomain[1] + 1];
  }

  let yDomain: [number, number];
  if (spec.y.domain) yDomain = spec.y.domain;
  else {
    const ys = all.filter((p) => spec.series.find((s) => s.points.includes(p))?.kind !== "ticks").map((p) => p.y);
    const extra = [...(spec.y.include ?? []), ...(spec.refs ?? []).filter((r) => r.axis === "y").map((r) => r.value)];
    if (spec.band) extra.push(spec.band.y0, spec.band.y1);
    const vals = [...ys, ...extra];
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    if (spec.series.some((s) => s.kind === "bars")) lo = Math.min(0, lo);
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1;
      hi += Math.abs(hi) * 0.1 || 1;
    }
    const pad = (hi - lo) * 0.08;
    yDomain = [lo < 0 || !spec.series.some((s) => s.kind === "bars") ? lo - pad : lo, hi + pad];
  }

  const pw = Math.max(10, width - left - right);
  const ph = Math.max(10, height - top - bottom);
  const xScale = (v: number) => left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * pw;
  const yScale = (v: number) => top + ph - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * ph;
  const xInvert = (px: number) => xDomain[0] + ((px - left) / pw) * (xDomain[1] - xDomain[0]);
  return { width, height, left, right, top, bottom, xScale, yScale, xInvert, xDomain, yDomain };
}

function barPath(x: number, y: number, w: number, h: number, r: number) {
  // Rounded data-end (top), square at the baseline.
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function pointColor(s: Series, p: Pt) {
  return p.tone ? TONE_COLOR[p.tone] : s.color;
}

export function ChartSvg({
  spec,
  width,
  height,
  hoverX,
  selectedKey,
}: {
  spec: ChartSpec;
  width: number;
  height: number;
  /** Data-space x of the crosshair, or null. */
  hoverX?: number | null;
  /** Point key to emphasise (e.g. the clicked frame). */
  selectedKey?: string | number | null;
}) {
  const L = layoutChart(spec, width, height);
  const { xScale, yScale, top, left, right, bottom } = L;
  const plotBottom = height - bottom;
  const plotRight = width - right;
  const fmtX = spec.x.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  const fmtY = spec.y.format ?? ((v: number) => String(Math.round(v * 1000) / 1000));
  const yTicks = niceTicks(L.yDomain[0], L.yDomain[1], 4).filter((t) => t >= L.yDomain[0] && t <= L.yDomain[1]);
  const cats = spec.x.categories;
  const xTicks = cats
    ? cats.map((_, i) => i)
    : niceTicks(L.xDomain[0], L.xDomain[1], Math.max(2, Math.floor((width - left - right) / 90))).filter(
        (t) => t >= L.xDomain[0] && t <= L.xDomain[1],
      );
  const bandW = cats ? (width - left - right) / cats.length : 0;
  const nBarSeries = spec.series.filter((s) => s.kind === "bars").length || 1;

  const legendItems = [
    ...spec.series.filter((s) => !s.hideInLegend).map((s) => ({
      label: s.label,
      color: s.color,
      shape: s.kind === "line" ? "line" : s.kind === "bars" ? "rect" : s.kind === "ticks" ? "tick" : s.hollow ? "ring" : "dot",
    })),
    ...(spec.legendExtras ?? []),
  ];
  const showLegend = hasLegend(spec);
  let lx = left;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={spec.title}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Band + out-of-band tint */}
      {spec.band && (
        <g>
          <rect x={left} y={top} width={plotRight - left} height={Math.max(0, yScale(spec.band.y1) - top)} fill="var(--warn-soft)" />
          <rect
            x={left}
            y={yScale(spec.band.y0)}
            width={plotRight - left}
            height={Math.max(0, plotBottom - yScale(spec.band.y0))}
            fill="var(--warn-soft)"
          />
          <rect
            x={left}
            y={yScale(spec.band.y1)}
            width={plotRight - left}
            height={Math.max(0, yScale(spec.band.y0) - yScale(spec.band.y1))}
            fill="var(--surface-2)"
          />
        </g>
      )}

      {/* Grid + y axis */}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={left} x2={plotRight} y1={yScale(t)} y2={yScale(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={left - 8} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--fg-subtle)" fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace">
            {fmtY(t)}
          </text>
        </g>
      ))}
      <line x1={left} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--line-strong)" strokeWidth={1} />

      {/* x axis */}
      {xTicks.map((t, i) => {
        // Thin categorical labels when crowded.
        if (cats && cats.length * 28 > width - left - right && i % Math.ceil((cats.length * 28) / (width - left - right)) !== 0) return null;
        return (
          <text key={`x${t}`} x={xScale(t)} y={plotBottom + 14} textAnchor="middle" fontSize={10} fill="var(--fg-subtle)" fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace">
            {cats ? (bandW < cats[t].length * 6.6 + 6 ? cats[t].slice(0, 3) : cats[t]) : fmtX(t)}
          </text>
        );
      })}
      <text x={(left + plotRight) / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">
        {spec.x.label}
      </text>
      <text transform={`translate(12 ${(top + plotBottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">
        {spec.y.label}
      </text>

      {/* Series */}
      {spec.series.map((s, si) => {
        if (s.kind === "line") {
          const pts = s.points.filter((p) => Number.isFinite(p.y));
          const d = pts.map((p, i) => `${i ? "L" : "M"}${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}`).join("");
          const lastP = pts[pts.length - 1];
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts
                .filter((p) => p.tone)
                .map((p, i) => (
                  <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={4} fill={pointColor(s, p)} stroke="var(--surface-1)" strokeWidth={2} />
                ))}
              {lastP && (
                <circle cx={xScale(lastP.x)} cy={yScale(lastP.y)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              )}
            </g>
          );
        }
        if (s.kind === "dots") {
          return (
            <g key={s.id}>
              {s.points.map((p, i) => {
                const sel = selectedKey != null && p.key === selectedKey;
                return (
                  <circle
                    key={i}
                    cx={xScale(p.x)}
                    cy={yScale(p.y)}
                    r={sel ? 6 : 4}
                    fill={s.hollow ? "var(--surface-1)" : pointColor(s, p)}
                    stroke={s.hollow ? pointColor(s, p) : "var(--surface-1)"}
                    strokeWidth={s.hollow ? 1.5 : 2}
                  />
                );
              })}
            </g>
          );
        }
        if (s.kind === "ticks") {
          return (
            <g key={s.id}>
              {s.points.map((p, i) => {
                const sel = selectedKey != null && p.key === selectedKey;
                return (
                  <line
                    key={i}
                    x1={xScale(p.x)}
                    x2={xScale(p.x)}
                    y1={sel ? top - 2 : top + 4}
                    y2={sel ? plotBottom + 2 : plotBottom - 4}
                    stroke={sel ? "var(--fg)" : pointColor(s, p)}
                    strokeWidth={sel ? 3 : 2}
                  />
                );
              })}
            </g>
          );
        }
        // bars
        const barIdx = spec.series.filter((x) => x.kind === "bars").indexOf(s);
        return (
          <g key={s.id}>
            {s.points.map((p, i) => {
              const slot = cats ? bandW : Math.max(2, ((width - left - right) / Math.max(1, s.points.length)) * 0.9);
              const bw = Math.min(24, (slot * 0.7) / nBarSeries);
              const cx = xScale(p.x) + (barIdx - (nBarSeries - 1) / 2) * (bw + 2);
              const y0 = yScale(Math.max(0, L.yDomain[0]));
              const y1 = yScale(p.y);
              const sel = selectedKey != null && p.key === selectedKey;
              return <path key={i} d={barPath(cx - bw / 2, Math.min(y0, y1), bw, Math.abs(y0 - y1), 4)} fill={sel ? "var(--fg)" : pointColor(s, p)} />;
            })}
            {void si}
          </g>
        );
      })}

      {/* Reference lines */}
      {(spec.refs ?? []).map((r, i) =>
        r.axis === "y" ? (
          <g key={`r${i}`}>
            <line
              x1={left}
              x2={plotRight}
              y1={yScale(r.value)}
              y2={yScale(r.value)}
              stroke={r.kind === "threshold" ? "var(--fg)" : "var(--fg-muted)"}
              strokeWidth={1}
              strokeDasharray={r.kind === "threshold" ? "5 3" : "2 3"}
            />
            <text
              x={plotRight - 4}
              y={yScale(r.value) - 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--fg-muted)"
              fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace"
              paintOrder="stroke"
              stroke="var(--surface-1)"
              strokeWidth={3}
            >
              {r.label}
            </text>
          </g>
        ) : (
          <g key={`r${i}`}>
            <line
              x1={xScale(r.value)}
              x2={xScale(r.value)}
              y1={top}
              y2={plotBottom}
              stroke="var(--fg-muted)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text x={xScale(r.value) + 4} y={top + 10} fontSize={10} fill="var(--fg-muted)" fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace">
              {r.label}
            </text>
          </g>
        ),
      )}
      {spec.band && (
        <text x={left + 6} y={yScale(spec.band.y1) + 12} fontSize={10} fill="var(--fg-subtle)">
          {spec.band.label}
        </text>
      )}

      {/* Crosshair */}
      {hoverX != null && (
        <line x1={xScale(hoverX)} x2={xScale(hoverX)} y1={top} y2={plotBottom} stroke="var(--fg-muted)" strokeWidth={1} />
      )}

      {/* Legend (inside the SVG so exports are self-describing) */}
      {showLegend && (
        <g fontSize={11} fill="var(--fg-muted)">
          {legendItems.map((it) => {
            const x = lx;
            lx += 22 + it.label.length * 6.2 + 14;
            return (
              <g key={it.label} transform={`translate(${x} 12)`}>
                {it.shape === "line" && <line x1={0} x2={14} y1={0} y2={0} stroke={it.color} strokeWidth={2} />}
                {it.shape === "rect" && <rect x={0} y={-5} width={12} height={10} rx={2} fill={it.color} />}
                {it.shape === "dot" && <circle cx={6} cy={0} r={4} fill={it.color} />}
                {it.shape === "ring" && <circle cx={6} cy={0} r={4} fill="none" stroke={it.color} strokeWidth={1.5} />}
                {it.shape === "tick" && <line x1={6} x2={6} y1={-6} y2={6} stroke={it.color} strokeWidth={2} />}
                <text x={20} y={0} dy="0.32em">
                  {it.label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
