'use client';

import {AnalyticsClient, type AnalyticsResult} from '@arkswap/sdk';
import type {ProtocolStats} from '@arkswap/types';
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
