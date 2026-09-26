import type { Metadata } from "next";
import { LiveRunView } from "@/components/run/LiveRunView";

export async function generateMetadata({ params }: PageProps<"/runs/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${id}` };
}

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  return <LiveRunView key={id} runId={id} />;
}
