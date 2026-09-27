"use client";

import Link from "next/link";
import type { RunState } from "@/lib/runReducer";
import { downloadArtifact, downloadRunZip } from "@/lib/export/runExports";
import { fmtOffset } from "@/lib/format";
import { IconAlert, IconDownload } from "@/components/ui/icons";
import { Copyable } from "@/components/ui/misc";
import { Button, buttonClass, cn } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { CauseBadge } from "@/components/pairs/cause";
import { STAGE_META } from "./StageStepper";

const dl = (p: Promise<void>, what: string) => p.catch((e: Error) => toast({ tone: "bad", title: `${what} download failed`, body: e.message }));

/**
 * A failed or interrupted run, as a first-class result: the stage, the exception, what was
 * recorded before it, and the partial run directory (steps.jsonl and events.jsonl are flushed
 * as they go, so everything up to the failure is inspectable).
 */
export function FailureDetail({ state }: { state: RunState }) {
  const { run } = state;
  const interrupted = run.status === "interrupted";
  const err = run.error;
  const stage = err?.stage ?? run.failedStage;
  const origin = new Date(run.startedAt ?? run.createdAt).getTime();
  const tail = state.logs.slice(-14);
  const exc = state.attempts.find((a) => a.rejectCause === "EXCEPTION");
  const lastOk = [...state.attempts].reverse().find((a) => a.accepted);

  return (
    <section role="alert" className="rounded-lg border border-bad/40 bg-bad-soft">
      <div className="flex flex-wrap items-start gap-3 p-3">
        <IconAlert className="mt-0.5 text-bad" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">
            {interrupted ? "Interrupted" : "Failed"}
            {stage && <> during {STAGE_META[stage].label.toUpperCase()}</>}
            {err && <Copyable value={err.code} label="error code" className="num ml-2 text-xs font-normal text-fg-muted" />}
          </div>
          <p className="mt-0.5 text-sm break-words text-fg">{interrupted ? run.interruptedReason : err?.message}</p>
          {err?.hint && <p className="mt-1 text-xs text-fg-muted">{err.hint}</p>}
          {exc && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <CauseBadge cause="EXCEPTION">
                attempt {exc.attempt}: {exc.frameI}→{exc.frameJ}
              </CauseBadge>
              <span className="text-fg-muted">the run stopped at this pair; nothing was skipped</span>
            </div>
          )}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href={`/new?video=${encodeURIComponent(run.videoId)}${run.variant ? `&variant=${run.variant.kind}` : ""}`} className={buttonClass("secondary")}>
            New run on this video
          </Link>
        </div>
      </div>
      <div className="grid gap-px border-t border-bad/25 bg-bad/15 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <dl className="num space-y-2 bg-surface-1 p-3 text-xs">
          <div>
            <dt className="font-sans text-2xs text-fg-subtle uppercase">Recorded before the {interrupted ? "interruption" : "failure"}</dt>
            <dd className="text-fg-muted">
              {state.edges.length.toLocaleString()} stage-1 edge records · {state.attempts.length} DKM attempt records
              {state.selection ? ` · planned path ${state.selection.plannedPath.length} frames` : ""}
            </dd>
          </div>
          <div>
            <dt className="font-sans text-2xs text-fg-subtle uppercase">Last accepted DKM step</dt>
            <dd className="text-fg">
              {lastOk ? (
                <>
                  #{lastOk.attempt} · {lastOk.frameI}→{lastOk.frameJ} · ratio {lastOk.inlierRatio?.toFixed(3)}
                </>
              ) : (
                <span className="text-fg-muted">none</span>
              )}
            </dd>
          </div>
          {err?.exceptionType && (
            <div>
              <dt className="font-sans text-2xs text-fg-subtle uppercase">Exception</dt>
              <dd className="text-fg">{err.exceptionType}</dd>
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1 font-sans">
            <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => dl(downloadArtifact(run.id, "run.log"), "run.log")}>
              run.log (full traceback)
            </Button>
            <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => dl(downloadArtifact(run.id, "steps.jsonl"), "steps.jsonl")}>
              steps.jsonl
            </Button>
            <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => dl(downloadRunZip(run.id), "Run zip")}>
              Whole run (.zip)
            </Button>
          </div>
        </dl>
        <div className="min-w-0 bg-surface-1 p-3">
          {err?.tracebackTail && (
            <>
              <div className="text-2xs tracking-wide text-fg-subtle uppercase">Traceback (tail)</div>
              <pre className="num mt-1 max-h-40 overflow-auto text-xs leading-5 whitespace-pre-wrap text-bad [overflow-wrap:anywhere]">{err.tracebackTail}</pre>
            </>
          )}
          <div className={cn("text-2xs tracking-wide text-fg-subtle uppercase", err?.tracebackTail && "mt-2")}>Log tail</div>
          <pre className="num mt-1 max-h-56 overflow-auto text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {tail.length === 0 && <span className="text-fg-subtle">no log lines</span>}
            {tail.map((l) => (
              <div key={l.seq} className={cn(l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-fg-muted")}>
                <span className="text-fg-subtle">{fmtOffset(new Date(l.ts).getTime() - origin)} </span>
                {l.stage && <span className="text-fg-subtle">[{l.stage}] </span>}
                {l.message}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}
