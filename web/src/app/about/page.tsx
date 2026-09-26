import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_PARAMS, MIN_INLIER_RATIO } from "@/services";
import { DRIFT_BAND, METRICS, type Trust } from "@/lib/metrics";

export const metadata: Metadata = { title: "Methodology" };

const STAGES = [
  {
    id: "decode",
    name: "Decode",
    body: "Reads every frame of the video at its native rate (e.g. 2,047 frames from a 34 s clip at 59.94 fps) and downscales it to the working resolution.",
  },
  {
    id: "probe",
    name: "Probe",
    body: "From each anchor frame, scores every candidate forward gap with a cheap SIFT feature check (≈9 ms per pair). The score is f_m.",
  },
  {
    id: "select",
    name: "Select",
    body: "Keeps the smallest set of frames that still chain together: from each anchor the chain takes the largest gap whose f_m ≥ ω. If no candidate clears ω the chain falls back to the smallest gap — a forced step. Typically 16–70 frames survive out of 600–2,000.",
  },
  {
    id: "match",
    name: "Match",
    body: `Dense neural matching (DKM) on consecutive selected frames only (≈5 s per pair — the slow stage, and the reason SELECT exists). A step is accepted when its RANSAC inlier ratio is ≥ ${MIN_INLIER_RATIO.toFixed(2)}; a rejected frame is left out of the mosaic and the chain is held by the probe homography.`,
  },
  { id: "composite", name: "Composite", body: "Warps the accepted frames into one mosaic canvas and blends the seams." },
  {
    id: "evaluate",
    name: "Evaluate",
    body: "Registers the mosaic to an independent reference and scores ground coverage. Also reports accumulated drift and pairwise overlap quality.",
  },
];

const PARAMS = [
  {
    id: "param-omega",
    name: "Selection threshold ω",
    def: String(DEFAULT_PARAMS.selectionThreshold),
    body: "Minimum probe score f_m for a candidate pair to count as chained. Raising ω keeps more frames (safer, slower); lowering it keeps fewer (faster, more likely to break or drift).",
  },
  { id: "param-gaps", name: "Candidate gaps", def: `[${DEFAULT_PARAMS.candidateGaps.join(", ")}]`, body: "Forward gaps, in native frames, probed from each anchor. The largest passing gap wins, so the largest gap sets the maximum frame reduction." },
  { id: "param-res", name: "Max working resolution", def: `${DEFAULT_PARAMS.maxWorkingResolution} px`, body: "Long-edge size frames are downscaled to before matching. Lower is faster and uses less GPU memory at some cost in precision." },
  { id: "param-refine", name: "Dense matcher refinement", def: DEFAULT_PARAMS.denseRefinement ? "on" : "off", body: "DKM's optional refinement pass: slightly better correspondences, ≈1.6× slower per pair." },
];

const TRUST: Record<Trust, { title: string; intro: string }> = {
  primary: { title: "Primary metrics — lead with these", intro: "Reliable and comparable across runs of the same footage." },
  secondary: { title: "Secondary metrics", intro: "Useful context: cost, footage quality, and whether the primary numbers can be trusted." },
  caveat: { title: "Caveated metrics — these mislead", intro: "Shown for completeness, always with the reason they cannot be read on their own." },
};

const EXTRA: Record<string, string> = {
  coverage:
    "The headline metric. The denominator is the ground observed by the camera according to a fixed, independent reference — so a run cannot score well by producing a small mosaic. If the reference chain itself has breaks, the denominator is unreliable and the UI badges it.",
  "g-scale": "Product of per-step scale errors along the chain. The UI shows its deviation from 1.0; a curve that runs away from the display band means the chain is diverging.",
  "g-shear": "Accumulated shear coefficient along the chain; the sign shows direction. Distance from 0 is the error.",
  forced: "A forced step joins two frames whose f_m was below ω. Any non-zero count means the footage contains segments that could not be registered normally (glare, motion blur, open water, featureless ground).",
  fill:
    "Filled canvas pixels / canvas pixels. A run that loses its chain early produces a small canvas that is easy to fill, so failure can score high. The UI never shows fill ratio without ground coverage beside it.",
  psnr:
    "Computed on each registered pair's overlap region and averaged over accepted steps only. Larger frame gaps change which pixels are measured, so the value is not comparable between runs with different frame counts — including the same video at a different ω.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="text-lg font-semibold">Methodology</h1>
      <p className="mt-1 text-sm text-fg-muted">
        What each pipeline stage does and what each metric means. Every metric tooltip in the app links to its entry here.
      </p>

      <section className="mt-6" aria-labelledby="stages">
        <h2 id="stages" className="text-base font-semibold">
          Pipeline stages
        </h2>
        <ol className="mt-2 space-y-2">
          {STAGES.map((s, i) => (
            <li key={s.id} id={`stage-${s.id}`} className="scroll-mt-16 rounded-lg border border-line bg-surface-1 p-3 target:border-accent">
              <div className="text-sm font-medium">
                <span className="num mr-2 text-fg-subtle">{String(i + 1).padStart(2, "0")}</span>
                {s.name.toUpperCase()}
              </div>
              <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="params">
        <h2 id="params" className="text-base font-semibold">
          Parameters
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          <span className="text-fg">ω provenance:</span>{" "}
          <span className="rounded-sm bg-warn-soft px-1 text-warn">
            TODO — one line on how ω = 0.164 was calibrated (dataset and procedure). Not filled in: it must come from the pipeline authors.
          </span>
        </p>
        <dl className="mt-2 space-y-2">
          {PARAMS.map((p) => (
            <div key={p.id} id={p.id} className="scroll-mt-16 rounded-lg border border-line bg-surface-1 p-3 target:border-accent">
              <dt className="flex items-baseline justify-between gap-2 text-sm font-medium">
                {p.name}
                <span className="num text-xs font-normal text-fg-subtle">default {p.def}</span>
              </dt>
              <dd className="mt-1 text-sm text-fg-muted">{p.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(["primary", "secondary", "caveat"] as Trust[]).map((t) => (
        <section key={t} className="mt-8">
          <h2 className="text-base font-semibold">{TRUST[t].title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{TRUST[t].intro}</p>
          <dl className="mt-2 space-y-2">
            {METRICS.filter((m) => m.trust === t).map((m) => (
              <div
                key={m.id}
                id={`metric-${m.id}`}
                className={`scroll-mt-16 rounded-lg border bg-surface-1 p-3 target:border-accent ${t === "caveat" ? "border-warn/30" : "border-line"}`}
              >
                <dt className="text-sm font-medium">{m.label}</dt>
                <dd className="mt-1 text-sm text-fg-muted">
                  {EXTRA[m.id] ?? m.summary}
                  {m.caveat && !EXTRA[m.id] && <p className="mt-1 text-warn">{m.caveat}</p>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-base font-semibold">Display aids (not pipeline thresholds)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
          <li>
            Drift charts shade a band of ±{DRIFT_BAND.scale * 100}% around G_scale = 1 and ±{DRIFT_BAND.shear} around G_shear = 0; the area outside is tinted.
          </li>
          <li>Drift badges: “elevated” when |G_scale − 1| &gt; 4% or |G_shear| &gt; 0.02; “diverged” when &gt; 10% or &gt; 0.05.</li>
          <li>These are UI conventions for spotting runaway curves. Adjust them in <code className="num">src/lib/metrics.ts</code>.</li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/history" className="text-accent hover:underline">
            ← Back to runs
          </Link>
        </p>
      </section>
    </div>
  );
}
