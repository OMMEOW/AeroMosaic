#!/bin/zsh
set -u
cd "$(dirname "$0")/.."
PY=.venv/bin/python; R=parity/runs
run() { local name=$1; shift; echo "=== START $name $(date +%T)"; $PY tools/parity_run.py "$@" --out $R/$name > $R/$name.log 2>&1; echo "=== END $name rc=$? $(date +%T)"; grep '^SUMMARY' $R/$name.log; }
run nb_cpu_road5      --impl notebook --video road5     --device cpu
run nb_cpu_suburban3  --impl notebook --video suburban3 --device cpu
echo "=== ALL DONE $(date +%T)"
