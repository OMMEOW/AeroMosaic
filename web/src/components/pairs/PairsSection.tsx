"use client";

import { useState } from "react";
import type { LivePair } from "@/lib/runReducer";
import { cn } from "@/components/ui/cn";
import { Panel, Tooltip } from "@/components/ui/primitives";
import { CAUSE_META } from "./cause";
import { PairPanel } from "./PairPanel";

function chipTone(p: LivePair) {
  if (!p.record) return "border-accent bg-accent-soft text-accent";
  if (p.record.accepted) return "border-ok/50 bg-ok-soft text-ok";
  if (p.record.rejectCause === "RATIO_BELOW_MIN") return "border-warn/60 bg-warn-soft text-warn";
  if (p.record.rejectCause === "EXCEPTION") return "border-bad bg-bad text-bg";
  return "border-bad/60 bg-bad-soft text-bad";
}

/**
 * Filmstrip of every attempted pair (colour = outcome) and the panel for the selected one.
 * Follows the newest pair while live, unless one is picked. Rebuilt from events.jsonl and
 * artifacts on disk, so it works after the run and after a refresh.
 */
export function PairsSection({ pairs, live, title = "Pairs", videoId }: { pairs: LivePair[]; live: boolean; title?: string; videoId?: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const sel = pairs.find((p) => p.attempt === picked) ?? pairs[pairs.length - 1] ?? null;
  const pruned = pairs.filter((p) => p.pruned).length;

  return (
    <Panel
      title={`${title}${pairs.length ? ` · ${pairs.length}` : ""}`}
      actions={
        picked != null && live ? (
          <button type="button" className="text-2xs text-accent normal-case hover:underline" onClick={() => setPicked(null)}>
            follow latest
          </button>
        ) : undefined
      }
    >
      {pairs.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-fg-muted">Pair panels appear when the first DKM attempt starts.</p>
      ) : (
        <>
          <div className="overflow-x-auto border-b border-line" tabIndex={0} aria-label="Attempted pairs">
            <ol className="flex gap-1 p-2">
              {pairs.map((p) => (
                <li key={p.attempt}>
                  <Tooltip
                    content={
                      p.record
                        ? `#${p.attempt} ${p.start.frameI}→${p.start.frameJ}: ${p.record.accepted ? "accepted" : CAUSE_META[p.record.rejectCause!].label}${p.pruned ? " · overlays pruned" : ""}`
                        : `#${p.attempt} in progress`
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setPicked(p.attempt)}
                      aria-pressed={sel?.attempt === p.attempt}
                      className={cn(
                        "num h-7 rounded-sm border px-1.5 text-2xs whitespace-nowrap",
                        chipTone(p),
                        p.pruned && "border-dashed opacity-60",
                        sel?.attempt === p.attempt && "ring-2 ring-fg/60",
                        !p.record && "pulse-dot",
                      )}
                    >
                      {p.start.frameI}→{p.start.frameJ}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ol>
            {pruned > 0 && (
              <p className="px-3 pb-2 text-2xs text-fg-subtle">
                Overlays pruned for {pruned} older accepted pair{pruned > 1 ? "s" : ""} (kept: the most recent 50 and every rejected pair).
              </p>
            )}
          </div>
          {sel && <PairPanel key={sel.attempt} pair={sel} videoId={videoId} live={live && sel.attempt === pairs[pairs.length - 1]?.attempt} />}
        </>
      )}
    </Panel>
  );
}
