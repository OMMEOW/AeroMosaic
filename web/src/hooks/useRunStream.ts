"use client";

import { useEffect, useReducer, useState } from "react";
import { applyEvent, type RunState } from "@/lib/runReducer";
import { getPipelineService, type ConnectionState, type PipelineEvent } from "@/services";

interface StreamState {
  run: RunState | null;
  /** Date.now() when the latest live metrics arrived — used to tick elapsed time between events. */
  metricsAt: number;
}

function reducer(s: StreamState, ev: PipelineEvent): StreamState {
  const prev = s.run && s.run.run.id === ev.runId ? s.run : null; // navigating to another run starts over
  const run = applyEvent(prev, ev);
  if (run === s.run) return s;
  return { run, metricsAt: ev.type === "metrics" || ev.type === "run.created" ? Date.now() : s.metricsAt };
}

/**
 * Subscribes to a run's event stream (WebSocket replay of events.jsonl, then live) and
 * folds it into RunState. A refresh mid-run replays from seq 0 and recovers everything.
 */
export function useRunStream(runId: string) {
  const [state, dispatch] = useReducer(reducer, { run: null, metricsAt: 0 });
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting", attempt: 1 });
  const [key, setKey] = useState({ runId, n: 0 });
  if (key.runId !== runId) setKey({ runId, n: 0 });

  useEffect(() => getPipelineService().subscribe(key.runId, { onEvent: dispatch, onConnection: setConnection }), [key]);

  return {
    state: state.run,
    metricsAt: state.metricsAt,
    connection,
    reconnect: () => setKey((k) => ({ ...k, n: k.n + 1 })),
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
