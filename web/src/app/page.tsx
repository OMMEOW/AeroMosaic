import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: { absolute: "AeroMosaic · UAV video mosaicking" },
  description: "Stitch drone video into a ground mosaic you can measure: SIFT-gated frame selection, DKM registration, SemanticStitch seams, absolute coverage.",
};

export default function Home() {
  return <Landing />;
}
