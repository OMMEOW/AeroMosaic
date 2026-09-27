"use client";

import { PairsSection } from "@/components/pairs/PairsSection";
import { useReadyRun } from "./RunDataContext";

/** Every attempted pair of a finished run, re-opened from events.jsonl and artifacts/pairs/. */
export function RunPairs() {
  const state = useReadyRun();
  if (!state.run.vizEnabled)
    return (
      <p className="text-sm text-fg-muted">
        Per-pair visualisation was off for this run (vizEnabled = false in manifest.json), so there are no pair overlays. The numbers for every DKM
        attempt are on the Diagnostics tab.
      </p>
    );
  return <PairsSection pairs={state.pairs} live={false} videoId={state.run.videoId} />;
}
