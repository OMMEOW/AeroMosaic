"use client";

import Link from "next/link";
import type { SelectedFrame } from "@/services";
import { fmtFrame, fmtVideoTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";

/**
 * Selected frames in chain order with their native indices; the connector
 * between thumbnails shows how many native frames were skipped.
 */
export function Filmstrip({ frames, runId, selected }: { frames: SelectedFrame[]; runId: string; selected?: number | null }) {
  const maxGap = Math.max(1, ...frames.map((f) => f.gapFromPrev));
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Selected frames filmstrip">
      <ol className="flex items-end gap-0 px-3 py-3">
        {frames.map((f, i) => (
          <li key={f.frameIndex} className="flex shrink-0 items-end">
            {i > 0 && (
              <div className="flex w-12 flex-col items-center justify-end self-center pb-6" title={`${f.gapFromPrev} native frames skipped`}>
                <span className={cn("num text-2xs", f.forced ? "text-warn" : "text-fg-subtle")}>+{f.gapFromPrev}</span>
                <span
                  className={cn("mt-0.5 h-0.5 rounded-full", f.forced ? "bg-warn" : "bg-line-strong")}
                  style={{ width: `${8 + (f.gapFromPrev / maxGap) * 36}px` }}
                />
              </div>
            )}
            <Link
              href={`/runs/${runId}/selection?frame=${f.frameIndex}`}
              className={cn(
                "group block w-28 rounded-md border p-1 transition-colors",
                selected === f.frameIndex ? "border-accent" : f.used ? "border-line hover:border-fg-subtle" : "border-bad/50 hover:border-bad",
              )}
              aria-label={`Frame ${f.frameIndex}${f.used ? "" : ", rejected in MATCH"}${f.forced ? ", forced" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- service-provided thumbnail URL */}
              <img src={f.thumbnailUrl} alt="" width={192} height={108} className={cn("aspect-video w-full rounded-sm bg-inset object-cover", !f.used && "opacity-45 grayscale")} />
              <div className="num mt-1 flex items-baseline justify-between px-0.5 text-2xs">
                <span className="text-fg">{fmtFrame(f.frameIndex)}</span>
                <span className="text-fg-subtle">{fmtVideoTime(f.timestampMs).slice(3)}</span>
              </div>
              {(!f.used || f.forced) && (
                <div className="num px-0.5 text-2xs">
                  {!f.used && <span className="text-bad">rejected</span>}
                  {f.forced && <span className="ml-1 text-warn">forced</span>}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
