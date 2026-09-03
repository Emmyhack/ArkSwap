'use client';

import {ARK_CHAIN_ID, explorerAddressUrl} from '@/config/chain';
import {ARKSWAP_FACTORY_ADDRESS} from '@/config/contracts';
import {useProtocolStats} from '@/hooks/useProtocolStats';
import {formatAmount} from '@/lib/format';

/**
 * Protocol figures, all read live from the chain.
 *
 * Deliberately NOT shown: lifetime volume, swapper counts, cumulative LP fees.
 * Those need an indexer over historical events (llm.txt s46), and this build has
 * none — so rather than print a plausible-looking number, the page shows only
 * what the factory and pairs can answer right now.
 */
export function StatsSection() {
  const {poolCount, kashLocked, stablesLocked, tokenCount} = useProtocolStats();

  return (
    <section className="section">
      <div className="stats-wrap">
        <div>
          <h2 className="section__title" style={{marginBottom: 20}}>
            Live on Ark devnet
          </h2>
          <p className="section__lede">
            ArkSwap is a constant-product AMM on Ark Constellation. Every figure here is read from
            the factory and its pairs at page load — there is no indexer behind them, so nothing is
            estimated.
          </p>
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
              KASH locked
            </span>
            <span className="stat__value stat__value--accent">
              {formatAmount(kashLocked, 18, 2)}
              <span className="stat__unit">WKASH</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Stablecoin liquidity</span>
            <span className="stat__value">
              {formatAmount(stablesLocked, 6, 0)}
              <span className="stat__unit">mUSD</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Tokens listed</span>
            <span className="stat__value">
              {tokenCount}
              <span className="stat__unit">chain {ARK_CHAIN_ID || '—'}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
