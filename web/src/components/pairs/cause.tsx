"use client";

import type { ReactNode } from "react";
import type { CandidateEdge, DkmAttempt, PairRecord, RejectCause } from "@/services";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/primitives";

/**
 * Why a pair was dropped is the point of this UI. Each cause has its own label, colour and
 * glyph, and the badge always carries the measured comparison, so "IoU 0.31 < 0.40" never
 * looks like "f_m 0.12 < 0.164".
 */
export const CAUSE_META: Record<RejectCause, { label: string; short: string; stage: 1 | 2; glyph: string; cls: string; help: string }> = {
  PROXY_FIT_FAILED: {
    label: "Proxy fit failed",
    short: "proxy fit",
    stage: 1,
    glyph: "∅",
    cls: "border-fg-subtle/50 text-fg-muted bg-surface-3",
    help: "Stage 1: the SIFT-500 proxy homography could not be fitted (too few descriptors, fewer than 4 ratio-test matches, or MAGSAC found no homography). Never reached the gate.",
  },
  GATE_IOU: {
    label: "IoU gate",
    short: "IoU",
    stage: 1,
    glyph: "◇",
    cls: "border-warn/60 text-warn bg-warn-soft",
    help: "Stage 1: the proxy homography's footprint IoU is below 0.40, so the proxy is not trusted. Checked before f_m.",
  },
  GATE_FM: {
    label: "f_m gate",
    short: "f_m",
    stage: 1,
    glyph: "▽",
    cls: "border-accent-line text-accent bg-accent-soft",
    help: "Stage 1: f_m = putative matches / 500 is below ω = 0.164. Not worth a DKM call.",
  },
  DEGENERATE_H: {
    label: "No homography",
    short: "degenerate H",
    stage: 2,
    glyph: "✕",
    cls: "border-bad/60 text-bad bg-bad-soft",
    help: "Stage 2: the dual-layer constraint returned no homography (layer 2, τr = 4.0). The detail names what layer 1 did.",
  },
  RATIO_BELOW_MIN: {
    label: "Ratio < 0.35",
    short: "ratio",
    stage: 2,
    glyph: "↓",
    cls: "border-warn/60 text-warn bg-warn-soft",
    help: "Stage 2: DKM + dual-layer inlier ratio below 0.35. The edge is banned and the path re-solved from the same reference.",
  },
  EXCEPTION: {
    label: "Exception",
    short: "exception",
    stage: 2,
    glyph: "!",
    cls: "border-bad bg-bad text-bg",
    help: "Stage 2: an exception was raised while matching this pair. The run failed here; nothing was skipped.",
  },
};

export const STAGE1_CAUSES = ["PROXY_FIT_FAILED", "GATE_IOU", "GATE_FM"] as const;
export const STAGE2_CAUSES = ["DEGENERATE_H", "RATIO_BELOW_MIN", "EXCEPTION"] as const;

/** "—" for an unmeasured value, with the reason on hover. Never a zero. */
export function Unmeasured({ why = "Not measured on this record's path" }: { why?: string }) {
  return (
    <Tooltip content={why}>
      <span className="cursor-help text-fg-subtle" aria-label={`not measured: ${why}`}>
        —
      </span>
    </Tooltip>
  );
}

export function Num({ v, digits = 3, why, suffix }: { v: number | null | undefined; digits?: number; why?: string; suffix?: string }) {
  if (v == null) return <Unmeasured why={why} />;
  return (
    <span className="num">
      {v.toFixed(digits)}
      {suffix}
    </span>
  );
}

/** The full reject sentence, e.g. "IoU 0.31 < 0.40 (f_m 0.45 would pass)". */
export function rejectSentence(r: PairRecord, omega = 0.164, iouTrust = 0.4): string {
  if (!r.rejectCause) return "accepted";
  if (r.rejectCause === "GATE_IOU") {
    const e = r as CandidateEdge;
    const iou = r.proxyIou != null ? `IoU ${r.proxyIou.toFixed(2)} < ${iouTrust.toFixed(2)}` : r.rejectDetail;
    if (e.fmPasses == null || r.fm == null) return iou;
    return `${iou} (f_m ${r.fm.toFixed(2)} ${e.fmPasses ? "would pass" : `would also fail < ${omega}`})`;
  }
  if (r.rejectCause === "GATE_FM") return r.fm != null ? `f_m ${r.fm.toFixed(3)} < ${omega}` : r.rejectDetail;
  if (r.rejectCause === "RATIO_BELOW_MIN") {
    const a = r as DkmAttempt;
    return a.inlierRatio != null ? `inlier ratio ${a.inlierRatio.toFixed(3)} < 0.35` : r.rejectDetail;
  }
  return r.rejectDetail;
}

export function CauseBadge({ cause, children, className }: { cause: RejectCause; children?: ReactNode; className?: string }) {
  const m = CAUSE_META[cause];
  return (
    <Tooltip content={m.help}>
      <span
        className={cn(
          "inline-flex h-5 max-w-full items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium whitespace-nowrap",
          m.cls,
          className,
        )}
      >
        <span aria-hidden="true" className="num">
          {m.glyph}
        </span>
        <span className="truncate">{children ?? m.label}</span>
      </span>
    </Tooltip>
  );
}

/** Accepted / rejected-with-cause cell for a pair record. */
export function Verdict({ r, omega, iouTrust }: { r: PairRecord; omega?: number; iouTrust?: number }) {
  if (!r.rejectCause) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-ok/40 bg-ok-soft px-1.5 text-2xs font-medium text-ok">
        ✓ {r.stage === 1 ? "passes gate" : "accepted"}
      </span>
    );
  }
  return (
    <CauseBadge cause={r.rejectCause}>
      <span className="num">{rejectSentence(r, omega, iouTrust)}</span>
    </CauseBadge>
  );
}

export function CauseLegend({ causes }: { causes: readonly RejectCause[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {causes.map((c) => (
        <CauseBadge key={c} cause={c} />
      ))}
    </div>
  );
}
