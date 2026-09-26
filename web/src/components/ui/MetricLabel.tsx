"use client";

import Link from "next/link";
import { aboutHref, metricById } from "@/lib/metrics";
import { Tooltip } from "./primitives";

/** Metric name + an info link to its Methodology entry; tooltip carries meaning and caveat. */
export function MetricLabel({ id, children }: { id: string; children?: React.ReactNode }) {
  const def = metricById(id);
  return (
    <span className="inline-flex items-center gap-1">
      {children ?? def.label}
      <Tooltip
        content={
          <span className="block normal-case tracking-normal">
            <span className="block text-fg">{def.summary}</span>
            {def.caveat && <span className="mt-1 block text-warn">{def.caveat}</span>}
            <span className="mt-1 block text-fg-subtle">Click for methodology</span>
          </span>
        }
      >
        <Link
          href={aboutHref(id)}
          className="inline-flex size-3.5 items-center justify-center rounded-full border border-fg-subtle/60 text-[9px] leading-none font-semibold text-fg-subtle normal-case hover:border-accent hover:text-accent"
          aria-label={`${def.label}: methodology`}
        >
          i
        </Link>
      </Tooltip>
    </span>
  );
}
