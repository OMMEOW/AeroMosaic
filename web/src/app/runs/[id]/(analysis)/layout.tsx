import { RunShell } from "@/components/results/RunShell";

export default async function RunAnalysisLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunShell runId={id}>{children}</RunShell>;
}
