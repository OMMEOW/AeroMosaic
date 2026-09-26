"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StepResult } from "@/services";
import { fmtDuration, fmtFrame, fmtInt, fmtRatio, fmtScale, fmtShear } from "@/lib/format";
import { IconSort } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { Copyable } from "@/components/ui/misc";
import { InlierBar, ResultCell } from "@/components/run/StepsTable";

type Key = "step" | "gap" | "fm" | "inlier" | "matches" | "inliers" | "result" | "time" | "gscale" | "gshear";

const COLS: { key: Key; label: string; get: (s: StepResult) => number; cls?: string; title?: string }[] = [
  { key: "step", label: "#", get: (s) => s.step },
  { key: "gap", label: "Gap", get: (s) => s.gap, title: "Native frames skipped" },
  { key: "fm", label: "f_m / ω", get: (s) => s.fmScore, title: "Probe score of this edge vs the threshold it was judged against", cls: "hidden md:table-cell" },
  { key: "inlier", label: "Inlier ratio", get: (s) => s.inlierRatio },
  { key: "matches", label: "n_matches", get: (s) => s.nMatches, cls: "hidden xl:table-cell" },
  { key: "inliers", label: "n_inliers", get: (s) => s.nInliers, cls: "hidden lg:table-cell" },
  { key: "result", label: "Result", get: (s) => (s.accepted ? 1 : 0) },
  { key: "time", label: "Time", get: (s) => s.durationMs },
  { key: "gscale", label: "G_scale", get: (s) => s.gScale, cls: "hidden lg:table-cell" },
  { key: "gshear", label: "G_shear", get: (s) => s.gShear, cls: "hidden xl:table-cell" },
];

/** Sortable per-step table for finished runs. Rejected rows are tinted; `highlight` scrolls to a step. */
export function StepsTableFull({ steps, highlight, maxHeight = 460 }: { steps: StepResult[]; highlight?: number | null; maxHeight?: number }) {
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "step", dir: "asc" });
  const [onlyRejected, setOnlyRejected] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!;
    const list = onlyRejected ? steps.filter((s) => !s.accepted) : steps.slice();
    list.sort((a, b) => (col.get(a) - col.get(b)) * (sort.dir === "asc" ? 1 : -1) || a.step - b.step);
    return list;
  }, [steps, sort, onlyRejected]);

  useEffect(() => {
    if (highlight == null) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-step="${highlight}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }, [highlight]);

  const rejected = steps.filter((s) => !s.accepted).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-auto" style={{ maxHeight }}>
        <table className="num w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10 bg-surface-1 text-2xs text-fg-subtle uppercase">
            <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:font-medium [&>th]:tracking-wide">
              {COLS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} className={cn("text-left whitespace-nowrap", c.cls)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title={c.title}>
                    <button
                      type="button"
                      className={cn("inline-flex items-center gap-1 uppercase hover:text-fg", active && "text-fg")}
                      onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}
                    >
                      {c.label}
                      <IconSort size={10} dir={active ? sort.dir : null} />
                    </button>
                  </th>
                );
              })}
              <th className="text-left">Pair</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.step}
                data-step={s.step}
                tabIndex={-1}
                className={cn(
                  "[&>td]:h-8 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-2 focus:outline-none",
                  !s.accepted && "bg-bad-soft",
                  highlight === s.step && "outline outline-1 -outline-offset-1 outline-accent",
                )}
              >
                <td className="text-fg-subtle">{s.step}</td>
                <td className="text-fg-muted">
                  {s.gap}
                  {s.forced && <span className="ml-1 rounded-sm bg-warn-soft px-1 text-2xs text-warn">forced</span>}
                </td>
                <td className="hidden md:table-cell">
                  <span className={s.fmScore < s.omega ? "text-warn" : "text-fg"}>{fmtRatio(s.fmScore)}</span>
                  <span className="text-fg-subtle"> / {s.omega}</span>
                </td>
                <td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className={s.accepted ? "text-fg" : "text-bad"}>{fmtRatio(s.inlierRatio)}</span>
                    <span className="hidden 2xl:inline-flex">
                      <InlierBar ratio={s.inlierRatio} accepted={s.accepted} />
                    </span>
                  </span>
                </td>
                <td className="hidden text-fg-muted xl:table-cell">{fmtInt(s.nMatches)}</td>
                <td className="hidden text-fg-muted lg:table-cell">{fmtInt(s.nInliers)}</td>
                <td className="whitespace-nowrap">
                  <ResultCell accepted={s.accepted} reason={s.rejectReason} />
                  {!s.accepted && s.rejectReason && <div className="text-2xs text-bad/90">{s.rejectReason}</div>}
                </td>
                <td className="whitespace-nowrap text-fg-muted">{fmtDuration(s.durationMs)}</td>
                <td className="hidden lg:table-cell">{fmtScale(s.gScale)}</td>
                <td className="hidden xl:table-cell">{fmtShear(s.gShear)}</td>
                <td className="whitespace-nowrap">
                  <Copyable value={`${s.fromFrame},${s.toFrame}`} label="frame pair">
                    {fmtFrame(s.fromFrame)} <span className="text-fg-subtle">→</span> {fmtFrame(s.toFrame)}
                  </Copyable>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-3 py-6 text-center text-xs text-fg-subtle">{onlyRejected ? "No rejected steps." : "No steps."}</div>}
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-2 text-2xs text-fg-subtle">
        <span className="num">
          {steps.length} steps · <span className={rejected ? "text-bad" : ""}>{rejected} rejected</span>
        </span>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" className="size-3 accent-(--accent)" checked={onlyRejected} onChange={(e) => setOnlyRejected(e.target.checked)} />
          rejected only
        </label>
      </div>
    </div>
  );
}
