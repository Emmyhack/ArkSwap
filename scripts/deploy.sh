#!/usr/bin/env bash
# Thin wrapper so deployment is reachable from the repo root. The real logic
# lives in packages/contracts/Makefile — this does not duplicate it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../packages/contracts"
echo "ArkSwap deployment runs in strict order (llm.txt s26). Available targets:"
make help | /usr/bin/grep -E "deploy|gate|create-pairs|seed|smoke" || true
echo
echo "Run them individually, e.g.:  make -C packages/contracts deploy-factory"
