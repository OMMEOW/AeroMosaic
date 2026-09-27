"use client";

import Link from "next/link";
import { useState } from "react";
import { isTerminal, STAGE_ORDER, type StageId } from "@/services";
import type { RunState } from "@/lib/runReducer";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useRunStream, useTicker } from "@/hooks/useRunStream";
import { fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { Copyable } from "@/components/ui/misc";
import { IconArrowRight, IconCheck, IconStop } from "@/components/ui/icons";
import { Banner, buttonClass, Panel, RunStatusPill } from "@/components/ui/primitives";
import { AttemptsTable } from "@/components/pairs/AttemptsTable";
import { CauseBadge, STAGE1_CAUSES, STAGE2_CAUSES } from "@/components/pairs/cause";
import { EdgesTable } from "@/components/pairs/EdgesTable";
import { PairsSection } from "@/components/pairs/PairsSection";
import { CancelControl } from "./CancelControl";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { FailureDetail } from "./FailureDetail";
import { LiveMetrics } from "./LiveMetrics";
import { LogStream } from "./LogStream";
import { MosaicPreview } from "./MosaicPreview";
import { SavingsPanel } from "./SavingsPanel";
import { STAGE_META, StageStepper } from "./StageStepper";
import { VariantBadge } from "./VariantBadge";

function TerminalBanner({ state }: { state: RunState }) {
  const { run } = state;
  if (run.status === "succeeded" && run.pairResult) {
    const p = run.pairResult;
    return (
      <Banner tone={p.attempt.accepted ? "ok" : "warn"} icon={<IconCheck />} title={`Single pair ${p.frameI}→${p.frameJ}: ${p.attempt.accepted ? "accepted" : "rejected"}`}>
        <span className="num">
          stage-1 gate: {p.gate.rejectCause ? `would have rejected it (${p.gate.rejectDetail})` : "passed"} · DKM ratio{" "}
          {p.attempt.inlierRatio?.toFixed(3) ?? "—"} {p.attempt.rejectCause ? `(${p.attempt.rejectCause})` : ""} · {p.attempt.durationMs} ms
        </span>
      </Banner>
    );
  }
  if (run.status === "succeeded" && run.metrics) {
    const m = run.metrics;
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
          absolute coverage {fmtPct(m.absoluteCoverage)} · {fmtInt(m.stage2.nComposited)} frames composited · {fmtInt(m.stage2.attempts)} DKM
          attempts ({m.stage2.accepted} accepted){!m.stage2.reachedLast && ` · chain stopped at frame ${m.stage2.lastFrame}`}
        </span>
      </Banner>
    );
  }
  if (run.status === "failed" || run.status === "interrupted") return <FailureDetail state={state} />;
  if (run.status === "cancelled") {
    const stage = state.stages.find((s) => s.status === "cancelled");
    return (
      <Banner tone="warn" icon={<IconStop size={13} />} title="Run cancelled">
        Stopped during {stage ? STAGE_META[stage.id].label.toUpperCase() : "the queue"}. The worker was stopped; records written before that are kept
        ({state.edges.length.toLocaleString()} edges, {state.attempts.length} DKM attempts). No mosaic was written.
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
        <div className="h-[380px] rounded-lg bg-surface-1 lg:col-span-8" />
        <div className="h-[380px] rounded-lg bg-surface-1 lg:col-span-4" />
      </div>
    </div>
  );
}

export function LiveRunView({ runId }: { runId: string }) {
  const { state, metricsAt, connection, reconnect } = useRunStream(runId);
  const live = !!state && !isTerminal(state.run.status);
  const now = useTicker(live || connection.status === "reconnecting", 500);
  const [focusStage, setFocusStage] = useState<{ id: StageId; n: number } | null>(null);
  const [armCancel, setArmCancel] = useState(0);

  const started = state ? STAGE_ORDER.filter((id) => state.stages.find((s) => s.id === id)?.status !== "pending") : [];
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

  if (!state) {
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
    if (connection.status === "reconnecting" || (connection.status === "closed" && connection.reason === "gave_up")) {
      return (
        <div className="flex flex-col gap-3">
          <Banner tone="bad" title="Backend unreachable" actions={<ConnectionIndicator state={connection} now={now} onReconnect={reconnect} />}>
            {connection.status === "reconnecting" && connection.lastError ? connection.lastError : "Cannot open the event stream for this run."}
          </Banner>
          <Skeleton />
        </div>
      );
    }
    return <Skeleton />;
  }

  const { run } = state;
  const sel = state.selection;
  const s1 = sel?.rejects;
  const s2 = { DEGENERATE_H: 0, RATIO_BELOW_MIN: 0, EXCEPTION: 0 };
  for (const a of state.attempts) if (a.rejectCause) s2[a.rejectCause as keyof typeof s2]++;
  const dkm = state.stages.find((s) => s.id === "dkm");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="truncate text-base font-semibold">{run.video.filename}</h1>
            <span className="num text-xs text-fg-muted">{run.videoId}</span>
            <RunStatusPill status={run.status} />
            <VariantBadge run={run} />
          </div>
          <div className="num mt-0.5 flex flex-wrap gap-x-2 text-2xs text-fg-muted">
            <Copyable value={run.id} label="run ID" className="text-fg-subtle" />
            {run.video.width && (
              <span>
                {run.video.width}×{run.video.height}
              </span>
            )}
            {run.video.fps && <span>{run.video.fps.toFixed(2)} fps</span>}
            <span>{run.video.frameCount != null ? `${fmtInt(run.video.frameCount)} frames` : "frames: after decode"}</span>
            <span>device {run.device ?? "—"}</span>
            <span>estimator {run.estimator ?? "—"}</span>
            <span>seed {run.seed}</span>
            <span className="text-fg-subtle">created {fmtDateTime(run.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionIndicator state={connection} now={now} onReconnect={reconnect} />
          <CancelControl runId={run.id} status={run.status} armKey={armCancel} />
        </div>
      </div>

      <TerminalBanner state={state} />

      <StageStepper stages={state.stages} nowMs={now} focused={focusStage?.id ?? null} onPick={(id) => setFocusStage((f) => ({ id, n: (f?.n ?? 0) + 1 }))} />

      {run.kind === "pair" ? (
        <>
          <PairsSection pairs={state.pairs} live={live} title={`Single pair ${run.pair?.[0]}→${run.pair?.[1]}`} videoId={run.videoId} />
          <Panel title="Log" className="h-[280px]">
            <LogStream logs={state.logs} originIso={run.startedAt ?? run.createdAt} run={run} jump={focusStage} />
          </Panel>
        </>
      ) : (
      <>
      {run.vizEnabled ? (
        <PairsSection pairs={state.pairs} live={live} videoId={run.videoId} />
      ) : (
        <p className="text-2xs text-fg-subtle">Per-pair visualisation is off for this run (vizEnabled = false).</p>
      )}

      <div className="grid gap-3 lg:grid-cols-12">
        <MosaicPreview
          mosaic={state.mosaic}
          status={run.status}
          stages={state.stages}
          variantName={run.variant?.name ?? "none (single pair)"}
          className="h-[260px] sm:h-[340px] lg:col-span-7 lg:h-auto lg:min-h-[400px]"
        />
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
          <Panel title="Live">
            <LiveMetrics state={state} metricsAt={metricsAt} now={now} />
          </Panel>
          <Panel title="Selection saving" className="flex-1">
            <SavingsPanel metrics={run.metrics} selection={sel} />
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title={
            sel
              ? `Stage 1 · ${fmtInt(sel.candidateEdges)} candidate edges · ${fmtInt(sel.passing)} pass`
              : "Stage 1 · candidate edges"
          }
          actions={
            s1 && (
              <div className="hidden gap-1 sm:flex">
                {STAGE1_CAUSES.map((c) => (
                  <CauseBadge key={c} cause={c}>
                    {s1[c].toLocaleString()}
                  </CauseBadge>
                ))}
              </div>
            )
          }
        >
          {state.edges.length ? (
            <EdgesTable edges={state.edges} omega={sel?.omega ?? 0.164} iouTrust={sel?.iouTrust ?? 0.4} gaps={sel?.candidateGaps ?? [1, 2, 4, 8, 16, 32, 64]} height={320} />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-fg-muted">
              {state.stages.find((s) => s.id === "probe")?.status === "active"
                ? "Probing candidate edges… records appear when the DAG path is solved."
                : "Edge records stream here after stage 1."}
            </p>
          )}
        </Panel>
        <Panel
          title={`Stage 2 · DKM attempts${state.attempts.length ? ` · ${state.attempts.length}` : ""}`}
          actions={
            state.attempts.length > 0 && (
              <div className="hidden gap-1 sm:flex">
                {STAGE2_CAUSES.map((c) => (
                  <CauseBadge key={c} cause={c}>
                    {s2[c]}
                  </CauseBadge>
                ))}
              </div>
            )
          }
          className="h-[420px]"
        >
          <AttemptsTable
            attempts={state.attempts}
            videoId={run.videoId}
            live={dkm?.status === "active"}
            emptyHint={
              isTerminal(run.status) ? "No DKM attempts ran." : sel ? `${sel.plannedPath.length - 1} hops planned; DKM starts after the reference chain.` : "DKM attempts stream here in stage 2."
            }
          />
        </Panel>
      </div>

      <Panel title="Log" className="h-[320px]">
        <LogStream logs={state.logs} originIso={run.startedAt ?? run.createdAt} run={run} jump={focusStage} />
      </Panel>
      </>
      )}
    </div>
  );
}
