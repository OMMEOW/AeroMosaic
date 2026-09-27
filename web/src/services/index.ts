/**
 * The pipeline service: FastAPI REST + WebSocket (backend/server). There is one
 * implementation; the base URL is NEXT_PUBLIC_API_BASE_URL (default http://localhost:8000),
 * overridable from Settings.
 */
import { effectiveBaseUrl } from "./config";
import { createHttpPipelineService } from "./http/httpPipelineService";
import type { PipelineService } from "./pipelineService";

let instance: PipelineService | null = null;

export function getPipelineService(): PipelineService {
  if (!instance) instance = createHttpPipelineService(effectiveBaseUrl());
  return instance;
}

export * from "./contract";
export { ServiceError } from "./pipelineService";
export type { ConnectionState, PipelineService } from "./pipelineService";
export { effectiveBaseUrl, envBaseUrl, baseUrlOverride, setBaseUrlOverride } from "./config";
