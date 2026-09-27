# NB_L2_full_pipeline.ipynb — Step 1 inventory

Read in full (49 cells, ~2,100 source lines) before any code was written.
Recorded run: Windows, Python 3.10.11, torch 2.11.0+cu128, OpenCV 4.13.0,
RTX 4060 Laptop 8.6 GB, **pygcransac available**.

## Cells

| # | Purpose | Defines |
|---|---|---|
| 0 | Markdown: pipeline overview, SLC metric provenance, why HVA dropped | — |
| 2 | Configuration | `PROJECT, DATA, ROOT, PASSA, PASSB, DKM_REPO, SEMSTITCH_REPO, SEMSTITCH_CKPT, SEMSTITCH_ARCH, VAL_SEQS, EVAL_VIDEOS, ALL_VIDEOS, resolve_video()`, all constants below |
| 4 | Env report, RNG seeding (np, cv2), DEVICE, pygcransac probe, **chunked-KDE patch** | `RANDOM_SEED, PREFER_GCRANSAC, NUM_SAMPLE, RANSAC_CONF, RANSAC_ITERS, DEVICE, HAS_GCRANSAC, _kde_chunked()` |
| 6 | Pass A: native decode, resize to MAX_SIDE, PNG per frame | `decode_native()` |
| 7 | SIFT-500 descriptors per frame | `build_descriptors()` |
| 8 | Probe one pair; build all candidate edges | `probe_pair()`, `build_edges()` |
| 9 | Exact DAG path (hops, then Σg²); greedy baseline | `solve_path()`, `select_greedy()` |
| 10 | Reference chain (SIFT-4000, MAGSAC) → `G` per frame, breaks | `build_reference()` |
| 11 | A_observed mask from the reference chain | `observed_area()` |
| 13 | DKM model loader + matcher | `get_model()`, `dkm_match()` |
| 14 | Dual-layer constraint (F / Sampson, then homography) | `_residual_mask()`, `_fit_homography()`, `dual_layer()`, `area_ratio()` |
| 15 | Cost fields | `dense_geo_residual()`, `dense_certainty()`, `photometric_residual()`, `normalise_cost()` |
| 16 | DKM over the selection graph with re-plan on rejection | `run_geometry_replan()` |
| 18 | **Driver**: runs cells 6–16 for every video, with caching | `MANIFESTS, DESC, EDGES, SELECTION, REFERENCE, TRACES, timed()` |
| 19 | Pass A summary table → `passA_all.csv` | — |
| 21 | Re-imports, re-seeds, re-sets DEVICE, `log()` | `RUN_LOG, log()` |
| 22 | Warping, canvas bounds, severity | `canvas_bounds(), warp_frame(), warp_field(), normalise_cost() (dup), warp_severity(), _blank()` |
| 23 | DP seam router, feathering | `_dp_path(), route_seam(), feather_alpha()` |
| 24 | SemanticStitch wrapper (needs OAIV-Coherence repo + ckpt) | `SemanticStitchSeam`, `semantic_soft()` |
| 25 | Biased semantic label, d_sem, hybrid cost | `_new_only_ramp(), semantic_label_biased(), d_sem_from_soft(), hybrid_cost()` |
| 26 | Legacy seam/blend metrics (incl. `fill`) | `owner_seam_mask(), legacy_blend_metrics(), seam_step_metric(), sharpness_and_fill()` |
| 27 | Canvas + composition of seam variants | `Canvas, vname(), compose_variants(), measure()` |
| 29 | Adapter: Pass A trace → composition input | `adapt_trace()` |
| 31 | SLC metric | `seam_pairs(), slc_variant()` |
| 32 | SLC known-answer test (synthetic parallax) | `_scene()` |
| 33 | Compose + score variants in batches | `run_variants()` |
| 35 | Load SemanticStitch | `seam_obj` |
| 37 | Bias selection on MovingDrone, frozen → `frozen_bias.json` (recorded: **0.0**) | `FROZEN, BIAS` |
| 39 | Pass B: 9 variants on eval videos | `EVAL_VARIANTS, EVAL_DF` |
| 41 | Absolute coverage vs A_observed | `coverage_vs_observed(), COV` |
| 43–44 | Results + runtime tables | — |
| 46 | Figures (matplotlib) | — |
| 47 | Paired bootstrap significance test (reads saved Pass B maps) | `slc_per_pair(), step_table(), paired_boot(), verdict()` |
| 48 | Markdown: what it does / does not establish | — |

