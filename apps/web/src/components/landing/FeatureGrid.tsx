import Link from 'next/link';

import {TokenPrices} from './TokenPrices';

const REPO = 'https://github.com/Emmyhack/ArkSwap';

export function FeatureGrid() {
  return (
    <section className="section" id="learn">
      <h2 className="section__title">Go direct to Ark.</h2>

      <div className="grid-2">
        <div className="feature" style={{'--tint': 'rgba(168,85,247,0.20)', '--pill': '#c48bff'} as React.CSSProperties}>
          <Link href="/swap" className="feature__pill">
            ◆ Swap
          </Link>
          <h3 className="feature__headline">
            Swapping made simple. Trade KASH and EVM assets straight from your wallet.
          </h3>
          <div className="feature__body">
            <TokenPrices />
          </div>
        </div>

        <div className="feature" style={{'--tint': 'rgba(217,70,239,0.18)', '--pill': '#f0a6ff'} as React.CSSProperties}>
          <Link href="/pool" className="feature__pill">
            ▲ Liquidity
          </Link>
          <h3 className="feature__headline">
            Provide liquidity and earn the full 0.30% fee on every swap through your pool.
          </h3>
          <div className="feature__body">
            <div className="price-row">
              <span className="price-row__name">Trade fee</span>
              <span className="price-row__val">0.30%</span>
            </div>
            <div className="price-row">
              <span className="price-row__name">Protocol fee</span>
              <span className="price-row__val">
                Disabled
                <span className="price-row__sub">100% of the fee stays with LPs</span>
              </span>
            </div>
            <div className="price-row">
              <span className="price-row__name">Pricing curve</span>
              <span className="price-row__val">
                x · y = k
                <span className="price-row__sub">constant product</span>
              </span>
            </div>
          </div>
        </div>

        <div className="feature" style={{'--tint': 'rgba(139,92,246,0.18)', '--pill': '#b39cff'} as React.CSSProperties}>
          <a className="feature__pill" href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            ⟨⟩ Developer docs
          </a>
          <h3 className="feature__headline">
            Open source, Uniswap V2-compatible contracts and a documented deployment path.
          </h3>
          <div className="feature__body">
            <div className="price-row">
              <span className="price-row__name">Router ABI</span>
              <span className="price-row__val">
                V2-compatible
                <span className="price-row__sub">existing tooling works unchanged</span>
              </span>
            </div>
            <div className="price-row">
              <span className="price-row__name">Pair addresses</span>
              <span className="price-row__val">
                CREATE2
                <span className="price-row__sub">deterministic, derivable offline</span>
              </span>
            </div>
          </div>
        </div>

        <div className="feature" style={{'--tint': 'rgba(99,102,241,0.20)', '--pill': '#a5b0ff'} as React.CSSProperties}>
          <a className="feature__pill" href={`${REPO}/blob/main/docs/SECURITY-REVIEW.md`} target="_blank" rel="noreferrer">
            ✦ Non-custodial
          </a>
          <h3 className="feature__headline">
            Your keys, your funds. No backend ever holds your assets or signs your swaps.
          </h3>
          <div className="feature__body">
            <div className="price-row">
              <span className="price-row__name">Custody</span>
              <span className="price-row__val">
                None
                <span className="price-row__sub">wallet → router → pair</span>
              </span>
            </div>
            <div className="price-row">
              <span className="price-row__name">Admin powers</span>
              <span className="price-row__val">
                Fee config only
                <span className="price-row__sub">no pausing, no seizure, no blacklist</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
