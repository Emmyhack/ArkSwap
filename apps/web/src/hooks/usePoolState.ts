'use client';

import type {Address} from 'viem';
import {useReadContracts} from 'wagmi';

import {factoryAbi, pairAbi} from '@/config/abis';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {type Token, routedAddress} from '@/config/tokens';
import {computePairAddress} from '@/lib/amm';
import type {PoolState} from '@/lib/pools';

/**
 * Reads a pool straight from the chain (llm.txt s45).
 *
 * The pair address is derived locally via CREATE2 and cross-checked against
 * `factory.getPair`. If they disagree, PAIR_INIT_CODE_HASH is wrong for this
 * deployment and the hook reports the pool as non-existent rather than quoting
 * against an address that may hold nothing.
 */
export function usePoolState(tokenA: Token | undefined, tokenB: Token | undefined) {
  const a = tokenA ? routedAddress(tokenA) : undefined;
  const b = tokenB ? routedAddress(tokenB) : undefined;
  const enabled = Boolean(a && b && ARKSWAP_FACTORY_ADDRESS && a!.toLowerCase() !== b!.toLowerCase());

  const derived =
    enabled && ARKSWAP_FACTORY_ADDRESS ? computePairAddress(ARKSWAP_FACTORY_ADDRESS, a!, b!) : undefined;

  const query = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          {
            address: ARKSWAP_FACTORY_ADDRESS!,
            abi: factoryAbi,
            functionName: 'getPair',
            args: [a!, b!],
          },
          {address: derived!, abi: pairAbi, functionName: 'getReserves'},
          {address: derived!, abi: pairAbi, functionName: 'token0'},
          {address: derived!, abi: pairAbi, functionName: 'token1'},
          {address: derived!, abi: pairAbi, functionName: 'totalSupply'},
        ]
      : [],
    query: {enabled, refetchInterval: 12_000},
  });

  let pool: PoolState | undefined;
  let derivationMismatch = false;

  const results = query.data;
  if (enabled && derived && results) {
    const registered = results[0]?.result as Address | undefined;
    const reserves = results[1]?.result as readonly [bigint, bigint, number] | undefined;
    const token0 = results[2]?.result as Address | undefined;
    const token1 = results[3]?.result as Address | undefined;
    const totalSupply = results[4]?.result as bigint | undefined;

    const exists = Boolean(registered && registered !== '0x0000000000000000000000000000000000000000');

    if (exists && registered && registered.toLowerCase() !== derived.toLowerCase()) {
      derivationMismatch = true;
    } else if (exists && reserves && token0 && token1 && totalSupply !== undefined) {
      pool = {
        pair: derived,
        token0,
        token1,
        reserve0: reserves[0],
        reserve1: reserves[1],
        totalSupply,
        exists: true,
      };
    }
  }

  return {
    pool,
    derived,
    derivationMismatch,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