## Constants as written in the notebook

| Name | Value | Where used |
|---|---|---|
| `MAX_SIDE` | 1920 | decode resize |
| `PROBE_NFEATURES`, `LOWE_RATIO` | 500, 0.80 | probe; `f_m = min(n_put/500, 1)` |
| `PROBE_RANSAC, PROBE_THRESH, PROBE_CONF` | USAC_MAGSAC, **12.0, 0.99** (default maxIters) | probe homography |
| `CANDIDATE_GAPS` | [1,2,4,8,16,32,64] | probe / DAG |
| `OMEGA`, `IOU_TRUST` | 0.164, 0.40 | gate: **`S = min(f_m, f_u)`**, and `S := 0` if IoU < 0.40 |
| `REF_NFEATURES, REF_THRESH, REF_CONF, REF_CANVAS_CAP` | 4000, 3.0, **0.999**, 6000 | reference chain (MAGSAC, default maxIters) |
| `TAU_R, TAU_S, MIN_RATIO` | 4.0, 3.0, 0.35 | dual layer; accept iff refit inlier ratio ≥ 0.35 |
| `RANSAC_CONF, RANSAC_ITERS` | **0.99, 10000** | F (MAGSAC) and H (GC-RANSAC, else MAGSAC) |
| GC-RANSAC | `spatial_coherence_weight=0.975, sampler=0` | layer-2 homography when pygcransac imports |
| `DKM_NUM_SAMPLES`, `UPSAMPLE_PREDS` | 10000, False (set on model and read back) | DKM |
| `NCC_WIN, MIN_STD` | 9, 3.0 | d_phot |
| `RANDOM_SEED` | 0 | np + cv2 seeded; **torch not seeded** |
| Composition | `FEATHER_PX 24, ERODE_PX 0, HOLE_FILL True, CENTRE_BIAS 0, AGE_BIAS 0.5, NEUTRAL_COST 0.5, COST_PCTL 95, COST_SCALE 1.0, SEAM_MAX_SIDE 1024, SEAM_ROI_MARGIN 32, SEAM_MIN_SIDE 176, SEAM_RETRY_LADDER (176,352,704), SEAM_MIN_OVERLAP_PX 50, STEP_OFFSET 3, BLUR_K 5, N_BG_SAMPLES 20000, MAX_CANVAS_MPX 200, COMPOSE_BATCH 3` | Pass B |
| Sweeps / SLC | `BIAS_GRID [0,0.2,0.5,1], HYBRID_W [0,.25,.5,.75,1], BIAS_TIE 0.005, SLC_WIN 15, SLC_THRESH 0.5, SLC_MAX_PTS 400` | selection / Pass B |

## Platform touch points

- **CUDA**: `DEVICE = "cuda" if torch.cuda.is_available() else "cpu"` (cells 4 and 21);
  `torch.cuda.get_device_name/properties` (report only); SemanticStitch `.to(device)`.
  No `.cuda()`, `autocast`, `pin_memory`, `cudnn.*`, or non-blocking copies anywhere.
- **Half precision**: `_kde_chunked` casts to `x.half()` — compute. It **is** active: this DKM
  build does `from dkm.utils.kde import kde` inside `sample()` at call time, so the
  module-level patch takes effect. Cost fields are saved as float16 (storage only).
- **Windows paths**: `PROJECT = Path(r"C:\Major Project\UAV_Mosaicking_Project")`. No drive
  letters elsewhere, no `os.startfile`.
- **MSVC-only deps**: none directly; `pygcransac` is a compiled extension (Windows wheel was
  available; no macOS-arm64/py3.14 wheel exists).

## Inputs and outputs

- Reads: `DATA/MovingDrone/<seq>/video.mp4`, `DATA/own_videos/<name>.{mp4,MP4,mov,MOV}`.
  On this Mac own videos are in `data/videos/`, UMCD in `data/umcd/`.
- Writes (Pass A, per video under `ROOT/passA/<video>/`): `frames/*.png`,
  `frames_manifest.json`, `sift_500.npz`, `edges.npz`, `reference/{chain.npz, observed.npz}`,
  `steps/{corr_*.npz, step_*.npz}`, `trace.json`.
- Writes (Pass B): `ROOT/passB/<video>/{_s4view, <variant>/{mosaic.png, maps.npz}}`, plus CSVs,
  `frozen_bias.json`, `figures/`.

