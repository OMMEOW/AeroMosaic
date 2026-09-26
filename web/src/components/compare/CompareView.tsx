"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PARAMS, type RunResult, type RunSummary } from "@/services";
import { useService } from "@/hooks/useAsync";
import { Figure } from "@/components/charts/Figure";
import { compareDriftSpec } from "@/components/charts/runCharts";
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
  caveat: "Caveated — shown, not judged",
};

export function CompareView({ ids }: { ids: string[] }) {
  const router = useRouter();
  const all = useService((svc) => svc.listRuns(), []);
  const [results, setResults] = useState<Record<string, RunResult | { error: string }>>({});
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
          [id]: d.state === "ready" ? d.result : { error: d.state === "error" ? d.message : `Run is ${d.state === "not-ready" ? d.snapshot.run.status : "loading"} — only succeeded runs compare.` },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const setIds = (next: string[]) => router.replace(next.length ? `/compare?runs=${next.join(",")}` : "/compare");
  const succeeded = (all.data ?? []).filter((r) => r.status === "succeeded");
  const loaded = ids.map((id) => results[id]).filter((r): r is RunResult => !!r && "runId" in r);
  const failed = ids.filter((id) => results[id] && "error" in results[id]!);
  const ready = loaded.length === ids.length && ids.length > 0;

  const driftSpec = useMemo(() => (ready ? compareDriftSpec(loaded.map((r) => ({ id: r.runId, steps: r.steps }))) : null), [ready, loaded]);

  const paramRows: { label: string; get: (r: RunSummary) => string; def: string }[] = [
    { label: "ω (selection threshold)", get: (r) => String(r.params.selectionThreshold), def: String(DEFAULT_PARAMS.selectionThreshold) },
    { label: "Candidate gaps", get: (r) => `[${r.params.candidateGaps.join(",")}]`, def: `[${DEFAULT_PARAMS.candidateGaps.join(",")}]` },
    { label: "Max working resolution", get: (r) => `${r.params.maxWorkingResolution} px`, def: `${DEFAULT_PARAMS.maxWorkingResolution} px` },
    { label: "Dense refinement", get: (r) => (r.params.denseRefinement ? "on" : "off"), def: DEFAULT_PARAMS.denseRefinement ? "on" : "off" },
    { label: "Video", get: (r) => r.video.filename, def: "" },
    { label: "Native frames", get: (r) => String(r.video.frameCount), def: "" },
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
                {r.id} · {r.video.filename} · ω={r.params.selectionThreshold} · {fmtDateTime(r.createdAt)}
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
            body="Use this to compare thresholds and parameters: the first run is the baseline; deltas and parameter differences are shown against it."
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
          <Panel title="Parameters">
            <div className="relative overflow-x-auto">
              <table className="num w-full text-xs">
                <thead>
                  <tr className="[&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:text-left [&>th]:font-medium">
                    <th className="w-56 font-sans text-2xs text-fg-subtle uppercase">Parameter</th>
                    {loaded.map((r, i) => (
                      <th key={r.runId}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
                          <Link href={`/runs/${r.runId}/results`} className="hover:underline">
                            {r.runId}
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
                  {(["primary", "secondary", "caveat"] as Trust[]).map((trust) => (
                    <FragmentRows key={trust} trust={trust} loaded={loaded} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-3 py-2 text-2xs text-fg-subtle">
              Green / red mark better / worse than baseline by each metric&apos;s direction (coverage ↑, drift → ideal, runtime ↓). Caveated metrics
              are listed but never judged.
            </p>
          </Panel>

          {driftSpec && <Figure spec={driftSpec} run={loaded[0].run} file="compare_g_scale" height={240} aboutId="metric-g-scale" />}

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
                <div key={r.runId} className="min-w-0">
                  <div className="num mb-1 flex items-center gap-1.5 text-2xs text-fg-muted">
                    <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
                    {r.runId} · ω={r.run.params.selectionThreshold}
                  </div>
                  <MosaicViewer
                    src={r.mosaic.url}
                    width={r.mosaic.width}
                    height={r.mosaic.height}
                    label={`Mosaic ${r.runId}`}
                    className="h-[260px] md:h-[340px]"
                    view={sync ? sharedView : (views[r.runId] ?? FIT_VIEW)}
                    onViewChange={(v) => (sync ? setSharedView(v) : setViews((x) => ({ ...x, [r.runId]: v })))}
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

function FragmentRows({ trust, loaded }: { trust: Trust; loaded: RunResult[] }) {
  const base = loaded[0].metrics;
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
            const v = d.get(r.metrics);
            const b = d.get(base);
            // A delta that rounds to zero at display precision is not judged.
            const shownZero = !/[1-9]/.test(d.delta(v - b));
            const j = i === 0 || shownZero ? 0 : judgeDelta(d, b, v);
            return (
              <td key={r.runId} className="whitespace-nowrap">
                <Copyable value={v}>{d.format(v)}</Copyable>
                {d.id === "coverage" && r.metrics.referenceChainBreaks > 0 && (
                  <span className="ml-1 rounded-sm bg-warn-soft px-1 text-2xs text-warn" title="Reference chain breaks: denominator unreliable">
                    ref ⚠
                  </span>
                )}
                {i > 0 && d.comparable && (
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
