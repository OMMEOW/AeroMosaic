"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { configLine } from "@/lib/export/provenance";
import { fmtDuration, fmtInt } from "@/lib/format";
import { IconAlert, IconArrowRight } from "@/components/ui/icons";
import { Copyable, EmptyState, RelTime } from "@/components/ui/misc";
import { buttonClass, cn, RunStatusPill } from "@/components/ui/primitives";
import { STAGE_META } from "@/components/run/StageStepper";
import { VariantBadge } from "@/components/run/VariantBadge";
import { ArtifactsMenu } from "./ArtifactsMenu";
import { RunDataProvider, useRunData } from "./RunDataContext";

const TABS = [
  { seg: "results", label: "Overview" },
  { seg: "selection", label: "Frame selection" },
  { seg: "diagnostics", label: "Diagnostics" },
  { seg: "pairs", label: "Pairs" },
];

function ShellSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading run results">
      <div className="h-[46px] w-96 max-w-full rounded-md bg-surface-2" />
      <div className="h-9 w-80 rounded-md bg-surface-1" />
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="h-[520px] rounded-lg bg-surface-1 lg:col-span-8" />
        <div className="h-[520px] rounded-lg bg-surface-1 lg:col-span-4" />
      </div>
    </div>
  );
}

function Inner({ runId, children }: { runId: string; children: ReactNode }) {
  const data = useRunData();
  const pathname = usePathname();

  if (data.state === "loading") return <ShellSkeleton />;
  if (data.state === "error") {
    return (
      <EmptyState
        icon={<IconAlert size={18} />}
        title={data.notFound ? `Run ${runId} not found` : `Could not load run ${runId}`}
        body={data.message}
        action={
          <Link href="/history" className={buttonClass("secondary")}>
            Browse history
          </Link>
        }
      />
    );
  }
  const run = data.run.run;
  if (run.kind === "pair") {
    return (
      <EmptyState
        title={`Run ${runId} is a single-pair run`}
        body="It has no mosaic, reference chain or coverage. Its pair panel, gate evidence and DKM verdict are on the run page."
        action={
          <Link href={`/runs/${runId}`} className={buttonClass("primary")}>
            Open the pair <IconArrowRight size={12} />
          </Link>
        }
      />
    );
  }
  if (data.state === "not-ready") {
    const live = run.status === "queued" || run.status === "running" || run.status === "cancelling";
    const stage = run.failedStage ?? data.run.stages.find((s) => s.status === "failed" || s.status === "cancelled")?.id;
    return (
      <EmptyState
        icon={<IconAlert size={18} />}
        title={
          live ? `Run ${runId} is still ${run.status}` : `Run ${runId} ${run.status}${stage ? ` during ${STAGE_META[stage].label.toUpperCase()}` : ""}: no results`
        }
        body={live ? "Results appear here when it finishes." : (run.error?.message ?? run.interruptedReason ?? "Stopped before a mosaic was written.")}
        action={
          <Link href={`/runs/${runId}`} className={buttonClass("primary")}>
            {live ? "Open live view" : "Run details"} <IconArrowRight size={12} />
          </Link>
        }
      />
    );
  }

  const m = run.metrics!;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-semibold">
              <Copyable value={run.video.filename} label="filename" />
            </h1>
            <RunStatusPill status={run.status} />
            <VariantBadge run={run} />
          </div>
          <div className="num mt-0.5 flex flex-wrap gap-x-2 text-2xs text-fg-muted">
            <Copyable value={run.id} label="run ID" className="text-fg-subtle" />
            <span>
              {run.video.width}×{run.video.height} · {run.video.fps?.toFixed(2)} fps · {fmtInt(run.video.frameCount)} frames
            </span>
            <span>
              finished <RelTime iso={run.finishedAt ?? run.createdAt} />
            </span>
            <span>runtime {fmtDuration(m.runtimeMs)}</span>
          </div>
          <div className="num mt-1 text-2xs">
            <span className="rounded-sm bg-surface-3 px-1.5 py-px text-fg-muted">
              <Copyable value={configLine(run)} label="configuration">
                {configLine(run)}
              </Copyable>
            </span>
            {run.estimator === "magsac" && <span className="ml-2 text-fg-subtle">MAGSAC where the CUDA runs used GC-RANSAC (PARITY.md)</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/compare?runs=${run.id}`} className={buttonClass("ghost")}>
            Compare…
          </Link>
          <ArtifactsMenu runId={run.id} />
        </div>
      </div>
      <nav aria-label="Run analysis" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]">
        {TABS.map((t) => {
          const href = `/runs/${runId}/${t.seg}`;
          const active = pathname === href;
          return (
            <Link
              key={t.seg}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 px-3 py-2 text-sm whitespace-nowrap",
                active ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

export function RunShell({ runId, children }: { runId: string; children: ReactNode }) {
  return (
    <RunDataProvider runId={runId}>
      <Inner runId={runId}>{children}</Inner>
    </RunDataProvider>
  );
}
