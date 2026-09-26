"use client";

import { useEffect, useState } from "react";
import { getPipelineService, ServiceError, type RunStatus } from "@/services";
import { IconStop } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";

/**
 * Two-step cancel. The button reflects server state, not the click:
 * running → (confirm) → request sent → "Cancelling…" once the backend reports
 * `cancelling` → hidden when `cancelled` arrives.
 */
export function CancelControl({ runId, status, armKey = 0 }: { runId: string; status: RunStatus; armKey?: number }) {
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenArm, setSeenArm] = useState(armKey);
  // Keyboard shortcut "c" arms the confirm step (never cancels in one keystroke).
  if (armKey !== seenArm) {
    setSeenArm(armKey);
    setConfirming(true);
  }

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (status !== "queued" && status !== "running" && status !== "cancelling") return null;

  if (status === "cancelling" || requested) {
    return (
      <Button variant="danger" size="md" loading disabled aria-live="polite">
        Cancelling…
      </Button>
    );
  }

  const send = async () => {
    setRequested(true);
    setConfirming(false);
    setError(null);
    try {
      await getPipelineService().cancelRun(runId);
    } catch (e) {
      setRequested(false);
      setError(e instanceof ServiceError ? e.message : "Cancel request failed");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-bad">{error}</span>}
      {confirming ? (
        <>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep running
          </Button>
          <Button variant="danger" className="bg-bad-soft" icon={<IconStop size={12} />} onClick={send} autoFocus>
            Confirm cancel
          </Button>
        </>
      ) : (
        <Button variant="danger" icon={<IconStop size={12} />} onClick={() => setConfirming(true)}>
          Cancel run
        </Button>
      )}
    </span>
  );
}
