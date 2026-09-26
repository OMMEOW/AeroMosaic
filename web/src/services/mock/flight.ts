/**
 * Simulated flight + pipeline maths for the mock backend.
 *
 * A lawnmower survey is flown over the procedural world at a varying ground
 * speed. Every native frame gets a pose. SELECT walks the video greedily: from
 * each anchor it probes every candidate gap (f_m = footprint overlap × terrain
 * texture), takes the largest gap whose f_m clears ω, and falls back to the
 * smallest gap ("forced") when none does. MATCH then simulates DKM on the
 * chain, accumulating scale/shear drift. Outputs respond to parameters the way
 * the real system would (higher ω ⇒ more frames; slow footage ⇒ wider gaps).
 */
import type { CandidatePair, MockScenario, PipelineParams, Quad } from "../contract";
import { MIN_INLIER_RATIO } from "../contract";
import { mulberry32, range } from "./prng";
import { getWorld, textureAt, WORLD_H, WORLD_W, type World } from "./world";

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians; the image's long axis is along-track. */
  h: number;
}

interface Footprint {
  pose: Pose;
  halfA: number; // along-track half extent
  halfC: number; // cross-track half extent
}

export interface SimStep {
  step: number;
  fromFrame: number;
  toFrame: number;
  gap: number;
  accepted: boolean;
  inlierRatio: number;
  nMatches: number;
  nInliers: number;
  fmScore: number;
  forced: boolean;
  gScale: number;
  gShear: number;
  psnr: number | null;
  ssim: number | null;
  /** relative cost multiplier (texture/canvas dependent) */
  cost: number;
}

export interface Simulation {
  world: World;
  nativeFrames: number;
  footprintA: number;
  footprintC: number;
  candidates: CandidatePair[];
  probePairs: number;
  forcedSteps: number;
  selected: number[];
  /** Selected frame → f_m of the chosen edge that reached it, and whether it was forced. */
  edgeInto: Map<number, { fm: number; forced: boolean }>;
  steps: SimStep[];
  usedFrames: number[];
  /** Accumulated drift at each composited frame (for rendering). */
  driftAt: Map<number, { gScale: number; gShear: number }>;
  coverage: number;
  fillRatio: number;
  referenceChainBreaks: number;
  terminatedEarly: { atFrame: number; reason: string } | null;
  drift: { gScale: number; gShear: number };
  /** Degraded (low-texture) native frame range, if the scenario has one. */
  degraded: [number, number] | null;
  reference: { x0: number; y0: number; x1: number; y1: number };
  /** Bounding box of composited footprints, world coords (= mosaic canvas extent). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  poseOf(frame: number): Pose;
  /** Ground displacement per frame at `frame`, world px. */
  motionAt(frame: number): number;
}

const LEGS = 4;
const LEG_X0 = 560;
const LEG_X1 = 3040;
const FOOTPRINT_A = 700;

