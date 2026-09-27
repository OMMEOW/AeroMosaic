/**
 * Run data downloads come from the backend's run directory (manifest, steps, events,
 * metrics, mosaic, observed area, log, artifacts/, and the whole run as a zip). The UI never
 * re-serialises run data: the file you download is the file on disk.
 */
import { getPipelineService } from "@/services";
import { downloadBlob } from "./download";

export const artifactPath = (runId: string, name: string) => `/api/runs/${encodeURIComponent(runId)}/artifacts/${name}`;

export async function downloadArtifact(runId: string, name: string, filename?: string) {
  const svc = getPipelineService();
  const blob = await svc.getAsset(artifactPath(runId, name));
  downloadBlob(blob, filename ?? (name === "run.zip" ? `${runId}.zip` : `${runId}_${name.split("/").pop()}`));
}

export const downloadRunZip = (runId: string) => downloadArtifact(runId, "run.zip");

/** The run report as a real PDF, rendered by the backend from the run's own files. */
export async function downloadReportPdf(runId: string) {
  const blob = await getPipelineService().getAsset(`/api/runs/${encodeURIComponent(runId)}/report.pdf`);
  downloadBlob(blob, `${runId}_report.pdf`);
}
