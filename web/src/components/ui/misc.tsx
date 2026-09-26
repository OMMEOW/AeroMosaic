"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { copyText } from "@/lib/export/download";
import { fmtAbsolute, fmtRelative } from "@/lib/format";
import { IconCheck } from "./icons";
import { cn } from "./cn";
import { toast } from "./toast";

// ─────────────────────────────────────────────────────────────── Copy

function CopyGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5" />
    </svg>
  );
}

/**
 * Wraps any ID, path or numeric value: click (or Enter) copies `value`.
 * The copy affordance appears on hover/focus so the value itself stays clean.
 */
export function Copyable({
  value,
  children,
  className,
  label,
}: {
  value: string | number;
  children?: ReactNode;
  className?: string;
  /** Accessible name, e.g. "run ID". */
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const str = String(value);
  const onCopy = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(str);
    setDone(ok);
    if (ok) setTimeout(() => setDone(false), 1200);
    toast({ tone: ok ? "info" : "bad", title: ok ? "Copied" : "Copy failed", body: <span className="num">{str.length > 80 ? str.slice(0, 80) + "…" : str}</span>, duration: 1600 });
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title={`Copy ${label ?? str}`}
      aria-label={`Copy ${label ?? ""} ${str}`.replace(/\s+/g, " ").trim()}
      onClick={onCopy}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCopy(e)}
      className={cn("group/copy inline-flex max-w-full cursor-copy items-baseline gap-1 rounded-sm hover:bg-surface-3/60", className)}
    >
      <span className="min-w-0 truncate">{children ?? str}</span>
      <span className="shrink-0 self-center text-fg-subtle opacity-0 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100">
        {done ? <IconCheck size={11} className="text-ok" /> : <CopyGlyph />}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────── Time

const minuteTick = (() => {
  let now = 0;
  const ls = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    subscribe(l: () => void) {
      ls.add(l);
      if (!timer) timer = setInterval(() => ((now = Date.now()), ls.forEach((x) => x())), 30_000);
      return () => {
        ls.delete(l);
        if (!ls.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => now || (now = Date.now()),
  };
})();

/** Relative time ("3 min ago"); absolute on hover/focus. Re-renders every 30 s. */
export function RelTime({ iso, className }: { iso: string; className?: string }) {
  const now = useSyncExternalStore(minuteTick.subscribe, minuteTick.get, () => 0);
  return (
    <time dateTime={iso} title={fmtAbsolute(iso)} className={cn("num", className)}>
      {now ? fmtRelative(iso, now) : ""}
    </time>
  );
}

// ─────────────────────────────────────────────────────────────── Dialog

/** Modal confirm built on <dialog> (focus trap + Esc handled by the platform). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "danger",
  cancelLabel = "Keep",
  onConfirm,
  onClose,
}: {
  /** null hides the secondary button (informational dialogs). */
  cancelLabel?: string | null;
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-lg border border-line-strong bg-surface-2 p-0 text-fg shadow-pop backdrop:bg-black/60"
    >
      <div className="p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {children && <div className="mt-2 text-sm text-fg-muted">{children}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        {cancelLabel !== null && (
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-sm text-fg-muted hover:bg-surface-3 hover:text-fg" autoFocus>
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={cn(
            "h-8 rounded-md px-3 text-sm font-medium",
            tone === "danger" ? "border border-bad/50 bg-bad-soft text-bad hover:brightness-125" : "bg-accent text-accent-fg",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// ─────────────────────────────────────────────────────────────── Empty state

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {body && <div className="max-w-md text-xs text-fg-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Width

/** Observed content-box width of an element (0 until measured). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
