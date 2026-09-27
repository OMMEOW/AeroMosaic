import type { Metadata } from "next";
import { NewRunView } from "@/components/new/NewRunView";
import type { VariantKind } from "@/services";

export const metadata: Metadata = { title: "New run" };

const VARIANTS = ["semantic", "firstwins", "dgeo"];

export default async function NewRunPage({ searchParams }: PageProps<"/new">) {
  const sp = await searchParams;
  const video = typeof sp.video === "string" ? sp.video : undefined;
  const variant = typeof sp.variant === "string" && VARIANTS.includes(sp.variant) ? (sp.variant as VariantKind) : undefined;
  const pi = typeof sp.i === "string" ? Number(sp.i) : NaN;
  const pj = typeof sp.j === "string" ? Number(sp.j) : NaN;
  const pair: [number, number] | undefined = Number.isInteger(pi) && Number.isInteger(pj) ? [pi, pj] : undefined;
  return <NewRunView key={`${video}-${variant}-${pi}-${pj}`} initialVideo={video} initialVariant={variant} initialPair={pair} />;
}
