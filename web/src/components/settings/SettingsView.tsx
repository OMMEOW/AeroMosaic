"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { baseUrlOverride, backendKind, DEFAULT_PARAMS, envBaseUrl, getPipelineService, setBaseUrlOverride, type PipelineParams } from "@/services";
import { paramsEqual, setPrefs, usePrefs, type Prefs } from "@/lib/prefs";
import { fmtDuration, fmtPct, fmtRatio, fmtScale } from "@/lib/format";
import { ParamsForm } from "@/components/new/ParamsForm";
import { IconAlert, IconRefresh, Spinner } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/misc";
import { Banner, Button, cn, Panel, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 sm:grid-cols-[220px_1fr] sm:items-center sm:gap-4">
      <div>
        <div className="text-sm text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-subtle">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn("num h-7 rounded-sm px-2.5 text-xs", value === o.v ? "bg-accent-soft text-fg" : "text-fg-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Health = { state: "checking" } | { state: "ok"; latencyMs: number; backend: string; version: string } | { state: "down"; message: string };

function useTheme(): "dark" | "light" {
  return useSyncExternalStore<"dark" | "light">(
    (l) => {
      const mo = new MutationObserver(l);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => mo.disconnect();
    },
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
}

export function SettingsView() {
  const prefs = usePrefs();
  const theme = useTheme();
  const kind = backendKind();
  const [draft, setDraft] = useState<PipelineParams>(prefs.defaults);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmMock, setConfirmMock] = useState(false);
  const [url, setUrl] = useState(() => (typeof window === "undefined" ? "" : (baseUrlOverride() ?? envBaseUrl())));
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const [notifPerm, setNotifPerm] = useState<string>("unsupported");

  // Re-sync the draft when saved defaults change (e.g. after hydration or another tab).
  const [syncedDefaults, setSyncedDefaults] = useState(prefs.defaults);
  if (syncedDefaults !== prefs.defaults) {
    setSyncedDefaults(prefs.defaults);
    setDraft(prefs.defaults);
  }
  const ping = () =>
    getPipelineService()
      .ping()
      .then(
        (h) => setHealth({ state: "ok", ...h }),
        (e: Error) => setHealth({ state: "down", message: e.message }),
      );
  const check = () => {
    setHealth({ state: "checking" });
    void ping();
  };
  useEffect(() => {
    void ping();
    void Promise.resolve().then(() => typeof Notification !== "undefined" && setNotifPerm(Notification.permission));
     
  }, []);

  const dirty = !paramsEqual(draft, prefs.defaults);
  const omegaDeviates = draft.selectionThreshold !== DEFAULT_PARAMS.selectionThreshold;
  const saveDefaults = () => {
    setPrefs({ defaults: draft });
    toast({ tone: "ok", title: "Pipeline defaults saved", body: "Applied to new runs from now on." });
  };
  const setPrecision = (patch: Partial<Prefs["precision"]>) => setPrefs((p) => ({ ...p, precision: { ...p.precision, ...patch } }));
  const setTheme = (t: "dark" | "light") => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("uav-theme", t);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Panel
        title="Pipeline defaults"
        actions={
          <span className={cn("text-2xs normal-case", paramsEqual(prefs.defaults, DEFAULT_PARAMS) ? "text-fg-subtle" : "text-warn")}>
            {paramsEqual(prefs.defaults, DEFAULT_PARAMS) ? "validated defaults" : "modified from validated defaults"}
          </span>
        }
      >
        <div className="px-3">
          <ParamsForm value={draft} onChange={setDraft} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefresh size={12} />}
            disabledReason={paramsEqual(prefs.defaults, DEFAULT_PARAMS) && !dirty ? "Already at validated defaults." : null}
            onClick={() => setConfirmReset(true)}
          >
            Reset to validated defaults
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabledReason={!dirty ? "No unsaved changes." : null} onClick={() => setDraft(prefs.defaults)}>
              Discard
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabledReason={!dirty ? "No unsaved changes." : null}
              onClick={() => (omegaDeviates ? setConfirmSave(true) : saveDefaults())}
            >
              Save defaults
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Backend">
        <div className="divide-y divide-line px-3">
          <Field label="Implementation" hint="Build-time: NEXT_PUBLIC_PIPELINE_BACKEND">
            <span className="num text-sm">{kind === "mock" ? "mock (in-browser simulation)" : "http (FastAPI)"}</span>
          </Field>
          <Field label="Base URL" hint={`Default from NEXT_PUBLIC_API_BASE_URL: ${envBaseUrl()}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={kind === "mock"}
                className="num h-8 w-full max-w-sm rounded-md border border-line-strong bg-surface-2 px-2 text-sm disabled:opacity-50"
                aria-label="Backend base URL"
              />
              <Button
                size="sm"
                disabledReason={
                  kind === "mock"
                    ? "The mock backend is in use; build with NEXT_PUBLIC_PIPELINE_BACKEND=http to use a URL."
                    : !/^https?:\/\/.+/.test(url)
                      ? "Enter an http(s) URL."
                      : url === (baseUrlOverride() ?? envBaseUrl())
                        ? "This URL is already in use."
                        : null
                }
                onClick={() => {
                  setBaseUrlOverride(url === envBaseUrl() ? null : url);
                  window.location.reload();
                }}
              >
                Apply &amp; reload
              </Button>
            </div>
          </Field>
          <Field label="Connection">
            <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
              {health.state === "checking" ? (
                <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                  <Spinner size={12} /> Checking…
                </span>
              ) : health.state === "ok" ? (
                <span className="num inline-flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full bg-ok" /> Connected · {health.latencyMs} ms · {health.backend} {health.version}
                </span>
              ) : (
                <span className="num inline-flex items-center gap-2 text-sm text-bad">
                  <span className="size-2 rounded-full bg-bad" /> Unreachable · {health.message}
                </span>
              )}
              <Button size="sm" variant="ghost" icon={<IconRefresh size={12} />} onClick={check}>
                Recheck
              </Button>
            </div>
          </Field>
        </div>
      </Panel>

      <Panel title="Display">
        <div className="divide-y divide-line px-3">
          <Field label="Theme">
            <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ v: "dark", label: "Dark" }, { v: "light", label: "Light" }]} />
          </Field>
          <Field label="Durations" hint={`Example: ${fmtDuration(4930)} · ${fmtDuration(83_400)}`}>
            <Segmented
              label="Duration unit"
              value={prefs.durationUnit}
              onChange={(v) => setPrefs({ durationUnit: v })}
              options={[
                { v: "auto", label: "Auto" },
                { v: "s", label: "Seconds" },
                { v: "ms", label: "Milliseconds" },
              ]}
            />
          </Field>
          <Field label="Percent precision" hint={`Coverage ${fmtPct(0.94137)}`}>
            <Segmented label="Percent precision" value={prefs.precision.percent} onChange={(v) => setPrecision({ percent: v })} options={[0, 1, 2].map((v) => ({ v: v as 0 | 1 | 2, label: `${v} dp` }))} />
          </Field>
          <Field label="Ratio precision" hint={`Inlier ratio ${fmtRatio(0.41237)}`}>
            <Segmented label="Ratio precision" value={prefs.precision.ratio} onChange={(v) => setPrecision({ ratio: v })} options={[2, 3, 4].map((v) => ({ v: v as 2 | 3 | 4, label: `${v} dp` }))} />
          </Field>
          <Field label="Drift precision" hint={`G_scale ${fmtScale(1.015734)}`}>
            <Segmented label="Drift precision" value={prefs.precision.drift} onChange={(v) => setPrecision({ drift: v })} options={[3, 4, 5].map((v) => ({ v: v as 3 | 4 | 5, label: `${v} dp` }))} />
          </Field>
          <p className="py-2 text-xs text-fg-subtle">Precision is fixed per metric so streaming values never change width.</p>
        </div>
      </Panel>

      <Panel title="Notifications">
        <div className="divide-y divide-line px-3">
          <Field label="Notify when a run finishes" hint="Browser notification, only while this tab is in the background.">
            <div className="flex flex-wrap items-center gap-3">
              <Switch checked={prefs.notifications} onChange={(v) => setPrefs({ notifications: v })} label="Notify when a run finishes" />
              <span className="num text-xs text-fg-muted">permission: {notifPerm}</span>
              {notifPerm === "default" && (
                <Button size="sm" variant="ghost" onClick={() => Notification.requestPermission().then(setNotifPerm)}>
                  Allow notifications
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Panel>

      {kind === "mock" && (
        <Panel title="Mock data">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-xs text-fg-muted">Removes all simulated runs and uploads, then restores the demo history.</span>
            <Button size="sm" variant="danger" onClick={() => setConfirmMock(true)}>
              Reset mock data
            </Button>
          </div>
        </Panel>
      )}

      <ConfirmDialog
        open={confirmSave}
        title={`Save ω = ${draft.selectionThreshold} as the default?`}
        confirmLabel={`Use ω = ${draft.selectionThreshold}`}
        cancelLabel="Keep 0.164"
        onConfirm={saveDefaults}
        onClose={() => setConfirmSave(false)}
      >
        <Banner tone="warn" icon={<IconAlert />} title="ω = 0.164 is a calibrated value">
          Every new run will use ω = {draft.selectionThreshold}. Its results will not be comparable with runs at the validated threshold.
        </Banner>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmReset}
        title="Reset pipeline defaults?"
        confirmLabel="Reset to validated defaults"
        cancelLabel="Cancel"
        tone="primary"
        onConfirm={() => {
          setDraft(DEFAULT_PARAMS);
          setPrefs({ defaults: DEFAULT_PARAMS });
          toast({ tone: "ok", title: "Validated defaults restored" });
        }}
        onClose={() => setConfirmReset(false)}
      >
        ω = 0.164, gaps [1,2,4,8,16,32,64], 1920 px, refinement off.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmMock}
        title="Reset mock data?"
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={() => {
          for (const k of Object.keys(localStorage)) if (k.startsWith("uav-mock/")) localStorage.removeItem(k);
          window.location.reload();
        }}
        onClose={() => setConfirmMock(false)}
      >
        All simulated runs, including any in progress, are removed.
      </ConfirmDialog>
    </div>
  );
}
