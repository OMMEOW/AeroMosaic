/**
 * Procedural survey area for the mock backend. One description drives both
 * the rendered terrain (render.ts) and the simulated feature-richness used by
 * the SIFT/DKM models (flight.ts), so low-texture areas you can *see* (river,
 * pale fallow fields) are the ones where matching actually struggles.
 */
import { hash2, mulberry32, pick, range } from "./prng";

export const WORLD_W = 3600;
export const WORLD_H = 1800;

export type ParcelKind = "wheat" | "crop" | "grass" | "soil" | "pale" | "orchard";

export const PARCEL_TEXTURE: Record<ParcelKind, number> = {
  wheat: 0.86,
  crop: 1.0,
  grass: 0.72,
  soil: 0.82,
  pale: 0.5,
  orchard: 1.05,
};

const KINDS: ParcelKind[] = ["wheat", "crop", "crop", "grass", "soil", "pale", "orchard", "wheat", "grass"];

export type Pt = [number, number];

export interface World {
  seed: number;
  parcelAngle: number;
  cellW: number;
  cellH: number;
  river: Pt[];
  riverWidth: number;
  roads: { pts: Pt[]; width: number }[];
  village: { cx: number; cy: number; houses: { x: number; y: number; w: number; h: number; a: number; roof: number }[] };
  groves: { x: number; y: number; r: number }[];
}

const cache = new Map<number, World>();

export function getWorld(seed: number): World {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rng = mulberry32(seed ^ 0x5eed);

  const river: Pt[] = [];
  let ry = range(rng, 650, 1150);
  for (let x = -100; x <= WORLD_W + 100; x += 120) {
    river.push([x, ry]);
    ry += range(rng, -70, 70);
    ry = Math.max(300, Math.min(WORLD_H - 300, ry));
  }

  const roadA: Pt[] = [];
  let ay = range(rng, 250, 450);
  for (let x = -50; x <= WORLD_W + 50; x += 300) {
    roadA.push([x, ay]);
    ay += range(rng, -40, 60);
  }
  const roadB: Pt[] = [];
  let bx = range(rng, 1400, 2400);
  for (let y = -50; y <= WORLD_H + 50; y += 250) {
    roadB.push([bx, y]);
    bx += range(rng, -60, 60);
  }

  const vcx = bx + range(rng, -250, 250);
  const vcy = range(rng, 1250, 1500);
  const houses: World["village"]["houses"] = [];
  for (let i = 0; i < 46; i++) {
    const r = Math.sqrt(rng()) * 230;
    const t = rng() * Math.PI * 2;
    houses.push({
      x: vcx + Math.cos(t) * r,
      y: vcy + Math.sin(t) * r * 0.7,
      w: range(rng, 18, 34),
      h: range(rng, 14, 24),
      a: pick(rng, [0, 0.05, -0.05, 0.4, 1.57]),
      roof: Math.floor(rng() * 3),
    });
  }

  const groves: World["groves"] = [];
  for (let i = 0; i < 26; i++) {
    groves.push({ x: range(rng, 0, WORLD_W), y: range(rng, 0, WORLD_H), r: range(rng, 30, 90) });
  }

  const world: World = {
    seed,
    parcelAngle: range(rng, -0.22, 0.22),
    cellW: range(rng, 200, 270),
    cellH: range(rng, 140, 190),
    river,
    riverWidth: range(rng, 46, 64),
    roads: [
      { pts: roadA, width: 13 },
      { pts: roadB, width: 11 },
    ],
    village: { cx: vcx, cy: vcy, houses },
    groves,
  };
  cache.set(seed, world);
  return world;
}

/** Parcel lattice coordinates for a world point. */
export function parcelAt(w: World, x: number, y: number): { i: number; j: number; kind: ParcelKind } {
  const c = Math.cos(-w.parcelAngle);
  const s = Math.sin(-w.parcelAngle);
  const u = x * c - y * s;
  const v = x * s + y * c;
  const j = Math.floor(v / w.cellH);
  // Offset alternate rows so parcels don't form a perfect grid.
  const i = Math.floor(u / w.cellW + (hash2(0, j, w.seed) - 0.5));
  const kind = KINDS[Math.floor(hash2(i, j, w.seed + 1) * KINDS.length)];
  return { i, j, kind };
}

function distToPolyline(pts: Pt[], x: number, y: number) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[k + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** Feature richness at a point, ~0.3 (water) .. ~1.05 (orchard). */
export function textureAt(w: World, x: number, y: number) {
  if (distToPolyline(w.river, x, y) < w.riverWidth / 2 + 12) return 0.3;
  if (Math.hypot(x - w.village.cx, (y - w.village.cy) / 0.7) < 240) return 1.1;
  const { kind } = parcelAt(w, x, y);
  const n = hash2(Math.floor(x / 90), Math.floor(y / 90), w.seed + 7);
  return PARCEL_TEXTURE[kind] * (0.9 + 0.2 * n);
}
