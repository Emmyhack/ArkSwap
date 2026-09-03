import {tokenRegistry, type TokenConfig} from '@arkswap/config';
import type {Address} from 'viem';

import {ARK_CHAIN_ID} from './chain';
import {WKASH_ADDRESS} from './contracts';

/**
 * Token registry for the connected chain, derived from @arkswap/config so the
 * list is not maintained separately from the deployment manifest.
 *
 * `isDevnetMock` drives a mandatory "no real value" badge. mUSDC and mUSDT are
 * NOT USD Coin or Tether: they are unrestricted-mint devnet fixtures and must
 * never be presented as real-world stablecoins (llm.txt s15).
 */
export type Token = TokenConfig;

const REGISTRY = tokenRegistry(ARK_CHAIN_ID);

function bySymbol(symbol: string): Token | undefined {
  return REGISTRY.find((t) => t.symbol === symbol);
}

/** Native KASH. Distinct from WKASH: selecting one must never give the other. */
export const KASH: Token = bySymbol('KASH') ?? {
  symbol: 'KASH',
  name: 'Ark Constellation',
  decimals: 18,
  isNative: true,
};

export const WKASH = bySymbol('WKASH');
export const MUSDC = bySymbol('mUSDC');
export const MUSDT = bySymbol('mUSDT');

/**
 * Tokens offered in the selector: native KASH first, then anything the manifest
 * records an address for. A token with no address on this chain is dropped
 * rather than rendered as a broken entry.
 */
export const TOKEN_LIST: Token[] = REGISTRY.filter((t) => t.isNative || Boolean(t.address));

export function tokenKey(token: Token): string {
  return token.isNative ? 'NATIVE' : (token.address as string).toLowerCase();
}

export function sameToken(a: Token, b: Token): boolean {
  return tokenKey(a) === tokenKey(b);
}

/**
 * The ERC-20 a token routes through on-chain. Native KASH routes as WKASH;
 * every other token routes as itself.
 */
export function routedAddress(token: Token): Address | undefined {
  return token.isNative ? WKASH_ADDRESS : (token.address as Address | undefined);
}
