/**
 * Browser-only raster generation for the mock backend: procedural terrain,
 * progressively composited mosaic previews, full-resolution mosaic, and
 * frame thumbnails. Outputs are object URLs, exactly as the real backend
 * would hand the UI plain image URLs.
 */
import type { MosaicImage, Quad } from "../contract";
import { footprintQuad, type Simulation } from "./flight";
import { hash2, mulberry32, range } from "./prng";
import { parcelAt, WORLD_H, WORLD_W, type ParcelKind, type World } from "./world";

const PARCEL_COLORS: Record<ParcelKind, string[]> = {
  wheat: ["#b5a466", "#c0ae70", "#a99a5d"],
  crop: ["#5c7839", "#66833f", "#536d33"],
  grass: ["#7c9254", "#869b5b", "#72894c"],
  soil: ["#876d52", "#7d644b", "#92785b"],
  pale: ["#bab29a", "#c3bca5", "#b0a88f"],
  orchard: ["#4d6932", "#56733a"],
};

const terrainCache = new Map<number, HTMLCanvasElement>();

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement) {
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  return g;
}

function strokePolyline(g: CanvasRenderingContext2D, pts: [number, number][]) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last[0], last[1]);
  g.stroke();
}

/** Parallel lines across a rect (crop rows, tramlines). Caller strokes. */
function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vertical: boolean, offset: number, step: number) {
  if (vertical) {
    for (let lx = x + offset; lx < x + w; lx += step) {
      g.moveTo(lx, y);
      g.lineTo(lx, y + h);
    }
  } else {
    for (let ly = y + offset; ly < y + h; ly += step) {
      g.moveTo(x, ly);
      g.lineTo(x + w, ly);
    }
  }
}

