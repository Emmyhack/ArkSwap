'use client';

import {routingHubs} from '@arkswap/config';
import {type Address} from 'viem';
import {useReadContracts} from 'wagmi';

import {pairAbi} from '@/config/abis';
import {ARK_CHAIN_ID} from '@/config/chain';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {type Token, routedAddress, sameToken} from '@/config/tokens';
import {computePairAddress, getAmountOut} from '@/lib/amm';

type Hop = {pair: Address; tokenIn: Address; tokenOut: Address};

export type SwapRoute = {
  /** Token path passed straight to the Router (2 addresses direct, 3 via a hub). */
  path: Address[];
  /** Human-readable symbols for display, e.g. ["mWETH","mUSDC","mLINK"]. */
  symbols: string[];
  amountOut: bigint;
  /** Basis points of execution shortfall against the mid price, across all hops. */
  impactBps: bigint;
};

type PoolReserves = {token0: Address; reserve0: bigint; reserve1: bigint};

/**
 * Finds the best route between two tokens.
 *
 * ArkSwap V1 has no on-chain router/quoter contract, so the frontend decides the
 * path. It considers the direct pair first, then one hop through each configured
 * routing hub, and keeps whichever actually returns the most output — that is
 * the only comparison that matters to the user, and a direct pair is not always
 * the best one when it is thin.
 *
 * Route search is bounded to a single intermediate hop on purpose. Longer paths
 * cost more gas, compound price impact, and would need cycle detection; llm.txt
 * s60 puts advanced routing after the V1 foundation is stable.
 *
 * The quote produced here is a DISPLAY ESTIMATE. Execution is bounded on-chain
 * by amountOutMin, so a stale route costs gas at worst, never funds beyond the
 * user's slippage tolerance (llm.txt s42).
 */
export function useSwapRoute(tokenIn: Token, tokenOut: Token, amountIn: bigint | null) {
  const inAddr = routedAddress(tokenIn);
  const outAddr = routedAddress(tokenOut);
  const hubs = routingHubs(ARK_CHAIN_ID).filter(
    (h) => !sameToken(h as Token, tokenIn) && !sameToken(h as Token, tokenOut),
  );

  // Candidate paths: direct, then one hop through each hub.
  const candidates: {path: Address[]; symbols: string[]}[] = [];
  if (inAddr && outAddr && inAddr.toLowerCase() !== outAddr.toLowerCase()) {
    candidates.push({path: [inAddr, outAddr], symbols: [tokenIn.symbol, tokenOut.symbol]});
    for (const h of hubs) {
      const hubAddr = routedAddress(h as Token);
      if (!hubAddr) continue;
      if (hubAddr.toLowerCase() === inAddr.toLowerCase()) continue;
      if (hubAddr.toLowerCase() === outAddr.toLowerCase()) continue;
      candidates.push({
        path: [inAddr, hubAddr, outAddr],
        symbols: [tokenIn.symbol, h.symbol, tokenOut.symbol],
      });
    }
  }

  // Every pair address any candidate needs, deduplicated into one batch read.
  const pairSet = new Map<string, {a: Address; b: Address}>();
  if (ARKSWAP_FACTORY_ADDRESS) {
    for (const c of candidates) {
      for (let i = 0; i < c.path.length - 1; i++) {
        const a = c.path[i];
        const b = c.path[i + 1];
        const addr = computePairAddress(ARKSWAP_FACTORY_ADDRESS, a, b);
        pairSet.set(addr.toLowerCase(), {a, b});
      }
    }
  }
  const pairAddrs = [...pairSet.keys()] as Address[];

  const query = useReadContracts({
    allowFailure: true,
    contracts: pairAddrs.flatMap((p) => [
      {address: p, abi: pairAbi, functionName: 'getReserves' as const},
      {address: p, abi: pairAbi, functionName: 'token0' as const},
    ]),
    query: {enabled: pairAddrs.length > 0, refetchInterval: 12_000},
  });

  const pools = new Map<string, PoolReserves>();
  if (query.data) {
    pairAddrs.forEach((p, i) => {
      const res = query.data[i * 2]?.result as readonly [bigint, bigint, number] | undefined;
      const t0 = query.data[i * 2 + 1]?.result as Address | undefined;
      // A pair that has never been created reverts; skip it rather than treating
      // a failed read as an empty pool.
      if (!res || !t0) return;
      if (res[0] === 0n || res[1] === 0n) return;
      pools.set(p.toLowerCase(), {token0: t0, reserve0: res[0], reserve1: res[1]});
    });
  }

  let best: SwapRoute | undefined;
  if (amountIn !== null && amountIn > 0n && ARKSWAP_FACTORY_ADDRESS) {
    for (const c of candidates) {
      const hops: Hop[] = [];
      let usable = true;
      for (let i = 0; i < c.path.length - 1; i++) {
        const pair = computePairAddress(ARKSWAP_FACTORY_ADDRESS, c.path[i], c.path[i + 1]);
        if (!pools.has(pair.toLowerCase())) {
          usable = false;
          break;
        }
        hops.push({pair, tokenIn: c.path[i], tokenOut: c.path[i + 1]});
      }
      if (!usable) continue;

      try {
        let amount = amountIn;
        // idealNum/idealDen accumulates the mid price across hops as an exact
        // fraction, so impact is measured against the fee-free rate rather than
        // a rounded intermediate.
        let idealNum = amountIn;
        let idealDen = 1n;

        for (const hop of hops) {
          const pool = pools.get(hop.pair.toLowerCase())!;
          const zeroIsIn = pool.token0.toLowerCase() === hop.tokenIn.toLowerCase();
          const reserveIn = zeroIsIn ? pool.reserve0 : pool.reserve1;
          const reserveOut = zeroIsIn ? pool.reserve1 : pool.reserve0;
          amount = getAmountOut(amount, reserveIn, reserveOut);
          idealNum *= reserveOut;
          idealDen *= reserveIn;
        }

        if (amount <= 0n) continue;
        if (!best || amount > best.amountOut) {
          const ideal = idealDen > 0n ? idealNum / idealDen : 0n;
          const impactBps = ideal > 0n && ideal > amount ? ((ideal - amount) * 10_000n) / ideal : 0n;
          best = {path: c.path, symbols: c.symbols, amountOut: amount, impactBps};
        }
      } catch {
        // getAmountOut throws on empty reserves; that candidate is simply unusable.
        continue;
      }
    }
  }

  return {
    route: best,
    /** True once reserves are known and no candidate path had liquidity. */
    noLiquidity: !query.isLoading && pools.size === 0,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
