'use client';

import type {Address} from 'viem';
import {useReadContract, useReadContracts} from 'wagmi';

import {factoryAbi, pairAbi} from '@/config/abis';
import {ARKSWAP_FACTORY_ADDRESS, WKASH_ADDRESS} from '@/config/contracts';
import {TOKEN_LIST, type Token} from '@/config/tokens';
import {getAmountOut} from '@/lib/amm';

export type PoolSummary = {
  pair: Address;
  token0?: Token;
  token1?: Token;
  reserve0: bigint;
  reserve1: bigint;
};

function tokenByAddress(address?: Address): Token | undefined {
  if (!address) return undefined;
  return TOKEN_LIST.find((t) => t.address?.toLowerCase() === address.toLowerCase());
}

/**
 * Live protocol figures read straight from the factory and pairs.
 *
 * Everything surfaced on the landing page comes from these reads. Nothing is
 * estimated, extrapolated or hardcoded: with no indexer there is no honest way
 * to show lifetime volume, so the page shows what the chain can actually
 * answer — pool count, reserves currently locked, and live pool prices.
 */
export function useProtocolStats() {
  const {data: pairCount} = useReadContract({
    address: ARKSWAP_FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'allPairsLength',
    query: {enabled: Boolean(ARKSWAP_FACTORY_ADDRESS), refetchInterval: 20_000},
  });

  const count = Number((pairCount as bigint | undefined) ?? 0n);

  const {data: addresses} = useReadContracts({
    allowFailure: true,
    contracts: Array.from({length: count}, (_, i) => ({
      address: ARKSWAP_FACTORY_ADDRESS!,
      abi: factoryAbi,
      functionName: 'allPairs' as const,
      args: [BigInt(i)],
    })),
    query: {enabled: count > 0},
  });

  const pairAddresses = (addresses ?? [])
    .map((r) => r.result as Address | undefined)
    .filter((a): a is Address => Boolean(a));

  const {data: details} = useReadContracts({
    allowFailure: true,
    contracts: pairAddresses.flatMap((p) => [
      {address: p, abi: pairAbi, functionName: 'token0' as const},
      {address: p, abi: pairAbi, functionName: 'token1' as const},
      {address: p, abi: pairAbi, functionName: 'getReserves' as const},
    ]),
    query: {enabled: pairAddresses.length > 0, refetchInterval: 20_000},
  });

  const pools: PoolSummary[] = [];
  if (details) {
    pairAddresses.forEach((pair, i) => {
      const t0 = details[i * 3]?.result as Address | undefined;
      const t1 = details[i * 3 + 1]?.result as Address | undefined;
      const res = details[i * 3 + 2]?.result as readonly [bigint, bigint, number] | undefined;
      if (!res) return;
      pools.push({
        pair,
        token0: tokenByAddress(t0),
        token1: tokenByAddress(t1),
        reserve0: res[0],
        reserve1: res[1],
      });
    });
  }

  // Total WKASH locked across every pool that holds it.
  let kashLocked = 0n;
  let stablesLocked = 0n;
  for (const p of pools) {
    const sides: Array<[Token | undefined, bigint]> = [
      [p.token0, p.reserve0],
      [p.token1, p.reserve1],
    ];
    for (const [token, reserve] of sides) {
      if (!token) continue;
      if (WKASH_ADDRESS && token.address?.toLowerCase() === WKASH_ADDRESS.toLowerCase()) {
        kashLocked += reserve;
      } else if (token.isDevnetMock) {
        stablesLocked += reserve;
      }
    }
  }

  return {pools, poolCount: count, kashLocked, stablesLocked};
}

/**
 * Live mid-price of `token` quoted in `quote`, derived from the pool that holds
 * both. Uses a 1-unit trade through the real fee-adjusted formula, so the number
 * shown is what a small trade would actually execute at — not a fee-free
 * mid-price the user can never get.
 */
export function poolPrice(pools: PoolSummary[], token: Token, quote: Token): bigint | undefined {
  const a = token.isNative ? WKASH_ADDRESS : token.address;
  const b = quote.isNative ? WKASH_ADDRESS : quote.address;
  if (!a || !b) return undefined;

  for (const p of pools) {
    const t0 = p.token0?.address?.toLowerCase();
    const t1 = p.token1?.address?.toLowerCase();
    if (!t0 || !t1) continue;
    const matchForward = t0 === a.toLowerCase() && t1 === b.toLowerCase();
    const matchReverse = t1 === a.toLowerCase() && t0 === b.toLowerCase();
    if (!matchForward && !matchReverse) continue;

    const [reserveIn, reserveOut] = matchForward ? [p.reserve0, p.reserve1] : [p.reserve1, p.reserve0];
    if (reserveIn <= 0n || reserveOut <= 0n) return undefined;
    try {
      return getAmountOut(10n ** BigInt(token.decimals), reserveIn, reserveOut);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
