"use client";

import Link from "next/link";
import { getPipelineService } from "@/services";
import { fmtFrame, fmtVideoTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";

/**
 * Composited frames in chain order (decoded native indices); the connector shows the gap
 * DKM bridged. Thumbnails are the run's own decoded frames.
 */
export function Filmstrip({ frames, runId, fps, selected }: { frames: number[]; runId: string; fps: number | null; selected?: number | null }) {
  const svc = getPipelineService();
  const gaps = frames.map((f, i) => (i ? f - frames[i - 1] : 0));
  const maxGap = Math.max(1, ...gaps);
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Composited frames filmstrip">
      <ol className="flex items-end gap-0 px-3 py-3">
        {frames.map((f, i) => (
          <li key={f} className="flex shrink-0 items-end">
            {i > 0 && (
              <div className="flex w-12 flex-col items-center justify-end self-center pb-6" title={`gap ${gaps[i]} native frames`}>
                <span className="num text-2xs text-fg-subtle">+{gaps[i]}</span>
                <span className="mt-0.5 h-0.5 rounded-full bg-line-strong" style={{ width: `${8 + (gaps[i] / maxGap) * 36}px` }} />
              </div>
            )}
            <Link
              href={`/runs/${runId}/selection?frame=${f}`}
              className={cn("group block w-28 rounded-md border p-1 transition-colors", selected === f ? "border-accent" : "border-line hover:border-fg-subtle")}
              aria-label={`Frame ${f}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- backend frame thumbnail */}
              <img
                src={svc.url(`/api/runs/${encodeURIComponent(runId)}/frames/${f}.jpg?w=240`)}
                alt=""
                width={192}
                height={108}
                loading="lazy"
                className="aspect-video w-full rounded-sm bg-inset object-cover"
              />
              <div className="num mt-1 flex items-baseline justify-between px-0.5 text-2xs">
                <span className="text-fg">{fmtFrame(f)}</span>
                {fps ? <span className="text-fg-subtle">{fmtVideoTime((f / fps) * 1000).slice(3)}</span> : null}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
