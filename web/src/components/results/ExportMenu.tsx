"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getPipelineService, type RunResult } from "@/services";
import { chartSvgString } from "@/components/charts/Figure";
import {
  driftScaleSpec,
  driftShearSpec,
  fmScatterSpec,
  gapByFrameSpec,
  gapHistogramSpec,
  inlierSpec,
  motionSpec,
  selectionStripSpec,
  stageRuntimeSpec,
  stepDurationSpec,
} from "@/components/charts/runCharts";
import type { ChartSpec } from "@/components/charts/chartSpec";
import { download, exportAllZip } from "@/lib/export/runExports";
import { fmtBytes } from "@/lib/format";
import { IconDownload, Spinner } from "@/components/ui/icons";
import { Button, cn } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

/** Every figure the analysis views render, for bulk export. */
export function allFigures(r: RunResult): { stem: string; spec: ChartSpec; height: number }[] {
  const gaps = r.frames.slice(1).map((f) => f.gapFromPrev);
  return [
    { stem: "drift_g_scale", spec: driftScaleSpec(r.steps), height: 240 },
    { stem: "drift_g_shear", spec: driftShearSpec(r.steps), height: 240 },
    { stem: "inlier_ratio", spec: inlierSpec(r.steps), height: 220 },
    { stem: "step_duration", spec: stepDurationSpec(r.steps), height: 220 },
    { stem: "gap_histogram", spec: gapHistogramSpec(r.selection, gaps), height: 220 },
    { stem: "fm_vs_omega", spec: fmScatterSpec(r.selection, r.metrics.nativeFrames), height: 260 },
    { stem: "selection_strip", spec: selectionStripSpec(r), height: 110 },
    { stem: "gap_by_frame", spec: gapByFrameSpec(r), height: 150 },
    { stem: "ground_motion", spec: motionSpec(r), height: 150 },
    { stem: "runtime_by_stage", spec: stageRuntimeSpec(r.metrics), height: 220 },
  ];
}

type Item = { label: string; hint: string; run: () => Promise<unknown> | void } | { label: string; hint: string; href: string } | "sep";

export function ExportMenu({ result }: { result: RunResult }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = result.run;
  const frames = result.frames.map((f) => f.frameIndex);
  const items: Item[] = [
    { label: "Mosaic · full resolution PNG", hint: `${result.mosaic.width}×${result.mosaic.height}`, run: () => download.mosaic(run, result.mosaic.downloadUrl, "full") },
    { label: "Mosaic · preview PNG", hint: `${result.mosaic.preview.width}×${result.mosaic.preview.height}`, run: () => download.mosaic(run, result.mosaic.preview.url, "preview") },
    "sep",
    { label: "Per-step table · CSV", hint: `${result.steps.length} rows`, run: () => download.stepsCsv(run, result.steps) },
    { label: "Per-step table · JSON", hint: `${result.steps.length} rows`, run: () => download.stepsJson(run, result.steps) },
    { label: "Run summary · JSON", hint: "all metrics + exact parameters", run: () => download.summary(run, { result }) },
    { label: "Printable report", hint: "print / save as PDF", href: `/runs/${run.id}/report` },
    "sep",
    { label: "Run log · TXT", hint: "complete", run: async () => download.log(run, await getPipelineService().getRunLog(run.id)) },
    { label: "Selected frame indices · TXT", hint: `${frames.length} frames`, run: () => download.frames(run, frames, "txt") },
    { label: "Selected frame indices · JSON", hint: `${frames.length} frames`, run: () => download.frames(run, frames, "json") },
    "sep",
    {
      label: "Download everything · ZIP",
      hint: "mosaic, tables, summary, log, frames, figures (SVG)",
      run: async () => {
        const logs = await getPipelineService().getRunLog(run.id);
        const at = new Date();
        const figures = allFigures(result).map((f) => ({ stem: f.stem, svg: chartSvgString(f.spec, run, f.height, at) }));
        const out = await exportAllZip(result, logs, figures, (l) => setBusy(`Download everything · ${l}`));
        toast({ tone: "ok", title: "Export ready", body: `${out.files.length} files · ${fmtBytes(out.bytes)}` });
      },
    },
  ];

  const exec = async (it: Extract<Item, { run: unknown }>) => {
    setBusy(it.label);
    try {
      await it.run();
    } catch (e) {
      toast({ tone: "bad", title: `Export failed: ${it.label}`, body: (e as Error).message });
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        icon={busy ? <Spinner size={12} /> : <IconDownload size={12} />}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? "Exporting…" : "Export"}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-[min(340px,calc(100vw-24px))] rounded-lg bg-surface-2 py-1 shadow-pop">
          <div className="num px-3 pt-1 pb-2 text-2xs text-fg-subtle">Every file embeds run ID, timestamp and parameters.</div>
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="my-1 h-px bg-line" role="separator" />
            ) : "href" in it ? (
              <Link key={it.label} role="menuitem" href={it.href} className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-3">
                <span>{it.label}</span>
                <span className="num shrink-0 text-2xs text-fg-subtle">{it.hint}</span>
              </Link>
            ) : (
              <button
                key={it.label}
                role="menuitem"
                type="button"
                disabled={!!busy}
                onClick={() => exec(it)}
                className={cn("flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-3 disabled:opacity-50", busy === it.label && "text-accent")}
              >
                <span>{busy?.startsWith(it.label) ? busy : it.label}</span>
                <span className="num shrink-0 text-2xs text-fg-subtle">{it.hint}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
