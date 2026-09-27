import type { Metadata } from "next";
import Link from "next/link";
import { METRICS, type Trust } from "@/lib/metrics";

export const metadata: Metadata = { title: "Methodology" };

/** What NB_L2 does, stage by stage, as the backend runs it (backend/pipeline, generated from the notebook). */
const STAGES = [
  {
    group: "Preflight",
    items: [
      {
        id: "preflight",
        name: "Preflight",
        body: "Checks that the requested composition can run. SemanticStitch needs its checkpoint present and its SHA-256 verified; otherwise the run fails here with the path. There is no fallback to another composition. DKM weights must be present locally.",
      },
      {
        id: "selftest",
        name: "Batched-inverse self-test",
        body: "torch 2.13 on MPS computes batched torch.linalg.inv wrongly for batch elements ≥ 1 when N > ~1024. DKM's GP layer hits this at b = 2, N = 1530. The pipeline inverts per element during DKM's match(), and every run first inverts 2 × 1530² matrices on the device and compares with CPU; if the relative error exceeds 1e-3 it refuses to run.",
      },
    ],
  },
  {
    group: "Stage 1 · pre-DKM selection (cheap, SIFT)",
    items: [
      { id: "decode", name: "Decode", body: "Every frame at the native rate, long edge ≤ 1920 px. The frame count is the decoded count, never the container's CAP_PROP_FRAME_COUNT." },
      { id: "sift", name: "SIFT-500 describe", body: "500 SIFT features per frame. 500 is the probe budget and the denominator of f_m." },
      {
        id: "probe",
        name: "Probe and gate",
        body: "Every candidate edge (i, i+g) for g ∈ {1, 2, 4, 8, 16, 32, 64}: ratio-test matches (f_m = putative / 500), a MAGSAC proxy homography, its footprint IoU, and f_u (recorded for diagnosis, not gated). Checked in this order: proxy fit (PROXY_FIT_FAILED), IoU ≥ 0.40 (GATE_IOU), f_m ≥ ω = 0.164 (GATE_FM).",
      },
      {
        id: "select",
        name: "DAG shortest path",
        body: "Exact shortest path over the surviving edges from frame 0 towards the last frame: fewest hops (= DKM calls) first, then the smallest Σ gap². This is the initial plan.",
      },
    ],
  },
  {
    group: "Stage 2 · DKM and evaluation (expensive)",
    items: [
      {
        id: "reference",
        name: "Reference chain and A_observed",
        body: "A SIFT-4000 consecutive-frame chain (MAGSAC, 3.0 px, 0.999) places every native frame; the union of their footprints is A_observed, the fixed per-run denominator of coverage. It is independent of the method's selection. Breaks in this chain make the denominator unsound and are reported.",
      },
      {
        id: "dkm",
        name: "DKM with re-planning",
        body: "DKMv3 outdoor (upsample_preds = False, 10,000 samples) on the next hop of the plan, then the dual-layer constraint: layer 1 fits F with MAGSAC at τs = 3.0; layer 2 fits a homography at τr = 4.0 (MAGSAC on this Mac, GC-RANSAC on the original CUDA machine) and recomputes the inlier mask by residual. Accepted iff inliers / post-epipolar matches ≥ 0.35. On rejection the edge is banned and the path re-solved from the same reference (DEGENERATE_H if no homography, RATIO_BELOW_MIN otherwise). An exception fails the run at that pair (EXCEPTION); nothing is skipped.",
      },
      {
        id: "composite",
        name: "Composition",
        body: "Accepted frames are warped by the accumulated homographies and composed with the chosen variant: SemanticStitch (the target), firstwins (each frame fills only uncovered canvas), or a d_geo-routed seam. Steps whose overlap is under 50 px, or where the seam network fails, are composed first-wins by the notebook; the count is reported as seam fallback steps.",
      },
      { id: "coverage", name: "Absolute coverage", body: "|A_method ∩ A_observed| / |A_observed|, both placed by the reference chain." },
    ],
  },
];

