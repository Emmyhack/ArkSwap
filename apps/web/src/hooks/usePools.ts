'use client';

import {useMemo} from 'react';
import type {Address} from 'viem';
import {useReadContract, useReadContracts} from 'wagmi';

import {erc20Abi, factoryAbi, pairAbi} from '@/config/abis';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {tokenByAddress} from '@/config/tokens';
import {type PoolToken, type PricedPool, poolTvl} from '@/lib/valuation';
import {useTokenList} from '@/state/tokens';

export type PoolRow = PricedPool & {
  totalSupply: bigint;
  /** Chain-derived value in STABLE_DECIMALS, or undefined when unpriced. */
  tvl: bigint | undefined;
};

/**
 * Every pair the factory knows, with reserves, resolved tokens and a
 * chain-derived TVL.
 *
 * Reads the chain directly (llm.txt s45): the factory's pair list, then each
 * pair's tokens, reserves and supply in one batch, then symbol/decimals for any
 * token the manifest or the user's imports do not already describe. The
 * analytics API is layered on top by consumers for history it alone can
 * answer; nothing here depends on it.
 */
export function usePools() {
  const tokens = useTokenList();

  const {data: pairCount, isLoading: countLoading} = useReadContract({
    address: ARKSWAP_FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'allPairsLength',
    query: {enabled: Boolean(ARKSWAP_FACTORY_ADDRESS), refetchInterval: 20_000},
  });
  const count = Number((pairCount as bigint | undefined) ?? 0n);

  const {data: addresses, isLoading: addrLoading} = useReadContracts({
    allowFailure: true,
    contracts: Array.from({length: count}, (_, i) => ({
      address: ARKSWAP_FACTORY_ADDRESS!,
      abi: factoryAbi,
      functionName: 'allPairs' as const,
      args: [BigInt(i)],
    })),
    query: {enabled: count > 0},
  });

  const pairAddresses = useMemo(
    () =>
      (addresses ?? []).map((r) => r.result as Address | undefined).filter((a): a is Address => Boolean(a)),
    [addresses],
  );

  const {data: details, isLoading: detailLoading} = useReadContracts({
    allowFailure: true,
    contracts: pairAddresses.flatMap((p) => [
      {address: p, abi: pairAbi, functionName: 'token0' as const},
      {address: p, abi: pairAbi, functionName: 'token1' as const},
      {address: p, abi: pairAbi, functionName: 'getReserves' as const},
      {address: p, abi: pairAbi, functionName: 'totalSupply' as const},
    ]),
    query: {enabled: pairAddresses.length > 0, refetchInterval: 20_000},
  });

  // Token addresses no list describes: read symbol and decimals from the chain.
  const unknown = useMemo(() => {
    const set = new Map<string, Address>();
    if (!details) return [] as Address[];
    pairAddresses.forEach((_, i) => {
      for (const idx of [i * 4, i * 4 + 1]) {
        const a = details[idx]?.result as Address | undefined;
        if (a && !tokenByAddress(tokens, a)) set.set(a.toLowerCase(), a);
      }
    });
    return [...set.values()];
  }, [details, pairAddresses, tokens]);

  const {data: meta} = useReadContracts({
    allowFailure: true,
    contracts: unknown.flatMap((a) => [
      {address: a, abi: erc20Abi, functionName: 'symbol' as const},
      {address: a, abi: erc20Abi, functionName: 'decimals' as const},
      {address: a, abi: erc20Abi, functionName: 'name' as const},
    ]),
    query: {enabled: unknown.length > 0, staleTime: 300_000},
  });

  const pools = useMemo<PoolRow[]>(() => {
    if (!details) return [];

    const resolve = (address: Address | undefined): PoolToken | undefined => {
      if (!address) return undefined;
      const listed = tokenByAddress(tokens, address);
      if (listed?.address) {
        return {
          address: listed.address,
          symbol: listed.symbol,
          name: listed.name,
          decimals: listed.decimals,
          isStable: listed.isStable,
          known: true,
        };
      }
      const i = unknown.findIndex((u) => u.toLowerCase() === address.toLowerCase());
      const symbol = (i >= 0 ? (meta?.[i * 3]?.result as string | undefined) : undefined) ?? shorten(address);
      const decimals = i >= 0 ? (meta?.[i * 3 + 1]?.result as number | undefined) : undefined;
      const name = (i >= 0 ? (meta?.[i * 3 + 2]?.result as string | undefined) : undefined) ?? symbol;
      // Without decimals no amount can be rendered honestly; 18 is the ERC-20
      // default and the row is still marked unknown.
      return {address, symbol, name, decimals: decimals ?? 18, isStable: false, known: false};
    };

    const raw: (PricedPool & {totalSupply: bigint})[] = [];
    pairAddresses.forEach((pair, i) => {
      const t0 = resolve(details[i * 4]?.result as Address | undefined);
      const t1 = resolve(details[i * 4 + 1]?.result as Address | undefined);
      const res = details[i * 4 + 2]?.result as readonly [bigint, bigint, number] | undefined;
      const supply = details[i * 4 + 3]?.result as bigint | undefined;
      if (!t0 || !t1 || !res || supply === undefined) return;
      raw.push({pair, token0: t0, token1: t1, reserve0: res[0], reserve1: res[1], totalSupply: supply});
    });

    return raw.map((p) => ({...p, tvl: poolTvl(raw, p)}));
  }, [details, pairAddresses, tokens, unknown, meta]);

  return {
    pools,
    poolCount: count,
    isLoading: countLoading || (count > 0 && (addrLoading || detailLoading)),
  };
}

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