export function simulate(
  seed: number,
  nativeFrames: number,
  aspect: number,
  params: PipelineParams,
  scenario: MockScenario = "success",
): Simulation {
  const world = getWorld(seed);
  const rng = mulberry32(seed);
  const fa = FOOTPRINT_A;
  const fc = FOOTPRINT_A / Math.max(1, Math.min(2.4, aspect));
  const spacing = fc * 0.84;
  const radius = spacing / 2;
  const legLen = LEG_X1 - LEG_X0;
  const y0 = (WORLD_H - spacing * (LEGS - 1)) / 2;
  const turnLen = Math.PI * radius;
  const pathLen = LEGS * legLen + (LEGS - 1) * turnLen;
  const N = Math.max(2, nativeFrames);

  // Ground speed varies (slow ⇒ wide gaps, fast ⇒ tight gaps).
  const phase = range(rng, 0, Math.PI * 2);
  const sArr = new Float64Array(N);
  {
    let acc = 0;
    for (let i = 0; i < N; i++) {
      sArr[i] = acc;
      acc += 1 + 0.45 * Math.sin((i / N) * Math.PI * 2 * 1.7 + phase);
    }
    const total = sArr[N - 1] || 1;
    for (let i = 0; i < N; i++) sArr[i] = (sArr[i] / total) * pathLen;
  }

  function pathAt(sIn: number): Pose {
    let s = Math.max(0, Math.min(pathLen, sIn));
    for (let leg = 0; leg < LEGS; leg++) {
      const dir = leg % 2 === 0 ? 1 : -1;
      const ly = y0 + leg * spacing;
      if (s <= legLen || leg === LEGS - 1) {
        const d = Math.min(s, legLen);
        return { x: dir > 0 ? LEG_X0 + d : LEG_X1 - d, y: ly, h: dir > 0 ? 0 : Math.PI };
      }
      s -= legLen;
      if (s <= turnLen) {
        const a = s / radius;
        const cx = dir > 0 ? LEG_X1 : LEG_X0;
        const cy = ly + radius;
        return dir > 0
          ? { x: cx + Math.sin(a) * radius, y: cy - Math.cos(a) * radius, h: a }
          : { x: cx - Math.sin(a) * radius, y: cy - Math.cos(a) * radius, h: Math.PI - a };
      }
      s -= turnLen;
    }
    return { x: LEG_X0, y: y0, h: 0 };
  }

  const poseCache = new Map<number, Pose>();
  function poseOf(i: number): Pose {
    const hit = poseCache.get(i);
    if (hit) return hit;
    const p = pathAt(sArr[Math.max(0, Math.min(N - 1, i))]);
    p.h += 0.025 * Math.sin(i * 0.013 + phase);
    poseCache.set(i, p);
    return p;
  }
  const motionAt = (i: number) => (i >= N - 1 ? sArr[N - 1] - sArr[N - 2] : sArr[i + 1] - sArr[i]);
  const fp = (i: number): Footprint => ({ pose: poseOf(i), halfA: fa / 2, halfC: fc / 2 });

  // Scenario: a low-texture stretch (glare / motion blur / open water).
  const degraded: [number, number] | null =
    scenario === "diverged"
      ? [Math.round(N * 0.42), Math.round(N * 0.56)]
      : scenario === "truncated"
        ? [Math.round(N * 0.22), N - 1]
        : null;
  const degradeMul = (i: number) => {
    if (!degraded || i < degraded[0] || i > degraded[1]) return 1;
    if (scenario === "truncated") return 0.25;
    return i >= N * 0.47 && i <= N * 0.485 ? 0.36 : 0.55;
  };
  const tex = (i: number) => sampleTexture(world, fp(i)) * degradeMul(i);

  // ── SELECT: greedy walk, probing every candidate gap from each anchor ──
  const gaps = [...new Set(params.candidateGaps.filter((g) => g >= 1))].sort((a, b) => a - b);
  const omega = params.selectionThreshold;
  const candidates: CandidatePair[] = [];
  const selected = [0];
  const edgeInto = new Map<number, { fm: number; forced: boolean }>();
  let forcedSteps = 0;
  let consecutiveForced = 0;
  let terminatedEarly: Simulation["terminatedEarly"] = null;
  let anchor = 0;
  while (anchor < N - 1 && gaps.length) {
    const cands: CandidatePair[] = [];
    const targets = gaps.map((g) => anchor + g).filter((j) => j <= N - 1);
    if (anchor + gaps[gaps.length - 1] > N - 1 && !targets.includes(N - 1)) targets.push(N - 1);
    for (const j of targets) {
      const ov = overlap(fp(anchor), fp(j));
      const noise = (hashNoise(seed, anchor, j) - 0.5) * 0.05;
      const fm = round3(Math.max(0, 0.62 * Math.pow(ov, 1.15) * ((tex(anchor) + tex(j)) / 2) + noise));
      cands.push({ from: anchor, to: j, gap: j - anchor, fm, passed: fm >= omega, chosen: false });
    }
    const passing = cands.filter((c) => c.passed);
    let pickIdx: number;
    let forced = false;
    if (passing.length) {
      const best = passing.reduce((a, b) => (b.gap > a.gap ? b : a));
      pickIdx = cands.indexOf(best);
    } else {
      forced = true;
      forcedSteps++;
      pickIdx = cands.reduce((bi, c, i, arr) => (c.gap < arr[bi].gap ? i : bi), 0);
    }
    cands[pickIdx].chosen = true;
    candidates.push(...cands);
    const next = cands[pickIdx].to;
    edgeInto.set(next, { fm: cands[pickIdx].fm, forced });
    selected.push(next);
    anchor = next;
    consecutiveForced = forced ? consecutiveForced + 1 : 0;
    if (scenario === "truncated" && consecutiveForced >= 4) {
      terminatedEarly = { atFrame: next, reason: `no candidate cleared ω for ${consecutiveForced} consecutive anchors — chain lost` };
      break;
    }
  }

  // ── MATCH: DKM along the chain with accumulated drift ──
  const steps: SimStep[] = [];
  const used = [selected[0]];
  const driftAt = new Map<number, { gScale: number; gShear: number }>([[selected[0], { gScale: 1, gShear: 0 }]]);
  let gS = 1;
  let gSh = 0;
  const K = selected.length - 1;
  for (let k = 1; k <= K; k++) {
    const from = selected[k - 1];
    const to = selected[k];
    const edge = edgeInto.get(to)!;
    const ov = overlap(fp(from), fp(to));
    const t = Math.min(tex(from), tex(to));
    const noise = (hashNoise(seed + 3, from, to) - 0.5) * 0.12;
    const refineBoost = params.denseRefinement ? 0.03 : 0;
    const resPenalty = params.maxWorkingResolution < 1280 ? -0.05 : 0;
    const ratio = round3(clamp(-0.1 + 0.95 * Math.pow(ov, 0.5) * Math.pow(t, 1.2) + noise + refineBoost + resPenalty, 0.02, 0.97));
    const accepted = ratio >= MIN_INLIER_RATIO;
    const nMatches = Math.round((params.denseRefinement ? 10000 : 5000) * (0.95 + 0.05 * hashNoise(seed, to, 5)));

    // Drift: small random walk; rejected/forced steps are held by the weaker probe homography.
    const weak = (accepted ? 1 : 3) * (edge.forced ? 1.6 : 1);
    const dS = ((rng() - 0.5) * 0.005 + 0.0004) * weak;
    const dSh = ((rng() - 0.5) * 0.0016 + 0.0001) * weak;
    gS = gS * (1 + dS);
    gSh = gSh + dSh;
    // Diverged: after the degraded stretch the chain's error compounds and runs away.
    let outS = gS;
    let outSh = gSh;
    if (scenario === "diverged" && degraded && to >= degraded[0]) {
      const p = (to - degraded[0]) / Math.max(1, N - 1 - degraded[0]);
      outS = gS * (1 + 0.34 * Math.pow(p, 2.2));
      outSh = gSh + 0.12 * Math.pow(p, 2.2);
    }

    const gapPenalty = (to - from) / 64;
    steps.push({
      step: k,
      fromFrame: from,
      toFrame: to,
      gap: to - from,
      accepted,
      inlierRatio: ratio,
      nMatches,
      nInliers: Math.round(ratio * nMatches),
      fmScore: edge.fm,
      forced: edge.forced,
      gScale: round5(outS),
      gShear: round5(outSh),
      psnr: accepted ? round2(16 + 13 * ratio + 3 * (1 - gapPenalty) + (hashNoise(seed, to, 21) - 0.5) * 2) : null,
      ssim: accepted ? round3(clamp(0.3 + 0.62 * ratio + (hashNoise(seed, to, 22) - 0.5) * 0.08, 0, 1)) : null,
      // Later steps warp onto a bigger canvas: duration trends upward.
      cost: (0.8 + 0.35 * hashNoise(seed + 9, from, to)) * (1 + 0.55 * (k / Math.max(1, K))),
    });
    if (accepted) {
      used.push(to);
      driftAt.set(to, { gScale: outS, gShear: outSh });
    }
  }
  const last = steps[steps.length - 1];
  const finalDrift = last ? { gScale: last.gScale, gShear: last.gShear } : { gScale: 1, gShear: 0 };

  const reference = {
    x0: LEG_X0 - 80,
    x1: LEG_X1 + 80,
    y0: y0 - fc / 2 + 10,
    y1: y0 + spacing * (LEGS - 1) + fc / 2 - 10,
  };

  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const f of used) {
    for (const [x, y] of quadOf(fp(f))) {
      bounds.x0 = Math.min(bounds.x0, x);
      bounds.y0 = Math.min(bounds.y0, y);
      bounds.x1 = Math.max(bounds.x1, x);
      bounds.y1 = Math.max(bounds.y1, y);
    }
  }
  bounds.x0 = Math.max(0, Math.floor(bounds.x0));
  bounds.y0 = Math.max(0, Math.floor(bounds.y0));
  bounds.x1 = Math.min(WORLD_W, Math.ceil(bounds.x1));
  bounds.y1 = Math.min(WORLD_H, Math.ceil(bounds.y1));

  const usedFps = used.map(fp);
  const misplacement = 1.2 * Math.abs(finalDrift.gScale - 1) + 2 * Math.abs(finalDrift.gShear);
  const coverage = round3(clamp(areaCovered(usedFps, reference) * (1 - misplacement), 0, 1));
  const fillRatio = round3(areaCovered(usedFps, bounds));

  return {
    world,
    nativeFrames: N,
    footprintA: fa,
    footprintC: fc,
    candidates,
    probePairs: candidates.length,
    forcedSteps,
    selected,
    edgeInto,
    steps,
    usedFrames: used,
    driftAt,
    coverage,
    fillRatio,
    referenceChainBreaks: scenario === "ref-breaks" ? 2 : 0,
    terminatedEarly,
    drift: finalDrift,
    degraded,
    reference,
    bounds,
    poseOf,
    motionAt,
  };
}

