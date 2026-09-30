import Image from "next/image";
import { cn } from "@/components/ui/cn";

/**
 * AeroMosaic identity, from the project logo (logo.png at the repo root).
 * The artwork is drawn for a white ground (black drone, black "Aero"), so it is always placed
 * on a white tile or card rather than recoloured for the dark theme.
 */
export const PRODUCT_NAME = "AeroMosaic";

/** The mark (drone + mosaic, no wordmark) on a white rounded tile. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-white", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image src="/brand/aeromosaic-mark-128.png" alt="" width={Math.round(size * 0.86)} height={Math.round(size * 0.86)} />
    </span>
  );
}

/** "Aero" in ink, "Mosaic" in brand pink, as in the logo. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      <span className="text-fg">Aero</span>
      <span className="text-brand">Mosaic</span>
    </span>
  );
}
