"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { DEFAULT_PARAMS, type PipelineParams } from "@/services";
import { IconAlert, IconInfo, IconRefresh } from "@/components/ui/icons";
import { Button, cn, Switch, Tooltip } from "@/components/ui/primitives";

export const GAP_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 128];
export const RES_OPTIONS = [960, 1280, 1920, 2560, 3840];

export const PARAM_HELP = {
  omega: "ω — minimum probe score f_m for two frames to count as chained. Higher ω keeps more frames. 0.164 is a calibrated value.",
  gaps: "Forward gaps (native frames) probed from each anchor. The chain takes the largest gap that clears ω.",
  res: "Frames are downscaled so the long edge is at most this many pixels before dense matching. Lower = faster and less GPU memory.",
  refine: "DKM's optional refinement pass. Slightly better correspondences, ≈1.6× slower per pair.",
};

function Row({ label, help, anchor, changed, children }: { label: string; help: string; anchor: string; changed: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5 py-3 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
      <div className="flex items-center gap-1.5 pt-1">
        <span id={id} className="text-sm text-fg">
          {label}
        </span>
        {changed && <span className="size-1.5 rounded-full bg-accent" title="Changed from validated default" aria-label="changed" />}
        <Tooltip content={help}>
          <Link href={`/about#${anchor}`} className="text-fg-subtle hover:text-accent" aria-label={`${label}: methodology`}>
            <IconInfo size={12} />
          </Link>
        </Tooltip>
      </div>
      <div role="group" aria-labelledby={id}>
        {children}
      </div>
    </div>
  );
}

/**
 * The four pipeline parameters. Deviation from the calibrated ω is flagged
 * and must be acknowledged by the caller (see `omegaDeviates`).
 */
export function ParamsForm({
  value,
  onChange,
  compact,
}: {
  value: PipelineParams;
  onChange: (p: PipelineParams) => void;
  compact?: boolean;
}) {
  const omegaDeviates = value.selectionThreshold !== DEFAULT_PARAMS.selectionThreshold;
  const set = (patch: Partial<PipelineParams>) => onChange({ ...value, ...patch });
  const gapsChanged = value.candidateGaps.join() !== DEFAULT_PARAMS.candidateGaps.join();

  return (
    <div className={cn("divide-y divide-line", compact && "text-sm")}>
      <Row label="Selection threshold ω" help={PARAM_HELP.omega} anchor="param-omega" changed={omegaDeviates}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            step={0.001}
            min={0.01}
            max={0.9}
            value={value.selectionThreshold}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) set({ selectionThreshold: Math.round(v * 1000) / 1000 });
            }}
            className={cn(
              "num h-8 w-28 rounded-md border bg-surface-2 px-2 text-sm text-fg",
              omegaDeviates ? "border-warn/60" : "border-line-strong",
            )}
            aria-label="Selection threshold omega"
          />
          <span className="num text-xs text-fg-subtle">default {DEFAULT_PARAMS.selectionThreshold}</span>
          {omegaDeviates && (
            <Button size="sm" variant="ghost" icon={<IconRefresh size={12} />} onClick={() => set({ selectionThreshold: DEFAULT_PARAMS.selectionThreshold })}>
              Reset ω
            </Button>
          )}
        </div>
        {omegaDeviates && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warn">
            <IconAlert size={12} className="mt-0.5 shrink-0" />
            ω = {DEFAULT_PARAMS.selectionThreshold} is calibrated. Runs at ω = {value.selectionThreshold} are not comparable with validated runs.
          </p>
        )}
      </Row>

      <Row label="Candidate gaps" help={PARAM_HELP.gaps} anchor="param-gaps" changed={gapsChanged}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Candidate gaps">
          {GAP_OPTIONS.map((g) => {
            const on = value.candidateGaps.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? value.candidateGaps.filter((x) => x !== g) : [...value.candidateGaps, g].sort((a, b) => a - b);
                  if (next.length) set({ candidateGaps: next });
                }}
                className={cn(
                  "num h-7 min-w-9 rounded-md border px-2 text-xs transition-colors",
                  on ? "border-accent-line bg-accent-soft text-fg" : "border-line-strong text-fg-subtle hover:text-fg",
                )}
              >
                {g}
              </button>
            );
          })}
        </div>
        <p className="num mt-1 text-2xs text-fg-subtle">[{value.candidateGaps.join(", ")}] · at least one required</p>
      </Row>

      <Row label="Max working resolution" help={PARAM_HELP.res} anchor="param-res" changed={value.maxWorkingResolution !== DEFAULT_PARAMS.maxWorkingResolution}>
        <select
          value={value.maxWorkingResolution}
          onChange={(e) => set({ maxWorkingResolution: Number(e.target.value) })}
          className="num h-8 rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg"
          aria-label="Max working resolution"
        >
          {RES_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r} px{r === DEFAULT_PARAMS.maxWorkingResolution ? " (default)" : ""}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Dense matcher refinement" help={PARAM_HELP.refine} anchor="param-refine" changed={value.denseRefinement !== DEFAULT_PARAMS.denseRefinement}>
        <label className="inline-flex items-center gap-2 pt-1 text-sm text-fg-muted">
          <Switch checked={value.denseRefinement} onChange={(v) => set({ denseRefinement: v })} label="Dense matcher refinement" />
          {value.denseRefinement ? "on" : "off (default)"}
        </label>
      </Row>
    </div>
  );
}
