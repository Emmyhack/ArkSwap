'use client';

import {AnalyticsClient, type AnalyticsResult} from '@arkswap/sdk';
import type {ChartInterval, ChartPoint, ProtocolStats} from '@arkswap/types';
import {useQuery} from '@tanstack/react-query';
import {useMemo} from 'react';

import {ARKSWAP_API_URL} from '@/config/chain';

/**
 * Analytics reads.
 *
 * ARCHITECTURAL RULE (llm.txt s1, s37, s38): these hooks are for display only.
 * Nothing on the swap, add-liquidity or remove-liquidity path may depend on
 * them, and the API is never the transaction authority. If it is down, trading
 * continues against the chain and only these panels degrade.
 *
 * Retries are capped at one and failures are cached briefly, so an unreachable
 * backend costs a moment of loading rather than hammering a dead host on every
 * render.
 */
export function useAnalyticsClient() {
  return useMemo(() => new AnalyticsClient({baseUrl: ARKSWAP_API_URL}), []);
}

export function useProtocolAnalytics() {
  const client = useAnalyticsClient();
  return useQuery<AnalyticsResult<ProtocolStats>>({
    queryKey: ['analytics', 'stats', ARKSWAP_API_URL],
    queryFn: () => client.stats(),
    enabled: client.configured,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
  });
}

/**
 * A pair's history.
 *
 * Buckets before the indexer started recording snapshots carry volume but no
 * price or TVL, so a consumer must treat those fields as optional per point
 * rather than assuming the series is uniform.
 */
export function usePairChart(address: string | undefined, interval: ChartInterval = '1d') {
  const client = useAnalyticsClient();
  return useQuery<AnalyticsResult<ChartPoint[]>>({
    queryKey: ['analytics', 'chart', address, interval, ARKSWAP_API_URL],
    queryFn: () => client.pairChart(address as string, interval),
    enabled: client.configured && Boolean(address),
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}

/** The deepest priced pool, used where a page needs one representative pair. */
export function useDeepestPair() {
  const client = useAnalyticsClient();
  return useQuery({
    queryKey: ['analytics', 'deepest-pair', ARKSWAP_API_URL],
    queryFn: async () => {
      const r = await client.pairs({limit: 20});
      if (!r.ok) return r;
      // Pools with no route to a stablecoin report null TVL; ranking by a value
      // that is deliberately absent would pick an arbitrary pool, so they are
      // skipped rather than treated as zero.
      const priced = r.data.data.filter((p) => p.tvlUsd !== null);
      const best = priced.sort((a, b) => Number(b.tvlUsd) - Number(a.tvlUsd))[0];
      return {ok: true as const, data: best ?? null};
    },
    enabled: client.configured,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}
