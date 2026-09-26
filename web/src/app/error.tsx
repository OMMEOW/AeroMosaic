"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/primitives";

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md text-center" role="alert">
      <h1 className="text-base font-semibold">This screen failed to load</h1>
      <p className="num mt-1 text-xs break-words text-fg-muted">{error.message}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" className={buttonClass("primary")} onClick={() => retry()}>
          Try again
        </button>
        <Link href="/history" className={buttonClass("secondary")}>
          History
        </Link>
      </div>
    </div>
  );
}
