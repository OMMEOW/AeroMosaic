"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { getPipelineService, ServiceError, type VariantKind, type VideoAsset } from "@/services";
import { refreshHealth, useHealth } from "@/hooks/useHealth";
import { useService } from "@/hooks/useAsync";
import { fmtBytes, fmtInt } from "@/lib/format";
import { announceRunStarted, requestNotificationPermission } from "@/components/shell/RunWatcher";
import { IconAlert, IconArrowRight, IconRefresh, IconUpload } from "@/components/ui/icons";
import { ConfirmDialog, Copyable, EmptyState } from "@/components/ui/misc";
import { Banner, Button, buttonClass, cn, Panel, ProgressBar, Tooltip } from "@/components/ui/primitives";
import { VideoPreview } from "./VideoPreview";

const VARIANT_TEXT: Record<VariantKind, { label: string; note: string }> = {
  semantic: { label: "SemanticStitch", note: "Seam from the SemanticStitch network (bias 0.0). Requires its verified checkpoint; no fallback." },
  hybrid: { label: "Hybrid (semantic + d_geo)", note: "Seam routed on w_sem·semantic + (1 − w_sem)·d_geo cost (bias 0.0). Pick w_sem below; there is no default." },
  dgeo: { label: "d_geo seam", note: "Seam routed through low dense-geometry residual (bias 0.0)." },
  hybrid_sweep: { label: "Hybrid sweep", note: "All five w_sem, each scored by SLC, as the notebook does." },
  firstwins: { label: "firstwins", note: "API/CLI only." },
  random: { label: "random seam", note: "Degenerate control (API/CLI only)." },
};

function Prop({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm text-fg">{value}</dd>
      {sub && <dd className="num truncate text-2xs text-fg-subtle">{sub}</dd>}
    </div>
  );
}

