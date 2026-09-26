import { provenanceHeader, type Provenance } from "./provenance";

/**
 * Makes a chart SVG standalone: resolves var(--token) colours to the current
 * theme's values, sets fonts, and embeds provenance both as <metadata> and as
 * a visible footer line (so it survives being pasted into a paper).
 */
export function standaloneSvg(svgMarkup: string, prov: Provenance, opts: { width: number; height: number; title: string }): string {
  const cs = getComputedStyle(document.documentElement);
  // Token values are substituted inside XML attributes: quotes and markup characters must not leak in
  // (e.g. font variables resolve to "JetBrains Mono", "JetBrains Mono Fallback").
  const attrSafe = (v: string) => v.replace(/"/g, "'").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const resolved = svgMarkup.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name: string) => attrSafe(cs.getPropertyValue(name).trim() || "#888"));
  const footerH = 28;
  const W = opts.width;
  const H = opts.height + footerH;
  const inner = resolved.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bg = cs.getPropertyValue("--surface-1").trim() || "#ffffff";
  const muted = cs.getPropertyValue("--fg-subtle").trim() || "#777";
  const foot = `${prov.runId} · ${prov.video.filename} · ω=${prov.params.selectionThreshold} gaps=[${prov.params.candidateGaps.join(",")}] max_res=${prov.params.maxWorkingResolution} refine=${prov.params.denseRefinement ? "on" : "off"} · exported ${prov.exportedAt}`;
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
<title>${esc(opts.title)}</title>
<metadata><![CDATA[
${provenanceHeader(prov, "")}
]]></metadata>
<rect width="${W}" height="${H}" fill="${bg}"/>
<g>${inner}</g>
<text x="8" y="${H - 10}" font-size="10" fill="${muted}" font-family="'JetBrains Mono', ui-monospace, monospace">${esc(foot)}</text>
</svg>`;
  assertValidSvg(out);
  return out;
}

/** Refuse to hand out an SVG that an XML parser (Illustrator, Inkscape, LaTeX) would reject. */
export function assertValidSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`Generated SVG is not valid XML: ${err.textContent?.slice(0, 160)}`);
}

export async function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterisation failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
