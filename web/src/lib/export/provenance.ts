import type { RunSummary } from "@/services";

/** Embedded in every figure exported from the UI (run data files carry their own manifest). */
export interface Provenance {
  runId: string;
  exportedAt: string;
  runCreatedAt: string;
  runStatus: string;
  video: { filename: string; width: number | null; height: number | null; fps: number | null; frameCount: number | null };
  variant: string;
  estimator: string | null;
  device: string | null;
  seed: number;
  semstitchSha256: string | null;
  generator: string;
}

export function provenanceOf(run: RunSummary, exportedAt = new Date()): Provenance {
  return {
    runId: run.id,
    exportedAt: exportedAt.toISOString(),
    runCreatedAt: run.createdAt,
    runStatus: run.status,
    video: {
      filename: run.video.filename,
      width: run.video.width,
      height: run.video.height,
      fps: run.video.fps,
      frameCount: run.video.frameCount,
    },
    variant: run.variant?.name ?? "single pair",
    estimator: run.estimator,
    device: run.device,
    seed: run.seed,
    semstitchSha256: run.semstitch?.used ? run.semstitch.sha256 : null,
    generator: "AeroMosaic",
  };
}

/** One-line run configuration, e.g. "variant=firstwins estimator=magsac device=mps seed=0". */
export function configLine(run: RunSummary) {
  return `variant=${run.variant?.name ?? "single-pair"} estimator=${run.estimator ?? "—"} device=${run.device ?? "—"} seed=${run.seed}`;
}

/** Comment-prefixed header lines for text formats (CSV, TXT, SVG comments). */
export function provenanceHeader(p: Provenance, prefix = "# "): string {
  return [
    `run_id: ${p.runId}`,
    `exported_at: ${p.exportedAt}`,
    `run_created_at: ${p.runCreatedAt}`,
    `run_status: ${p.runStatus}`,
    `video: ${p.video.filename} ${p.video.width}x${p.video.height} @ ${p.video.fps} fps, ${p.video.frameCount ?? "?"} frames`,
    `variant: ${p.variant}${p.semstitchSha256 ? ` (SemanticStitch sha256 ${p.semstitchSha256})` : ""}`,
    `estimator: ${p.estimator ?? "—"}  device: ${p.device ?? "—"}  seed: ${p.seed}`,
    `generator: ${p.generator}`,
  ]
    .map((l) => prefix + l)
    .join("\n");
}

/** <run>_<what>_20260926T101403Z.<ext> */
export function exportName(p: Provenance, what: string, ext: string) {
  const stamp = p.exportedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${p.runId}_${what}_${stamp}.${ext}`;
}
