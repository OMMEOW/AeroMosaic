
### road5

| Stage | notebook reference (Mac, CPU) | package (Mac, MPS, fix A) | Match |
|---|---|---|---|
| Decoded frames | 362 | 362 | yes |
| Reference chain G (max abs diff) | — | — | 0.000e+00 (identical) |
| Reference breaks | 0 | 0 | yes |
| Passing edges | 2098 (min(f_m,f_u)) | 2098 (f_m) | identical sets |
| Package probes re-gated with min(f_m,f_u) | 2098 | 2098 | identical sets → probe stage reproduces exactly |
| Planned path | 14 frames | 14 frames | identical |
| Composited frames | 31 | 32 | DIFFER |
| Absolute coverage | 98.122% | 98.161% | Δ 0.0386 pp |
| DKM attempts / rejected | 51 / 21 | 53 / 22 | |
| Wall clock (s) | 982.4 | 362.8 | |
| Stage times (s) | {'decode': 26.6, 'sift': 84.8, 'probe': 2.9, 'reference': 84.3, 'dkm': 782.6} | {'inverse_selftest_max_rel_err': 6.249407761060866e-06, 'decode': 26.3, 'sift': 84.6, 'probe': 2.9, 'reference': 83.6, 'dkm': 163.2} | |

Per-attempt (aligned by attempt order):

| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |
|---|---|---|---|---|---|
| notebook CPU vs package MPS | 51 / 53 | 14 | 15 | 0.0230 | 1 — #14 201→217 0.358 vs 0.338 |
| notebook CPU vs package CPU (extraction fidelity) | 51 / 51 | 51 | — | 0.0000 | 0 |

Package CPU vs notebook CPU: reference chain max |ΔG| = 0.000e+00; edges identical after re-gating: see above; coverage Δ 0.000000 pp; composited identical: True.


Probe values (f_m, f_u, IoU) per edge: the notebook harness keeps only the passing-edge set, not per-edge values, so values are compared through the edge sets (identical above) rather than number by number.

Cross-configuration measurement (NOT a parity reference — different estimator, gate, decoder, platform):

| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |
|---|---|---|---|---|---|
| CUDA recorded (Windows, GC-RANSAC, min gate) vs package (Mac, MPS, MAGSAC, f_m gate) | 71 / 53 | 19 | 20 | 0.1361 | 1 — #19 217→225 0.256 vs 0.392 |

CUDA recorded: 2097 edges, A_observed {'w': 3096, 'h': 3212, 'px': 5871992}; composited 38, 71 attempts (34 rejected). Package: 2098 edges, 32 composited, 53 attempts (22 rejected).


### suburban3

| Stage | notebook reference (Mac, CPU) | package (Mac, MPS, fix A) | Match |
|---|---|---|---|
| Decoded frames | 1125 | 1125 | yes |
| Reference chain G (max abs diff) | — | — | 0.000e+00 (identical) |
| Reference breaks | 0 | 0 | yes |
| Passing edges | 7744 (min(f_m,f_u)) | 7744 (f_m) | identical sets |
| Package probes re-gated with min(f_m,f_u) | 7744 | 7744 | identical sets → probe stage reproduces exactly |
| Planned path | 20 frames | 20 frames | identical |
| Composited frames | 21 | 22 | DIFFER |
| Absolute coverage | 98.560% | 98.617% | Δ 0.0570 pp |
| DKM attempts / rejected | 21 / 1 | 23 / 2 | |
| Wall clock (s) | 997.1 | 766.0 | |
| Stage times (s) | {'decode': 99.0, 'sift': 280.9, 'probe': 9.2, 'reference': 288.6, 'dkm': 318.0} | {'inverse_selftest_max_rel_err': 6.249407761060866e-06, 'decode': 98.7, 'sift': 283.2, 'probe': 9.6, 'reference': 296.2, 'dkm': 76.1} | |

Per-attempt (aligned by attempt order):

| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |
|---|---|---|---|---|---|
| notebook CPU vs package MPS | 21 / 23 | 21 | — | 0.0774 | 1 — #21 1060→1124 0.367 vs 0.333 |

Probe values (f_m, f_u, IoU) per edge: the notebook harness keeps only the passing-edge set, not per-edge values, so values are compared through the edge sets (identical above) rather than number by number.

Cross-configuration measurement (NOT a parity reference — different estimator, gate, decoder, platform):

| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |
|---|---|---|---|---|---|
| CUDA recorded (Windows, GC-RANSAC, min gate) vs package (Mac, MPS, MAGSAC, f_m gate) | 23 / 23 | 10 | 11 | 0.0854 | 1 — #10 484→548 0.309 vs 0.394 |

CUDA recorded: 7745 edges, A_observed {'w': 3261, 'h': 2146, 'px': 4452899}; composited 22, 23 attempts (2 rejected). Package: 7744 edges, 22 composited, 23 attempts (2 rejected).


### Controls on road5 (first 12 DKM attempts)

| Comparison | attempts a / b | aligned | first divergence | max Δ inlier ratio | decision mismatches |
|---|---|---|---|---|---|
| fp32 KDE vs fp16 KDE (MPS) | 11 / 11 | 11 | — | 0.0411 | 0 |
| seed 1 vs seed 0 (MPS) — sampling noise | 11 / 11 | 11 | — | 0.0255 | 0 |
