# MPS batched-inverse bug: impact on published results

**Question.** The UMCD sweep and the ω calibration labels were produced on MPS, torch 2.13.0,
with the stock batched `torch.linalg.inv`. That inverse is wrong for batch elements ≥ 1 when
N > ~1024 (see INTEGRATION_NOTES.md). Did the bug change any accept/reject decisions?

**Answer.** Broken and fixed MPS disagree on **1 of 177 pairs (0.6%)**, and that edge sits
on the 0.35 threshold. Re-deriving ω from each arm's labels gives the same threshold every
time: **0.164** for S = min(f_m, f_u), and 0.192 for f_m alone. **The published numbers
stand.** This is a reproducibility note, not a reason to re-run the UMCD sweep or the ω ROC.

Raw data: `parity/impact/` (`pairs.json`, `arm_{broken,fixed,cpu}.json`, `analysis.md`).
Script: `tools/mps_inv_impact.py`. Analysis: `tools/mps_inv_impact_analyze.py`.

## Method

The study uses the exact code path of the published runs: `src/pipeline_b_zhou.DKMMatcher`
with its MPS flush, CPU sampling, non-finite clamp and fp32 chunked KDE, and
`upsample_preds=False`. Each match is then passed to
`dual_layer_geometric_constraint(ps, pd, τs=3.0, τr=4.0)`, and a pair is accepted iff
n_inliers / n_matches ≥ 0.35. The environment is the original one (`Major/.venv-uav`,
torch 2.13.0, Python 3.14.7).

The same pairs run in three arms:

| Arm | Device | Inverse |
|---|---|---|
| broken | MPS | stock batched (what the published runs used) |
| fixed | MPS | fix A, per element, only during `match()` |
| cpu | CPU | stock (correct on CPU) |

Every pair is seeded identically in every arm (torch, numpy and OpenCV with seed 10000+k,
immediately before matching). Each arm runs in its own process.

**Sample: 177 pairs, 6 videos**
- **ω calibration set (121 pairs):** all 121 candidates from
  `results/17_omega_calibration/sample_candidates.json`, with their published labels
  attached. Videos: redroofcity, resort, birdseyecity, southroad. Gaps: 1, 2, 3, 4, 6, 8,
  12, 16.
- **UMCD low-texture (56 pairs):** `Dirt/path18.mp4` and `Dirt/path19.mp4` from
  Videos_Without_Telemetry. Anchors at 10/30/50/70% of each video × gaps 1, 2, 4, 8, 16,
  32, 64. Frames are decoded and resized to 1920 as in `validate_all.decode`, and saved
  losslessly.

Gaps 1/2/4/8/16/32/64 are all covered, as is a low-texture dirt path.

## Result 1: decision flips

| Group | pairs | broken vs fixed | fixed vs CPU | broken vs CPU | median / max \|Δ ratio\| broken−fixed |
|---|---|---|---|---|---|
| **all** | 177 | **1 (0.6%)** | 1 (0.6%) | 2 (1.1%) | 0.003 / 0.084 |
| ω calibration set | 121 | 1 (0.8%) | 1 (0.8%) | 2 (1.7%) | 0.007 / 0.070 |
| UMCD dirt paths | 56 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.000 / 0.084 |
| gap 1 | 45 | 0 | 1 | 1 | 0.002 / 0.042 |
| gap 2 | 28 | 0 | 0 | 0 | 0.002 / 0.043 |
| gap 4 | 20 | 0 | 0 | 0 | 0.002 / 0.036 |
| gap 8 | 20 | 1 | 0 | 1 | 0.001 / 0.050 |
| gap 16 | 18 | 0 | 0 | 0 | 0.001 / 0.015 |
| gap 32 | 8 | 0 | 0 | 0 | 0.001 / 0.017 |
| gap 64 | 8 | 0 | 0 | 0 | 0.004 / 0.084 |
| (gaps 3, 6, 12: calibration only) | 30 | 0 | 0 | 0 | ≤ 0.070 |

Per-video tables are in `parity/impact/analysis.md`. No video has more than one flip.

**The one flip:** birdseyecity, anchor 2, gap 8. The ratio is 0.335 broken, 0.385 fixed and
0.370 on CPU, so the pair goes from rejected (broken) to accepted (fixed and CPU).

