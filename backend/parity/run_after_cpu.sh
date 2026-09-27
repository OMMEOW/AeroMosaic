#!/bin/zsh
set -u
cd "$(dirname "$0")/.."
until grep -q "=== ALL DONE" parity/runs/cpu_batch.log; do sleep 20; done
PY=.venv/bin/python; R=parity/runs
run() { local name=$1; shift; echo "=== START $name $(date +%T)"; $PY tools/parity_run.py "$@" --out $R/$name > $R/$name.log 2>&1; echo "=== END $name rc=$? $(date +%T)"; grep '^SUMMARY' $R/$name.log; }
run pkg_mps_road5        --impl package --video road5     --device mps
run pkg_mps_suburban3    --impl package --video suburban3 --device mps
run pkg_cpu_road5        --impl package --video road5     --device cpu
run pkg_mps_road5_fp32   --impl package --video road5     --device mps --kde fp32 --max-attempts 12
run pkg_mps_road5_seed1  --impl package --video road5     --device mps --seed 1 --max-attempts 12
echo "=== PARITY DONE $(date +%T)"
echo "=== START impact $(date +%T)"
"/Users/oma/My Stuff/Major/.venv-uav/bin/python" tools/mps_inv_impact.py parity/impact > parity/impact.log 2>&1
echo "=== END impact rc=$? $(date +%T)"
