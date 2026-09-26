"use client";

import type { ConnectionState } from "@/services";
import { Spinner } from "@/components/ui/icons";
import { Button, cn } from "@/components/ui/primitives";

export function ConnectionIndicator({
  state,
  now,
  onReconnect,
}: {
  state: ConnectionState;
  now: number;
  onReconnect: () => void;
}) {
  let dot = "bg-fg-subtle";
  let text: string;
  let tone = "text-fg-muted";
  let busy = false;
  switch (state.status) {
    case "open":
      dot = "bg-ok";
      text = "Live";
      break;
    case "connecting":
      busy = true;
      text = state.attempt > 1 ? `Reconnecting · attempt ${state.attempt}` : "Connecting";
      break;
    case "reconnecting": {
      const secs = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
      dot = "bg-warn";
      tone = "text-warn";
      text = `Connection lost · retry in ${secs}s`;
      break;
    }
    case "closed":
      if (state.reason === "gave_up") {
        dot = "bg-bad";
        tone = "text-bad";
        text = "Disconnected";
      } else if (state.reason === "not_found") {
        dot = "bg-bad";
        tone = "text-bad";
        text = "Run not found";
      } else {
        text = "Stream closed";
      }
      break;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn("num inline-flex items-center gap-1.5 text-2xs tracking-wide uppercase", tone)}
        role="status"
        aria-live="polite"
        title={state.status === "reconnecting" && state.lastError ? state.lastError : undefined}
      >
        {busy ? <Spinner size={10} /> : <span className={cn("size-1.5 rounded-full", dot, state.status === "open" && "pulse-dot")} />}
        {text}
      </span>
      {state.status === "closed" && state.reason === "gave_up" && (
        <Button size="sm" variant="ghost" onClick={onReconnect}>
          Retry
        </Button>
      )}
    </span>
  );
}
