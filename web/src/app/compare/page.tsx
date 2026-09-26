import type { Metadata } from "next";
import { CompareView } from "@/components/compare/CompareView";

export const metadata: Metadata = { title: "Compare" };

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const ids = (typeof sp.runs === "string" ? sp.runs.split(",") : []).filter(Boolean).slice(0, 3);
  return <CompareView ids={[...new Set(ids)]} />;
}
