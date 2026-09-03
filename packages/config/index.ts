import {type Address, type Deployment, getDeployment} from '@arkswap/addresses';

/**
 * Shared chain and token configuration.
 *
 * Deliberately free of framework and env-var access:
 *
 *  - No `viem` dependency, so scripts and tooling can import it too.
 *  - No `process.env` reads. Next/webpack only inlines `NEXT_PUBLIC_*` when it
 *    appears as a literal member expression in code it compiles; reading env
 *    inside a workspace package is how the frontend silently lost its entire
 *    configuration once already in this repo. Endpoints stay in the app,
 *    addresses come from @arkswap/addresses, and this package describes the
 *    network.
 */
export type TokenConfig = {
  address?: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  /** Devnet fixture with unrestricted minting and no value (llm.txt s15). */
  isDevnetMock?: boolean;
  /** Explicitly approved USD anchor for analytics pricing (llm.txt s23). */
  isStable?: boolean;
  isWkash?: boolean;
  warning?: string;
};

export type ChainConfig = {
  id: number;
  name: string;
  nativeCurrency: {name: string; symbol: string; decimals: number};
  explorerUrl: string;
};

export const DEVNET_WARNING = 'DEVNET TEST TOKEN — NO REAL VALUE';

/** Native asset of Ark Constellation. Users always see KASH, never ETH (llm.txt s41). */
export const KASH: TokenConfig = {
  symbol: 'KASH',
  name: 'Ark Constellation',
  decimals: 18,
  isNative: true,
};

export function chainConfig(chainId: number): ChainConfig | undefined {
  const d = getDeployment(chainId);
  if (!d) return undefined;
  return {
    id: chainId,
    name: d.network,
    nativeCurrency: {name: d.nativeSymbol, symbol: d.nativeSymbol, decimals: 18},
    explorerUrl: d.explorer,
  };
}

/**
 * Token registry for a chain, derived from its deployment record.
 *
 * `isStable` comes from an explicit allowlist keyed on the deployment's own
 * token map — never inferred from symbol text, which llm.txt s23 forbids because
 * any token can claim to be called "USDC".
 */
const STABLE_KEYS = new Set(['mUSDC', 'mUSDT']);
const DEVNET_MOCK_KEYS = new Set(['mUSDC', 'mUSDT']);
const TOKEN_NAMES: Record<string, string> = {
  mUSDC: 'Mock USD Coin (Ark Devnet)',
  mUSDT: 'Mock Tether USD (Ark Devnet)',
};
const TOKEN_DECIMALS: Record<string, number> = {mUSDC: 6, mUSDT: 6};

export function tokenRegistry(chainId: number): TokenConfig[] {
  const d: Deployment | undefined = getDeployment(chainId);
  if (!d) return [];

  const wkash: TokenConfig = {
    address: d.wkash,
    symbol: 'WKASH',
    name: 'Wrapped KASH',
    decimals: 18,
    isWkash: true,
  };

  const mocks: TokenConfig[] = Object.entries(d.tokens ?? {}).map(([key, address]) => ({
    address,
    symbol: key,
    name: TOKEN_NAMES[key] ?? key,
    decimals: TOKEN_DECIMALS[key] ?? 18,
    isDevnetMock: DEVNET_MOCK_KEYS.has(key),
    isStable: STABLE_KEYS.has(key),
    warning: DEVNET_MOCK_KEYS.has(key) ? DEVNET_WARNING : undefined,
  }));

  return [KASH, wkash, ...mocks];
}

/** The 0.30% ArkSwap trade fee, in basis points. Pinned by the contracts. */
export const LP_FEE_BPS = 30n;