export function footprintQuad(sim: Simulation, frame: number): Quad {
  return quadOf({ pose: sim.poseOf(frame), halfA: sim.footprintA / 2, halfC: sim.footprintC / 2 });
}

function quadOf(f: Footprint): Quad {
  const c = Math.cos(f.pose.h);
  const s = Math.sin(f.pose.h);
  const corner = (u: number, v: number): [number, number] => [f.pose.x + u * c - v * s, f.pose.y + u * s + v * c];
  return [corner(-f.halfA, -f.halfC), corner(f.halfA, -f.halfC), corner(f.halfA, f.halfC), corner(-f.halfA, f.halfC)];
}

function inside(f: Footprint, x: number, y: number) {
  const dx = x - f.pose.x;
  const dy = y - f.pose.y;
  const c = Math.cos(-f.pose.h);
  const s = Math.sin(-f.pose.h);
  const u = dx * c - dy * s;
  const v = dx * s + dy * c;
  return Math.abs(u) <= f.halfA && Math.abs(v) <= f.halfC;
}

/** Fraction of A's area that lies inside B (grid-sampled). */
function overlap(a: Footprint, b: Footprint) {
  const nu = 10;
  const nv = 6;
  const c = Math.cos(a.pose.h);
  const s = Math.sin(a.pose.h);
  let hit = 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = ((i + 0.5) / nu - 0.5) * 2 * a.halfA;
      const v = ((j + 0.5) / nv - 0.5) * 2 * a.halfC;
      if (inside(b, a.pose.x + u * c - v * s, a.pose.y + u * s + v * c)) hit++;
    }
  }
  return hit / (nu * nv);
}

