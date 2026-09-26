"use client";

import Link from "next/link";
import { useState } from "react";
import { isTerminal, STAGE_ORDER, type RunSnapshot, type StageId } from "@/services";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Copyable } from "@/components/ui/misc";
import { FailureDetail } from "./FailureDetail";
import { useRunStream, useTicker } from "@/hooks/useRunStream";
import { fmtBytes, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { IconArrowRight, IconCheck, IconStop } from "@/components/ui/icons";
import { Banner, buttonClass, Panel, RunStatusPill } from "@/components/ui/primitives";
import { CancelControl } from "./CancelControl";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { FrameReduction } from "./FrameReduction";
import { LiveMetrics } from "./LiveMetrics";
import { LogStream } from "./LogStream";
import { MosaicPreview } from "./MosaicPreview";
import { STAGE_META, StageStepper } from "./StageStepper";
import { LiveStepsTable } from "./StepsTable";

function TerminalBanner({ snap }: { snap: RunSnapshot }) {
  const { run } = snap;
  if (run.status === "succeeded" && run.metrics) {
    return (
      <Banner
        tone="ok"
        icon={<IconCheck />}
        title="Run complete"
        actions={
          <Link href={`/runs/${run.id}/results`} className={buttonClass("primary")}>
            Open results <IconArrowRight size={12} />
          </Link>
        }
      >
        <span className="num">
          {fmtInt(run.metrics.framesUsed)} frames composited · ground coverage {fmtPct(run.metrics.groundCoverage)} · accept rate{" "}
          {fmtPct(run.metrics.acceptRate)}
        </span>
      </Banner>
    );
  }
  if (run.status === "failed" && run.error) return <FailureDetail snap={snap} />;
  if (run.status === "cancelled") {
    const stage = snap.stages.find((s) => s.status === "cancelled");
    return (
      <Banner
        tone="warn"
        icon={<IconStop size={13} />}
        title="Run cancelled"
        actions={
          <Link href={`/new?from=${run.id}`} className={buttonClass("secondary")}>
            New run with these settings
          </Link>
        }
      >
        Stopped during {stage ? STAGE_META[stage.id].label.toUpperCase() : "startup"}
        {snap.steps.length > 0 && ` after ${snap.steps.length} of ${snap.metrics.stepsTotal ?? "?"} matching steps`}. No mosaic
        was written.
      </Banner>
    );
  }
  return null;
}

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading run">
      <div className="h-10 w-80 max-w-full rounded-md bg-surface-2" />
      <div className="h-16 rounded-lg bg-surface-1" />
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="h-[440px] rounded-lg bg-surface-1 lg:col-span-8" />
        <div className="h-[440px] rounded-lg bg-surface-1 lg:col-span-4" />
      </div>
    </div>
  );
}

export function LiveRunView({ runId }: { runId: string }) {
  const { snapshot: snap, metricsAt, connection, reconnect } = useRunStream(runId);
  const live = !!snap && !isTerminal(snap.run.status);
  const now = useTicker(live || connection.status === "reconnecting", 250);
  const [focusStage, setFocusStage] = useState<{ id: StageId; n: number } | null>(null);
  const [armCancel, setArmCancel] = useState(0);

  const started = snap ? STAGE_ORDER.filter((id) => snap.stages.find((s) => s.id === id)?.status !== "pending") : [];
  const jumpStage = (dir: 1 | -1) => {
    if (!started.length) return;
    const cur = focusStage ? started.indexOf(focusStage.id) : dir > 0 ? -1 : started.length;
    const next = started[Math.max(0, Math.min(started.length - 1, cur + dir))];
    setFocusStage((f) => ({ id: next, n: (f?.n ?? 0) + 1 }));
  };
  useHotkeys([
    { key: "c", description: "Cancel run (asks to confirm)", scope: "Live run", handler: () => live && setArmCancel((n) => n + 1) },
    { key: "]", description: "Jump log to next stage", scope: "Live run", handler: () => jumpStage(1) },
    { key: "[", description: "Jump log to previous stage", scope: "Live run", handler: () => jumpStage(-1) },
  ]);

  if (!snap) {
    if (connection.status === "closed" && connection.reason === "not_found") {
      return (
        <div className="mx-auto mt-16 max-w-md text-center">
          <h1 className="text-base font-semibold">Run {runId} not found</h1>
          <p className="mt-1 text-sm text-fg-muted">It may have been deleted, or the link is wrong.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/history" className={buttonClass("secondary")}>
              History
            </Link>
            <Link href="/new" className={buttonClass("primary")}>
              New run
            </Link>
          </div>
        </div>
      );
    }
    return <Skeleton />;
  }

  const { run } = snap;
  const matchStage = snap.stages.find((s) => s.id === "match");
  const stepsHint =
    run.status === "failed" || run.status === "cancelled"
      ? "No matching steps ran."
      : snap.selection
        ? `${snap.selection.selectedFrames.length - 1} pairs queued for dense matching`
        : "Steps stream here once frame selection finishes";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-semibold">{run.video.filename}</h1>
            <RunStatusPill status={run.status} />
          </div>
          <div className="num mt-0.5 flex flex-wrap gap-x-2 text-2xs text-fg-muted">
            <Copyable value={run.id} label="run ID" className="text-fg-subtle" />
            <span>
              {run.video.width}×{run.video.height}
            </span>
            <span>{run.video.fps} fps</span>
            <span>{fmtInt(run.video.frameCount)} frames</span>
            <span className="hidden sm:inline">{fmtBytes(run.video.sizeBytes)}</span>
            <span className="text-fg-subtle">started {fmtDateTime(run.startedAt ?? run.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionIndicator state={connection} now={now} onReconnect={reconnect} />
          <CancelControl runId={run.id} status={run.status} armKey={armCancel} />
        </div>
      </div>

      <TerminalBanner snap={snap} />

      <StageStepper
        stages={snap.stages}
        nowMs={now}
        focused={focusStage?.id ?? null}
        onPick={(id) => setFocusStage((f) => ({ id, n: (f?.n ?? 0) + 1 }))}
      />

      <div className="grid gap-3 lg:grid-cols-12">
        <MosaicPreview
          mosaic={snap.mosaic}
          status={run.status}
          stages={snap.stages}
          className="h-[260px] sm:h-[360px] lg:col-span-8 lg:h-auto lg:min-h-[440px]"
        />
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
          <Panel title="Live metrics">
            <LiveMetrics snapshot={snap} metricsAt={metricsAt} now={now} />
          </Panel>
          <Panel className="flex-1">
            <FrameReduction snapshot={snap} />
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          title="Dense matching steps"
          className="h-[340px] lg:col-span-5 lg:h-[380px]"
          actions={
            matchStage?.status === "active" ? (
              <span className="num text-2xs text-accent">MATCH in progress</span>
            ) : undefined
          }
        >
          <LiveStepsTable steps={snap.steps} total={snap.metrics.stepsTotal} emptyHint={stepsHint} />
        </Panel>
        <Panel title="Log" className="h-[340px] lg:col-span-7 lg:h-[380px]">
          <LogStream logs={snap.logs} originIso={run.startedAt ?? run.createdAt} run={run} jump={focusStage} />
        </Panel>
      </div>
    </div>
  );
}
