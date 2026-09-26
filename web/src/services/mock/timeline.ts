/**
 * Builds the complete, deterministic event timeline for a mock run.
 *
 * A mock run is a pure function of its record (seed, video, params, scenario,
 * createdAt, cancelRequestedAt). The "server state" at any wall-clock time is
 * the fold of every timeline item with `at` ≤ now. That is what lets a run
 * outlive a page refresh: reload, recompute, resume from the same position.
 */
import {
  MIN_INLIER_RATIO,
  STAGE_ORDER,
  type LiveMetrics,
  type MockScenario,
  type PipelineEvent,
  type PipelineParams,
  type RunError,
  type RunMetrics,
  type StageId,
  type StageState,
  type VideoProbe,
} from "../contract";
import { simulate, type Simulation } from "./flight";
import { mulberry32 } from "./prng";

export interface MockRunRecord {
  id: string;
  videoId: string;
  seed: number;
  /** epoch ms */
  createdAt: number;
  video: VideoProbe;
  params: PipelineParams;
  scenario: MockScenario;
  /** Wall-clock compression; 1 = default pacing (~55 s run). */
  speed: number;
  /** epoch ms */
  cancelRequestedAt?: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WireBody = DistributiveOmit<Exclude<PipelineEvent, { type: "run.snapshot" | "mosaic.update" }>, "runId" | "seq" | "ts">;

/** Placeholder for a mosaic.update; the image is rendered lazily when emitted. */
export interface MosaicRenderBody {
  type: "mosaic.render";
  version: number;
  /** Native indices of frames composited so far, in chain order. */
  frames: number[];
  final: boolean;
}

export type TimelineBody = WireBody | MosaicRenderBody;

export interface TimelineItem {
  /** ms after record.createdAt */
  at: number;
  body: TimelineBody;
}

export interface Timeline {
  sim: Simulation;
  items: TimelineItem[];
}

const fmt = (n: number) => n.toLocaleString("en-US");
const f4 = (n: number) => `f${String(n).padStart(4, "0")}`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

const baseCache = new Map<string, Timeline>();

/** Full timeline ignoring cancellation. */
function buildBase(rec: MockRunRecord): Timeline {
  const hit = baseCache.get(rec.id);
  if (hit) return hit;

  const P = rec.params;
  const N = rec.video.frameCount;
  const aspect = rec.video.width / Math.max(1, rec.video.height);
  const sim = simulate(rec.seed, N, aspect, P, rec.scenario);
  const rng = mulberry32(rec.seed ^ 0xabc);
  const sp = Math.max(0.05, rec.speed);
  const d = (ms: number) => Math.round(ms / sp);

  const items: TimelineItem[] = [];
  let t = 0;
  const push = (body: TimelineBody) => items.push({ at: t, body });
  const log = (level: "debug" | "info" | "warn" | "error", stage: StageId | null, message: string) =>
    push({ type: "log", level, stage, message });

  const stageStart: Partial<Record<StageId, number>> = {};
  const stageRuntime = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<StageId, number>;
  const stage = (id: StageId, status: StageState["status"], progress: number | null, counter: StageState["counter"]) => {
    if (status === "active" && stageStart[id] === undefined) stageStart[id] = t;
    if (status === "done") stageRuntime[id] = t - (stageStart[id] ?? t);
    push({ type: "stage.update", stage: id, status, progress, counter });
  };

  // ── durations (planned) ────────────────────────────────────────────────
  const resScale = Math.pow(P.maxWorkingResolution / 1920, 1.2);
  const queueDur = d(450);
  const decodeDur = d(1800 + N * 0.6);
  const probeDur = d(1200 + sim.probePairs * 9);
  const selectDur = d(900);
  const stepDurs = sim.steps.map((s) => d(850 * (P.denseRefinement ? 1.6 : 1) * resScale * s.cost));
  const compositeDur = d(1200 + sim.usedFrames.length * 40);
  const evalDur = d(1400);
  const plannedEnd =
    queueDur + decodeDur + probeDur + selectDur + stepDurs.reduce((a, b) => a + b, 0) + compositeDur + evalDur;

  // ── live metrics bookkeeping ───────────────────────────────────────────
  const m: LiveMetrics = {
    elapsedMs: 0,
    etaMs: null,
    framesDecoded: 0,
    framesSelected: null,
    stepsDone: 0,
    stepsTotal: null,
    stepsAccepted: 0,
  };
  const metrics = () => {
    const elapsed = Math.max(0, t - queueDur);
    // The mock knows the plan; a real server extrapolates. Early estimates are deliberately noisy.
    const remaining = Math.max(0, plannedEnd - t);
    const frac = t / plannedEnd;
    const noise = (rng() - 0.35) * 0.4 * (1 - frac);
    const eta = elapsed < d(1200) ? null : Math.round(remaining * (1 + noise));
    push({ type: "metrics", metrics: { ...m, elapsedMs: elapsed, etaMs: eta } });
  };

  const bounds = sim.bounds;
  const mosaicW = bounds.x1 - bounds.x0;
  const mosaicH = bounds.y1 - bounds.y0;
  const selCount = sim.selected.length;
  const reduction = 1 - selCount / N;
  let mosaicVersion = 0;

  // ── queued → running ───────────────────────────────────────────────────
  push({ type: "run.status", status: "queued" });
  log("info", null, `run ${rec.id} queued · ${rec.video.filename}`);
  t += queueDur;
  push({ type: "run.status", status: "running" });
  log(
    "info",
    null,
    `video ${rec.video.width}×${rec.video.height} @ ${rec.video.fps} fps · ${(rec.video.durationMs / 1000).toFixed(2)} s · ${fmt(N)} frames · ${rec.video.codec}`,
  );
  log(
    "info",
    null,
    `params ω=${P.selectionThreshold} gaps=[${P.candidateGaps.join(",")}] max_res=${P.maxWorkingResolution} refine=${P.denseRefinement ? "on" : "off"}`,
  );
  metrics();

  // ── DECODE ─────────────────────────────────────────────────────────────
  const workW = Math.min(rec.video.width, P.maxWorkingResolution);
  const workH = Math.round((workW / rec.video.width) * rec.video.height);
  stage("decode", "active", 0, { done: 0, total: N, unit: "frames" });
  log("info", "decode", `decoding every frame at native rate → working res ${workW}×${workH}`);
  const decodeTicks = Math.max(6, Math.round(decodeDur / d(160)));
  const failDecodeAt = rec.scenario === "fail-decode" ? Math.floor(decodeTicks * 0.38) : -1;
  for (let k = 1; k <= decodeTicks; k++) {
    t += decodeDur / decodeTicks;
    const done = Math.round((N * k) / decodeTicks);
    if (k === failDecodeAt) {
      const bad = done + 3;
      log("error", "decode", `av_read_frame: invalid NAL unit size (1932 > 1418) at frame ${bad}`);
      log("error", "decode", `decode aborted after ${fmt(done)} frames: stream truncated or corrupt`);
      const error: RunError = {
        code: "decode_corrupt_stream",
        stage: "decode",
        message: `Video stream is corrupt at frame ${bad} (invalid NAL unit). ${fmt(done)} of ${fmt(N)} frames were readable.`,
        hint: `Re-export the clip, or trim it to the readable portion (frames 0–${done}).`,
      };
      push({ type: "run.failed", error });
      return cacheAndReturn(rec, { sim, items });
    }
    m.framesDecoded = done;
    stage("decode", "active", done / N, { done, total: N, unit: "frames" });
    if (k % Math.round(decodeTicks / 4) === 0 && k < decodeTicks) {
      log("debug", "decode", `decoded ${fmt(done)}/${fmt(N)} frames`);
      metrics();
    }
  }
  stage("decode", "done", 1, { done: N, total: N, unit: "frames" });
  log("info", "decode", `decode complete · ${fmt(N)} frames in ${(decodeDur / 1000).toFixed(1)} s`);
  metrics();

  // ── PROBE (greedy walk: every candidate gap from each anchor) ───────────
  const pairs = sim.probePairs;
  stage("probe", "active", 0, { done: 0, total: null, unit: "pairs" });
  log("info", "probe", `SIFT probe at ${Math.round(workW / 2)} px · candidate gaps [${P.candidateGaps.join(",")}] · ω=${P.selectionThreshold}`);
  const probeTicks = Math.max(6, Math.round(probeDur / d(200)));
  const forcedCands = sim.candidates.filter((c) => c.chosen && !c.passed);
  for (let k = 1; k <= probeTicks; k++) {
    t += probeDur / probeTicks;
    const done = Math.round((pairs * k) / probeTicks);
    stage("probe", "active", null, { done, total: null, unit: "pairs" });
    for (const fc of forcedCands) {
      const idx = sim.candidates.indexOf(fc);
      if (idx < done && idx >= Math.round((pairs * (k - 1)) / probeTicks)) {
        log("warn", "probe", `no candidate from ${f4(fc.from)} cleared ω — forced to gap ${fc.gap} (f_m ${fc.fm.toFixed(3)})`);
      }
    }
    if (k % Math.round(probeTicks / 3) === 0 && k < probeTicks) metrics();
  }
  const passed = sim.candidates.filter((c) => c.passed).length;
  stage("probe", "done", 1, { done: pairs, total: pairs, unit: "pairs" });
  log("info", "probe", `probe complete · ${fmt(pairs)} pairs · ${fmt(passed)} ≥ ω (${pct(passed / pairs)}) · ${(probeDur / pairs).toFixed(1)} ms/pair`);
  if (sim.terminatedEarly) log("warn", "probe", `chain lost at ${f4(sim.terminatedEarly.atFrame)}: ${sim.terminatedEarly.reason}`);
  metrics();

  // ── SELECT ─────────────────────────────────────────────────────────────
  stage("select", "active", null, null);
  log("info", "select", `resolving chain from ${fmt(pairs)} probed candidates`);
  t += selectDur;
  const gaps = sim.selected.slice(1).map((f, i) => f - sim.selected[i]);
  m.framesSelected = selCount;
  m.stepsTotal = sim.steps.length;
  push({
    type: "selection.done",
    selection: {
      nativeFrameCount: N,
      selectedFrames: sim.selected,
      probePairs: pairs,
      forcedSteps: sim.forcedSteps,
      omega: P.selectionThreshold,
      candidates: sim.candidates,
    },
  });
  stage("select", "done", 1, { done: selCount, total: N, unit: "frames" });
  log(
    "info",
    "select",
    `selected ${selCount} / ${fmt(N)} frames · ${pct(reduction)} reduction · mean gap ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(1)}`,
  );
  if (sim.forcedSteps > 0) log("warn", "select", `${sim.forcedSteps} forced step(s): footage has unregistrable segments`);
  log("info", "select", `dense matching will run on ${sim.steps.length} pairs instead of ${fmt(N - 1)}`);
  metrics();

  // ── MATCH ──────────────────────────────────────────────────────────────
  const S = sim.steps.length;
  stage("match", "active", 0, { done: 0, total: S, unit: "pairs" });
  log("info", "match", `DKM dense matcher · ${P.denseRefinement ? "with" : "no"} refinement · ${workW}×${workH}`);
  const composited = [sim.selected[0]];
  push({ type: "mosaic.render", version: ++mosaicVersion, frames: composited.slice(), final: false });
  const failStep = rec.scenario === "fail-match" ? Math.max(2, Math.floor(S * 0.45)) : -1;
  for (let i = 0; i < S; i++) {
    const s = sim.steps[i];
    if (i + 1 === failStep) {
      t += stepDurs[i] * 0.4;
      log("error", "match", `torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 1.27 GiB (GPU 0; 7.79 GiB total; 6.31 GiB allocated)`);
      log("error", "match", `DKM failed on ${f4(s.fromFrame)} ↔ ${f4(s.toFrame)} (step ${s.step}/${S})`);
      const suggested = {
        maxWorkingResolution: P.maxWorkingResolution > 1280 ? 1280 : Math.max(640, P.maxWorkingResolution - 320),
        denseRefinement: false,
      };
      push({
        type: "run.failed",
        error: {
          code: "gpu_oom",
          stage: "match",
          message: `CUDA out of memory while dense-matching step ${s.step} (${f4(s.fromFrame)} ↔ ${f4(s.toFrame)}).`,
          hint: `Lower max working resolution to ${suggested.maxWorkingResolution} px${P.denseRefinement ? " and disable dense refinement" : ""}, then re-run.`,
          suggestedParams: suggested,
        },
      });
      return cacheAndReturn(rec, { sim, items });
    }
    t += stepDurs[i];
    m.stepsDone = i + 1;
    if (s.accepted) m.stepsAccepted++;
    push({
      type: "step.result",
      result: {
        step: s.step,
        fromFrame: s.fromFrame,
        toFrame: s.toFrame,
        gap: s.gap,
        accepted: s.accepted,
        inlierRatio: s.inlierRatio,
        nMatches: s.nMatches,
        nInliers: s.nInliers,
        durationMs: stepDurs[i],
        fmScore: s.fmScore,
        omega: P.selectionThreshold,
        forced: s.forced,
        gScale: s.gScale,
        gShear: s.gShear,
        psnr: s.psnr,
        ssim: s.ssim,
        ...(s.accepted
          ? {}
          : {
              rejectReason: `inlier ratio ${s.inlierRatio.toFixed(3)} < ${MIN_INLIER_RATIO.toFixed(2)}${s.forced ? " (forced edge, f_m below ω)" : ""}`,
            }),
      },
    });
    stage("match", "active", (i + 1) / S, { done: i + 1, total: S, unit: "pairs" });
    if (s.accepted) {
      log(
        "info",
        "match",
        `${f4(s.fromFrame)} ↔ ${f4(s.toFrame)}  inliers ${s.inlierRatio.toFixed(3)} (${fmt(s.nInliers)}/${fmt(s.nMatches)})  ${(stepDurs[i] / 1000).toFixed(2)} s  ✓`,
      );
      composited.push(s.toFrame);
      push({ type: "mosaic.render", version: ++mosaicVersion, frames: composited.slice(), final: false });
    } else {
      log(
        "warn",
        "match",
        `${f4(s.fromFrame)} ↔ ${f4(s.toFrame)}  inliers ${s.inlierRatio.toFixed(3)} < ${MIN_INLIER_RATIO}  rejected — chain held by probe homography`,
      );
    }
    if (Math.abs(s.gScale - 1) > 0.1 && Math.abs((sim.steps[i - 1]?.gScale ?? 1) - 1) <= 0.1) {
      log("warn", "match", `accumulated drift exceeds 10%: G_scale ${s.gScale.toFixed(3)} at step ${s.step}`);
    }
    metrics();
  }
  stage("match", "done", 1, { done: S, total: S, unit: "pairs" });
  log("info", "match", `matching complete · ${m.stepsAccepted}/${S} accepted (${pct(m.stepsAccepted / Math.max(1, S))})`);

  // ── COMPOSITE ──────────────────────────────────────────────────────────
  const U = sim.usedFrames.length;
  stage("composite", "active", 0, { done: 0, total: U, unit: "frames" });
  log("info", "composite", `warping ${U} frames onto ${fmt(mosaicW)}×${fmt(mosaicH)} canvas · multi-band blend`);
  const compTicks = 5;
  for (let k = 1; k <= compTicks; k++) {
    t += compositeDur / compTicks;
    const done = Math.round((U * k) / compTicks);
    stage("composite", "active", done / U, { done, total: U, unit: "frames" });
    if (k === compTicks) {
      push({ type: "mosaic.render", version: ++mosaicVersion, frames: sim.usedFrames.slice(), final: true });
    }
  }
  metrics();
  stage("composite", "done", 1, { done: U, total: U, unit: "frames" });
  const mp = (mosaicW * mosaicH) / 1e6;
  log("info", "composite", `mosaic written · ${fmt(mosaicW)}×${fmt(mosaicH)} px · ${mp.toFixed(2)} MP · fill ${pct(sim.fillRatio)}`);

  // ── EVALUATE ───────────────────────────────────────────────────────────
  stage("evaluate", "active", null, null);
  log("info", "evaluate", "registering mosaic to reference orthophoto");
  t += evalDur * 0.6;
  if (sim.referenceChainBreaks > 0) {
    log("warn", "evaluate", `reference chain has ${sim.referenceChainBreaks} break(s) — coverage denominator unreliable`);
  }
  log("info", "evaluate", `ground coverage ${pct(sim.coverage)} of reference area`);
  log(
    "info",
    "evaluate",
    `drift at chain end · G_scale ${sim.drift.gScale.toFixed(4)} · G_shear ${sim.drift.gShear.toFixed(4)}`,
  );
  const accepted = sim.steps.filter((s) => s.accepted);
  const psnrMean = accepted.length ? accepted.reduce((a, s) => a + (s.psnr ?? 0), 0) / accepted.length : 0;
  const ssimMean = accepted.length ? accepted.reduce((a, s) => a + (s.ssim ?? 0), 0) / accepted.length : 0;
  log("debug", "evaluate", `pairwise PSNR ${psnrMean.toFixed(2)} dB · SSIM ${ssimMean.toFixed(3)} over ${accepted.length} accepted steps`);
  t += evalDur * 0.4;
  stage("evaluate", "done", 1, null);
  const runtimeMs = t - queueDur;
  const matchTotal = stepDurs.reduce((a, b) => a + b, 0);
  const final: RunMetrics = {
    groundCoverage: sim.coverage,
    referenceChainBreaks: sim.referenceChainBreaks,
    nativeFrames: N,
    framesSelected: selCount,
    framesUsed: U,
    stepsAttempted: S,
    stepsAccepted: m.stepsAccepted,
    acceptRate: S ? m.stepsAccepted / S : 1,
    drift: sim.drift,
    runtimeMs,
    stageRuntimeMs: stageRuntime,
    probe: { pairs, totalMs: probeDur, msPerPair: probeDur / Math.max(1, pairs) },
    match: { pairs: S, totalMs: matchTotal, msPerPair: matchTotal / Math.max(1, S) },
    forcedSteps: sim.forcedSteps,
    canvas: { width: mosaicW, height: mosaicH, megapixels: Math.round(mp * 100) / 100 },
    fillRatio: sim.fillRatio,
    pairwiseQuality: {
      psnrDb: Math.round(psnrMean * 100) / 100,
      ssim: Math.round(ssimMean * 1000) / 1000,
      stepsMeasured: accepted.length,
    },
    terminatedEarly: sim.terminatedEarly,
  };
  push({ type: "metrics", metrics: { ...m, elapsedMs: runtimeMs, etaMs: 0 } });
  log("info", null, `run complete in ${(runtimeMs / 1000).toFixed(1)} s`);
  push({ type: "run.completed", metrics: final });

  return cacheAndReturn(rec, { sim, items });
}

function cacheAndReturn(rec: MockRunRecord, tl: Timeline) {
  baseCache.set(rec.id, tl);
  return tl;
}

export function forgetTimeline(runId: string) {
  baseCache.delete(runId);
}

/**
 * Timeline with cancellation applied. After a cancel request the run enters
 * `cancelling`, lets the in-flight dense-matching step finish (or aborts a
 * cheap stage almost immediately), then confirms `cancelled`.
 */
export function buildTimeline(rec: MockRunRecord): Timeline {
  const base = buildBase(rec);
  if (rec.cancelRequestedAt === undefined) return base;
  const cancelAt = rec.cancelRequestedAt - rec.createdAt;
  const end = base.items[base.items.length - 1].at;
  if (cancelAt >= end) return base;

  const before = base.items.filter((it) => it.at <= cancelAt);
  const activeStage = [...before].reverse().find((it) => it.body.type === "stage.update")?.body as
    | { stage: StageId; status: string }
    | undefined;
  const inMatch = activeStage?.stage === "match" && activeStage.status === "active";

  const items: TimelineItem[] = [...before];
  items.push({ at: cancelAt, body: { type: "run.status", status: "cancelling" } });
  items.push({
    at: cancelAt,
    body: {
      type: "log",
      level: "warn",
      stage: activeStage?.stage ?? null,
      message: inMatch ? "cancel requested — finishing in-flight dense match" : "cancel requested — stopping",
    },
  });

  let doneAt = cancelAt + Math.round(700 / rec.speed);
  if (inMatch) {
    const nextStep = base.items.find((it) => it.at > cancelAt && it.body.type === "step.result");
    if (nextStep) {
      // The in-flight step's own events (result, progress, log, preview, metrics) all share its `at`.
      for (const it of base.items) if (it.at === nextStep.at) items.push(it);
      doneAt = Math.max(nextStep.at, cancelAt + Math.round(800 / rec.speed)) + Math.round(250 / rec.speed);
    }
  }
  items.push({ at: doneAt, body: { type: "log", level: "warn", stage: null, message: "run cancelled by operator; partial results discarded" } });
  items.push({ at: doneAt, body: { type: "run.cancelled" } });
  return { sim: base.sim, items };
}
