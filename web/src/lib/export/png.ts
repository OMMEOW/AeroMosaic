import { crc32 } from "./crc32";

/**
 * Inserts PNG tEXt chunks (Latin-1 keyword + text) before IEND, so provenance
 * travels inside the image file itself (readable with `exiftool` / `pngcheck -t`).
 */
export function addPngText(png: Uint8Array, entries: Record<string, string>): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => png[i] === b)) throw new Error("not a PNG");
  // Find IEND chunk start.
  let off = 8;
  let iend = -1;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off < png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === "IEND") {
      iend = off;
      break;
    }
    off += 12 + len;
  }
  if (iend < 0) throw new Error("PNG has no IEND");

  // tEXt is Latin-1: fold the few non-Latin-1 symbols we emit to ASCII rather than "?".
  const fold = (s: string) => s.replace(/ω/g, "omega").replace(/[—–]/g, "-").replace(/→/g, "->").replace(/×/g, "x");
  const enc = (s: string) => Uint8Array.from(Array.from(fold(s), (ch) => (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63)));
  const chunks: Uint8Array[] = [];
  for (const [k, v] of Object.entries(entries)) {
    const data = new Uint8Array([...enc(k.slice(0, 79)), 0, ...enc(v)]);
    const chunk = new Uint8Array(12 + data.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length);
    chunk.set([116, 69, 88, 116], 4); // "tEXt"
    chunk.set(data, 8);
    dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    chunks.push(chunk);
  }
  const extra = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(png.length + extra);
  out.set(png.subarray(0, iend), 0);
  let p = iend;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  out.set(png.subarray(iend), p);
  return out;
}

/** Reads tEXt chunks back (used by tests / verification). */
export function readPngText(png: Uint8Array): Record<string, string> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Record<string, string> = {};
  let off = 8;
  while (off + 8 <= png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === "tEXt") {
      const data = png.subarray(off + 8, off + 8 + len);
      const z = data.indexOf(0);
      out[String.fromCharCode(...data.subarray(0, z))] = String.fromCharCode(...data.subarray(z + 1));
    }
    if (type === "IEND") break;
    off += 12 + len;
  }
  return out;
}
