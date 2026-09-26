"use client";

import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { RunStatus, StageStatus } from "@/services";
import { PanelBoundary } from "./boundary";
import { cn } from "./cn";
import { Spinner } from "./icons";
import { Copyable } from "./misc";

export { cn };

// ─────────────────────────────────────────────────────────────── Button

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 active:brightness-95 border border-transparent",
  secondary: "bg-surface-3 text-fg border border-line-strong hover:bg-surface-2 hover:border-fg-subtle",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-3 border border-transparent",
  danger: "text-bad border border-bad/45 hover:bg-bad-soft",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /**
   * Disabled-with-reason: the button stays focusable, looks disabled, and
   * explains why on hover/focus instead of silently doing nothing.
   */
  disabledReason?: string | null;
}

/** Class string for link-styled buttons (use on <Link> instead of nesting a <button> inside an <a>). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,filter] duration-150",
    "disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, disabledReason, onClick, ...rest },
  ref,
) {
  const reasonId = useId();
  if (disabledReason && !loading) {
    return (
      <Tooltip content={disabledReason}>
        <button
          ref={ref}
          aria-disabled="true"
          aria-describedby={reasonId}
          className={buttonClass(variant, size, cn("relative cursor-not-allowed opacity-50", className))}
          {...rest}
          onClick={(e) => e.preventDefault()}
          type={rest.type ?? "button"}
        >
          {icon}
          {children}
          <span id={reasonId} className="sr-only">
            ({disabledReason})
          </span>
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
      onClick={onClick}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
});

// ─────────────────────────────────────────────────────────────── Panel

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; actions?: ReactNode; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface-1", className)} {...rest}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <h2 className="truncate text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>
        <PanelBoundary label={typeof title === "string" ? title : undefined}>{children}</PanelBoundary>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── Status

const RUN_STATUS_STYLE: Record<RunStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  queued: { label: "Queued", cls: "text-fg-muted bg-surface-3", dot: "bg-fg-subtle" },
  running: { label: "Running", cls: "text-accent bg-accent-soft", dot: "bg-accent", pulse: true },
  cancelling: { label: "Cancelling", cls: "text-warn bg-warn-soft", dot: "bg-warn", pulse: true },
  cancelled: { label: "Cancelled", cls: "text-warn bg-warn-soft", dot: "bg-warn" },
  succeeded: { label: "Succeeded", cls: "text-ok bg-ok-soft", dot: "bg-ok" },
  failed: { label: "Failed", cls: "text-bad bg-bad-soft", dot: "bg-bad" },
};

export function RunStatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const s = RUN_STATUS_STYLE[status];
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5 text-2xs font-semibold tracking-wider uppercase", s.cls, className)}
    >
      <span className={cn("size-1.5 rounded-full", s.dot, s.pulse && "pulse-dot")} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export const STAGE_STATUS_TEXT: Record<StageStatus, string> = {
  pending: "text-fg-subtle",
  active: "text-accent",
  done: "text-fg",
  failed: "text-bad",
  cancelled: "text-warn",
};

// ─────────────────────────────────────────────────────────────── Stat

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  className,
  size = "md",
  copy,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Raw value to copy; makes the value click-to-copy. */
  copy?: string | number;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: "ok" | "bad" | "warn" | "accent";
  className?: string;
  size?: "md" | "lg";
}) {
  const toneCls = tone ? { ok: "text-ok", bad: "text-bad", warn: "text-warn", accent: "text-accent" }[tone] : "text-fg";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</div>
      <div className={cn("num mt-0.5 flex items-baseline gap-1 truncate", size === "lg" ? "text-xl" : "text-lg", toneCls)}>
        {copy != null ? <Copyable value={copy}>{value}</Copyable> : value}
        {unit && <span className="text-xs text-fg-subtle">{unit}</span>}
      </div>
      {sub && <div className="num mt-0.5 truncate text-2xs text-fg-muted">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Progress

export function ProgressBar({
  value,
  tone = "accent",
  className,
  label,
}: {
  /** 0..1, or null for indeterminate */
  value: number | null;
  tone?: "accent" | "ok" | "bad" | "warn" | "muted";
  className?: string;
  label?: string;
}) {
  const fill = { accent: "bg-accent", ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", muted: "bg-fg-subtle" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(value * 100)}
      className={cn("relative h-1 overflow-hidden rounded-full bg-surface-3", className)}
    >
      {value == null ? (
        <div className={cn("absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full", fill)} />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fill)}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Tooltip

/**
 * Hover/focus tooltip. Rendered in a portal with fixed positioning so it is
 * never clipped by overflow/truncate ancestors. The trigger gets aria-describedby.
 */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  const [pos, setPos] = useState<{ x: number; y: number; side: "top" | "bottom" } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const s = side === "top" && r.top < 80 ? "bottom" : side;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: s === "top" ? r.top - 6 : r.bottom + 6, side: s });
  };
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setPos(null)}
      onKeyDown={(e) => e.key === "Escape" && setPos(null)}
      aria-describedby={pos ? id : undefined}
    >
      {children}
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[70] w-max max-w-72 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs font-normal tracking-normal text-fg normal-case shadow-pop"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.side === "top" ? "-100%" : "0"})` }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────── Switch

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border transition-colors duration-150",
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-3",
      )}
    >
      <span
        className={cn(
          "size-3 rounded-full transition-transform duration-150",
          checked ? "translate-x-[15px] bg-accent-fg" : "translate-x-[2px] bg-fg-muted",
        )}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────── Misc

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="num inline-flex h-4.5 items-center rounded-sm border border-line-strong bg-surface-2 px-1 text-2xs text-fg-muted">
      {children}
    </kbd>
  );
}

export function Banner({
  tone,
  icon,
  title,
  children,
  actions,
  className,
}: {
  tone: "ok" | "bad" | "warn" | "accent";
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const t = {
    ok: "border-ok/35 bg-ok-soft [--tone:var(--ok)]",
    bad: "border-bad/40 bg-bad-soft [--tone:var(--bad)]",
    warn: "border-warn/40 bg-warn-soft [--tone:var(--warn)]",
    accent: "border-accent-line bg-accent-soft [--tone:var(--accent)]",
  }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5", t, className)}>
      {icon && <span className="mt-0.5 text-(color:--tone)">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        {children && <div className="mt-0.5 text-xs text-fg-muted">{children}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}
