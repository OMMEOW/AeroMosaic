import { getPipelineService, type LogLine, type RunResult, type RunSnapshot, type RunSummary, type StepResult } from "@/services";
import { toCsv } from "./csv";
import { downloadBlob, textBlob } from "./download";
import { addPngText } from "./png";
import { exportName, provenanceHeader, provenanceOf, type Provenance } from "./provenance";
import { makeZip, type ZipEntry } from "./zip";

/**
 * Every exporter embeds provenance (run ID, export timestamp, parameters):
 *   CSV/TXT → "# key: value" header lines; JSON → top-level "provenance";
 *   PNG → tEXt chunks; SVG → <metadata> + visible footer.
 */

const enc = new TextEncoder();

const STEP_COLUMNS: { key: string; get: (s: StepResult) => unknown }[] = [
  { key: "step", get: (s) => s.step },
  { key: "from_frame", get: (s) => s.fromFrame },
  { key: "to_frame", get: (s) => s.toFrame },
  { key: "gap", get: (s) => s.gap },
  { key: "accepted", get: (s) => s.accepted },
  { key: "reject_reason", get: (s) => s.rejectReason ?? "" },
  { key: "inlier_ratio", get: (s) => s.inlierRatio },
  { key: "n_matches", get: (s) => s.nMatches },
  { key: "n_inliers", get: (s) => s.nInliers },
  { key: "step_time_ms", get: (s) => s.durationMs },
  { key: "f_m", get: (s) => s.fmScore },
  { key: "omega", get: (s) => s.omega },
  { key: "forced", get: (s) => s.forced },
  { key: "g_scale", get: (s) => s.gScale },
  { key: "g_shear", get: (s) => s.gShear },
  { key: "psnr_db", get: (s) => s.psnr ?? "" },
  { key: "ssim", get: (s) => s.ssim ?? "" },
];

export const stepsCsv = (p: Provenance, steps: StepResult[]) =>
  `${provenanceHeader(p)}\n# note: psnr_db/ssim are pairwise-overlap measures, not comparable across runs\n${toCsv(steps, STEP_COLUMNS)}\n`;

export const stepsJson = (p: Provenance, steps: StepResult[]) => JSON.stringify({ provenance: p, steps }, null, 2);

export function summaryJson(p: Provenance, src: { result?: RunResult; snapshot?: RunSnapshot; run: RunSummary }) {
  const r = src.result;
  const body = r
    ? {
        provenance: p,
        run: r.run,
        params: r.run.params,
        metrics: r.metrics,
        metricNotes: {
          fillRatio: "Misleading alone: early termination yields a small, easy-to-fill canvas. Read beside groundCoverage.",
          pairwiseQuality: "Pairwise overlap, accepted steps only; not comparable across runs with different frame counts.",
          referenceChainBreaks: "If > 0 the coverage denominator is unreliable.",
        },
        stages: r.stages,
        selection: { ...r.selection, candidates: undefined, candidateCount: r.selection.candidates.length },
        selectedFrames: r.frames.map((f) => f.frameIndex),
      }
    : {
        provenance: p,
        run: src.run,
        params: src.run.params,
        error: src.run.error,
        stages: src.snapshot?.stages,
        stepsCompleted: src.snapshot?.steps.length ?? 0,
        lastSuccessfulStep: [...(src.snapshot?.steps ?? [])].reverse().find((s) => s.accepted) ?? null,
        selectedFrames: src.snapshot?.selection?.selectedFrames ?? null,
      };
  return JSON.stringify(body, null, 2);
}

export function logTxt(p: Provenance, logs: LogLine[]) {
  const lines = logs.map((l) => `${l.ts}  ${l.level.toUpperCase().padEnd(5)} ${(l.stage ? `[${l.stage}]` : "").padEnd(12)} ${l.message}`);
  return `${provenanceHeader(p)}\n#\n${lines.join("\n")}\n`;
}

export function framesTxt(p: Provenance, frames: number[]) {
  return `${provenanceHeader(p)}\n# selected native frame indices (0-based), one per line\n${frames.join("\n")}\n`;
}

