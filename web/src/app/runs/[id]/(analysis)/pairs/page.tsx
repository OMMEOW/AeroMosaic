import type { Metadata } from "next";
import { RunPairs } from "@/components/results/RunPairs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Pairs ${id}` };
}

export default function PairsPage() {
  return <RunPairs />;
}
