import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsOverview } from "@/components/results/ResultsOverview";

export async function generateMetadata({ params }: PageProps<"/runs/[id]/results">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Results ${id}` };
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsOverview />
    </Suspense>
  );
}
