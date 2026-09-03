#!/usr/bin/env bash
# Seed devnet liquidity. Amounts come from SEED_* in .env (llm.txt s32).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
make -C "${ROOT}/packages/contracts" seed
