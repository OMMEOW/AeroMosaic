"use client";

import { useSyncExternalStore } from "react";
import { getPipelineService, type PipelineService } from "@/services";

const noopSubscribe = () => () => {};
const EMPTY: PipelineService["scenarios"] = [];

/** Static facts about the selected backend; null/empty during SSR (the service is client-only). */
export function useServiceInfo() {
  const kind = useSyncExternalStore(noopSubscribe, () => getPipelineService().kind, () => null);
  const scenarios = useSyncExternalStore(noopSubscribe, () => getPipelineService().scenarios, () => EMPTY);
  return { kind, scenarios };
}
