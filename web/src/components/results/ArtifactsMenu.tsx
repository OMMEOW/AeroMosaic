"use client";

import { useEffect, useRef, useState } from "react";
import { getPipelineService, type ArtifactList } from "@/services";
import { downloadArtifact, downloadReportPdf } from "@/lib/export/runExports";
import { fmtBytes } from "@/lib/format";
import { IconChevron, IconDownload } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

const WHAT: Record<string, string> = {
  "manifest.json": "video, all constants, seed, device, versions, estimator, variant, hashes, status",
  "steps.jsonl": "one record per candidate edge (stage 1) and per DKM attempt (stage 2)",
  "events.jsonl": "every event the UI received, for replay",
  "metrics.json": "absolute coverage, counts, timings, baselines",
  "mosaic.png": "full-resolution mosaic",
  "mosaic_preview.png": "long edge ≤ 1600 px",
  "observed_area.json": "A_observed_px, canvas, origin, scale",
  "run.log": "worker stdout/stderr, full tracebacks",
};

/** Every file in the run directory, downloadable individually, plus the whole run as a zip. */
export function ArtifactsMenu({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ArtifactList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || list) return;
    getPipelineService()
      .listArtifacts(runId)
      .then(setList, (e: Error) => setErr(e.message));
  }, [open, list, runId]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const get = async (name: string) => {
    setBusy(name);
    try {
      await downloadArtifact(runId, name);
    } catch (e) {
      toast({ tone: "bad", title: `Download failed: ${name}`, body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={box} className="relative">
      <Button variant="secondary" icon={<IconDownload size={12} />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Run files <IconChevron size={10} />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[26rem] max-w-[90vw] rounded-lg border border-line bg-surface-1 p-1 shadow-pop">
          <button
            type="button"
            onClick={() => get("run.zip")}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-2"
          >
            <span className="font-medium">Whole run (.zip)</span>
            <span className="text-2xs text-fg-subtle">{busy === "run.zip" ? "preparing…" : "everything below"}</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy("report.pdf");
              try {
                await downloadReportPdf(runId);
              } catch (e) {
                toast({ tone: "bad", title: "PDF report failed", body: (e as Error).message });
              } finally {
                setBusy(null);
              }
            }}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-2"
          >
            <span className="font-medium">Report (PDF)</span>
            <span className="text-2xs text-fg-subtle">{busy === "report.pdf" ? "rendering…" : "metrics, seam metrics, figures, DKM attempts"}</span>
          </button>
          <div className="my-1 border-t border-line" />
          {err && <p className="px-2.5 py-2 text-xs text-bad">{err}</p>}
          {!list && !err && <p className="px-2.5 py-2 text-xs text-fg-muted">Listing…</p>}
          <ul className="max-h-80 overflow-auto">
            {list?.files.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  onClick={() => get(f.name)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className="num truncate text-xs text-fg">{f.name}</span>
                  <span className="num text-2xs text-fg-subtle">{busy === f.name ? "…" : fmtBytes(f.sizeBytes)}</span>
                  {WHAT[f.name] && <span className="col-span-2 truncate text-2xs text-fg-muted">{WHAT[f.name]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
