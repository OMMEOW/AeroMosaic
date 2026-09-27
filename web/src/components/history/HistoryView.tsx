"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getPipelineService, isTerminal, type RunStatus, type RunSummary } from "@/services";
import { useService } from "@/hooks/useAsync";
import { fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { VariantBadge } from "@/components/run/VariantBadge";
import { ReportPdfButton } from "@/components/results/ReportPdfButton";
import { useHealth } from "@/hooks/useHealth";
import { forgetRunData } from "@/components/results/RunDataContext";
import { IconAlert, IconPlus, IconSort, IconX } from "@/components/ui/icons";
import { ConfirmDialog, Copyable, EmptyState, RelTime } from "@/components/ui/misc";
import { Button, buttonClass, cn, Panel, RunStatusPill, Tooltip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type SortKey = "date" | "video" | "coverage" | "status" | "frames" | "runtime" | "dkm" | "slc";
const FILTERS: { id: "all" | RunStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "succeeded", label: "Succeeded" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "interrupted", label: "Interrupted" },
  { id: "running", label: "In progress" },
];

const inProgress = (s: RunStatus) => !isTerminal(s);

type Sort = { key: SortKey; dir: "asc" | "desc" };

function Th({ k, sort, setSort, children, className }: { k: SortKey; sort: Sort; setSort: (f: (s: Sort) => Sort) => void; children: React.ReactNode; className?: string }) {
  const active = sort.key === k;
  return (
    <th className={cn("text-left", className)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={cn("inline-flex items-center gap-1 uppercase hover:text-fg", active && "text-fg")}
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}
      >
        {children}
        <IconSort size={10} dir={active ? sort.dir : null} />
      </button>
    </th>
  );
}

function hrefFor(r: RunSummary) {
  return r.status === "succeeded" ? `/runs/${r.id}/results` : `/runs/${r.id}`;
}

export function HistoryView() {
  const router = useRouter();
  const runs = useService((svc) => svc.listRuns(), []);
  const health = useHealth();
  const [sort, setSort] = useState<Sort>({ key: "date", dir: "desc" });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const rows = useMemo(() => {
    const list = (runs.data ?? []).filter((r) => filter === "all" || (filter === "running" ? inProgress(r.status) : r.status === filter));
    const val = (r: RunSummary): number | string => {
      switch (sort.key) {
        case "date":
          return r.createdAt;
        case "video":
          return r.video.filename.toLowerCase();
        case "coverage":
          return r.metrics?.absoluteCoverage ?? -1;
        case "status":
          return r.status;
        case "frames":
          return r.metrics?.stage2.nComposited ?? -1;
        case "dkm":
          return r.metrics?.stage2.attempts ?? -1;
        case "slc":
          return r.metrics?.composition.seam?.slc_frac_disagree ?? 99;
        case "runtime":
          return r.metrics?.runtimeMs ?? -1;
      }
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (sort.dir === "asc" ? c : -c) || b.createdAt.localeCompare(a.createdAt);
    });
  }, [runs.data, sort, filter]);

  const doDelete = async (ids: string[]) => {
    const svc = getPipelineService();
    let ok = 0;
    for (const id of ids) {
      try {
        await svc.deleteRun(id);
        forgetRunData(id);
        ok++;
      } catch (e) {
        toast({ tone: "bad", title: `Could not delete ${id}`, body: (e as Error).message });
      }
    }
    if (ok) toast({ tone: "info", title: `Deleted ${ok} run${ok > 1 ? "s" : ""}` });
    setPicked((p) => p.filter((x) => !ids.includes(x)));
    runs.reload();
  };

  const pickedRuns = (runs.data ?? []).filter((r) => picked.includes(r.id));
  const compareReason = picked.length < 2 ? "Select 2–3 succeeded runs to compare." : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">History</h1>
        <div className="flex flex-wrap items-center gap-2">
          {picked.length > 0 && (
            <Button variant="danger" size="sm" onClick={() => setConfirm(picked)} icon={<IconX size={12} />}>
              Delete {picked.length}
            </Button>
          )}
          <Button
            size="sm"
            variant={picked.length >= 2 ? "primary" : "secondary"}
            disabledReason={compareReason}
            onClick={() => router.push(`/compare?runs=${picked.join(",")}`)}
          >
            Compare {picked.length ? `(${picked.length})` : ""}
          </Button>
          <Link href="/new" className={buttonClass("secondary", "sm")}>
            <IconPlus size={12} /> New run
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const n = (runs.data ?? []).filter((r) => f.id === "all" || (f.id === "running" ? inProgress(r.status) : r.status === f.id)).length;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-7 rounded-md border px-2.5 text-xs transition-colors",
                filter === f.id ? "border-accent-line bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg",
              )}
            >
              {f.label} <span className="num text-fg-subtle">{runs.data ? n : ""}</span>
            </button>
          );
        })}
      </div>

      <Panel>
        {runs.status === "error" && !runs.data ? (
          <EmptyState
            icon={<IconAlert size={18} />}
            title={health.status === "unreachable" ? "Backend unreachable" : "Could not load history"}
            body={runs.error.message}
            action={<Button onClick={runs.reload}>Retry</Button>}
          />
        ) : runs.data && runs.data.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body={`No run directories under ${health.status === "ok" ? health.health.runsRoot : "the runs root"}. Start a run on a video from the data root; every run is kept here, including failed ones.`}
            action={
              <Link href="/new" className={buttonClass("primary")}>
                Start a run
              </Link>
            }
          />
        ) : runs.data && rows.length === 0 ? (
          <EmptyState
            title={`No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} runs`}
            action={<Button onClick={() => setFilter("all")}>Show all runs</Button>}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="num w-full border-separate border-spacing-0 text-xs">
              <thead className="text-2xs text-fg-subtle uppercase">
                <tr className="[&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:font-medium [&>th]:tracking-wide">
                  <th className="w-8">
                    <span className="sr-only">Select for compare</span>
                  </th>
                  <Th sort={sort} setSort={setSort} k="status">Status</Th>
                  <Th sort={sort} setSort={setSort} k="video">Video</Th>
                  <Th sort={sort} setSort={setSort} k="date">Created</Th>
                  <Th sort={sort} setSort={setSort} k="coverage">Coverage</Th>
                  <Th sort={sort} setSort={setSort} k="frames" className="hidden md:table-cell">
                    Frames
                  </Th>
                  <Th sort={sort} setSort={setSort} k="dkm" className="hidden lg:table-cell">
                    DKM
                  </Th>
                  <th className="hidden text-left lg:table-cell">Compose</th>
                  <Th sort={sort} setSort={setSort} k="slc" className="hidden lg:table-cell">
                    <span title="notebook slc_frac_disagree (lower = better) · slc_p10 · seam_step">SLC · p10 · step</span>
                  </Th>
                  <Th sort={sort} setSort={setSort} k="runtime" className="hidden md:table-cell">
                    Runtime
                  </Th>
                  <th className="hidden text-left xl:table-cell">Config</th>
                  <th className="hidden w-14 md:table-cell">
                    <span className="sr-only">Report</span>
                  </th>
                  <th className="w-8">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!runs.data &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={13} className="h-11 border-b border-line/60 px-2">
                        <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                      </td>
                    </tr>
                  ))}
                {rows.map((r) => {
                  const m = r.metrics;
                  const canPick = r.status === "succeeded";
                  const isPicked = picked.includes(r.id);
                  const pickReason = !canPick ? "Only succeeded runs can be compared." : !isPicked && picked.length >= 3 ? "Compare at most 3 runs." : null;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => router.push(hrefFor(r))}
                      className={cn("cursor-pointer hover:bg-surface-2 [&>td]:h-11 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-2", isPicked && "bg-accent-soft")}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        {pickReason ? (
                          <Tooltip content={pickReason}>
                            <input type="checkbox" aria-label={`Select ${r.id} for compare (${pickReason})`} disabled className="size-3.5 cursor-not-allowed opacity-40" />
                          </Tooltip>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.id} for compare`}
                            checked={isPicked}
                            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                            className="size-3.5 accent-(--accent)"
                          />
                        )}
                      </td>
                      <td>
                        <RunStatusPill status={r.status} />
                      </td>
                      <td className="max-w-[240px]">
                        <Link href={hrefFor(r)} onClick={(e) => e.stopPropagation()} className="block truncate font-sans text-sm text-fg hover:underline">
                          {r.video.filename}
                        </Link>
                        <span onClick={(e) => e.stopPropagation()}>
                          <Copyable value={r.id} label="run ID" className="text-2xs text-fg-subtle" />
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-fg-muted">
                        <RelTime iso={r.createdAt} />
                      </td>
                      <td className="whitespace-nowrap">
                        {m ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-sm text-fg">{fmtPct(m.absoluteCoverage, 2)}</span>
                            {m.referenceChainBreaks > 0 && (
                              <Tooltip content={`${m.referenceChainBreaks} reference chain break(s): coverage denominator unreliable`}>
                                <span className="rounded-sm bg-warn-soft px-1 text-2xs text-warn">ref ⚠</span>
                              </Tooltip>
                            )}
                            {!m.stage2.reachedLast && (
                              <Tooltip content={`Chain stopped at frame ${m.stage2.lastFrame} of ${m.nativeFrames - 1}`}>
                                <span className="rounded-sm bg-warn-soft px-1 text-2xs text-warn">early stop</span>
                              </Tooltip>
                            )}
                          </span>
                        ) : r.status === "failed" || r.status === "interrupted" ? (
                          <span className="text-bad">
                            {r.status} · {(r.failedStage ?? r.error?.stage ?? "?").toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="hidden text-fg-muted md:table-cell">
                        {m ? (
                          <>
                            {fmtInt(m.stage2.nComposited)}
                            <span className="text-fg-subtle"> / {fmtInt(m.nativeFrames)}</span>
                          </>
                        ) : (
                          <span className="text-fg-subtle">{r.video.frameCount != null ? `${fmtInt(r.video.frameCount)} native` : "—"}</span>
                        )}
                      </td>
                      <td className="hidden text-fg-muted lg:table-cell">
                        {m ? (
                          <>
                            {m.stage2.attempts}
                            <span className="text-fg-subtle"> · {m.stage2.accepted} ok</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden lg:table-cell">
                        <VariantBadge run={r} />
                      </td>
                      <td className="hidden whitespace-nowrap text-fg-muted lg:table-cell">
                        {m?.composition.seam ? (
                          <>
                            <span className="text-fg">{m.composition.seam.slc_frac_disagree?.toFixed(4) ?? "—"}</span>
                            <span className="text-fg-subtle"> · {m.composition.seam.slc_p10?.toFixed(3) ?? "—"} · {m.composition.seam.seam_step?.toFixed(2) ?? "—"}</span>
                            {m.composition.sweep && (
                              <Tooltip content="Hybrid sweep: the w_sem shown was picked by lowest SLC on this same video (no held-out selection).">
                                <span className="ml-1 text-warn">⚠</span>
                              </Tooltip>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden text-fg-muted md:table-cell">{m ? fmtDuration(m.runtimeMs) : "—"}</td>
                      <td className="hidden max-w-[220px] truncate text-2xs text-fg-subtle xl:table-cell">
                        {r.device ?? "—"} · {r.estimator ?? "—"} · seed {r.seed}
                      </td>
                      <td onClick={(e) => e.stopPropagation()} className="hidden md:table-cell">
                        {r.status === "succeeded" && r.kind === "video" && <ReportPdfButton runId={r.id} size="sm" variant="ghost" label="PDF" />}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {inProgress(r.status) ? (
                          <Tooltip content="Cancel the run before deleting it.">
                            <button type="button" aria-disabled="true" aria-label={`Delete ${r.id} (cancel it first)`} className="cursor-not-allowed p-1 text-fg-subtle opacity-40">
                              <IconX size={12} />
                            </button>
                          </Tooltip>
                        ) : (
                          <button type="button" aria-label={`Delete ${r.id}`} onClick={() => setConfirm([r.id])} className="rounded-sm p-1 text-fg-subtle hover:bg-bad-soft hover:text-bad">
                            <IconX size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {pickedRuns.length > 0 && (
        <p className="num text-2xs text-fg-subtle">Selected for compare: {pickedRuns.map((r) => r.id).join(", ")}</p>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm && confirm.length > 1 ? `Delete ${confirm.length} runs?` : `Delete run ${confirm?.[0]}?`}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        onConfirm={() => confirm && doDelete(confirm)}
        onClose={() => setConfirm(null)}
      >
        The run directory (manifest, steps, events, metrics, mosaic, log, artifacts) is removed from disk. This cannot be undone. Download the run zip first if you need it.
      </ConfirmDialog>
    </div>
  );
}
