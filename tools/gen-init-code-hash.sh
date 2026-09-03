#!/usr/bin/env bash
# Recompute keccak256(type(ArkSwapPair).creationCode) and write it into
# ArkSwapLibrary.PAIR_INIT_CODE_HASH (llm.txt s7).
#
# MUST be re-run after any change to ArkSwapPair bytecode or to the compiler
# settings in foundry.toml. `test/core/InitCodeHash.t.sol` fails the build if
# the committed constant does not match the compiled artifact.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
LIB="contracts/periphery/libraries/ArkSwapLibrary.sol"
ARTIFACT="out/ArkSwapPair.sol/ArkSwapPair.json"

forge build --contracts contracts >/dev/null

CREATION_CODE="$(node -e "process.stdout.write(require('./${ARTIFACT}').bytecode.object)")"
case "${CREATION_CODE}" in
  0x*) ;;
  *) echo "error: unexpected creation code in ${ARTIFACT}" >&2; exit 1 ;;
esac

HASH="$(cast keccak "${CREATION_CODE}")"

OLD="$(grep -Eo '0x[0-9a-fA-F]{64}' "${LIB}" | head -1)"
if [ "${OLD}" = "${HASH}" ]; then
  echo "PAIR_INIT_CODE_HASH already up to date: ${HASH}"
  exit 0
fi

# Replace only the PAIR_INIT_CODE_HASH literal (the first 32-byte literal in the file).
perl -0pi -e "s/0x[0-9a-fA-F]{64}/${HASH}/" "${LIB}"
echo "PAIR_INIT_CODE_HASH: ${OLD} -> ${HASH}"
forge build --contracts contracts >/dev/null
echo "Rebuilt with updated hash."
