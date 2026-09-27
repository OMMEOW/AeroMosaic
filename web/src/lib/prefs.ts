"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side preferences (localStorage). Not backend state: these only shape how the UI
 * formats numbers and notifies. Pipeline constants are not preferences — they come from
 * the backend and are not editable.
 */
export interface Prefs {
  /** How durations render: auto (0.93 s / 4m 12s), always seconds, or always ms. */
  durationUnit: "auto" | "s" | "ms";
  /** Fixed decimals per metric family, so streaming values keep their width. */
  precision: { percent: 0 | 1 | 2; ratio: 2 | 3 | 4; drift: 3 | 4 | 5 };
  /** Browser notification when a run finishes while the tab is in the background. */
  notifications: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  durationUnit: "auto",
  precision: { percent: 1, ratio: 3, drift: 4 },
  notifications: true,
};

const KEY = "uav-prefs/v1";
let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function load(): Prefs {
  if (cache) return cache;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    cache = {
      ...DEFAULT_PREFS,
      ...parsed,
      precision: { ...DEFAULT_PREFS.precision, ...parsed.precision },
    };
  } catch {
    cache = DEFAULT_PREFS;
  }
  return cache;
}

export function getPrefs(): Prefs {
  return typeof window === "undefined" ? DEFAULT_PREFS : load();
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Prefs)) {
  const next = typeof patch === "function" ? patch(load()) : { ...load(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: prefs apply for this session only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_PREFS);
}

