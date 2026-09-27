import type { Metadata } from "next";
import { NewRunView } from "@/components/new/NewRunView";
import type { VariantKind } from "@/services";

export const metadata: Metadata = { title: "New run" };

const VARIANTS = ["semantic", "firstwins", "dgeo"];

export default async function NewRunPage({ searchParams }: PageProps<"/new">) {
  const sp = await searchParams;
  const video = typeof sp.video === "string" ? sp.video : undefined;
  const variant = typeof sp.variant === "string" && VARIANTS.includes(sp.variant) ? (sp.variant as VariantKind) : undefined;
  return <NewRunView key={`${video}-${variant}`} initialVideo={video} initialVariant={variant} />;
}
