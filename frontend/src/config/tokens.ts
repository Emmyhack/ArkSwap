import type {Address} from 'viem';

import {NATIVE_CURRENCY} from './chain';
import {WKASH_ADDRESS} from './contracts';

/**
 * ArkSwap token registry (llm.txt s40).
 *
 * `isDevnetMock` drives a mandatory "no real value" badge in the UI. mUSDC and
 * mUSDT are NOT USD Coin or Tether: they are unrestricted-mint devnet fixtures
 * and must never be presented as real-world stablecoins (llm.txt s15).
 */
export type Token = {
  /** `undefined` marks the native asset, which has no ERC-20 address. */
  address?: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  isDevnetMock?: boolean;
  warning?: string;
};

const DEVNET_WARNING = 'DEVNET TEST TOKEN — NO REAL VALUE';

/**
 * Native KASH. Distinct from WKASH: selecting one must never silently give the
 * other (llm.txt s41).
 */
export const KASH: Token = {
  symbol: NATIVE_CURRENCY.symbol,
  name: 'Ark Constellation',
  decimals: NATIVE_CURRENCY.decimals,
  isNative: true,
};

export const WKASH: Token | undefined = WKASH_ADDRESS
  ? {
      address: WKASH_ADDRESS,
      symbol: 'WKASH',
      name: 'Wrapped KASH',
      decimals: 18,
    }
  : undefined;

/** `value` must be passed as a static `process.env.NEXT_PUBLIC_*` read -- see `chain.ts`. */
function mock(
  value: string | undefined,
  symbol: string,
  name: string,
  decimals: number,
): Token | undefined {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined;
  return {
    address: value as Address,
    symbol,
    name,
    decimals,
    isDevnetMock: true,
    warning: DEVNET_WARNING,
  };
}

export const MUSDC = mock(
  process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS,
  'mUSDC',
  'Mock USD Coin (Ark Devnet)',
  6,
);
export const MUSDT = mock(
  process.env.NEXT_PUBLIC_MOCK_USDT_ADDRESS,
  'mUSDT',
  'Mock Tether USD (Ark Devnet)',
  6,
);

/** Tokens offered in the selector. Native KASH always first. */
export const TOKEN_LIST: Token[] = [KASH, WKASH, MUSDC, MUSDT].filter(
  (t): t is Token => t !== undefined,
);

export function tokenKey(token: Token): string {
  return token.isNative ? 'NATIVE' : (token.address as string).toLowerCase();
}

export function sameToken(a: Token, b: Token): boolean {
  return tokenKey(a) === tokenKey(b);
}

/**
 * The ERC-20 a token routes through on-chain. Native KASH routes as WKASH; every
 * other token routes as itself.
 */
export function routedAddress(token: Token): Address | undefined {
  return token.isNative ? WKASH_ADDRESS : token.address;
}
