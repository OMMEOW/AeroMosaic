"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getPipelineService, type RunSummary } from "@/services";
import { buttonClass } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/icons";

/** Re-attaches to whatever run is in progress (e.g. after a refresh or from the nav). */
export default function ActiveRunPage() {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "none"; latest: RunSummary | null } | { kind: "error"; message: string }>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const svc = getPipelineService();
    svc
      .getActiveRun()
      .then(async (active) => {
        if (cancelled) return;
        if (active) return router.replace(`/runs/${active.id}`);
        const runs = await svc.listRuns();
        if (!cancelled) setState({ kind: "none", latest: runs[0] ?? null });
      })
      .catch((e: Error) => !cancelled && setState({ kind: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.kind === "loading") {
    return (
      <div className="mt-24 flex items-center justify-center gap-2 text-sm text-fg-muted">
        <Spinner /> Looking for an active run…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="text-base font-semibold text-bad">Backend unreachable</h1>
        <p className="num mt-1 text-xs text-fg-muted">{state.message}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-base font-semibold">No run in progress</h1>
      <p className="mt-1 text-sm text-fg-muted">Only one run executes at a time. Start a new one, or review a finished run.</p>
      <div className="mt-4 flex justify-center gap-2">
        {state.latest && (
          <Link
            href={state.latest.status === "succeeded" ? `/runs/${state.latest.id}/results` : `/runs/${state.latest.id}`}
            className={buttonClass("secondary")}
          >
            Last run <span className="num text-fg-subtle">{state.latest.id}</span>
          </Link>
        )}
        <Link href="/new" className={buttonClass("primary")}>
          New run
        </Link>
      </div>
    </div>
  );
}
