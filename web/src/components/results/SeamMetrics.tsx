"use client";

import type { RunMetrics } from "@/services";
import { getPipelineService } from "@/services";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/primitives";
import { Unmeasured } from "@/components/pairs/cause";

/** The notebook's seam-line metrics, under the notebook's own names (run_variants / measure / slc_variant). */
const ROWS: { key: string; note: string; digits: number }[] = [
  { key: "slc_frac_disagree", note: "fraction of seam pixels with source NCC < 0.5 (lower = better, notebook)", digits: 4 },
  { key: "slc_p10", note: "10th percentile of the seam NCC", digits: 3 },
  { key: "slc_mean", note: "mean seam NCC", digits: 3 },
  { key: "slc_n", note: "seam pixels scored (≤ 400 per frame pair)", digits: 0 },
  { key: "slc_skipped", note: "seam pixels skipped (too little overlap or texture in the window)", digits: 0 },
  { key: "seam_step", note: "mean |intensity step| across the seam, 3 px along the normal", digits: 2 },
  { key: "bg_step", note: "the same statistic at random non-seam pixels", digits: 2 },
  { key: "seam_step_ratio", note: "seam_step / bg_step", digits: 3 },
  { key: "sharp_overlap", note: "Laplacian variance over pixels covered by ≥ 2 frames", digits: 1 },
  { key: "seam_ratio", note: "gradient in a 3 px seam band / interior gradient", digits: 3 },
  { key: "seam_new_frac", note: "share of overlap pixels given to the newer frame", digits: 3 },
  { key: "seam_fallback", note: "steps composed first-wins (overlap < 50 px or seam net failed)", digits: 0 },
  { key: "sem_degenerate", note: "hybrid steps where the semantic cost was degenerate", digits: 0 },
  { key: "t_compose_s", note: "route-and-blend time for this variant, s", digits: 2 },
  { key: "t_slc_s", note: "SLC scoring time, s", digits: 2 },
];

const fmt = (v: number | null | undefined, d: number) => (v == null ? null : d === 0 ? String(Math.round(v)) : v.toFixed(d));

export function SeamMetrics({ m }: { m: RunMetrics }) {
  const seam = m.composition.seam;
  const sweep = m.composition.sweep;
  const svc = getPipelineService();
  if (!seam) return <p className="p-3 text-xs text-fg-muted">This run has no seam-line metrics recorded.</p>;
  return (
    <div className="flex flex-col gap-3 p-3">
      <dl className="num grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {ROWS.filter((r) => r.key in seam).map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1">
            <Tooltip content={r.note}>
              <dt className="cursor-help text-fg-muted">{r.key}</dt>
            </Tooltip>
            <dd className="text-fg">{fmt(seam[r.key], r.digits) ?? <Unmeasured why="Not computed for this composition (e.g. no seams)" />}</dd>
          </div>
        ))}
      </dl>
      {sweep && sweep.length > 0 && (
        <div>
          <div className="text-2xs tracking-wide text-fg-subtle uppercase">Hybrid sweep · every w_sem at bias 0.0, as the notebook does</div>
          <table className="num mt-1 w-full text-xs">
            <thead className="text-2xs text-fg-subtle">
              <tr className="border-b border-line [&>th]:py-1 [&>th]:text-left [&>th]:font-normal">
                <th>w_sem</th>
                <th>variant</th>
                <th>
                  slc_frac_disagree{" "}
                  <span className="font-sans text-warn" title="Chosen on the evaluation signal">
                    ⚠ selected on this video
                  </span>
                </th>
                <th>slc_p10</th>
                <th>seam_step</th>
                <th>mosaic</th>
              </tr>
            </thead>
            <tbody>
              {sweep.map((x) => (
                <tr key={x.name} className={cn("border-b border-line/50 [&>td]:py-1", x.lowestSlc && "bg-surface-2")}>
                  <td>{x.wSem}</td>
                  <td>{x.name}</td>
                  <td>
                    {fmt(x.seam.slc_frac_disagree, 4) ?? "—"}
                    {x.lowestSlc && <span className="ml-2 font-sans text-2xs text-fg-muted">lowest on this video</span>}
                  </td>
                  <td>{fmt(x.seam.slc_p10, 3) ?? "—"}</td>
                  <td>{fmt(x.seam.seam_step, 2) ?? "—"}</td>
                  <td>
                    <a href={svc.url(x.previewUrl)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      view
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-2xs text-warn">
            The lowest-SLC w_sem is picked by SLC computed on this same video: tuning on the evaluation signal, with no held-out protocol. That is the
            notebook&apos;s exploratory procedure. A hybrid number presented as a result needs a fixed w_sem chosen by a documented rule, or a
            leave-one-video-out selection (as for ω). The mosaic and coverage shown for this run use the lowest-SLC w_sem, for inspection only; it is
            not carried forward as a default.
          </p>
        </div>
      )}
    </div>
  );
}
