"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

export interface Hotkey {
  /** e.g. "c", "f", "1", "[", "]", "shift+?" */
  key: string;
  description: string;
  handler: (e: KeyboardEvent) => void;
  /** Group heading in the shortcut help. */
  scope: string;
}

// Registry of currently-mounted shortcuts, for the "?" help overlay.
let registered: Hotkey[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useRegisteredHotkeys() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => registered,
    () => registered,
  );
}

function matches(e: KeyboardEvent, key: string) {
  const parts = key.toLowerCase().split("+");
  const k = parts.pop()!;
  const shift = parts.includes("shift");
  const mod = parts.includes("mod");
  if (mod !== (e.metaKey || e.ctrlKey)) return false;
  if (!mod && (e.metaKey || e.ctrlKey || e.altKey)) return false;
  if (shift && !e.shiftKey) return false;
  return e.key.toLowerCase() === k;
}

function typingInField(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

/** Registers keyboard shortcuts while the component is mounted. Ignored while typing in a field. */
export function useHotkeys(keys: Hotkey[]) {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  const signature = keys.map((k) => `${k.scope}:${k.key}:${k.description}`).join("|");
  useEffect(() => {
    const list = ref.current;
    registered = [...registered, ...list];
    emit();
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e) || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      for (const hk of ref.current) {
        if (matches(e, hk.key)) {
          e.preventDefault();
          hk.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      registered = registered.filter((r) => !list.includes(r));
      emit();
    };
  }, [signature]);
}
