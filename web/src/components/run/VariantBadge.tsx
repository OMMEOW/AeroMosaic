"use client";

import type { RunSummary } from "@/services";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/primitives";

const LABEL: Record<string, string> = {
  semantic: "SemanticStitch",
  firstwins: "firstwins",
  dgeo: "d_geo seam",
  random: "random seam (control)",
};

/**
 * Which composition produced (or will produce) this run's mosaic. Shown on every run: a
 * firstwins mosaic must never be mistaken for a semantic one.
 */
export function VariantBadge({ run, className }: { run: Pick<RunSummary, "variant" | "semstitch">; className?: string }) {
  const v = run.variant;
  const sem = v.kind === "semantic";
  const tip = sem
    ? run.semstitch?.verified
      ? `SemanticStitch, checkpoint sha256 ${run.semstitch.sha256} (verified)`
      : "SemanticStitch requested; its checkpoint was not verified, so this run cannot compose with it"
    : `Composition variant ${v.name}${v.bias != null ? `, bias ${v.bias}` : ""}. Not SemanticStitch.`;
  return (
    <Tooltip content={tip}>
      <span
        className={cn(
          "num inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs font-semibold tracking-wide whitespace-nowrap",
          sem ? "border-accent-line bg-accent-soft text-accent" : "border-line-strong bg-surface-3 text-fg",
          className,
        )}
      >
        <span className="font-normal text-fg-subtle">compose</span> {LABEL[v.kind] ?? v.kind}
        {sem && run.semstitch?.sha256 && <span className="font-normal text-fg-muted">· {run.semstitch.sha256.slice(0, 8)}</span>}
      </span>
    </Tooltip>
  );
}
