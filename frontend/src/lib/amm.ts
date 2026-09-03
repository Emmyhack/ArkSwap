import {type Address, encodePacked, getAddress, keccak256} from 'viem';

import {PAIR_INIT_CODE_HASH} from '@/config/contracts';

/**
 * Client-side mirror of ArkSwapLibrary (llm.txt s11, s42).
 *
 * These functions exist to render quotes, price impact and minimum-received
 * BEFORE a transaction is sent. They are NOT the source of truth for execution:
 * every swap is bounded on-chain by `amountOutMin` / `amountInMax`, so a stale or
 * wrong local quote can cost the user gas but can never cost them funds beyond
 * their slippage tolerance (llm.txt s42).
 *
 * The 997/1000 terms encode ArkSwap's 0.30% fee and must stay in lockstep with
 * `ArkSwapLibrary` and `ArkSwapPair`. Changing the fee is a protocol-level change
 * (llm.txt s9, s54).
 */

export const FEE_NUMERATOR = 997n;
export const FEE_DENOMINATOR = 1000n;
/** 0.30%, in basis points. Shown to users as the liquidity-provider fee. */
export const LP_FEE_BPS = 30n;

export function sortTokens(tokenA: Address, tokenB: Address): [Address, Address] {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  if (a.toLowerCase() === b.toLowerCase()) throw new Error('ArkSwap: IDENTICAL_ADDRESSES');
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

/**
 * CREATE2 pair address derivation, mirroring `ArkSwapLibrary.pairFor`.
 *
 * Depends on PAIR_INIT_CODE_HASH being correct for the deployed ArkSwapPair. If
 * that constant is stale every address here is wrong, which is why the contract
 * suite gates it (llm.txt s7, s20).
 */
export function computePairAddress(factory: Address, tokenA: Address, tokenB: Address): Address {
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const salt = keccak256(encodePacked(['address', 'address'], [token0, token1]));
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      ['0xff', getAddress(factory), salt, PAIR_INIT_CODE_HASH],
    ),
  );
  return getAddress(`0x${hash.slice(-40)}`);
}

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_INPUT_AMOUNT');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_LIQUIDITY');
  const amountInWithFee = amountIn * FEE_NUMERATOR;
  return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
}

export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_OUTPUT_AMOUNT');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_LIQUIDITY');
  if (amountOut >= reserveOut) throw new Error('ArkSwapLibrary: INSUFFICIENT_LIQUIDITY');
  const numerator = reserveIn * amountOut * FEE_DENOMINATOR;
  const denominator = (reserveOut - amountOut) * FEE_NUMERATOR;
  // Rounds up, exactly as the contract does, so the pool is never undercharged.
  return numerator / denominator + 1n;
}

export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_AMOUNT');
  if (reserveA <= 0n || reserveB <= 0n) throw new Error('ArkSwapLibrary: INSUFFICIENT_LIQUIDITY');
  return (amountA * reserveB) / reserveA;
}

export const BPS = 10_000n;

/** Lower bound for an exact-input swap. Never call this with `0` slippage intent. */
export function minimumReceived(amountOut: bigint, slippageBps: bigint): bigint {
  return (amountOut * (BPS - slippageBps)) / BPS;
}

/** Upper bound for an exact-output swap. */
export function maximumSold(amountIn: bigint, slippageBps: bigint): bigint {
  return (amountIn * (BPS + slippageBps)) / BPS;
}

/**
 * Price impact in basis points: how far execution price sits below the mid price.
 *
 * Reported separately from the LP fee, so a user can tell a 0.30% fee apart from
 * genuine slippage against a thin pool (llm.txt s42).
 */
export function priceImpactBps(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  // Output at the current mid price, ignoring both fee and curve movement.
  const idealOut = (amountIn * reserveOut) / reserveIn;
  if (idealOut === 0n) return 0n;
  const impact = ((idealOut - amountOut) * BPS) / idealOut;
  return impact > 0n ? impact : 0n;
}

/** Impact thresholds used to escalate the UI warning (llm.txt s43). */
export const PRICE_IMPACT_WARN_BPS = 100n; // 1%
export const PRICE_IMPACT_HIGH_BPS = 300n; // 3%
export const PRICE_IMPACT_BLOCK_BPS = 1500n; // 15%

export type ImpactSeverity = 'none' | 'warn' | 'high' | 'severe';

export function impactSeverity(bps: bigint): ImpactSeverity {
  if (bps >= PRICE_IMPACT_BLOCK_BPS) return 'severe';
  if (bps >= PRICE_IMPACT_HIGH_BPS) return 'high';
  if (bps >= PRICE_IMPACT_WARN_BPS) return 'warn';
  return 'none';
}

/** Transaction deadline, as a unix timestamp `minutes` from now (llm.txt s43). */
export function deadlineFromNow(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}
