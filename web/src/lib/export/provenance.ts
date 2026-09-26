import { backendKind, type RunSummary } from "@/services";

/** Embedded in every exported artifact. Without it an export is useless for a paper. */
export interface Provenance {
  runId: string;
  exportedAt: string;
  runCreatedAt: string;
  runStatus: string;
  video: { filename: string; width: number; height: number; fps: number; frameCount: number };
  params: RunSummary["params"];
  backend: string;
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
    params: run.params,
    backend: backendKind(),
    generator: "Mosaic GCS web",
  };
}

/** One-line parameter summary, e.g. "ω=0.164 gaps=[1,2,4,8,16,32,64] max_res=1920 refine=off". */
export function paramLine(p: RunSummary["params"]) {
  return `ω=${p.selectionThreshold} gaps=[${p.candidateGaps.join(",")}] max_res=${p.maxWorkingResolution} refine=${p.denseRefinement ? "on" : "off"}`;
}

/** Comment-prefixed header lines for text formats (CSV, TXT). */
export function provenanceHeader(p: Provenance, prefix = "# "): string {
  return [
    `run_id: ${p.runId}`,
    `exported_at: ${p.exportedAt}`,
    `run_created_at: ${p.runCreatedAt}`,
    `run_status: ${p.runStatus}`,
    `video: ${p.video.filename} ${p.video.width}x${p.video.height} @ ${p.video.fps} fps, ${p.video.frameCount} frames`,
    `params: ${paramLine(p.params)}`,
    `backend: ${p.backend}`,
    `generator: ${p.generator}`,
  ]
    .map((l) => prefix + l)
    .join("\n");
}

/** r-3fa91c_steps_20260926T101403Z.csv */
export function exportName(p: Provenance, what: string, ext: string) {
  const stamp = p.exportedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${p.runId}_${what}_${stamp}.${ext}`;
}
