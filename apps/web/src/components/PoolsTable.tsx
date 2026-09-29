'use client';

import {ANALYTICS_UNAVAILABLE} from '@arkswap/sdk';
import type {PairSummary} from '@arkswap/types';
import {useQuery} from '@tanstack/react-query';
import Link from 'next/link';
import {useMemo, useState} from 'react';

import {ARKSWAP_API_URL, explorerAddressUrl} from '@/config/chain';
import {WKASH_ADDRESS} from '@/config/contracts';
import {KASH, tokenParam} from '@/config/tokens';
import {useAnalyticsClient} from '@/hooks/useAnalytics';
import {type PoolRow, usePools} from '@/hooks/usePools';
import {usePositions} from '@/hooks/usePositions';
import {formatAmount, formatBps, shortenAddress} from '@/lib/format';
import {type PoolToken, formatUsd} from '@/lib/valuation';

import {Skeleton} from './Skeleton';
import {TokenIcon} from './TokenIcon';

/**
 * Every ArkSwap pool.
 *
 * Reserves, tokens and a mid-price TVL come straight from the chain, so the
 * table is complete whenever the RPC is. Volume and fees need swap history,
 * which only the indexer has; those columns fill in when the analytics API is
 * reachable and say so when it is not (llm.txt s37, s38).
 */
export function PoolsTable() {
  const {pools, isLoading} = usePools();
  const {positions} = usePositions();
  const client = useAnalyticsClient();
  const [query, setQuery] = useState('');

  const analytics = useQuery({
    queryKey: ['analytics', 'pairs-all', ARKSWAP_API_URL],
    queryFn: () => client.pairs({limit: 100}),
    enabled: client.configured,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });

  const byAddress = useMemo(() => {
    const m = new Map<string, PairSummary>();
    if (analytics.data?.ok) for (const p of analytics.data.data.data) m.set(p.address.toLowerCase(), p);
    return m;
  }, [analytics.data]);

  const shareOf = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const p of positions) m.set(p.pair.toLowerCase(), p.shareBps);
    return m;
  }, [positions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? pools.filter(
          (p) =>
            p.token0.symbol.toLowerCase().includes(q) ||
            p.token1.symbol.toLowerCase().includes(q) ||
            p.pair.toLowerCase().includes(q),
        )
      : pools;
    return [...filtered].sort((a, b) => ((b.tvl ?? -1n) > (a.tvl ?? -1n) ? 1 : -1));
  }, [pools, query]);

  const totalTvl = pools.reduce<bigint | undefined>((acc, p) => (p.tvl === undefined ? acc : (acc ?? 0n) + p.tvl), undefined);
  const unavailable = client.configured && analytics.data && !analytics.data.ok;

  return (
    <section className="pools">
      <div className="pools__summary">
        <div className="stat stat--compact">
          <span className="stat__label">Pools</span>
          <span className="stat__value">{isLoading && pools.length === 0 ? <Skeleton width={40} height={28} /> : pools.length}</span>
        </div>
        <div className="stat stat--compact">
          <span className="stat__label">
            <span className="stat__dot" />
            Value locked
          </span>
          <span className="stat__value stat__value--accent">
            {isLoading && pools.length === 0 ? <Skeleton width={90} height={28} /> : formatUsd(totalTvl)}
            <span className="stat__unit">mid-price, from reserves</span>
          </span>
        </div>
        <div className="pools__search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by token or address"
            aria-label="Filter pools"
            className="settings__input"
            style={{width: '100%'}}
          />
        </div>
      </div>

      {unavailable && <div className="alert alert--warn">{ANALYTICS_UNAVAILABLE} Volume and fees are hidden; reserves are live.</div>}
      {!client.configured && (
        <div className="alert alert--info">Volume and fee columns need the analytics API; reserves and TVL are read from the chain.</div>
      )}

      <div className="card pools__table">
        <div className="pools__row pools__row--head">
          <span>Pool</span>
          <span className="pools__num">TVL</span>
          <span className="pools__num">Volume 24h</span>
          <span className="pools__num">Fees 24h</span>
          <span className="pools__num">Your share</span>
          <span />
        </div>

        {isLoading && pools.length === 0 &&
          [0, 1, 2].map((i) => (
            <div className="pools__row" key={i}>
              <span className="pools__pair">
                <Skeleton width={30} height={30} style={{borderRadius: 15}} />
                <Skeleton width={110} />
              </span>
              <span className="pools__num"><Skeleton width={70} /></span>
              <span className="pools__num"><Skeleton width={70} /></span>
              <span className="pools__num"><Skeleton width={60} /></span>
              <span className="pools__num"><Skeleton width={40} /></span>
              <span />
            </div>
          ))}

        {!isLoading && rows.length === 0 && (
          <div className="trades__empty">{pools.length === 0 ? 'No pools have been created yet.' : 'No pool matches that filter.'}</div>
        )}

        {rows.map((p) => (
          <PoolLine key={p.pair} pool={p} analytics={byAddress.get(p.pair.toLowerCase())} share={shareOf.get(p.pair.toLowerCase())} />
        ))}
      </div>
    </section>
  );
}

