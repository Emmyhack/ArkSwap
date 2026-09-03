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
 * Token registry for a chain, derived entirely from its deployment record.
 *
 * Symbols, names, decimals and the stable/mock flags all come from the manifest,
 * so listing a new asset is a deployment concern rather than a code change. That
 * matters for `isStable` in particular: llm.txt s23 forbids inferring stability
 * from symbol text, and a hardcoded allowlist in this file would quietly go
 * stale the moment a new token was deployed.
 */
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

  const listed: TokenConfig[] = Object.entries(d.tokens ?? {}).map(([symbol, t]) => ({
    address: t.address,
    symbol,
    name: t.name,
    decimals: t.decimals,
    isDevnetMock: t.isDevnetMock,
    isStable: t.isStable,
    warning: t.isDevnetMock ? DEVNET_WARNING : undefined,
  }));

  return [KASH, wkash, ...listed];
}

/**
 * Intermediate tokens the UI may route through when two assets have no direct
 * pair. Ordered by preference; falls back to WKASH, which every chain has.
 */
export function routingHubs(chainId: number): TokenConfig[] {
  const d = getDeployment(chainId);
  const registry = tokenRegistry(chainId);
  const names = d?.routingHubs?.length ? d.routingHubs : ['WKASH'];
  return names
    .map((n) => registry.find((t) => t.symbol === n))
    .filter((t): t is TokenConfig => Boolean(t));
}

/** The 0.30% ArkSwap trade fee, in basis points. Pinned by the contracts. */
export const LP_FEE_BPS = 30n;
