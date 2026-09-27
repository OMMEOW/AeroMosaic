## Decision flips

| Group | pairs | broken vs fixed | fixed vs CPU | broken vs CPU | median / max |Δ ratio| broken−fixed |
|---|---|---|---|---|---|
| all | 177 | 1 (0.6%) | 1 (0.6%) | 2 (1.1%) | 0.003 / 0.084 |
| set=omega_calibration | 121 | 1 (0.8%) | 1 (0.8%) | 2 (1.7%) | 0.007 / 0.070 |
| video=redroofcity | 32 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.002 / 0.067 |
| gap=16 | 18 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.001 / 0.015 |
| gap=12 | 5 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.008 / 0.017 |
| gap=8 | 20 | 1 (5.0%) | 0 (0.0%) | 1 (5.0%) | 0.001 / 0.050 |
| gap=6 | 9 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.017 / 0.070 |
| gap=4 | 20 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.002 / 0.036 |
| gap=1 | 45 | 0 (0.0%) | 1 (2.2%) | 1 (2.2%) | 0.002 / 0.042 |
| gap=2 | 28 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.002 / 0.043 |
| gap=3 | 16 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.016 / 0.032 |
| video=resort | 23 | 0 (0.0%) | 1 (4.3%) | 1 (4.3%) | 0.012 / 0.043 |
| video=birdseyecity | 37 | 1 (2.7%) | 0 (0.0%) | 1 (2.7%) | 0.015 / 0.070 |
| video=southroad | 29 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.004 / 0.032 |
| set=umcd | 56 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.000 / 0.084 |
| video=dirt_path18 | 28 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.000 / 0.005 |
| gap=32 | 8 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.001 / 0.017 |
| gap=64 | 8 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.004 / 0.084 |
| video=dirt_path19 | 28 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0.000 / 0.084 |

## Every broken↔fixed flip

| # | set | video | anchor | gap | ratio broken | ratio fixed | ratio CPU | accepted broken→fixed | CPU |
|---|---|---|---|---|---|---|---|---|---|
| 58 | omega_calibration | birdseyecity | 2 | 8 | 0.335 | 0.385 | 0.370 | False→True | True |

## Inlier ratio level, by arm

- broken: mean 0.7133, accepted 151/177
- fixed: mean 0.7129, accepted 152/177
- cpu: mean 0.7119, accepted 153/177

## Reproduction check: broken arm vs the published calibration labels

118/121 decisions match the published labels (labeled_results.json).
median |Δ inlier ratio| broken vs published: 0.0083, max 0.0856

## omega re-derived per arm (same 121 candidates, same Youden procedure as calibrate_omega_analyze.py)

| Labels from | accepted | S = min(f_m, f_u): t*, J | f_m alone: t*, J |
|---|---|---|---|
| published labels | 99/121 | 0.164, 0.8384 | 0.192, 0.8333 |
| broken arm (re-run) | 98/121 | 0.164, 0.7981 | 0.192, 0.7369 |
| fixed arm (A) | 99/121 | 0.164, 0.7828 | 0.192, 0.7778 |
| CPU reference | 100/121 | 0.164, 0.8248 | 0.192, 0.8224 |
