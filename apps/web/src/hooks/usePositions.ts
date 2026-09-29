'use client';

import {useMemo} from 'react';
import {useAccount, useReadContracts} from 'wagmi';

import {pairAbi} from '@/config/abis';
import {valueInStable} from '@/lib/valuation';

import {type PoolRow, usePools} from './usePools';

export type Position = PoolRow & {
  lpBalance: bigint;
  shareBps: bigint;
  amount0: bigint;
  amount1: bigint;
  /** Chain-derived value in STABLE_DECIMALS, or undefined when unpriced. */
  value: bigint | undefined;
};

/**
 * The connected wallet's LP positions across every pool.
 *
 * LP balances come from the chain, never from the analytics API: llm.txt s36
 * is explicit that backend position data must not authorise a transaction, and
 * this list is what the removal form is pointed at.
 */
export function usePositions() {
  const {address} = useAccount();
  const {pools, isLoading: poolsLoading} = usePools();

  const {data: balances, isLoading: balLoading} = useReadContracts({
    allowFailure: true,
    contracts: pools.map((p) => ({
      address: p.pair,
      abi: pairAbi,
      functionName: 'balanceOf' as const,
      args: [address!],
    })),
    query: {enabled: Boolean(address) && pools.length > 0, refetchInterval: 15_000},
  });

  const positions = useMemo<Position[]>(() => {
    if (!address || !balances) return [];
    const out: Position[] = [];
    pools.forEach((p, i) => {
      const lp = balances[i]?.result as bigint | undefined;
      if (!lp || lp === 0n || p.totalSupply === 0n) return;
      const amount0 = (lp * p.reserve0) / p.totalSupply;
      const amount1 = (lp * p.reserve1) / p.totalSupply;
      const v0 = valueInStable(pools, p.token0, amount0);
      const v1 = valueInStable(pools, p.token1, amount1);
      const value =
        v0 !== undefined && v1 !== undefined ? v0 + v1 : v0 !== undefined ? v0 * 2n : v1 !== undefined ? v1 * 2n : undefined;
      out.push({...p, lpBalance: lp, shareBps: (lp * 10_000n) / p.totalSupply, amount0, amount1, value});
    });
    return out.sort((a, b) => (b.value ?? 0n) > (a.value ?? 0n) ? 1 : -1);
  }, [address, balances, pools]);

  return {
    positions,
    isLoading: Boolean(address) && (poolsLoading || (pools.length > 0 && balLoading)),
    connected: Boolean(address),
  };
}
