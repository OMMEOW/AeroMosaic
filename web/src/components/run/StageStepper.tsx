"use client";

import type { StageId, StageState } from "@/services";
import { fmtDuration, fmtInt } from "@/lib/format";
import { IconAlert, IconCheck, IconStop } from "@/components/ui/icons";
import { cn, Tooltip } from "@/components/ui/primitives";

export const STAGE_META: Record<StageId, { label: string; short: string; help: string }> = {
  decode: { label: "Decode", short: "DEC", help: "Read every frame at the native frame rate." },
  probe: { label: "Probe", short: "PRB", help: "Cheap SIFT check on candidate frame pairs (~9 ms per pair)." },
  select: { label: "Select", short: "SEL", help: "Pick the smallest set of frames that still chain together." },
  match: { label: "Match", short: "MAT", help: "Dense neural matching (DKM) on selected pairs only — ~5 s per pair. The slow stage." },
  composite: { label: "Composite", short: "CMP", help: "Warp accepted frames into one mosaic canvas." },
  evaluate: { label: "Evaluate", short: "EVL", help: "Score ground coverage against the reference." },
};

function stageDuration(s: StageState, nowMs: number) {
  if (!s.startedAt) return null;
  const start = new Date(s.startedAt).getTime();
  const end = s.finishedAt ? new Date(s.finishedAt).getTime() : nowMs;
  return Math.max(0, end - start);
}

function StatusGlyph({ status }: { status: StageState["status"] }) {
  switch (status) {
    case "done":
      return <IconCheck size={12} className="text-ok" />;
    case "failed":
      return <IconAlert size={12} className="text-bad" />;
    case "cancelled":
      return <IconStop size={11} className="text-warn" />;
    case "active":
      return <span className="pulse-dot size-1.5 rounded-full bg-accent" />;
    default:
      return <span className="size-1.5 rounded-full border border-fg-subtle" />;
  }
}

const STATUS_WORD: Record<StageState["status"], string> = {
  pending: "pending",
  active: "in progress",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export function StageStepper({
  stages,
  nowMs,
  focused = null,
  onPick,
}: {
  stages: StageState[];
  nowMs: number;
  /** Stage the log is jumped to (keyboard [ / ] or click). */
  focused?: StageId | null;
  onPick?: (id: StageId) => void;
}) {
  const active = stages.find((s) => s.status === "active" || s.status === "failed" || s.status === "cancelled");

  return (
    <div className="rounded-lg border border-line bg-surface-1">
      <ol className="grid grid-cols-6" aria-label="Pipeline stages">
        {stages.map((s, i) => {
          const meta = STAGE_META[s.id];
          const dur = stageDuration(s, nowMs);
          const bar =
            s.status === "active"
              ? "bg-accent"
              : s.status === "done"
                ? "bg-fg-subtle"
                : s.status === "failed"
                  ? "bg-bad"
                  : s.status === "cancelled"
                    ? "bg-warn"
                    : "bg-transparent";
          const fill = s.status === "pending" ? 0 : s.status === "done" ? 1 : (s.progress ?? (s.status === "active" ? 0.08 : 1));
          return (
            <li
              key={s.id}
              aria-current={s.status === "active" ? "step" : undefined}
              aria-label={`${meta.label}: ${STATUS_WORD[s.status]}`}
              onClick={() => onPick && s.status !== "pending" && onPick(s.id)}
              className={cn(
                "relative min-w-0 px-2 pt-2 pb-2.5 sm:px-3",
                i > 0 && "border-l border-line",
                s.status === "active" && "bg-accent-soft/60",
                onPick && s.status !== "pending" && "cursor-pointer hover:bg-surface-2",
                focused === s.id && "outline outline-1 -outline-offset-1 outline-fg-subtle",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <Tooltip content={meta.help} side="bottom">
                  <span
                    tabIndex={0}
                    className={cn(
                      "flex min-w-0 cursor-default items-center gap-1.5 rounded-sm text-2xs font-semibold tracking-wider uppercase",
                      s.status === "pending" ? "text-fg-subtle" : s.status === "active" ? "text-accent" : "text-fg",
                    )}
                  >
                    <span className="num hidden font-normal text-fg-subtle sm:inline">{String(i + 1).padStart(2, "0")}</span>
                    <span className="hidden truncate md:inline">{meta.label}</span>
                    <span className="md:hidden">{meta.short}</span>
                  </span>
                </Tooltip>
                <span className="flex size-3 shrink-0 items-center justify-center">
                  <StatusGlyph status={s.status} />
                </span>
              </div>
              <div className="num mt-1 hidden h-4 truncate text-2xs text-fg-muted sm:block">
                {s.counter ? (
                  <>
                    {fmtInt(s.counter.done)}
                    {s.counter.total != null && s.id !== "select" && <span className="text-fg-subtle"> / {fmtInt(s.counter.total)}</span>}
                    <span className="text-fg-subtle"> {s.counter.unit}</span>
                  </>
                ) : s.status === "active" ? (
                  <span className="text-fg-subtle">working…</span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </div>
              <div className="num mt-0.5 hidden h-4 text-2xs text-fg-subtle sm:block">{dur != null ? fmtDuration(dur) : ""}</div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-3">
                <div className={cn("h-full transition-[width] duration-300 ease-out", bar)} style={{ width: `${fill * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      {/* Compact detail line for narrow screens, where cells only show glyphs. */}
      {active && (
        <div className="num flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-2xs text-fg-muted sm:hidden">
          <span className="font-sans font-semibold tracking-wider text-fg uppercase">
            {STAGE_META[active.id].label}
            <span className="ml-1.5 font-normal tracking-normal text-fg-subtle normal-case">{STATUS_WORD[active.status]}</span>
          </span>
          <span>
            {active.counter && (
              <>
                {fmtInt(active.counter.done)}
                {active.counter.total != null && ` / ${fmtInt(active.counter.total)}`} {active.counter.unit}
              </>
            )}
            {stageDuration(active, nowMs) != null && <span className="ml-2 text-fg-subtle">{fmtDuration(stageDuration(active, nowMs))}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
