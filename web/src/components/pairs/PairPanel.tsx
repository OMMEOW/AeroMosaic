"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPipelineService, type PairDetail, type SubstageName } from "@/services";
import type { LivePair } from "@/lib/runReducer";
import { useTicker } from "@/hooks/useRunStream";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/primitives";
import { CauseBadge, Num, rejectSentence } from "./cause";

/**
 * One attempted pair, from real records only.
 *  - start: the two frames, the stage-1 SIFT putatives and the gate evidence that admitted the pair;
 *  - during DKM: a sub-stage stepper that moves only when the worker reports a sub-stage began
 *    (the DKM forward pass is one opaque call: it shows its name and elapsed time, nothing else);
 *  - done: DKM inlier correspondences (subsampled, stated), the ratio against 0.35, the verdict,
 *    and the live preview canvas with the new frame outlined.
 */

const SUBSTAGES: { name: SubstageName; label: string; note: string; timed: boolean }[] = [
  {
    name: "load",
    label: "load model / frames",
    note: "get_model() (loads DKM on the first attempt only) and cv2.imread of both frames. On the first pair this includes the model load, as the notebook's durationMs always has.",
    timed: true,
  },
  { name: "dkm_forward", label: "DKM forward pass", note: "one opaque call; no intermediate progress exists to show", timed: true },
  { name: "sample", label: "DKM sample", note: "10,000 correspondences from the dense field", timed: true },
  { name: "strict_fit", label: "layer 1 · F, τs 3.0", note: "epipolar (Sampson) filter, MAGSAC", timed: true },
  { name: "refit", label: "layer 2 · H, τr 4.0", note: "homography fit, mask recomputed by residual", timed: true },
  { name: "cache", label: "correspondence cache", note: "writes corr_<attempt>.npz (inside durationMs, as always)", timed: true },
  { name: "residuals", label: "residual fields", note: "d_geo, d_phot, certainty; accepted steps only; not in durationMs", timed: false },
];

export function usePairDetail(url: string | null) {
  const [st, setSt] = useState<{ url: string | null; detail: PairDetail | null; error: string | null; pruned: boolean }>({
    url: null,
    detail: null,
    error: null,
    pruned: false,
  });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getPipelineService()
      .getAsset(url)
      .then((b) => b.text())
      .then(
        (t) => !cancelled && setSt({ url, detail: JSON.parse(t) as PairDetail, error: null, pruned: false }),
        (e: Error & { code?: string }) =>
          !cancelled && setSt({ url, detail: null, error: e.message, pruned: e.code === "http_404" || /404/.test(e.message) }),
      );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return st.url === url ? st : { url, detail: null, error: null, pruned: false };
}

function PairImages({ detail, mode, svc }: { detail: PairDetail; mode: "putatives" | "inliers"; svc: ReturnType<typeof getPipelineService> }) {
  const [rw, rh] = detail.refSize;
  const [sw, sh] = detail.srcSize;
  const gap = 12;
  const W = rw + gap + sw;
  const H = Math.max(rh, sh);
  const lines = mode === "inliers" ? (detail.done?.inlierLines ?? []) : detail.putatives;
  const color = mode === "inliers" ? "var(--ok)" : "var(--series-1)";
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`Frames ${detail.frameI} and ${detail.frameJ} with ${lines.length} ${mode}`}>
      <image href={svc.url(detail.refUrl)} x={0} y={0} width={rw} height={rh} />
      <image href={svc.url(detail.srcUrl)} x={rw + gap} y={0} width={sw} height={sh} />
      <g stroke={color} strokeWidth={1} strokeOpacity={0.55}>
        {lines.map((l, k) => (
          <line key={k} x1={l[0]} y1={l[1]} x2={l[2] + rw + gap} y2={l[3]} />
        ))}
      </g>
      <g fill={color}>
        {lines.map((l, k) => (
          <g key={k}>
            <circle cx={l[0]} cy={l[1]} r={1.8} />
            <circle cx={l[2] + rw + gap} cy={l[3]} r={1.8} />
          </g>
        ))}
      </g>
      <text x={4} y={H + 14} fontSize={12} fill="var(--fg-muted)" className="num">
        ref f{detail.frameI}
      </text>
      <text x={rw + gap + 4} y={H + 14} fontSize={12} fill="var(--fg-muted)" className="num">
        new f{detail.frameJ}
      </text>
    </svg>
  );
}

