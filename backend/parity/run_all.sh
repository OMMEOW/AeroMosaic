#!/bin/zsh
# Parity batch. Each line is one independent run with fresh output dirs.
set -u
cd "$(dirname "$0")/.."
PY=.venv/bin/python
R=parity/runs
run() { local name=$1; shift; echo "=== START $name $(date +%T)"; $PY tools/parity_run.py "$@" --out $R/$name > $R/$name.log 2>&1; echo "=== END $name rc=$? $(date +%T)"; grep '^SUMMARY' $R/$name.log; }
run nb_mps_road5        --impl notebook --video road5     --device mps
run pkg_mps_road5       --impl package  --video road5     --device mps
run nb_mps_suburban3    --impl notebook --video suburban3 --device mps
run pkg_mps_suburban3   --impl package  --video suburban3 --device mps
run pkg_cpu_road5_12    --impl package  --video road5     --device cpu --max-attempts 12
run pkg_mps_road5_fp32  --impl package  --video road5     --device mps --kde fp32 --max-attempts 12
run pkg_mps_road5_seed1 --impl package  --video road5     --device mps --seed 1 --max-attempts 12
echo "=== ALL DONE $(date +%T)"
