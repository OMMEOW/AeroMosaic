"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { DkmAttempt } from "@/services";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { Num, Verdict } from "./cause";

/**
 * Stage 2: every pair actually sent to DKM, in attempt order, with the dual-layer outcome.
 * Click a row for the full record. Follows the newest attempt while live unless scrolled up.
 */
export function AttemptsTable({
  attempts,
  live = false,
  emptyHint,
  className,
}: {
  attempts: DkmAttempt[];
  live?: boolean;
  emptyHint: string;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (live && stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [attempts.length, live]);

  if (!attempts.length) return <p className="px-3 py-6 text-center text-xs text-fg-muted">{emptyHint}</p>;

  return (
    <div
      ref={box}
      className={cn("h-full overflow-auto", className)}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      <table className="w-full text-xs">
        <thead className="num sticky top-0 z-10 bg-surface-1 text-2xs text-fg-subtle uppercase">
          <tr className="border-b border-line">
            <th className="px-3 py-1.5 text-left font-normal">#</th>
            <th className="px-2 py-1.5 text-left font-normal">pair</th>
            <th className="px-2 py-1.5 text-right font-normal">gap</th>
            <th className="px-2 py-1.5 text-right font-normal" title="probe f_m of this edge">
              f_m
            </th>
            <th className="px-2 py-1.5 text-right font-normal" title="inliers / post-epipolar matches">
              ratio
            </th>
            <th className="hidden px-2 py-1.5 text-right font-normal md:table-cell">inliers</th>
            <th className="hidden px-2 py-1.5 text-right font-normal lg:table-cell" title="median reprojection residual, px">
              resid
            </th>
            <th className="px-2 py-1.5 text-right font-normal">time</th>
            <th className="px-3 py-1.5 text-left font-normal">verdict</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <Fragment key={a.attempt}>
              <tr
                onClick={() => setOpen(open === a.attempt ? null : a.attempt)}
                className={cn("cursor-pointer border-b border-line/50 hover:bg-surface-2", open === a.attempt && "bg-surface-2")}
              >
                <td className="num px-3 py-1 text-fg-muted">
                  {a.attempt}
                  {a.replanned && (
                    <span className="ml-1 text-warn" title="re-planned after the previous attempt was rejected">
                      ↻
                    </span>
                  )}
                </td>
                <td className="num px-2 py-1">
                  {a.frameI}→{a.frameJ}
                </td>
                <td className="num px-2 py-1 text-right text-fg-muted">{a.gap}</td>
                <td className="px-2 py-1 text-right text-fg-muted">
                  <Num v={a.fm} />
                </td>
                <td className={cn("px-2 py-1 text-right", a.rejectCause === "RATIO_BELOW_MIN" && "text-warn")}>
                  <Num v={a.inlierRatio} why="No homography was fitted, so there is no inlier ratio" />
                </td>
                <td className="hidden px-2 py-1 text-right text-fg-muted md:table-cell">
                  {a.nInliers == null ? <Num v={null} why="No homography was fitted" /> : <span className="num">{a.nInliers.toLocaleString()}</span>}
                </td>
                <td className="hidden px-2 py-1 text-right text-fg-muted lg:table-cell">
                  <Num v={a.residMedianPx} digits={2} why="No homography was fitted" />
                </td>
                <td className="num px-2 py-1 text-right text-fg-muted">{fmtDuration(a.durationMs)}</td>
                <td className="px-3 py-1">
                  <Verdict r={a} />
                </td>
              </tr>
              {open === a.attempt && (
                <tr className="border-b border-line bg-surface-2">
                  <td colSpan={9} className="px-3 py-2">
                    <dl className="num grid grid-cols-2 gap-x-6 gap-y-1 text-2xs sm:grid-cols-4">
                      <Field k="f_u (diagnostic)" v={<Num v={a.fu} />} />
                      <Field k="proxy IoU" v={<Num v={a.proxyIou} digits={2} />} />
                      <Field k="DKM samples" v={a.nMatches?.toLocaleString() ?? <Num v={null} />} />
                      <Field
                        k="after epipolar (τs 3.0)"
                        v={a.nEpipolar == null ? <Num v={null} /> : `${a.nEpipolar.toLocaleString()}${a.epipolarOk === false ? " (no F: all kept)" : ""}`}
                      />
                      <Field k="inliers (τr 4.0)" v={a.nInliers?.toLocaleString() ?? <Num v={null} why="No homography" />} />
                      <Field k="resid p95, px" v={<Num v={a.residP95Px} digits={2} why="No homography" />} />
                      <Field k="d_geo p95" v={<Num v={a.dGeoP95} digits={2} why="Computed for accepted steps only" />} />
                      <Field k="estimator" v={a.estimator ?? <Num v={null} />} />
                    </dl>
                    {a.rejectDetail && <p className="mt-1.5 text-2xs text-fg-muted">{a.rejectDetail}</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-subtle">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  );
}