function RatioBar({ ratio, min = 0.35 }: { ratio: number | null; min?: number }) {
  if (ratio == null) return <p className="text-xs text-fg-muted">No homography was fitted, so there is no inlier ratio.</p>;
  return (
    <div>
      <div className="relative h-3 rounded-sm bg-surface-3">
        <div className={cn("h-full rounded-sm", ratio >= min ? "bg-ok" : "bg-warn")} style={{ width: `${Math.min(1, ratio) * 100}%` }} />
        <div className="absolute inset-y-[-3px] w-0.5 bg-fg" style={{ left: `${min * 100}%` }} title={`accept ≥ ${min}`} />
      </div>
      <div className="num mt-1 flex justify-between text-2xs text-fg-muted">
        <span>inlier ratio {ratio.toFixed(3)}</span>
        <span>accept ≥ {min}</span>
      </div>
    </div>
  );
}

function Stepper({ pair, live }: { pair: LivePair; live: boolean }) {
  const ticking = live && !!pair.active && !pair.done;
  const now = useTicker(ticking, 100);
  const doneMs = new Map(pair.substages.map((s) => [s.name, s.ms]));
  const accepted = pair.record?.accepted;
  const timedSum = pair.substages.filter((s) => SUBSTAGES.find((x) => x.name === s.name)?.timed).reduce((a, s) => a + s.ms, 0);
  return (
    <div>
      <ol className="flex flex-col">
        {SUBSTAGES.map((s) => {
          const ms = doneMs.get(s.name);
          const active = pair.active?.name === s.name && !pair.done;
          const skipped = s.name === "residuals" && pair.done && !accepted;
          const elapsed = active && ticking && now ? Math.max(0, now - Date.parse(pair.active!.at)) : null;
          return (
            <li key={s.name} className={cn("grid grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-x-2 py-0.5 text-xs", !s.timed && "mt-1 border-t border-dashed border-line pt-1.5")}>
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 self-center rounded-full",
                  ms != null ? "bg-ok" : active ? "pulse-dot bg-accent" : "border border-fg-subtle",
                  skipped && "border-dashed opacity-40",
                )}
              />
              <Tooltip content={s.note}>
                <span className={cn("cursor-help truncate", active ? "text-accent" : ms != null ? "text-fg" : "text-fg-subtle")}>{s.label}</span>
              </Tooltip>
              <span className="num text-right text-2xs text-fg-muted">
                {ms != null ? `${ms.toFixed(0)} ms` : active ? (elapsed != null ? `${(elapsed / 1000).toFixed(1)} s…` : "running") : skipped ? "not run (rejected)" : "—"}
              </span>
            </li>
          );
        })}
      </ol>
      {pair.record && (
        <p className="num mt-1.5 text-2xs text-fg-subtle">
          durationMs {pair.record.durationMs} · timed sub-stages {timedSum.toFixed(0)} ms
        </p>
      )}
    </div>
  );
}

function GateCard({ detail }: { detail: PairDetail | null }) {
  if (!detail) return null;
  const g = detail.gate;
  const flag = (ok: boolean | null, label: string) =>
    ok == null ? (
      <span className="text-fg-subtle">{label} —</span>
    ) : (
      <span className={ok ? "text-ok" : "text-warn"}>
        {label} {ok ? "✓" : "✕"}
      </span>
    );
  return (
    <div className="rounded-md border border-line bg-surface-2 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-2xs tracking-wide text-fg-subtle uppercase">Stage-1 evidence (cheap)</span>
        <span className={cn("text-2xs font-medium", g.passed ? "text-ok" : "text-warn")}>{g.passed ? "passed the gate" : `gate rejected: ${g.reject}`}</span>
      </div>
      <dl className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <dt className="text-fg-muted">f_m</dt>
        <dd className="text-right">
          <Num v={g.fm} /> <span className="text-fg-subtle">/ ω {g.omega}</span>
        </dd>
        <dt className="text-fg-muted">proxy IoU</dt>
        <dd className="text-right">
          <Num v={g.proxyIou} digits={2} /> <span className="text-fg-subtle">/ {g.iouTrust}</span>
        </dd>
        <dt className="text-fg-muted">f_u (diagnostic)</dt>
        <dd className="text-right">
          <Num v={g.fu} />
        </dd>
        <dt className="text-fg-muted">putatives · proxy inliers</dt>
        <dd className="text-right">
          {g.nPutative ?? "—"} · {g.nProxyInliers ?? "—"}
        </dd>
        <dt className="text-fg-muted">gap</dt>
        <dd className="text-right">{detail.gap}</dd>
      </dl>
      <div className="num mt-1 flex gap-3 text-2xs">
        {flag(g.fmPasses, "f_m")}
        {flag(g.iouPasses, "IoU")}
      </div>
    </div>
  );
}

