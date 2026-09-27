"use client";

import { useMemo, useRef, useState } from "react";
import type { CandidateEdge, Stage1Cause } from "@/services";
import { cn } from "@/components/ui/cn";
import { CAUSE_META, Num, STAGE1_CAUSES, Verdict } from "./cause";

type Filter = "all" | "passing" | Stage1Cause | "path" | "iou-shadow";
const ROW = 28;

/**
 * Stage 1: every candidate edge the cheap probe evaluated, with why it was kept or dropped.
 * Windowed (only visible rows render), so 10k+ edges stay responsive.
 */
export function EdgesTable({
  edges,
  omega,
  iouTrust,
  height = 360,
  gaps,
}: {
  edges: CandidateEdge[];
  omega: number;
  iouTrust: number;
  height?: number;
  gaps: number[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [gap, setGap] = useState<number | "all">("all");
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: edges.length, passing: 0, path: 0, "iou-shadow": 0 };
    for (const e of edges) {
      if (!e.rejectCause) c.passing++;
      else c[e.rejectCause] = (c[e.rejectCause] ?? 0) + 1;
      if (e.onPlannedPath) c.path++;
      if (e.rejectCause === "GATE_IOU" && e.fmPasses) c["iou-shadow"]++;
    }
    return c;
  }, [edges]);

  const rows = useMemo(
    () =>
      edges.filter((e) => {
        if (gap !== "all" && e.gap !== gap) return false;
        if (filter === "all") return true;
        if (filter === "passing") return !e.rejectCause;
        if (filter === "path") return e.onPlannedPath;
        if (filter === "iou-shadow") return e.rejectCause === "GATE_IOU" && e.fmPasses === true;
        return e.rejectCause === filter;
      }),
    [edges, filter, gap],
  );

  const first = Math.max(0, Math.floor(top / ROW) - 10);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW) + 10);

  const chip = (id: Filter, label: string, n: number | undefined, title?: string) => (
    <button
      key={id}
      type="button"
      title={title}
      onClick={() => {
        setFilter(id);
        box.current?.scrollTo({ top: 0 });
      }}
      aria-pressed={filter === id}
      className={cn(
        "num h-6 rounded-sm border px-2 text-2xs whitespace-nowrap",
        filter === id ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg",
      )}
    >
      {label} <span className="text-fg-subtle">{(n ?? 0).toLocaleString()}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {chip("all", "All", counts.all)}
        {chip("passing", "Pass gate", counts.passing)}
        {STAGE1_CAUSES.map((c) => chip(c, CAUSE_META[c].label, counts[c]))}
        {chip("path", "On planned path", counts.path)}
        {chip(
          "iou-shadow",
          "IoU-rejected, f_m would pass",
          counts["iou-shadow"],
          "Edges where the IoU trust check did independent work: f_m alone would have passed the gate.",
        )}
        <label className="ml-auto flex items-center gap-1.5 text-2xs text-fg-muted">
          gap
          <select
            value={gap}
            onChange={(e) => setGap(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="h-6 rounded-sm border border-line bg-surface-2 px-1 text-2xs text-fg"
          >
            <option value="all">all</option>
            {gaps.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="num grid grid-cols-[92px_44px_60px_60px_60px_52px_minmax(0,1fr)] gap-x-2 border-b border-line px-3 py-1.5 text-2xs text-fg-subtle uppercase">
        <span>edge</span>
        <span className="text-right">gap</span>
        <span className="text-right" title="f_m = putative / 500; gate ω">
          f_m
        </span>
        <span className="text-right" title="diagnostic only, not gated">
          f_u
        </span>
        <span className="text-right">IoU</span>
        <span className="text-right" title="SIFT ratio-test matches">
          n_put
        </span>
        <span>verdict</span>
      </div>
      <div ref={box} className="relative overflow-auto" style={{ height }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-muted">No edges match this filter.</p>
        ) : (
          <div style={{ height: rows.length * ROW, position: "relative" }}>
            {rows.slice(first, last).map((e, k) => (
              <div
                key={`${e.frameI}-${e.frameJ}`}
                className={cn(
                  "absolute inset-x-0 grid grid-cols-[92px_44px_60px_60px_60px_52px_minmax(0,1fr)] items-center gap-x-2 border-b border-line/50 px-3 text-xs",
                  e.onPlannedPath && "bg-accent-soft/40",
                )}
                style={{ top: (first + k) * ROW, height: ROW }}
              >
                <span className="num truncate">
                  {e.frameI}→{e.frameJ}
                  {e.onPlannedPath && (
                    <span className="ml-1 text-accent" title="hop of the initial DAG shortest path">
                      ●
                    </span>
                  )}
                </span>
                <span className="num text-right text-fg-muted">{e.gap}</span>
                <span className={cn("text-right", e.fmPasses === false && "text-accent")}>
                  <Num v={e.fm} why="Not computed: fewer than 2 SIFT descriptors in a frame" />
                </span>
                <span className="text-right text-fg-muted">
                  <Num v={e.fu} why="Not computed: the proxy homography was never fitted" />
                </span>
                <span className={cn("text-right", e.iouPasses === false && "text-warn")}>
                  <Num v={e.proxyIou} digits={2} why="Not computed: the proxy homography was never fitted" />
                </span>
                <span className="text-right text-fg-muted">
                  {e.nPutative == null ? <Num v={null} why="Not computed: too few descriptors" /> : <span className="num">{e.nPutative}</span>}
                </span>
                <span className="min-w-0">
                  <Verdict r={e} omega={omega} iouTrust={iouTrust} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="num border-t border-line px-3 py-1.5 text-2xs text-fg-subtle">
        {rows.length.toLocaleString()} of {edges.length.toLocaleString()} candidate edges
      </div>
    </div>
  );
}
