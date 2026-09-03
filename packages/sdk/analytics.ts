import type {
  AccountPosition,
  ApiListResponse,
  ApiResponse,
  ChartInterval,
  ChartPoint,
  Health,
  LiquidityEventRecord,
  PairDetail,
  PairSummary,
  ProtocolStats,
  SwapRecord,
  TokenSummary,
} from '@arkswap/types';

/**
 * Client for the ArkSwap analytics API.
 *
 * ARCHITECTURAL RULE (llm.txt s1, s37, s38, s64): this client is ONLY ever used
 * for analytics. It must never appear on the swap, add-liquidity or
 * remove-liquidity path, and it is never the transaction authority. If the API
 * is down, trading must continue to work against the chain directly.
 *
 * To make that failure mode impossible to get wrong by accident, every method
 * returns an `AnalyticsResult` instead of throwing or returning bare data.
 * Callers are forced to handle `ok: false`, which renders as "Analytics
 * temporarily unavailable" rather than taking a page down.
 *
 * The base URL is injected by the app, not read from `process.env` here — see
 * the note in @arkswap/config about Next only inlining env vars it compiles.
 */
export type AnalyticsResult<T> =
  | {ok: true; data: T}
  | {ok: false; reason: 'unconfigured' | 'unreachable' | 'error'; message: string};

export type AnalyticsClientOptions = {
  /** e.g. http://localhost:8080/api/v1 — omit to disable analytics entirely. */
  baseUrl?: string;
  /** Kept short: analytics must never make the UI feel broken. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 6_000;

/** Server-side pagination limits mirror llm.txt s47 so the UI cannot over-ask. */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

export function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.floor(limit), PAGE_LIMIT_MAX);
}

export class AnalyticsClient {
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnalyticsClientOptions = {}) {
    this.baseUrl = opts.baseUrl?.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  private async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<AnalyticsResult<T>> {
    if (!this.baseUrl) {
      return {ok: false, reason: 'unconfigured', message: 'Analytics API URL is not configured'};
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: {accept: 'application/json'},
      });

      if (!res.ok) {
        // Surface the API's own error code when it sent one, but never assume a
        // body shape — an upstream proxy may return HTML.
        let message = `Analytics API returned ${res.status}`;
        try {
          const body = (await res.json()) as {error?: {code?: string; message?: string}};
          if (body?.error?.message) message = body.error.message;
        } catch {
          /* keep the status-based message */
        }
        return {ok: false, reason: 'error', message};
      }

      const body = (await res.json()) as ApiResponse<T> | ApiListResponse<never>;
      if (!body || typeof body !== 'object' || !('data' in body)) {
        return {ok: false, reason: 'error', message: 'Malformed analytics response'};
      }
      return {ok: true, data: body as unknown as T};
    } catch (e) {
      const message = e instanceof Error && e.name === 'AbortError'
        ? 'Analytics API timed out'
        : 'Analytics API unreachable';
      return {ok: false, reason: 'unreachable', message};
    } finally {
      clearTimeout(timer);
    }
  }

  health() {
    return this.get<Health>('/health').then(unwrapData);
  }

  stats() {
    return this.get<ProtocolStats>('/stats').then(unwrapData);
  }

  pairs(params: {limit?: number; offset?: number; sort?: string; token?: string; minTvlUsd?: string} = {}) {
    return this.get<ApiListResponse<PairSummary>>('/pairs', {
      ...params,
      limit: clampLimit(params.limit),
    });
  }

  pair(address: string) {
    return this.get<PairDetail>(`/pairs/${address}`).then(unwrapData);
  }

  pairSwaps(address: string, params: {limit?: number; offset?: number} = {}) {
    return this.get<ApiListResponse<SwapRecord>>(`/pairs/${address}/swaps`, {
      ...params,
      limit: clampLimit(params.limit),
    });
  }

  pairLiquidity(address: string, params: {limit?: number; offset?: number} = {}) {
    return this.get<ApiListResponse<LiquidityEventRecord>>(`/pairs/${address}/liquidity`, {
      ...params,
      limit: clampLimit(params.limit),
    });
  }

  pairChart(address: string, interval: ChartInterval = '1h') {
    return this.get<ChartPoint[]>(`/pairs/${address}/chart`, {interval}).then(unwrapData);
  }

  tokens(params: {limit?: number; offset?: number} = {}) {
    return this.get<ApiListResponse<TokenSummary>>('/tokens', {
      ...params,
      limit: clampLimit(params.limit),
    });
  }

  token(address: string) {
    return this.get<TokenSummary>(`/tokens/${address}`).then(unwrapData);
  }

  tokenPrice(address: string) {
    return this.get<{address: string; priceUsd: string | null}>(`/tokens/${address}/price`).then(unwrapData);
  }

  /**
   * LP positions for display only. llm.txt s36 is explicit: backend position
   * data must never authorise a transaction. Removing liquidity reads the LP
   * balance from the chain at submit time.
   */
  accountPositions(address: string) {
    return this.get<AccountPosition[]>(`/accounts/${address}/positions`).then(unwrapData);
  }

  accountSwaps(address: string, params: {limit?: number; offset?: number} = {}) {
    return this.get<ApiListResponse<SwapRecord>>(`/accounts/${address}/swaps`, {
      ...params,
      limit: clampLimit(params.limit),
    });
  }
}

/** `{data: T}` envelopes are unwrapped; failures pass through untouched. */
function unwrapData<T>(r: AnalyticsResult<ApiResponse<T> | T>): AnalyticsResult<T> {
  if (!r.ok) return r;
  const d = r.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'data' in d) return {ok: true, data: d.data};
  return {ok: true, data: r.data as T};
}

/** Human copy for a failed analytics read. Required wording from llm.txt s38. */
export const ANALYTICS_UNAVAILABLE = 'Analytics temporarily unavailable.';