export function PairPanel({ pair, live, videoId }: { pair: LivePair; live: boolean; videoId?: string }) {
  const svc = getPipelineService();
  // start-time JSON has the putatives; the done-time JSON adds inlier lines and the canvas
  const url = pair.pruned ? null : (pair.done?.pairUrl ?? pair.start.pairUrl);
  const { detail, pruned, error } = usePairDetail(url);
  const [mode, setMode] = useState<"auto" | "putatives" | "inliers">("auto");
  const shown = mode === "auto" ? (detail?.done ? "inliers" : "putatives") : mode;
  const rec = pair.record;
  const s = pair.start;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="num text-sm">
          <span className="text-fg-subtle">pair #{s.attempt}</span> <b>{s.frameI}→{s.frameJ}</b> <span className="text-fg-muted">gap {s.gap}</span>
          {videoId && (
            <Link href={`/new?video=${encodeURIComponent(videoId)}&i=${s.frameI}&j=${s.frameJ}`} className="ml-2 text-2xs text-accent hover:underline">
              run this pair alone
            </Link>
          )}
        </div>
        {rec ? (
          rec.rejectCause ? (
            <CauseBadge cause={rec.rejectCause}>
              <span className="num">{rejectSentence(rec)}</span>
            </CauseBadge>
          ) : (
            <span className="inline-flex h-5 items-center rounded-sm border border-ok/40 bg-ok-soft px-1.5 text-2xs font-medium text-ok">✓ accepted</span>
          )
        ) : (
          <span className="text-2xs text-accent">{pair.active ? `in ${SUBSTAGES.find((x) => x.name === pair.active!.name)?.label}` : "starting"}</span>
        )}
      </div>

      {pruned || pair.pruned ? (
        <p className="rounded-md border border-dashed border-line p-3 text-xs text-fg-muted">
          Overlays for this pair were pruned by the retention cap (the most recent 50 pairs and every rejected pair are kept). Its numbers remain in
          steps.jsonl.
        </p>
      ) : error ? (
        <p className="text-xs text-bad">{error}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1" role="group" aria-label="Correspondences shown">
              {(["putatives", "inliers"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === "inliers" && !detail?.done}
                  onClick={() => setMode(m)}
                  aria-pressed={shown === m}
                  className={cn(
                    "h-6 rounded-sm border px-2 text-2xs disabled:opacity-40",
                    shown === m ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg",
                  )}
                >
                  {m === "putatives" ? `SIFT putatives (stage 1)${detail ? ` · ${detail.putatives.length}` : ""}` : `DKM inliers (stage 2)${detail?.done ? ` · ${detail.done.inlierLines.length} shown` : ""}`}
                </button>
              ))}
            </div>
            {detail ? <PairImages detail={detail} mode={shown} svc={svc} /> : <div className="aspect-[2.2] animate-pulse rounded-md bg-surface-2" />}
            <p className="mt-1 text-2xs text-fg-subtle">{shown === "inliers" ? detail?.done?.linesNote : detail?.putativesNote}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <GateCard detail={detail} />
            <div>
              <div className="mb-1 text-2xs tracking-wide text-fg-subtle uppercase">DKM + dual layer (measured)</div>
              <Stepper pair={pair} live={live} />
            </div>
            {rec && <RatioBar ratio={rec.inlierRatio} />}
          </div>
        </div>
      )}

      {detail?.done && !pruned && (
        <div>
          <div className="mb-1 text-2xs tracking-wide text-fg-subtle uppercase">Preview canvas after this pair</div>
          <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-md border border-line bg-inset">
            {/* eslint-disable-next-line @next/next/no-img-element -- per-pair artifact */}
            <img src={svc.url(detail.done.canvasUrl)} alt={`Preview canvas after pair ${s.attempt}`} className="block w-full" />
            {detail.done.quad && (
              <svg viewBox={`0 0 ${detail.done.canvasSize[0]} ${detail.done.canvasSize[1]}`} className="absolute inset-0 size-full" aria-hidden="true">
                <polygon points={detail.done.quad.map((q) => q.join(",")).join(" ")} fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeWidth={3} />
              </svg>
            )}
          </div>
          <p className="mt-1 text-2xs text-fg-subtle">
            {detail.done.quad ? `Outlined: frame ${s.frameJ}, just placed. ` : "Nothing placed: the pair was rejected. "}
            {detail.done.canvasNote}
            {detail.vizMs != null && ` Visualisation cost ${fmtDuration(detail.vizMs)} for this pair, outside durationMs.`}
          </p>
        </div>
      )}
    </div>
  );
}
