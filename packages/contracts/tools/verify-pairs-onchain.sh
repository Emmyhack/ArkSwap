#!/usr/bin/env bash
# Attest that every deployed ArkSwapPair really is this repository's ArkSwapPair,
# by comparing on-chain runtime bytecode against the local compiled artifact.
#
# WHY THIS EXISTS
# ---------------
# Blockscout refuses to verify the pairs: the Ark devnet JSON-RPC node exposes no
# trace API (`debug_traceTransaction`, `trace_transaction`, `debug_traceBlockByNumber`
# and `trace_block` all return "does not exist/is not available"), so Blockscout's
# internal-transaction fetcher never sees the factory's CREATE2 call. Without a
# creation record it does not classify the address as a contract and rejects
# verification with "The address is not a smart contract" — server-side, before
# any source is even compared.
#
# That is an explorer/node limitation, not a contract problem. This script gives
# the same assurance the explorer would, and anyone can re-run it independently:
# ArkSwapPair declares no immutables and no constructor arguments, so every pair
# deployed by the factory must carry byte-identical runtime code. If a single
# byte differed, the pair would not be the reviewed contract.
#
# Run `make verify-pairs` instead once the Ark team enables tracing on the node.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

: "${ARK_RPC_URL:?set ARK_RPC_URL (source .env)}"
MANIFEST="../addresses/ark-devnet.json"
ARTIFACT="out/ArkSwapPair.sol/ArkSwapPair.json"

forge build --contracts contracts >/dev/null 2>&1

LOCAL="$(node -e "process.stdout.write(require('./${ARTIFACT}').deployedBytecode.object)")"
LOCAL_HASH="$(cast keccak "${LOCAL}")"

echo "ArkSwapPair runtime bytecode (locally compiled)"
echo "  solc 0.5.16 · optimizer 999999 runs · evmVersion istanbul"
echo "  keccak256: ${LOCAL_HASH}"
echo

PAIRS="$(python3 -c "import json;print(' '.join(json.load(open('${MANIFEST}'))['pairs'].values()))")"
NAMES="$(python3 -c "import json;print(' '.join(json.load(open('${MANIFEST}'))['pairs'].keys()))")"

read -r -a ADDRS <<< "${PAIRS}"
read -r -a LABELS <<< "${NAMES}"

status=0
for i in "${!ADDRS[@]}"; do
  addr="${ADDRS[$i]}"
  label="${LABELS[$i]}"
  onchain="$(cast code "${addr}" --rpc-url "${ARK_RPC_URL}")"

  if [ "${onchain}" = "${LOCAL}" ]; then
    printf '  %-14s %s  MATCH\n' "${label}" "${addr}"
  else
    printf '  %-14s %s  MISMATCH (keccak %s)\n' "${label}" "${addr}" "$(cast keccak "${onchain}")"
    status=1
  fi
done

echo
if [ "${status}" -eq 0 ]; then
  echo "All pairs carry byte-identical runtime code matching the compiled ArkSwapPair."
else
  echo "MISMATCH: at least one pair is not this repository's ArkSwapPair. Do not use it." >&2
fi
exit "${status}"
