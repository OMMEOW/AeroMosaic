/**
 * Service selection. The only place that knows which backend is in use.
 *
 *   NEXT_PUBLIC_PIPELINE_BACKEND = "mock" (default) | "http"
 *   NEXT_PUBLIC_API_BASE_URL     = e.g. http://localhost:8000   (http only; overridable in Settings)
 *   NEXT_PUBLIC_MOCK_SPEED       = pacing multiplier for the mock (default 1)
 *
 * NEXT_PUBLIC_* values are inlined at build time, so a change needs a
 * rebuild / dev-server restart.
 */
import { backendKind, effectiveBaseUrl } from "./config";
import { createHttpPipelineService } from "./http/httpPipelineService";
import { createMockPipelineService } from "./mock/mockPipelineService";
import type { PipelineService } from "./pipelineService";

let instance: PipelineService | null = null;

export function getPipelineService(): PipelineService {
  if (instance) return instance;
  instance = backendKind() === "http" ? createHttpPipelineService(effectiveBaseUrl()) : createMockPipelineService();
  return instance;
}

export * from "./contract";
export { ServiceError } from "./pipelineService";
export type { ConnectionState, PipelineService } from "./pipelineService";
export { backendKind, effectiveBaseUrl, envBaseUrl, baseUrlOverride, setBaseUrlOverride } from "./config";
