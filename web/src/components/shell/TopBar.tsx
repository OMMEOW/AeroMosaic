"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/components/ui/primitives";
import { LogoMark } from "@/components/brand/Logo";
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
  const health = useHealth();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-[1680px] items-center gap-3 px-3 sm:gap-5 sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
          <LogoMark size={22} />
          <span className="hidden sm:inline">AeroMosaic</span>
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
          <Link
            href="/settings"
            className="num hidden items-center gap-1.5 rounded-sm px-1.5 py-px text-2xs text-fg-muted hover:text-fg sm:inline-flex"
            title={
              health.status === "ok"
                ? `${health.health.backend} · ${health.health.runsAllowed ? "ready" : health.health.blockers.join("; ")}`
                : health.status === "unreachable"
                  ? health.error
                  : "checking backend"
            }
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                health.status === "ok" ? (health.health.runsAllowed ? "bg-ok" : "bg-warn") : health.status === "unreachable" ? "bg-bad" : "bg-fg-subtle",
              )}
            />
            {health.status === "ok"
              ? `${health.health.info?.device ?? "backend"}${health.health.runsAllowed ? "" : " · not ready"}`
              : health.status === "unreachable"
                ? "backend unreachable"
                : "…"}
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
