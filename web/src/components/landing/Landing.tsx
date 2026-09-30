"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { getPipelineService, type RunSummary } from "@/services";
import { useHealth } from "@/hooks/useHealth";
import { useService } from "@/hooks/useAsync";
import { fmtInt, fmtPct } from "@/lib/format";
import { IconArrowRight } from "@/components/ui/icons";
import { RelTime } from "@/components/ui/misc";
import { buttonClass, cn } from "@/components/ui/primitives";
import { VariantBadge } from "@/components/run/VariantBadge";

/**
 * Landing page. Everything with a number is either read live from the backend (status, videos,
 * runs, the latest mosaic) or quoted from the project's own reports (PARITY.md,
 * MPS_INV_IMPACT.md), with the source named. Nothing here is illustrative.
 */

/** Primary call to action on the landing page: brand fill (the app itself keeps its blue accent). */
const brandCta = "inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const STEPS = [
  {
    k: "01",
    title: "Pick the frames worth matching",
    tag: "Stage 1 · cheap",
    body: "Every candidate pair at gaps 1–64 is probed with SIFT-500: f_m (putative matches / 500), a proxy homography and its footprint IoU. A pair is kept only if IoU ≥ 0.40 and f_m ≥ ω = 0.164; the exact DAG shortest path over the survivors decides which pairs DKM will see.",
  },
  {
    k: "02",
    title: "Register them densely, check them twice",
    tag: "Stage 2 · expensive",
    body: "DKMv3 matches each planned pair; a dual-layer constraint fits F at τs 3.0, then H at τr 4.0, and accepts the step only if the inlier ratio reaches 0.35. A rejection bans that edge and re-plans from the same reference.",
  },
  {
    k: "03",
    title: "Compose the seam, measure the ground",
    tag: "Composition + coverage",
    body: "Accepted frames are composed with SemanticStitch (or hybrid, or a d_geo seam) and scored twice: seam-line consistency (SLC) for the seams, and absolute coverage against a fixed denominator — the ground an independent reference chain says the camera actually saw.",
  },
];

const FEATURES = [
  { t: "Watch every pair", b: "Frames, the SIFT evidence that admitted them, DKM's sub-stages as they happen, inlier correspondences and the canvas growing frame by frame." },
  { t: "See why a pair was dropped", b: "Proxy fit, IoU gate, f_m gate, degenerate homography, ratio below 0.35 — six distinct causes, never one generic “rejected”." },
  { t: "Honest cost accounting", b: "DKM calls and time against the N=fps and native-chain baselines, measured where it can be and labelled “projected” where it can't." },
  { t: "Seam-line metrics", b: "The notebook's own SLC, seam step and sharpness numbers for every composition, and the full hybrid w_sem sweep when you ask for it." },
  { t: "Investigate one edge", b: "Run any two frames on their own — the gate's verdict next to DKM's — without re-running the whole video." },
  { t: "Everything on disk", b: "One directory per run: manifest, every record, the event log, the mosaic and a PDF report. Refresh, restart or crash — it all replays." },
];

const FACTS = [
  { v: "51 / 51", l: "DKM attempts bit-identical between the package and the original notebook on CPU (road5)", src: "PARITY.md §1" },
  { v: "≈ 4.5×", l: "faster DKM on the Apple GPU than on CPU (road5: 163 s vs 783 s)", src: "PARITY.md" },
  { v: "1 / 177", l: "decisions changed by the torch 2.13 MPS batched-inverse bug; ω unchanged at 0.164", src: "MPS_INV_IMPACT.md" },
  { v: "121", l: "labelled pairs behind ω = 0.164 (Youden's J)", src: "Methodology" },
];

function StatusStrip() {
  const health = useHealth();
  const videos = useService((s) => s.listVideos(), []);
  const runs = useService((s) => s.listRuns(), []);
  const h = health.status === "ok" ? health.health : null;
  const items: { k: string; v: React.ReactNode; tone?: "ok" | "bad" | "warn" }[] =
    health.status === "unreachable"
      ? [{ k: "Backend", v: `unreachable at ${getPipelineService().baseUrl}`, tone: "bad" }]
      : [
          { k: "Backend", v: h ? (h.runsAllowed ? "ready" : "not ready") : "checking…", tone: h ? (h.runsAllowed ? "ok" : "warn") : undefined },
          { k: "Device", v: h?.info ? `${h.info.device} · torch ${h.info.torch}` : "—" },
          {
            k: "Inverse self-test",
            v: h?.info ? (h.info.inverseSelftest.passed ? `passed · ${h.info.inverseSelftest.maxRelErr?.toExponential(1)}` : "failed") : "—",
            tone: h?.info ? (h.info.inverseSelftest.passed ? "ok" : "bad") : undefined,
          },
          {
            k: "SemanticStitch",
            v: h?.info ? (h.info.semstitch.verified ? "checkpoint verified" : "not available") : "—",
            tone: h?.info ? (h.info.semstitch.verified ? "ok" : "warn") : undefined,
          },
          { k: "Videos", v: videos.data ? fmtInt(videos.data.length) : "—" },
          { k: "Runs", v: runs.data ? fmtInt(runs.data.length) : "—" },
        ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6" role="status" aria-label="Backend status">
      {items.map((i) => (
        <div key={i.k} className="bg-surface-1 px-3 py-2.5">
          <div className="text-2xs tracking-wide text-fg-subtle uppercase">{i.k}</div>
          <div
            className={cn(
              "num mt-0.5 truncate text-sm",
              i.tone === "ok" ? "text-ok" : i.tone === "bad" ? "text-bad" : i.tone === "warn" ? "text-warn" : "text-fg",
            )}
          >
            {i.v}
          </div>
        </div>
      ))}
    </div>
  );
}

