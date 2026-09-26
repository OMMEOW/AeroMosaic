"use client";

import { useMemo, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunSummary } from "@/services";
import { downloadBlob, textBlob } from "@/lib/export/download";
import { exportName, provenanceOf } from "@/lib/export/provenance";
import { standaloneSvg, svgToPngBlob } from "@/lib/export/svg";
import { aboutHref } from "@/lib/metrics";
import { PanelBoundary } from "@/components/ui/boundary";
import { cn } from "@/components/ui/cn";
import { useElementWidth } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { ChartSvg, layoutChart } from "./ChartSvg";
import type { ChartSpec, Pt, Series } from "./chartSpec";

export const EXPORT_WIDTH = 800;

/** Standalone SVG string for a spec (used by per-figure export and the bulk zip). */
export function chartSvgString(spec: ChartSpec, run: RunSummary, height: number, exportedAt = new Date()) {
  const markup = renderToStaticMarkup(<ChartSvg spec={spec} width={EXPORT_WIDTH} height={height} />);
  return standaloneSvg(markup, provenanceOf(run, exportedAt), { width: EXPORT_WIDTH, height, title: spec.title });
}

function nearest(spec: ChartSpec, x: number) {
  const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))];
  if (!xs.length) return null;
  return xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}

function pointAt(s: Series, x: number): Pt | undefined {
  return s.points.find((p) => p.x === x);
}

/**
 * A chart panel: title, caption, crosshair/tooltip, table view, PNG/SVG
 * export with provenance, and its own error boundary.
 */
export function Figure({
  spec,
  run,
  height = 220,
  file,
  onPick,
  selectedKey,
  aboutId,
  footer,
  className,
}: {
  spec: ChartSpec;
  run: RunSummary;
  height?: number;
  /** Export file stem, e.g. "drift-gscale". */
  file: string;
  /** Click on a point (nearest x). */
  onPick?: (p: Pt, series: Series) => void;
  selectedKey?: string | number | null;
  /** Methodology anchor for the "?" link. */
  aboutId?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [busy, setBusy] = useState(false);
  const layout = useMemo(() => (width ? layoutChart(spec, width, height) : null), [spec, width, height]);
  const fmtX = spec.x.format ?? ((v: number) => (spec.x.categories ? spec.x.categories[v] : String(v)));

  const exportAs = async (kind: "svg" | "png") => {
    setBusy(true);
    try {
      const at = new Date();
      const svg = chartSvgString(spec, run, height, at);
      const prov = provenanceOf(run, at);
      if (kind === "svg") downloadBlob(textBlob(svg, "image/svg+xml"), exportName(prov, file, "svg"));
      else downloadBlob(await svgToPngBlob(svg, EXPORT_WIDTH, height + 28, 2), exportName(prov, file, "png"));
    } catch (e) {
      toast({ tone: "bad", title: `Export failed: ${spec.title}`, body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < layout.left || px > layout.width - layout.right) return setHoverX(null);
    setHoverX(nearest(spec, layout.xInvert(px)));
  };

  const tooltip =
    hoverX != null && layout
      ? spec.series
          .map((s) => ({ s, p: pointAt(s, hoverX) }))
          .filter((r): r is { s: Series; p: Pt } => !!r.p)
      : [];

  const tableXs = useMemo(
    () => [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
    [spec],
  );

  return (
    <figure className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface-1", className)}>
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
            {spec.title}
            {aboutId && (
              <a href={aboutHref(aboutId)} className="text-2xs text-fg-subtle hover:text-accent" aria-label={`Methodology: ${spec.title}`}>
                ?
              </a>
            )}
          </div>
          {spec.caption && <div className="mt-0.5 text-xs text-fg-muted">{spec.caption}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${spec.title} actions`}>
          <button
            type="button"
            className="rounded-sm px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-surface-3 hover:text-fg"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            aria-pressed={view === "table"}
          >
            {view === "chart" ? "Table" : "Chart"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="num rounded-sm px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-50"
            onClick={() => exportAs("svg")}
            aria-label={`Download ${spec.title} as SVG`}
          >
            SVG
          </button>
          <button
            type="button"
            disabled={busy}
            className="num rounded-sm px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-50"
            onClick={() => exportAs("png")}
            aria-label={`Download ${spec.title} as PNG`}
          >
            PNG
          </button>
        </div>
      </figcaption>
      <PanelBoundary label={spec.title}>
        {view === "chart" ? (
          <div
            ref={ref}
            className={cn("relative px-1 pt-2", onPick && "cursor-pointer")}
            style={{ height: height + 8 }}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverX(null)}
            onClick={() => {
              if (hoverX == null || !onPick) return;
              for (const s of spec.series) {
                const p = pointAt(s, hoverX);
                if (p) return onPick(p, s);
              }
            }}
          >
            {width > 0 && <ChartSvg spec={spec} width={width - 8} height={height} hoverX={hoverX} selectedKey={selectedKey} />}
            {layout && hoverX != null && tooltip.length > 0 && (
              <div
                className="pointer-events-none absolute z-10 min-w-36 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs shadow-pop"
                style={{
                  left: Math.min(layout.xScale(hoverX) + 12, width - 180),
                  top: layout.top + 4,
                }}
              >
                <div className="num text-2xs text-fg-subtle">
                  {spec.x.label}: {fmtX(hoverX)}
                </div>
                {tooltip.map(({ s, p }) => (
                  <div key={s.id} className="mt-0.5 flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: p.tone ? `var(--${p.tone === "accent" ? "series-1" : p.tone === "muted" ? "fg-subtle" : p.tone})` : s.color }} />
                    <span className="num font-medium text-fg">{(s.format ?? spec.y.format ?? String)(p.y)}</span>
                    <span className="truncate text-fg-muted">{p.label ?? s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[320px] overflow-auto" style={{ minHeight: height + 8 }}>
            <table className="num w-full text-xs">
              <thead className="sticky top-0 bg-surface-1 text-2xs text-fg-subtle uppercase">
                <tr className="[&>th]:h-7 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:text-left [&>th]:font-medium">
                  <th>{spec.x.label}</th>
                  {spec.series.map((s) => (
                    <th key={s.id}>{s.label}</th>
                  ))}
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {tableXs.slice(0, 1000).map((x) => (
                  <tr key={x} className="[&>td]:h-6 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-2">
                    <td className="text-fg-muted">{fmtX(x)}</td>
                    {spec.series.map((s) => {
                      const p = pointAt(s, x);
                      return <td key={s.id}>{p ? (s.format ?? spec.y.format ?? String)(p.y) : ""}</td>;
                    })}
                    <td className="text-fg-subtle">{spec.series.map((s) => pointAt(s, x)?.label).filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelBoundary>
      {footer && <div className="border-t border-line px-3 py-2 text-xs text-fg-muted">{footer}</div>}
    </figure>
  );
}
