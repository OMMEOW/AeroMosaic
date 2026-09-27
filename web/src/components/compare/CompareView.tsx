"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getPipelineService, type RunSummary } from "@/services";
import type { RunState } from "@/lib/runReducer";
import { useService } from "@/hooks/useAsync";
import { SERIES } from "@/components/charts/chartSpec";
import { fmtDateTime } from "@/lib/format";
import { judgeDelta, METRICS, type Trust } from "@/lib/metrics";
import { loadRunData } from "@/components/results/RunDataContext";
import { FIT_VIEW, MosaicViewer, type MosaicView } from "@/components/results/MosaicViewer";
import { IconAlert, IconX } from "@/components/ui/icons";
import { MetricLabel } from "@/components/ui/MetricLabel";
import { Copyable, EmptyState } from "@/components/ui/misc";
import { Banner, buttonClass, cn, Panel, Switch } from "@/components/ui/primitives";

const TRUST_TITLE: Record<Trust, string> = {
  primary: "Primary",
  secondary: "Secondary",
};

type Loaded = RunState & { id: string };

export function CompareView({ ids }: { ids: string[] }) {
  const router = useRouter();
  const all = useService((svc) => svc.listRuns(), []);
  const [results, setResults] = useState<Record<string, Loaded | { error: string }>>({});
  const [sync, setSync] = useState(true);
  const [sharedView, setSharedView] = useState<MosaicView>(FIT_VIEW);
  const [views, setViews] = useState<Record<string, MosaicView>>({});

  useEffect(() => {
    let cancelled = false;
    for (const id of ids) {
      if (results[id]) continue;
      loadRunData(id).then((d) => {
        if (cancelled) return;
        setResults((r) => ({
          ...r,
          [id]:
            d.state === "ready"
              ? { ...d.run, id }
              : { error: d.state === "error" ? d.message : `Run is ${d.state === "not-ready" ? d.run.run.status : "loading"}; only succeeded runs compare.` },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const setIds = (next: string[]) => router.replace(next.length ? `/compare?runs=${next.join(",")}` : "/compare");
  const succeeded = (all.data ?? []).filter((r) => r.status === "succeeded" && r.kind === "video");
  const loaded = ids.map((id) => results[id]).filter((r): r is Loaded => !!r && "run" in r);
  const failed = ids.filter((id) => results[id] && "error" in results[id]!);
  const ready = loaded.length === ids.length && ids.length > 0;

  const sameVideo = useMemo(() => new Set(loaded.map((r) => r.run.videoId)).size <= 1, [loaded]);

  const paramRows: { label: string; get: (r: RunSummary) => string; def: string }[] = [
    { label: "Video", get: (r) => r.videoId, def: "" },
    { label: "Native frames", get: (r) => String(r.video.frameCount ?? "—"), def: "" },
    { label: "Composition variant", get: (r) => r.variant?.name ?? "—", def: "" },
    { label: "SemanticStitch sha256", get: (r) => (r.semstitch?.used ? (r.semstitch.sha256?.slice(0, 12) ?? "—") : "not used"), def: "" },
    { label: "Homography estimator", get: (r) => r.estimator ?? "—", def: "" },
    { label: "Device", get: (r) => r.device ?? "—", def: "" },
    { label: "Seed", get: (r) => String(r.seed), def: "" },
  ];

  const picker = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {ids.map((id, i) => (
        <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 pr-1 pl-2 text-xs">
          <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
          <span className="num">{id}</span>
          {i === 0 && <span className="text-2xs text-fg-subtle">baseline</span>}
          <button type="button" aria-label={`Remove ${id}`} className="rounded-sm p-0.5 text-fg-subtle hover:text-fg" onClick={() => setIds(ids.filter((x) => x !== id))}>
            <IconX size={10} />
          </button>
        </span>
      ))}
      {ids.length < 3 && (
        <select
          value=""
          onChange={(e) => e.target.value && setIds([...ids, e.target.value])}
          className="h-7 w-full max-w-full min-w-0 rounded-md border border-line-strong bg-surface-2 px-2 text-xs sm:w-auto sm:max-w-80"
          aria-label="Add a run to compare"
          disabled={!all.data}
        >
          <option value="">{all.data ? `+ Add run (${3 - ids.length} more)` : "Loading runs…"}</option>
          {succeeded
            .filter((r) => !ids.includes(r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.variant?.name ?? "single pair"} · {fmtDateTime(r.createdAt)}
              </option>
            ))}
        </select>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Compare runs</h1>
        {picker}
      </div>

      {failed.map((id) => (
        <Banner key={id} tone="bad" icon={<IconAlert />} title={`Cannot compare ${id}`}>
          {(results[id] as { error: string }).error}
        </Banner>
      ))}

      {ids.length < 2 ? (
        <Panel>
          <EmptyState
            title={ids.length === 0 ? "Pick 2–3 completed runs" : "Add at least one more run"}
            body="Compare composition variants, seeds or videos. The first run is the baseline; deltas and configuration differences are shown against it."
            action={
              <Link href="/history" className={buttonClass("secondary")}>
                Choose from history
              </Link>
            }
          />
        </Panel>
      ) : !ready ? (
        <div className="grid animate-pulse gap-3" aria-busy="true">
          <div className="h-56 rounded-lg bg-surface-1" />
          <div className="h-[520px] rounded-lg bg-surface-1" />
        </div>
      ) : (
        <>
          {!sameVideo && (
            <Banner tone="warn" icon={<IconAlert />} title="Different videos">
              These runs are on different videos. Each coverage has its own denominator (that video&apos;s A_observed), so deltas compare outcomes, not like-for-like.
            </Banner>
          )}
          <Panel title="Configuration">
            <div className="relative overflow-x-auto">
              <table className="num w-full text-xs">
                <thead>
                  <tr className="[&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:text-left [&>th]:font-medium">
                    <th className="w-56 font-sans text-2xs text-fg-subtle uppercase">Setting</th>
                    {loaded.map((r, i) => (
                      <th key={r.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
                          <Link href={`/runs/${r.id}/results`} className="hover:underline">
                            {r.id}
                          </Link>
                          {i === 0 && <span className="font-sans text-2xs font-normal text-fg-subtle">baseline</span>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paramRows.map((p) => {
                    const vals = loaded.map((r) => p.get(r.run));
                    const differs = new Set(vals).size > 1;
                    return (
                      <tr key={p.label} className="[&>td]:h-8 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-3">
                        <td className="font-sans text-fg-muted">
                          {p.label}
                          {differs && <span className="ml-2 rounded-sm bg-accent-soft px-1 text-2xs text-accent">differs</span>}
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} className={cn(differs && v !== vals[0] && "bg-accent-soft text-fg", p.def && v !== p.def && "text-warn")}>
                            <Copyable value={v}>{v}</Copyable>
                            {p.def && v !== p.def && <span className="ml-1 font-sans text-2xs">(non-default)</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Metrics · delta vs baseline">
            <div className="relative overflow-x-auto">
              <table className="num w-full text-xs">
                <tbody>
                  {(["primary", "secondary"] as Trust[]).map((trust) => (
                    <FragmentRows key={trust} trust={trust} loaded={loaded} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-3 py-2 text-2xs text-fg-subtle">
              Green / red mark better / worse than baseline by each metric&apos;s direction (coverage ↑, DKM attempts ↓, runtime ↓). Unmeasured values show —
              and are not judged.
            </p>
          </Panel>

          <Panel
            title="Mosaics"
            actions={
              <label className="inline-flex items-center gap-2 text-xs text-fg-muted normal-case">
                <Switch checked={sync} onChange={setSync} label="Synchronise pan and zoom" /> sync pan/zoom
              </label>
            }
          >
            <div className={cn("grid gap-2 p-2", loaded.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
              {loaded.map((r, i) => (
                <div key={r.id} className="min-w-0">
                  <div className="num mb-1 flex items-center gap-1.5 text-2xs text-fg-muted">
                    <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
                    {r.id} · {r.run.variant?.name}
                  </div>
                  <MosaicViewer
                    src={getPipelineService().url(`/api/runs/${encodeURIComponent(r.id)}/mosaic.png`)}
                    width={r.run.metrics!.composition.mosaicWidth}
                    height={r.run.metrics!.composition.mosaicHeight}
                    label={`Mosaic ${r.id}`}
                    className="h-[260px] md:h-[340px]"
                    view={sync ? sharedView : (views[r.id] ?? FIT_VIEW)}
                    onViewChange={(v) => (sync ? setSharedView(v) : setViews((x) => ({ ...x, [r.id]: v })))}
                  />
                </div>
              ))}
            </div>
            <p className="px-3 pb-2 text-2xs text-fg-subtle">Synchronised in relative coordinates (zoom relative to fit, centre as a fraction of each canvas).</p>
          </Panel>
        </>
      )}
    </div>
  );
}

function FragmentRows({ trust, loaded }: { trust: Trust; loaded: Loaded[] }) {
  const base = loaded[0].run.metrics!;
  return (
    <>
      <tr>
        <th colSpan={loaded.length + 1} className="h-8 border-b border-line bg-surface-2 px-3 text-left font-sans text-2xs font-medium tracking-wide text-fg-subtle uppercase">
          {TRUST_TITLE[trust]}
        </th>
      </tr>
      {METRICS.filter((d) => d.trust === trust).map((d) => (
        <tr key={d.id} className="[&>td]:h-9 [&>td]:border-b [&>td]:border-line/60 [&>td]:px-3">
          <td className="w-56 font-sans text-fg-muted">
            <MetricLabel id={d.id} />
            {!d.comparable && <div className="text-2xs text-warn">not comparable across runs</div>}
          </td>
          {loaded.map((r, i) => {
            const m = r.run.metrics!;
            const v = d.get(m);
            const b = d.get(base);
            if (v == null)
              return (
                <td key={r.id} className="text-fg-subtle">
                  —
                </td>
              );
            // A delta that rounds to zero at display precision is not judged.
            const shownZero = b == null || !/[1-9]/.test(d.delta(v - b));
            const j = i === 0 || shownZero || b == null ? 0 : judgeDelta(d, b, v);
            return (
              <td key={r.id} className="whitespace-nowrap">
                <Copyable value={v}>{d.format(v)}</Copyable>
                {d.id === "coverage" && m.referenceChainBreaks > 0 && (
                  <span className="ml-1 rounded-sm bg-warn-soft px-1 text-2xs text-warn" title="Reference chain breaks: denominator unreliable">
                    ref ⚠
                  </span>
                )}
                {i > 0 && d.comparable && b != null && (
                  <span className={cn("ml-2 text-2xs", j > 0 ? "text-ok" : j < 0 ? "text-bad" : "text-fg-subtle")}>
                    {j > 0 ? "▲ " : j < 0 ? "▼ " : ""}
                    {d.delta(v - b)}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
