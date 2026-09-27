"use client";

import { useSyncExternalStore } from "react";
import { getPipelineService, type HealthStatus } from "@/services";

/**
 * Backend health, polled app-wide (one poller however many components read it).
 * `unreachable` is a first-class state: every view that needs the backend says so
 * instead of showing stale or invented numbers.
 */
export type HealthState =
  | { status: "loading" }
  | { status: "ok"; health: HealthStatus & { latencyMs: number }; checkedAt: number }
  | { status: "unreachable"; error: string; checkedAt: number; last: (HealthStatus & { latencyMs: number }) | null };

let state: HealthState = { status: "loading" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

function set(s: HealthState) {
  state = s;
  listeners.forEach((l) => l());
}

export async function refreshHealth() {
  if (inflight) return;
  inflight = true;
  try {
    const health = await getPipelineService().health();
    set({ status: "ok", health, checkedAt: Date.now() });
  } catch (e) {
    set({
      status: "unreachable",
      error: (e as Error).message,
      checkedAt: Date.now(),
      last: state.status === "ok" ? state.health : state.status === "unreachable" ? state.last : null,
    });
  } finally {
    inflight = false;
  }
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (!listeners.size) return;
  // poll faster while the startup self-test is pending or the backend is down
  const fast = state.status !== "ok" || state.health.state === "pending";
  timer = setTimeout(refreshHealth, fast ? 3000 : 15000);
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) void refreshHealth();
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) clearTimeout(timer);
  };
}

const SERVER: HealthState = { status: "loading" };
export function useHealth(): HealthState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}
