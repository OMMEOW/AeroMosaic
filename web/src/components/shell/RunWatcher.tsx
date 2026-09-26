"use client";

import { useEffect } from "react";
import { getPipelineService, isTerminal, type PipelineEvent, type RunSummary } from "@/services";

const RUN_STARTED = "uav:run-started";

/** Call right after creating a run so even a run that fails within seconds is announced. */
export function announceRunStarted(runId: string) {
  window.dispatchEvent(new CustomEvent(RUN_STARTED, { detail: runId }));
}
import { getPrefs } from "@/lib/prefs";
import { fmtPct } from "@/lib/format";
import { toast } from "@/components/ui/toast";

/**
 * App-wide: watches whichever run is in progress and announces its outcome —
 * a toast always, and a browser notification if the tab is in the background
 * (long runs are the normal case; the operator will switch away).
 */
export function RunWatcher() {
  useEffect(() => {
    let stopped = false;
    let unsub: (() => void) | null = null;
    let watching: string | null = null;
    const announced = new Set<string>();
    let poll: ReturnType<typeof setTimeout> | null = null;
    const svc = getPipelineService();

    const announce = (run: RunSummary, ev: PipelineEvent) => {
      if (announced.has(run.id)) return;
      announced.add(run.id);
      const name = run.video.filename;
      if (ev.type === "run.completed") {
        const title = `Run complete · ${name}`;
        const body = `Coverage ${fmtPct(ev.metrics.groundCoverage)} · ${ev.metrics.framesSelected}/${ev.metrics.nativeFrames} frames · ${run.id}`;
        toast({ tone: "ok", title, body, action: { label: "Open results", href: `/runs/${run.id}/results` }, duration: 9000 });
        notify(title, body, `/runs/${run.id}/results`);
      } else if (ev.type === "run.failed") {
        const title = `Run failed in ${ev.error.stage.toUpperCase()} · ${name}`;
        toast({ tone: "bad", title, body: ev.error.message, action: { label: "Failure details", href: `/runs/${run.id}` } });
        notify(title, ev.error.message, `/runs/${run.id}`);
      } else if (ev.type === "run.cancelled") {
        toast({ tone: "warn", title: `Run cancelled · ${name}`, body: run.id });
      }
    };

    const watch = (runId: string, announceIfAlreadyTerminal: boolean) => {
      unsub?.();
      watching = runId;
      let current: RunSummary | null = null;
      unsub = svc.subscribe(runId, {
        onEvent: (ev) => {
          if (ev.type === "run.snapshot") {
            current = ev.snapshot.run;
            // A run we were told just started may already have finished before we connected.
            if (announceIfAlreadyTerminal && isTerminal(current.status)) {
              const r = current;
              const base = { runId: r.id, seq: ev.seq, ts: ev.ts };
              if (r.status === "succeeded" && r.metrics) announce(r, { ...base, type: "run.completed", metrics: r.metrics });
              else if (r.status === "failed" && r.error) announce(r, { ...base, type: "run.failed", error: r.error });
              else if (r.status === "cancelled") announce(r, { ...base, type: "run.cancelled" });
            }
            return;
          }
          if (!current) return;
          if (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.cancelled") {
            announce(current, ev);
          }
        },
        onConnection: (c) => {
          if (c.status === "closed" && c.reason !== "unsubscribed") {
            unsub = null;
            watching = null;
            schedule(3000);
          }
        },
      });
    };

    const check = async () => {
      if (stopped || unsub) return;
      try {
        const active = await svc.getActiveRun();
        if (!stopped && active && !isTerminal(active.status) && !unsub) return watch(active.id, false);
      } catch {
        /* backend unreachable: try again later */
      }
      schedule(4000);
    };
    const schedule = (ms: number) => {
      if (poll) clearTimeout(poll);
      if (!stopped) poll = setTimeout(check, ms);
    };

    const onStarted = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && id !== watching) {
        if (poll) clearTimeout(poll);
        watch(id, true);
      }
    };
    window.addEventListener(RUN_STARTED, onStarted);
    check();
    return () => {
      stopped = true;
      window.removeEventListener(RUN_STARTED, onStarted);
      if (poll) clearTimeout(poll);
      unsub?.();
    };
  }, []);
  return null;
}

function notify(title: string, body: string, href: string) {
  if (typeof Notification === "undefined" || !getPrefs().notifications) return;
  if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag: href });
    n.onclick = () => {
      window.focus();
      window.location.assign(href);
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/** Ask for notification permission from a user gesture (e.g. Start run). */
export async function requestNotificationPermission() {
  if (typeof Notification === "undefined" || !getPrefs().notifications) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignored */
    }
  }
}
