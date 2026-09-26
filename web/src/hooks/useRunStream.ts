"use client";

import { useEffect, useReducer, useState } from "react";
import { applyEvent } from "@/lib/runReducer";
import { getPipelineService, type ConnectionState, type PipelineEvent, type RunSnapshot } from "@/services";

interface StreamState {
  snapshot: RunSnapshot | null;
  /** Date.now() when the latest metrics arrived — used to interpolate elapsed/ETA between events. */
  metricsAt: number;
}

function reducer(state: StreamState, ev: PipelineEvent): StreamState {
  if (!state.snapshot && ev.type !== "run.snapshot") return state;
  const snapshot = state.snapshot ? applyEvent(state.snapshot, ev) : (ev as Extract<PipelineEvent, { type: "run.snapshot" }>).snapshot;
  if (snapshot === state.snapshot) return state;
  const metricsChanged = !state.snapshot || snapshot.metrics !== state.snapshot.metrics;
  return { snapshot, metricsAt: metricsChanged ? Date.now() : state.metricsAt };
}

/** Subscribes to a run's event stream and folds it into a live snapshot. */
export function useRunStream(runId: string) {
  const [state, dispatch] = useReducer(reducer, { snapshot: null, metricsAt: 0 });
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting", attempt: 1 });
  const [streamKey, setStreamKey] = useState({ runId, n: 0 });

  if (streamKey.runId !== runId) setStreamKey({ runId, n: 0 });

  useEffect(() => {
    return getPipelineService().subscribe(streamKey.runId, {
      onEvent: dispatch,
      onConnection: setConnection,
    });
  }, [streamKey]);

  return {
    snapshot: state.snapshot,
    metricsAt: state.metricsAt,
    connection,
    /** Force a fresh connection (e.g. from a "Reconnect" button after giving up). */
    reconnect: () => setStreamKey((k) => ({ ...k, n: k.n + 1 })),
  };
}

/** Re-renders every `ms` while `active`. Returns Date.now(). */
export function useTicker(active: boolean, ms = 250) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}
