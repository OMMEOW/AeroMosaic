"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getPipelineService, type RunResult, type RunSnapshot } from "@/services";

/**
 * Loads a finished run once for all analysis tabs (Overview / Frame selection
 * / Diagnostics) and caches it for the session so switching tabs is instant.
 */
export type RunData =
  | { state: "loading" }
  | { state: "error"; message: string; notFound: boolean }
  | { state: "not-ready"; snapshot: RunSnapshot }
  | { state: "ready"; snapshot: RunSnapshot; result: RunResult };

const cache = new Map<string, Promise<RunData>>();

export function loadRunData(runId: string): Promise<RunData> {
  const hit = cache.get(runId);
  if (hit) return hit;
  const p = (async (): Promise<RunData> => {
    const svc = getPipelineService();
    try {
      const snapshot = await svc.getRun(runId);
      if (snapshot.run.status !== "succeeded") {
        cache.delete(runId); // may still finish; don't pin a non-final state
        return { state: "not-ready", snapshot };
      }
      const result = await svc.getRunResult(runId);
      return { state: "ready", snapshot, result };
    } catch (e) {
      cache.delete(runId);
      const code = (e as { code?: string }).code;
      return { state: "error", message: (e as Error).message, notFound: code === "not_found" || code === "http_404" };
    }
  })();
  cache.set(runId, p);
  return p;
}

export const forgetRunData = (runId: string) => cache.delete(runId);

const Ctx = createContext<RunData>({ state: "loading" });

export function RunDataProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const [data, setData] = useState<{ id: string; data: RunData }>({ id: runId, data: { state: "loading" } });
  useEffect(() => {
    let cancelled = false;
    loadRunData(runId).then((d) => !cancelled && setData({ id: runId, data: d }));
    return () => {
      cancelled = true;
    };
  }, [runId]);
  return <Ctx.Provider value={data.id === runId ? data.data : { state: "loading" }}>{children}</Ctx.Provider>;
}

export const useRunData = () => useContext(Ctx);

export function useReadyRun() {
  const d = useRunData();
  return d.state === "ready" ? d : null;
}
