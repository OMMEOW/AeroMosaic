import type { Metadata } from "next";
import { NewRunView } from "@/components/new/NewRunView";

export const metadata: Metadata = { title: "New run" };

export default async function NewRunPage({ searchParams }: PageProps<"/new">) {
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  return <NewRunView key={`${from}-${sp.adjust}`} from={from} adjust={sp.adjust === "1"} />;
}