function LatestMosaic() {
  const runs = useService((s) => s.listRuns(), []);
  const latest: RunSummary | null = useMemo(
    () => (runs.data ?? []).find((r) => r.status === "succeeded" && r.kind === "video" && r.metrics) ?? null,
    [runs.data],
  );
  if (runs.status === "error" && !runs.data) return null;
  if (!latest) {
    return (
      <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-line p-6 text-center">
        <p className="text-sm text-fg-muted">{runs.data ? "No finished runs yet. Your first mosaic will appear here." : "Loading runs…"}</p>
        {runs.data && (
          <Link href="/new" className={cn(buttonClass("secondary", "sm"), "mt-3")}>
            Start a run
          </Link>
        )}
      </div>
    );
  }
  const m = latest.metrics!;
  return (
    <Link href={`/runs/${latest.id}/results`} className="group block overflow-hidden rounded-lg border border-line bg-surface-1 transition-colors hover:border-line-strong">
      <div className="relative flex h-[300px] items-center justify-center bg-surface-inset">
        {/* eslint-disable-next-line @next/next/no-img-element -- backend mosaic preview */}
        <img
          src={getPipelineService().url(`/api/runs/${encodeURIComponent(latest.id)}/mosaic_preview.png`)}
          alt={`Mosaic of ${latest.video.filename}`}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm text-fg">
            {latest.video.filename} <span className="num text-xs text-fg-subtle">{latest.videoId}</span>
          </div>
          <div className="num text-2xs text-fg-muted">
            coverage {fmtPct(m.absoluteCoverage, 2)} · {fmtInt(m.stage2.nComposited)}/{fmtInt(m.nativeFrames)} frames · {m.stage2.attempts} DKM calls
            {m.composition.seam?.slc_frac_disagree != null && ` · SLC ${m.composition.seam.slc_frac_disagree.toFixed(3)}`} ·{" "}
            <RelTime iso={latest.finishedAt ?? latest.createdAt} />
          </div>
        </div>
        <VariantBadge run={latest} />
      </div>
    </Link>
  );
}

export function Landing() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 pb-12">
      {/* hero */}
      <section className="grid items-center gap-8 pt-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pt-12">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-2xs font-medium tracking-wide text-brand uppercase">
            UAV video → ground mosaic · on this Mac
          </span>
          <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Stitch drone video into a mosaic <span className="text-brand">you can measure.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-fg-muted">
            AeroMosaic spends dense matching only where cheap evidence says it will pay off, registers those frames with DKM, composes the seams with
            SemanticStitch, and scores the result against the ground the camera actually saw — with every decision on screen and on disk.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/new" className={brandCta}>
              Start a run <IconArrowRight size={12} />
            </Link>
            <Link href="/history" className={buttonClass("secondary")}>
              Browse runs
            </Link>
            <Link href="/about" className={buttonClass("ghost")}>
              How it works
            </Link>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md">
          <div aria-hidden="true" className="absolute inset-x-0 -inset-y-4 rounded-[2.5rem] bg-brand-soft blur-2xl sm:-inset-6" />
          <div className="relative rounded-[1.75rem] bg-white p-6 shadow-pop">
            <Image
              src="/brand/aeromosaic-lockup.png"
              alt="AeroMosaic: a drone projecting its camera footprint onto a mosaic of ground tiles"
              width={760}
              height={640}
              loading="eager"
              fetchPriority="high"
              className="h-auto w-full"
            />
          </div>
        </div>
      </section>

      <StatusStrip />

      {/* how it works */}
      <section aria-labelledby="how">
        <h2 id="how" className="text-lg font-semibold">
          How it works
        </h2>
        <p className="mt-1 text-sm text-fg-muted">The NB_L2 pipeline, run exactly as the notebook defines it.</p>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.k} className="flex flex-col rounded-lg border border-line bg-surface-1 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="num text-2xl font-semibold text-brand">{s.k}</span>
                <span className="text-2xs tracking-wide text-fg-subtle uppercase">{s.tag}</span>
              </div>
              <h3 className="mt-2 text-sm font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* latest + features */}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="latest">
        <div>
          <h2 id="latest" className="text-lg font-semibold">
            Latest mosaic
          </h2>
          <p className="mt-1 mb-3 text-sm text-fg-muted">Straight from your most recent finished run.</p>
          <LatestMosaic />
        </div>
        <div>
          <h2 className="text-lg font-semibold">What you see while it runs</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.t} className="rounded-lg border border-line bg-surface-1 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
                  {f.t}
                </div>
                <p className="mt-1 text-xs text-fg-muted">{f.b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* verified */}
      <section aria-labelledby="verified">
        <h2 id="verified" className="text-lg font-semibold">
          Verified, not assumed
        </h2>
        <p className="mt-1 text-sm text-fg-muted">The Apple Silicon port was checked against the original notebook before anything was served.</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.v} className="rounded-lg border border-line bg-surface-1 p-4">
              <dt className="num text-2xl font-semibold text-fg">{f.v}</dt>
              <dd className="mt-1 text-xs text-fg-muted">{f.l}</dd>
              <dd className="mt-2 text-2xs text-fg-subtle">source: {f.src}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft px-6 py-10 text-center">
        <h2 className="text-xl font-semibold">Ready when your footage is.</h2>
        <p className="max-w-lg text-sm text-fg-muted">Pick a video from the data root or add your own — from this computer or an attached drive.</p>
        <Link href="/new" className={brandCta}>
          Start a run <IconArrowRight size={12} />
        </Link>
      </section>
    </div>
  );
}
