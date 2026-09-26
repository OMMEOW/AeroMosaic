"use client";

import { useState } from "react";
import { useHotkeys, useRegisteredHotkeys } from "@/hooks/useHotkeys";
import { ConfirmDialog } from "@/components/ui/misc";
import { Kbd } from "@/components/ui/primitives";

const pretty = (k: string) => k.replace("shift+", "⇧").replace("mod+", "⌘");

/** "?" opens a list of the shortcuts active on the current screen. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useHotkeys([{ key: "shift+?", description: "Show keyboard shortcuts", scope: "Global", handler: () => setOpen(true) }]);
  const keys = useRegisteredHotkeys();
  const scopes = [...new Set(keys.map((k) => k.scope))];
  return (
    <ConfirmDialog open={open} title="Keyboard shortcuts" confirmLabel="Close" tone="primary" cancelLabel={null} onConfirm={() => {}} onClose={() => setOpen(false)}>
      <div className="space-y-3">
        {scopes.map((s) => (
          <div key={s}>
            <div className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{s}</div>
            <ul className="mt-1 space-y-1">
              {keys
                .filter((k) => k.scope === s)
                .map((k) => (
                  <li key={k.key + k.description} className="flex items-center justify-between gap-4 text-sm">
                    <span>{k.description}</span>
                    <Kbd>{pretty(k.key)}</Kbd>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </ConfirmDialog>
  );
}
