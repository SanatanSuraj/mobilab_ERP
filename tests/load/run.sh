#!/usr/bin/env bash
# Orchestrate the full load-test matrix: 5 scenarios × 3 VU targets.
# Each run writes its summary to results/<scenario>-<vus>.json. The node
# report aggregator reads every file and emits a single table.
#
# Usage:
#   ./run.sh                 # full matrix (10 / 100 / 500 VUs)
#   ./run.sh 10              # single VU level
#   ./run.sh 10 100          # subset
set -euo pipefail

cd "$(dirname "$0")"

if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  TARGETS=(10 100 500)
fi

SCENARIOS=(
  "01-auth-login"
  "02-auth-me"
  "03-crm-leads-list"
  "04-crm-leads-create"
  "05-crm-deals-list"
)

mkdir -p results

total=0
for scenario in "${SCENARIOS[@]}"; do
  for target in "${TARGETS[@]}"; do
    total=$((total + 1))
  done
done

i=0
for scenario in "${SCENARIOS[@]}"; do
  for target in "${TARGETS[@]}"; do
    i=$((i + 1))
    out="results/${scenario}-${target}.json"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "▶ [${i}/${total}] ${scenario} @ ${target} VUs"
    echo "═══════════════════════════════════════════════════════════════"
    LOAD_VUS="${target}" k6 run \
      --summary-export="${out}" \
      --quiet \
      "scenarios/${scenario}.js" || echo "⚠ k6 exited non-zero (thresholds likely breached — run continues)"
  done
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Aggregating results → REPORT.md"
echo "═══════════════════════════════════════════════════════════════"
node scripts/report.mjs