export const framesJson = (p: Provenance, frames: number[]) => JSON.stringify({ provenance: p, selectedFrames: frames }, null, 2);

export async function mosaicPng(p: Provenance, url: string, which: "full" | "preview"): Promise<Uint8Array> {
  const blob = await getPipelineService().getAsset(url);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return addPngText(bytes, {
    Title: `Mosaic ${which === "full" ? "(full resolution)" : "(preview)"} — ${p.runId}`,
    Software: p.generator,
    "Creation Time": p.exportedAt,
    Comment: provenanceHeader(p, ""),
    provenance: JSON.stringify(p),
  });
}

/** Single-file downloads. */
export const download = {
  stepsCsv: (run: RunSummary, steps: StepResult[]) => {
    const p = provenanceOf(run);
    downloadBlob(textBlob(stepsCsv(p, steps), "text/csv;charset=utf-8"), exportName(p, "steps", "csv"));
  },
  stepsJson: (run: RunSummary, steps: StepResult[]) => {
    const p = provenanceOf(run);
    downloadBlob(textBlob(stepsJson(p, steps), "application/json"), exportName(p, "steps", "json"));
  },
  summary: (run: RunSummary, src: { result?: RunResult; snapshot?: RunSnapshot }) => {
    const p = provenanceOf(run);
    downloadBlob(textBlob(summaryJson(p, { ...src, run }), "application/json"), exportName(p, "summary", "json"));
  },
  log: (run: RunSummary, logs: LogLine[]) => {
    const p = provenanceOf(run);
    downloadBlob(textBlob(logTxt(p, logs)), exportName(p, "log", "txt"));
  },
  frames: (run: RunSummary, frames: number[], fmt: "txt" | "json") => {
    const p = provenanceOf(run);
    downloadBlob(
      textBlob(fmt === "txt" ? framesTxt(p, frames) : framesJson(p, frames), fmt === "txt" ? "text/plain" : "application/json"),
      exportName(p, "selected_frames", fmt),
    );
  },
  mosaic: async (run: RunSummary, url: string, which: "full" | "preview") => {
    const p = provenanceOf(run);
    const bytes = await mosaicPng(p, url, which);
    downloadBlob(new Blob([bytes as BlobPart], { type: "image/png" }), exportName(p, which === "full" ? "mosaic" : "mosaic_preview", "png"));
  },
};

/** Everything for a run in one zip. `figures` are standalone SVG strings keyed by file stem. */
export async function exportAllZip(
  result: RunResult,
  logs: LogLine[],
  figures: { stem: string; svg: string }[],
  onProgress?: (label: string) => void,
) {
  const p = provenanceOf(result.run);
  const dir = `${p.runId}_export/`;
  const files: ZipEntry[] = [];
  const addText = (name: string, text: string) => files.push({ name: dir + name, data: enc.encode(text) });

  addText("README.txt", `${provenanceHeader(p)}\n#\n# Contents: mosaic (full + preview PNG, provenance in tEXt chunks), per-step table (CSV/JSON),\n# run summary (JSON, all metrics + exact parameters), full log, selected frame indices, figures (SVG).\n`);
  onProgress?.("mosaic (full resolution)");
  files.push({ name: dir + "mosaic.png", data: await mosaicPng(p, result.mosaic.downloadUrl, "full") });
  onProgress?.("mosaic preview");
  files.push({ name: dir + "mosaic_preview.png", data: await mosaicPng(p, result.mosaic.preview.url, "preview") });
  onProgress?.("tables");
  addText("steps.csv", stepsCsv(p, result.steps));
  addText("steps.json", stepsJson(p, result.steps));
  addText("summary.json", summaryJson(p, { result, run: result.run }));
  addText("log.txt", logTxt(p, logs));
  const frames = result.frames.map((f) => f.frameIndex);
  addText("selected_frames.txt", framesTxt(p, frames));
  addText("selected_frames.json", framesJson(p, frames));
  for (const f of figures) addText(`figures/${f.stem}.svg`, f.svg);
  onProgress?.("zipping");
  const blob = makeZip(files);
  downloadBlob(blob, exportName(p, "all", "zip"));
  return { files: files.map((f) => f.name), bytes: blob.size };
}