function linkParam(t: PoolToken): string {
  if (WKASH_ADDRESS && t.address.toLowerCase() === WKASH_ADDRESS.toLowerCase()) return tokenParam(KASH);
  return t.known ? t.symbol : t.address;
}

function PoolLine({pool: p, analytics, share}: {pool: PoolRow; analytics?: PairSummary; share?: bigint}) {
  const a = linkParam(p.token0);
  const b = linkParam(p.token1);
  const explorer = explorerAddressUrl(p.pair);
  return (
    <div className="pools__row">
      <span className="pools__pair">
        <span className="pair-icons" aria-hidden>
          <TokenIcon token={p.token0} size={30} />
          <TokenIcon token={p.token1} size={30} />
        </span>
        <span className="token-list__text">
          <span className="token-list__name">
            {p.token0.symbol} / {p.token1.symbol}
            {(!p.token0.known || !p.token1.known) && <span className="badge badge--warn" style={{marginLeft: 8}}>unverified</span>}
          </span>
          <span className="token-list__meta">
            <span className="mono">
              {formatAmount(p.reserve0, p.token0.decimals, 2)} / {formatAmount(p.reserve1, p.token1.decimals, 2)}
            </span>
            {explorer ? (
              <a href={explorer} target="_blank" rel="noreferrer" className="token-list__addr">
                {shortenAddress(p.pair)} ↗
              </a>
            ) : (
              <span className="token-list__addr">{shortenAddress(p.pair)}</span>
            )}
          </span>
        </span>
      </span>
      <span className="pools__num mono">
        {formatUsd(p.tvl)}
        {analytics?.tvlUsd && <span className="price-row__sub">indexed {usd(analytics.tvlUsd)}</span>}
      </span>
      <span className="pools__num mono">{analytics ? usd(analytics.volume24hUsd) : <span className="trades__muted">—</span>}</span>
      <span className="pools__num mono">
        {analytics ? usd(analytics.fees24hUsd) : <span className="trades__muted">—</span>}
        {analytics && analytics.tvlUsd && Number(analytics.tvlUsd) > 0 && (
          <span className="price-row__sub">{apr(analytics.fees24hUsd, analytics.tvlUsd)} est. APR</span>
        )}
      </span>
      <span className="pools__num mono">{share !== undefined ? formatBps(share) : <span className="trades__muted">—</span>}</span>
      <span className="pools__actions">
        <Link className="settings__chip" href={`/swap?in=${encodeURIComponent(a)}&out=${encodeURIComponent(b)}`}>
          Swap
        </Link>
        <Link className="settings__chip" href={`/pool?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&mode=add`}>
          Add
        </Link>
      </span>
    </div>
  );
}

/** Display-only shortening of the API's exact decimal strings. */
function usd(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

/** Simple annualisation of one day's fees over TVL: an estimate, not a promise (llm.txt s28). */
function apr(fees24h: string, tvl: string): string {
  const f = Number(fees24h);
  const t = Number(tvl);
  if (!Number.isFinite(f) || !Number.isFinite(t) || t <= 0) return '—';
  return `${((f / t) * 365 * 100).toFixed(2)}%`;
}
