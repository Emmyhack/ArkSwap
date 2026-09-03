import type {Address} from 'viem';

import {factoryAbi, pairAbi} from '@/config/abis';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {type Token, routedAddress} from '@/config/tokens';

import {computePairAddress} from './amm';

export type PoolState = {
  pair: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  exists: boolean;
};

/**
 * Reserves oriented to the caller's token order, mirroring
 * `ArkSwapLibrary.getReserves`. Getting this backwards silently inverts every
 * quote, so it is derived from the pair's own sorted `token0`.
 */
export function orientReserves(pool: PoolState, tokenIn: Address): {reserveIn: bigint; reserveOut: bigint} {
  const isToken0 = tokenIn.toLowerCase() === pool.token0.toLowerCase();
  return isToken0
    ? {reserveIn: pool.reserve0, reserveOut: pool.reserve1}
    : {reserveIn: pool.reserve1, reserveOut: pool.reserve0};
}

/**
 * Contract calls to read a pool. Pool discovery reads the chain directly rather
 * than depending on an indexer, so swap execution never hinges on indexer uptime
 * (llm.txt s45).
 */
export function poolReadContracts(tokenA: Token, tokenB: Token) {
  const a = routedAddress(tokenA);
  const b = routedAddress(tokenB);
  if (!a || !b || !ARKSWAP_FACTORY_ADDRESS) return undefined;

  const derived = computePairAddress(ARKSWAP_FACTORY_ADDRESS, a, b);
  return {
    derived,
    contracts: [
      {address: ARKSWAP_FACTORY_ADDRESS, abi: factoryAbi, functionName: 'getPair', args: [a, b]},
      {address: derived, abi: pairAbi, functionName: 'getReserves'},
      {address: derived, abi: pairAbi, functionName: 'token0'},
      {address: derived, abi: pairAbi, functionName: 'totalSupply'},
    ] as const,
  };
}

/** Share of the pool a given LP balance represents, in basis points. */
export function poolShareBps(lpBalance: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return 0n;
  return (lpBalance * 10_000n) / totalSupply;
}