function drawTreeCluster(g: CanvasRenderingContext2D, rng: () => number, x: number, y: number, r: number, n: number) {
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const tx = x + Math.cos(a) * d;
    const ty = y + Math.sin(a) * d;
    const tr = range(rng, 5, 11);
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.beginPath();
    g.arc(tx + 3, ty + 3, tr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rng() > 0.5 ? "#2f4a27" : "#38552d";
    g.beginPath();
    g.arc(tx, ty, tr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(160,190,110,0.18)";
    g.beginPath();
    g.arc(tx - tr * 0.3, ty - tr * 0.3, tr * 0.5, 0, Math.PI * 2);
    g.fill();
  }
}

export function getTerrain(world: World): HTMLCanvasElement {
  const hit = terrainCache.get(world.seed);
  if (hit) return hit;
  const c = makeCanvas(WORLD_W, WORLD_H);
  const g = ctx2d(c);
  const rng = mulberry32(world.seed ^ 0x7e11);

  // Field margins / base.
  g.fillStyle = "#6c6f4c";
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  // Parcels on a rotated lattice.
  const ang = world.parcelAngle;
  g.save();
  g.rotate(ang);
  const diag = Math.hypot(WORLD_W, WORLD_H);
  const jMin = Math.floor(-diag / world.cellH) - 1;
  const jMax = Math.ceil(diag / world.cellH) + 1;
  const iMin = Math.floor(-diag / world.cellW) - 1;
  const iMax = Math.ceil(diag / world.cellW) + 1;
  for (let j = jMin; j <= jMax; j++) {
    const rowOff = (hash2(0, j, world.seed) - 0.5) * world.cellW;
    const v0 = j * world.cellH;
    for (let i = iMin; i <= iMax; i++) {
      const u0 = i * world.cellW - rowOff;
      // Skip parcels whose centre is far outside the world.
      const cu = u0 + world.cellW / 2;
      const cv = v0 + world.cellH / 2;
      const wx = cu * Math.cos(ang) - cv * Math.sin(ang);
      const wy = cu * Math.sin(ang) + cv * Math.cos(ang);
      if (wx < -400 || wy < -400 || wx > WORLD_W + 400 || wy > WORLD_H + 400) continue;
      const { kind } = parcelAt(world, wx, wy);
      const palette = PARCEL_COLORS[kind];
      const inset = 3 + hash2(i, j, world.seed + 5) * 3;
      const x = u0 + inset;
      const y = v0 + inset;
      const w = world.cellW - inset * 2;
      const h = world.cellH - inset * 2;
      g.fillStyle = palette[Math.floor(hash2(i, j, world.seed + 2) * palette.length)];
      g.fillRect(x, y, w, h);

      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      const vertical = hash2(i, j, world.seed + 3) > 0.5;
      if (kind === "orchard") {
        for (let ty = y + 6; ty < y + h; ty += 13) {
          for (let tx = x + 6; tx < x + w; tx += 13) {
            g.fillStyle = "rgba(0,0,0,0.25)";
            g.beginPath();
            g.arc(tx + 2, ty + 2, 4.6, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#2f4a26";
            g.beginPath();
            g.arc(tx, ty, 4.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      } else {
        const spacing = kind === "pale" ? 14 : kind === "grass" ? 11 : 6;
        g.lineWidth = kind === "pale" ? 1 : 2;
        g.strokeStyle = kind === "soil" ? "rgba(40,25,10,0.18)" : "rgba(255,255,230,0.09)";
        g.beginPath();
        hatch(g, x, y, w, h, vertical, 0, spacing);
        g.stroke();
        // Tractor tramlines.
        g.strokeStyle = "rgba(60,50,30,0.22)";
        g.lineWidth = 2;
        g.beginPath();
        hatch(g, x, y, w, h, vertical, 20, 48);
        g.stroke();
      }
      g.restore();

      // Occasional hedgerow along the top edge.
      if (hash2(i, j, world.seed + 4) > 0.62) {
        const hr = mulberry32((i * 7919) ^ (j * 104729) ^ world.seed);
        for (let hx = x; hx < x + w; hx += 9) drawTreeCluster(g, hr, hx, v0, 3, 1);
      }
    }
  }
  g.restore();

  // Riparian vegetation, river, water.
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#4f6238";
  g.lineWidth = world.riverWidth + 34;
  strokePolyline(g, world.river);
  const rr = mulberry32(world.seed ^ 0x21);
  for (let k = 0; k < world.river.length - 1; k++) {
    const [x, y] = world.river[k];
    drawTreeCluster(g, rr, x, y - world.riverWidth / 2 - 10, 26, 5);
    drawTreeCluster(g, rr, x + 40, y + world.riverWidth / 2 + 10, 26, 5);
  }
  g.strokeStyle = "#8a8a6d";
  g.lineWidth = world.riverWidth + 6;
  strokePolyline(g, world.river);
  g.strokeStyle = "#3a555c";
  g.lineWidth = world.riverWidth;
  strokePolyline(g, world.river);
  g.strokeStyle = "#2f4750";
  g.lineWidth = world.riverWidth * 0.55;
  strokePolyline(g, world.river);

  // Roads.
  for (const road of world.roads) {
    g.strokeStyle = "#6f6b61";
    g.lineWidth = road.width + 5;
    strokePolyline(g, road.pts);
    g.strokeStyle = "#a9a497";
    g.lineWidth = road.width;
    strokePolyline(g, road.pts);
    g.strokeStyle = "rgba(240,236,220,0.35)";
    g.lineWidth = 1;
    g.setLineDash([10, 12]);
    strokePolyline(g, road.pts);
    g.setLineDash([]);
  }

  // Village.
  const roofs = ["#9d5842", "#85898d", "#b4ac9f"];
  for (const hse of world.village.houses) {
    g.save();
    g.translate(hse.x, hse.y);
    g.rotate(hse.a);
    g.fillStyle = "rgba(0,0,0,0.38)";
    g.fillRect(-hse.w / 2 + 4, -hse.h / 2 + 4, hse.w, hse.h);
    g.fillStyle = roofs[hse.roof];
    g.fillRect(-hse.w / 2, -hse.h / 2, hse.w, hse.h);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(-hse.w / 2, -hse.h / 2, hse.w, hse.h / 2);
    g.restore();
  }

  // Groves.
  const gr = mulberry32(world.seed ^ 0x9909);
  for (const grove of world.groves) drawTreeCluster(g, gr, grove.x, grove.y, grove.r, Math.round(grove.r / 2.2));

  // Sensor grain.
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
    g.fillRect(rng() * WORLD_W, rng() * WORLD_H, 1 + rng() * 2, 1 + rng() * 2);
  }

  terrainCache.set(world.seed, c);
  return c;
}

// ─────────────────────────────────────────────────────────────── mosaic

interface MosaicCanvasState {
  canvas: HTMLCanvasElement;
  scale: number;
  drawn: number[];
}

const mosaicCache = new Map<string, MosaicCanvasState>();

function toMosaic(sim: Simulation, scale: number, [x, y]: [number, number]): [number, number] {
  return [(x - sim.bounds.x0) * scale, (y - sim.bounds.y0) * scale];
}

function drawFrame(
  g: CanvasRenderingContext2D,
  sim: Simulation,
  terrain: HTMLCanvasElement,
  scale: number,
  frame: number,
) {
  const quad = footprintQuad(sim, frame).map((p) => toMosaic(sim, scale, p));
  const pose = sim.poseOf(frame);
  const [cx, cy] = toMosaic(sim, scale, [pose.x, pose.y]);
  // Accumulated registration drift at this frame (identity for the first frame).
  const drift = sim.driftAt.get(frame) ?? { gScale: 1, gShear: 0 };
  const ds = drift.gScale;
  const sh = drift.gShear;
  const exposure = (hash2(frame, 1, sim.world.seed) - 0.5) * 0.09;

  g.save();
  g.beginPath();
  g.moveTo(quad[0][0], quad[0][1]);
  for (let k = 1; k < 4; k++) g.lineTo(quad[k][0], quad[k][1]);
  g.closePath();
  g.clip();

  g.translate(cx, cy);
  g.transform(ds, 0, sh, ds, 0, 0);
  g.translate(-cx, -cy);
  g.drawImage(terrain, -sim.bounds.x0 * scale, -sim.bounds.y0 * scale, WORLD_W * scale, WORLD_H * scale);
  g.setTransform(1, 0, 0, 1, 0, 0);

  g.fillStyle = exposure > 0 ? `rgba(255,250,235,${exposure})` : `rgba(10,12,20,${-exposure})`;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();

  // Faint seam.
  g.save();
  g.strokeStyle = "rgba(0,0,0,0.16)";
  g.lineWidth = Math.max(0.6, scale);
  g.beginPath();
  g.moveTo(quad[0][0], quad[0][1]);
  for (let k = 1; k < 4; k++) g.lineTo(quad[k][0], quad[k][1]);
  g.closePath();
  g.stroke();
  g.restore();
}

function canvasToUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/**
 * Renders the mosaic with `frames` composited (chain order). Incremental: a
 * canvas that already holds a prefix of `frames` only draws the new ones.
 */
export async function renderMosaic(
  cacheKey: string,
  sim: Simulation,
  frames: number[],
  maxWidth: number,
): Promise<MosaicImage & { latestFootprint: Quad | null }> {
  const bw = sim.bounds.x1 - sim.bounds.x0;
  const bh = sim.bounds.y1 - sim.bounds.y0;
  const scale = Math.min(1, maxWidth / bw);
  const key = `${cacheKey}@${maxWidth}`;
  let st = mosaicCache.get(key);
  const isPrefix = st && st.drawn.length <= frames.length && st.drawn.every((f, i) => frames[i] === f);
  if (!st || !isPrefix) {
    st = { canvas: makeCanvas(bw * scale, bh * scale), scale, drawn: [] };
    mosaicCache.set(key, st);
  }
  const g = ctx2d(st.canvas);
  const terrain = getTerrain(sim.world);
  for (let k = st.drawn.length; k < frames.length; k++) {
    drawFrame(g, sim, terrain, scale, frames[k]);
    st.drawn.push(frames[k]);
  }
  const url = await canvasToUrl(st.canvas);
  const last = frames[frames.length - 1];
  const latestFootprint =
    last === undefined ? null : (footprintQuad(sim, last).map((p) => toMosaic(sim, scale, p)) as Quad);
  return { url, width: st.canvas.width, height: st.canvas.height, latestFootprint };
}

export async function renderThumbnail(sim: Simulation, frame: number, width = 192): Promise<string> {
  const aspect = sim.footprintA / sim.footprintC;
  const c = makeCanvas(width, width / aspect);
  const g = ctx2d(c);
  const pose = sim.poseOf(frame);
  const s = width / sim.footprintA;
  g.translate(c.width / 2, c.height / 2);
  g.scale(s, s);
  g.rotate(-pose.h);
  g.translate(-pose.x, -pose.y);
  g.drawImage(getTerrain(sim.world), 0, 0);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))), "image/jpeg", 0.85),
  );
}
