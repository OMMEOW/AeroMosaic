"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "@/components/ui/icons";

type Theme = "dark" | "light";

// The theme lives on <html data-theme>, set before paint by the inline script in layout.tsx.
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const getTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, getTheme, () => null);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("uav-theme", next);
    } catch {
      /* storage unavailable: theme still applies for this page */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Dark theme" : "Light theme"}
    >
      {theme === "light" ? <IconMoon /> : <IconSun />}
    </button>
  );
}
