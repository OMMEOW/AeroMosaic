"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PARAMS,
  getPipelineService,
  ServiceError,
  type MockScenario,
  type PipelineParams,
  type RunSummary,
  type VideoAsset,
} from "@/services";
import { useServiceInfo } from "@/hooks/useServiceInfo";
import { fmtBytes, fmtFrame, fmtInt } from "@/lib/format";
import { getPrefs, paramsEqual } from "@/lib/prefs";
import { announceRunStarted, requestNotificationPermission } from "@/components/shell/RunWatcher";
import { IconAlert, IconArrowRight, IconChevron, IconRefresh, IconUpload } from "@/components/ui/icons";
import { Copyable } from "@/components/ui/misc";
import { Banner, Button, buttonClass, cn, Panel, ProgressBar } from "@/components/ui/primitives";
import { ParamsForm } from "./ParamsForm";

type Upload =
  | { state: "idle" }
  | { state: "uploading"; file: File; progress: number }
  | { state: "ready"; asset: VideoAsset; reusedFrom?: string }
  | { state: "error"; file: File; message: string };

function Prop({ label, value, copy }: { label: string; value: string; copy?: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm text-fg">{copy != null ? <Copyable value={copy}>{value}</Copyable> : value}</dd>
    </div>
  );
}

export function NewRunView({ from, adjust }: { from?: string; adjust?: boolean }) {
  const router = useRouter();
  const { kind, scenarios } = useServiceInfo();
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const [params, setParams] = useState<PipelineParams>(DEFAULT_PARAMS);
  const [adjustments, setAdjustments] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ackOmega, setAckOmega] = useState(false);
  const [scenario, setScenario] = useState<MockScenario>("success");
  const [active, setActive] = useState<RunSummary | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ message: string; runId?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  // Defaults from Settings, or the parameters/video of a previous run when retrying.
  useEffect(() => {
    let cancelled = false;
    const svc = getPipelineService();
    (async () => {
      const prefs = getPrefs();
      if (!from) {
        setParams(prefs.defaults);
        setAdvancedOpen(!paramsEqual(prefs.defaults, DEFAULT_PARAMS));
        return;
      }
      try {
        const snap = await svc.getRun(from);
        if (cancelled) return;
        let p = snap.run.params;
        const notes: string[] = [];
        const sug = snap.run.error?.suggestedParams;
        if (adjust && sug) {
          const next = { ...p, ...sug };
          if (sug.maxWorkingResolution !== undefined && sug.maxWorkingResolution !== p.maxWorkingResolution)
            notes.push(`max working resolution ${p.maxWorkingResolution} → ${sug.maxWorkingResolution} px`);
          if (sug.denseRefinement !== undefined && sug.denseRefinement !== p.denseRefinement)
            notes.push(`dense refinement ${p.denseRefinement ? "on" : "off"} → ${sug.denseRefinement ? "on" : "off"}`);
          if (sug.selectionThreshold !== undefined && sug.selectionThreshold !== p.selectionThreshold)
            notes.push(`ω ${p.selectionThreshold} → ${sug.selectionThreshold}`);
          p = next;
        }
        setParams(p);
        setAdjustments(notes);
        setAdvancedOpen(true);
        setAckOmega(p.selectionThreshold === DEFAULT_PARAMS.selectionThreshold ? false : true);
        const asset = await svc.getVideo(snap.run.videoId);
        if (!cancelled) setUpload({ state: "ready", asset, reusedFrom: from });
      } catch (e) {
        if (!cancelled) setError({ message: `Could not load run ${from}: ${(e as Error).message}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, adjust]);

  // One run at a time.
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getPipelineService()
        .getActiveRun()
        .then((r) => !cancelled && setActive(r))
        .catch(() => !cancelled && setActive(null));
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const startUpload = async (file: File) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|mkv|avi|m4v|webm)$/i.test(file.name)) {
      setUpload({ state: "error", file, message: "Not a video file. Supported: MP4, MOV, MKV, AVI, WebM." });
      return;
    }
    setUpload({ state: "uploading", file, progress: 0 });
    try {
      const asset = await getPipelineService().uploadVideo(file, {
        signal: ctrl.signal,
        onProgress: (p) => setUpload((u) => (u.state === "uploading" && u.file === file ? { ...u, progress: p } : u)),
      });
      setUpload({ state: "ready", asset });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setUpload({ state: "error", file, message: (e as Error).message });
    }
  };

  const omegaDeviates = params.selectionThreshold !== DEFAULT_PARAMS.selectionThreshold;
  const disabledReason =
    active === undefined
      ? "Checking for a run in progress…"
      : active
        ? `Run ${active.id} is still in progress — only one run executes at a time.`
        : upload.state === "uploading"
          ? "Wait for the upload to finish."
          : upload.state !== "ready"
            ? "Upload a video first."
            : !params.candidateGaps.length
              ? "Select at least one candidate gap."
              : omegaDeviates && !ackOmega
                ? `Confirm that you intend to run with ω = ${params.selectionThreshold} instead of the calibrated ${DEFAULT_PARAMS.selectionThreshold}.`
                : null;

  const start = async () => {
    if (upload.state !== "ready") return;
    setStarting(true);
    setError(null);
    void requestNotificationPermission();
    try {
      const run = await getPipelineService().createRun({
        videoId: upload.asset.id,
        params,
        ...(kind === "mock" ? { mockScenario: scenario } : {}),
      });
      announceRunStarted(run.id);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setStarting(false);
      setError(e instanceof ServiceError ? { message: e.message, runId: e.runId } : { message: String(e) });
    }
  };

  const probe = upload.state === "ready" ? upload.asset.probe : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">New run</h1>
        <span className="text-xs text-fg-muted">Upload a drone video; the pipeline stitches its frames into one mosaic.</span>
      </div>

      {active && (
        <Banner
          tone="accent"
          title={`Run ${active.id} is in progress`}
          actions={
            <Link href={`/runs/${active.id}`} className={buttonClass("secondary", "sm")}>
              Open live view <IconArrowRight size={12} />
            </Link>
          }
        >
          {active.video.filename} — a new run can start when it finishes or is cancelled.
        </Banner>
      )}
      {adjustments.length > 0 && (
        <Banner tone="warn" icon={<IconRefresh size={13} />} title={`Retrying ${from} with adjusted parameters`}>
          Applied the backend&apos;s suggestion: {adjustments.join("; ")}. Review below before starting.
        </Banner>
      )}
      {error && (
        <Banner tone="bad" icon={<IconAlert />} title={error.message}>
          {error.runId && (
            <Link className="text-accent underline" href={`/runs/${error.runId}`}>
              Open {error.runId}
            </Link>
          )}
        </Banner>
      )}

      <Panel title="1 · Video">
        {upload.state === "ready" && probe ? (
          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-medium">
                  <Copyable value={probe.filename} label="filename" />
                </div>
                <div className="num text-2xs text-fg-subtle">
                  {upload.reusedFrom ? (
                    <>reused from {upload.reusedFrom} · video </>
                  ) : (
                    <>uploaded · video </>
                  )}
                  <Copyable value={upload.asset.id} label="video ID" />
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => input.current?.click()} icon={<IconUpload size={12} />}>
                Replace video
              </Button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <Prop label="Resolution" value={`${probe.width}×${probe.height}`} copy={`${probe.width}x${probe.height}`} />
              <Prop label="Frame rate" value={`${probe.fps} fps`} copy={probe.fps} />
              <Prop label="Duration" value={`${(probe.durationMs / 1000).toFixed(2)} s`} copy={probe.durationMs / 1000} />
              <Prop label="Frames" value={fmtInt(probe.frameCount)} copy={probe.frameCount} />
              <Prop label="Codec" value={probe.codec} />
              <Prop label="Size" value={fmtBytes(probe.sizeBytes)} copy={probe.sizeBytes} />
            </dl>
            <p className="mt-3 text-xs text-fg-muted">
              DECODE reads all <span className="num text-fg">{fmtInt(probe.frameCount)}</span> frames ({fmtFrame(0)}–
              {fmtFrame(probe.frameCount - 1)}); SELECT then keeps only the few needed to chain them.
            </p>
          </div>
        ) : (
          <div className="p-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void startUpload(f);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
                dragOver ? "border-accent bg-accent-soft" : "border-line-strong hover:border-fg-subtle hover:bg-surface-2",
              )}
            >
              <IconUpload size={20} className="text-fg-muted" />
              <span className="text-sm text-fg">
                {upload.state === "uploading" ? `Uploading ${upload.file.name}…` : "Drop a drone video here, or click to choose"}
              </span>
              <span className="text-xs text-fg-subtle">MP4 · MOV · MKV · AVI · WebM — properties are read before the run starts</span>
            </button>
            {upload.state === "uploading" && (
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={upload.progress} className="flex-1" label="Upload progress" />
                <span className="num w-12 text-right text-xs text-fg-muted">{Math.round(upload.progress * 100)}%</span>
                <Button size="sm" variant="ghost" onClick={() => (abort.current?.abort(), setUpload({ state: "idle" }))}>
                  Cancel
                </Button>
              </div>
            )}
            {upload.state === "error" && (
              <p role="alert" className="mt-3 text-sm text-bad">
                {upload.file.name}: {upload.message}
              </p>
            )}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="video/*,.mp4,.mov,.mkv,.avi,.m4v,.webm"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void startUpload(f);
            e.target.value = "";
          }}
        />
      </Panel>

      <section className="rounded-lg border border-line bg-surface-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex h-10 w-full items-center justify-between gap-2 px-3 text-left"
        >
          <span className="flex items-center gap-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
            <IconChevron size={12} className={cn("transition-transform", advancedOpen && "rotate-90")} />
            2 · Pipeline parameters
          </span>
          <span className="num truncate text-2xs text-fg-subtle">
            ω={params.selectionThreshold} · gaps [{params.candidateGaps.join(",")}] · {params.maxWorkingResolution}px · refine{" "}
            {params.denseRefinement ? "on" : "off"}
            {!paramsEqual(params, DEFAULT_PARAMS) && <span className="ml-1.5 text-accent">modified</span>}
          </span>
        </button>
        {advancedOpen && (
          <div className="border-t border-line px-3">
            <ParamsForm
              value={params}
              onChange={(p) => {
                // Any change to ω needs a fresh acknowledgement.
                if (p.selectionThreshold !== params.selectionThreshold) setAckOmega(false);
                setParams(p);
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3">
              <span className="text-xs text-fg-muted">
                Defaults come from <Link className="text-accent hover:underline" href="/settings">Settings</Link>.
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconRefresh size={12} />}
                disabledReason={paramsEqual(params, DEFAULT_PARAMS) ? "Already at validated defaults." : null}
                onClick={() => {
                  setParams(DEFAULT_PARAMS);
                  setAckOmega(false);
                }}
              >
                Reset to validated defaults
              </Button>
            </div>
          </div>
        )}
      </section>

      {kind === "mock" && (
        <Panel title="Mock backend scenario">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as MockScenario)}
              className="h-8 rounded-md border border-line-strong bg-surface-2 px-2 text-sm"
              aria-label="Mock scenario"
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-fg-muted">Simulated outcome. Not sent to a real backend.</span>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border border-line bg-surface-1 p-3">
        {omegaDeviates && (
          <label className="mr-auto inline-flex items-start gap-2 text-xs text-warn">
            <input type="checkbox" className="mt-0.5 accent-(--warn)" checked={ackOmega} onChange={(e) => setAckOmega(e.target.checked)} />
            I intend to run with ω = {params.selectionThreshold}, not the calibrated {DEFAULT_PARAMS.selectionThreshold}.
          </label>
        )}
        <Button variant="primary" loading={starting} disabledReason={disabledReason} onClick={start} icon={<IconArrowRight size={12} />}>
          Start run
        </Button>
      </div>
    </div>
  );
}
