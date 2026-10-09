import type {Address} from 'viem';

import type {Token} from '@/config/tokens';

/**
 * Chain-derived USD-ish valuation.
 *
 * Only tokens the manifest marks `isStable` count as dollars (llm.txt s23). A
 * token with a pool against a stable is priced at that pool's mid rate; a
 * token with a pool against another priced token is priced through it, one
 * level deep. Anything else is "unpriced", never zero. Values are returned
 * with STABLE_DECIMALS so figures from different tokens can be summed.
 *
 * These numbers are for display only. Nothing on a transaction path reads
 * them, and they are not the indexer's USD figures — those use recorded swap
 * history and appear alongside when the analytics API is reachable.
 */
export const STABLE_DECIMALS = 6;

export type PricedPool = {
  pair: Address;
  token0: PoolToken;
  token1: PoolToken;
  reserve0: bigint;
  reserve1: bigint;
};

export type PoolToken = Pick<Token, 'symbol' | 'decimals' | 'isStable' | 'name'> & {address: Address; known: boolean};

export function rescale(raw: bigint, from: number, to: number): bigint {
  if (from === to) return raw;
  if (from > to) return raw / 10n ** BigInt(from - to);
  return raw * 10n ** BigInt(to - from);
}

/** Mid-price value of `amount` of `token` in a stable, or undefined when unpriced. */
export function valueInStable(pools: PricedPool[], token: PoolToken, amount: bigint, depth = 0): bigint | undefined {
  if (amount === 0n) return 0n;
  if (token.isStable) return rescale(amount, token.decimals, STABLE_DECIMALS);
  if (depth > 1) return undefined;

  let best: bigint | undefined;
  let bestDepth = 0n;
  for (const p of pools) {
    const side = sideOf(p, token.address);
    if (!side) continue;
    const {other, reserveToken, reserveOther} = side;
    if (reserveToken === 0n || reserveOther === 0n) continue;
    // Prefer the deepest priced pool measured in the priced side.
    const otherValue = valueInStable(pools, other, reserveOther, depth + 1);
    if (otherValue === undefined) continue;
    if (best === undefined || otherValue > bestDepth) {
      best = (amount * otherValue) / reserveToken;
      bestDepth = otherValue;
    }
  }
  return best;
}

function sideOf(p: PricedPool, token: Address) {
  const t = token.toLowerCase();
  if (p.token0.address.toLowerCase() === t) {
    return {other: p.token1, reserveToken: p.reserve0, reserveOther: p.reserve1};
  }
  if (p.token1.address.toLowerCase() === t) {
    return {other: p.token0, reserveToken: p.reserve1, reserveOther: p.reserve0};
  }
  return undefined;
}

/**
 * Pool TVL. Both sides priced: their sum. One side priced: twice it, which is
 * exact for a constant-product pool at its own mid price. Neither: unpriced.
 */
export function poolTvl(pools: PricedPool[], p: PricedPool): bigint | undefined {
  const v0 = valueInStable(pools, p.token0, p.reserve0);
  const v1 = valueInStable(pools, p.token1, p.reserve1);
  if (v0 !== undefined && v1 !== undefined) return v0 + v1;
  if (v0 !== undefined) return v0 * 2n;
  if (v1 !== undefined) return v1 * 2n;
  return undefined;
}

/** Formats a STABLE_DECIMALS value as a compact dollar string. */
export function formatUsd(value: bigint | undefined, compact = true): string {
  if (value === undefined) return '—';
  const n = Number(value) / 10 ** STABLE_DECIMALS;
  if (!Number.isFinite(n)) return '—';
  if (compact && n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (compact && n >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}
