"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { baseUrlOverride, envBaseUrl, getPipelineService, setBaseUrlOverride } from "@/services";
import { refreshHealth, useHealth } from "@/hooks/useHealth";
import { setPrefs, usePrefs, type Prefs } from "@/lib/prefs";
import { fmtDuration, fmtPct, fmtRatio } from "@/lib/format";
import { IconAlert, IconCheck, IconRefresh, Spinner } from "@/components/ui/icons";
import { Copyable } from "@/components/ui/misc";
import { Banner, Button, cn, Panel, Switch } from "@/components/ui/primitives";

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

function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-start gap-1.5 text-sm", ok === false ? "text-bad" : ok ? "text-fg" : "text-fg-muted")}>
      {ok === false ? <IconAlert size={13} className="mt-0.5 shrink-0" /> : ok ? <IconCheck size={13} className="mt-0.5 shrink-0 text-ok" /> : null}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function SettingsView() {
  const prefs = usePrefs();
  const theme = useTheme();
  const health = useHealth();
  const [url, setUrl] = useState(() => (typeof window === "undefined" ? "" : (baseUrlOverride() ?? envBaseUrl())));
  const [notifPerm, setNotifPerm] = useState<string>("unsupported");
  const [reprobing, setReprobing] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => typeof Notification !== "undefined" && setNotifPerm(Notification.permission));
  }, []);
  const setPrecision = (patch: Partial<Prefs["precision"]>) => setPrefs((p) => ({ ...p, precision: { ...p.precision, ...patch } }));
  const setTheme = (t: "dark" | "light") => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("uav-theme", t);
    } catch {
      /* storage unavailable */
    }
  };
  const h = health.status === "ok" ? health.health : null;
  const info = h?.info ?? null;

  const reprobe = async () => {
    setReprobing(true);
    try {
      await fetch(getPipelineService().url("/api/health/refresh"), { method: "POST" });
    } catch {
      /* reported by the health poller */
    }
    setTimeout(() => {
      void refreshHealth();
      setReprobing(false);
    }, 1500);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Panel title="Backend">
        <div className="divide-y divide-line px-3">
          <Field label="Base URL" hint={`Default from NEXT_PUBLIC_API_BASE_URL: ${envBaseUrl()}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="num h-8 w-full max-w-sm rounded-md border border-line-strong bg-surface-2 px-2 text-sm"
                aria-label="Backend base URL"
              />
              <Button
                size="sm"
                disabledReason={!/^https?:\/\/.+/.test(url) ? "Enter an http(s) URL." : url === (baseUrlOverride() ?? envBaseUrl()) ? "This URL is already in use." : null}
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
              {health.status === "loading" ? (
                <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                  <Spinner size={12} /> Checking…
                </span>
              ) : health.status === "ok" ? (
                <span className="num inline-flex items-center gap-2 text-sm">
                  <span className={cn("size-2 rounded-full", health.health.runsAllowed ? "bg-ok" : "bg-warn")} /> Connected · {health.health.latencyMs} ms ·{" "}
                  {health.health.backend} {health.health.version}
                </span>
              ) : (
                <span className="num inline-flex items-center gap-2 text-sm text-bad">
                  <span className="size-2 rounded-full bg-bad" /> Unreachable · {health.error}
                </span>
              )}
              <Button size="sm" variant="ghost" icon={<IconRefresh size={12} />} onClick={() => void refreshHealth()}>
                Recheck
              </Button>
            </div>
          </Field>
          {h && h.state === "pending" && (
            <Field label="Startup probe">
              <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <Spinner size={12} /> self-test running…
              </span>
            </Field>
          )}
          {h && h.state === "error" && (
            <Field label="Startup probe">
              <Check ok={false}>{h.error}</Check>
            </Field>
          )}
          {info && (
            <>
              <Field label="Device" hint="MPS if available, else CPU (UAV_DEVICE overrides)">
                <span className="num text-sm">
                  {info.device} · torch {info.torch} · OpenCV {info.opencv} · Python {info.python}
                </span>
              </Field>
              <Field label="Batched-inverse self-test" hint="b = 2, N = 1530 on the device vs CPU; refuse above 1e-3">
                <Check ok={info.inverseSelftest.passed}>
                  {info.inverseSelftest.passed
                    ? `passed · max relative error ${info.inverseSelftest.maxRelErr?.toExponential(2)} · mode ${info.inverseSelftest.mode ?? "—"}`
                    : info.inverseSelftest.error}
                </Check>
              </Field>
              <Field label="Homography estimator" hint="Stage-2 layer 2">
                <span className="num text-sm">
                  {info.estimator}
                  {info.estimator === "magsac" && <span className="text-fg-muted"> · the notebook&apos;s fallback; the CUDA runs used GC-RANSAC</span>}
                </span>
              </Field>
              <Field label="DKM weights">
                <Check ok={info.dkm.weightsFound}>
                  <span className="num">{info.dkm.weights}</span>
                  {!info.dkm.weightsFound && " not found"}
                </Check>
              </Field>
              <Field label="SemanticStitch" hint="Target composition. Verified SHA-256 required; no fallback.">
                <div className="flex flex-col gap-1">
                  <Check ok={info.semstitch.verified ? true : false}>
                    {info.semstitch.verified ? "checkpoint verified" : info.semstitch.error}
                  </Check>
                  <span className="num text-2xs text-fg-subtle">repo {info.semstitch.repo}</span>
                  <span className="num text-2xs text-fg-subtle">checkpoint {info.semstitch.checkpoint}</span>
                  {info.semstitch.sha256 && (
                    <span className="num text-2xs text-fg-subtle">
                      file sha256 <Copyable value={info.semstitch.sha256}>{info.semstitch.sha256.slice(0, 16)}…</Copyable>
                    </span>
                  )}
                  <span className="num text-2xs text-fg-subtle">
                    expected sha256 {info.semstitch.expectedSha256 ?? "not configured (UAV_SEMSTITCH_SHA256)"}
                  </span>
                </div>
              </Field>
            </>
          )}
          {h && (
            <>
              <Field label="Storage">
                <span className="num flex flex-col text-xs text-fg-muted">
                  <span>runs {h.runsRoot}</span>
                  <span>data {h.dataRoot}</span>
                </span>
              </Field>
              <Field label="Pipeline constants" hint="Calibrated; read-only. From backend/pipeline/config.py.">
                <span className="num text-xs text-fg-muted">
                  ω {h.constants.omega} on {h.constants.gateScore} · IoU ≥ {h.constants.iouTrust} · gaps [{h.constants.candidateGaps.join(", ")}] · SIFT{" "}
                  {h.constants.probeNFeatures} · τs {h.constants.tauS} → τr {h.constants.tauR} · accept ≥ {h.constants.minInlierRatio} · DKM{" "}
                  {h.constants.dkmNumSamples} samples, upsample {String(h.constants.upsamplePreds)} · long edge ≤ {h.constants.maxSide}
                </span>
              </Field>
              <Field label="Re-run startup probe" hint="After installing the SemanticStitch checkpoint or changing env">
                <Button size="sm" variant="ghost" loading={reprobing} icon={<IconRefresh size={12} />} onClick={reprobe}>
                  Re-probe
                </Button>
              </Field>
            </>
          )}
          {h && !h.runsAllowed && h.state !== "pending" && (
            <div className="py-3">
              <Banner tone="bad" icon={<IconAlert />} title="Runs cannot start">
                {h.blockers.join("; ")}
              </Banner>
            </div>
          )}
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
          <Field label="Percent precision" hint={`Example ${fmtPct(0.94137)}`}>
            <Segmented label="Percent precision" value={prefs.precision.percent} onChange={(v) => setPrecision({ percent: v })} options={[0, 1, 2].map((v) => ({ v: v as 0 | 1 | 2, label: `${v} dp` }))} />
          </Field>
          <Field label="Ratio precision" hint={`Example ${fmtRatio(0.41237)}`}>
            <Segmented label="Ratio precision" value={prefs.precision.ratio} onChange={(v) => setPrecision({ ratio: v })} options={[2, 3, 4].map((v) => ({ v: v as 2 | 3 | 4, label: `${v} dp` }))} />
          </Field>
          <p className="py-2 text-xs text-fg-subtle">Absolute coverage is always shown to 2 dp. Precision is fixed per metric so streaming values never change width.</p>
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
    </div>
  );
}
