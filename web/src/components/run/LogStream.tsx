"use client";

import { useEffect, useState } from "react";
import type { LogLevel, RunSummary, StageId } from "@/services";
import type { LogLine } from "@/lib/runReducer";
import { copyText } from "@/lib/export/download";
import { downloadArtifact } from "@/lib/export/runExports";
import { toast } from "@/components/ui/toast";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { fmtOffset } from "@/lib/format";
import { IconArrowDown } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";

const LEVEL: Record<LogLevel, { tag: string; cls: string }> = {
  debug: { tag: "DBG", cls: "text-fg-subtle" },
  info: { tag: "INF", cls: "text-fg-muted" },
  warn: { tag: "WRN", cls: "text-warn" },
  error: { tag: "ERR", cls: "text-bad" },
};

export function LogStream({
  logs,
  originIso,
  run,
  jump,
}: {
  logs: LogLine[];
  originIso: string;
  run?: RunSummary;
  /** Scroll to the first line of a stage; `n` changes on every request. */
  jump?: { id: StageId; n: number } | null;
}) {
  const [showDebug, setShowDebug] = useState(false);
  const visible = showDebug ? logs : logs.filter((l) => l.level !== "debug");
  const { ref, onScroll, paused, newCount, resume } = useStickToBottom(visible.length);
  const origin = new Date(originIso).getTime();
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
    if (!jump) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-stage="${jump.id}"]`);
    if (!el) {
      toast({ tone: "info", title: `No ${jump.id.toUpperCase()} lines in the visible log`, duration: 1800 });
      return;
    }
    el.scrollIntoView({ block: "start" });
    const seq = Number(el.dataset.seq);
    const t0 = setTimeout(() => setFlash(seq), 0);
    const t1 = setTimeout(() => setFlash(null), 1500);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n]);

  const copyVisible = async () => {
    const text = visible.map((l) => `${fmtOffset(new Date(l.ts).getTime() - origin)} ${LEVEL[l.level].tag} ${l.stage ? `[${l.stage}] ` : ""}${l.message}`).join("\n");
    const ok = await copyText(text);
    toast({ tone: ok ? "info" : "bad", title: ok ? `Copied ${visible.length} log lines` : "Copy failed", duration: 1800 });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={ref}
        onScroll={onScroll}
        className="num min-h-0 flex-1 overflow-auto py-1 text-xs leading-5"
        role="log"
        aria-live="off"
        aria-label="Pipeline log"
        tabIndex={0}
      >
        {visible.length === 0 && <div className="px-3 py-6 text-center font-sans text-fg-subtle">Waiting for output…</div>}
        {visible.map((l) => (
          <div
            key={l.seq}
            data-stage={l.stage ?? undefined}
            data-seq={l.seq}
            className={cn(
              "row-in grid grid-cols-[auto_auto_1fr] gap-x-2 px-3 sm:grid-cols-[auto_auto_5.75rem_1fr]",
              l.level === "error" && "bg-bad-soft",
              flash === l.seq && "bg-accent-soft",
            )}
          >
            <span className="text-fg-subtle">{fmtOffset(new Date(l.ts).getTime() - origin)}</span>
            <span className={LEVEL[l.level].cls}>{LEVEL[l.level].tag}</span>
            <span className="hidden truncate text-fg-subtle sm:inline">{l.stage ? `[${l.stage}]` : ""}</span>
            <span className={cn("min-w-0 break-words", l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-fg")}>
              {l.message}
            </span>
          </div>
        ))}
      </div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-line px-2 text-2xs text-fg-subtle">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            className="size-3 accent-(--accent)"
            checked={showDebug}
            onChange={(e) => setShowDebug(e.target.checked)}
          />
          debug lines
        </label>
        <span className="num flex items-center gap-2">
          <span className="hidden sm:inline">
            {paused ? <span className="text-warn">auto-scroll paused</span> : "following"} · {visible.length} lines
          </span>
          <button type="button" onClick={copyVisible} className="rounded-sm px-1 text-fg-muted hover:bg-surface-3 hover:text-fg" aria-label="Copy log to clipboard">
            copy
          </button>
          {run && (
            <button
              type="button"
              className="rounded-sm px-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
              aria-label="Download run.log (full worker output, including tracebacks)"
              onClick={async () => {
                try {
                  await downloadArtifact(run.id, "run.log");
                } catch (e) {
                  toast({ tone: "bad", title: "Log download failed", body: (e as Error).message });
                }
              }}
            >
              run.log
            </button>
          )}
        </span>
      </div>
      {paused && (
        <button
          type="button"
          onClick={resume}
          className="absolute right-3 bottom-9 inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-fg shadow-pop"
        >
          <IconArrowDown size={12} /> {newCount > 0 ? `${newCount} new lines` : "Jump to latest"}
        </button>
      )}
    </div>
  );
}
