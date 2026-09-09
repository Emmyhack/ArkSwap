'use client';

import type {PairSummary, SwapRecord} from '@arkswap/types';
import {useQuery} from '@tanstack/react-query';

import {ARKSWAP_API_URL} from '@/config/chain';

import {useAnalyticsClient} from './useAnalytics';

/**
 * A protocol-wide recent-trades feed.
 *
 * The API exposes swaps per pair, not protocol-wide (llm.txt s47), so the feed
 * is assembled here: take the deepest few pools, read each one's latest swaps,
 * and merge by timestamp. Reading only the top pools bounds the request count
 * and matches what the panel shows — the pairs with enough depth to be worth
 * watching.
 *
 * Display only. A failure here never blocks trading (llm.txt s38).
 */
const POOLS_SAMPLED = 4;

export function useRecentTrades(limit = 8) {
  const client = useAnalyticsClient();

  return useQuery({
    queryKey: ['analytics', 'recent-trades', limit, ARKSWAP_API_URL],
    enabled: client.configured,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
    queryFn: async () => {
      const pairs = await client.pairs({limit: POOLS_SAMPLED});
      if (!pairs.ok) return pairs;

      const pools: PairSummary[] = pairs.data.data;
      const pages = await Promise.all(
        pools.map((pool) => client.pairSwaps(pool.address, {limit})),
      );

      // One dead pool must not empty the panel: keep whatever came back and let
      // the merged list stand on its own.
      const swaps: SwapRecord[] = [];
      for (const page of pages) {
        if (page.ok) swaps.push(...page.data.data);
      }

      swaps.sort(
        (a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber || b.logIndex - a.logIndex,
      );

      return {ok: true as const, data: swaps.slice(0, limit)};
    },
  });
}
