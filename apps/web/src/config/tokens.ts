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
 *
 * `isImported` marks a token the user added by address. It is never in the
 * manifest, carries no review, and is badged "unverified" wherever it appears.
 */
export type Token = TokenConfig & {isImported?: boolean};

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

/**
 * The one-tap chips above the list. Registry order already leads with what a
 * user reaches for first — native KASH, WKASH, then the manifest's own order —
 * so this is a slice of the same allowlist rather than a second list that could
 * drift away from it.
 */
export const COMMON_TOKENS: Token[] = TOKEN_LIST.slice(0, 5);

/** Manifest tokens flagged as devnet fixtures with an open faucet mint. */
export const DEVNET_MOCK_TOKENS: Token[] = TOKEN_LIST.filter((t) => t.isDevnetMock && t.address);

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

/** Finds a token in `list` by ERC-20 address (case-insensitive). */
export function tokenByAddress(list: Token[], address: string | undefined): Token | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  return list.find((t) => t.address?.toLowerCase() === a);
}

/**
 * Resolves a URL or search identifier — a symbol like `mUSDC` or a 0x address —
 * to a token in `list`. Symbols are matched case-insensitively; `KASH` and
 * `WKASH` stay distinct.
 */
export function resolveToken(list: Token[], id: string | null | undefined): Token | undefined {
  if (!id) return undefined;
  const q = id.trim();
  if (!q) return undefined;
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return tokenByAddress(list, q);
  const s = q.toLowerCase();
  return list.find((t) => t.symbol.toLowerCase() === s);
}

/** Stable identifier for a token in a URL: its symbol when listed, else its address. */
export function tokenParam(token: Token): string {
  if (token.isNative) return token.symbol;
  if (token.isImported && token.address) return token.address;
  return token.symbol;
}
