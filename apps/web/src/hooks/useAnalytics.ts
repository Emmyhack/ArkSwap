'use client';

import {AnalyticsClient, type AnalyticsResult} from '@arkswap/sdk';
import type {ProtocolStats, SwapRecord} from '@arkswap/types';
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

export function useRecentSwaps(limit = 8) {
  const client = useAnalyticsClient();
  return useQuery({
    queryKey: ['analytics', 'recent-swaps', limit, ARKSWAP_API_URL],
    queryFn: async () => {
      const r = await client.pairs({limit: 1});
      // Recent activity is read per pair; with no pair the list is simply empty.
      if (!r.ok) return r;
      const first = r.data.data[0];
      if (!first) return {ok: true as const, data: {data: [] as SwapRecord[]}};
      return client.pairSwaps(first.address, {limit});
    },
    enabled: client.configured,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
  });
}
