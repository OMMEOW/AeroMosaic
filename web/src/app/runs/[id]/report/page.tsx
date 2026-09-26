import type { Metadata } from "next";
import { ReportView } from "@/components/results/ReportView";

export async function generateMetadata({ params }: PageProps<"/runs/[id]/report">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Report ${id}` };
}

export default async function ReportPage({ params }: PageProps<"/runs/[id]/report">) {
  const { id } = await params;
  return <ReportView runId={id} />;
}