export function NewRunView({
  initialVideo,
  initialVariant,
  initialPair,
}: {
  initialVideo?: string;
  initialVariant?: VariantKind;
  initialPair?: [number, number];
}) {
  const router = useRouter();
  const health = useHealth();
  const videos = useService((s) => s.listVideos(), []);
  const [picked, setPicked] = useState<string | null>(initialVideo ?? null);
  const [q, setQ] = useState("");
  const [variant, setVariant] = useState<VariantKind | null>(initialVariant ?? null);
  const [seed, setSeed] = useState(0);
  const [mode, setMode] = useState<"video" | "pair">(initialPair ? "pair" : "video");
  const [pairI, setPairI] = useState(initialPair?.[0] ?? 0);
  const [pairJ, setPairJ] = useState(initialPair?.[1] ?? 16);
  const [viz, setViz] = useState(true);
  const [wSem, setWSem] = useState<number | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [adding, setAdding] = useState<{ name: string; progress: number } | null>(null);
  const [linkPath, setLinkPath] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<{ message: string; runId?: string } | null>(null);
  const [override, setOverride] = useState<Record<string, VideoAsset>>({});

  const h = health.status === "ok" ? health.health : null;
  const offered: VariantKind[] = (h?.variants ?? ["semantic", "hybrid", "dgeo"]).filter((k) => k !== "firstwins");
  const chosenVariant: VariantKind = variant && offered.includes(variant) ? variant : (h?.defaultVariant ?? "semantic");
  const semOk = !!h?.info?.semstitch.verified;

  const list = useMemo(() => (videos.data ?? []).map((v) => override[v.id] ?? v), [videos.data, override]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? list.filter((v) => v.id.includes(s) || v.probe.filename.toLowerCase().includes(s) || v.group.toLowerCase().includes(s)) : list;
  }, [list, q]);
  const groups = useMemo(() => {
    const m = new Map<string, VideoAsset[]>();
    for (const v of filtered) m.set(v.group, [...(m.get(v.group) ?? []), v]);
    return [...m.entries()];
  }, [filtered]);
  const video = list.find((v) => v.id === picked) ?? null;

  const blocker =
    health.status === "unreachable"
      ? `Backend unreachable at ${getPipelineService().baseUrl}`
      : health.status === "loading"
        ? "Checking the backend…"
        : !h!.runsAllowed
          ? h!.blockers.join("; ")
          : !video
            ? "Pick a video first"
            : mode === "pair" && !(pairI >= 0 && pairJ > pairI)
              ? "Pick frames with i < j"
              : mode === "pair" && video.probe.frameCount != null && pairJ >= video.probe.frameCount
                ? `Frame ${pairJ} is out of range (0–${video.probe.frameCount - 1})`
                : mode === "video" && chosenVariant === "hybrid" && wSem == null
                  ? "Pick w_sem for the hybrid seam (no value is chosen for you)"
                  : null;
  const sweepBlocker = blocker && !/w_sem/.test(blocker) ? blocker : !video ? "Pick a video first" : null;

  const start = async (sweep = false) => {
    if (!video) return;
    setStarting(true);
    setError(null);
    void requestNotificationPermission();
    try {
      const run = await getPipelineService().createRun(
        mode === "pair"
          ? { videoId: video.id, seed, pair: [pairI, pairJ] }
          : sweep
            ? { videoId: video.id, variant: "hybrid_sweep", seed, viz }
            : { videoId: video.id, variant: chosenVariant, seed, viz, ...(chosenVariant === "hybrid" && wSem != null ? { wSem } : {}) },
      );
      announceRunStarted(run.id);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError({ message: (e as Error).message, runId: e instanceof ServiceError ? e.runId : undefined });
      setStarting(false);
    }
  };

  const afterAdd = (v: VideoAsset) => {
    videos.reload();
    setOverride((o) => ({ ...o, [v.id]: v }));
    setPicked(v.id);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    for (const f of Array.from(files)) {
      setAdding({ name: f.name, progress: 0 });
      try {
        afterAdd(await getPipelineService().uploadVideo(f, (p) => setAdding({ name: f.name, progress: p })));
      } catch (e) {
        setError({ message: `${f.name}: ${(e as Error).message}` });
      }
    }
    setAdding(null);
    if (fileInput.current) fileInput.current.value = "";
  };
  const link = async () => {
    setError(null);
    setAdding({ name: linkPath, progress: -1 });
    try {
      afterAdd(await getPipelineService().linkVideo(linkPath.trim()));
      setLinkPath("");
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setAdding(null);
    }
  };

  const countFrames = async () => {
    if (!video) return;
    setCounting(true);
    try {
      const v = await getPipelineService().countVideoFrames(video.id);
      setOverride((o) => ({ ...o, [v.id]: v }));
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setCounting(false);
    }
  };

  if (videos.status === "error" && !videos.data) {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <Banner
          tone="bad"
          icon={<IconAlert />}
          title="Backend unreachable"
          actions={
            <Button size="sm" icon={<IconRefresh size={12} />} onClick={() => (videos.reload(), refreshHealth())}>
              Retry
            </Button>
          }
        >
          {videos.error.message}. Start it with <code className="num">cd backend && .venv/bin/uvicorn server.app:app --port 8000</code>.
        </Banner>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-base font-semibold">New run</h1>
        <p className="text-xs text-fg-muted">NB_L2 on this Mac: pick a video from the data root and a composition variant. Pipeline constants are fixed.</p>
      </div>

      {h && !h.runsAllowed && (
        <Banner tone="bad" icon={<IconAlert />} title="Runs cannot start" actions={<Link href="/settings" className={buttonClass("secondary", "sm")}>Backend details</Link>}>
          {h.blockers.join("; ")}
        </Banner>
      )}

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          title={`Videos${videos.data ? ` · ${videos.data.length}` : ""}`}
          className="h-[560px] lg:col-span-5"
          bodyClassName="flex min-h-0 flex-col"
          actions={
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter"
              aria-label="Filter videos"
              className="h-6 w-32 rounded-sm border border-line bg-surface-2 px-2 text-xs"
            />
          }
        >
          <div className="flex flex-col gap-1.5 border-b border-line p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.avi,.mkv"
                multiple
                className="hidden"
                onChange={(e) => upload(e.target.files)}
              />
              <Button size="sm" icon={<IconUpload size={12} />} loading={!!adding && adding.progress >= 0} onClick={() => fileInput.current?.click()}>
                Add videos…
              </Button>
              <span className="text-2xs text-fg-subtle">from this computer or an attached drive; copied into data/uploads/</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={linkPath}
                onChange={(e) => setLinkPath(e.target.value)}
                placeholder="/Volumes/Drive/flight.mp4"
                aria-label="Add a video by path without copying"
                className="num h-7 min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 text-xs"
              />
              <Button size="sm" variant="ghost" disabledReason={!linkPath.trim() ? "Enter a path on the backend machine" : null} loading={adding?.progress === -1} onClick={link}>
                Add by path
              </Button>
            </div>
            {adding && adding.progress >= 0 && (
              <div className="num text-2xs text-fg-muted">
                uploading {adding.name} · {(adding.progress * 100).toFixed(0)}%
                <ProgressBar value={adding.progress} className="mt-1" label="upload progress" />
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
          {videos.status === "loading" && !videos.data ? (
            <p className="p-4 text-xs text-fg-muted">Listing the data root…</p>
          ) : list.length === 0 ? (
            <EmptyState
              title="No videos in the data root"
              body={
                <>
                  The backend found no videos under <span className="num">{h?.dataRoot ?? "the data root"}</span> (videos/, MovingDrone/*/video.mp4, umcd/).
                </>
              }
            />
          ) : (
            <div className="h-full overflow-auto">
              {groups.map(([g, vs]) => (
                <div key={g}>
                  <div className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
                    {g} <span className="num font-normal">· {vs.length}</span>
                  </div>
                  <ul>
                    {vs.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(v.id)}
                          aria-pressed={picked === v.id}
                          className={cn(
                            "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-line/50 px-3 py-1.5 text-left text-xs hover:bg-surface-2",
                            picked === v.id && "bg-accent-soft",
                          )}
                        >
                          <span className="num truncate text-fg">{v.id}</span>
                          <span className="num text-2xs text-fg-muted">
                            {v.probe.frameCount != null ? `${fmtInt(v.probe.frameCount)} fr` : <span className="text-fg-subtle" title="decoded count not known yet">? fr</span>}
                            {" · "}
                            {v.probe.width}×{v.probe.height}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
          <Panel title="Video" bodyClassName="p-3">
            {video ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <VideoPreview key={video.id} asset={video} />
                <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2.5">
                  <Prop label="ID" value={<Copyable value={video.id}>{video.id}</Copyable>} />
                  <Prop label="File" value={video.probe.filename} sub={fmtBytes(video.probe.sizeBytes)} />
                  <Prop label="Resolution" value={`${video.probe.width}×${video.probe.height}`} sub={video.probe.codec ?? undefined} />
                  <Prop label="Frame rate" value={video.probe.fps ? `${video.probe.fps.toFixed(3)} fps` : "—"} />
                  <Prop
                    label="Frames (decoded)"
                    value={
                      video.probe.frameCount != null ? (
                        fmtInt(video.probe.frameCount)
                      ) : (
                        <Tooltip content="The exact count comes from decoding the file; CAP_PROP_FRAME_COUNT overstates on some videos. The run's own decode also records it.">
                          <span className="cursor-help text-fg-subtle">not decoded yet</span>
                        </Tooltip>
                      )
                    }
                    sub={
                      video.probe.frameCount != null
                        ? video.probe.frameCountSource === "run-decode"
                          ? "from a run's decode"
                          : "decode count"
                        : `container says ${fmtInt(video.probe.containerFrameCount)}`
                    }
                  />
                  <div className="flex items-end">
                    {video.probe.frameCount == null && (
                      <Button size="sm" variant="ghost" loading={counting} onClick={countFrames}>
                        Count frames now
                      </Button>
                    )}
                  </div>
                </dl>
              </div>
            ) : (
              <p className="py-10 text-center text-xs text-fg-muted">Pick a video from the list.</p>
            )}
          </Panel>

          <Panel title="Run" bodyClassName="p-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Run mode">
              {(
                [
                  ["video", "Whole video"],
                  ["pair", "Single pair"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("h-7 rounded-md border px-3 text-xs", mode === m ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg")}
                >
                  {label}
                </button>
              ))}
              <span className="text-2xs text-fg-subtle">
                {mode === "pair"
                  ? "One DKM attempt on any two frames, fully visualised, with the stage-1 gate verdict for that pair. No composition or coverage."
                  : "The full pipeline: stage-1 selection, DKM with re-planning, composition, absolute coverage."}
              </span>
            </div>
            {mode === "pair" && (
              <div className="flex flex-wrap items-end gap-3">
                {(
                  [
                    ["Frame i (reference)", pairI, setPairI],
                    ["Frame j (new)", pairJ, setPairJ],
                  ] as const
                ).map(([label, val, set]) => (
                  <label key={label} className="text-2xs tracking-wide text-fg-subtle uppercase">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={video?.probe.frameCount != null ? video.probe.frameCount - 1 : undefined}
                      value={val}
                      onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className="num mt-1 block h-7 w-28 rounded-sm border border-line bg-surface-2 px-2 text-sm text-fg normal-case"
                    />
                  </label>
                ))}
                <span className="num text-2xs text-fg-subtle">
                  gap {pairJ - pairI}
                  {video?.probe.frameCount != null ? ` · frames 0–${video.probe.frameCount - 1}` : " · frame count known after the first decode"}
                </span>
              </div>
            )}
            <fieldset className={mode === "pair" ? "hidden" : undefined}>
              <legend className="text-2xs tracking-wide text-fg-subtle uppercase">Composition variant</legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                {offered.map((k) => (
                  <label
                    key={k}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 text-xs",
                      chosenVariant === k ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <input type="radio" name="variant" className="accent-(--accent)" checked={chosenVariant === k} onChange={() => setVariant(k)} />
                      {VARIANT_TEXT[k].label}
                      {h?.defaultVariant === k && <span className="text-2xs font-normal text-fg-subtle">default</span>}
                    </span>
                    <span className="text-2xs text-fg-muted">{VARIANT_TEXT[k].note}</span>
                    {(k === "semantic" || k === "hybrid") && h && !semOk && (
                      <span className="text-2xs text-bad">{h.info?.semstitch.error ?? "checkpoint not verified"}</span>
                    )}
                  </label>
                ))}
              </div>
              {chosenVariant === "hybrid" && (
                <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Hybrid w_sem">
                  <span className="text-2xs tracking-wide text-fg-subtle uppercase">w_sem</span>
                  {(h?.hybridGrid ?? [0, 0.25, 0.5, 0.75, 1]).map((w) => (
                    <button
                      key={w}
                      type="button"
                      role="radio"
                      aria-checked={wSem === w}
                      onClick={() => setWSem(w)}
                      className={cn("num h-7 rounded-md border px-2.5 text-xs", wSem === w ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg")}
                    >
                      {w}
                    </button>
                  ))}
                  <span className="text-2xs text-fg-subtle">
                    the notebook&apos;s grid; none is pre-selected. Recorded in the manifest and the variant name (hyb_w…_b0).
                  </span>
                </div>
              )}
            </fieldset>
            {mode === "video" && (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" className="accent-(--accent)" checked={viz} onChange={(e) => setViz(e.target.checked)} />
                Per-pair visualisation (frames, SIFT/DKM correspondences, live preview canvas). Written outside the timed region; turn off for
                benchmark runs. Recorded as vizEnabled.
              </label>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-2xs tracking-wide text-fg-subtle uppercase">
                Seed
                <input
                  type="number"
                  value={seed}
                  min={0}
                  onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="num mt-1 block h-7 w-24 rounded-sm border border-line bg-surface-2 px-2 text-sm text-fg normal-case"
                />
              </label>
              {h && (
                <p className="num min-w-0 flex-1 text-2xs text-fg-subtle">
                  fixed: ω {h.constants.omega} on {h.constants.gateScore} · IoU ≥ {h.constants.iouTrust} · gaps [{h.constants.candidateGaps.join(", ")}] · τs{" "}
                  {h.constants.tauS} → τr {h.constants.tauR} · accept ≥ {h.constants.minInlierRatio} · DKM {h.constants.dkmNumSamples} samples, upsample{" "}
                  {String(h.constants.upsamplePreds)} · {h.info?.estimator ?? "—"} · {h.info?.device ?? "—"}
                </p>
              )}
            </div>
            {mode === "video" && (chosenVariant === "semantic" || chosenVariant === "hybrid") && h && !semOk && (
              <Banner tone="warn" icon={<IconAlert size={13} />} title="This run will fail at preflight">
                {h.info?.semstitch.error}. It will not fall back to another composition.
              </Banner>
            )}
            {error && (
              <Banner tone="bad" icon={<IconAlert size={13} />} title="Could not start the run">
                {error.message}
                {error.runId && (
                  <>
                    {" "}
                    <Link className="underline" href={`/runs/${error.runId}`}>
                      Open {error.runId}
                    </Link>
                  </>
                )}
              </Banner>
            )}
            <div className="flex items-center justify-end gap-2">
              {h?.activeRunId && (
                <span className="text-2xs text-fg-muted">
                  a run is in progress; this one will queue ({h.queued} queued) ·{" "}
                  <Link href={`/runs/${h.activeRunId}`} className="underline">
                    open it
                  </Link>
                </span>
              )}
              {mode === "video" && (
                <Button variant="secondary" disabledReason={sweepBlocker} onClick={() => setConfirmSweep(true)}>
                  Hybrid sweep…
                </Button>
              )}
              <Button variant="primary" loading={starting} disabledReason={blocker} onClick={() => start()} icon={<IconArrowRight size={12} />}>
                Start run
              </Button>
            </div>
            <ConfirmDialog
              open={confirmSweep}
              title="Run the hybrid sweep?"
              confirmLabel="Start the sweep"
              cancelLabel="Cancel"
              tone="primary"
              onConfirm={() => start(true)}
              onClose={() => setConfirmSweep(false)}
            >
              <p>
                Composes the hybrid seam at every w_sem in the notebook&apos;s grid ({(h?.hybridGrid ?? [0, 0.25, 0.5, 0.75, 1]).join(", ")}) at bias 0.0 and
                scores each with SLC, as the notebook&apos;s procedure does. Composition runs about {(h?.hybridGrid ?? [0, 0, 0, 0, 0]).length}× as long as a
                single-variant run (registration and coverage are shared).
              </p>
              <p className="mt-2 text-warn">
                The lowest-SLC w_sem is chosen on this same video: tuning on the evaluation signal, with no held-out selection. It is marked for
                inspection only and is never carried forward as a default.
              </p>
            </ConfirmDialog>
          </Panel>
        </div>
      </div>
    </div>
  );
}
