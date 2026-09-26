"use client";

import { useEffect, useState } from "react";
import type { MosaicPreview as MosaicPreviewData, RunStatus, StageState } from "@/services";
import { fmtInt } from "@/lib/format";
import { cn } from "@/components/ui/primitives";
import { STAGE_META } from "./StageStepper";

/** Preloads each new URL so the preview swaps without a blank frame. */
function useLoadedImage(url: string | null) {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && setLoaded(url);
    img.onerror = () => !cancelled && setLoaded(url);
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return url ? loaded : null;
}

export function MosaicPreview({
  mosaic,
  status,
  stages,
  className,
}: {
  mosaic: MosaicPreviewData | null;
  status: RunStatus;
  stages: StageState[];
  className?: string;
}) {
  const src = useLoadedImage(mosaic?.image.url ?? null);
  const current = stages.find((s) => s.status === "active");
  const failedStage = stages.find((s) => s.status === "failed" || s.status === "cancelled");
  const partial = status === "failed" || status === "cancelled";
  const final = mosaic && !mosaic.latestFootprint && status === "succeeded";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-inset",
        "bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-size-[32px_32px]",
        className,
      )}
    >
      {mosaic && src ? (
        <svg
          viewBox={`0 0 ${mosaic.image.width} ${mosaic.image.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 size-full p-3"
          role="img"
          aria-label={`Mosaic preview, ${mosaic.framesComposited} frames composited`}
        >
          <image href={src} width={mosaic.image.width} height={mosaic.image.height} />
          {mosaic.latestFootprint && !partial && (
            <polygon
              points={mosaic.latestFootprint.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className="transition-[points] duration-300"
            />
          )}
        </svg>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm">
            <div className="text-sm text-fg-muted">
              {status === "failed" || status === "cancelled"
                ? `No mosaic — run ${status} during ${failedStage ? STAGE_META[failedStage.id].label.toUpperCase() : "startup"}`
                : mosaic
                  ? "Loading preview…"
                  : "Mosaic preview appears when dense matching begins"}
            </div>
            {current && !mosaic && (
              <div className="num mt-1.5 text-xs text-fg-subtle">
                {STAGE_META[current.id].label}
                {current.counter &&
                  ` · ${fmtInt(current.counter.done)}${current.counter.total != null ? ` / ${fmtInt(current.counter.total)}` : ""} ${current.counter.unit}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Caption */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
        <span className="num rounded-sm bg-black/55 px-1.5 py-0.5 text-2xs tracking-wider text-white/90 uppercase backdrop-blur-sm">
          {final ? "Final mosaic" : partial ? "Partial composite" : "Live composite"}
          {mosaic && <span className="text-white/60"> · {mosaic.framesComposited} frames</span>}
        </span>
        {mosaic && (
          <span className="num rounded-sm bg-black/55 px-1.5 py-0.5 text-2xs text-white/70 backdrop-blur-sm">
            v{mosaic.version} · {fmtInt(mosaic.image.width)}×{fmtInt(mosaic.image.height)}
          </span>
        )}
      </div>
      {mosaic?.latestFootprint && !partial && (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 text-2xs text-white/80 backdrop-blur-sm">
          <span className="inline-block h-2 w-3 border border-accent" aria-hidden="true" /> latest frame
        </div>
      )}
    </div>
  );
}