const texCache = new WeakMap<World, Map<string, number>>();
function sampleTexture(w: World, f: Footprint) {
  let m = texCache.get(w);
  if (!m) texCache.set(w, (m = new Map()));
  const key = `${Math.round(f.pose.x / 8)},${Math.round(f.pose.y / 8)}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  let n = 0;
  const c = Math.cos(f.pose.h);
  const s = Math.sin(f.pose.h);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      const u = ((i + 0.5) / 5 - 0.5) * 2 * f.halfA;
      const v = ((j + 0.5) / 3 - 0.5) * 2 * f.halfC;
      sum += textureAt(w, f.pose.x + u * c - v * s, f.pose.y + u * s + v * c);
      n++;
    }
  }
  const t = sum / n;
  m.set(key, t);
  return t;
}

/** Fraction of `rect` covered by the union of footprints (grid-sampled). */
function areaCovered(fps: Footprint[], rect: { x0: number; y0: number; x1: number; y1: number }) {
  const cell = 12;
  let total = 0;
  let covered = 0;
  for (let y = rect.y0 + cell / 2; y < rect.y1; y += cell) {
    for (let x = rect.x0 + cell / 2; x < rect.x1; x += cell) {
      total++;
      for (const f of fps) {
        if (Math.abs(f.pose.x - x) > f.halfA + f.halfC || Math.abs(f.pose.y - y) > f.halfA + f.halfC) continue;
        if (inside(f, x, y)) {
          covered++;
          break;
        }
      }
    }
  }
  return total ? covered / total : 0;
}

function hashNoise(seed: number, a: number, b: number) {
  let h = (seed * 2654435761) ^ (a * 2246822519) ^ (b * 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round5 = (v: number) => Math.round(v * 100000) / 100000;
