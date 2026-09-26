"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo, IconStop, IconX } from "./icons";
import { cn } from "./cn";

export interface Toast {
  id: number;
  tone: "ok" | "bad" | "warn" | "info";
  title: string;
  body?: ReactNode;
  action?: { label: string; href: string };
  /** ms; 0 = sticky */
  duration: number;
}

let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<Toast, "id" | "duration"> & { duration?: number }) {
  const id = ++seq;
  const duration = t.duration ?? (t.tone === "bad" ? 0 : 4500);
  toasts = [...toasts.slice(-3), { ...t, id, duration }];
  emit();
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: Toast[] = [];

const ICON = {
  ok: <IconCheck className="text-ok" />,
  bad: <IconAlert className="text-bad" />,
  warn: <IconStop size={12} className="text-warn" />,
  info: <IconInfo className="text-accent" />,
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "bad" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface-2 px-3 py-2.5 shadow-pop",
            t.tone === "bad" ? "border-bad/40" : t.tone === "ok" ? "border-ok/35" : t.tone === "warn" ? "border-warn/40" : "border-line-strong",
          )}
        >
          <span className="mt-0.5 shrink-0">{ICON[t.tone]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs break-words text-fg-muted">{t.body}</div>}
            {t.action && (
              <Link href={t.action.href} onClick={() => dismiss(t.id)} className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline">
                {t.action.label} →
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="-mr-1 rounded-sm p-0.5 text-fg-subtle hover:text-fg"
            aria-label="Dismiss notification"
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
