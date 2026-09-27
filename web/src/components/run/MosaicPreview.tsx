"use client";

import type { MosaicInfo, RunStatus } from "@/services";
import type { LivePair, StageState } from "@/lib/runReducer";
import { getPipelineService } from "@/services";
import { cn } from "@/components/ui/primitives";
import { STAGE_META } from "./StageStepper";

/**
 * The mosaic exists only after composition (the notebook composes once, after every DKM
 * step). Before that this panel says what is happening instead of drawing a fake preview.
 */
export function MosaicPreview({
  mosaic,
  status,
  stages,
  variantName,
  pairs = [],
  className,
}: {
  mosaic: MosaicInfo | null;
  status: RunStatus;
  stages: StageState[];
  variantName: string;
  /** Visualised pairs: while there is no final mosaic, the newest preview canvas is shown. */
  pairs?: LivePair[];
  className?: string;
}) {
  const latest = [...pairs].reverse().find((p) => p.done && !p.pruned) ?? null;
  const current = stages.find((s) => s.status === "active");
  const stopped = stages.find((s) => s.status === "failed" || s.status === "cancelled");
  return (
    <section className={cn("relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface-inset", className)}>
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
        <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">{mosaic ? "Mosaic" : latest ? "Live preview canvas" : "Mosaic"}</h2>
        <span className="num text-2xs text-fg-subtle">
          {mosaic ? `variant ${variantName}` : latest ? `after pair #${latest.attempt} ${latest.start.frameI}→${latest.start.frameJ}` : `variant ${variantName}`}
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {mosaic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getPipelineService().url(mosaic.previewUrl)}
            alt={`Mosaic (${variantName})`}
            className="max-h-full max-w-full object-contain"
            width={mosaic.previewWidth}
            height={mosaic.previewHeight}
          />
        ) : latest?.done ? (
          <div className="relative flex size-full min-h-0 flex-col items-center justify-center">
            <div className="relative max-h-full max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- per-pair artifact */}
              <img
                src={getPipelineService().url(latest.done.canvasUrl)}
                alt={`Preview canvas after pair ${latest.attempt}`}
                className="block max-h-[520px] max-w-full object-contain"
              />
              {latest.done.quad && (
                <svg
                  viewBox={`0 0 ${latest.done.canvasSize[0]} ${latest.done.canvasSize[1]}`}
                  className="absolute inset-0 size-full"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon
                    points={latest.done.quad.map((q) => q.join(",")).join(" ")}
                    fill="var(--accent)"
                    fillOpacity={0.12}
                    stroke="var(--accent)"
                    strokeWidth={3}
                  />
                </svg>
              )}
            </div>
            <p className="absolute right-2 bottom-1 left-2 text-center text-2xs text-fg-subtle">
              Preview: accepted frames placed by their accumulated homography, first-wins. The {variantName} mosaic is composed after the last DKM step.
            </p>
          </div>
        ) : (
          <p className="max-w-sm px-6 text-center text-xs text-fg-muted">
            {stopped
              ? `No mosaic: the run stopped during ${STAGE_META[stopped.id].label.toUpperCase()}, before composition.`
              : status === "queued"
                ? "Queued. The mosaic is composed after every DKM step has run."
                : current
                  ? `${STAGE_META[current.id].label} in progress. The mosaic is composed once, after the last DKM step.`
                  : "The mosaic is composed after the last DKM step."}
          </p>
        )}
      </div>
    </section>
  );
}
