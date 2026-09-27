# PARITY — NB_L2 on Apple Silicon (MPS)

Acceptance criterion: functional parity with `NB_L2_full_pipeline.ipynb`.
Generated tables: `parity/compare.md` (from `tools/parity_compare.py`). Raw runs: `parity/runs/`.

## What the reference is

**Reference = the original notebook's own cells, executed unmodified on CPU on this Mac**
(`tools/parity_run.py --impl notebook --device cpu`, torch 2.13.0, OpenCV 4.13.0, Python 3.14.7).
Same machine, same decoder, same OpenCV, so any difference is attributable to the port or
to the device.

**The recorded CUDA outputs are NOT a parity reference.** Their configuration was checked
before use (from the cell 18 stream output, `parity/cuda_recorded.json`):

| | CUDA recorded run | This port |
|---|---|---|
| Platform | Windows, torch 2.11.0+cu128, RTX 4060, OpenCV 4.13.0 | macOS arm64, torch 2.13.0 MPS, OpenCV 4.13.0 |
| Homography estimator | **GC-RANSAC** (pygcransac present) | **MAGSAC** (notebook's own fallback; no pygcransac wheel for macOS arm64 / py3.14) |
| Gate | S = min(f_m, f_u) ≥ 0.164, IoU ≥ 0.40 | **f_m ≥ 0.164**, IoU ≥ 0.40 (ruling 2026-09-26) |
| RANSAC params | notebook values | notebook values |
| KDE | chunked fp16 (active) | chunked fp16 (kept) |
| torch seeded | no (not reproducible even on CUDA) | yes |
| Decoder | OpenCV VideoCapture, Windows backend (version not recorded) | OpenCV FFMPEG backend, avcodec 61.19.101 / avformat 61.7.100 / swscale 8.3.100, KleidiCV 0.7.0 HAL |

Estimator, gate and decoder all differ, so the CUDA comparison below is a cross-configuration
observation only.

**MPS uses MAGSAC where CUDA used GC-RANSAC.** Every manifest records the estimator.

## Results

### 1. Extraction fidelity — package vs notebook, both on CPU (road5)

| | notebook | package |
|---|---|---|
| DKM attempts / rejected | 51 / 21 | 51 / 21 |
| Per-attempt inlier ratios | — | **all 51 identical (max Δ 0.0000)**, 0 decision mismatches |
| Reference chain G | — | max abs diff 0.0 |
| Passing edges | 2098 | 2098, identical sets |
| Composited frames | 31 | 31, identical |
| Absolute coverage | 98.1225% | 98.1225% (Δ 0.000000 pp) |

The generated package is the notebook. Every difference below is the device.

### 2. Package on MPS (fix A) vs notebook reference on CPU

| Stage | road5 | suburban3 |
|---|---|---|
| Decoded frames | 362 = 362 | 1125 = 1125 |
| Reference chain G | bit-identical, 0 breaks | bit-identical, 0 breaks |
| Passing edges | 2098 = 2098, identical sets | 7744 = 7744, identical sets |
| Package probes re-gated with min(f_m,f_u) | identical to notebook set | identical to notebook set |
| Planned path | 14 frames, identical | 20 frames, identical |
| DKM attempts aligned before first divergence | 14 of 51 (max Δ inlier 0.023) | 21 of 21 (max Δ inlier 0.077) |
| Decision mismatches in aligned span | 1: #14 201→217, CPU 0.358 vs MPS 0.338 | 1: #21 1060→1124, CPU 0.367 vs MPS 0.333 |
| DKM attempts / rejected | 51/21 → 53/22 | 21/1 → 23/2 |
| Composited frames | 31 → 32 | 21 → 22 |
| Absolute coverage | 98.122% → 98.161% (Δ +0.039 pp) | 98.560% → 98.617% (Δ +0.057 pp) |

On both videos, the gate on f_m alone produced exactly the same edge set as min(f_m, f_u).
The gate change is therefore inert on these videos.

Both decision mismatches are single edges whose inlier ratio sits within 0.02 of the 0.35
threshold. After a mismatch, re-planning follows a different path, so later attempts are not
comparable one to one. That is why the tables stop aligning after one flip.

### 3. Is the MPS-vs-CPU mismatch device error or DKM sampling noise?

DKM draws its correspondences with `torch.multinomial`. CPU and MPS use different RNG
streams, so the same seed does not give the same sample on the two devices.

Controls on road5 (MPS, first 11 attempts, same path):

| Control | max Δ inlier ratio | decision mismatches |
|---|---|---|
| seed 1 vs seed 0 (sampling noise alone) | 0.0255 | 0 |
| fp32 KDE vs fp16 KDE | 0.0411 | 0 |
| (for comparison) CPU vs MPS, same seed | 0.0230 | 1 (at 0.358 vs 0.338) |

The CPU-vs-MPS spread (0.023) is no larger than seed-to-seed spread on one device
(0.026). The fp16 KDE cast moves ratios by up to 0.04 without changing any decision in
this span; it is kept because the notebook (and the CUDA run) used it.

Per-pair distribution, seeds 0–9, same frames (`tools/pair_noise.py`, `parity/pair_noise_{cpu,mps}.json`):

| Pair (road5) | CPU mean ± sd [min, max] | accepted | MPS mean ± sd [min, max] | accepted |
|---|---|---|---|---|
| 201→217 (the flipped edge) | 0.341 ± 0.012 [0.325, 0.356] | 4/10 | 0.343 ± 0.014 [0.319, 0.359] | 4/10 |
| 137→153 | 0.451 ± 0.005 [0.443, 0.459] | 10/10 | 0.447 ± 0.010 [0.430, 0.461] | 10/10 |
| 41→73 | 0.892 ± 0.003 [0.890, 0.899] | 10/10 | 0.894 ± 0.003 [0.890, 0.898] | 10/10 |

The CPU and MPS distributions agree. On 201→217 the threshold falls inside the sampling
distribution on both devices: it is accepted 4/10 times on each. The single decision
mismatch in section 2 is therefore a coin-flip edge, not a device error. The notebook
has always had this property; it was just not visible while torch was unseeded.

### 4. Cross-configuration: CUDA recorded vs this port (not parity)

| | road5 | suburban3 |
|---|---|---|
| Edges | 2097 vs 2098 | 7745 vs 7744 |
| A_observed | 3096×3212 = 5,871,992 px vs 3152×3226 = 5,921,936 px | 3261×2146 = 4,452,899 px (CUDA) |
| Attempts aligned | 19 (max Δ 0.136) | 10 (max Δ 0.085) |
| First decision mismatch | #19 217→225: 0.256 vs 0.392 | #10 484→548: 0.309 vs 0.394 |
| Attempts / rejected | 71/34 vs 53/22 | 23/2 vs 23/2 |
| Composited | 38 vs 32 | 22 vs 22 |

**A_observed platform note.** road5's observed area is 5,921,936 px on this Mac on both
CPU and MPS. The recorded Windows value is 5,871,992 px (+0.85% on the Mac). The reference
chain is computed from SIFT-4000 features on decoded frames. The Mac decodes with the FFMPEG
backend (avcodec 61.19.101) and runs OpenCV through the KleidiCV 0.7.0 HAL. The Windows
decoder and HAL versions were not recorded. The one-edge difference in the probe set
(2097 vs 2098) is consistent with slightly different decoded pixels. This is a
decoder/platform difference. It is recorded here and has not been reconciled: the canvas and
the denominator were deliberately left alone.

The larger per-attempt deltas against CUDA (up to 0.14) combine GC-RANSAC vs MAGSAC, the
decoder, unseeded torch and the gate change. The package does not attempt to separate them.
The estimator decision stands.

## MPS-specific correctness issue fixed during the port

torch 2.13.0 on MPS gives wrong results for batched `torch.linalg.inv` when the batch has
more than one element and N > ~1024. DKM's GP layer hits this at b=2, N=1530. It is fixed
with per-element inverses (fix A), and a startup self-test refuses to run DKM if the
inverse is wrong (run value: 6.25e-6 relative error). Details are in INTEGRATION_NOTES.md.
Its effect on the published results is in MPS_INV_IMPACT.md.
MPS runs made before the fix are quarantined in `parity/invalid_mps_batched_inv/` and are
not used here.

## Wall clock (Mac, M-series)

| | notebook CPU | package MPS | package CPU |
|---|---|---|---|
| road5 total | 982 s | 363 s | 956 s |
| road5 DKM stage | 783 s | 163 s | — |
| suburban3 total | 997 s | 766 s | — |
| suburban3 DKM stage | 318 s | 76 s | — |

DKM on MPS is about 4.5× faster than on CPU. Decode, SIFT and the reference chain run on CPU
in both and are unchanged.

## Verdict

The port has functional parity with the notebook:
- On CPU it is identical to the notebook.
- On MPS every deterministic stage is identical: decode, probes, gate, edge set, path and
  reference chain.
- DKM accept/reject decisions differ only on edges within 0.02 of the 0.35 threshold, at a
  rate no higher than seed-to-seed sampling noise. The flipped road5 edge is accepted on
  4/10 seeds on both CPU and MPS.
- End coverage differs by < 0.06 pp.
