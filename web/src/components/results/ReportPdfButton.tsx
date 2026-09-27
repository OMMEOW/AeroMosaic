"use client";

import { useState } from "react";
import { downloadReportPdf } from "@/lib/export/runExports";
import { IconDownload } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

/** Downloads <run>_report.pdf (rendered server-side from manifest, metrics and steps). */
export function ReportPdfButton({ runId, size = "md", variant = "secondary", label = "Report (PDF)" }: { runId: string; size?: "sm" | "md"; variant?: "secondary" | "ghost"; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      loading={busy}
      icon={<IconDownload size={12} />}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await downloadReportPdf(runId);
        } catch (err) {
          toast({ tone: "bad", title: "PDF report failed", body: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
