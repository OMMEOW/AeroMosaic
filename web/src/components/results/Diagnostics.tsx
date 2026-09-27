"use client";

import { useEffect, useState } from "react";
import { getPipelineService } from "@/services";
import { Figure } from "@/components/charts/Figure";
import { attemptRatioSpec, attemptTimeSpec } from "@/components/charts/runCharts";
import { artifactPath } from "@/lib/export/runExports";
import { fmtInt } from "@/lib/format";
import { Panel } from "@/components/ui/primitives";
import { AttemptsTable } from "@/components/pairs/AttemptsTable";
import { CauseBadge, STAGE2_CAUSES } from "@/components/pairs/cause";
import { LogStream } from "@/components/run/LogStream";
import { useReadyRun } from "./RunDataContext";

type Manifest = Record<string, unknown> & {
  versions?: Record<string, string>;
  dkm?: { repo: string; repo_commit: string | null; weights: string };
  semstitch?: Record<string, unknown>;
  inverse_selftest?: { max_rel_err: number; tol: number; passed: boolean };
  notebook_sha256?: string | null;
  git_commit?: string | null;
  decode_cache?: string;
  chain_breaks?: number[];
};

/** Stage 2 in full, plus the environment this run executed in (read from its manifest.json). */
export function Diagnostics() {
  const state = useReadyRun();
  const { run } = state;
  const m = run.metrics!;
  const [man, setMan] = useState<Manifest | null>(null);
  const [manErr, setManErr] = useState<string | null>(null);
  useEffect(() => {
    getPipelineService()
      .getAsset(artifactPath(run.id, "manifest.json"))
      .then((b) => b.text())
      .then((t) => setMan(JSON.parse(t)), (e: Error) => setManErr(e.message));
  }, [run.id]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Figure spec={attemptRatioSpec(state.attempts, 0.35)} run={run} file="stage2-inlier-ratio" height={230} />
        <Figure spec={attemptTimeSpec(state.attempts)} run={run} file="stage2-time" height={230} />
      </div>
      <Panel
        title={`Stage 2 · DKM attempts · ${state.attempts.length}`}
        className="h-[440px]"
        actions={
          <div className="hidden gap-1 sm:flex">
            {STAGE2_CAUSES.map((c) => (
              <CauseBadge key={c} cause={c}>
                {m.stage2.rejects[c]}
              </CauseBadge>
            ))}
          </div>
        }
      >
        <AttemptsTable attempts={state.attempts} videoId={run.videoId} emptyHint="No DKM attempts." />
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Reference chain (coverage denominator)" bodyClassName="p-3 text-xs">
          {state.reference ? (
            <dl className="num grid grid-cols-2 gap-y-1.5">
              <dt className="text-fg-muted">A_observed</dt>
              <dd className="text-right">{fmtInt(state.reference.observedAreaPx)} px</dd>
              <dt className="text-fg-muted">Canvas</dt>
              <dd className="text-right">
                {fmtInt(state.reference.canvasW)}×{fmtInt(state.reference.canvasH)} at scale {state.reference.scale}
              </dd>
              <dt className="text-fg-muted">Chain breaks</dt>
              <dd className={state.reference.chainBreaks ? "text-right text-warn" : "text-right"}>
                {state.reference.chainBreaks}
                {state.reference.breakFrames.length > 0 && ` (frames ${state.reference.breakFrames.join(", ")})`}
              </dd>
            </dl>
          ) : (
            <p className="text-fg-muted">No reference record.</p>
          )}
        </Panel>
        <Panel title="Environment (manifest.json)" bodyClassName="p-3 text-xs">
          {manErr && <p className="text-bad">{manErr}</p>}
          {!man && !manErr && <p className="text-fg-muted">Loading…</p>}
          {man && (
            <dl className="num grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt className="text-fg-muted">device · estimator</dt>
              <dd className="truncate text-right">
                {String(man.device)} · {String(man.estimator)}
              </dd>
              <dt className="text-fg-muted">inverse self-test</dt>
              <dd className="truncate text-right">
                {man.inverse_selftest ? `max rel err ${man.inverse_selftest.max_rel_err.toExponential(2)} (tol ${man.inverse_selftest.tol})` : "—"}
              </dd>
              {man.versions &&
                Object.entries(man.versions).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="truncate text-right" title={v}>
                      {v}
                    </dd>
                  </div>
                ))}
              <dt className="text-fg-muted">notebook sha256</dt>
              <dd className="truncate text-right" title={man.notebook_sha256 ?? ""}>
                {man.notebook_sha256?.slice(0, 16) ?? "—"}
              </dd>
              <dt className="text-fg-muted">DKM repo</dt>
              <dd className="truncate text-right" title={man.dkm?.repo}>
                {man.dkm?.repo_commit?.slice(0, 10) ?? "no git commit"}
              </dd>
              <dt className="text-fg-muted">git commit</dt>
              <dd className="truncate text-right">{man.git_commit ?? "not a git repository"}</dd>
            </dl>
          )}
        </Panel>
      </div>
      <Panel title="Log" className="h-[320px]">
        <LogStream logs={state.logs} originIso={run.startedAt ?? run.createdAt} run={run} />
      </Panel>
    </div>
  );
}
