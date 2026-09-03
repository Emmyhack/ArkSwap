/**
 * AMM math, re-exported from @arkswap/sdk.
 *
 * The implementation lives in the shared package so apps/web and any future
 * consumer compute quotes identically. Execution is still bounded on-chain by
 * amountOutMin / amountInMax — these numbers are display estimates (llm.txt s42).
 */
export {
  BPS,
  FEE_DENOMINATOR,
  FEE_NUMERATOR,
  PRICE_IMPACT_BLOCK_BPS,
  PRICE_IMPACT_HIGH_BPS,
  PRICE_IMPACT_WARN_BPS,
  computePairAddress,
  deadlineFromNow,
  getAmountIn,
  getAmountOut,
  impactSeverity,
  maximumSold,
  minimumReceived,
  priceImpactBps,
  quote,
  sortTokens,
  type ImpactSeverity,
} from '@arkswap/sdk';

export {LP_FEE_BPS} from '@arkswap/config';
