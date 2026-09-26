import { getPrefs } from "./prefs";

const intFmt = new Intl.NumberFormat("en-US");

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : intFmt.format(Math.round(n)));

/** Percent with the user's fixed precision (Settings → precision). */
export const fmtPct = (ratio: number | null | undefined, digits: number = getPrefs().precision.percent) =>
  ratio == null || !Number.isFinite(ratio) ? "—" : `${(ratio * 100).toFixed(digits)}%`;

/** 0..1 ratios (inlier ratio, f_m, SSIM) with fixed precision. */
export const fmtRatio = (r: number | null | undefined, digits: number = getPrefs().precision.ratio) =>
  r == null || !Number.isFinite(r) ? "—" : r.toFixed(digits);

/** G_scale value, e.g. 1.0157 */
export const fmtScale = (g: number | null | undefined, digits: number = getPrefs().precision.drift) =>
  g == null ? "—" : g.toFixed(digits);

/** Deviation of G_scale from its ideal 1.0, signed percent: "+1.57%". */
export function fmtScaleDev(g: number | null | undefined) {
  if (g == null) return "—";
  const d = (g - 1) * 100;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(Math.max(1, getPrefs().precision.drift - 2))}%`;
}

/** G_shear, signed, fixed precision: "+0.0034" (ideal 0). */
export function fmtShear(g: number | null | undefined) {
  if (g == null) return "—";
  const d = getPrefs().precision.drift;
  const txt = Math.abs(g).toFixed(d);
  if (Number(txt) === 0) return ` ${txt}`; // no sign on a value that rounds to zero
  return `${g >= 0 ? "+" : "−"}${txt}`;
}

/** Signed delta with explicit +/−, fixed digits. */
export function fmtSigned(v: number, digits: number, suffix = "") {
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}${suffix}`;
}

/** Native frame label: f0412. */
export const fmtFrame = (i: number) => `f${String(i).padStart(4, "0")}`;

/** 0:07, 4:12, 1:02:09 — for elapsed / ETA. */
export function fmtClock(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 0.93 s, 12.4 s, 3m 04s — or fixed seconds / ms per Settings. */
export function fmtDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const unit = getPrefs().durationUnit;
  if (unit === "ms") return `${fmtInt(ms)} ms`;
  if (unit === "s") return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[u]}`;
}

export function fmtAbsolute(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })} (${iso})`;
}

/** Video timestamp mm:ss.mmm */
export function fmtVideoTime(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** Relative log timestamp from run start: +00:07.412 */
export function fmtOffset(ms: number) {
  const neg = ms < 0;
  const a = Math.abs(ms);
  const m = Math.floor(a / 60_000);
  const s = Math.floor((a % 60_000) / 1000);
  const milli = Math.floor(a % 1000);
  return `${neg ? "−" : "+"}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}
