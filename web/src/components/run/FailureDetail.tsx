"use client";

import Link from "next/link";
import { getPipelineService, type RunSnapshot } from "@/services";
import { download } from "@/lib/export/runExports";
import { fmtFrame, fmtOffset, fmtRatio } from "@/lib/format";
import { IconAlert, IconDownload, IconRefresh } from "@/components/ui/icons";
import { Copyable } from "@/components/ui/misc";
import { Button, buttonClass, cn } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { STAGE_META } from "./StageStepper";

/**
 * What a failed run left behind: the stage, the error, the last step that
 * worked, the tail of the log, and a one-click retry with the backend's
 * suggested parameter changes. (The partial mosaic stays in the preview panel.)
 */
export function FailureDetail({ snap }: { snap: RunSnapshot }) {
  const { run } = snap;
  const err = run.error!;
  const lastOk = [...snap.steps].reverse().find((s) => s.accepted) ?? null;
  const origin = new Date(run.startedAt ?? run.createdAt).getTime();
  const tail = snap.logs.slice(-12);
  const sug = err.suggestedParams;
  const changes = sug
    ? Object.entries(sug)
        .filter(([k, v]) => run.params[k as keyof typeof run.params] !== v)
        .map(([k, v]) => {
          const show = (x: unknown) => (typeof x === "boolean" ? (x ? "on" : "off") : k === "maxWorkingResolution" ? `${x} px` : String(x));
          const name = k === "maxWorkingResolution" ? "max res" : k === "denseRefinement" ? "refinement" : k === "selectionThreshold" ? "ω" : k;
          return `${name} ${show(run.params[k as keyof typeof run.params])} → ${show(v)}`;
        })
    : [];

  return (
    <section role="alert" className="rounded-lg border border-bad/40 bg-bad-soft">
      <div className="flex flex-wrap items-start gap-3 p-3">
        <IconAlert className="mt-0.5 text-bad" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">
            Failed during {STAGE_META[err.stage].label.toUpperCase()}
            <Copyable value={err.code} label="error code" className="num ml-2 text-xs font-normal text-fg-muted" />
          </div>
          <p className="mt-0.5 text-sm text-fg">{err.message}</p>
          {err.hint && <p className="mt-1 text-xs text-fg-muted">Suggested: {err.hint}</p>}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {sug && changes.length > 0 && (
            <Link href={`/new?from=${run.id}&adjust=1`} className={buttonClass("primary")}>
              <IconRefresh size={12} /> Retry with adjusted parameters
            </Link>
          )}
          <Link href={`/new?from=${run.id}`} className={buttonClass("secondary")}>
            Retry with same settings
          </Link>
        </div>
      </div>
      <div className="grid gap-px border-t border-bad/25 bg-bad/15 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <dl className="num space-y-2 bg-surface-1 p-3 text-xs">
          <div>
            <dt className="font-sans text-2xs text-fg-subtle uppercase">Failed stage</dt>
            <dd className="text-fg">
              {STAGE_META[err.stage].label.toUpperCase()}
              {snap.stages.find((s) => s.id === err.stage)?.counter && (
                <span className="text-fg-muted">
                  {" "}
                  at {snap.stages.find((s) => s.id === err.stage)!.counter!.done} {snap.stages.find((s) => s.id === err.stage)!.counter!.unit}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-sans text-2xs text-fg-subtle uppercase">Last successful step</dt>
            <dd className="text-fg">
              {lastOk ? (
                <>
                  step {lastOk.step} · {fmtFrame(lastOk.fromFrame)} → {fmtFrame(lastOk.toFrame)} · inlier {fmtRatio(lastOk.inlierRatio)}
                </>
              ) : (
                <span className="text-fg-muted">none — failed before dense matching</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-sans text-2xs text-fg-subtle uppercase">Progress kept</dt>
            <dd className="text-fg-muted">
              {snap.steps.length} of {snap.metrics.stepsTotal ?? "—"} steps · {snap.mosaic ? `partial mosaic, ${snap.mosaic.framesComposited} frames` : "no mosaic"}
            </dd>
          </div>
          {changes.length > 0 && (
            <div>
              <dt className="font-sans text-2xs text-fg-subtle uppercase">Retry would change</dt>
              <dd className="text-fg">{changes.join("; ")}</dd>
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1 font-sans">
            <Button
              size="sm"
              variant="ghost"
              icon={<IconDownload size={12} />}
              onClick={async () => {
                try {
                  download.log(run, await getPipelineService().getRunLog(run.id));
                } catch (e) {
                  toast({ tone: "bad", title: "Log export failed", body: (e as Error).message });
                }
              }}
            >
              Full log
            </Button>
            <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => download.summary(run, { snapshot: snap })}>
              Summary JSON
            </Button>
            {snap.steps.length > 0 && (
              <Button size="sm" variant="ghost" icon={<IconDownload size={12} />} onClick={() => download.stepsCsv(run, snap.steps)}>
                Steps CSV
              </Button>
            )}
          </div>
        </dl>
        <div className="min-w-0 bg-surface-1 p-3">
          <div className="text-2xs tracking-wide text-fg-subtle uppercase">Log tail</div>
          <pre className="num mt-1 max-h-56 overflow-auto text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
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
