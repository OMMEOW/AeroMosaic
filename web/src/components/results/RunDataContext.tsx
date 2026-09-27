"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { foldEvents, type RunState } from "@/lib/runReducer";
import { getPipelineService, isTerminal } from "@/services";

/**
 * Loads a run once for all analysis tabs: the REST replay of its events.jsonl, folded with
 * the same reducer the live view uses. A finished run's data never changes, so it is cached
 * for the session.
 */
export type RunData =
  | { state: "loading" }
  | { state: "error"; message: string; notFound: boolean }
  | { state: "not-ready"; run: RunState }
  | { state: "ready"; run: RunState };

const cache = new Map<string, Promise<RunData>>();

export function loadRunData(runId: string): Promise<RunData> {
  const hit = cache.get(runId);
  if (hit) return hit;
  const p = (async (): Promise<RunData> => {
    try {
      const svc = getPipelineService();
      const [events, summary] = await Promise.all([svc.getEvents(runId), svc.getRun(runId)]);
      const folded = foldEvents(events);
      if (!folded) throw Object.assign(new Error(`run ${runId} has no events`), { code: "not_found" });
      // manifest.json is authoritative for run-level facts (device, estimator, hashes); the
      // events carry the per-record detail.
      const run = { ...folded, run: { ...folded.run, ...summary } };
      if (run.run.status !== "succeeded" || !run.run.metrics) {
        if (!isTerminal(run.run.status)) cache.delete(runId);
        return { state: "not-ready", run };
      }
      return { state: "ready", run };
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

/** The loaded, succeeded run (tabs render only inside RunShell's ready branch). */
export function useReadyRun(): RunState {
  const d = useRunData();
  if (d.state !== "ready") throw new Error("useReadyRun outside a ready run");
  return d.run;
}
