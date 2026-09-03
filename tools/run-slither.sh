#!/usr/bin/env bash
# Static analysis (llm.txt s23).
#
# ArkSwap spans three compiler versions in one tree, and Slither analyses one
# solc version at a time. Each tree is therefore analysed separately against the
# compiler its pragma pins. Findings must be REVIEWED, not dismissed because the
# code came from Uniswap -- ArkSwap's modifications reduce how directly upstream
# audit history applies (llm.txt s23).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if ! command -v slither >/dev/null 2>&1; then
  echo "slither not installed: pip install slither-analyzer" >&2
  exit 127
fi

status=0
run() {
  local label="$1"; shift
  echo "================================================================"
  echo "  slither: ${label}"
  echo "================================================================"
  "$@" || status=1
  echo
}

run "core (solc 0.5.16)" \
  slither contracts/core --solc-solcs-select 0.5.16 --exclude-dependencies || true
run "periphery (solc 0.6.6)" \
  slither contracts/periphery --solc-solcs-select 0.6.6 --exclude-dependencies || true

exit ${status}
