'use client';

import {ANALYTICS_UNAVAILABLE} from '@arkswap/sdk';

import {ARK_CHAIN_ID, explorerAddressUrl} from '@/config/chain';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {useProtocolAnalytics} from '@/hooks/useAnalytics';
import {useProtocolStats} from '@/hooks/useProtocolStats';
import {formatAmount} from '@/lib/format';

/**
 * Protocol figures.
 *
 * TVL, volume and fees come from the analytics API, which is the only component
 * that can compute them: they need swap history, and the chain exposes current
 * state rather than a time series (llm.txt s37).
 *
 * Pool count and locked balances stay direct chain reads. They are cheap, always
 * correct, and — critically — they keep this panel showing something true when
 * the backend is down, which is the failure mode llm.txt s38 requires. Trading
 * is untouched either way: nothing on the swap path reads this.
 */
export function StatsSection() {
  const {poolCount, kashLocked, tokenCount} = useProtocolStats();
  const {data: analytics, isLoading} = useProtocolAnalytics();

  const stats = analytics?.ok ? analytics.data : undefined;
  const unavailable = Boolean(analytics && !analytics.ok);

  return (
    <section className="section">
      <div className="stats-wrap">
        <div>
          <h2 className="section__title" style={{marginBottom: 20}}>
            Live on Ark devnet
          </h2>
          <p className="section__lede">
            ArkSwap is a constant-product AMM on Ark Constellation. Pool counts and locked balances
            are read straight from the chain; volume and fees come from the analytics indexer.
          </p>

          {unavailable && (
            <div className="alert alert--warn" style={{maxWidth: 420}}>
              {ANALYTICS_UNAVAILABLE} Swapping and liquidity are unaffected — they run directly
              against the chain.
            </div>
          )}

          {ARKSWAP_FACTORY_ADDRESS && explorerAddressUrl(ARKSWAP_FACTORY_ADDRESS) && (
            <a
              className="link-btn"
              href={explorerAddressUrl(ARKSWAP_FACTORY_ADDRESS)}
              target="_blank"
              rel="noreferrer"
            >
              View the factory on Blockscout →
            </a>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat__label">Liquidity pools</span>
            <span className="stat__value">{poolCount}</span>
          </div>

          <div className="stat">
            <span className="stat__label">
              <span className="stat__dot" />
              Total value locked
            </span>
            <span className="stat__value stat__value--accent">
              {stats ? `$${formatUsdCompact(stats.tvlUsd)}` : isLoading ? '…' : '—'}
              {!stats && !isLoading && <span className="stat__unit">indexer offline</span>}
            </span>
          </div>

          <div className="stat">
            <span className="stat__label">Volume (7d)</span>
            <span className="stat__value">
              {stats ? `$${formatUsdCompact(stats.volume7dUsd)}` : isLoading ? '…' : '—'}
              {stats && <span className="stat__unit">{stats.transactions24h} tx / 24h</span>}
            </span>
          </div>

          <div className="stat">
            <span className="stat__label">KASH locked</span>
            <span className="stat__value">
              {formatAmount(kashLocked, 18, 2)}
              <span className="stat__unit">{tokenCount} tokens · chain {ARK_CHAIN_ID || '—'}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders an exact decimal string from the API compactly.
 *
 * The API sends money as strings precisely so nothing rounds it in transit;
 * this only shortens it for display and never feeds a calculation.
 */
function formatUsdCompact(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}