const TRUST: Record<Trust, { title: string; intro: string }> = {
  primary: { title: "Primary metrics", intro: "What the method achieved and what it cost in DKM calls." },
  secondary: { title: "Secondary metrics", intro: "Search size, timing and composition diagnostics." },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="text-lg font-semibold">Methodology</h1>
      <p className="mt-1 text-sm text-fg-muted">
        NB_L2 as the backend runs it. The package in <span className="num">backend/pipeline</span> is generated from the notebook&apos;s own cells; PARITY.md
        documents that it reproduces the notebook exactly on CPU, and how MPS differs.
      </p>

      {STAGES.map((g) => (
        <section key={g.group} className="mt-6">
          <h2 className="text-base font-semibold">{g.group}</h2>
          <ol className="mt-2 space-y-2">
            {g.items.map((s) => (
              <li key={s.id} id={`stage-${s.id}`} className="scroll-mt-16 rounded-lg border border-line bg-surface-1 p-3 target:border-accent">
                <div className="text-sm font-medium">{s.name}</div>
                <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <section className="mt-8" id="omega">
        <h2 className="text-base font-semibold">Where ω = 0.164 comes from</h2>
        <p className="mt-1 text-sm text-fg-muted">
          ω was calibrated by Youden&apos;s J over 121 candidate pairs from four videos (birdseyecity, redroofcity, resort, southroad), each labelled by running
          DKM and the 0.35 acceptance rule, with the score S = min(f_m, f_u). The gate now applies the same ω to f_m alone and keeps the IoU ≥ 0.40 check
          (project decision, 2026-09-26); on the videos checked in PARITY.md this produces exactly the same edge set. The calibration labels were produced on MPS
          before the batched-inverse fix; MPS_INV_IMPACT.md shows re-deriving ω from fixed-MPS or CPU labels gives the same threshold.
        </p>
      </section>

      <section className="mt-8" id="saving">
        <h2 className="text-base font-semibold">How the selection saving is reported</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
          <li>
            <span className="text-fg">Search space</span> — candidate edges evaluated by the cheap probe. This is the size of the search, not cost avoided: gap-32/64
            candidates exist to be tested cheaply and discarded, and nobody would run DKM on all of them.
          </li>
          <li>
            <span className="text-fg">Primary baseline: N=fps</span> — every round(fps)-th decoded frame, chained, so (frames − 1) DKM calls. This is the method
            the published comparison used.
          </li>
          <li>
            <span className="text-fg">Secondary baseline: native consecutive chain</span> — n − 1 DKM calls.
          </li>
          <li>
            The run&apos;s cost is measured (SIFT describe + probe + DKM). A baseline&apos;s time is its DKM calls × this run&apos;s measured per-attempt cost and is always
            labelled <em>projected</em>. When the two cannot be compared cleanly — the chain stopped early, SIFT was served from cache, or no DKM attempt ran —
            the time comparison is withheld with the reason.
          </li>
        </ul>
      </section>

      {(["primary", "secondary"] as Trust[]).map((t) => (
        <section key={t} className="mt-8">
          <h2 className="text-base font-semibold">{TRUST[t].title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{TRUST[t].intro}</p>
          <dl className="mt-2 space-y-2">
            {METRICS.filter((m) => m.trust === t).map((m) => (
              <div key={m.id} id={`metric-${m.id}`} className="scroll-mt-16 rounded-lg border border-line bg-surface-1 p-3 target:border-accent">
                <dt className="text-sm font-medium">{m.label}</dt>
                <dd className="mt-1 text-sm text-fg-muted">
                  {m.summary}
                  {m.caveat && <p className="mt-1 text-warn">{m.caveat}</p>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="mt-8" id="not-reported">
        <h2 className="text-base font-semibold">What is deliberately not reported</h2>
        <div className="mt-2 space-y-2 text-sm text-fg-muted">
          <p id="metric-psnr" className="scroll-mt-16">
            <span className="text-fg">PSNR and SSIM.</span> They are common in mosaicking papers, and their absence here is deliberate. This pipeline does not
            compute them, and adding a post-hoc measurement would put new, uncalibrated code beside calibrated numbers. They also need a reference image
            that UAV video does not provide; computed on pairwise overlaps they measure the registration of whichever pixels happen to overlap, which
            changes with frame selection and so is not comparable across methods. Instead the pipeline evaluates{" "}
            <span className="text-fg">GT-free absolute coverage against a fixed per-run denominator</span>: A_observed comes from a method-independent reference
            chain over every native frame, so a method cannot score well by producing a small or truncated mosaic.
          </p>
          <p id="metric-fill" className="scroll-mt-16">
            <span className="text-fg">Canvas fill.</span> Filled canvas pixels / canvas pixels was measurably wrong (a run that loses its chain early has a small,
            easy-to-fill canvas) and is replaced by absolute coverage. It is not shown anywhere.
          </p>
        </div>
        <p className="mt-6 text-sm">
          <Link href="/history" className="text-accent hover:underline">
            ← Back to runs
          </Link>
        </p>
      </section>
    </div>
  );
}