## Entry point

There is **no single per-video function**. One video end to end is the sequence in cell 18
followed by cells 39/41:

`decode_native → build_descriptors → build_edges → solve_path → build_reference →
observed_area → run_geometry_replan → run_variants(EVAL_VARIANTS) → coverage_vs_observed`

The API will call an orchestration function that invokes exactly these, in this order, with no
new logic.

## RANSAC and SIFT call sites, per stage (exact, from the cell sources)

| Stage | Cell / function | Call | Parameters |
|---|---|---|---|
| Probe features | 7 `build_descriptors` | `cv2.SIFT_create(nfeatures=PROBE_NFEATURES)` | **500** — the f_m denominator (`f_m = min(n_put/500, 1)`) |
| Probe matching | 8 `probe_pair` | `BFMatcher(NORM_L2).knnMatch(dB, dA, k=2)` + Lowe | ratio 0.80 |
| Probe homography | 8 `probe_pair` | `cv2.findHomography(src, dst, PROBE_RANSAC, PROBE_THRESH, confidence=PROBE_CONF)` | USAC_MAGSAC, thr **12.0**, conf **0.99**, maxIters = OpenCV default |
| Reference features | 10 `build_reference` | `cv2.SIFT_create(nfeatures=REF_NFEATURES)` | **4000** |
| Reference homography | 10 `build_reference` | `cv2.findHomography(..., cv2.USAC_MAGSAC, REF_THRESH, confidence=REF_CONF)` (needs ≥ 8 matches) | thr **3.0**, conf **0.999**, maxIters = OpenCV default |
| DKM layer 1 | 14 `dual_layer` | `cv2.findFundamentalMat(kB, kA, cv2.USAC_MAGSAC, TAU_S, RANSAC_CONF, RANSAC_ITERS)` | thr **3.0**, conf **0.99**, iters **10000** |
| DKM layer 2 (GC) | 14 `_fit_homography` | `pygcransac.findHomography(corr, h1, w1, h2, w2, probs, threshold=TAU_R, conf=RANSAC_CONF, spatial_coherence_weight=0.975, max_iters=RANSAC_ITERS, sampler=0)` | thr **4.0**, conf **0.99**, iters **10000**; mask recomputed by residual |
| DKM layer 2 (fallback) | 14 `_fit_homography` | `cv2.findHomography(src, dst, cv2.USAC_MAGSAC, TAU_R, confidence=RANSAC_CONF, maxIters=RANSAC_ITERS)` | thr **4.0**, conf **0.99**, iters **10000**; mask recomputed by residual |
| Acceptance | 16 `run_geometry_replan` | `inlier_ratio >= MIN_RATIO` | 0.35 (ratio = residual-inliers / post-epipolar count) |

Correction (2026-09-26): "conf 0.999 / 20,000 iters" and SIFT 4000 in the port brief were
reference-truth bundle values, not pipeline values. The pipeline keeps the table above.

## What `src/fm_only_select.py` computes (reported 2026-09-26)

- **Data**: `results/20_native_gapsweep/edges_{redroofcity,resort,birdseyecity,southroad}.json`
  (every candidate pair on the four evaluation videos; 29,578 edges).
- **Objective**: none is optimised. It builds shortest-path selections with a forced-step
  fallback under two fixed rules — `S = min(f_m, f_u) ≥ 0.164` and `f_m ≥ 0.192` (both with
  IoU ≥ 0.40 for gap > 1) — and prints frame counts, forced steps and shared frames, then the
  same with f_m at 0.164. Output: `results/25_fm_only/selections.json`.
- **0.192 is hard-coded** (`OMEGA_FM = 0.192  # f_m's own Youden optimum from the ablation`);
  no script found computes it.
- **It does re-derive** from the calibration labels: on
  `results/17_omega_calibration/labeled_results.json` (121 DKM-labelled candidates, 99
  accepted / 22 rejected) — the same set that gives 0.164 for `S = min(f_m, f_u)` (J 0.838,
  TP 92, FP 2) — Youden's J on **f_m alone** peaks at **0.192** (J 0.833, TP 87, FP 1).
- On those 121 labels f_u binds on 6 candidates, all with IoU ≈ 0 (failed proxy homography);
  on the 29,578 evaluation-video edges it binds on 0 (IoU ≥ 0.73 on three of four videos).
- The served pipeline uses the ruling: `f_m ≥ 0.164 AND IoU ≥ 0.40`.
