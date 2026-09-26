"use client";

import { useCallback, useEffect, useState } from "react";
import { getPipelineService, type PipelineService } from "@/services";

export type AsyncState<T> =
  | { status: "loading"; data: T | null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: T | null; error: Error };

/**
 * Runs a service call and tracks loading/error. Keeps the previous data while
 * reloading (so views hold their layout instead of flashing a skeleton).
 */
export function useService<T>(fn: (svc: PipelineService) => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: null, error: null });
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setState((s) => ({ status: "loading", data: s.data, error: null }));
        return fn(getPipelineService());
      })
      .then(
        (data) => !cancelled && setState({ status: "ok", data, error: null }),
        (error: Error) => !cancelled && setState((s) => ({ status: "error", data: s.data, error })),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);

  return { ...state, reload };
}
