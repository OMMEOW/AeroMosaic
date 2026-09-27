"use client";

import { useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconDownload, IconInfo, IconStop } from "@/components/ui/icons";
import {
  Banner,
  Button,
  Kbd,
  Panel,
  ProgressBar,
  RunStatusPill,
  Stat,
  Switch,
  Tooltip,
} from "@/components/ui/primitives";
import { CauseLegend, Unmeasured } from "@/components/pairs/cause";
import type { RunStatus } from "@/services";

const COLOR_GROUPS: { title: string; tokens: { name: string; note: string }[] }[] = [
  {
    title: "Surfaces",
    tokens: [
      { name: "--bg", note: "page" },
      { name: "--surface-1", note: "panels" },
      { name: "--surface-2", note: "raised / hover" },
      { name: "--surface-3", note: "controls, tracks" },
      { name: "--surface-inset", note: "imagery well" },
      { name: "--line", note: "dividers" },
      { name: "--line-strong", note: "control borders" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { name: "--fg", note: "primary, numerics" },
      { name: "--fg-muted", note: "labels" },
      { name: "--fg-subtle", note: "units, headers" },
    ],
  },
  {
    title: "Accent (one)",
    tokens: [
      { name: "--accent", note: "active / primary / focus" },
      { name: "--accent-soft", note: "active tint" },
    ],
  },
  {
    title: "Semantic only",
    tokens: [
      { name: "--ok", note: "accepted" },
      { name: "--bad", note: "rejected / failed" },
      { name: "--warn", note: "warning / cancel" },
      { name: "--ok-soft", note: "" },
      { name: "--bad-soft", note: "rejected row" },
      { name: "--warn-soft", note: "" },
    ],
  },
];

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-fg-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ThemeColumn({ theme }: { theme: "dark" | "light" }) {
  return (
    <div data-theme={theme} className="rounded-lg border border-line bg-bg p-3 text-fg">
      <div className="mb-3 text-2xs font-semibold tracking-wider text-fg-muted uppercase">{theme}</div>
      <div className="space-y-4">
        {COLOR_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1.5 text-2xs text-fg-subtle uppercase">{g.title}</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {g.tokens.map((t) => (
                <div key={t.name} className="flex items-center gap-2 rounded-md border border-line bg-surface-1 p-1.5">
                  <span className="size-7 shrink-0 rounded-sm border border-line-strong" style={{ background: `var(${t.name})` }} />
                  <span className="min-w-0">
                    <span className="num block truncate text-2xs text-fg">{t.name}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{t.note}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="rounded-md border border-line bg-surface-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Start run</Button>
            <Button>Secondary</Button>
            <RunStatusPill status="running" />
            <RunStatusPill status="failed" />
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Labels in muted, values in <span className="num text-fg">2,047 → 43</span>, units in{" "}
            <span className="text-fg-subtle">subtle</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

const STATUSES: RunStatus[] = ["queued", "running", "cancelling", "succeeded", "failed", "cancelled", "interrupted"];

export default function DesignPage() {
  const [sw, setSw] = useState(false);
  const [n, setN] = useState(1234.5);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <header>
        <h1 className="text-lg font-semibold">Design tokens &amp; primitives</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Ground-station instrument aesthetic. Chrome recedes; mosaic imagery is the brightest thing on screen. One accent for
          active/primary state; semantic colours only for accepted, rejected and warning. All tokens live in{" "}
          <code className="num text-fg">src/app/globals.css</code> as CSS custom properties; light is a separate palette, not an
          inversion.
        </p>
      </header>

      <Section title="Colour" note="Both themes rendered from the same components via [data-theme].">
        <div className="grid gap-3 lg:grid-cols-2">
          <ThemeColumn theme="dark" />
          <ThemeColumn theme="light" />
        </div>
      </Section>

      <Section title="Typography" note="Inter for prose and labels. JetBrains Mono, tabular + slashed zero, for every number, ID, frame index and log line.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Scale">
            <div className="space-y-2 p-3">
              {[
                ["text-xl", "28 / 34", "Run complete"],
                ["text-lg", "20 / 28", "DJI_0042.MP4"],
                ["text-base", "15 / 22", "Section heading"],
                ["text-sm", "13 / 20", "Body text and controls — the default."],
                ["text-xs", "12 / 18", "Secondary text, table cells, log lines."],
                ["text-2xs", "11 / 16", "LABELS · UNITS · CAPTIONS"],
              ].map(([cls, spec, sample]) => (
                <div key={cls} className="flex items-baseline gap-3">
                  <span className="num w-20 shrink-0 text-2xs text-fg-subtle">{cls}</span>
                  <span className="num w-14 shrink-0 text-2xs text-fg-subtle">{spec}</span>
                  <span className={`${cls} truncate`}>{sample}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Tabular numerics">
            <div className="space-y-3 p-3">
              <div className="num text-xl">
                {n.toFixed(1).padStart(8, " ")} <span className="text-xs text-fg-subtle">ms</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setN(Math.random() * 99999)}>
                  Randomise
                </Button>
                <span className="text-xs text-fg-muted">Width never changes as digits stream.</span>
              </div>
              <div className="num space-y-0.5 text-xs">
                <div>f0000 f0048 f0112 f1111 f2046</div>
                <div>0.164 0.300 0.412 0.987 1.000</div>
                <div>+00:07.412 r-3fa91c 3840×2160</div>
              </div>
            </div>
          </Panel>
        </div>
      </Section>

      <Section title="Spacing, radius, elevation" note="4 px base. Panels pad 12 px, grids gap 12 px, rows 28 px. Elevation by surface step, not shadow; shadow only for popovers.">
        <div className="flex flex-wrap items-end gap-4">
          {[1, 2, 3, 4, 6, 8].map((s) => (
            <div key={s} className="text-center">
              <div className="bg-accent-soft" style={{ width: s * 4, height: s * 4, outline: "1px solid var(--accent-line)" }} />
              <div className="num mt-1 text-2xs text-fg-subtle">{s * 4}</div>
            </div>
          ))}
          <div className="ml-6 flex gap-3">
            {["sm 3", "md 5", "lg 8"].map((r, i) => (
              <div key={r} className="text-center">
                <div className="size-10 border border-line-strong bg-surface-2" style={{ borderRadius: [3, 5, 8][i] }} />
                <div className="num mt-1 text-2xs text-fg-subtle">{r}</div>
              </div>
            ))}
            <div className="text-center">
              <div className="size-10 rounded-md bg-surface-3 shadow-pop" />
              <div className="num mt-1 text-2xs text-fg-subtle">pop</div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Primitives">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Buttons">
            <div className="space-y-2 p-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Primary</Button>
                <Button>Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger" icon={<IconStop size={12} />}>
                  Cancel run
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" icon={<IconDownload size={12} />}>
                  Download
                </Button>
                <Button size="sm" loading>
                  Loading
                </Button>
                <Button size="sm" disabled>
                  Disabled
                </Button>
                <Button variant="danger" loading disabled>
                  Cancelling…
                </Button>
              </div>
            </div>
          </Panel>
          <Panel title="Run status">
            <div className="flex flex-wrap gap-2 p-3">
              {STATUSES.map((s) => (
                <RunStatusPill key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-line p-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-fg-subtle">
                <span className="size-1.5 rounded-full border border-fg-subtle" /> pending
              </span>
              <span className="inline-flex items-center gap-1.5 text-accent">
                <span className="pulse-dot size-1.5 rounded-full bg-accent" /> active
              </span>
              <span className="inline-flex items-center gap-1.5 text-fg">
                <IconCheck size={12} className="text-ok" /> done
              </span>
              <span className="inline-flex items-center gap-1.5 text-bad">
                <IconAlert size={12} /> failed
              </span>
              <span className="inline-flex items-center gap-1.5 text-warn">
                <IconStop size={11} /> cancelled
              </span>
            </div>
          </Panel>
          <Panel title="Stats & progress">
            <div className="grid grid-cols-3 gap-3 p-3">
              <Stat label="Stat · sample" value="1,234" unit="/ 5,678" sub="sub-label" />
              <Stat label="Stat · sample" value="12.3%" sub="sub-label" />
              <Stat label="Stat · tone ok" value="45.6%" tone="ok" />
            </div>
            <div className="space-y-2.5 border-t border-line p-3">
              <ProgressBar value={0.62} label="determinate" />
              <ProgressBar value={null} label="indeterminate" />
              <ProgressBar value={1} tone="muted" label="done" />
              <ProgressBar value={0.45} tone="bad" label="failed" />
            </div>
          </Panel>
          <Panel title="Controls">
            <div className="flex flex-wrap items-center gap-4 p-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <Switch checked={sw} onChange={setSw} label="Example switch" /> Example switch
              </label>
              <Tooltip content="Tooltip sample.">
                <button type="button" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
                  Tooltip <IconInfo size={12} />
                </button>
              </Tooltip>
              <span className="text-xs text-fg-muted">
                <Kbd>F</Kbd> fit · <Kbd>1</Kbd> 1:1
              </span>
            </div>
          </Panel>
          <Panel title="Reject causes" className="lg:col-span-2" bodyClassName="p-3 flex flex-col gap-2 text-xs">
            <CauseLegend causes={["PROXY_FIT_FAILED", "GATE_IOU", "GATE_FM", "DEGENERATE_H", "RATIO_BELOW_MIN", "EXCEPTION"]} />
            <p className="text-fg-muted">
              Unmeasured values render as <Unmeasured /> with the reason on hover — never as 0.
            </p>
          </Panel>
          <div className="space-y-2 lg:col-span-2">
            <Banner tone="ok" icon={<IconCheck />} title="Banner · ok">
              Success tone (sample text).
            </Banner>
            <Banner tone="bad" icon={<IconAlert />} title="Banner · bad">
              Failure tone (sample text).
            </Banner>
            <Banner tone="warn" icon={<IconStop size={13} />} title="Banner · warn">
              Warning tone (sample text).
            </Banner>
          </div>
        </div>
      </Section>
    </div>
  );
}
