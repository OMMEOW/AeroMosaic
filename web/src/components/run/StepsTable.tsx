"use client";

import type { StepResult } from "@/services";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { fmtDuration, fmtFrame, fmtInt, fmtRatio } from "@/lib/format";
import { IconArrowDown, IconCheck, IconX } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";

export const MIN_INLIER_RATIO = 0.3;

export function InlierBar({ ratio, accepted }: { ratio: number; accepted: boolean }) {
  return (
    <span className="relative inline-block h-1.5 w-12 shrink-0 rounded-full bg-surface-3 align-middle" aria-hidden="true">
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", accepted ? "bg-fg-muted" : "bg-bad")}
        style={{ width: `${Math.min(1, ratio) * 100}%` }}
      />
      <span className="absolute -inset-y-0.5 w-px bg-fg-subtle" style={{ left: `${MIN_INLIER_RATIO * 100}%` }} />
    </span>
  );
}

export function ResultCell({ accepted, reason, compact }: { accepted: boolean; reason?: string; compact?: boolean }) {
  return accepted ? (
    <span className="inline-flex items-center gap-1 text-ok">
      <IconCheck size={12} /> <span className={cn("font-sans text-xs", compact && "sr-only xl:not-sr-only")}>Accepted</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-bad" title={reason}>
      <IconX size={12} /> <span className={cn("font-sans text-xs", compact && "sr-only xl:not-sr-only")}>Rejected</span>
    </span>
  );
}

/** Streaming per-step table for the live view. Newest at the bottom. */
export function LiveStepsTable({
  steps,
  total,
  emptyHint,
}: {
  steps: StepResult[];
  total: number | null;
  emptyHint: string;
}) {
  const { ref, onScroll, paused, newCount, resume } = useStickToBottom(steps.length);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto" tabIndex={0} aria-label="Dense matching steps">
        <table className="num w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10 bg-surface-1 text-2xs text-fg-subtle uppercase">
            <tr className="[&>th]:h-7 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:font-medium [&>th]:tracking-wide">
              <th className="w-10 text-right">#</th>
              <th className="text-left">Frame pair</th>
              <th className="hidden text-right xl:table-cell">Gap</th>
              <th className="text-left">Inlier ratio</th>
              <th className="text-left">Result</th>
              <th className="text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr
                key={s.step}
                className={cn(
                  "row-in [&>td]:h-7 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-2",
                  !s.accepted && "bg-bad-soft",
                )}
              >
                <td className="text-right text-fg-subtle">{s.step}</td>
                <td className="whitespace-nowrap text-fg">
                  {fmtFrame(s.fromFrame)} <span className="text-fg-subtle">→</span> {fmtFrame(s.toFrame)}
                </td>
                <td className="hidden text-right text-fg-muted xl:table-cell">{s.gap}</td>
                <td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className={s.accepted ? "text-fg" : "text-bad"}>{fmtRatio(s.inlierRatio)}</span>
                    <span className="hidden xl:inline-flex">
                      <InlierBar ratio={s.inlierRatio} accepted={s.accepted} />
                    </span>
                  </span>
                </td>
                <td>
                  <ResultCell accepted={s.accepted} reason={s.rejectReason} compact />
                </td>
                <td className="text-right whitespace-nowrap text-fg-muted">{fmtDuration(s.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {steps.length === 0 && <div className="px-3 py-6 text-center text-xs text-fg-subtle">{emptyHint}</div>}
      </div>
      <div className="num flex h-7 shrink-0 items-center justify-between border-t border-line px-2 text-2xs text-fg-subtle">
        <span>
          {fmtInt(steps.length)}
          {total != null && ` / ${fmtInt(total)}`} steps
          {steps.some((s) => !s.accepted) && <span className="ml-2 text-bad">{steps.filter((s) => !s.accepted).length} rejected</span>}
        </span>
        <span>
          inlier threshold <span className="text-fg-muted">{MIN_INLIER_RATIO.toFixed(2)}</span>
        </span>
      </div>
      {paused && (
        <button
          type="button"
          onClick={resume}
          className="absolute right-3 bottom-9 inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-fg shadow-pop"
        >
          <IconArrowDown size={12} /> {newCount > 0 ? `${newCount} new` : "Latest"}
        </button>
      )}
    </div>
  );
}