To size that flip: road5 edge 201→217 has a threshold-straddling ratio like this one. Across
seeds 0–9 on a single device it was accepted 4/10 times, on both CPU and MPS (PARITY.md §3).
Broken vs fixed flips on 0.6% of pairs; the correct MPS path vs CPU also flips on 0.6%.
The bug's added effect on decisions is therefore about one pair in 177, on an edge that
sampling alone can flip.

Acceptance counts: broken 151/177, fixed 152/177, CPU 153/177. Mean inlier ratio:
0.7133 / 0.7129 / 0.7119.

## Result 2: ω re-derived from each arm's labels

Same 121 candidates, same probe scores, same Youden procedure as
`calibrate_omega_analyze.py`. Only the labels change.

| Labels from | accepted | S = min(f_m, f_u): t*, Youden J | f_m alone: t*, J |
|---|---|---|---|
| published (`labeled_results.json`) | 99/121 | **0.164**, 0.838 | 0.192, 0.833 |
| broken arm (re-run) | 98/121 | **0.164**, 0.798 | 0.192, 0.737 |
| fixed arm (A) | 99/121 | **0.164**, 0.783 | 0.192, 0.778 |
| CPU reference | 100/121 | **0.164**, 0.825 | 0.192, 0.822 |

The threshold is identical in all four label sets, for both score definitions. Youden's J
moves between 0.74 and 0.84 from label noise of 1–3 pairs. The fixed labels do not move J
consistently in one direction relative to the broken ones, so there is no systematic bias
to correct.

(The 0.192 column is what fm_only_select-style selection on f_m alone yields here. The gate
uses 0.164 per the ruling, and this study does not change that.)

## Result 3: the broken arm reproduces the published labels

118/121 decisions match `labeled_results.json`, with a median |Δ inlier ratio| of 0.008
(max 0.086). The published labelling run did not seed torch, so exact equality isn't
expected. This confirms the broken arm is a faithful stand-in for the published runs, and
that the comparison above measures what the bug did to them.

## Why the effect is small

With the MPS flush in place, one DKM match was compared broken vs fixed on 3 pairs
(redroofcity gap 16, birdseyecity gap 16, dirt_path19 gap 2):
- The A→B half of the correspondence field is **bit-identical**.
- The B→A half matches at the median, but is wrong in local regions: up to 0.58 normalised
  coords, with certainty off by up to 0.98. The p99 warp error is 5e-5 to 1.3e-2.

Only the coarse GP embedding uses the bad inverse, and DKM's finer-scale refiners correct
most of it. The wrong regions contribute a small share of the 10,000 sampled matches.
Layer 1 (Sampson, τs=3) and layer 2 (homography, τr=4) then reject most of those matches as
outliers. Net ratio shift: median 0.003.

**This does not hold without the flush.** Without `torch.mps.empty_cache()`, the same bug
drives the field to inf/NaN and DKM crashes. The published runs had the flush, so they were
in the mild regime. That is luck, not design, and it is why the port fixes the inverse
instead of relying on the flush.

## Caveats

- **The UMCD pairs are a stratified sample, not the sweep's own edges.** The UMCD headline
  arm (`fm_0.164`) was not re-run end to end. The sample's dirt-path flip rate is 0/56,
  with a maximum |Δ ratio| of 0.084 (dirt_path19, gap 64; no decision change). A different
  sample could show a flip at a threshold-straddling edge, at about the rate seen here.
- One in-process call of the stock inverse corrupts later MPS results in the same process.
  The first attempt at this study scored 0.000 on a pair that scores 0.569 in a fresh
  process, then crashed with a malloc trap. That attempt is discarded
  (`parity/impact_attempt1_crashed.log`). The re-run isolates the stock-inverse probe and
  each arm in separate processes. As far as can be told from the published scripts, the
  published runs never ran the stock inverse outside DKM's normal flow.
- Seeds differ from the published runs (which were unseeded), so a flip rate below the
  sampling-noise floor can't be resolved.

## Verdict

The flip rate between MPS-broken and MPS-fixed is **0.6% (1/177)**, on a threshold-straddling
edge, and the re-derived ω is unchanged at 0.164. **The published UMCD and ω numbers stand.**
Record it as a reproducibility note: the published labels were produced by an MPS inverse
that was wrong for part of DKM's field, and it did not measurably change the decisions or
the calibrated threshold.
