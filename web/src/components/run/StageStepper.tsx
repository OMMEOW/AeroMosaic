"use client";

import { STAGE_GROUP, type StageId } from "@/services";
import type { StageState } from "@/lib/runReducer";
import { fmtDuration, fmtInt } from "@/lib/format";
import { IconAlert, IconCheck, IconStop } from "@/components/ui/icons";
import { cn, Tooltip } from "@/components/ui/primitives";

export const STAGE_META: Record<StageId, { label: string; short: string; help: string }> = {
  preflight: { label: "Preflight", short: "PRE", help: "Checks the requested composition variant can run (SemanticStitch needs its verified checkpoint) and that DKM weights are present." },
  selftest: { label: "Self-test", short: "INV", help: "Inverts a batch of 2 × 1530² matrices on the device and compares with CPU; refuses to run DKM if the relative error exceeds 1e-3 (torch 2.13 MPS batched-inverse bug)." },
  decode: { label: "Decode", short: "DEC", help: "Every frame at the native rate, long edge ≤ 1920 (notebook cell 6). Shared per video file; 'cached' when reused." },
  sift: { label: "SIFT-500", short: "SFT", help: "SIFT-500 descriptors per frame: the probe budget and f_m's denominator (cell 7). Shared per video file." },
  probe: { label: "Probe + gate", short: "PRB", help: "Every candidate edge at gaps 1/2/4/8/16/32/64: proxy homography, f_m, f_u, IoU; kept iff IoU ≥ 0.40 and f_m ≥ 0.164 (cell 8)." },
  select: { label: "DAG path", short: "SEL", help: "Exact shortest path over surviving edges: fewest hops, then Σ gap² (cell 9)." },
  reference: { label: "Reference", short: "REF", help: "SIFT-4000 consecutive reference chain and A_observed: the fixed per-run coverage denominator (cells 10–11)." },
  dkm: { label: "DKM", short: "DKM", help: "DKMv3 outdoor on planned pairs, dual-layer constraint (τs 3.0 → τr 4.0), accept iff inlier ratio ≥ 0.35; re-plan on rejection (cells 13–16). The expensive stage." },
  composite: { label: "Composite", short: "CMP", help: "Warp accepted frames and compose with the chosen variant (cell 27/39)." },
  coverage: { label: "Coverage", short: "COV", help: "Absolute coverage |A_method ∩ A_observed| / |A_observed| (cell 41)." },
};

export const GROUP_META: Record<0 | 1 | 2, { label: string; sub: string }> = {
  0: { label: "Preflight", sub: "" },
  1: { label: "Stage 1 · pre-DKM selection", sub: "cheap, SIFT" },
  2: { label: "Stage 2 · DKM + evaluation", sub: "expensive" },
};

function stageDuration(s: StageState, nowMs: number) {
  if (s.status === "done" && s.durationMs != null) return s.durationMs;
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

  const groups = ([0, 1, 2] as const).map((g) => ({ g, stages: stages.filter((s) => STAGE_GROUP[s.id] === g) }));
  return (
    <div className="rounded-lg border border-line bg-surface-1">
      <div className="grid grid-cols-[2fr_4fr_4fr]" aria-label="Pipeline stages">
        {groups.map(({ g, stages: gs }) => (
          <div key={g} className={cn("min-w-0", g > 0 && "border-l-2 border-line-strong")}>
            <div className="flex h-6 items-center gap-1.5 truncate border-b border-line px-2 text-2xs font-medium tracking-wide text-fg-subtle uppercase sm:px-3">
              <span className="truncate text-fg-muted">{GROUP_META[g].label}</span>
              {GROUP_META[g].sub && <span className="hidden truncate normal-case lg:inline">· {GROUP_META[g].sub}</span>}
            </div>
            <ol className="grid" style={{ gridTemplateColumns: `repeat(${gs.length}, minmax(0, 1fr))` }}>
        {gs.map((s, i) => {
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
                  <span className="text-fg-subtle">{s.cached ? "cached" : s.status === "done" ? "" : "—"}</span>
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
          </div>
        ))}
      </div>
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
