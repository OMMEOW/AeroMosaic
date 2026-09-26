"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Figure } from "@/components/charts/Figure";
import { driftScaleSpec, driftShearSpec, inlierSpec, stepDurationSpec } from "@/components/charts/runCharts";
import type { Pt } from "@/components/charts/chartSpec";
import { fmtDuration, fmtFrame, fmtRatio, fmtScale, fmtScaleDev, fmtShear } from "@/lib/format";
import { DRIFT_BAND, driftLevel } from "@/lib/metrics";
import { IconAlert, IconCheck } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/misc";
import { Banner, Panel } from "@/components/ui/primitives";
import { useReadyRun } from "./RunDataContext";

export function Diagnostics() {
  const data = useReadyRun();
  const router = useRouter();
  const r = data?.result;
  const specs = useMemo(
    () => r && { scale: driftScaleSpec(r.steps), shear: driftShearSpec(r.steps), inlier: inlierSpec(r.steps), dur: stepDurationSpec(r.steps) },
    [r],
  );
  if (!r || !specs) return null;
  const steps = r.steps;
  const jump = (step: number) => router.push(`/runs/${r.run.id}/results?step=${step}`);
  const pickStep = (p: Pt) => jump(p.x);
  const rejected = steps.filter((s) => !s.accepted);
  const firstOut = steps.find((s) => Math.abs(s.gScale - 1) > DRIFT_BAND.scale || Math.abs(s.gShear) > DRIFT_BAND.shear);
  const level = driftLevel(r.metrics);

  return (
    <div className="flex flex-col gap-3">
      {level === "diverged" ? (
        <Banner tone="bad" icon={<IconAlert />} title="Accumulated drift diverged">
          G_scale {fmtScale(r.metrics.drift.gScale)} ({fmtScaleDev(r.metrics.drift.gScale)}) and G_shear {fmtShear(r.metrics.drift.gShear)} at the last step.
          {firstOut && (
            <>
              {" "}
              The chain first left the display band at{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => jump(firstOut.step)}>
                step {firstOut.step} ({fmtFrame(firstOut.toFrame)})
              </button>
              .
            </>
          )}
        </Banner>
      ) : level === "elevated" ? (
        <Banner tone="warn" icon={<IconAlert />} title="Drift elevated">
          G_scale {fmtScaleDev(r.metrics.drift.gScale)}, G_shear {fmtShear(r.metrics.drift.gShear)} at the last step. Within the display band limits but worth checking.
        </Banner>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Figure spec={specs.scale} run={r.run} file="drift_g_scale" height={240} onPick={pickStep} aboutId="metric-g-scale" />
        <Figure spec={specs.shear} run={r.run} file="drift_g_shear" height={240} onPick={pickStep} aboutId="metric-g-shear" />
        <Figure spec={specs.inlier} run={r.run} file="inlier_ratio" height={220} onPick={pickStep} aboutId="metric-accept-rate" />
        <Figure spec={specs.dur} run={r.run} file="step_duration" height={220} onPick={pickStep} aboutId="metric-match-per-pair" />
      </div>
      <p className="text-2xs text-fg-subtle">
        Drift bands (±{DRIFT_BAND.scale * 100}% scale, ±{DRIFT_BAND.shear} shear) are display aids, not pipeline thresholds. Click any point to jump to that step.
      </p>

      <Panel title={`Rejected steps · ${rejected.length}`}>
        {rejected.length === 0 ? (
          <EmptyState icon={<IconCheck size={18} />} title="No rejected steps" body="Every dense-matching step cleared the inlier threshold." />
        ) : (
          <ul className="divide-y divide-line">
            {rejected.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
                <span className="num w-14 text-fg-subtle">step {s.step}</span>
                <span className="num text-fg">
                  {fmtFrame(s.fromFrame)} → {fmtFrame(s.toFrame)}
                </span>
                <span className="num text-fg-muted">gap {s.gap}</span>
                <span className="num text-bad">inlier {fmtRatio(s.inlierRatio)}</span>
                {s.forced && <span className="rounded-sm bg-warn-soft px-1 text-2xs text-warn">forced edge</span>}
                <span className="min-w-0 flex-1 text-fg-muted">{s.rejectReason}</span>
                <span className="num text-fg-subtle">{fmtDuration(s.durationMs)}</span>
                <Link href={`/runs/${r.run.id}/results?step=${s.step}`} className="text-accent hover:underline">
                  Jump to step →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
