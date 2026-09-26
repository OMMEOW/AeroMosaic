import type { Metadata } from "next";
import { Suspense } from "react";
import { Diagnostics } from "@/components/results/Diagnostics";

export async function generateMetadata({ params }: PageProps<"/runs/[id]/diagnostics">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Diagnostics ${id}` };
}

export default function Page() {
  return (
    <Suspense>
      <Diagnostics />
    </Suspense>
  );
}
