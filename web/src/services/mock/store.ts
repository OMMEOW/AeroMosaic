/**
 * Persistence for the mock backend (localStorage). Stands in for the server's
 * database so runs and history survive page refreshes.
 */
import { DEFAULT_PARAMS, type VideoAsset, type VideoProbe } from "../contract";
import type { MockRunRecord } from "./timeline";

// v2: contract gained videoId, full metrics and new scenarios; v1 records are discarded.
const RUNS_KEY = "uav-mock/v2/runs";
const VIDEOS_KEY = "uav-mock/v2/videos";

const memory = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key) ?? memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    const raw = memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  }
}

function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* private mode / quota — in-memory copy still works for this session */
  }
}

export function loadRuns(): MockRunRecord[] {
  let runs = read<MockRunRecord[] | null>(RUNS_KEY, null);
  if (!runs) {
    runs = seedHistory();
    write(RUNS_KEY, runs);
  }
  return runs;
}

export function saveRun(rec: MockRunRecord) {
  const runs = loadRuns().filter((r) => r.id !== rec.id);
  runs.push(rec);
  write(RUNS_KEY, runs);
}

export function deleteRunRecord(id: string) {
  write(
    RUNS_KEY,
    loadRuns().filter((r) => r.id !== id),
  );
}

export function loadVideo(id: string): VideoAsset | null {
  return read<Record<string, VideoAsset>>(VIDEOS_KEY, {})[id] ?? null;
}

export function saveVideo(asset: VideoAsset) {
  const all = read<Record<string, VideoAsset>>(VIDEOS_KEY, {});
  all[asset.id] = asset;
  write(VIDEOS_KEY, all);
}

export function newId(prefix: string) {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const DAY = 86_400_000;

function probe(filename: string, width: number, height: number, fps: number, durationS: number, codec = "h264"): VideoProbe {
  return {
    filename,
    sizeBytes: Math.round(durationS * (width * height > 3e6 ? 12.5e6 : 5.2e6)),
    width,
    height,
    fps,
    durationMs: Math.round(durationS * 1000),
    frameCount: Math.round(durationS * fps),
    codec,
  };
}

/** Demo history shown on first launch of the mock backend — covers every terminal state. */
function seedHistory(): MockRunRecord[] {
  const now = Date.now();
  const at = (days: number, hour: number) => {
    const d = new Date(now - days * DAY);
    d.setHours(hour, Math.floor((days * 37) % 60), 0, 0);
    return d.getTime();
  };
  const videos: Record<string, VideoProbe> = {
    "v-dji0042": probe("DJI_0042.MP4", 3840, 2160, 59.94, 34.15),
    "v-north": probe("field_survey_north.MOV", 1920, 1080, 29.97, 62.1, "hevc"),
    "v-river": probe("river_transect_03.mp4", 2720, 1530, 50, 41.0),
    "v-orchard": probe("orchard_pass_B.MP4", 3840, 2160, 59.94, 28.4),
    "v-dji0038": probe("DJI_0038.MP4", 3840, 2160, 59.94, 31.9),
    "v-hedge": probe("hedgerow_loop.mp4", 2704, 1520, 59.94, 36.6),
    "v-glare": probe("lake_edge_glare.MP4", 3840, 2160, 59.94, 34.2),
    "v-dusk": probe("dusk_pass_07.mp4", 1920, 1080, 29.97, 58.0),
  };
  // Register the demo videos so "retry with these settings" can reuse them.
  for (const [id, p] of Object.entries(videos)) {
    saveVideo({ id, probe: p, uploadedAt: new Date(now - 14 * DAY).toISOString(), thumbnailUrl: null, previewUrl: null });
  }
  const run = (
    id: string,
    videoId: string,
    seed: number,
    createdAt: number,
    scenario: MockRunRecord["scenario"],
    params: Partial<MockRunRecord["params"]> = {},
    extra: Partial<MockRunRecord> = {},
  ): MockRunRecord => ({
    id,
    videoId,
    seed,
    createdAt,
    video: videos[videoId],
    params: { ...DEFAULT_PARAMS, ...params },
    scenario,
    speed: 1,
    ...extra,
  });
  return [
    run("r-3fa91c", "v-dji0042", 42, at(1, 16), "success"),
    run("r-5e0b77", "v-dji0042", 42, at(1, 17), "success", { selectionThreshold: 0.2 }),
    run("r-b2047e", "v-north", 777, at(2, 11), "ref-breaks"),
    run("r-81d0a4", "v-river", 31337, at(3, 14), "fail-match", { denseRefinement: true }),
    run("r-d1e90f", "v-glare", 42, at(4, 10), "diverged"),
    run("r-c44e19", "v-orchard", 9001, at(5, 10), "success", { denseRefinement: true }),
    run("r-7a13c2", "v-dusk", 42, at(6, 15), "truncated"),
    run("r-0e7b52", "v-dji0038", 5, at(8, 9), "success", {}, { cancelRequestedAt: at(8, 9) + 24_000 }),
    run("r-2c6d8b", "v-river", 31337, at(9, 12), "fail-decode"),
    run("r-9a6f30", "v-hedge", 123456, at(11, 15), "success", { candidateGaps: [1, 2, 4, 8, 16, 32] }),
  ];
}
