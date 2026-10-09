'use client';

import {routingHubs} from '@arkswap/config';
import {type Address} from 'viem';
import {useReadContracts} from 'wagmi';

import {pairAbi} from '@/config/abis';
import {ARK_CHAIN_ID} from '@/config/chain';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {type Token, routedAddress, sameToken} from '@/config/tokens';
import {computePairAddress, getAmountIn, getAmountOut} from '@/lib/amm';
import type {SwapSide} from '@/state/swap';

type Hop = {pair: Address; tokenIn: Address; tokenOut: Address};

export type SwapRoute = {
  /** Token path passed straight to the Router: 2 addresses direct, up to 4 via hubs. */
  path: Address[];
  /** Human-readable symbols for display, e.g. ["mWETH","mUSDC","mLINK"]. */
  symbols: string[];
  amountIn: bigint;
  amountOut: bigint;
  /** Basis points of execution shortfall against the mid price, across all hops. */
  impactBps: bigint;
};

type PoolReserves = {token0: Address; reserve0: bigint; reserve1: bigint};

type Candidate = {path: Address[]; symbols: string[]};

/**
 * Finds the best route between two tokens.
 *
 * ArkSwap V1 has no on-chain router/quoter contract, so the frontend decides the
 * path. It considers the direct pair, one hop through each configured routing
 * hub, and two hops through each ordered pair of distinct hubs, then keeps
 * whichever actually gives the user the best deal: the most output for an
 * exact-input swap, or the least input for an exact-output one. A direct pair
 * is not always best when it is thin.
 *
 * Search is bounded to two intermediate hops. Every extra hop costs gas and
 * compounds price impact, and with the hub list fixed the candidate set stays
 * small enough to quote in one batched read. Paths never revisit a token, so
 * there is no cycle to detect.
 *
 * The quote produced here is a DISPLAY ESTIMATE. Execution is bounded on-chain
 * by amountOutMin / amountInMax, so a stale route costs gas at worst, never
 * funds beyond the user's slippage tolerance (llm.txt s42).
 */
export function useSwapRoute(tokenIn: Token, tokenOut: Token, amount: bigint | null, side: SwapSide = 'in') {
  const inAddr = routedAddress(tokenIn);
  const outAddr = routedAddress(tokenOut);
  const hubs = routingHubs(ARK_CHAIN_ID)
    .filter((h) => !sameToken(h as Token, tokenIn) && !sameToken(h as Token, tokenOut))
    .map((h) => ({addr: routedAddress(h as Token), symbol: h.symbol}))
    .filter((h): h is {addr: Address; symbol: string} => Boolean(h.addr))
    .filter(
      (h) => h.addr.toLowerCase() !== inAddr?.toLowerCase() && h.addr.toLowerCase() !== outAddr?.toLowerCase(),
    );

  // Candidate paths: direct, one hop through each hub, two hops through each
  // ordered pair of distinct hubs.
  const candidates: Candidate[] = [];
  if (inAddr && outAddr && inAddr.toLowerCase() !== outAddr.toLowerCase()) {
    candidates.push({path: [inAddr, outAddr], symbols: [tokenIn.symbol, tokenOut.symbol]});
    for (const h of hubs) {
      candidates.push({path: [inAddr, h.addr, outAddr], symbols: [tokenIn.symbol, h.symbol, tokenOut.symbol]});
    }
    for (const a of hubs) {
      for (const b of hubs) {
        if (a.addr.toLowerCase() === b.addr.toLowerCase()) continue;
        candidates.push({
          path: [inAddr, a.addr, b.addr, outAddr],
          symbols: [tokenIn.symbol, a.symbol, b.symbol, tokenOut.symbol],
        });
      }
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
  if (amount !== null && amount > 0n && ARKSWAP_FACTORY_ADDRESS) {
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
        const evaluated = side === 'in' ? quoteExactIn(hops, pools, amount) : quoteExactOut(hops, pools, amount);
        if (!evaluated) continue;
        const better =
          !best ||
          (side === 'in' ? evaluated.amountOut > best.amountOut : evaluated.amountIn < best.amountIn);
        if (better) best = {path: c.path, symbols: c.symbols, ...evaluated};
      } catch {
        // The library math throws on empty reserves or an output that exceeds a
        // reserve; that candidate is simply unusable.
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

function oriented(pool: PoolReserves, tokenIn: Address) {
  const zeroIsIn = pool.token0.toLowerCase() === tokenIn.toLowerCase();
  return {
    reserveIn: zeroIsIn ? pool.reserve0 : pool.reserve1,
    reserveOut: zeroIsIn ? pool.reserve1 : pool.reserve0,
  };
}

/**
 * Walks the path forward. idealNum/idealDen accumulates the mid price across
 * hops as an exact fraction, so impact is measured against the fee-free rate
 * rather than a rounded intermediate.
 */
function quoteExactIn(hops: Hop[], pools: Map<string, PoolReserves>, amountIn: bigint) {
  let amount = amountIn;
  let idealNum = amountIn;
  let idealDen = 1n;
  for (const hop of hops) {
    const {reserveIn, reserveOut} = oriented(pools.get(hop.pair.toLowerCase())!, hop.tokenIn);
    amount = getAmountOut(amount, reserveIn, reserveOut);
    idealNum *= reserveOut;
    idealDen *= reserveIn;
  }
  if (amount <= 0n) return undefined;
  const ideal = idealDen > 0n ? idealNum / idealDen : 0n;
  const impactBps = ideal > 0n && ideal > amount ? ((ideal - amount) * 10_000n) / ideal : 0n;
  return {amountIn, amountOut: amount, impactBps};
}

/**
 * Walks the path backwards from the wanted output, mirroring
 * `ArkSwapLibrary.getAmountsIn`. Impact is the premium paid over the mid-price
 * input, the mirror image of the exact-input shortfall.
 */
function quoteExactOut(hops: Hop[], pools: Map<string, PoolReserves>, amountOut: bigint) {
  let amount = amountOut;
  let idealNum = amountOut; // multiplied by reserveIn per hop
  let idealDen = 1n; // multiplied by reserveOut per hop
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    const {reserveIn, reserveOut} = oriented(pools.get(hop.pair.toLowerCase())!, hop.tokenIn);
    amount = getAmountIn(amount, reserveIn, reserveOut);
    idealNum *= reserveIn;
    idealDen *= reserveOut;
  }
  if (amount <= 0n) return undefined;
  const idealIn = idealDen > 0n ? idealNum / idealDen : 0n;
  const impactBps = amount > idealIn && amount > 0n ? ((amount - idealIn) * 10_000n) / amount : 0n;
  return {amountIn: amount, amountOut, impactBps};
}
