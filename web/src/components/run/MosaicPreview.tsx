"use client";

import type { MosaicInfo, RunStatus } from "@/services";
import type { StageState } from "@/lib/runReducer";
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
  className,
}: {
  mosaic: MosaicInfo | null;
  status: RunStatus;
  stages: StageState[];
  variantName: string;
  className?: string;
}) {
  const current = stages.find((s) => s.status === "active");
  const stopped = stages.find((s) => s.status === "failed" || s.status === "cancelled");
  return (
    <section className={cn("relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface-inset", className)}>
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
        <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">Mosaic</h2>
        <span className="num text-2xs text-fg-subtle">variant {variantName}</span>
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
