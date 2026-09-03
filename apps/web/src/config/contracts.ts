import {PAIR_INIT_CODE_HASH as GENERATED_PAIR_INIT_CODE_HASH} from '@arkswap/abis';
import {getDeployment} from '@arkswap/addresses';
import type {Address} from 'viem';

import {ARK_CHAIN_ID} from './chain';

/**
 * Deployed ArkSwap addresses.
 *
 * Defaults come from the committed deployment manifest in @arkswap/addresses —
 * the single canonical record, so nothing is duplicated by hand. Each address
 * can still be overridden by environment, which is what lets the app be pointed
 * at a local anvil preview stack without editing the manifest.
 *
 * See the note in ./chain.ts about why every env read is written out statically.
 */
function override(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : undefined;
}

const deployment = getDeployment(ARK_CHAIN_ID);

export const WKASH_ADDRESS =
  override(process.env.NEXT_PUBLIC_WKASH_ADDRESS) ?? (deployment?.wkash as Address | undefined);

export const ARKSWAP_FACTORY_ADDRESS =
  override(process.env.NEXT_PUBLIC_ARKSWAP_FACTORY_ADDRESS) ??
  (deployment?.factory as Address | undefined);

export const ARKSWAP_ROUTER_ADDRESS =
  override(process.env.NEXT_PUBLIC_ARKSWAP_ROUTER_ADDRESS) ??
  (deployment?.router02 as Address | undefined);

/**
 * keccak256(type(ArkSwapPair).creationCode), generated from the compiled
 * contracts by scripts/generate-abis.mjs. A stale value would make every
 * derived pair address wrong, so it is never hand-written (llm.txt s7).
 */
export const PAIR_INIT_CODE_HASH = GENERATED_PAIR_INIT_CODE_HASH;

export function contractConfigProblems(): {key: string; hint: string}[] {
  const problems: {key: string; hint: string}[] = [];
  if (!WKASH_ADDRESS) {
    problems.push({key: 'NEXT_PUBLIC_WKASH_ADDRESS', hint: 'Canonical WKASH address for this chain.'});
  }
  if (!ARKSWAP_FACTORY_ADDRESS) {
    problems.push({key: 'NEXT_PUBLIC_ARKSWAP_FACTORY_ADDRESS', hint: 'ArkSwapFactory address.'});
  }
  if (!ARKSWAP_ROUTER_ADDRESS) {
    problems.push({key: 'NEXT_PUBLIC_ARKSWAP_ROUTER_ADDRESS', hint: 'ArkSwapRouter02 address.'});
  }
  return problems;
}
