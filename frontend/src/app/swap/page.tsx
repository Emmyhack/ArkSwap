import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {SwapCard} from '@/components/SwapCard';

export default function SwapPage() {
  return (
    <main className="hero">
      <h1 className="hero__title">
        Swap anytime,
        <br />
        <em>anywhere on Ark.</em>
      </h1>

      <DevnetBanner />

      <ConfigGate>
        <SwapCard />
      </ConfigGate>

      <p className="hero__sub">
        A constant-product AMM on Ark Constellation. Trade KASH and EVM assets, or provide liquidity
        and earn the 0.30% fee.
      </p>

      <div className="hero__scroll">
        Non-custodial · your keys, your funds
        <span aria-hidden>⌄</span>
      </div>
    </main>
  );
}
