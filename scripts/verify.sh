#!/usr/bin/env bash
# Verify every deployed contract on Blockscout, then attest the pairs by
# bytecode (the explorer cannot register factory-created contracts — see
# docs/PRODUCTION-READINESS.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
make -C "${ROOT}/packages/contracts" verify-all || true
make -C "${ROOT}/packages/contracts" verify-pairs-local
