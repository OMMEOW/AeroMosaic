"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useServiceInfo } from "@/hooks/useServiceInfo";
import { cn } from "@/components/ui/primitives";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/new", label: "New run", match: (p: string) => p === "/new" || p === "/" },
  { href: "/runs/active", label: "Live", match: (p: string) => /^\/runs\/[^/]+$/.test(p) },
  { href: "/history", label: "History", match: (p: string) => p.startsWith("/history") || /^\/runs\/[^/]+\/.+/.test(p) },
  { href: "/compare", label: "Compare", match: (p: string) => p.startsWith("/compare") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
  { href: "/about", label: "Methodology", match: (p: string) => p.startsWith("/about") },
];

export function TopBar() {
  const pathname = usePathname();
  const { kind } = useServiceInfo();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-[1680px] items-center gap-3 px-3 sm:gap-5 sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1" y="4" width="9" height="6" rx="1" fill="none" stroke="var(--fg-muted)" strokeWidth="1.3" transform="rotate(-8 5 7)" />
            <rect x="7" y="7" width="9" height="6" rx="1" fill="none" stroke="var(--accent)" strokeWidth="1.3" transform="rotate(6 11 10)" />
          </svg>
          <span className="hidden sm:inline">Mosaic GCS</span>
        </Link>
        <nav aria-label="Primary" className="flex h-full min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center px-2 text-sm whitespace-nowrap transition-colors sm:px-2.5",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {n.label}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {kind === "mock" && (
            <span
              className="num hidden rounded-sm border border-warn/40 px-1.5 py-px text-2xs tracking-wider text-warn uppercase sm:inline"
              title="Using the simulated in-browser backend (NEXT_PUBLIC_PIPELINE_BACKEND=mock)"
            >
              Mock backend
            </span>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
