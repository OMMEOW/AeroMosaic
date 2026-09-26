import type { Metadata } from "next";
import { Suspense } from "react";
import { SelectionInspector } from "@/components/results/SelectionInspector";

export async function generateMetadata({ params }: PageProps<"/runs/[id]/selection">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Frame selection ${id}` };
}

export default function Page() {
  return (
    <Suspense>
      <SelectionInspector />
    </Suspense>
  );
}
