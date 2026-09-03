/**
 * The ArkSwap analytics API contract (llm.txt s29–s36, s48).
 *
 * Monetary and token amounts are STRINGS, not numbers. ERC-20 amounts routinely
 * exceed IEEE-754 integer precision, and a silently rounded balance in an
 * analytics UI is indistinguishable from a correct one. The Go API serialises
 * exact decimal strings; consumers parse them deliberately.
 */

/** Success envelope. */
export type ApiResponse<T> = {data: T};

/** Paginated list envelope. */
export type ApiListResponse<T> = {
  data: T[];
  pagination: {limit: number; offset: number; total: number};
};

/** Error envelope. Never carries DB errors or stack traces (llm.txt s45). */
export type ApiError = {
  error: {code: string; message: string};
};

export type HealthStatus = 'ok' | 'degraded';

export type Health = {
  status: HealthStatus;
  chainId: string;
  latestChainBlock: number;
  lastIndexedBlock: number;
  lag: number;
};

export type ProtocolStats = {
  tvlUsd: string;
  volume24hUsd: string;
  volume7dUsd: string;
  estimatedFees24hUsd: string;
  totalPairs: number;
  transactions24h: number;
};

export type TokenSummary = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  /** False when a metadata call reverted; the token is still indexed (llm.txt s10). */
  metadataComplete: boolean;
  /**
   * Operator-curated flags. Being created by ArkSwapFactory makes a pair
   * canonical, NOT its tokens safe (llm.txt s46).
   */
  isWhitelisted: boolean;
  isStable: boolean;
  isWkash: boolean;
  priceUsd: string | null;
};

export type PairSummary = {
  address: string;
  token0: TokenSummary;
  token1: TokenSummary;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  tvlUsd: string | null;
  volume24hUsd: string;
  fees24hUsd: string;
  txCount24h: number;
};

export type PairDetail = PairSummary & {
  createdBlock: number;
  createdTxHash: string;
  createdTimestamp: number;
  lastSyncBlock: number | null;
  /** Estimated, not guaranteed — see llm.txt s28. */
  estimatedAprPercent: string | null;
};

export type SwapRecord = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: number;
  pairAddress: string;
  sender: string;
  recipient: string;
  tokenIn: string | null;
  tokenOut: string | null;
  amountIn: string | null;
  amountOut: string | null;
  amountUsd: string | null;
};

export type LiquidityEventType = 'MINT' | 'BURN';

export type LiquidityEventRecord = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: number;
  pairAddress: string;
  eventType: LiquidityEventType;
  sender: string | null;
  recipient: string | null;
  amount0: string;
  amount1: string;
  amountUsd: string | null;
};

export type ChartInterval = '1h' | '1d';

export type ChartPoint = {
  timestamp: number;
  price: string | null;
  tvlUsd: string | null;
  volumeUsd: string;
};

export type AccountPosition = {
  pairAddress: string;
  token0: TokenSummary;
  token1: TokenSummary;
  lpBalance: string;
  lpTotalSupply: string;
  shareBps: number;
  token0Amount: string;
  token1Amount: string;
  valueUsd: string | null;
};
