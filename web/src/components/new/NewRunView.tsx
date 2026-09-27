"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getPipelineService, ServiceError, type VariantKind, type VideoAsset } from "@/services";
import { refreshHealth, useHealth } from "@/hooks/useHealth";
import { useService } from "@/hooks/useAsync";
import { fmtBytes, fmtInt } from "@/lib/format";
import { announceRunStarted, requestNotificationPermission } from "@/components/shell/RunWatcher";
import { IconAlert, IconArrowRight, IconRefresh } from "@/components/ui/icons";
import { Copyable, EmptyState } from "@/components/ui/misc";
import { Banner, Button, buttonClass, cn, Panel, Tooltip } from "@/components/ui/primitives";
import { VideoPreview } from "./VideoPreview";

const VARIANT_TEXT: Record<VariantKind, { label: string; note: string }> = {
  semantic: { label: "SemanticStitch", note: "The target composition. Needs its verified checkpoint; without it the run fails at preflight with the path. No fallback." },
  firstwins: { label: "firstwins", note: "Each new frame fills only uncovered canvas. The comparison floor; temporary default while the SemanticStitch checkpoint is outstanding." },
  dgeo: { label: "d_geo seam", note: "Seam routed through low dense-geometry residual (bias 0.0)." },
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

export function NewRunView({ initialVideo, initialVariant }: { initialVideo?: string; initialVariant?: VariantKind }) {
  const router = useRouter();
  const health = useHealth();
  const videos = useService((s) => s.listVideos(), []);
  const [picked, setPicked] = useState<string | null>(initialVideo ?? null);
  const [q, setQ] = useState("");
  const [variant, setVariant] = useState<VariantKind | null>(initialVariant ?? null);
  const [seed, setSeed] = useState(0);
  const [starting, setStarting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<{ message: string; runId?: string } | null>(null);
  const [override, setOverride] = useState<Record<string, VideoAsset>>({});

  const h = health.status === "ok" ? health.health : null;
  const chosenVariant: VariantKind = variant ?? h?.defaultVariant ?? "firstwins";
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
            : null;

  const start = async () => {
    if (!video) return;
    setStarting(true);
    setError(null);
    void requestNotificationPermission();
    try {
      const run = await getPipelineService().createRun({ videoId: video.id, variant: chosenVariant, seed });
      announceRunStarted(run.id);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError({ message: (e as Error).message, runId: e instanceof ServiceError ? e.runId : undefined });
      setStarting(false);
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
            <fieldset>
              <legend className="text-2xs tracking-wide text-fg-subtle uppercase">Composition variant</legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                {(h?.variants ?? ["semantic", "firstwins", "dgeo"]).map((k) => (
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
                    {k === "semantic" && h && !semOk && <span className="text-2xs text-bad">{h.info?.semstitch.error ?? "checkpoint not verified"}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
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
            {chosenVariant === "semantic" && h && !semOk && (
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
              <Button variant="primary" loading={starting} disabledReason={blocker} onClick={start} icon={<IconArrowRight size={12} />}>
                Start run
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
