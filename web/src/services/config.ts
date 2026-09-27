/**
 * Backend connection config. The base URL comes from NEXT_PUBLIC_API_BASE_URL and can be
 * overridden at runtime from Settings (stored in localStorage, applied on reload).
 */
const URL_OVERRIDE_KEY = "uav-backend-url";

export const envBaseUrl = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function baseUrlOverride(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(URL_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

export function setBaseUrlOverride(url: string | null) {
  try {
    if (url) window.localStorage.setItem(URL_OVERRIDE_KEY, url);
    else window.localStorage.removeItem(URL_OVERRIDE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function effectiveBaseUrl() {
  return baseUrlOverride() ?? envBaseUrl();
}
